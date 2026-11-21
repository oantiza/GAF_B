# -*- coding: utf-8 -*-
"""
Logica del PANEL ADMIN de la BBDD (solo backend, lecturas + en su dia rellenos).

Lee la BBDD MAESTRA, la que diga `master_project`. Las callables que lo
exponen van en main.py, TODAS gated por admin (`_require_admin`). Aqui solo hay
funciones puras que reciben/crean el cliente y devuelven dicts JSON-safe.

- db_status(): agregados de estado/salud (cobertura, frescura, metricas, anomalias).
- list_assets(...): pagina de activos con metadatos + flags de anomalia.
- asset_detail(asset_id): ficha de un activo con analisis fino de su price_series.

Eficiencia: para los agregados y el listado se usa projection (.select([...])) en
price_series para NO descargar los `points`. El analisis fino (huecos, duplicados,
valores<=0) solo se hace por activo en asset_detail.
"""
import os
import datetime
import re
from typing import Optional

import clock

from quietlog import swallowed, swallowed_quiet

STALE_DAYS = int(os.environ.get("ADMIN_STALE_DAYS", "5"))
TARGET_START_YEAR = 2011
META_FIELDS = ["first_date", "last_date", "observations_count", "source_listing_id", "source_currency"]
# DV3 (auditoria 27-07): la maxima caida vive en assets/{id}/metrics/latest desde el
# refresco diario; root.risk.* es la ubicacion legada (el panel mostraba 3/766).
METRICS_LATEST_FIELDS = ["max_drawdown", "max_drawdown_5y", "max_drawdown_hist", "last_date"]
ADMIN_INVENTORY_DOC = "admin_asset_inventory"
# S4 (auditoría 27-07): tope duro de docs por stream al reconstruir el
# inventario. Hoy el rebuild lee ~13k docs; si la BBDD creciera x5 sin tocar
# esto, una sola reconstrucción podría comerse el presupuesto/timeout sin
# aviso. Con el tope, el inventario sale marcado truncated y la integridad
# lo convierte en WARN visible en /sistema.
ADMIN_INVENTORY_MAX_DOCS = int(os.environ.get("ADMIN_INVENTORY_MAX_DOCS", "60000"))
# Versión del BUILDER de filas: súbela al cambiar qué contienen las filas del
# inventario. Con la reconstrucción semanal (S4), sin esto un fix del builder
# (p.ej. DV3: caída desde metrics/latest) tardaría hasta 7 días en verse.
ADMIN_INVENTORY_BUILDER_VERSION = 3
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def _capped_stream(stream, hit: list, cap: int = 0):
    """Corta un stream en cap docs y deja constancia en hit (lista-bandera)."""
    cap = int(cap or ADMIN_INVENTORY_MAX_DOCS)
    count = 0
    for snap in stream:
        count += 1
        if cap and count > cap:
            hit.append(True)
            return
        yield snap


def _db():
    # MEDIA-7 (14-10-2026): el cliente del read model, cacheado por proceso. Este modulo
    # solo lee y lo usan callables del lector; el inventario que escribe integridad
    # recibe su propio `db`.
    from readmodel.firestore_client import get_master_db
    return get_master_db()


def _today() -> datetime.date:
    # BAJA-02 (16-10-2026): antiguedad contada en dias de Madrid, como los crons.
    return clock.madrid_today()


def _itype(d: dict) -> str:
    t = (d.get("instrument_type") or d.get("asset_type")
         or (d.get("classification") or {}).get("asset_class") or "OTHER")
    return str(t).upper()


def _name(d: dict) -> str:
    return str(d.get("display_name") or d.get("name") or d.get("isin") or "")


def _has_num(node, *keys) -> bool:
    if not isinstance(node, dict):
        return False
    for k in keys:
        v = node.get(k)
        if isinstance(v, (int, float)):
            return True
        # metrics.v1.2/1.3: {value, date}; root legado: {pct, periodo, fecha}.
        if isinstance(v, dict) and (isinstance(v.get("value"), (int, float))
                                    or isinstance(v.get("pct"), (int, float))):
            return True
    return False


def _drawdown_date(node):
    """Fecha del valle: `date` en el contrato de metricas, `fecha` en el root legado."""
    if not isinstance(node, dict):
        return None
    return node.get("date") or node.get("fecha")


def _contract_drawdown(value, date=None):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    out = {"value": round(float(value), 8)}
    if date:
        out["date"] = str(date)
    return out


def _legacy_drawdown(node):
    """Root legado {pct, fecha} (porcentaje) -> forma del contrato {value, date} (decimal)."""
    if not isinstance(node, dict) or not isinstance(node.get("pct"), (int, float)):
        return None
    return _contract_drawdown(node["pct"] / 100.0, node.get("fecha"))


def _has_period_num(node, *keys) -> bool:
    if _has_num(node, *keys):
        return True
    if not isinstance(node, dict):
        return False
    for k in keys:
        v = node.get(k)
        if not isinstance(v, dict):
            continue
        for period_value in v.values():
            if isinstance(period_value, (int, float)):
                return True
            if isinstance(period_value, dict) and isinstance(period_value.get("fondo"), (int, float)):
                return True
    return False


def _series_meta(ref):
    """(first, last, ndocs, points, symbol, currency) del price_series, SIN bajar points."""
    first = last = sym = ccy = None
    ndocs = pts = 0
    try:
        stream = ref.collection("price_series").select(META_FIELDS).stream()
    except Exception:
        swallowed("admin_panel.py:110")
        stream = ref.collection("price_series").stream()
    for snap in stream:
        d = snap.to_dict() or {}
        ndocs += 1
        n = d.get("observations_count")
        if isinstance(n, int):
            pts += n
        fd, ld = d.get("first_date"), d.get("last_date")
        if isinstance(fd, str) and (first is None or fd < first):
            first = fd
        if isinstance(ld, str) and (last is None or ld > last):
            last = ld
        sid = d.get("source_listing_id") or ""
        if not sym and isinstance(sid, str) and "EODHD:" in sid:
            sym = sid.split("EODHD:", 1)[1]
        if not ccy and d.get("source_currency"):
            ccy = d.get("source_currency")
    return first, last, ndocs, pts, sym, ccy


def _merge_series_meta(current, d: dict):
    """Agrega metadatos de un documento anual sin descargar su lista de puntos."""
    first, last, ndocs, pts, sym, ccy = current
    ndocs += 1
    n = d.get("observations_count")
    if isinstance(n, int):
        pts += n
    fd, ld = d.get("first_date"), d.get("last_date")
    if isinstance(fd, str) and (first is None or fd < first):
        first = fd
    if isinstance(ld, str) and (last is None or ld > last):
        last = ld
    sid = d.get("source_listing_id") or ""
    if not sym and isinstance(sid, str) and "EODHD:" in sid:
        sym = sid.split("EODHD:", 1)[1]
    if not ccy and d.get("source_currency"):
        ccy = d.get("source_currency")
    return first, last, ndocs, pts, sym, ccy


def _series_asset_id(snap) -> Optional[str]:
    """Obtiene assets/{id} desde un resultado collection_group(price_series)."""
    ref = getattr(snap, "reference", None)
    parent = getattr(getattr(ref, "parent", None), "parent", None)
    asset_id = getattr(parent, "id", None)
    if asset_id:
        return str(asset_id)
    path = getattr(ref, "path", "")
    parts = str(path).split("/")
    return parts[1] if len(parts) >= 4 and parts[0] == "assets" else None


def _series_meta_index(db, hit: list | None = None) -> dict:
    """Una unica consulta para toda la metadata anual; evita una consulta por activo."""
    index: dict = {}
    query = db.collection_group("price_series")
    try:
        stream = query.select(META_FIELDS).stream()
    except Exception:
        swallowed("admin_panel.py:169")
        stream = query.stream()
    if hit is not None:
        stream = _capped_stream(stream, hit)
    for snap in stream:
        asset_id = _series_asset_id(snap)
        if not asset_id:
            continue
        current = index.get(asset_id, (None, None, 0, 0, None, None))
        index[asset_id] = _merge_series_meta(current, snap.to_dict() or {})
    return index


def _metrics_latest_index(db, hit: list | None = None) -> dict:
    """Una consulta agregada para el metrics/latest de todos los activos (DV3).
    Cuesta ~1 lectura por activo en cada reconstruccion del inventario."""
    index: dict = {}
    query = db.collection_group("metrics")
    try:
        stream = query.select(METRICS_LATEST_FIELDS).stream()
    except Exception:
        swallowed("admin_panel.py:189")
        stream = query.stream()
    if hit is not None:
        stream = _capped_stream(stream, hit)
    for snap in stream:
        if getattr(snap, "id", None) != "latest":
            continue
        asset_id = _series_asset_id(snap)
        if asset_id:
            index[asset_id] = snap.to_dict() or {}
    return index


def _drawdown_trough(d: dict):
    risk = d.get("risk") or {}
    node = risk.get("max_drawdown_hist")
    return _drawdown_date(node)


def _row(db, asset_id: str, d: dict, today: datetime.date, series_meta=None,
         metrics_latest=None) -> dict:
    """Fila de metadatos + flags para un activo (sin analisis fino de points)."""
    latest = metrics_latest if isinstance(metrics_latest, dict) else {}
    first, last, ndocs, pts, sym, ccy = (
        series_meta if series_meta is not None
        else _series_meta(db.collection("assets").document(asset_id))
    )
    risk = d.get("risk") or {}
    years = None
    if isinstance(first, str) and isinstance(last, str) and len(first) >= 4 and len(last) >= 4:
        years = max(0, int(last[:4]) - int(first[:4]))
    stale = False
    if isinstance(last, str) and len(last) >= 10:
        try:
            stale = (today - datetime.date.fromisoformat(last[:10])).days > STALE_DAYS
        except Exception:
            swallowed_quiet("admin_panel.py:226")
            stale = False
    latest_hist = latest.get("max_drawdown_hist")
    trough = _drawdown_date(latest_hist) or _drawdown_trough(d)
    trough_recent = False
    if isinstance(trough, str) and isinstance(last, str) and len(trough) >= 10 and len(last) >= 10:
        try:
            trough_recent = (datetime.date.fromisoformat(last[:10]) - datetime.date.fromisoformat(trough[:10])).days <= 10
        except Exception:
            swallowed_quiet("admin_panel.py:234")
            trough_recent = False
    flags = []
    if pts == 0:
        flags.append("SIN_HISTORICO")
    elif pts < 20:
        flags.append("HISTORICO_CORTO")
    if stale:
        flags.append("DESACTUALIZADO")
    if isinstance(first, str) and len(first) >= 4 and int(first[:4]) > TARGET_START_YEAR:
        flags.append("NO_LLEGA_2011")
    if trough_recent:
        flags.append("VALLE_RECIENTE")
    quality = d.get("quality")
    canonical_active = bool(
        ISIN_RE.fullmatch(str(asset_id or "").upper())
        and not (isinstance(quality, dict) and quality.get("status") == "ARCHIVED_LEGACY")
    )
    return {
        "asset_id": asset_id,
        "canonical_active": canonical_active,
        "name": _name(d),
        "type": _itype(d),
        "symbol": sym,
        "currency": ccy,
        "first_date": first,
        "last_date": last,
        "points": pts,
        "year_docs": ndocs,
        "years": years,
        "has_vol": _has_period_num(risk, "volatilidad_pct", "volatility_3y"),
        "has_sharpe": _has_period_num(risk, "sharpe"),
        "has_srri": _has_num(risk, "srri_1a7", "sri_kid_1a7"),
        "has_mdd": _has_num(latest, "max_drawdown_5y", "max_drawdown") or _has_num(risk, "max_drawdown"),
        "has_mdd_hist": _has_num(latest, "max_drawdown_hist") or _has_num(risk, "max_drawdown_hist"),
        "flags": flags,
    }


def build_admin_inventory(db=None, today: datetime.date | None = None,
                          source_versions: dict | None = None) -> dict:
    """Materializa las filas caras una vez; el panel pagina sobre este snapshot."""
    db = db or _db()
    today = today or _today()
    truncated: list = []
    assets = list(_capped_stream(db.collection("assets").stream(), truncated))
    series_index = _series_meta_index(db, hit=truncated)
    metrics_index = _metrics_latest_index(db, hit=truncated)
    rows = [
        _row(
            db,
            snap.id,
            snap.to_dict() or {},
            today,
            series_index.get(snap.id, (None, None, 0, 0, None, None)),
            metrics_latest=metrics_index.get(snap.id),
        )
        for snap in assets
    ]
    return {
        "schema_version": "admin-asset-inventory.v1",
        "builder_version": ADMIN_INVENTORY_BUILDER_VERSION,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "count": len(rows),
        "rows": rows,
        "source_versions": dict(source_versions or {}),
        # True si algún stream tocó ADMIN_INVENTORY_MAX_DOCS: filas incompletas.
        "truncated": bool(truncated),
    }


def _inventory(db) -> dict:
    """Inventario con su fecha: {rows, generated_at, source}.

    H10 (auditoria 14-10-2026): el panel presentaba el inventario ALMACENADO (que
    integridad reconstruye solo si cambia el censo o pasa una semana) con la fecha de
    la consulta. `generated_at` es la del documento; `source` dice si es el
    almacenado (STORED) o uno construido en vivo porque no lo habia (LIVE).
    """
    try:
        snap = db.collection("meta").document(ADMIN_INVENTORY_DOC).get()
        data = snap.to_dict() or {} if getattr(snap, "exists", False) else {}
        rows = data.get("rows")
        if data.get("schema_version") == "admin-asset-inventory.v1" and isinstance(rows, list):
            return {
                "rows": [row for row in rows if isinstance(row, dict)],
                "generated_at": data.get("generated_at"),
                "source": "STORED",
            }
    except Exception:
        swallowed("admin_panel.py:312")
        pass
    live = build_admin_inventory(db=db)
    return {"rows": live["rows"], "generated_at": live.get("generated_at"), "source": "LIVE"}


def _inventory_rows(db) -> list[dict]:
    return _inventory(db)["rows"]


def db_status(sample: int = 0) -> dict:
    db = _db()
    inventory = _inventory(db)
    rows = inventory["rows"]
    if sample:
        rows = rows[:sample]
    total = len(rows)
    by_type: dict = {}
    with_hist = sin_hist = stale = no_2011 = valle_reciente = 0
    metrics_present = {"vol": 0, "sharpe": 0, "srri": 0, "mdd": 0, "mdd_hist": 0}
    start_year_hist: dict = {}
    latest_by_type: dict = {}
    latest_data_date = None
    lagged_rows = []
    flagged = 0
    last_refresh = None
    try:
        meta = db.collection("meta").document("price_refresh").get()
        if meta.exists:
            last_refresh = (meta.to_dict() or {}).get("last_run_date")
    except Exception:
        swallowed_quiet("admin_panel.py:336")
        last_refresh = None

    for row in rows:
        by_type[row["type"]] = by_type.get(row["type"], 0) + 1
        last_date = row.get("last_date")
        if isinstance(last_date, str) and len(last_date) >= 10:
            last_key = last_date[:10]
            if latest_data_date is None or last_key > latest_data_date:
                latest_data_date = last_key
            if row["type"] not in latest_by_type or last_key > latest_by_type[row["type"]]:
                latest_by_type[row["type"]] = last_key
            lagged_rows.append({
                "asset_id": row["asset_id"],
                "name": row["name"],
                "type": row["type"],
                "last_date": last_key,
            })
        if row["points"] > 0:
            with_hist += 1
        else:
            sin_hist += 1
        if row["has_vol"]:
            metrics_present["vol"] += 1
        if row["has_sharpe"]:
            metrics_present["sharpe"] += 1
        if row["has_srri"]:
            metrics_present["srri"] += 1
        if row["has_mdd"]:
            metrics_present["mdd"] += 1
        if row["has_mdd_hist"]:
            metrics_present["mdd_hist"] += 1
        if "DESACTUALIZADO" in row["flags"]:
            stale += 1
        if "NO_LLEGA_2011" in row["flags"]:
            no_2011 += 1
        if "VALLE_RECIENTE" in row["flags"]:
            valle_reciente += 1
        if row["flags"]:
            flagged += 1
        if isinstance(row["first_date"], str) and len(row["first_date"]) >= 4:
            yr = row["first_date"][:4]
            start_year_hist[yr] = start_year_hist.get(yr, 0) + 1

    return {
        # `generated_at` es la hora de esta consulta; las cifras salen del inventario,
        # que tiene la suya (`inventory_generated_at`).
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "inventory_generated_at": inventory.get("generated_at"),
        "inventory_source": inventory.get("source"),
        "total_assets": total,
        "by_type": by_type,
        "with_history": with_hist,
        "without_history": sin_hist,
        "reach_2011": with_hist - no_2011,
        "not_reach_2011": no_2011,
        "stale": stale,
        "stale_days_threshold": STALE_DAYS,
        "last_refresh_date": last_refresh,
        "latest_data_date": latest_data_date,
        "latest_by_type": dict(sorted(latest_by_type.items())),
        "most_lagged": sorted(lagged_rows, key=lambda r: (r["last_date"], r["name"].lower()))[:5],
        "metrics_present": metrics_present,
        "start_year_histogram": dict(sorted(start_year_hist.items())),
        "anomalies": {
            "sin_historico": sin_hist,
            "desactualizados": stale,
            "no_llega_2011": no_2011,
            "valle_reciente": valle_reciente,
            "total_flagged": flagged,
        },
    }


def list_assets(type_filter: Optional[str] = None, only_flagged: bool = False,
                limit: int = 100, offset: int = 0, sort_by: Optional[str] = None,
                sort_dir: str = "asc") -> dict:
    db = _db()
    rows = [
        row for row in _inventory_rows(db)
        if (not type_filter or row.get("type") == type_filter.upper())
        and (not only_flagged or bool(row.get("flags")))
    ]
    if sort_by == "last_date":
        reverse = str(sort_dir).lower() == "desc"
        dated = [r for r in rows if isinstance(r.get("last_date"), str) and r.get("last_date")]
        undated = [r for r in rows if r not in dated]
        dated.sort(key=lambda r: r["last_date"], reverse=reverse)
        rows = dated + undated
    else:
        rows.sort(key=lambda r: (0 if r["flags"] else 1, r["name"].lower()))
    page = rows[offset:offset + limit]
    return {"total": len(rows), "offset": offset, "limit": limit, "items": page}


def _analyze_points(ref) -> dict:
    """Analisis fino de la serie de UN activo: huecos, duplicados, valores<=0."""
    by_date = {}
    dups = nonpos = 0
    for snap in ref.collection("price_series").stream():
        d = snap.to_dict() or {}
        pts = d.get("points")
        if not isinstance(pts, list):
            continue
        for p in pts:
            if not isinstance(p, dict):
                continue
            dt = str(p.get("date") or "")[:10]
            try:
                v = float(p.get("value"))
            except Exception:
                swallowed_quiet("admin_panel.py:442")
                v = None
            if not dt:
                continue
            if v is None or v <= 0:
                nonpos += 1
                continue
            if dt in by_date:
                dups += 1
            by_date[dt] = v
    dates = sorted(by_date.keys())
    big_gaps = []
    for i in range(1, len(dates)):
        try:
            gap = (datetime.date.fromisoformat(dates[i]) - datetime.date.fromisoformat(dates[i - 1])).days
        except Exception:
            swallowed_quiet("admin_panel.py:457")
            continue
        if gap > 10:  # > ~1.5 semanas sin dato (festivos aparte)
            big_gaps.append({"from": dates[i - 1], "to": dates[i], "days": gap})
    return {
        "points": len(dates),
        "first_date": dates[0] if dates else None,
        "last_date": dates[-1] if dates else None,
        "duplicates": dups,
        "non_positive": nonpos,
        "big_gaps": big_gaps[:20],
        "big_gaps_count": len(big_gaps),
    }


def asset_detail(asset_id: str) -> Optional[dict]:
    db = _db()
    ref = db.collection("assets").document(asset_id)
    snap = ref.get()
    if not snap.exists:
        return None
    d = snap.to_dict() or {}
    try:
        latest_snap = ref.collection("metrics").document("latest").get()
        latest = latest_snap.to_dict() or {} if getattr(latest_snap, "exists", False) else {}
    except Exception as exc:
        print("[admin] metrics/latest no disponible para %s:" % asset_id, repr(exc))
        latest = {}
    row = _row(db, asset_id, d, _today(), metrics_latest=latest)
    risk = d.get("risk") or {}

    # DV3: preferir metrics/latest (donde escribe el refresco diario) con el root legado
    # como respaldo. Ronda 2 (14-10-2026): las dos se devuelven en la forma del contrato
    # de metricas, {value (decimal, <= 0), date}; antes salia metrics/latest tal cual
    # ({value, date}) y el panel leia {pct, fecha}, asi que se veia en blanco.
    latest_hist = latest.get("max_drawdown_hist")
    hist = (
        _contract_drawdown(latest_hist.get("value"), latest_hist.get("date"))
        if isinstance(latest_hist, dict) else None
    ) or _legacy_drawdown(risk.get("max_drawdown_hist"))
    five_years = _contract_drawdown(latest.get("max_drawdown_5y"))
    if five_years is None:
        legacy_5y = risk.get("max_drawdown")
        if isinstance(legacy_5y, dict) and legacy_5y.get("periodo") in (None, "5a"):
            five_years = _legacy_drawdown(legacy_5y)

    return {
        "meta": row,
        "identifiers": d.get("identifiers") or {},
        "classification": d.get("classification") or {},
        "max_drawdown_5y": five_years,
        "max_drawdown_hist": hist,
        # TRANSITORIO (14-10-2026): el frontend publicado hasta esta version exige la
        # clave antigua `max_drawdown` (lanza error de contrato si falta). Se devuelve
        # tambien, con la forma vieja {pct, periodo}, para no depender del orden de
        # despliegue. Retirar en la version siguiente, una vez publicado el frontend
        # que lee max_drawdown_5y (a partir del 28-10-2026).
        "max_drawdown": (
            {"pct": round(five_years["value"] * 100.0, 6), "periodo": "5a"} if five_years else None
        ),
        "series": _analyze_points(ref),
    }


def fund_quality(asset_id=None) -> dict:
    """Dated audit inventory, admin-only at the callable boundary."""
    if asset_id is not None:
        if not isinstance(asset_id, str) or not ISIN_RE.fullmatch(asset_id):
            raise ValueError("ISIN no válido.")
        snap = _db().collection("assets").document(asset_id).collection("fund_profile").document("latest").get()
        return {"profile": snap.to_dict() if snap.exists else None}
    snap = _db().collection("meta").document("fund_data_quality").get()
    if not snap.exists:
        raise RuntimeError("El inventario de calidad todavía no está disponible.")
    return snap.to_dict()
