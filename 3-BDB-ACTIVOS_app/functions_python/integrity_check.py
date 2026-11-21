# -*- coding: utf-8 -*-
"""
Job de INTEGRIDAD diario (read-only + un doc de estado).

Reconciliación barata de invariantes entre las piezas de la maestra que, de
romperse, históricamente solo se descubrían en auditorías manuales
(auditorías 2026-07-10/11):

  1. Índice de búsqueda vs maestra: activos ISIN vivos que faltan en
     meta/search_index (invisibles al buscador) y entradas huérfanas.
  2. Solapamiento assets ∩ _archived_assets (archivado que copió sin borrar).
  3. commercial_retro con ISIN que no existe ni vivo ni archivado.
  4. Carteras bajo padres fantasma en bdb_activos (conteo, vía list_documents).
  5. Frescura de watermarks: meta/price_refresh, meta/metrics_refresh
     (incluye cycle_completed/stopped_by_budget) y meta/backup_status
     (marcador opcional del backup local; UNKNOWN si no existe).

Publica un semáforo en meta/integrity_status:
  {checked_at, status: OK|WARN|FAIL|..., problems: [...], counts: {...}}
y emite una línea de log "integrity_status:" (para alertas log-based).

Escritura gated: BDB_ACTIVOS_ENABLE_MASTER_WRITES + INTEGRITY_WRITE_ENABLED.
Coste aproximado: ~1.2k lecturas/día (streams con select([]) sin campos).

Prueba local (ADC): python -c "import integrity_check as i; print(i.run_integrity_check())"
"""
import datetime
import json
import os
import re
from quietlog import swallowed
from datetime import timezone

from write_governance import (
    log_master_write_decision,
    master_writes_enabled,
    require_master_writes_enabled,
)

INTEGRITY_WRITE_ENV = "INTEGRITY_WRITE_ENABLED"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Umbrales de frescura (dias naturales).
PRICE_WARN_DAYS = 2
PRICE_FAIL_DAYS = 4
METRICS_WARN_DAYS = 2
METRICS_FAIL_DAYS = 7
# Politica de backup SEMANAL (decision 27-07-2026): la tarea local corre una vez
# por semana con "ejecutar si se perdio el inicio" (PC apagado/festivos). El
# semaforo avisa si se salta una semana y falla con dos perdidas. Ajustable por
# env sin redeploy.
BACKUP_WARN_DAYS = int(os.environ.get("BACKUP_WARN_DAYS", 9))
BACKUP_FAIL_DAYS = int(os.environ.get("BACKUP_FAIL_DAYS", 16))
# S4 (auditoría 27-07): edad máxima del inventario admin antes de reconstruirlo.
# Reconstruir cuesta ~12k lecturas y las fuentes cambian a diario, así que el
# criterio "¿cambiaron las fuentes?" lo reconstruía casi cada día (el pico de
# lecturas del domingo 26-07). Semanal + censo cubre el uso real del panel.
INVENTORY_MAX_AGE_DAYS = float(os.environ.get("INVENTORY_MAX_AGE_DAYS", 7))


def integrity_writes_enabled() -> bool:
    return os.environ.get(INTEGRITY_WRITE_ENV, "").lower() in ("1", "true", "yes", "on")


def _now():
    return datetime.datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_dt(value):
    try:
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        swallowed("integrity_check.py:84")
        return None


def _age_days(value, now) -> float | None:
    dt = _parse_dt(value)
    if dt is None:
        return None
    return (now - dt).total_seconds() / 86400.0


def _doc_ids(db, collection: str) -> set:
    return {snap.id for snap in db.collection(collection).select([]).stream()}


def _meta_doc(db, name: str) -> dict | None:
    snap = db.collection("meta").document(name).get()
    if not getattr(snap, "exists", False):
        return None
    return snap.to_dict() or {}


def _inventory_source_versions(index_doc: dict, price_meta: dict, metrics_meta: dict) -> dict:
    """Versiones de datos que obligan a regenerar el inventario caro."""
    return {
        "assets": index_doc.get("updated_at"),
        "prices": price_meta.get("data_changed_at"),
        "metrics": metrics_meta.get("data_changed_at"),
    }


def _check_freshness(problems: list, label: str, age: float | None,
                     warn_days: float, fail_days: float, missing_msg: str) -> str:
    if age is None:
        problems.append({"severity": "WARN", "check": label, "detail": missing_msg})
        return "UNKNOWN"
    if age > fail_days:
        problems.append({"severity": "FAIL", "check": label,
                         "detail": f"{age:.1f} dias de antiguedad (umbral {fail_days})"})
        return "FAIL"
    if age > warn_days:
        problems.append({"severity": "WARN", "check": label,
                         "detail": f"{age:.1f} dias de antiguedad (umbral {warn_days})"})
        return "WARN"
    return "OK"


def _check_meta_sizes(db, payload: dict, index_doc: dict, inventory: dict | None = None) -> None:
    """Ronda 2 (ALTA-07): aviso si algun documento meta/* agregado pasa de 800 KiB.

    `index_doc` ya se leyo arriba; el inventario es el recien escrito (o el guardado) y
    el de calidad de fondos se lee aqui (una lectura mas por ejecucion)."""
    from meta_size import size_warning

    documents = {
        "search_index": index_doc,
        "admin_asset_inventory": inventory if inventory is not None else _meta_doc(db, "admin_asset_inventory"),
        "fund_data_quality": _meta_doc(db, "fund_data_quality"),
    }
    for name, data in documents.items():
        warning = size_warning(name, data)
        if warning:
            payload["problems"].append(warning)
            if payload["status"] == "OK":
                payload["status"] = "WARN"


def run_integrity_check(write: bool = False, db=None, now=None) -> dict:
    operation = "integrity_check"
    if write:
        require_master_writes_enabled(operation)
        if not integrity_writes_enabled():
            raise RuntimeError(
                f"INTEGRITY_WRITES_DISABLED: set {INTEGRITY_WRITE_ENV}=true para escribir meta/integrity_status.")
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True)

    if db is None:
        # MEDIA-7 (14-10-2026): un cliente por proceso; escritor (corre con bdb-functions-writer).
        from master_write_client import get_master_write_db
        db = get_master_write_db()
    now = now or _now()
    problems: list[dict] = []

    # --- 1) maestra vs indice de busqueda -------------------------------
    asset_ids = _doc_ids(db, "assets")
    active_isins = {a for a in asset_ids if ISIN_RE.match(a)}
    index_doc = _meta_doc(db, "search_index") or {}
    entries = index_doc.get("entries") if isinstance(index_doc.get("entries"), list) else []
    index_ids = {str(e.get("id")) for e in entries if isinstance(e, dict) and e.get("id")}
    index_missing = sorted(active_isins - index_ids)
    index_orphans = sorted(i for i in index_ids - asset_ids if ISIN_RE.match(i))
    if index_missing:
        problems.append({"severity": "WARN", "check": "search_index_missing",
                         "detail": f"{len(index_missing)} activos vivos fuera del buscador",
                         "sample": index_missing[:10]})
    if index_orphans:
        problems.append({"severity": "WARN", "check": "search_index_orphans",
                         "detail": f"{len(index_orphans)} entradas del indice sin activo vivo",
                         "sample": index_orphans[:10]})

    # --- 2) archivado inconsistente -------------------------------------
    # Both archive flows remain recoverable and must be recognised.
    archived_ids = _doc_ids(db, "_archived_assets") | _doc_ids(db, "_archived")
    overlap = sorted(asset_ids & archived_ids)
    if overlap:
        problems.append({"severity": "WARN", "check": "archived_overlap",
                         "detail": f"{len(overlap)} ids a la vez en assets y una coleccion de archivo",
                         "sample": overlap[:10]})

    # --- 3) retrocesiones huerfanas --------------------------------------
    retro_ids = _doc_ids(db, "commercial_retro")
    retro_orphans = sorted(retro_ids - asset_ids - archived_ids)
    if retro_orphans:
        problems.append({"severity": "WARN", "check": "commercial_retro_orphans",
                         "detail": f"{len(retro_orphans)} retrocesiones sin activo (ni archivado)",
                         "sample": retro_orphans[:10]})

    # --- 4) carteras app-owned (padres fantasma incluidos) ---------------
    portfolios_count = 0
    portfolio_owners = 0
    for parent_ref in db.collection("bdb_activos").list_documents():
        portfolio_owners += 1
        portfolios_count += sum(
            1 for _ in parent_ref.collection("portfolios").select([]).stream())

    # --- 5) frescura de watermarks ---------------------------------------
    price_meta = _meta_doc(db, "price_refresh") or {}
    metrics_meta = _meta_doc(db, "metrics_refresh") or {}
    backup_meta = _meta_doc(db, "backup_status")

    price_state = _check_freshness(
        problems, "price_refresh_freshness",
        _age_days(price_meta.get("last_run"), now),
        PRICE_WARN_DAYS, PRICE_FAIL_DAYS, "meta/price_refresh sin last_run")
    metrics_state = _check_freshness(
        problems, "metrics_refresh_freshness",
        _age_days(metrics_meta.get("last_run"), now),
        METRICS_WARN_DAYS, METRICS_FAIL_DAYS, "meta/metrics_refresh sin last_run")
    if metrics_meta.get("stopped_by_budget") and not metrics_meta.get("cycle_completed"):
        problems.append({"severity": "INFO", "check": "metrics_cycle_partial",
                         "detail": "ultimo ciclo de metricas parcial (continua en la proxima ejecucion)"})
    backup_state = _check_freshness(
        problems, "backup_freshness",
        _age_days((backup_meta or {}).get("completed_at"), now),
        BACKUP_WARN_DAYS, BACKUP_FAIL_DAYS,
        "meta/backup_status ausente (el backup local no publica marcador)")

    # Separate watchdog: a timed-out recovery must not leave a stale green marker.
    from report_publication import check_due_report_publications
    try:
        problems.extend(check_due_report_publications(db, now, write=write))
    except Exception as exc:
        problems.append({"severity": "WARN", "check": "strategy_report_publication",
                         "detail": "No se pudo comprobar la publicacion: " + type(exc).__name__})

    # Source-specific refresh is separate from the EODHD watermark.
    reviewed = _meta_doc(db, "reviewed_nav_refresh") or {}
    if reviewed:
        _check_freshness(problems, "reviewed_nav_refresh_freshness",
                         _age_days(reviewed.get("last_run"), now), 3, 7,
                         "Refresco de fuentes NAV sin fecha")
        if reviewed.get("errors"):
            problems.append({"severity":"WARN", "check":"reviewed_nav_sources",
                             "detail":"Hay fuentes NAV que requieren revision",
                             "sample":[r["asset_id"] for r in reviewed.get("results",[])
                                       if r.get("status")=="REVIEW_REQUIRED"][:10]})
    # Two reviewed cases remain stale at their providers. Resolve the warning
    # automatically when the normal refresher and metrics advance again.
    for asset_id in ("LU1066281574", "LU2240056445"):
        snap = db.collection("assets").document(asset_id).collection("metrics").document("latest").get()
        if snap.exists and (_age_days((snap.to_dict() or {}).get("last_date"), now) or 0) > 7:
            problems.append({"severity":"WARN", "check":"upstream_nav_stale",
                             "detail":f"{asset_id}: el proveedor sigue sin publicar un NAV reciente",
                             "sample":[asset_id]})

    # --- semaforo global --------------------------------------------------
    severities = {p["severity"] for p in problems}
    status = "FAIL" if "FAIL" in severities else ("WARN" if "WARN" in severities else "OK")

    payload = {
        "checked_at": _now_iso(),
        "status": status,
        "problems": problems,
        "counts": {
            "assets_total": len(asset_ids),
            "assets_isin_active": len(active_isins),
            "archived": len(archived_ids),
            "archived_overlap": len(overlap),
            "search_index_entries": len(index_ids),
            "search_index_missing": len(index_missing),
            "search_index_orphans": len(index_orphans),
            "commercial_retro": len(retro_ids),
            "commercial_retro_orphans": len(retro_orphans),
            "portfolio_owners": portfolio_owners,
            "portfolios": portfolios_count,
        },
        "freshness": {
            "price_refresh": price_state,
            "metrics_refresh": metrics_state,
            "backup": backup_state,
        },
        "applied": bool(write),
    }

    inventory = None
    if write:
        from admin_panel import (
            ADMIN_INVENTORY_BUILDER_VERSION,
            ADMIN_INVENTORY_MAX_DOCS,
            build_admin_inventory,
        )
        source_versions = _inventory_source_versions(index_doc, price_meta, metrics_meta)
        inventory_ref = db.collection("meta").document("admin_asset_inventory")
        inventory_snap = inventory_ref.get()
        current_inventory = inventory_snap.to_dict() if inventory_snap.exists else {}
        # S4: reconstruir solo si cambia el CENSO (altas/bajas de activos) o si
        # el snapshot supera INVENTORY_MAX_AGE_DAYS con fuentes cambiadas. Las
        # columnas por-activo (last_date, caída) pueden ir hasta N días por
        # detrás; el detalle del panel lee metrics/latest en vivo.
        census_changed = int(current_inventory.get("count") or -1) != len(asset_ids)
        # Un deploy que cambia QUÉ contienen las filas sube builder_version:
        # fuerza una única reconstrucción sin esperar a la semana.
        builder_stale = current_inventory.get("builder_version") != ADMIN_INVENTORY_BUILDER_VERSION
        inventory_age = _age_days(current_inventory.get("generated_at"), now)
        too_old = inventory_age is None or inventory_age > INVENTORY_MAX_AGE_DAYS
        sources_changed = current_inventory.get("source_versions") != source_versions
        inventory_rebuilt = census_changed or builder_stale or (sources_changed and too_old)
        if inventory_rebuilt:
            inventory = build_admin_inventory(
                db=db, today=now.date(), source_versions=source_versions)
            inventory_ref.set(inventory)
        else:
            inventory = current_inventory
        if inventory.get("truncated"):
            payload["problems"].append({
                "severity": "WARN", "check": "admin_inventory_truncated",
                "detail": f"inventario recortado al tope de {ADMIN_INVENTORY_MAX_DOCS} docs; "
                          "filas posiblemente incompletas"})
            if payload["status"] == "OK":
                payload["status"] = "WARN"
        payload["counts"]["admin_inventory_rows"] = int(inventory.get("count") or 0)
        # int, no bool: el contrato del cliente (systemStatusBackend) exige entero no
        # negativo para todo integrity.counts.* — un booleano rompia /sistema entero.
        payload["counts"]["admin_inventory_rebuilt"] = int(inventory_rebuilt)
        # B-07 (auditoria 29-09): el inventario semanal de calidad de fondos
        # recorre todas las price_series; un timeout o error suyo no puede
        # dejar meta/integrity_status sin publicar. Se degrada a WARN.
        import fund_data_quality
        try:
            payload["counts"]["fund_quality_rebuilt"] = int(fund_data_quality.refresh_inventory_if_due(db, now))
        except Exception as exc:  # noqa: BLE001 — publicar el semaforo pese al fallo
            payload["counts"]["fund_quality_rebuilt"] = 0
            payload["problems"].append({
                "severity": "WARN", "check": "fund_quality_inventory",
                "detail": "inventario de calidad no actualizado: %s: %s" % (
                    type(exc).__name__, str(exc)[:200])})
            if payload["status"] == "OK":
                payload["status"] = "WARN"
    # Como B-07: un fallo al medir (p. ej. una lectura que falla) no puede dejar
    # meta/integrity_status sin publicar. Se degrada a WARN con el motivo.
    try:
        _check_meta_sizes(db, payload, index_doc, inventory)
    except Exception as exc:  # noqa: BLE001 - publicar el semaforo pese al fallo
        payload["problems"].append({
            "severity": "WARN", "check": "meta_document_size",
            "detail": "no se pudo medir el tamano de meta/*: %s: %s" % (type(exc).__name__, str(exc)[:200])})
        if payload["status"] == "OK":
            payload["status"] = "WARN"
    if write:
        db.collection("meta").document("integrity_status").set(payload)

    print("integrity_status:", json.dumps(payload, ensure_ascii=True, default=str))
    return payload
