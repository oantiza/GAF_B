"""
Capa de lectura: usa un `reader` inyectable (duck-typed) para obtener documentos
de Firestore y los mapea a asset-for-bdb.v1. Desacoplado de firebase-admin para ser
testable con un reader falso. La implementacion live vive en firestore_client.py.

Interfaz esperada de `reader`:
  reader.get_asset(asset_id) -> dict | None
  reader.get_metrics_latest(asset_id) -> dict | None
  reader.get_holdings(asset_id) -> dict | None     # {"data": {...}} o None
  reader.list_assets(types, limit) -> list[dict]    # documentos root
"""
import bisect
import time
from typing import Optional

from google.api_core import exceptions as gexc

from .busqueda import coincide, como_se_busca, es_respuesta_exacta, palabras_de_la_busqueda
from .firestore_client import _valid_asset_id
from .mappers import json_safe, map_asset_detail, map_instrument_type
from asset_aliases import canonical_asset_id
from quietlog import swallowed, swallowed_quiet

# Índices base de los benchmarks sintéticos: EXCLUIDOS de la selección/generación
# de carteras del cliente (solo proveen histórico para construir los benchmarks).
EXCLUDED_BENCHMARK_ISINS = frozenset({"IE00B18GC888", "IE00B03HCZ61"})


class LecturaFallida(Exception):
    """La base no contesto (cuota, corte, plazo agotado): no es lo mismo que un activo que no existe.

    Hallazgo 19 de la auditoria del 15-11-2026: antes un fallo de lectura se tragaba y la respuesta decia
    «activo no encontrado» o salia vacia, como respuesta correcta. Se lanza cuando no se pudo leer NADA de
    lo que hacia falta, y `main.py` la convierte en UNAVAILABLE. Cuando falla solo una parte, la respuesta
    sigue y lleva avisos `READ_FAILED` (`aviso_de_lectura`).
    """


# Fallos que dicen que la BASE entera no contesta (plazo, corte, cuota, credencial): reintentar activo a activo no los
# arregla y cada lectura suelta cuesta otro plazo. Un fallo de UN documento (p. ej. un 500) no entra aqui: ese si degrada.
_FALLOS_GLOBALES = (gexc.DeadlineExceeded, gexc.ServiceUnavailable, gexc.ResourceExhausted,
                    gexc.Unauthenticated, gexc.PermissionDenied, gexc.RetryError)
# Tiempo maximo, por peticion, de las lecturas sueltas que sustituyen a un lote fallido. El callable muere a los 60 s.
PRESUPUESTO_LECTURAS_SUELTAS_S = 20.0


def _es_fallo_global(exc: BaseException) -> bool:
    """True si `exc` (o su causa) dice que la base no contesta en absoluto, no que fallo un documento."""
    visto = 0
    while exc is not None and visto < 5:
        if isinstance(exc, _FALLOS_GLOBALES):
            return True
        exc = exc.__cause__ or exc.__context__
        visto += 1
    return False


def _plazo_de_lecturas_sueltas() -> float:
    return time.monotonic() + PRESUPUESTO_LECTURAS_SUELTAS_S


def _agotado(limite: float, que: str) -> None:
    if time.monotonic() > limite:
        raise LecturaFallida("Se agoto el tiempo de las lecturas sueltas de %s." % que)


# Codigo propio del aviso de lectura parcial: distinto de MISSING_ASSET (no existe) y de «sin metricas»
# (el dato no esta en la base). `part` dice que no se pudo leer: la raiz del activo, sus metricas o sus posiciones.
AVISO_LECTURA = "READ_FAILED"
# Un cursor que ordena antes que cualquier identificador valido (empiezan por letra, cifra, punto, guion o guion bajo): la pagina
# siguiente arranca en el primer id del resto.
_CURSOR_ANTES_DEL_PRIMERO = "!"
_QUE_NO_SE_LEYO ={"asset": "el activo", "metrics": "las métricas", "holdings": "las posiciones"}


def aviso_de_lectura(part: str, asset_ids) -> dict:
    """Aviso de lectura parcial: que parte no se pudo leer y de que activos. Se arregla reintentando."""
    ids = sorted(str(a) for a in asset_ids)
    return {
        "code": AVISO_LECTURA, "severity": "HIGH" if part == "asset" else "MEDIUM", "part": part,
        "asset_ids": ids,
        "message": "No se pudo leer %s de %s: es un fallo de la base, no que falte el dato. Vuelve a intentarlo."
                   % (_QUE_NO_SE_LEYO.get(part, part), ", ".join(ids)),
    }


def _avisos_de(fallidos: dict) -> list:
    """{part: ids} -> avisos, en el orden de `fallidos`, solo los que tienen algun id."""
    return [aviso_de_lectura(part, ids) for part, ids in fallidos.items() if ids]


def _is_excluded(root: dict) -> bool:
    idents = root.get("identifiers") or {}
    return root.get("asset_id") in EXCLUDED_BENCHMARK_ISINS or idents.get("isin") in EXCLUDED_BENCHMARK_ISINS


def _norm(s) -> str:
    return como_se_busca(s)


def _match_reasons(root: dict, query: str) -> list:
    """Por que responde un activo a lo tecleado; vacio si no responde. La regla es la de `busqueda.py` (decision 81)."""
    palabras = palabras_de_la_busqueda(query)
    if not palabras:
        return ["default_result"]
    ident = root.get("identity") or {}
    idents = root.get("identifiers") or {}
    isin = idents.get("isin") or root.get("asset_id")
    ticker = idents.get("ticker") or idents.get("eodhd_code")
    if not coincide(palabras, ident.get("name"), isin, ticker):
        return []
    campos = [_norm(v) for v in (root.get("asset_id"), ident.get("name"), idents.get("isin"), ticker) if v]
    # Si no esta en ninguno, ha respondido por un nombre habitual.
    return [f"matched:{h}" for h in campos if any(p in h for p in palabras)] or ["matched:nombre_habitual"]


def _asset_roots_map(reader, asset_ids: list[str], fallidos: Optional[set] = None) -> dict:
    """{id: raiz} de los que existen. Un id cuya lectura fallo va a `fallidos`, no a «no existe».

    Si no se pudo leer ninguno, lanza `LecturaFallida`: una respuesta vacia diria que no existen.
    """
    ids = list(dict.fromkeys(str(asset_id).strip() for asset_id in asset_ids if str(asset_id).strip()))
    if not ids:
        return {}
    batch = getattr(reader, "get_assets_many", None)
    if batch:
        try:
            return batch(ids) or {}
        except Exception as exc:  # degrada a lecturas sueltas, con rastro en Cloud Logging (T1)
            if _es_fallo_global(exc):
                raise LecturaFallida("La base no contesta al leer los activos pedidos.") from exc
            swallowed("readmodel/repository.py:_asset_roots_map get_assets_many")
    out, sin_leer = {}, []
    limite = _plazo_de_lecturas_sueltas()
    for asset_id in ids:
        _agotado(limite, "los activos")
        try:
            root = reader.get_asset(asset_id)
        except Exception as exc:
            if _es_fallo_global(exc):
                raise LecturaFallida("La base no contesta al leer los activos pedidos.") from exc
            swallowed_quiet("readmodel/repository.py:_asset_roots_map get_asset")
            sin_leer.append(asset_id)
            continue
        if root is not None:
            out[asset_id] = root
    if sin_leer and len(sin_leer) == len(ids):
        raise LecturaFallida("No se pudo leer ninguno de los %d activos pedidos." % len(ids))
    if fallidos is not None:
        fallidos.update(sin_leer)
    return out


def to_search_result(root: dict, query: str, metrics_latest=None, holdings_doc=None) -> dict:
    d = map_asset_detail(root, metrics_latest, holdings_doc)
    reasons = _match_reasons(root, query)
    product = root.get("product") or {}
    return {
        "asset_id": d["asset_id"],
        "instrument_type": d["instrument_type"],
        "economic_asset_class": d["economic_asset_class"],
        "display_name": d["identity"]["display_name"],
        "isin": d["identity"]["isin"],
        "ticker": d["identity"]["ticker"],
        "provider": product.get("provider"),
        "currency": d["identity"]["currency"],
        "region": d["identity"].get("region"),
        "category": d.get("category"),
        "sector": d["classification"].get("sector"),
        "coverage_status": d["coverage_status"],
        "is_investable": d["is_investable"],
        "role": d["role"],
        "metrics": d["metrics"],
        "has_holdings": d["holdings_summary"].get("has_holdings", False),
        "quality_flags": d["quality_flags"],
        "score": 1 if reasons else 0,
        "match_reasons": reasons,
    }


def _metrics_latest_map(reader, roots: list[dict], fallidos: Optional[set] = None) -> dict:
    """{id: metricas}. Un id cuya lectura fallo va a `fallidos`: sin esto saldria como «sin metricas»."""
    asset_ids = [root.get("asset_id") for root in roots if root.get("asset_id")]
    if not asset_ids:
        return {}
    batch = getattr(reader, "get_metrics_latest_many", None)
    if batch:
        try:
            return batch(asset_ids) or {}
        except Exception as exc:  # sin esto, el activo salia con metrics vacio sin rastro (T1)
            if _es_fallo_global(exc):
                raise LecturaFallida("La base no contesta al leer las metricas.") from exc
            swallowed("readmodel/repository.py:_metrics_latest_map get_metrics_latest_many")
    out = {}
    limite = _plazo_de_lecturas_sueltas()
    for aid in asset_ids:
        _agotado(limite, "las metricas")
        try:
            item = reader.get_metrics_latest(aid)
        except Exception as exc:
            if _es_fallo_global(exc):
                raise LecturaFallida("La base no contesta al leer las metricas.") from exc
            swallowed_quiet("readmodel/repository.py:_metrics_latest_map get_metrics_latest")
            if fallidos is not None:
                fallidos.add(aid)
            continue
        if item is not None:
            out[aid] = item
    return out


def _holdings_summary_for_root(reader, root: dict, fallidos: Optional[set] = None):
    if map_instrument_type(root) in ("STOCK", "INDEX"):
        return None
    summarizer = getattr(reader, "get_holdings_summary", None)
    if not summarizer:
        return None
    try:
        return summarizer(root.get("asset_id"))
    except Exception as exc:
        if _es_fallo_global(exc):
            raise LecturaFallida("La base no contesta al leer las posiciones.") from exc
        swallowed_quiet("readmodel/repository.py:_holdings_summary_for_root")
        if fallidos is not None:
            fallidos.add(root.get("asset_id"))
        return None


def _holdings_summary_map(reader, roots: list[dict], fallidos: Optional[set] = None) -> dict:
    eligible_ids = [
        root.get("asset_id")
        for root in roots
        if root.get("asset_id") and map_instrument_type(root) not in ("STOCK", "INDEX")
    ]
    if not eligible_ids:
        return {}
    batch = getattr(reader, "get_holdings_summaries_many", None)
    if batch:
        try:
            return batch(eligible_ids) or {}
        except Exception as exc:
            if _es_fallo_global(exc):
                raise LecturaFallida("La base no contesta al leer las posiciones.") from exc
            swallowed("readmodel/repository.py:_holdings_summary_map get_holdings_summaries_many")
    limite = _plazo_de_lecturas_sueltas()
    out = {}
    for root in roots:
        if not root.get("asset_id"):
            continue
        _agotado(limite, "las posiciones")
        if (summary := _holdings_summary_for_root(reader, root, fallidos)) is not None:
            out[root["asset_id"]] = summary
    return out


def _index_candidate_ids(index: dict, query: str, allowed: list[str]) -> list[str]:
    """Ids de activos que casan con el filtro de tipo y el texto, en el orden del
    indice (ascendente por id: build_search_index_document ordena al construirlo).
    El texto se mira en el nombre, el ticker, el id y los nombres habituales, palabra
    por palabra (decision 81): la misma regla que el Buscador."""
    palabras = palabras_de_la_busqueda(query)
    out: list[str] = []
    for entry in index.get("entries") or []:
        if entry.get("type") not in allowed:
            continue
        asset_id = str(entry.get("id") or "").strip()
        if not coincide(palabras, entry.get("name_folded") or entry.get("name"), asset_id, entry.get("ticker")):
            continue
        if asset_id and asset_id not in EXCLUDED_BENCHMARK_ISINS:
            out.append(asset_id)
    return out


def _index_exact_ids(index: dict, query: str, candidates: list[str]) -> list[str]:
    """De los candidatos, los que responden exactamente: su simbolo, su ISIN o su nombre habitual."""
    en_la_lista = set(candidates)
    return [
        str(entry.get("id") or "").strip()
        for entry in index.get("entries") or []
        if str(entry.get("id") or "").strip() in en_la_lista
        and es_respuesta_exacta(query, str(entry.get("id") or "").strip(), entry.get("ticker"))
    ]


def _enrich_search_results(reader, matched: list[dict], query: str, fallidos: Optional[dict] = None) -> list:
    """Solo para los resultados finales, lee metrics/latest normalizado. Si falta,
    el mapper conserva el fallback temporal marcado al root de fondos. Lo que no se pudo
    leer va a `fallidos` ({"metrics": set, "holdings": set})."""
    fallidos = fallidos if fallidos is not None else {}
    out = []
    metrics_by_id = _metrics_latest_map(reader, matched, fallidos.setdefault("metrics", set()))
    holdings_by_id = _holdings_summary_map(reader, matched, fallidos.setdefault("holdings", set()))
    for root in matched:
        ml = metrics_by_id.get(root.get("asset_id"))
        hs = holdings_by_id.get(root.get("asset_id"))
        out.append(to_search_result(root, query, ml, hs))
    return out


def search_assets_page(reader, query: str = "", types=None, limit: int = 20,
                       cursor: Optional[str] = None) -> dict:
    """Busqueda paginada sobre el indice (auditoria 27-07, D1+DV5).

    - CON indice (camino normal): el indice decide los candidatos — tambien con
      query VACIA, que antes barria la coleccion por tipo (~1 lectura por activo
      del universo en cada apertura del Buscador). Solo se leen los roots de la
      pagina pedida. Devuelve el total real y un cursor para seguir.
    - SIN indice (degradado): barrido como antes; el total es desconocido (None)
      y no hay cursor.
    El cursor es el ultimo asset_id servido: si el indice se regenera entre
    paginas, se recoloca por orden lexicografico (los candidatos van ordenados).
    Lo que responde exactamente a lo tecleado va delante en la primera pagina y no se
    repite en las siguientes, que siguen por id: «SAN» trae antes Santander y Sanofi.
    Si no se puede leer el indice ni los activos, lanza `LecturaFallida`: un fallo no es «no hay
    resultados». Si fallan solo las metricas o las posiciones de algunos, la pagina sale y
    `read_warnings` dice cuales (hallazgo 19). Un indice que no se lee no cae al barrido: si la
    base no contesta, barrer el catalogo entero solo la cargaria mas.
    """
    allowed = [t.upper() for t in (types or ["FUND", "ETF", "STOCK", "INDEX"])]
    getter = getattr(reader, "get_search_index", None)
    try:
        index = getter() if getter else None
    except Exception as exc:
        swallowed("readmodel/repository.py:search_assets_page get_search_index")
        raise LecturaFallida("No se pudo leer el indice del buscador.") from exc
    fallidos = {"asset": set(), "metrics": set(), "holdings": set()}
    if index:
        print("[readmodel] search_index hit")
        candidates = _index_candidate_ids(index, query, allowed)
        total = len(candidates)
        tamano = max(int(limit), 1)
        exactos = _index_exact_ids(index, query, candidates)
        # P2-07: una respuesta exacta va la primera aunque la pagina sea de uno (antes `< tamano` la descartaba: «SAN» con limit=1
        # no traia Santander). Si hay mas exactas que sitio, ninguna se adelanta y todas siguen por id (decision 81).
        if not 0 < len(exactos) <= tamano:
            exactos = []
        resto = [asset_id for asset_id in candidates if asset_id not in exactos]
        wanted = str(cursor or "").strip()
        # bisect es valido porque el resto conserva el orden por id.
        start = bisect.bisect_right(resto, wanted) if wanted else 0
        page_ids = resto[start:start + tamano - (0 if wanted else len(exactos))]
        has_more = (start + len(page_ids)) < len(resto)
        # Si las exactas llenan la pagina no hay ultimo id del resto: el cursor ha de dejar la siguiente en su primer id.
        next_cursor = (page_ids[-1] if page_ids else _CURSOR_ANTES_DEL_PRIMERO) if has_more else None
        if not wanted:
            page_ids = exactos + page_ids
        roots_by_id = _asset_roots_map(reader, page_ids, fallidos["asset"])
        matched = []
        for asset_id in page_ids:
            root = roots_by_id.get(asset_id)
            if root and not _is_excluded(root):
                matched.append(root)
        results = _enrich_search_results(reader, matched, query, fallidos)
        return {
            "results": results,
            "total_matches": total,
            "next_cursor": next_cursor,
            "read_warnings": _avisos_de(fallidos),
        }

    print("[readmodel] search_index missing; fallback to asset scan")
    nq = palabras_de_la_busqueda(query)
    # Firestore no tiene busqueda full-text: el match por nombre/ISIN se hace en memoria.
    # Con texto de busqueda hay que barrer TODO el universo del tipo, no una ventana corta;
    # si no, los activos cuyo ISIN ordena mas tarde (p.ej. muchos LU..., como los JP Morgan)
    # nunca se cargan y "no se encuentran" aunque esten en la maestra.
    fetch_limit = 5000 if nq else max(limit * 4, limit)
    try:
        roots = reader.list_assets(allowed, fetch_limit)
    except Exception as exc:
        swallowed("readmodel/repository.py:search_assets_page list_assets")
        raise LecturaFallida("No se pudo leer el catalogo de activos.") from exc
    matched = []
    for root in roots:
        if _is_excluded(root):
            continue  # fondos base de benchmarks: no seleccionables por el cliente
        if nq and not _match_reasons(root, query):
            continue
        matched.append(root)
        if len(matched) >= limit:
            break
    results = _enrich_search_results(reader, matched, query, fallidos)
    return {
        "results": results,
        "total_matches": None,
        "next_cursor": None,
        "read_warnings": _avisos_de(fallidos),
    }


def search_assets(reader, query: str = "", types=None, limit: int = 20) -> list:
    """Compatibilidad: primera pagina sin metadatos de paginacion."""
    return search_assets_page(reader, query, types, limit)["results"]


def get_asset_detail(reader, asset_id: str, with_holdings: bool = True) -> Optional[dict]:
    # 01-10-2026: un ISIN sustituido (fusion) resuelve al sucesor; la ficha devuelta es la
    # del sucesor y lleva `resolved_from` para que la pantalla pueda decirlo.
    # 15-11-2026 (hallazgo 19): si la raiz no se lee, `LecturaFallida`; si no se leen las metricas o
    # las posiciones, la ficha sale y `read_warnings` lo dice, en vez de enseñarla «sin metricas».
    requested = asset_id
    asset_id = canonical_asset_id(asset_id)
    root = _leer_o_fallar(reader.get_asset, asset_id, "la ficha del activo")
    if not root:
        return None
    fallidos = {"metrics": set(), "holdings": set()}
    # Los holdings/latest pueden ser documentos grandes; en vistas multi-activo
    # (comparar/resolver) NO se leen para no agotar memoria. Solo en la ficha individual.
    if with_holdings:
        try:
            holdings = reader.get_holdings(asset_id)
        except Exception:
            swallowed("readmodel/repository.py:get_asset_detail get_holdings")
            fallidos["holdings"].add(asset_id)
            holdings = None
    else:
        # El dato necesario (presencia + resumen de holdings) DEBE estar siempre: se carga
        # una version BARATA (mascara de campos, sin el array grande) para no agotar memoria.
        holdings = _holdings_summary_for_root(reader, root, fallidos["holdings"])
    try:
        metrics = reader.get_metrics_latest(asset_id)
    except Exception:
        swallowed("readmodel/repository.py:get_asset_detail get_metrics_latest")
        fallidos["metrics"].add(asset_id)
        metrics = None
    detail = map_asset_detail(root, metrics, holdings)
    if asset_id != str(requested).strip() and isinstance(detail, dict):
        detail["resolved_from"] = requested
    if isinstance(detail, dict) and _avisos_de(fallidos):
        detail["read_warnings"] = _avisos_de(fallidos)
    return detail


def _leer_o_fallar(lectura, asset_id: str, que: str):
    """Una lectura de la que depende toda la respuesta: si falla, `LecturaFallida`, nunca «no existe»."""
    try:
        return lectura(asset_id)
    except Exception as exc:
        swallowed("readmodel/repository.py:_leer_o_fallar %s" % que)
        raise LecturaFallida("No se pudo leer %s %s." % (que, asset_id)) from exc


def _with_resolved_from(doc: Optional[dict], requested: str, canonical: str) -> Optional[dict]:
    """Ronda 2 (14-10-2026): un ISIN sustituido devuelve la cartera del sucesor con
    `resolved_from` = id pedido, como `get_asset_detail`, para que el cliente acepte que
    el `asset_id` del documento sea otro sin confundirlo con un cruce de respuestas."""
    if doc is None or not requested or requested == canonical:
        return doc
    return {**doc, "resolved_from": requested}


def get_asset_holdings(reader, asset_id: str) -> Optional[dict]:
    requested = str(asset_id or "").strip()
    asset_id = canonical_asset_id(asset_id)
    # Las posiciones son toda la respuesta: si no se leen, es un fallo y no «sin posiciones».
    root = _leer_o_fallar(reader.get_asset, asset_id, "el activo")
    if not root:
        return None
    holdings = _leer_o_fallar(reader.get_holdings, asset_id, "las posiciones del activo")
    if not holdings:
        return None
    data = holdings.get("data") if isinstance(holdings, dict) and "data" in holdings else holdings
    if not isinstance(data, dict):
        return None
    out = dict(data)
    out.setdefault("asset_id", asset_id)
    return _with_resolved_from(json_safe(out), requested, asset_id)


def _unwrap_holdings_doc(asset_id: str, holdings) -> Optional[dict]:
    if not holdings:
        return None
    data = holdings.get("data") if isinstance(holdings, dict) and "data" in holdings else holdings
    if not isinstance(data, dict):
        return None
    out = dict(data)
    out.setdefault("asset_id", asset_id)
    return json_safe(out)


def get_asset_holdings_many(reader, asset_ids, avisos: Optional[list] = None) -> dict:
    """Holdings de varios activos en una llamada (ola 3b).

    El X-Ray lanzaba n `get_asset_holdings` simultaneas y el abanico provocaba
    cola y arranques en frio (~7 s hasta pantalla utilizable, medido 11-08).
    Devuelve {asset_id: holdings|None} para TODOS los ids pedidos; usa el
    lector batch si existe y degrada a lecturas sueltas si falla (patron
    _asset_roots_map).

    14-10-2026 (CRIT-02): un ISIN sustituido (fusion) se resuelve al sucesor, como en
    `get_asset_holdings`, pero la clave de la respuesta sigue siendo el id PEDIDO para que
    el llamador case cada resultado con lo que pidio. El documento lleva el id vigente.

    15-11-2026 (hallazgo 19): un activo cuyas posiciones no se pudieron leer sigue saliendo como None,
    pero `avisos` recibe un `READ_FAILED` con los ids PEDIDOS; si no se pudo leer ninguno, `LecturaFallida`.
    """
    requested_ids = list(dict.fromkeys(str(aid).strip() for aid in (asset_ids or [])[:100] if str(aid).strip()))
    # Un id sin forma de identificador no se lee: sale como None, igual que uno que no existe (hallazgo 21).
    canonical_by_requested = {rid: canonical_asset_id(rid) for rid in requested_ids if _valid_asset_id(rid)}
    canonical_ids = list(dict.fromkeys(canonical_by_requested.values()))
    fallidos = {"asset": set(), "holdings": set()}
    roots_by_id = _asset_roots_map(reader, canonical_ids, fallidos["asset"])
    known_ids = [asset_id for asset_id in canonical_ids if asset_id in roots_by_id]

    holdings_by_id = None
    batch = getattr(reader, "get_holdings_many", None)
    if batch and known_ids:
        try:
            holdings_by_id = batch(known_ids) or {}
        except Exception:  # degrada a lecturas sueltas, con rastro en Cloud Logging (T1)
            swallowed("readmodel/repository.py:get_asset_holdings_many get_holdings_many")
            holdings_by_id = None

    by_canonical = {}
    for asset_id in known_ids:
        if holdings_by_id is not None:
            raw = holdings_by_id.get(asset_id)
        else:
            try:
                raw = reader.get_holdings(asset_id)
            except Exception:
                swallowed_quiet("readmodel/repository.py:get_asset_holdings_many get_holdings")
                fallidos["holdings"].add(asset_id)
                raw = None
        by_canonical[asset_id] = _unwrap_holdings_doc(asset_id, raw)
    if known_ids and len(fallidos["holdings"]) == len(known_ids):
        raise LecturaFallida("No se pudieron leer las posiciones de ninguno de los %d activos." % len(known_ids))
    if avisos is not None:
        pedidos = {part: {rid for rid, cid in canonical_by_requested.items() if cid in ids}
                   for part, ids in fallidos.items()}
        avisos.extend(_avisos_de(pedidos))
    return {
        rid: (_with_resolved_from(by_canonical.get(canonical_by_requested[rid]), rid, canonical_by_requested[rid])
              if rid in canonical_by_requested else None)
        for rid in requested_ids
    }


def compare_assets_page(reader, asset_ids) -> dict:
    """La comparacion con lo que antes callaba (hallazgo 19), todo aditivo:

    - `assets`: las filas, como siempre. Una fila de un ISIN sustituido lleva `resolved_from` con el id
      pedido, como `get_asset_detail`.
    - `missing_asset_ids`: los ids pedidos que no existen en la base, en el orden en que se pidieron.
    - `read_warnings`: lo que no se pudo leer (`READ_FAILED`), que no es lo mismo que no existir. Un id
      cuya raiz no se pudo leer no va a `missing_asset_ids`. Si no se pudo leer ninguno, `LecturaFallida`.
    - `invalid_asset_ids`: los pedidos sin forma de identificador (p. ej. «BRK/B»). No se leen (hallazgo 21)
      y van tambien a `missing_asset_ids`: para la base no existen. No rechazan la peticion.
    """
    requested_raw = list(dict.fromkeys(str(aid).strip() for aid in (asset_ids or [])[:100] if str(aid).strip()))
    invalid = [rid for rid in requested_raw if not _valid_asset_id(rid)]
    requested_by_canonical = {}
    for rid in requested_raw:
        if _valid_asset_id(rid):
            requested_by_canonical.setdefault(canonical_asset_id(rid), rid)
    requested_ids = list(requested_by_canonical)
    fallidos = {"asset": set(), "metrics": set(), "holdings": set()}
    roots_by_id = _asset_roots_map(reader, requested_ids, fallidos["asset"])
    roots = [roots_by_id[asset_id] for asset_id in requested_ids if asset_id in roots_by_id]
    metrics_by_id = _metrics_latest_map(reader, roots, fallidos["metrics"])
    holdings_by_id = _holdings_summary_map(reader, roots, fallidos["holdings"])
    rows = []
    for asset_id in requested_ids:
        root = roots_by_id.get(asset_id)
        if root is None:
            continue
        row = map_asset_detail(root, metrics_by_id.get(root.get("asset_id")), holdings_by_id.get(root.get("asset_id")))
        pedido = requested_by_canonical[asset_id]
        if pedido != asset_id and isinstance(row, dict):
            row["resolved_from"] = pedido
        rows.append(row)
    no_estan = {requested_by_canonical[asset_id] for asset_id in requested_ids
                if asset_id not in roots_by_id and asset_id not in fallidos["asset"]}
    missing = [rid for rid in requested_raw if rid in no_estan or rid in invalid]
    pedidos = {part: {requested_by_canonical.get(a, a) for a in ids} for part, ids in fallidos.items()}
    return {"assets": rows, "missing_asset_ids": missing, "invalid_asset_ids": invalid,
            "read_warnings": _avisos_de(pedidos)}


def compare_assets(reader, asset_ids) -> list:
    """Compatibilidad: solo las filas."""
    return compare_assets_page(reader, asset_ids)["assets"]


def _id_con_forma(asset_id) -> bool:
    return isinstance(asset_id, str) and _valid_asset_id(asset_id.strip())


def resolve_portfolio(reader, positions) -> dict:
    roots_by_id, warnings = {}, []
    # 01-10-2026: los ISIN sustituidos (fusiones) se resuelven al sucesor. La fila sale con
    # el asset_id vigente y `requested_asset_id` con el que pidio el cliente, para que la
    # pantalla pueda casar la respuesta con la linea del extracto.
    # 15-11-2026 (hallazgo 21): un `asset_id` sin forma de identificador (p. ej. «BRK/B», que Posiciones acepta)
    # no se lee de la base; su fila sale como MISSING_ASSET con `reason: INVALID_ID`, y el resto se resuelve.
    canonical = {str(p.get("asset_id")): canonical_asset_id(p.get("asset_id"))
                 for p in positions or [] if p.get("asset_id") and _id_con_forma(p.get("asset_id"))}
    requested_ids = list(dict.fromkeys(canonical.values()))
    # 15-11-2026 (hallazgo 19): si no se pudo leer ninguna raiz, `LecturaFallida`, y no «activo no
    # encontrado» para toda la cartera. Una raiz que no se pudo leer da `READ_FAILED` y no MISSING_ASSET.
    sin_leer = set()
    loaded_roots = _asset_roots_map(reader, requested_ids, sin_leer)
    for p in positions or []:
        aid = p.get("asset_id")
        cid = canonical.get(str(aid))
        root = loaded_roots.get(cid)
        if not root:
            if cid in sin_leer:
                warnings.append({**aviso_de_lectura("asset", [aid]), "asset_id": aid})
            elif aid and not _id_con_forma(aid):
                warnings.append({"code": "MISSING_ASSET", "severity": "HIGH", "asset_id": aid,
                                 "reason": "INVALID_ID",
                                 "message": "Asset not found: el identificador no tiene forma valida "
                                            "(letras, numeros, punto, guion y guion bajo, hasta 128)."})
            else:
                warnings.append({"code": "MISSING_ASSET", "severity": "HIGH",
                                 "asset_id": aid, "message": "Asset not found."})
            continue
        roots_by_id[cid] = root
        if cid != str(aid).strip():  # P3-05: los espacios de los bordes no son una sustitucion
            warnings.append({"code": "ALIAS_RESOLVED", "severity": "LOW", "asset_id": aid,
                             "resolved_to": cid,
                             "message": "Identificador sustituido: resuelto al activo sucesor %s." % cid})
    fallidos = {"metrics": set(), "holdings": set()}
    metrics_by_id = _metrics_latest_map(reader, list(roots_by_id.values()), fallidos["metrics"])
    holdings_by_id = _holdings_summary_map(reader, list(roots_by_id.values()), fallidos["holdings"])
    for p in positions or []:
        aid = p.get("asset_id")
        cid = canonical.get(str(aid))
        for part, ids in fallidos.items():
            if cid in ids:
                warnings.append({**aviso_de_lectura(part, [aid]), "asset_id": aid})
    rows = []
    for p in positions or []:
        aid = p.get("asset_id")
        cid = canonical.get(str(aid))
        root = roots_by_id.get(cid)
        if not root:
            continue
        d = map_asset_detail(root, metrics_by_id.get(cid), holdings_by_id.get(cid))
        rows.append({
            "asset_id": d["asset_id"], "requested_asset_id": aid, "weight": p.get("weight"),
            "display_name": d["identity"]["display_name"],
            "instrument_type": d["instrument_type"],
            "is_investable": d["is_investable"], "role": d["role"],
            "economic_asset_class": d["economic_asset_class"],
            "coverage_status": d["coverage_status"],
            "metrics": d["metrics"], "pms_exposure": d["pms_exposure"],
            "costs": d["costs"],
            "currency": d["identity"]["currency"],
            "region": d["identity"].get("region"),
            "category": d.get("category"),
            "sector": d["classification"].get("sector"),
            "quality_flags": d["quality_flags"],
        })
    return {"rows": rows, "warnings": warnings, "positions": positions or []}
