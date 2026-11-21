# -*- coding: utf-8 -*-
"""
history_backfill.py — carga INICIAL de historicos para activos SIN price_series (panel Admin).

Complementa a price_refresh (incremental, solo activos CON serie) e ingest_asset (alta de
acciones nuevas): aqui se cubre el hueco "sin historico" para CUALQUIER tipo ya dado de alta
en la maestra (FUND/ETF/STOCK/...). Por activo:
  - resuelve el simbolo EODHD (pista del root: identifiers.eodhd_code / listings; si no,
    /search por ISIN — para FUND se prefiere el listado EUFUND),
  - baja la serie completa desde 1990, la normaliza a EUR (misma maquinaria que price_refresh)
  - y escribe docs por anio EODHD_{sym}_{year} con la MISMA forma que ingest_asset
    (_load_full_history): schema asset-price-series.v1.2, fx a nivel doc y punto si divisa != EUR.

Seguridad: dry-run por defecto; write=True exige el gate (require_master_writes_enabled).
CREATE-ONLY: solo actua si price_series esta VACIA y crea docs con batch.create (nunca
sobreescribe, nunca borra, no toca root/meta). Idempotente: re-ejecutar omite
los activos que ya tienen serie.

metrics/latest (14-10-2026, ALTA-01): una serie nueva sin metrics/latest se quedaba asi
para siempre, porque metrics_refresh solo actualiza documentos que ya existen. Tras
crear la serie, si el activo no tiene metrics/latest se CREA (create-only, nunca pisa
uno existente, p. ej. el trailing del proveedor) con `ingest_asset.build_metrics_latest`
sobre la serie recien cargada: el mismo calculo que la ingesta y que
`scripts/migrate_metrics_latest.py` para los MISSING. Exige METRICS_WRITE_ENABLED como el
refresco. Ver `ensure_metrics_latest`.

Criterio de propiedad de metrics/latest (decidido el 14-10-2026): la app crea el
metrics/latest de CALCULO PROPIO para los activos con serie propia en la maestra, SALVO
que la raiz traiga las cifras trailing del proveedor (fondos con
`performance.returns.trailing_pct` / `risk.volatilidad_pct` / `risk.sharpe` de
Morningstar). Ese documento es del puente del proveedor: lo crea el republish de la
plataforma como FONDOSDB_ROOT_ES y despues `migrate_metrics_latest` lo reconcilia ventana
a ventana. Es el mismo criterio que `republish.ownsMetrics`, asi que nunca hay dos
escritores sobre el mismo documento: o lo crea la app (y el republish ve una fuente
propia y no lo toca) o lo crea el puente (y la app no lo crea).

Las funciones puras (resolucion de simbolo, construccion de docs) no importan google.*
para poder testearse sin dependencias.
"""
import re

from contract_validation import validate_contract
from quietlog import swallowed

HISTORY_START = "1990-01-01"  # EODHD recorta a lo realmente disponible
PRICE_SERIES_SCHEMA = "asset-price-series.v1.2"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
MAX_IDS_PER_CALL = 25  # el cliente trocea; cada activo = 1-2 llamadas EODHD


# --------------------------------------------------------------------------- puras (testeables)
def series_type_for(asset_type) -> str:
    t = str(asset_type or "").upper()
    if t == "FUND":
        return "NAV"
    if t == "INDEX":
        return "INDEX_LEVEL"
    return "ADJUSTED_CLOSE"


def load_doc_id(symbol: str, year: int) -> str:
    safe = str(symbol).replace(":", "_").replace("/", "_").replace(".", "_")
    return "EODHD_%s_%d" % (safe, year)


def root_type(d: dict) -> str:
    cls = d.get("classification") or {}
    t = d.get("instrument_type") or d.get("asset_type") or cls.get("asset_class") or "OTHER"
    return str(t).upper()


def root_name(d: dict) -> str:
    identity = d.get("identity") or {}
    return str(identity.get("name") or d.get("display_name") or d.get("name") or "")


def eodhd_hint(d: dict):
    identifiers = d.get("identifiers") or {}
    code = identifiers.get("eodhd_code")
    if isinstance(code, str) and code:
        return code
    for listing in d.get("listings") or []:
        if isinstance(listing, dict):
            code = listing.get("eodhd_code")
            if isinstance(code, str) and code:
                return code
    return None


def root_currency(d: dict):
    identity = d.get("identity") or {}
    ccy = identity.get("currency")
    if isinstance(ccy, str) and ccy:
        return ccy.upper()
    for listing in d.get("listings") or []:
        if isinstance(listing, dict):
            ccy = listing.get("currency")
            if isinstance(ccy, str) and ccy:
                return ccy.upper()
    return None


def choose_search_match(asset_id: str, asset_type: str, items):
    """Eleccion pura sobre /search: ISIN exacto; FUND prefiere EUFUND; luego isPrimary; luego el 1o."""
    valid = [r for r in (items or []) if isinstance(r, dict) and r.get("Code") and r.get("Exchange")]
    if not valid:
        return None
    exact = [r for r in valid if str(r.get("ISIN") or "").upper() == asset_id.upper()] or valid
    chosen = None
    if str(asset_type or "").upper() == "FUND":
        chosen = next((r for r in exact if str(r.get("Exchange")).upper() == "EUFUND"), None)
    if chosen is None:
        chosen = next((r for r in exact if r.get("isPrimary") is True), exact[0])
    symbol = "%s.%s" % (chosen["Code"], chosen["Exchange"])
    return {
        "symbol": symbol,
        "currency": (chosen.get("Currency") or None),
        "eodhd_type": chosen.get("Type") or None,
        "eodhd_name": chosen.get("Name") or None,
        "exact_isin": str(chosen.get("ISIN") or "").upper() == asset_id.upper(),
        "alternatives": ["%s.%s" % (r["Code"], r["Exchange"]) for r in exact
                         if "%s.%s" % (r["Code"], r["Exchange"]) != symbol][:5],
    }


def build_year_docs(asset_id: str, asset_type: str, symbol: str, source_ccy: str,
                    points, fx_meta: dict, now_iso: str):
    """Docs por anio, misma forma que ingest_asset._load_full_history (sin claves None)."""
    grouped = {}
    for p in points:
        grouped.setdefault(int(str(p["date"])[:4]), []).append(p)
    docs = []
    for year in sorted(grouped):
        pts = grouped[year]
        doc = {
            "asset_id": asset_id,
            "asset_type": str(asset_type or "OTHER").upper(),
            "currency": "EUR",
            "document_id": load_doc_id(symbol, year),
            "first_date": pts[0]["date"],
            "last_date": pts[-1]["date"],
            "history_quality_status": "COMPLETE",
            "interval": "1d",
            "observations_count": len(pts),
            "points": pts,
            "schema_version": PRICE_SERIES_SCHEMA,
            "series_type": series_type_for(asset_type),
            "source": "EODHD",
            "source_currency": str(source_ccy or "EUR").upper(),
            "source_listing_id": "EODHD:%s" % symbol,
            "source_price_id": "EODHD:%s" % symbol,
            "updated_at": now_iso,
            "year": year,
        }
        for key in ("fx_pair", "minor_scale", "fx_policy"):
            if fx_meta.get(key) is not None:
                doc[key] = fx_meta[key]
        docs.append(doc)
    return docs


# --------------------------------------------------------------------------- metrics/latest
MIGRATE_METRICS_HINT = (
    "python scripts/migrate_metrics_latest.py --write --asset %s "
    "--approval YES_I_UNDERSTAND_MASTER_DB_WRITES (desde functions_python)"
)


def metrics_latest_for_new_series(asset_id: str, asset_type: str, points, now_iso: str,
                                  risk_free_resolver=None):
    """(payload, motivo) del metrics/latest de una serie recien cargada.

    Mismo calculo que la ingesta (`build_metrics_latest`, que valida el contrato) y
    misma guarda que la migracion y el refresco: si alguna ventana propia sale con
    Sharpe sin tasa (el BCE no respondio y `_window_risk_free` cayo a 0), motivo
    NO_RATE y no se escribe: seria un Sharpe sin descontar indistinguible de uno bueno.
    """
    from ingest_asset import build_metrics_latest, _estr_window_resolver

    payload = build_metrics_latest(
        asset_id, asset_type, points, now_iso,
        risk_free_resolver=risk_free_resolver or _estr_window_resolver,
    )
    windows = payload.get("windows") or {}
    if any(node.get("method") == "GEOMETRIC_CAGR" and node.get("sharpe_ratio") is not None
           and not node.get("risk_free_rate") for node in windows.values()):
        return payload, "NO_RATE"
    return payload, None


PROVIDER_BRIDGE_HINT = (
    "metrics/latest de este fondo es del puente del proveedor (republish:fondosdb, "
    "FONDOSDB_ROOT_ES); despues migrate_metrics_latest.py --asset %s reconcilia ventana a ventana"
)
_PROVIDER_WINDOW_PREFIXES = ("annualized_return_", "volatility_", "sharpe_")


def provider_bridge_owns_metrics(root) -> bool:
    """True si las metricas del activo son del puente del proveedor.

    Mismo criterio que la plataforma (`republish.ownsMetrics`): el puente solo existe
    para FONDOS, y escribe el trailing de Morningstar que trae la raiz
    (`performance.returns.trailing_pct`, `risk.volatilidad_pct`, `risk.sharpe`, leido
    con `_map_root_fallback`, como `improve_fund_data.provider_metrics`). Con ese
    trailing en la raiz, el documento lo crea el republish como FONDOSDB_ROOT_ES y la
    app solo sustituye las ventanas que reproducen la cifra del proveedor
    (migrate_metrics_latest). Crear aqui el calculo propio saltaria esa reconciliacion.
    """
    if not isinstance(root, dict) or str(root.get("asset_type") or "").upper() != "FUND":
        return False
    from readmodel.mappers import _map_root_fallback

    fallback = _map_root_fallback(root)
    return any(key.startswith(_PROVIDER_WINDOW_PREFIXES) for key in fallback)


def _metrics_writes_enabled() -> bool:
    from metrics_refresh import metrics_writes_enabled
    return metrics_writes_enabled()


def ensure_metrics_latest(asset_ref, asset_id: str, asset_type: str, points, now_iso: str,
                          write: bool, root=None, risk_free_resolver=None) -> dict:
    """Crea metrics/latest si falta, tras cargar una serie nueva. Create-only.

    Por que aqui y no en metrics_refresh: el refresco programado no sabe de quien es un
    documento que no existe (calculo propio o trailing del proveedor pendiente de
    republish) y crearia documentos en lote, en un job con tope de lecturas y sin
    pasada en seco delante. Aqui la escritura la pide el operador para activos
    concretos, bajo el mismo gate y despues de ver la vista previa, y solo si falta.

    La app es duena de las metricas de los activos con serie propia, salvo los fondos
    cuyas metricas son del puente del proveedor (`provider_bridge_owns_metrics`): esos
    no se crean aqui. Escribir exige ademas METRICS_WRITE_ENABLED, como el refresco.

    Estados: EXISTS (no se toca), PROVIDER_BRIDGE (no se crea), WOULD_CREATE (vista
    previa), CREATED, METRICS_WRITES_DISABLED, NO_RATE, ERROR. Los que no crean nada
    traen `next_step` con la via que corresponde.
    """
    metrics_ref = asset_ref.collection("metrics").document("latest")
    try:
        if metrics_ref.get().exists:
            return {"status": "EXISTS"}
        if provider_bridge_owns_metrics(root):
            return {"status": "PROVIDER_BRIDGE", "next_step": PROVIDER_BRIDGE_HINT % asset_id}
        gate_open = _metrics_writes_enabled()
        if not write:
            return {"status": "WOULD_CREATE", "metrics_writes_enabled": gate_open}
        if not gate_open:
            return {"status": "METRICS_WRITES_DISABLED",
                    "next_step": "METRICS_WRITE_ENABLED=true y " + MIGRATE_METRICS_HINT % asset_id}
        payload, unsafe = metrics_latest_for_new_series(
            asset_id, asset_type, points, now_iso, risk_free_resolver=risk_free_resolver,
        )
        if unsafe:
            return {"status": unsafe, "next_step": MIGRATE_METRICS_HINT % asset_id}
        metrics_ref.create(payload)
        return {"status": "CREATED", "windows": sorted((payload.get("windows") or {}).keys()),
                "source": payload.get("source")}
    except Exception as exc:  # noqa: BLE001 - la serie ya esta escrita; se informa y se sigue
        return {"status": "ERROR", "error": str(exc)[:250], "next_step": MIGRATE_METRICS_HINT % asset_id}


# --------------------------------------------------------------------------- Firestore/EODHD
def _has_series(db, asset_id: str) -> bool:
    probe = list(
        db.collection("assets").document(asset_id)
        .collection("price_series").select(["last_date"]).limit(1).stream()
    )
    return len(probe) > 0


def list_candidates() -> dict:
    """Inventario read-only: activos canonicos activos SIN ningun doc en price_series."""
    from price_refresh import _master_db, _is_active_canonical_asset, _now_iso

    db = _master_db()
    # Camino normal: una sola lectura del snapshot ya materializado por integridad.
    # Evita el antiguo N+1 (todos los roots + una consulta price_series por root).
    inventory_snap = db.collection("meta").document("admin_asset_inventory").get()
    inventory = inventory_snap.to_dict() if inventory_snap.exists else {}
    inventory_rows = inventory.get("rows") if isinstance(inventory, dict) else None
    if (
        inventory.get("schema_version") == "admin-asset-inventory.v1"
        and isinstance(inventory_rows, list)
        and all(isinstance(row, dict) and "canonical_active" in row for row in inventory_rows)
    ):
        active_rows = [row for row in inventory_rows if row.get("canonical_active")]
        candidates = [
            {
                "asset_id": row["asset_id"], "name": row.get("name") or row["asset_id"],
                "type": row.get("type") or "OTHER", "eodhd_hint": row.get("symbol"),
                "currency_hint": row.get("currency"),
            }
            for row in active_rows if int(row.get("points") or 0) == 0
        ]
        candidates.sort(key=lambda item: item["asset_id"])
        by_type = {}
        for item in candidates:
            by_type[item["type"]] = by_type.get(item["type"], 0) + 1
        return {
            "generated_at": inventory.get("generated_at") or _now_iso(),
            "total_roots": len(inventory_rows),
            "excluded": len(inventory_rows) - len(active_rows),
            "with_series": len(active_rows) - len(candidates),
            "candidates": candidates,
            "by_type": dict(sorted(by_type.items())),
        }

    # Compatibilidad de arranque: reconstruccion directa si aun no existe snapshot v1.
    candidates = []
    by_type = {}
    total_roots = excluded = with_series = 0
    for snap in db.collection("assets").stream():
        total_roots += 1
        d = snap.to_dict() or {}
        if not _is_active_canonical_asset(snap.id, d):
            excluded += 1
            continue
        if _has_series(db, snap.id):
            with_series += 1
            continue
        ctype = root_type(d)
        by_type[ctype] = by_type.get(ctype, 0) + 1
        candidates.append({
            "asset_id": snap.id,
            "name": root_name(d) or snap.id,
            "type": ctype,
            "eodhd_hint": eodhd_hint(d),
            "currency_hint": root_currency(d),
        })
    candidates.sort(key=lambda c: c["asset_id"])
    return {
        "generated_at": _now_iso(),
        "total_roots": total_roots,
        "excluded": excluded,
        "with_series": with_series,
        "candidates": candidates,
        "by_type": dict(sorted(by_type.items())),
    }


def _resolve(db_doc: dict, asset_id: str, asset_type: str):
    """Resolucion de simbolo: pista del root o /search por ISIN. Devuelve (info, status)."""
    hint = eodhd_hint(db_doc)
    if hint:
        return {
            "symbol": hint,
            "currency": root_currency(db_doc),
            "eodhd_type": None,
            "eodhd_name": None,
            "exact_isin": True,
            "alternatives": [],
        }, "HINT"
    from price_refresh import _eodhd_get
    import urllib.parse
    try:
        items = _eodhd_get("search/%s" % urllib.parse.quote(asset_id))
    except Exception:
        swallowed("history_backfill.py:238")
        items = []
    chosen = choose_search_match(asset_id, asset_type, items if isinstance(items, list) else [])
    if not chosen:
        return None, "UNRESOLVED"
    return chosen, "SEARCH_EXACT" if chosen.get("exact_isin") else "SEARCH_FALLBACK"


def backfill_one(db, asset_id: str, write: bool, fx_cache: dict) -> dict:
    """Carga (o previsualiza) el historico completo de UN activo sin serie. No gatea: eso es del batch."""
    from price_refresh import (
        fetch_eod, _convert_eur, _fetch_fx, _is_active_canonical_asset, listing_currency,
        _major_currency, _now_iso, _today,
    )

    out = {"asset_id": asset_id, "ok": False, "applied": False, "skipped": None, "reason": None,
           "resolution": None, "symbol": None, "currency": None, "points": 0,
           "first_date": None, "last_date": None, "years": 0, "docs_created": 0, "error": None,
           "metrics_latest": None}
    try:
        snap = db.collection("assets").document(asset_id).get()
        if not snap.exists:
            out["skipped"] = "NOT_FOUND"
            return out
        d = snap.to_dict() or {}
        if not _is_active_canonical_asset(asset_id, d):
            out["skipped"] = "NOT_CANONICAL"
            return out
        if _has_series(db, asset_id):
            out["skipped"] = "HAS_SERIES"
            return out

        atype = root_type(d)
        resolved, status = _resolve(d, asset_id, atype)
        out["resolution"] = status
        if not resolved:
            out["reason"] = "NO_SYMBOL"
            return out
        out["symbol"] = resolved["symbol"]
        # Auditoria de divisas (06-09-2026): la divisa la manda el LISTADO del
        # proveedor, no la ficha. Antes, `root_currency` colaba la divisa de la clase
        # («USD Acc») y se convertian cotizaciones que ya venian en euros.
        ccy_meta = (resolved.get("currency") or root_currency(d) or "").upper()
        ccy = (listing_currency(resolved["symbol"]) or "").upper()
        if ccy and ccy_meta and ccy != ccy_meta:
            out["currency_mismatch"] = {"metadato": ccy_meta, "listado": ccy}
        if not ccy:
            out["reason"] = "NO_CURRENCY"
            out["currency_metadata"] = ccy_meta or None
            return out
        out["currency"] = ccy

        today = _today()
        rows = fetch_eod(resolved["symbol"], HISTORY_START, today)
        if ccy != "EUR" and rows:
            major, _scale = _major_currency(ccy)
            if major not in fx_cache:
                fx_cache[major] = _fetch_fx(major, HISTORY_START, today)
            fx_dates, _rates = fx_cache[major]
            rows = [r for r in rows if str(r.get("date")) >= fx_dates[0]]
        conv, fx_meta = _convert_eur(rows, ccy, fx_cache, HISTORY_START, today)
        if not conv:
            out["reason"] = "NO_DATA"
            return out

        now_iso = _now_iso()
        docs = build_year_docs(asset_id, atype, resolved["symbol"], ccy, conv, fx_meta, now_iso)
        out.update({"ok": True, "points": len(conv), "first_date": conv[0]["date"],
                    "last_date": conv[-1]["date"], "years": len(docs)})
        asset_ref = db.collection("assets").document(asset_id)
        if not write:
            out["metrics_latest"] = ensure_metrics_latest(asset_ref, asset_id, atype, conv, now_iso, False, root=d)
            return out

        ref = db.collection("assets").document(asset_id).collection("price_series")
        batch = db.batch()
        pending = 0
        for doc in docs:
            validate_contract(doc, "price-series.v1.2.schema.json")
            batch.create(ref.document(doc["document_id"]), doc)
            pending += 1
            if pending % 400 == 0:
                batch.commit()
                batch = db.batch()
        if pending % 400 != 0:
            batch.commit()
        out["applied"] = True
        out["docs_created"] = len(docs)
        # ALTA-01: sin metrics/latest el refresco diario se saltaria el activo siempre.
        out["metrics_latest"] = ensure_metrics_latest(asset_ref, asset_id, atype, conv, now_iso, True, root=d)
        return out
    except Exception as exc:  # noqa: BLE001 — seguir con el resto del lote y reportar
        out["error"] = str(exc)[:250]
        return out


def backfill_batch(ids, write: bool = False, actor_uid: str = "") -> dict:
    """Procesa un lote de ISINs (el cliente trocea y muestra progreso). Gate una vez por llamada."""
    from write_governance import (
        log_master_write_decision, master_writes_enabled, require_master_writes_enabled,
    )
    from price_refresh import _master_db, _today

    operation = "admin_backfill_history"
    if write:
        require_master_writes_enabled(operation, actor_uid=actor_uid)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True)

    clean_ids = [str(x).strip().upper() for x in (ids or []) if str(x).strip()][:MAX_IDS_PER_CALL]
    db = _master_db()
    fx_cache: dict = {}
    results = [backfill_one(db, asset_id, write, fx_cache) for asset_id in clean_ids]
    loadable = sum(1 for r in results if r["ok"])
    return {
        "applied": write,
        "requested": len(clean_ids),
        "processed": len(results),
        "loadable": loadable,
        "loaded": sum(1 for r in results if r["applied"]),
        "skipped": sum(1 for r in results if r["skipped"]),
        "review": sum(1 for r in results if not r["ok"] and not r["skipped"] and not r["error"]),
        "errors": sum(1 for r in results if r["error"]),
        "metrics_latest_created": sum(
            1 for r in results if (r.get("metrics_latest") or {}).get("status") == "CREATED"
        ),
        "metrics_latest_pending": [
            r["asset_id"] for r in results
            if (r.get("metrics_latest") or {}).get("status") in ("NO_RATE", "ERROR", "METRICS_WRITES_DISABLED")
        ],
        "results": results,
        "ran_date": _today(),
    }
