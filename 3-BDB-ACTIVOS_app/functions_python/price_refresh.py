# -*- coding: utf-8 -*-
"""
Refresco diario de price_series desde EODHD con revision de ajustes historicos.

Pensado para una funcion PROGRAMADA (Cloud Scheduler). Para cada activo:
  - lee su doc de price_series mas reciente (1 lectura, order_by last_date desc),
  - saca el simbolo EODHD de la serie o del ultimo VL EODHD publicado en el root,
  - contrasta los precios solapados, incluso sin fechas nuevas; si se revisaron,
    reconstruye todos los documentos del activo y recalcula sus metricas.
  - si no hay revisiones, normaliza a EUR y fusiona los puntos nuevos.
  - para FUND actualiza tambien, y solo si no hay un VL vivo mas reciente,
    `performance.valuation` con el NAV nativo de EODHD.
El backend (optimization/repository.py) concatena TODOS los docs de price_series y
deduplica por fecha. Una revision se aplica de forma atomica sobre TODOS los
documentos afectados; una respuesta incompleta no reemplaza el historico.

Escribe en la BBDD MAESTRA, la que diga `master_project`. El service account de las
Cloud Functions necesita rol roles/datastore.user SOBRE ese proyecto (hoy solo tiene
datastore.viewer). El token EODHD se inyecta como secreto EODHD_API_KEY.

Se puede probar en local desde functions_python/:
    python -c "import price_refresh as r; print(r.refresh_stale_prices(limit=10))"
"""
import os
import json
import time
import bisect
import re
import urllib.parse
import urllib.request
import urllib.error
import logging

import clock
import fx_currency
from quietlog import swallowed, swallowed_quiet
from datetime import date, datetime, timezone, timedelta

_LOG = logging.getLogger("bdb.price_refresh")

from google.cloud import firestore as gcf
from google.cloud.firestore_v1.field_path import FieldPath

from contract_validation import validate_contract
from write_governance import (
    log_master_write_decision,
    master_writes_enabled,
    require_master_writes_enabled,
)

EODHD_BASE_URL = "https://eodhistoricaldata.com/api"
PRICE_SERIES_SCHEMA = "asset-price-series.v1.2"
OVERLAP_DAYS = 7
PRICE_SCHEDULER_WRITE_ENV = "PRICES_WRITE_ENABLED"
DEFAULT_MAX_READS = int(os.environ.get("PRICE_REFRESH_MAX_READS", os.environ.get("BDB_REFRESH_MAX_READS", "3600")))
CHECKPOINT_EVERY = max(10, int(os.environ.get("PRICE_REFRESH_CHECKPOINT_EVERY", "50")))
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


class ReadBudgetExceeded(RuntimeError):
    pass


class TransientProviderError(RuntimeError):
    """Fallo de red, cuota o disponibilidad del proveedor (EODHD).

    B-05 (auditoria 29-09): se lanza en el punto de la peticion para que los
    consumidores distingan «el proveedor no respondio» (reintentar en el
    proximo ciclo, sin tocar el estado del activo) de «los datos recibidos son
    inconsistentes» (HistoryRepairRequired, que si bloquea el historico).
    """


class ReadBudget:
    def __init__(self, max_reads: int = 0):
        self.max_reads = int(max_reads or 0)
        self.reads = 0

    def add(self, count: int = 1, context: str = ""):
        count = max(0, int(count))
        if self.max_reads and self.reads + count > self.max_reads:
            msg = "READ_BUDGET_EXCEEDED price_refresh reads=%d max=%d context=%s" % (
                self.reads, self.max_reads, context
            )
            print("ERROR", msg)
            raise ReadBudgetExceeded(msg)
        self.reads += count

    def remaining(self) -> int | None:
        return None if not self.max_reads else max(0, self.max_reads - self.reads)


def price_scheduler_writes_enabled() -> bool:
    return os.environ.get(PRICE_SCHEDULER_WRITE_ENV, "").lower() in ("1", "true", "yes", "on")


def require_price_scheduler_writes_enabled(operation: str) -> None:
    if not price_scheduler_writes_enabled():
        log_master_write_decision(operation, enabled=False, dry_run=False, price_scheduler_gate=False)
        raise RuntimeError(
            "PRICES_WRITES_DISABLED: Set %s=true server-side only after explicit approval."
            % PRICE_SCHEDULER_WRITE_ENV
        )
    log_master_write_decision(operation, enabled=True, dry_run=False, price_scheduler_gate=True)


def _today() -> str:
    # BAJA-02 (16-10-2026): dia de Madrid, no el de UTC del contenedor.
    return clock.madrid_today().isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _api_key() -> str:
    key = os.environ.get("EODHD_API_KEY")
    if not key:
        raise RuntimeError("EODHD_API_KEY no configurada (secreto de la funcion).")
    return key


# Auditoría 11-08 (T6f): reintentos con backoff ante fallos transitorios de EODHD.
_EODHD_RETRY_ATTEMPTS = 3
_EODHD_RETRY_WAITS_S = (1, 4)  # espera antes del 2.º y del 3.er intento


def _eodhd_get(path: str, **params):
    params["api_token"] = _api_key()
    params["fmt"] = "json"
    url = "%s/%s?%s" % (EODHD_BASE_URL, path, urllib.parse.urlencode(params))
    # Auditoría 11-08 (T6f): 3 intentos con backoff (1s/4s) solo para 5xx, 429
    # (cuota) y errores de red; un 4xx (token inválido, símbolo inexistente) no
    # se reintenta porque repetir la petición nunca cambia el resultado.
    # B-05 (29-09): agotados los reintentos, el fallo sale como
    # TransientProviderError, nunca como una inconsistencia de datos.
    last_error = None
    data = None
    for attempt in range(_EODHD_RETRY_ATTEMPTS):
        if attempt:
            time.sleep(_EODHD_RETRY_WAITS_S[attempt - 1])
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            message = "EODHD HTTP %s for %s: %s" % (exc.code, path, body[:200])
            if exc.code < 500 and exc.code != 429:
                raise RuntimeError(message) from exc
            last_error = TransientProviderError(message)
            last_error.__cause__ = exc
        except (OSError, TimeoutError) as exc:  # URLError, timeout, reset: transitorios de red
            last_error = TransientProviderError("EODHD network error for %s: %s" % (path, exc))
            last_error.__cause__ = exc
    else:
        raise last_error
    parsed = json.loads(data)
    if isinstance(parsed, dict) and ("Error Message" in parsed or "message" in parsed):
        raise RuntimeError("EODHD error for %s: %s" % (path, parsed))
    return parsed


def fetch_eod(symbol: str, from_date: str, to_date: str):
    res = _eodhd_get("eod/%s" % urllib.parse.quote(symbol), **{"from": from_date, "to": to_date})
    if not isinstance(res, list):
        return []
    return sorted((r for r in res if isinstance(r, dict) and r.get("date")), key=lambda r: r["date"])


def _point_value(row):
    raw = row.get("adjusted_close", row.get("close"))
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _round(v):
    return round(v, 6)


def _fx_pair(ccy):
    return "EUR%s.FOREX" % ccy


_MINOR_CURRENCY = fx_currency.SUBUNIDADES


def _major_currency(ccy):
    if not ccy:
        return "EUR", 1.0
    return fx_currency.divisa_mayor(ccy)


def _fetch_fx(ccy, from_date, to_date):
    rows = fetch_eod(_fx_pair(ccy), from_date, to_date)
    dates, rates = [], []
    for r in rows:
        v = _point_value(r)
        if v is None:
            continue
        dates.append(str(r["date"]))
        rates.append(v)
    if not rates:
        # Una serie FX vacia para un rango con precios es una respuesta fallida
        # del proveedor, no una inconsistencia verificada de nuestros datos:
        # se reintenta en el proximo ciclo (B-05).
        raise TransientProviderError("sin FX para %s" % _fx_pair(ccy))
    return dates, rates


def _fx_for(day, dates, rates):
    i = bisect.bisect_right(dates, day) - 1
    if i < 0:
        raise RuntimeError("sin FX previo para %s" % day)
    return rates[i]


def _convert_eur(rows, ccy, fx_cache, from_date, to_date):
    ccy = (ccy or "EUR").upper()
    if ccy == "EUR":
        out = []
        for r in rows:
            v = _point_value(r)
            if v is None:
                continue
            out.append({"date": str(r["date"]), "value": _round(v)})
        return out, {"source_currency": "EUR"}
    major_ccy, scale = _major_currency(ccy)
    # La cache FX se comparte entre activos con ventanas DISTINTAS (cada uno trae su
    # from_date segun su last_date). Si se poblo con la ventana de un activo al dia,
    # un activo rezagado recibia una serie que no cubria su rango y TODOS sus puntos
    # se descartaban en silencio (quedaba congelado para siempre). Se guarda la
    # ventana pedida bajo una clave aparte y se reamplia la serie si el nuevo
    # from_date es anterior. Las caches pre-pobladas por backfill/ingesta (ventana
    # constante 1990) no llevan clave de ventana y no se refetchean nunca.
    window_key = ("__fx_from__", major_ccy)
    cached_from = fx_cache.get(window_key)
    if major_ccy not in fx_cache or (
        isinstance(cached_from, str) and from_date < cached_from
    ):
        fx_cache[major_ccy] = _fetch_fx(major_ccy, from_date, to_date)
        fx_cache[window_key] = from_date
    fx_dates, fx_rates = fx_cache[major_ccy]
    out = []
    for r in rows:
        nv = _point_value(r)
        if nv is None:
            continue
        try:
            rate = _fx_for(str(r["date"]), fx_dates, fx_rates)
        except RuntimeError:
            continue
        # source_currency y fx_pair son constantes de la serie: van en el documento
        # (segundo valor devuelto), no repetidos en cada punto.
        out.append({"date": str(r["date"]), "value": _round((nv * scale) / rate),
                    "source_value": _round(nv), "fx_rate": _round(rate)})
    return out, {"source_currency": ccy, "fx_pair": _fx_pair(major_ccy), "minor_scale": scale,
                 "fx_policy": "price_EUR = (price_source * scale) / EURMAJOR.FOREX"}


def _group_by_year(points):
    g = {}
    for p in points:
        g.setdefault(int(str(p["date"])[:4]), []).append(p)
    return dict(sorted(g.items()))


def _series_type(asset_type):
    return "NAV" if str(asset_type).upper() == "FUND" else "ADJUSTED_CLOSE"


def _refresh_doc_id(symbol, year):
    safe = symbol.replace(":", "_").replace("/", "_")
    return "EODHD_%s_REFRESH_%d" % (safe, year)


def _iso_date(value):
    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except (TypeError, ValueError):
        return None


# Auditoria de divisas (06-09-2026). La divisa la decidia el METADATO —el
# `source_currency` del documento anterior, o el `vl_divisa` de la ficha— y no la
# cotizacion. Con eso, cinco ETF de Xetra que ya cotizan en euros se dividian otra vez
# por EUR/USD (precios un 14 % bajos desde 2023) y un ETF de Amsterdam que cotiza en
# dolares se guardaba sin convertir (un 15 % altos). La divisa la manda ahora el
# listado del proveedor; el metadato solo sirve para avisar de la discrepancia.
_LISTING_CURRENCY_CACHE = {}
# 14-10-2026 (ALTA-03): los fallos del proveedor (red, 5xx, cuota) NO se guardan en la
# cache de arriba —que dura lo que la instancia— porque «no respondio» no es «no tiene
# divisa». Se recuerdan solo unos minutos para no repetir en bucle la misma consulta
# caida dentro de una pasada; despues se vuelve a preguntar.
_LISTING_CURRENCY_FAILURES = {}
LISTING_CURRENCY_FAILURE_TTL_S = 300


def clear_listing_currency_cache():
    _LISTING_CURRENCY_CACHE.clear()
    _LISTING_CURRENCY_FAILURES.clear()

# La REGLA vive en fx_currency.py y la comparten el productor y el verificador
# (scripts/verify_price_currency.py). Tenerla duplicada fue el fallo de la segunda
# vuelta: se corrigio aqui y el verificador siguio aceptando «NA» como divisa.
_DIVISAS_NO_VALIDAS = fx_currency.DIVISAS_NO_VALIDAS
_es_divisa_valida = fx_currency.es_divisa_valida


def _eodhd_json_para_divisas(path, params):
    """Lector HTTP que fx_currency inyecta: mismas reintentos y cuota que el resto."""
    return _eodhd_get(urllib.parse.quote(path, safe="/"), **(params or {}))


def listing_currency(symbol):
    """Divisa en la que cotiza el listado, segun el proveedor. None si no se resuelve."""
    if not symbol:
        return None
    key = symbol.upper()
    if key in _LISTING_CURRENCY_CACHE:
        return _LISTING_CURRENCY_CACHE[key]
    failed_at = _LISTING_CURRENCY_FAILURES.get(key)
    if failed_at is not None and time.monotonic() - failed_at < LISTING_CURRENCY_FAILURE_TTL_S:
        return None
    try:
        divisa, motivo = fx_currency.resolve_listing_currency(
            symbol,
            _eodhd_json_para_divisas,
            on_note=lambda texto: _LOG.info("price_refresh: %s", texto),
        )
    except Exception:  # noqa: BLE001 - sin divisa no se escribe; queda el aviso
        swallowed("price_refresh.listing_currency:%s" % symbol)
        divisa, motivo = None, fx_currency.PROVEEDOR_NO_DISPONIBLE
    if not divisa:
        _LOG.warning("price_refresh: sin divisa utilizable para %s (%s)", symbol, motivo)
    if divisa or motivo != fx_currency.PROVEEDOR_NO_DISPONIBLE:
        _LISTING_CURRENCY_CACHE[key] = divisa
        _LISTING_CURRENCY_FAILURES.pop(key, None)
    else:
        _LISTING_CURRENCY_FAILURES[key] = time.monotonic()
    return divisa


def _currency_from_search(symbol):
    """Respaldo de fundamentales: se conserva por compatibilidad con las pruebas."""
    return fx_currency.divisa_de_busqueda(symbol, _eodhd_json_para_divisas)


def _symbol_and_currency(series_doc, root_doc, resolve=True):
    """Simbolo del listado y divisa REAL de esa cotizacion.

    Devuelve `(symbol, currency)`; `currency` es None cuando el proveedor no la da, y
    en ese caso el activo NO se escribe: es preferible saltarlo con diagnostico a
    convertir —o dejar de convertir— por un metadato que ya sabemos que miente.

    Con `resolve=False` no se consulta al proveedor y se devuelve la divisa del metadato:
    es lo que usa la vista previa, que no escribe nada y no debe gastar llamadas.
    """
    sid = series_doc.get("source_listing_id") or series_doc.get("source_price_id") or ""
    # A reviewed provider-specific series must not silently fall back to the
    # root's older EODHD quote: that can splice/rebuild from a different source.
    # NAV:<isin> is the legacy generic identifier and retains its fallback.
    if ":" in sid and not sid.startswith(("EODHD:", "NAV:")):
        return None, None
    sym = sid.removeprefix("EODHD:") if sid.startswith("EODHD:") else None
    ccy_meta = (series_doc.get("source_currency") or "").upper() or None
    if not sym:
        valuation = ((root_doc.get("performance") or {}).get("valuation") or {})
        root_sid = valuation.get("vl_source_listing_id") or valuation.get("source_listing_id") or ""
        sym = root_sid.removeprefix("EODHD:") if root_sid.startswith("EODHD:") else None
        ccy_meta = ccy_meta or (valuation.get("vl_divisa") or valuation.get("currency") or "").upper() or None
    if not sym:
        return None, None
    if not resolve:
        return sym, ccy_meta
    ccy_listado = listing_currency(sym)
    if ccy_listado and ccy_meta and ccy_listado != ccy_meta:
        # La discrepancia es el sintoma del fallo: queda registrada, no se silencia.
        _LOG.warning(
            "price_refresh: divisa discrepante en %s — metadato %s, listado %s (manda el listado)",
            sym, ccy_meta, ccy_listado,
        )
    return sym, ccy_listado


def _fund_nav_update(asset_type, point, source_currency, symbol, fetched_at, current=None):
    """Payload root puro: EODHD solo puede escribir el VL de FUND."""
    if str(asset_type or "").upper() != "FUND" or not isinstance(point, dict):
        return None
    nav_date = _iso_date(point.get("date"))
    if not nav_date or not symbol:
        return None
    native_value = point.get("source_value", point.get("value"))
    try:
        native_value = float(native_value)
    except (TypeError, ValueError):
        return None
    if native_value <= 0:
        return None
    current = current if isinstance(current, dict) else {}
    current_date = _iso_date(current.get("vl_fecha") or current.get("date"))
    if current_date and current_date > nav_date:
        return None
    payload = {
        "vl": _round(native_value),
        "vl_fecha": nav_date,
        "vl_divisa": str(source_currency or "EUR").upper(),
        "vl_fuente": "eodhd",
        "vl_source_listing_id": "EODHD:%s" % symbol,
        "vl_fetched_at": fetched_at,
    }
    if current_date == nav_date and all(current.get(key) == value for key, value in payload.items()):
        return None
    return payload


def _master_db():
    # MEDIA-7 (14-10-2026): un cliente por proceso en vez de uno por llamada; mismas
    # credenciales (las del service account del runtime).
    from master_write_client import get_master_write_db
    return get_master_write_db()


def _is_active_canonical_asset(asset_id, data):
    if not ISIN_RE.match(str(asset_id or "").upper()):
        return False
    quality = data.get("quality") if isinstance(data, dict) else None
    if isinstance(quality, dict) and quality.get("status") == "ARCHIVED_LEGACY":
        return False
    return True


def _repair_changed_history(db, ref, latest, root, root_update_time, asset_id,
                            asset_type, symbol, currency, rows, today, fx_cache,
                            write, budget=None):
    from price_history_sync import (
        revision_detected, adjustment_problem, prepare_repair, apply_repair, mark_repair_required,
        mark_repair_deferred, ADJUSTMENT_QUARANTINE_ASSETS,
    )
    previous = latest.to_dict() or {}
    verified = (previous.get("metadata") or {}).get("price_history_sync", {}).get("status") == "VERIFIED"
    known_pending = asset_id in ADJUSTMENT_QUARANTINE_ASSETS and not verified
    if not known_pending and not adjustment_problem("", [previous]) and not revision_detected(previous, rows, currency):
        return None
    try:
        plan, snapshots = prepare_repair(db, ref, asset_id, asset_type, symbol, currency,
                                         today, fx_cache, budget)
    except ReadBudgetExceeded:
        raise
    except TransientProviderError as exc:
        # B-05: EODHD no respondio (5xx agotados, timeout, cuota). No hay nada
        # verificado contra el historico, asi que no se bloquea: queda un aviso
        # REPAIR_DEFERRED y el siguiente ciclo vuelve a detectar la revision.
        _LOG.warning("price_refresh: reparacion aplazada en %s por fallo transitorio: %s", asset_id, exc)
        if write:
            mark_repair_deferred(latest, exc)
        raise
    except Exception as exc:
        if write:
            mark_repair_required(latest, exc)
        raise
    counts = apply_repair(db, ref, plan, snapshots, root, root_update_time, budget) if write else {}
    # CRIT-03 (auditoria 16-10-2026): la respuesta lleva tambien las claves de un refresco
    # normal (new_points/new_first/new_last) con el historico reconstruido entero, para que
    # el panel de admin no tome una reparacion ya escrita por un error ni la oculte en la
    # pasada en seco. `history_rebuilt` dice que es una reconstruccion y no un anadido.
    return {"history_rebuilt": True, "applied": write, "first_date": plan["first_date"],
            "last_date": plan["last_date"], "revision": plan["revision"],
            "history_documents": len(plan["documents"]), "points": plan["new_unique_points"],
            "new_points": plan["new_unique_points"], "new_first": plan["first_date"],
            "new_last": plan["last_date"],
            **counts}


def refresh_stale_prices(
    limit: int = 0,
    sleep: float = 0.0,
    write: bool = False,
    offset: int = 0,
    max_reads: int | None = None,
    scheduler_price_gate: bool = False,
    start_after_asset_id: str | None = None,
    resume_from_watermark: bool = False,
) -> dict:
    """Refresca los price_series desactualizados. Devuelve un resumen."""
    operation = "refresh_stale_prices"
    if write:
        if scheduler_price_gate:
            # S6b (decisión 27-07): el gate del scheduler se SUMA al maestro,
            # no lo sustituye — como documenta README.md y como ya exigen
            # métricas e integridad. Ambos están activos en producción.
            require_master_writes_enabled(operation)
            require_price_scheduler_writes_enabled(operation)
        else:
            require_master_writes_enabled(operation)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True)

    db = _master_db()
    today = _today()
    budget = ReadBudget(DEFAULT_MAX_READS if max_reads is None else max_reads)
    if resume_from_watermark and not start_after_asset_id:
        budget.add(1, "meta/price_refresh")
        watermark_snap = db.collection("meta").document("price_refresh").get()
        watermark = watermark_snap.to_dict() if watermark_snap.exists else {}
        if not watermark.get("cycle_completed"):
            start_after_asset_id = str(watermark.get("next_cursor") or "").strip() or None
    fx_cache: dict = {}
    processed = updated = skipped = errors = writes = series_writes = root_nav_writes = 0
    histories_rebuilt = 0
    no_conversion = 0  # EODHD devolvio filas pero ninguna se pudo convertir (FX/valores nulos)
    unresolved_currency = 0  # el proveedor no dio la divisa del listado: no se escribe
    no_data = 0        # EODHD no devolvio filas (normal en festivo; sospechoso si es cronico)
    no_data_sample = []  # solo los rezagados >30 dias: candidatos a delistado/simbolo muerto
    unsupported_source = 0
    unsupported_source_sample = []
    err_sample = []
    sample = []

    # Pagina por document_id en el servidor. El antiguo limit/offset materializaba
    # TODA la coleccion en cada bloque manual y multiplicaba las lecturas.
    asset_rows = []
    document_id = FieldPath.document_id()
    query = db.collection("assets").order_by(document_id).select([
        "quality.status", "asset_type", "classification.asset_type", "performance.valuation",
    ])
    cursor = str(start_after_asset_id or "").strip() or None
    if cursor:
        query = query.start_after({document_id: cursor})
    page_size = max(0, int(limit or 0))
    if not page_size and resume_from_watermark and budget.remaining() is not None:
        # Peor caso por activo: root + latest + lectura del doc REFRESH previo.
        page_size = max(1, (budget.remaining() - 1) // 3)
    if offset and not cursor:
        # Compatibilidad temporal con clientes antiguos. Firestore factura los
        # documentos saltados; los clientes nuevos deben usar cursor.
        query = query.offset(max(0, int(offset)))
    if page_size:
        query = query.limit(page_size + 1)
    raw_docs = []
    for s in query.stream():
        budget.add(1, "assets")
        raw_docs.append(s)
    if not raw_docs:
        budget.add(1, "assets_empty_query")
    has_more = bool(page_size and len(raw_docs) > page_size)
    page_docs = raw_docs[:page_size] if page_size else raw_docs
    next_cursor = page_docs[-1].id if has_more and page_docs else None
    for s in page_docs:
        root_data = s.to_dict() or {}
        if _is_active_canonical_asset(s.id, root_data):
            asset_rows.append((s.id, root_data, getattr(s, "update_time", None)))

    last_completed_asset_id = cursor

    def persist_checkpoint(cursor_value: str | None, *, completed: bool) -> None:
        nonlocal writes
        timestamp = _now_iso()
        payload = {
            "last_run": timestamp, "last_run_date": today,
            "read_budget_max": budget.max_reads, "read_budget_used": budget.reads,
            "write_count": writes + 1, "next_cursor": cursor_value,
            "cycle_completed": completed,
            "unsupported_source": unsupported_source,
            "unsupported_source_sample": unsupported_source_sample,
        }
        if series_writes:
            payload["data_changed_at"] = timestamp
        db.collection("meta").document("price_refresh").set(payload, merge=True)
        writes += 1

    def mark_completed(asset_id: str) -> None:
        nonlocal last_completed_asset_id
        last_completed_asset_id = asset_id
        if write and processed % CHECKPOINT_EVERY == 0:
            persist_checkpoint(last_completed_asset_id, completed=False)

    for aid, root_data, root_update_time in asset_rows:
        processed += 1
        try:
            ref = db.collection("assets").document(aid)
            # Incluso una consulta vacia se factura como una lectura.
            budget.add(1, "latest_price_series")
            latest = list(
                ref.collection("price_series")
                .order_by("last_date", direction=gcf.Query.DESCENDING)
                .limit(1).stream()
            )
            if not latest:
                skipped += 1
                mark_completed(aid)
                continue
            d = latest[0].to_dict() or {}
            sym, ccy = _symbol_and_currency(d, root_data, resolve=write)
            last = str(d.get("last_date") or "")
            atype = d.get("asset_type") or root_data.get("asset_type") or "EQUITY"
            if not last or (last >= today and not write):
                skipped += 1
                mark_completed(aid)
                continue

            if not sym:
                unsupported_source += 1
                if len(unsupported_source_sample) < 10:
                    unsupported_source_sample.append({
                        "asset_id": aid, "last_date": last,
                        "source_price_id": d.get("source_listing_id") or d.get("source_price_id"),
                    })
                skipped += 1
                mark_completed(aid)
                continue

            if write and not ccy:
                # Auditoria de divisas: antes se caia al metadato («EUR» por defecto) y
                # asi nacieron las series mal convertidas. Sin divisa del listado no se
                # escribe: se salta el activo y queda el aviso.
                _LOG.warning("price_refresh: sin divisa de listado para %s (%s): no se escribe", aid, sym)
                unresolved_currency += 1
                skipped += 1
                mark_completed(aid)
                continue

            if not write:
                if len(sample) < 10:
                    sample.append({
                        "asset_id": aid,
                        "last_date": last,
                        "new_last": None,
                    })
                updated += 1
                mark_completed(aid)
                continue

            from_date = (date.fromisoformat(last) - timedelta(days=OVERLAP_DAYS)).isoformat()
            rows = fetch_eod(sym, from_date, today)
            if not rows:
                # Sin datos en EODHD para la ventana. Si el activo lleva mas de un
                # mes parado, es un candidato a delistado o simbolo dado de baja:
                # se lista en el resumen para que deje de confundirse con "sano"
                # (auditoria 27-07; caso real ES0143416115 parado desde 2023).
                no_data += 1
                try:
                    days_stale = (date.fromisoformat(today) - date.fromisoformat(last)).days
                except Exception:
                    swallowed_quiet("price_refresh.py:469")
                    days_stale = None
                if (days_stale is None or days_stale > 30) and len(no_data_sample) < 10:
                    no_data_sample.append({"asset_id": aid, "last_date": last, "days_stale": days_stale})
                skipped += 1
                mark_completed(aid)
                continue
            repaired = _repair_changed_history(
                db, ref, latest[0], root_data, root_update_time, aid, atype, sym, ccy,
                rows, today, fx_cache, write, budget,
            )
            if repaired is not None:
                histories_rebuilt += 1
                writes += repaired.get("write_count", 0)
                series_writes += repaired.get("series_writes", 0)
                root_nav_writes += repaired.get("root_nav_writes", 0)
                if len(sample) < 10:
                    sample.append({"asset_id": aid, **repaired})
                updated += 1
                mark_completed(aid)
                continue
            conv, fx_meta = _convert_eur(rows, ccy, fx_cache, from_date, today)
            fresh = [p for p in conv if p["date"] > last]
            if not fresh:
                if rows and not conv:
                    # Tripwire: EODHD trajo datos pero ninguno se pudo convertir
                    # (sin FX previo o valores nulos). Antes esto se contaba como
                    # skipped y el activo quedaba congelado sin dejar rastro.
                    no_conversion += 1
                    if len(err_sample) < 10:
                        err_sample.append({
                            "asset_id": aid,
                            "error": "SIN_CONVERSION: %d filas EODHD sin punto valido (FX/valores)" % len(rows),
                        })
                skipped += 1
                mark_completed(aid)
                continue

            if len(sample) < 10:
                sample.append({
                    "asset_id": aid,
                    "last_date": last,
                    "new_last": fresh[-1]["date"],
                    "new_points": len(fresh),
                })

            if write:
                now = _now_iso()
                batch = db.batch()
                nav_payload = _fund_nav_update(
                    atype, fresh[-1], ccy, sym, now,
                    ((root_data.get("performance") or {}).get("valuation") or {}),
                )
                for year, pts in _group_by_year(fresh).items():
                    doc_id = _refresh_doc_id(sym, year)
                    ref_doc = ref.collection("price_series").document(doc_id)
                    budget.add(1, "refresh_document_previous")
                    prev = ref_doc.get()
                    points = pts
                    if prev.exists:  # fusiona con el REFRESH del mismo anio y dedup por fecha
                        merged = {p["date"]: p for p in ((prev.to_dict() or {}).get("points") or [])}
                        for p in pts:
                            merged[p["date"]] = p
                        points = [merged[k] for k in sorted(merged)]
                    doc = {
                        "asset_id": aid, "asset_type": atype, "currency": "EUR",
                        "document_id": doc_id, "first_date": points[0]["date"], "last_date": points[-1]["date"],
                        "history_quality_status": "COMPLETE", "interval": "1d",
                        "observations_count": len(points), "points": points,
                        "schema_version": PRICE_SERIES_SCHEMA, "series_type": _series_type(atype),
                        "source": "EODHD", "source_currency": ccy,
                        "source_listing_id": "EODHD:%s" % sym, "source_price_id": "EODHD:%s" % sym,
                        "updated_at": now, "year": year, "refresh": True,
                    }
                    if prev.exists and (prev.to_dict() or {}).get("metadata"):
                        doc["metadata"] = (prev.to_dict() or {})["metadata"]
                    doc.update(fx_meta)
                    validate_contract(doc, "price-series.v1.2.schema.json")
                    # Ola A2 (A2.7): precondicion optimista sobre la fusion
                    # leida — si el scheduler escribe este mismo doc entre la
                    # lectura y el commit, el batch falla (reintentable) en vez
                    # de pisar su fusion en silencio (lost update). El NAV raiz
                    # de abajo ya usaba este mismo patron.
                    if prev.exists:
                        batch.update(ref_doc, doc, option=gcf.LastUpdateOption(prev.update_time))
                    else:
                        batch.create(ref_doc, doc)
                if nav_payload is not None:
                    if root_update_time is None:
                        raise RuntimeError("ROOT_NAV_PRECONDITION_MISSING")
                    batch.update(
                        ref,
                        {"performance.valuation": nav_payload},
                        option=gcf.LastUpdateOption(root_update_time),
                    )
                batch.commit()
                from price_series_cache import invalidate_price_series_cache
                invalidate_price_series_cache(aid)
                written_docs = len(_group_by_year(fresh))
                written_root = 1 if nav_payload is not None else 0
                writes += written_docs + written_root
                series_writes += written_docs
                root_nav_writes += written_root
            updated += 1
            mark_completed(aid)
        except ReadBudgetExceeded as exc:
            errors += 1
            if len(err_sample) < 10:
                err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
            has_more = True
            next_cursor = last_completed_asset_id
            break
        except Exception as exc:  # noqa: BLE001 — seguir y reportar
            errors += 1
            if len(err_sample) < 10:
                err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
            mark_completed(aid)
        if sleep:
            time.sleep(sleep)

    # Cierre final; durante ejecuciones largas solo hay un checkpoint cada 50
    # activos, frente al antiguo watermark redundante por cada escritura.
    if write:
        persist_checkpoint(next_cursor, completed=not has_more)

    return {"processed": processed, "updated": updated if write else 0, "would_update": updated if not write else 0,
            "applied": write, "skipped": skipped, "no_conversion": no_conversion,
            "unresolved_currency": unresolved_currency, "histories_rebuilt": histories_rebuilt,
            "no_data": no_data, "no_data_sample": no_data_sample,
            "unsupported_source": unsupported_source, "unsupported_source_sample": unsupported_source_sample,
            "errors": errors, "error_sample": err_sample, "sample": sample, "ran_date": today,
            "read_budget_max": budget.max_reads, "read_budget_used": budget.reads,
            "write_count": writes, "root_nav_writes": root_nav_writes, "next_cursor": next_cursor,
            "cycle_completed": not has_more}


def refresh_one(asset_id: str, write: bool = False) -> dict:
    """Refresca un activo y reconcilia los ajustes anteriores. dry-run salvo write=True."""
    operation = "refresh_one"
    if write:
        require_master_writes_enabled(operation)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True, asset_id=asset_id)

    db = _master_db()
    today = _today()
    ref = db.collection("assets").document(asset_id)
    snap = ref.get()
    if not snap.exists:
        return {"asset_id": asset_id, "found": False}
    if not _is_active_canonical_asset(asset_id, snap.to_dict() or {}):
        return {"asset_id": asset_id, "found": True, "skipped": "not_active_canonical"}
    latest = list(
        ref.collection("price_series")
        .order_by("last_date", direction=gcf.Query.DESCENDING)
        .limit(1).stream()
    )
    if not latest:
        return {"asset_id": asset_id, "found": True, "has_series": False}
    d = latest[0].to_dict() or {}
    root_data = snap.to_dict() or {}
    # Esta vista previa individual ya consulta precios del proveedor: debe usar
    # tambien su divisa, exactamente como la escritura. La vista previa masiva
    # conserva su contrato de no consumir proveedores.
    sym, ccy = _symbol_and_currency(d, root_data, resolve=True)
    last = str(d.get("last_date") or "")
    atype = d.get("asset_type") or root_data.get("asset_type") or "EQUITY"
    if not sym or not last:
        return {"asset_id": asset_id, "found": True, "note": "sin simbolo EODHD o sin last_date"}
    if not ccy:
        # Misma regla que el refresco masivo: sin divisa del listado no se escribe.
        _LOG.warning("price_refresh: sin divisa de listado para %s (%s): no se escribe", asset_id, sym)
        return {"asset_id": asset_id, "found": True, "note": "sin divisa de listado en el proveedor",
                "eodhd_symbol": sym, "unresolved_currency": True}
    from_date = (date.fromisoformat(last) - timedelta(days=OVERLAP_DAYS)).isoformat()
    rows = fetch_eod(sym, from_date, today)
    if not rows:
        return {"asset_id": asset_id, "found": True, "new_points": 0, "note": "sin datos del proveedor"}
    repaired = _repair_changed_history(
        db, ref, latest[0], root_data, getattr(snap, "update_time", None), asset_id,
        atype, sym, ccy, rows, today, {}, write,
    )
    if repaired is not None:
        return {"asset_id": asset_id, "found": True, **repaired}
    conv, fx_meta = _convert_eur(rows, ccy, {}, from_date, today)
    fresh = [p for p in conv if p["date"] > last]
    if not fresh:
        return {"asset_id": asset_id, "found": True, "new_points": 0, "last_date": last, "eodhd_symbol": sym}
    if write:
        now = _now_iso()
        batch = db.batch()
        nav_payload = _fund_nav_update(
            atype, fresh[-1], ccy, sym, now,
            ((root_data.get("performance") or {}).get("valuation") or {}),
        )
        for year, pts in _group_by_year(fresh).items():
            doc_id = _refresh_doc_id(sym, year)
            ref_doc = ref.collection("price_series").document(doc_id)
            prev = ref_doc.get()
            points = pts
            if prev.exists:
                merged = {p["date"]: p for p in ((prev.to_dict() or {}).get("points") or [])}
                for p in pts:
                    merged[p["date"]] = p
                points = [merged[k] for k in sorted(merged)]
            doc = {
                "asset_id": asset_id, "asset_type": atype, "currency": "EUR",
                "document_id": doc_id, "first_date": points[0]["date"], "last_date": points[-1]["date"],
                "history_quality_status": "COMPLETE", "interval": "1d",
                "observations_count": len(points), "points": points,
                "schema_version": PRICE_SERIES_SCHEMA, "series_type": _series_type(atype),
                "source": "EODHD", "source_currency": ccy,
                "source_listing_id": "EODHD:%s" % sym, "source_price_id": "EODHD:%s" % sym,
                "updated_at": now, "year": year, "refresh": True,
            }
            if prev.exists and (prev.to_dict() or {}).get("metadata"):
                doc["metadata"] = (prev.to_dict() or {})["metadata"]
            doc.update(fx_meta)
            validate_contract(doc, "price-series.v1.2.schema.json")
            if prev.exists:
                batch.update(ref_doc, doc, option=gcf.LastUpdateOption(prev.update_time))
            else:
                batch.create(ref_doc, doc)
        if nav_payload is not None:
            batch.update(
                ref,
                {"performance.valuation": nav_payload},
                option=gcf.LastUpdateOption(snap.update_time),
            )
        batch.commit()
        from price_series_cache import invalidate_price_series_cache
        invalidate_price_series_cache(asset_id)
    return {"asset_id": asset_id, "found": True, "applied": write,
            "new_points": len(fresh), "new_first": fresh[0]["date"],
            "new_last": fresh[-1]["date"], "eodhd_symbol": sym,
            "root_nav_updated": bool(write and nav_payload is not None)}
