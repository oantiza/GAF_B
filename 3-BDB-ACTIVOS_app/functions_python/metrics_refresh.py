# -*- coding: utf-8 -*-
"""
Recalculo SEMANAL de la MAXIMA CAIDA (max drawdown) desde el price_series ya
almacenado. NO usa EODHD: pura computacion sobre lo que hay en Firestore.

Escribe en la BBDD MAESTRA:
  assets/{asset_id}/metrics/latest.max_drawdown_hist = {value, date}
  assets/{asset_id}/metrics/drawdown_state (estado del máximo acumulado)

No escribe ya en root.risk.max_drawdown*. El doc metrics/latest sigue contrato
metrics.v1.2 y se actualiza solo si el last_date de price_series mejora.

Máximo acumulado (S4, auditoría 27-07): el drawdown histórico es un algoritmo
online (pico corriente + peor caída). En vez de releer TODOS los docs anuales de
price_series por activo (~10-35 lecturas), se guarda el estado consolidado a
cierre de año en metrics/drawdown_state y a diario solo se leen los docs con
year > base_year (1-3 docs). El año recién cerrado NO se consolida hasta pasado
el 15 de enero: la ventana de solape del refresco de precios (~7 días) puede
revisar puntos de finales de diciembre durante los primeros días de enero.
metrics.v1.2 tiene additionalProperties:false, por eso el estado vive en un doc
hermano y no dentro de latest. Tras recargas manuales de histórico, recompute_one
reconstruye el estado.

Ventanas al dia (13-10-2026): las ventanas 1y/3y/5y/10y, el YTD y el drawdown
a 5 anios solo los calculaba la ingesta, y este refresco solo fusionaba el
drawdown historico, `last_date` y `updated_at`. El documento parecia fresco con
ventanas congeladas: VALENTUM (ES0182769002) guardaba 1y = 28,45 % y su propia
serie daba 19,15 %. Ahora, cuando metrics/latest es CALCULO PROPIO
(SELF_COMPUTED_SOURCES) y la serie avanza, se recalcula el documento entero con
`ingest_asset.build_metrics_latest` sobre la serie completa (carga completa, sin
estado), y `last_date` vuelve a ser la fecha real de las ventanas. Las ventanas
del proveedor (`method: TRAILING_PROVIDER`, las que la reconciliacion dejo con
Morningstar) se conservan tal cual. Los documentos del proveedor
(FONDOSDB_ROOT_ES) siguen por el camino de siempre: solo el drawdown.

El recalculo lee la serie entera (~20 lecturas por activo, ~22.000 para toda la
poblacion) y el tope de cada ejecucion sigue en METRICS_REFRESH_MAX_READS
(6.000 desplegado): el ciclo se reparte en varias ejecuciones con el cursor
`scan_after_asset_id` de meta/metrics_refresh, como ya se hacia. La pasada en
seco no escribe ese cursor; quien encadena ciclos en seco
(scripts/run_metrics_refresh.py) se lo pasa de uno a otro con `start_after`.

Cuatro ejecuciones programadas al dia (08:30, 09:00, 09:30 y 10:00, decision de
Oscar del 14-10-2026), mismo tope cada una: siguen el cursor de la anterior y,
cuando la vuelta del dia ya esta completa (`cycle_completed_on` = hoy en
Madrid), las siguientes terminan tras leer solo meta/metrics_refresh
(`once_per_day`). Las ejecuciones manuales no usan esa compuerta.

Requiere que el service account de las functions tenga roles/datastore.user SOBRE
el proyecto de la maestra (el mismo permiso que el refresco diario de precios).

Prueba local (desde functions_python/, con ADC):
    python -c "import metrics_refresh as m; print(m.refresh_max_drawdown(limit=10))"
"""
import os
import datetime
import re
from fund_history_quality import usable_documents, policy_for
from quietlog import swallowed, swallowed_quiet
from datetime import timezone

import clock

from google.cloud import firestore as gcf
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.field_path import FieldPath

from contract_validation import ContractValidationError, validate_contract
from write_governance import (
    log_master_write_decision,
    master_writes_enabled,
    require_master_writes_enabled,
)

WINDOW_YEARS = int(os.environ.get("MDD_WINDOW", "5"))  # ventana titular, en anios
MIN_POINTS = 20
DEFAULT_MAX_READS = int(os.environ.get("METRICS_REFRESH_MAX_READS", os.environ.get("BDB_REFRESH_MAX_READS", "6000")))
METRICS_WRITE_ENV = "METRICS_WRITE_ENABLED"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

STATE_DOC_ID = "drawdown_state"
STATE_SCHEMA_VERSION = "metrics-drawdown-state.v1"
# Hasta este día del año, el año anterior aún puede recibir revisiones por la
# ventana de solape del refresco de precios (7 días + margen): no consolidar.
CONSOLIDATION_SAFE_YDAY = 15
# Lecturas mínimas libres para intentar una carga completa de serie (peor caso
# ~35 docs anuales). Por debajo, se para limpio y se retoma en la siguiente run.
FULL_LOAD_READ_FLOOR = int(os.environ.get("METRICS_FULL_LOAD_READ_FLOOR", "40"))

# Fuentes de metrics/latest que calcula la app sobre la serie de la maestra
# (ingest_asset, fund_ingest y la politica de historico R-04). Son las unicas
# cuyo documento entero recalcula este refresco; el resto (FONDOSDB_ROOT_ES:
# trailing de Morningstar que copia la plataforma) solo recibe el drawdown.
SELF_COMPUTED_SOURCES = frozenset({
    "FONDOSDB_EODHD_DAILY_HISTORY",
    "FONDOSDB_FUND_NAV_EUR",
    "FUND_QUALITY_REVIEW_V1",
})
DETAIL_WINDOWS = ("1y", "3y", "5y", "10y")

# metrics/latest que este refresco no toca nunca: ni la puesta al dia
# (--force-windows) ni el refresco diario ni recompute_one escriben en ellos
# (ni ventanas, ni last_date, ni drawdown, ni firma). Exclusion explicita por
# ISIN; no se extiende a toda la marca PRICE_FROZEN_DELISTED.
# - ES0161560018 NH Hoteles: excluida de cotizacion el 24-09-2025 y con el
#   precio prolongado plano (fund_history_policies.json). El recalculo le
#   cambiaba la firma a FUND_QUALITY_REVIEW_V1 y el mapper habria empezado a
#   publicar unas metricas que hoy no usa. Decision de Oscar del 14-10-2026.
METRICS_REFRESH_EXCLUDED = frozenset({"ES0161560018"})

# Las ejecuciones programadas cuentan el dia en hora de Madrid, como su cron.
MADRID = clock.MADRID


class ReadBudgetExceeded(RuntimeError):
    pass


class ReadBudget:
    def __init__(self, max_reads: int = 0):
        self.max_reads = int(max_reads or 0)
        self.reads = 0

    def add(self, count: int = 1, context: str = ""):
        # S4: comprobar ANTES de contar (como en price_refresh) — el aviso salta
        # sin inflar el contador con lecturas que ya no se van a hacer.
        count = max(0, int(count))
        if self.max_reads and self.reads + count > self.max_reads:
            msg = "READ_BUDGET_EXCEEDED metrics_refresh reads=%d max=%d context=%s" % (
                self.reads, self.max_reads, context
            )
            print("ERROR", msg)
            raise ReadBudgetExceeded(msg)
        self.reads += count

    def remaining(self) -> int | None:
        return None if not self.max_reads else max(0, self.max_reads - self.reads)


def _master_db():
    # MEDIA-7 (14-10-2026): un cliente por proceso en vez de uno por llamada, el mismo
    # de los demas escritores (price_refresh, search_index, integridad); las credenciales
    # son las del service account del runtime (bdb-functions-writer en los jobs).
    from master_write_client import get_master_write_db
    return get_master_write_db()


def _parse_date(s):
    try:
        return datetime.date.fromisoformat(str(s)[:10])
    except Exception:
        swallowed("metrics_refresh.py:94")
        return None


def _is_active_canonical_asset(asset_id, data):
    if not ISIN_RE.match(str(asset_id or "").upper()):
        return False
    quality = data.get("quality") if isinstance(data, dict) else None
    if isinstance(quality, dict) and quality.get("status") == "ARCHIVED_LEGACY":
        return False
    return True


def _now_iso():
    return datetime.datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def metrics_writes_enabled() -> bool:
    return os.environ.get(METRICS_WRITE_ENV, "").lower() in ("1", "true", "yes", "on")


def require_metrics_writes_enabled(operation: str) -> None:
    if not metrics_writes_enabled():
        raise RuntimeError(f"METRICS_WRITES_DISABLED: set {METRICS_WRITE_ENV}=true to write metrics/latest.")


def _guard_price_history(asset_id, doc=None):
    from price_history_sync import adjustment_problem, HistoryRepairRequired
    if policy_for(asset_id).get("blocked"):
        raise HistoryRepairRequired("FUND_TOTAL_RETURN_UNVERIFIED: " + str(asset_id))
    from optimization.repository import asset_id_in_quarantine
    if asset_id_in_quarantine(asset_id) or adjustment_problem(asset_id, [doc] if doc else []):
        raise HistoryRepairRequired("QUARANTINED_PRICE_HISTORY: " + str(asset_id))
    if doc and doc.get("history_quality_status") == "BLOCKED":
        raise HistoryRepairRequired("BLOCKED_PRICE_HISTORY: " + str(asset_id))


def _write_metrics_and_state(db, ref, snapshot, payload, state_payload=None):
    # The metric snapshot is read BEFORE prices. A concurrent historical repair
    # rewrites metrics/latest atomically with prices and invalidates this write.
    batch = db.batch()
    batch.update(_metrics_latest_ref(ref), payload,
                 option=gcf.LastUpdateOption(snapshot.update_time))
    if state_payload is not None:
        batch.set(_state_ref(ref), state_payload)
    batch.commit()


def _write_full_metrics(db, ref, snapshot, payload, existing):
    """Sustituye metrics/latest por el documento recalculado, con la misma
    precondicion que el camino del drawdown. Lo que el documento vivo tenia y
    el nuevo ya no publica (p. ej. max_drawdown_5y sin cobertura) se borra: un
    campo viejo junto a ventanas nuevas es justo la mezcla que se corrige."""
    update = dict(payload)
    for key in (existing or {}):
        if key not in payload:
            update[key] = gcf.DELETE_FIELD
    batch = db.batch()
    batch.update(_metrics_latest_ref(ref), update,
                 option=gcf.LastUpdateOption(snapshot.update_time))
    batch.commit()


def _risk_free_resolver():
    """Resolutor €STR de la ingesta (cache por ventana en ecb_rates). Funcion
    aparte para sustituirlo en pruebas sin tocar la red."""
    from ingest_asset import _estr_window_resolver
    return _estr_window_resolver


def _kid_srri(existing):
    """SRRI del KID que hay que arrastrar: build_metrics_latest lo borra si no
    se le pasa, y un VOL_BUCKET no es dato regulatorio."""
    srri = (existing or {}).get("srri")
    if isinstance(srri, bool) or not isinstance(srri, int) or not 1 <= srri <= 7:
        return None
    return srri if (existing or {}).get("risk_score_source") == "SRRI" else None


def sharpe_without_rate(windows) -> bool:
    """Guarda NO_RATE: alguna ventana propia (GEOMETRIC_CAGR) trae Sharpe sin tasa sin
    riesgo. `_window_risk_free` absorbe el fallo del BCE y devuelve 0, y ese Sharpe sin
    descontar seria indistinguible de uno bueno. La comparten el refresco diario y
    scripts/improve_fund_data.py (ALTA-05, 16-10-2026)."""
    return any(isinstance(node, dict) and node.get("method") == "GEOMETRIC_CAGR"
               and node.get("sharpe_ratio") is not None and not node.get("risk_free_rate")
               for node in (windows or {}).values())


def _recomputed_metrics(asset_id, existing, values, dates, now_iso, risk_free_warnings=None):
    """Documento metrics/latest recalculado sobre la serie completa.

    Devuelve (payload, motivo); con motivo no se escribe y el documento vivo se
    queda como esta hasta la siguiente pasada:
    - NO_RATE: alguna ventana propia trae Sharpe sin tasa. `_window_risk_free`
      absorbe el fallo del BCE y devuelve 0; escribirlo seria un Sharpe sin
      descontar indistinguible de uno bueno (misma guarda que la migracion).
    - NO_WINDOWS: el vivo tenia ventanas y el recalculo no saca ninguna.

    `risk_free_warnings` (opcional) recoge las ventanas con media €STR parcial
    (RISK_FREE_RATE_PARTIAL_COVERAGE; quinta pasada, I-2): no bloquean la escritura,
    como en la simulacion, pero el refresco las cuenta en su resumen.
    """
    from ingest_asset import build_metrics_latest
    from metrics_reconciliation import merge_windows

    population = (existing or {}).get("population")
    points = [{"date": d.isoformat(), "value": v} for v, d in zip(values, dates)]
    payload = build_metrics_latest(
        asset_id, "FUND" if population == "fund" else "STOCK", points, now_iso,
        risk_free_resolver=_risk_free_resolver(), srri=_kid_srri(existing),
        risk_free_warnings=risk_free_warnings,
    )
    # La firma dice quien produjo la serie y con que calculo, no quien recalcula:
    # build_metrics_latest firma FONDOSDB_EODHD_DAILY_HISTORY, y un fondo con NAV
    # de la gestora (FONDOSDB_FUND_NAV_EUR, p. ej. Fineco Patrimonio Permanente)
    # quedaria etiquetado como EODHD. Solo la politica de historico cambia la
    # firma (FUND_QUALITY_REVIEW_V1, que el mapper exige).
    from fund_history_quality import METRICS_SOURCE as REVIEW_SOURCE
    previous = (existing or {}).get("source")
    if payload.get("source") != REVIEW_SOURCE and previous in SELF_COMPUTED_SOURCES - {REVIEW_SOURCE}:
        payload["source"] = previous
    # Ventanas que la reconciliacion dejo con el proveedor: no se tocan.
    provider = {label: node for label, node in ((existing or {}).get("windows") or {}).items()
                if isinstance(node, dict) and node.get("method") == "TRAILING_PROVIDER"}
    if provider:
        computed = payload.get("windows") or {}
        payload["windows"] = merge_windows(computed, provider, set(computed) - set(provider))
    windows = payload.get("windows") or {}
    if sharpe_without_rate(windows):
        return payload, "NO_RATE"
    if not windows and ((existing or {}).get("windows") or {}):
        return payload, "NO_WINDOWS"
    return payload, None


def _window_change(asset_id, existing, payload) -> dict:
    """Antes/despues por ventana (rentabilidad y volatilidad, en fraccion) para
    la pasada en seco."""
    old_w = (existing or {}).get("windows") or {}
    new_w = payload.get("windows") or {}
    row = {"asset_id": asset_id, "population": payload.get("population"),
           "source_before": (existing or {}).get("source"), "source_after": payload.get("source"),
           "observations_before": (existing or {}).get("observations_count"),
           "observations_after": payload.get("observations_count"),
           "last_date": payload.get("last_date"), "windows": {}}
    for label in DETAIL_WINDOWS:
        o, n = old_w.get(label) or {}, new_w.get(label) or {}
        if o or n:
            row["windows"][label] = {
                "return": [o.get("annualized_return"), n.get("annualized_return")],
                "volatility": [o.get("annualized_volatility"), n.get("annualized_volatility")],
                "method": [o.get("method"), n.get("method")],
            }
    for key in ("ytd_return", "max_drawdown_5y"):
        row[key] = [(existing or {}).get(key), payload.get(key)]
    row["max_drawdown_hist"] = [((existing or {}).get("max_drawdown_hist") or {}).get("value"),
                                (payload.get("max_drawdown_hist") or {}).get("value")]
    return row


def _load_series(ref, budget: ReadBudget | None = None):
    by_date = {}
    for snap in ref.collection("price_series").stream():
        if budget:
            budget.add(1, "price_series")
        d = snap.to_dict() or {}
        _guard_price_history(d.get("asset_id"), d)
        reviewed = usable_documents(d.get("asset_id"), [d])
        pts = reviewed[0].get("points") if reviewed else []
        if not isinstance(pts, list):
            continue
        for p in pts:
            if not isinstance(p, dict):
                continue
            dt = _parse_date(p.get("date"))
            try:
                v = float(p.get("value"))
            except Exception:
                swallowed_quiet("metrics_refresh.py:135")
                v = None
            if dt is None or v is None or v <= 0:
                continue
            by_date[dt] = v
    dates = sorted(by_date.keys())
    return [by_date[k] for k in dates], dates


def _run_drawdown(peak, worst, worst_date, values, dates):
    """Kernel online del máximo drawdown: continúa desde (peak, worst, worst_date)."""
    for v, dt in zip(values, dates):
        if peak is None or v > peak:
            peak = v
        if peak and peak > 0:
            dd = v / peak - 1.0
            if dd < worst:
                worst = dd
                worst_date = dt
    return worst, worst_date, peak


def _max_drawdown(values, dates):
    worst, worst_date, _peak = _run_drawdown(None, 0.0, None, values, dates)
    return worst, worst_date


def _consolidation_safe_year(today=None) -> int:
    """Último año cerrado cuyos datos ya no puede tocar el solape del refresco."""
    today = today or datetime.date.today()
    if today.timetuple().tm_yday > CONSOLIDATION_SAFE_YDAY:
        return today.year - 1
    return today.year - 2


def _state_ref(ref):
    return ref.collection("metrics").document(STATE_DOC_ID)


def _state_payload(base_year: int, peak, worst, worst_date, base_last_date) -> dict:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "base_year": int(base_year),
        "peak_value": float(peak),
        "mdd_value": float(worst),
        "mdd_date": worst_date.isoformat() if worst_date else None,
        "base_last_date": base_last_date.isoformat(),
        "updated_at": _now_iso(),
    }


def _load_state(ref, budget: ReadBudget | None = None) -> dict | None:
    """Estado consolidado; None si no existe o no es utilizable (→ carga completa)."""
    if policy_for(getattr(ref, "id", None)):
        return None  # Never reuse a state computed before a fund history restriction.
    snap = _state_ref(ref).get()
    if budget:
        budget.add(1, "metrics/drawdown_state")
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if data.get("schema_version") != STATE_SCHEMA_VERSION:
        return None
    try:
        base_year = int(data.get("base_year"))
        peak_value = float(data.get("peak_value"))
        mdd_value = float(data.get("mdd_value"))
    except (TypeError, ValueError):
        return None
    base_last = _parse_date(data.get("base_last_date"))
    if peak_value <= 0 or base_last is None or base_last.year > base_year:
        return None
    return {
        "base_year": base_year,
        "peak_value": peak_value,
        "mdd_value": mdd_value,
        "mdd_date": _parse_date(data.get("mdd_date")),
        "base_last_date": base_last,
    }


def _points_after_year(ref, base_year: int, budget: ReadBudget | None = None):
    """Puntos de los docs price_series con year > base_year (los años no consolidados)."""
    by_date = {}
    query = ref.collection("price_series").where(filter=FieldFilter("year", ">", int(base_year)))
    for snap in query.stream():
        if budget:
            budget.add(1, "price_series/year_gt")
        d = snap.to_dict() or {}
        _guard_price_history(d.get("asset_id"), d)
        reviewed = usable_documents(d.get("asset_id"), [d])
        pts = reviewed[0].get("points") if reviewed else []
        if not isinstance(pts, list):
            continue
        for p in pts:
            if not isinstance(p, dict):
                continue
            dt = _parse_date(p.get("date"))
            try:
                v = float(p.get("value"))
            except Exception:
                swallowed_quiet("metrics_refresh.py:231")
                v = None
            if dt is None or v is None or v <= 0:
                continue
            by_date[dt] = v
    dates = sorted(by_date.keys())
    return [by_date[k] for k in dates], dates


def _state_from_full(values, dates, safe_year: int) -> dict | None:
    """Estado consolidado hasta el 31-12 de safe_year a partir de la serie completa."""
    n = 0
    for d in dates:
        if d.year > safe_year:
            break
        n += 1
    if not n:
        return None
    worst, worst_date, peak = _run_drawdown(None, 0.0, None, values[:n], dates[:n])
    if not peak or peak <= 0:
        return None
    return _state_payload(safe_year, peak, worst, worst_date, dates[n - 1])


def _watermark(db, budget: ReadBudget) -> dict:
    snap = db.collection("meta").document("metrics_refresh").get()
    budget.add(1, "meta/metrics_refresh")
    if not snap.exists:
        return {}
    return snap.to_dict() or {}


def _madrid_today() -> str:
    # BAJA-02 (16-10-2026): el mismo reloj que price_refresh y admin_panel (clock.py).
    return clock.madrid_today().isoformat()


def _write_watermark(db, *, last_date: str | None, processed: int, written: int,
                     budget: ReadBudget, scan_after_asset_id: str | None,
                     cycle_completed: bool, scanned_assets: int,
                     stopped_by_budget: bool = False, completed_on: str | None = None) -> None:
    now = _now_iso()
    payload = {
        "last_run": now,
        "last_price_series_last_date": last_date,
        "scan_after_asset_id": scan_after_asset_id,
        "cycle_completed": bool(cycle_completed),
        "scanned_assets": scanned_assets,
        "processed_assets": processed,
        "written": written,
        "read_budget_max": budget.max_reads,
        "read_budget_used": budget.reads,
        "stopped_by_budget": bool(stopped_by_budget),
    }
    if written:
        payload["data_changed_at"] = now
    if completed_on:
        # Dia (Madrid) de la ultima vuelta programada completa; con merge, una
        # ejecucion parcial posterior lo conserva y cycle_completed=false manda.
        payload["cycle_completed_on"] = completed_on
    db.collection("meta").document("metrics_refresh").set(payload, merge=True)


def _metrics_latest_ref(ref):
    return ref.collection("metrics").document("latest")


def _existing_metrics_latest(ref, budget: ReadBudget | None = None):
    snap = _metrics_latest_ref(ref).get()
    if budget:
        budget.add(1, "metrics/latest")
    if not snap.exists:
        return None
    return snap.to_dict() or {}


def _latest_series_last_date(ref, budget: ReadBudget) -> str | None:
    query = ref.collection("price_series").order_by(
        "last_date", direction=gcf.Query.DESCENDING
    ).limit(1)
    for snap in query.stream():
        budget.add(1, "price_series/latest")
        data = snap.to_dict() or {}
        _guard_price_history(data.get("asset_id"), data)
        parsed = _parse_date(data.get("last_date"))
        return parsed.isoformat() if parsed else None
    return None


ASSET_PAGE_SIZE = 100
_FROM_WATERMARK = object()


def _asset_stream(db, scan_after_asset_id: str | None, page_size: int = ASSET_PAGE_SIZE):
    """Raices por paginas de `page_size`, no en un solo cursor.

    Con el recalculo de ventanas cada activo lee su serie entera y resuelve el
    €STR contra el BCE; un unico `stream()` sobre las ~1.000 raices queda abierto
    mientras tanto y el servidor lo corta (`504 Stream removed (Deadline
    Exceeded)`, pasada en seco del 13-10; la migracion del 10-09 murio igual).
    Paginando, cada cursor vive lo que tarda en leer `page_size` ids."""
    document_id = FieldPath.document_id()
    after = scan_after_asset_id
    while True:
        query = db.collection("assets").order_by(document_id).limit(page_size)
        if after:
            query = query.start_after({document_id: after})
        # select(): NO abarata la lectura facturada, pero el scan solo necesita
        # quality.status — evita transferir raíces completas (~KB por activo).
        try:
            page = list(query.select(["quality.status"]).stream())
        except Exception:
            swallowed("metrics_refresh.py:319")
            page = list(query.stream())
        yield from page
        if len(page) < page_size:
            return
        after = page[-1].id


def _should_update_metrics_latest(existing: dict | None, series_last_date: str) -> bool:
    if not isinstance(existing, dict):
        return False
    if not isinstance(existing.get("max_drawdown_hist"), dict):
        return True
    existing_last = str(existing.get("last_date") or "")
    return not existing_last or series_last_date > existing_last


def refresh_max_drawdown(limit: int = 0, write: bool = False, max_reads: int | None = None,
                         force_windows: bool = False, collect_detail: bool = False,
                         start_after=_FROM_WATERMARK, once_per_day: bool = False) -> dict:
    """Refresco diario de metrics/latest.

    `force_windows`: recalcula los documentos de calculo propio aunque la serie
    no haya avanzado desde su `last_date`. Es la puesta al dia de una vez de las
    ventanas congeladas por el refresco anterior (que movia `last_date` sin
    recalcularlas); la ejecucion programada no lo usa.
    `collect_detail`: devuelve el antes/despues de cada recalculo (pasada en seco).
    `start_after`: raiz tras la que empieza este ciclo (None = desde el
    principio). Por defecto, el cursor de meta/metrics_refresh; en seco ese
    cursor no se escribe, asi que quien encadena ciclos lo pasa explicitamente.
    `once_per_day`: ejecuciones programadas. Si la vuelta ya se completo hoy
    (hora de Madrid), termina tras leer meta/metrics_refresh, sin recorrer las
    raices; al completar una vuelta deja `cycle_completed_on` = hoy.
    """
    operation = "refresh_max_drawdown"
    if write:
        require_master_writes_enabled(operation)
        require_metrics_writes_enabled(operation)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True)

    db = _master_db()
    budget = ReadBudget(DEFAULT_MAX_READS if max_reads is None else max_reads)
    watermark = _watermark(db, budget)
    last_watermark = str(watermark.get("last_price_series_last_date") or "") or None
    previous_scan_after = str(watermark.get("scan_after_asset_id") or "") or None
    if start_after is not _FROM_WATERMARK:
        previous_scan_after = str(start_after or "") or None
    today = _madrid_today() if once_per_day else None
    if once_per_day and watermark.get("cycle_completed") and watermark.get("cycle_completed_on") == today:
        return {"skipped_reason": "CYCLE_ALREADY_COMPLETED_TODAY", "cycle_completed": True,
                "cycle_completed_on": today, "applied": write, "written": 0, "would_write": 0,
                "read_budget_max": budget.max_reads, "read_budget_used": budget.reads,
                "stopped_by_budget": False, "errors": 0, "processed_assets": 0, "scanned_assets": 0}

    written = would_write = no_series = errors = skipped_not_newer = skipped_no_metrics = 0
    contract_rejected = 0
    candidate_assets = 0
    scanned_assets = 0
    incremental_updates = full_loads = states_consolidated = states_rebuilt = 0
    windows_recomputed = 0
    windows_skipped = []
    # I-2 (quinta pasada): ventanas recalculadas con media €STR parcial.
    risk_free_partial = {"windows": 0, "assets": 0, "by_window": {}, "sample": []}
    excluded = []
    window_detail = []
    safe_year = _consolidation_safe_year()
    max_processed_last_date = last_watermark
    err_sample = []
    processed = 0
    stopped_by_budget = False
    stream_exhausted = True
    last_completed_asset_id = previous_scan_after

    for asset_snap in _asset_stream(db, previous_scan_after):
        aid = str(asset_snap.id)
        try:
            budget.add(1, f"assets/{aid}")
            asset_data = asset_snap.to_dict() or {}
            is_active = _is_active_canonical_asset(aid, asset_data)
            if is_active and limit and scanned_assets >= limit:
                stream_exhausted = False
                break
            if not is_active:
                last_completed_asset_id = aid
                continue

            scanned_assets += 1
            if aid in METRICS_REFRESH_EXCLUDED:
                excluded.append(aid)
                last_completed_asset_id = aid
                continue
            if policy_for(aid).get("blocked"):
                last_completed_asset_id = aid
                continue
            _guard_price_history(aid)
            ref = asset_snap.reference
            series_last_date = _latest_series_last_date(ref, budget)
            if not series_last_date:
                no_series += 1
                last_completed_asset_id = aid
                continue

            if max_processed_last_date is None or series_last_date > max_processed_last_date:
                max_processed_last_date = series_last_date

            budget.add(1, "metrics/latest")
            metrics_snapshot = _metrics_latest_ref(ref).get()
            existing_metrics = metrics_snapshot.to_dict() if metrics_snapshot.exists else None
            if not isinstance(existing_metrics, dict):
                skipped_no_metrics += 1
                last_completed_asset_id = aid
                continue
            self_computed = existing_metrics.get("source") in SELF_COMPUTED_SOURCES
            if not (force_windows and self_computed) and not _should_update_metrics_latest(
                    existing_metrics, series_last_date):
                skipped_not_newer += 1
                last_completed_asset_id = aid
                continue

            candidate_assets += 1

            if self_computed:
                # Calculo propio: documento entero sobre la serie completa.
                floor = budget.remaining()
                if floor is not None and floor < FULL_LOAD_READ_FLOOR:
                    stopped_by_budget = True
                    stream_exhausted = False
                    break
                full_loads += 1
                values, dates = _load_series(ref, budget)
                if len(values) < MIN_POINTS:
                    no_series += 1
                    last_completed_asset_id = aid
                    continue
                rf_warnings = []
                payload, unsafe = _recomputed_metrics(aid, existing_metrics, values, dates, _now_iso(),
                                                      risk_free_warnings=rf_warnings)
                if unsafe:
                    windows_skipped.append({"asset_id": aid, "reason": unsafe})
                    last_completed_asset_id = aid
                    continue
                try:
                    validate_contract(payload, "metrics.v1.3.schema.json")
                except ContractValidationError as exc:
                    contract_rejected += 1
                    if len(err_sample) < 10:
                        err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
                    last_completed_asset_id = aid
                    continue
                if rf_warnings:
                    risk_free_partial["assets"] += 1
                    risk_free_partial["windows"] += len(rf_warnings)
                    for warning in rf_warnings:
                        label = str(warning.get("window"))
                        risk_free_partial["by_window"][label] = risk_free_partial["by_window"].get(label, 0) + 1
                    if len(risk_free_partial["sample"]) < 20:
                        risk_free_partial["sample"].append({
                            "asset_id": aid,
                            "windows": {str(w.get("window")): w.get("coverage_ratio") for w in rf_warnings},
                        })
                if collect_detail:
                    window_detail.append(_window_change(aid, existing_metrics, payload))
                if write:
                    _write_full_metrics(db, ref, metrics_snapshot, payload, existing_metrics)
                    written += 1
                else:
                    would_write += 1
                windows_recomputed += 1
                processed += 1
                last_completed_asset_id = aid
                continue

            # Camino incremental: estado consolidado + solo los años abiertos.
            pending_state = None
            state = _load_state(ref, budget)
            mdd_h = when = None
            series_end = None
            if state is not None:
                tail_values, tail_dates = _points_after_year(ref, state["base_year"], budget)
                # Guardas: la cola debe empezar DESPUÉS del estado y llegar hasta
                # el last_date real de la serie (si un doc anual careciera de
                # campo year, la query lo omitiría y el valor saldría corto:
                # mejor carga completa que un drawdown silenciosamente mal).
                tail_ok = (
                    bool(tail_dates)
                    and tail_dates[0] > state["base_last_date"]
                    and series_last_date <= tail_dates[-1].isoformat()
                )
                if tail_ok:
                    incremental_updates += 1
                    mdd_h, when, _peak = _run_drawdown(
                        state["peak_value"], state["mdd_value"], state["mdd_date"],
                        tail_values, tail_dates,
                    )
                    series_end = tail_dates[-1]
                    # Consolidación anual (una vez al año, pasada la quincena de
                    # enero): sube base_year para que el incremental lea menos.
                    if write and safe_year > state["base_year"]:
                        closed_n = 0
                        for d in tail_dates:
                            if d.year > safe_year:
                                break
                            closed_n += 1
                        if closed_n:
                            w2, wd2, p2 = _run_drawdown(
                                state["peak_value"], state["mdd_value"], state["mdd_date"],
                                tail_values[:closed_n], tail_dates[:closed_n],
                            )
                            pending_state = _state_payload(safe_year, p2, w2, wd2, tail_dates[closed_n - 1])
                            states_consolidated += 1

            if mdd_h is None:
                # Carga completa (primer pase, estado inutilizable o cola vacía).
                floor = budget.remaining()
                if floor is not None and floor < FULL_LOAD_READ_FLOOR:
                    stopped_by_budget = True
                    stream_exhausted = False
                    break
                full_loads += 1
                values, dates = _load_series(ref, budget)
                if len(values) < MIN_POINTS:
                    no_series += 1
                    last_completed_asset_id = aid
                    continue
                mdd_h, when, _peak = _run_drawdown(None, 0.0, None, values, dates)
                series_end = dates[-1]
                if write:
                    state_payload = _state_from_full(values, dates, safe_year)
                    if state_payload:
                        pending_state = state_payload
                        states_rebuilt += 1

            # `date` solo cuando la hay: metrics.v1.2 declara max_drawdown_hist.date
            # como string con additionalProperties:false, asi que un None rompe el
            # contrato. Ocurre cuando la serie nunca cae por debajo de su maximo
            # corriente (_run_drawdown devuelve worst=0.0 y worst_date=None), caso
            # real en monetarios y en ventanas cortas al alza.
            drawdown_hist = {"value": round(mdd_h, 8)}
            if when:
                drawdown_hist["date"] = when.isoformat()
            payload = {
                "max_drawdown_hist": drawdown_hist,
                "last_date": series_end.isoformat(),
                "updated_at": _now_iso(),
            }
            # El merge cae sobre un doc que ya leimos mas arriba (existing_metrics),
            # asi que el resultado se valida sin gastar una lectura mas. Este era el
            # unico escritor de la maestra sin validacion de contrato (auditoria 03-09).
            try:
                validate_contract({**existing_metrics, **payload}, "metrics.v1.3.schema.json")
            except ContractValidationError as exc:
                contract_rejected += 1
                if len(err_sample) < 10:
                    err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
                last_completed_asset_id = aid
                continue
            if write:
                _write_metrics_and_state(db, ref, metrics_snapshot, payload, pending_state)
                written += 1
            else:
                would_write += 1
            processed += 1
            last_completed_asset_id = aid
        except ReadBudgetExceeded as exc:
            stopped_by_budget = True
            stream_exhausted = False
            errors += 1
            if len(err_sample) < 10:
                err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
            break
        except Exception as exc:  # noqa: BLE001 — seguir y reportar
            errors += 1
            if len(err_sample) < 10:
                err_sample.append({"asset_id": aid, "error": str(exc)[:200]})
            last_completed_asset_id = aid

    cycle_completed = stream_exhausted and not stopped_by_budget
    next_scan_after = None if cycle_completed else last_completed_asset_id

    if write:
        _write_watermark(
            db,
            last_date=max_processed_last_date,
            processed=processed,
            written=written,
            budget=budget,
            scan_after_asset_id=next_scan_after,
            cycle_completed=cycle_completed,
            scanned_assets=scanned_assets,
            stopped_by_budget=stopped_by_budget,
            completed_on=today if cycle_completed else None,
        )

    return {"written": written, "would_write": would_write, "applied": write, "no_series": no_series, "errors": errors,
            "error_sample": err_sample, "window_years": WINDOW_YEARS,
            "last_watermark": last_watermark, "new_watermark": max_processed_last_date,
            "candidate_assets": candidate_assets, "read_budget_max": budget.max_reads,
            "read_budget_used": budget.reads, "processed_assets": processed,
            "skipped_not_newer": skipped_not_newer, "skipped_no_metrics_latest": skipped_no_metrics,
            "contract_rejected": contract_rejected,
            "incremental_updates": incremental_updates, "full_loads": full_loads,
            "states_consolidated": states_consolidated, "states_rebuilt": states_rebuilt,
            "consolidation_safe_year": safe_year,
            "windows_recomputed": windows_recomputed, "windows_skipped": windows_skipped,
            "risk_free_partial_coverage": risk_free_partial,
            "excluded_assets": excluded,
            "force_windows": bool(force_windows), "window_detail": window_detail,
            "stopped_by_budget": stopped_by_budget, "scanned_assets": scanned_assets,
            "previous_scan_after_asset_id": previous_scan_after,
            "next_scan_after_asset_id": next_scan_after,
            "cycle_completed": cycle_completed}


def recompute_one(asset_id: str, write: bool = False) -> dict:
    """Recalcula la caida (5a + historica) de UN activo. dry-run salvo write=True."""
    operation = "recompute_one"
    if write:
        require_master_writes_enabled(operation)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True, asset_id=asset_id)

    if asset_id in METRICS_REFRESH_EXCLUDED:
        return {"asset_id": asset_id, "excluded": True, "applied": False,
                "error": "metrics/latest excluido del refresco (METRICS_REFRESH_EXCLUDED)."}
    db = _master_db()
    ref = db.collection("assets").document(asset_id)
    if not ref.get().exists:
        return {"asset_id": asset_id, "found": False}
    _guard_price_history(asset_id)
    metrics_snapshot = _metrics_latest_ref(ref).get()
    values, dates = _load_series(ref)
    if len(values) < MIN_POINTS:
        return {"asset_id": asset_id, "found": True, "enough_data": False, "points": len(values)}
    cutoff = dates[-1] - datetime.timedelta(days=365 * WINDOW_YEARS)
    win = [(v, d) for v, d in zip(values, dates) if d >= cutoff]
    if len(win) >= MIN_POINTS:
        mdd_w, _ = _max_drawdown([v for v, _ in win], [d for _, d in win])
        obs_w = len(win)
    else:
        mdd_w, _ = _max_drawdown(values, dates)
        obs_w = len(values)
    mdd_h, when = _max_drawdown(values, dates)
    years = max(1, round((dates[-1] - dates[0]).days / 365.0))
    hist = {"value": round(mdd_h, 8)}
    if when:
        hist["date"] = when.isoformat()
    state_rebuilt = False
    if write:
        require_metrics_writes_enabled("recompute_one")
        existing_metrics = metrics_snapshot.to_dict() if metrics_snapshot.exists else None
        if not isinstance(existing_metrics, dict):
            return {"asset_id": asset_id, "found": True, "enough_data": True,
                    "applied": False, "error": "metrics/latest no existe; no se crea doc incompleto."}
        payload = {"max_drawdown_hist": hist, "last_date": dates[-1].isoformat(),
                   "updated_at": _now_iso()}
        validate_contract({**existing_metrics, **payload}, "metrics.v1.3.schema.json")
        # Reconstruir SIEMPRE el estado consolidado: tras una recarga manual de
        # histórico es la única vía de reparar un drawdown_state desfasado.
        state_payload = _state_from_full(values, dates, _consolidation_safe_year())
        _write_metrics_and_state(db, ref, metrics_snapshot, payload, state_payload)
        state_rebuilt = bool(state_payload)
    return {"asset_id": asset_id, "found": True, "enough_data": True,
            "applied": write, "max_drawdown_hist": hist, "state_rebuilt": state_rebuilt,
            # La ventana de 5a se calculaba y se descartaba (F841); ahora se
            # devuelve — es un resultado de diagnóstico manual, no un contrato.
            "max_drawdown_window": {"value": round(mdd_w, 8), "observations": obs_w,
                                    "series_years": years}}
