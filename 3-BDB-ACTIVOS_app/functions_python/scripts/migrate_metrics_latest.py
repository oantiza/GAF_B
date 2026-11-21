#!/usr/bin/env python3
"""Normaliza metrics/latest heredados usando la serie canonica completa.

Dos motivos para recalcular un documento:

1. Falta o no cumple el contrato. Era el unico criterio original.
2. Se calculo con una formula anterior. El discriminante es `method`: desde
   metrics.v1.2 toda ventana con rentabilidad anualizada declara con que
   metodologia se obtuvo, asi que una ventana con `annualized_return` y sin
   `method` viene de antes del cambio del 03-09 --media aritmetica x252 y
   Sharpe sin descontar la tasa (auditoria 03-09, hallazgo 02)--.
3. Es relleno del proveedor para una accion. En metricas de accion manda la app
   (decision del 04-09); lo que copia el cargador del canonico es un puente
   hasta que haya serie con la que calcular las nuestras.
4. A1 (auditoria 29-09): alguna ventana propia declara una `frequency` que el
   calculo de hoy ya no produce (DAILY, o ninguna con volatilidad). La maestra
   media en diario (x252) y el resto del programa en semanal (x52): un mismo
   fondo de RV daba 12,74 % y 14,36 %. Ahora la ingesta mide en semanal
   (weekly_sampling) y el reproceso reescribe lo que quedo en diario.

El criterio es autolimitante: al reescribirse, el documento pasa a declarar
`method` y una `frequency` vigente, y ya no vuelve a entrar. No hace falta
llevar la cuenta de nada.

Sin este segundo criterio el script no recalcularia nada: v1.2 es un
superconjunto de v1.1, asi que todo lo escrito antes sigue siendo valido.

Uso (PowerShell, desde functions_python/, con ADC de gcloud):
    python scripts/migrate_metrics_latest.py --dry-run --limit 5
    python scripts/migrate_metrics_latest.py --dry-run --asset LU0996182563
    python scripts/migrate_metrics_latest.py --write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES

Sin --write nunca escribe. Con --write exige la aprobacion explicita y activa el
gate de write_governance (BDB_ACTIVOS_ENABLE_MASTER_WRITES) como los demas
scripts; el SRRI del documento actual se arrastra al recalculado (recalcular sin
pasarlo lo borraba, ver build_metrics_latest).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from google.cloud.firestore_v1.field_path import FieldPath  # noqa: E402

import metrics_refresh  # noqa: E402
import weekly_sampling  # noqa: E402
from contract_validation import ContractValidationError, validate_contract  # noqa: E402
from ingest_asset import (  # noqa: E402
    METRIC_WINDOWS,
    _estr_window_resolver,
    _valid_metric_points,
    _window_metrics,
    build_metrics_latest,
)
from metrics_reconciliation import (  # noqa: E402
    DEFAULT_TOLERANCE_PP,
    computable_labels,
    merge_windows,
    reconcile_windows,
    summarize,
)
from master_project import master_project_id  # noqa: E402
from price_refresh import _now_iso  # noqa: E402
from write_governance import (  # noqa: E402
    MASTER_WRITE_CONFIRMATION,
    MASTER_WRITE_ENV,
    log_master_write_decision,
    require_master_writes_enabled,
)

APPROVAL = MASTER_WRITE_CONFIRMATION
OPERATION = "migrate_metrics_latest"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def _series_points(asset_ref):
    by_date = {}
    for snap in asset_ref.collection("price_series").stream():
        for point in (snap.to_dict() or {}).get("points") or []:
            if isinstance(point, dict) and point.get("date") is not None:
                by_date[str(point["date"])] = point
    return [by_date[key] for key in sorted(by_date)]


# Fuentes que calculamos nosotros y que, por tanto, arrastraban la formula
# anterior. `FONDOSDB_ROOT_ES` NO esta: son cifras trailing de Morningstar que
# la plataforma copia tal cual, nunca pasaron por `avg * 252` y recalcularlas
# no seria corregir un error sino cambiar de fuente sin que nadie lo pidiera.
# Esas ganan sus etiquetas method/frequency en el proximo republish, sin tocar
# un solo numero.
# FUND_QUALITY_REVIEW_V1 tambien es calculo propio (build_metrics_latest con la
# politica de historico aplicada, R-04): entra por los mismos criterios.
# La lista vive en metrics_refresh, que es quien las recalcula a diario.
SELF_COMPUTED_SOURCES = metrics_refresh.SELF_COMPUTED_SOURCES

# Frecuencias que el calculo de hoy puede declarar en una ventana propia con
# volatilidad (weekly_sampling.annualization_for_gap). Una ventana propia con
# volatilidad y otra etiqueta --DAILY, o ninguna-- viene de antes de A1.
PRODUCED_FREQUENCIES = {
    frequency for _gap in (1, 7, 30)
    for _factor, frequency in (weekly_sampling.annualization_for_gap(_gap),)
    if frequency
}

# Relleno del proveedor para ACCIONES: lo escribe el cargador create-only de la
# plataforma al dar de alta una accion que viene en el canonico del extractor.
# Decision del 04-09: en metricas de accion manda la app, que calcula sobre la
# serie EODHD completa de la maestra. Estas cifras son un puente hasta que haya
# serie con la que calcular las nuestras; en cuanto la hay, se sustituyen.
PROVIDER_FALLBACK_SOURCES = {"FONDOSDB_STOCK_ROOT_ES"}

# Cifras trailing de Morningstar que la plataforma copia para FONDOS. Hasta
# ahora estaban excluidas del recalculo con el argumento de que no venian de la
# formula rota y sustituirlas seria cambiar de fuente sin motivo.
#
# El motivo existe y es el mismo que se acepto para acciones el 04-09: mientras
# los fondos lleven trailing del proveedor y las acciones CAGR propio, el
# comparador y el X-Ray ponen en la misma columna dos medidas distintas. Lo que
# faltaba no era la decision sino la prueba de que el calculo propio es al menos
# tan bueno, y esa prueba ahora se hace fondo a fondo en metrics_reconciliation:
# solo se sustituye la ventana que reproduce la cifra del proveedor a su mismo
# corte. La que no la reproduce se queda como esta.
PROVIDER_FALLBACK_FUND_SOURCES = {"FONDOSDB_ROOT_ES"}


def _window_sharpe_sin_tasa(node) -> bool:
    """Ventana propia con Sharpe y sin tasa libre de riesgo.

    Es la huella de una pasada en la que el BCE no respondio: `_window_risk_free`
    absorbe el fallo y devuelve 0, asi que el documento sale con un Sharpe sin
    descontar indistinguible de uno bueno. `ES0158300410` se quedo asi el 04-09 y
    no volvia a entrar nunca, porque sus ventanas SI declaran `method` y el
    criterio anterior las daba por buenas.

    Un Sharpe sin tasa es un cociente, no un Sharpe (auditoria 03-09, hallazgo
    02): la misma razon por la que se corrigio la formula es la que obliga a
    recalcular lo que salio de una pasada a medias.
    """
    if not isinstance(node, dict) or node.get("method") != "GEOMETRIC_CAGR":
        return False
    return node.get("sharpe_ratio") is not None and not node.get("risk_free_rate")


def _window_frequency_stale(node) -> bool:
    """Ventana propia con volatilidad medida en una frecuencia que hoy no se
    produce (A1, auditoria 29-09): DAILY o sin etiqueta."""
    if not isinstance(node, dict) or node.get("annualized_volatility") is None:
        return False
    return node.get("frequency") not in PRODUCED_FREQUENCIES


def _recompute_reason(current) -> str | None:
    """Por que este documento debe recalcularse desde la serie de la maestra
    (None si no debe).

    - PROVIDER_FALLBACK: es relleno del proveedor para una poblacion que posee
      la app (o candidato de fondo, que decide la reconciliacion).
    - NO_METHOD: lo calculamos nosotros y alguna ventana anualiza sin declarar
      con que metodologia, que es la huella de la formula anterior al 03-09.
    - NO_RATE: lo calculamos nosotros y alguna ventana trae Sharpe sin tasa, que
      es la huella de una pasada en la que fallo la resolucion del €STR.
    - FREQUENCY: lo calculamos nosotros y alguna ventana declara una frecuencia
      que el calculo de hoy no produce (A1: DAILY -> WEEKLY).
    """
    current = current or {}
    source = str(current.get("source") or "")
    if source in PROVIDER_FALLBACK_SOURCES:
        return "PROVIDER_FALLBACK"
    if source in PROVIDER_FALLBACK_FUND_SOURCES:
        # Candidato: si de verdad se sustituye alguna ventana lo decide la
        # reconciliacion contra el proveedor, no esta funcion.
        return "PROVIDER_FALLBACK"
    if source not in SELF_COMPUTED_SOURCES:
        return None
    windows = current.get("windows") or {}
    if not isinstance(windows, dict):
        return None
    for node in windows.values():
        if not isinstance(node, dict):
            continue
        if node.get("annualized_return") is not None and not node.get("method"):
            return "NO_METHOD"
        if _window_sharpe_sin_tasa(node):
            return "NO_RATE"
    for node in windows.values():
        if _window_frequency_stale(node):
            return "FREQUENCY"
    return None


def _needs_recompute(current) -> bool:
    """Si este documento debe recalcularse desde la serie de la maestra."""
    return _recompute_reason(current) is not None


def _window_at_provider_cut(points, label):
    """Ventana calculada sobre la serie truncada al corte del proveedor.

    Es el mismo calculador que publica, con el mismo guard de cobertura: si la
    comparacion usara otra formula no probaria nada sobre la que se escribe.
    """
    valid = _valid_metric_points(points)
    if not valid:
        return None
    nominal_days = 365 * METRIC_WINDOWS[label]
    cutoff = valid[-1]["date"] - timedelta(days=nominal_days)
    # Sin resolutor €STR: la reconciliacion mira la rentabilidad anualizada, que
    # no depende de la tasa, y asi no se dispara una peticion al BCE por ventana
    # y activo solo para comparar.
    return _window_metrics([p for p in valid if p["date"] >= cutoff], 0.0,
                           nominal_days=nominal_days)


def _stamp_provider_method(windows):
    """Las ventanas del proveedor que se conservan declaran que lo son.

    Una ventana con rentabilidad y sin `method` es, para `_needs_recompute`, la
    huella de la formula anterior al 03-09: si se dejara sin sellar, el fondo
    volveria a entrar en cada pasada y nunca convergeria.
    """
    out = {}
    for label, node in (windows or {}).items():
        if not isinstance(node, dict):
            continue
        node = dict(node)
        if node.get("annualized_return") is not None and not node.get("method"):
            node["method"] = "TRAILING_PROVIDER"
            node.setdefault("frequency", "PROVIDER")
        out[label] = node
    return out


def _srri_of(current):
    """SRRI del KID que hay que arrastrar al recalculo: solo publica el
    proveedor y build_metrics_latest lo borra si no se le pasa."""
    srri = (current or {}).get("srri")
    if isinstance(srri, bool) or not isinstance(srri, int):
        return None
    return srri if 1 <= srri <= 7 and (current or {}).get("risk_score_source") == "SRRI" else None


def _fund_payload(asset_id, root, current, points, now_iso, tolerance_pp, asset_type="FUND"):
    """Documento con las ventanas que hayan probado ser calculables.

    `asset_type` sale de la raiz, no se supone: ademas de los 675 fondos hay 5
    ETF y un `OTHER` cuyas metricas tambien las copio el cargador del proveedor,
    y fijar "FUND" aqui les habria puesto `population: fund` en la maestra.

    Devuelve (payload, detalle) o (None, detalle) si ninguna ventana pasa el
    contraste: en ese caso no se toca el documento.
    """
    verdicts = reconcile_windows(root, _series_for_reconciliation(points),
                                 _window_at_provider_cut, tolerance_pp=tolerance_pp)
    allowed = computable_labels(verdicts)
    detalle = {"asset_id": asset_id, "verdicts": verdicts, "allowed": sorted(allowed),
               "counts": summarize(verdicts)}
    if not allowed:
        return None, detalle

    # Solo se arrastra el SRRI que de verdad es del KID (risk_score_source SRRI):
    # pasar un VOL_BUCKET como SRRI lo habria convertido en dato regulatorio.
    computed = build_metrics_latest(
        asset_id, asset_type, points, now_iso,
        risk_free_resolver=_estr_window_resolver,
        srri=_srri_of(current),
    )
    provider_windows = _stamp_provider_method((current or {}).get("windows"))
    computed["windows"] = merge_windows(computed.get("windows"), provider_windows, allowed)
    # El drawdown a 5 anios y el historico salen de la serie tambien cuando la
    # ventana correspondiente se queda con el proveedor: no son cifras trailing,
    # se calculan sobre los mismos NAV y no habia ninguna con la que compararlos.
    detalle["written_windows"] = {k: v.get("method") for k, v in computed["windows"].items()}
    return computed, detalle


def _series_for_reconciliation(points):
    """Serie en la forma que espera metrics_reconciliation: fecha ISO en texto."""
    return [{"date": p["date"].isoformat(), "value": p["value"]}
            for p in _valid_metric_points(points)]


ASSET_PAGE_SIZE = 100


def _iter_assets(db, page_size=ASSET_PAGE_SIZE):
    """Raices por paginas, no en un solo stream.

    Un `collection.stream()` sobre las 1.012 raices mantiene abierto un cursor
    de servidor mientras cada iteracion hace su trabajo --leer la serie entera,
    resolver el €STR contra el BCE, escribir--, y el trabajo de una pasada
    completa supera la vida del cursor: la escritura del 10-09 murio con
    `504 Stream removed (Deadline Exceeded)` despues de convertir 617 de 618
    fondos, y el reintento de la libreria se rompio ademas por su cuenta
    (`'_UnaryStreamMultiCallable' object has no attribute '_retry'`).

    Paginar por id de documento acota cada cursor a `page_size` raices, y
    ademas hace la pasada reanudable: lo ya reescrito declara `method` y no
    vuelve a entrar, asi que basta con volver a lanzarla.
    """
    ultimo = None
    while True:
        consulta = db.collection("assets").order_by(FieldPath.document_id()).limit(page_size)
        if ultimo is not None:
            consulta = consulta.start_after({FieldPath.document_id(): ultimo})
        pagina = list(consulta.stream())
        if not pagina:
            return
        for snap in pagina:
            ultimo = snap.id
            yield snap
        if len(pagina) < page_size:
            return


def _valid_metrics(payload) -> bool:
    try:
        validate_contract(payload or {}, "metrics.v1.3.schema.json")
        return True
    except ContractValidationError:
        return False


def _vol_diffs(current, payload):
    """Diferencia de volatilidad (nuevo - actual, en puntos porcentuales) por
    ventana, cuando las dos la publican. Es la medida del cambio de frecuencia
    (A1): en RV se espera semanal > diario en uno o dos puntos."""
    out = {}
    for label, node in (payload.get("windows") or {}).items():
        old = ((current or {}).get("windows") or {}).get(label) or {}
        new_vol, old_vol = node.get("annualized_volatility"), old.get("annualized_volatility")
        if isinstance(new_vol, (int, float)) and isinstance(old_vol, (int, float)):
            out[label] = round((new_vol - old_vol) * 100.0, 4)
    return out


def _incomplete(payload, current) -> str | None:
    """Motivo por el que el documento recalculado no debe escribirse (None si
    es completo). No se sustituye un documento con ventanas por uno sin ellas,
    ni se pierde el SRRI regulatorio que traia."""
    if not (payload.get("windows") or {}) and ((current or {}).get("windows") or {}):
        return "NO_WINDOWS"
    if _srri_of(current) is not None and payload.get("risk_score_source") != "SRRI":
        return "SRRI_LOST"
    return None


def _new_summary(write: bool) -> dict:
    return {
        "mode": "WRITE" if write else "DRY_RUN",
        "active_roots": 0,
        "valid": 0,
        "invalid": 0,
        "missing": 0,
        "to_recompute": 0,
        "reasons": {},
        "eligible": 0,
        "written": 0,
        "skipped": 0,
        "errors": 0,
        "funds_recomputed": 0,
        "funds_kept_provider": 0,
        "without_series": [],
        "candidate_ids": [],
        "fund_detail": [],
        "skipped_no_rate": [],
        "skipped_incomplete": [],
        "excluded": [],
        "error_detail": [],
        "vol_diff_pp": {},
        "stopped_by_limit": False,
    }


def _process_asset(asset_snap, summary, *, write: bool, tolerance_pp: float, now_iso=None) -> None:
    """Decide y, si procede, recalcula metrics/latest de una raiz. Acumula en
    `summary`; nunca lanza: los errores se cuentan y la pasada sigue."""
    now_iso = now_iso or _now_iso
    if asset_snap.id in metrics_refresh.METRICS_REFRESH_EXCLUDED:
        # Misma exclusion explicita que el refresco diario (NH Hoteles).
        summary["excluded"].append(asset_snap.id)
        summary["skipped"] += 1
        return
    root = asset_snap.to_dict() or {}
    metrics_ref = asset_snap.reference.collection("metrics").document("latest")
    metrics_snap = metrics_ref.get()
    current = metrics_snap.to_dict() if metrics_snap.exists else None
    reason = _recompute_reason(current)
    if current is not None and _valid_metrics(current) and reason is None:
        summary["valid"] += 1
        return
    if current is None:
        summary["missing"] += 1
        reason = "MISSING"
    elif reason is not None:
        summary["to_recompute"] += 1
    else:
        summary["invalid"] += 1
        reason = "INVALID"
    summary["reasons"][reason] = summary["reasons"].get(reason, 0) + 1

    points = _series_points(asset_snap.reference)
    if not points:
        summary["without_series"].append(asset_snap.id)
        summary["skipped"] += 1
        return

    source = str((current or {}).get("source") or "")
    if source in PROVIDER_FALLBACK_FUND_SOURCES:
        payload, detalle = _fund_payload(asset_snap.id, root, current, points,
                                         now_iso(), tolerance_pp,
                                         asset_type=str(root.get("asset_type") or "OTHER"))
        if payload is None:
            summary["funds_kept_provider"] += 1
            summary["fund_detail"].append(detalle)
            summary["skipped"] += 1
            return
        summary["funds_recomputed"] += 1
        summary["fund_detail"].append(detalle)
    else:
        payload = build_metrics_latest(
            asset_snap.id,
            str(root.get("asset_type") or "OTHER"),
            points,
            now_iso(),
            risk_free_resolver=_estr_window_resolver,
            srri=_srri_of(current),
        )
    validate_contract(payload, "metrics.v1.3.schema.json")
    # `_window_risk_free` absorbe el fallo del BCE y devuelve 0: un timeout
    # transitorio se convertiria en un Sharpe sin descontar escrito en la
    # maestra, indistinguible de uno bueno. En la escritura del 10-09 hubo
    # timeouts del BCE en mitad de la pasada. Se para la escritura de ESE
    # documento y se sigue: la pasada es reanudable.
    sin_tasa = sorted(label for label, node in (payload.get("windows") or {}).items()
                      if node.get("method") == "GEOMETRIC_CAGR"
                      and node.get("sharpe_ratio") is not None
                      and not node.get("risk_free_rate"))
    if sin_tasa:
        summary["skipped_no_rate"].append({"asset_id": asset_snap.id, "windows": sin_tasa})
        summary["skipped"] += 1
        return
    incompleto = _incomplete(payload, current)
    if incompleto:
        summary["skipped_incomplete"].append({"asset_id": asset_snap.id, "reason": incompleto})
        summary["skipped"] += 1
        return
    for label, diff in _vol_diffs(current, payload).items():
        summary["vol_diff_pp"].setdefault(label, []).append(diff)
    summary["eligible"] += 1
    summary["candidate_ids"].append(asset_snap.id)
    if write:
        metrics_ref.set(payload)
        summary["written"] += 1


def _finish_summary(summary: dict) -> dict:
    """Resumen final: diferencias medias de volatilidad por ventana (pp) en
    lugar de la lista de cada activo."""
    resumen = {}
    for label, diffs in sorted(summary["vol_diff_pp"].items()):
        if diffs:
            resumen[label] = {
                "count": len(diffs),
                "mean_pp": round(sum(diffs) / len(diffs), 4),
                "max_abs_pp": round(max(abs(d) for d in diffs), 4),
            }
    summary["vol_diff_pp"] = resumen
    summary["recomputed"] = summary["eligible"]
    return summary


def _selected_roots(db, asset_ids):
    """Raices pedidas con --asset, en el orden dado; las que no existen se
    notifican en el resumen."""
    for asset_id in asset_ids:
        snap = db.collection("assets").document(asset_id).get()
        if snap.exists:
            yield snap


def run(db, *, write: bool = False, limit: int = 0, assets=None,
        tolerance_pp: float = DEFAULT_TOLERANCE_PP, now_iso=None) -> dict:
    """Pasada completa (o acotada por --limit / --asset). Dry-run salvo write."""
    summary = _new_summary(write)
    summary["requested_assets"] = list(assets or [])
    log_master_write_decision(OPERATION, enabled=write, dry_run=not write)
    if write:
        require_master_writes_enabled(OPERATION)
    fuente = _selected_roots(db, assets) if assets else _iter_assets(db)
    for asset_snap in fuente:
        root = asset_snap.to_dict() or {}
        quality = root.get("quality") if isinstance(root.get("quality"), dict) else {}
        if not ISIN_RE.fullmatch(asset_snap.id) or quality.get("status") == "ARCHIVED_LEGACY":
            continue
        if limit and summary["active_roots"] >= limit:
            summary["stopped_by_limit"] = True
            break
        summary["active_roots"] += 1
        try:
            _process_asset(asset_snap, summary, write=write, tolerance_pp=tolerance_pp, now_iso=now_iso)
        except Exception as exc:  # noqa: BLE001 - la pasada sigue; se cuenta y se informa
            summary["errors"] += 1
            summary["error_detail"].append({"asset_id": asset_snap.id, "error": str(exc)[:200]})
            traceback.print_exc()
    return _finish_summary(summary)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--dry-run", action="store_true", dest="dry_run",
                        help="modo por defecto: no escribe; explicito para dejarlo claro en la orden")
    parser.add_argument("--approval")
    # Muestra para la primera pasada: la resolucion €STR va por HTTP contra el
    # BCE una vez por ventana, asi que conviene medir con pocos activos antes de
    # recorrer la maestra entera.
    parser.add_argument("--limit", type=int, default=0,
                        help="detenerse tras N raices activas (0 = todas)")
    parser.add_argument("--asset", action="append", default=[],
                        help="ISIN concreto (repetible): solo esas raices")
    parser.add_argument("--tolerance-pp", type=float, default=DEFAULT_TOLERANCE_PP,
                        dest="tolerance_pp",
                        help="desviacion admitida en puntos porcentuales frente al proveedor")
    args = parser.parse_args()
    if args.write and args.dry_run:
        raise SystemExit("--write y --dry-run son incompatibles.")
    if args.write and args.approval != APPROVAL:
        raise SystemExit("Aprobacion de escritura ausente.")
    if args.write:
        # Mismo gate que el resto de scripts (run_metrics_refresh): la escritura
        # pasa por write_governance ademas de por la aprobacion en la orden.
        os.environ[MASTER_WRITE_ENV] = APPROVAL

    from google.cloud import firestore as gcf
    db = gcf.Client(project=master_project_id())
    summary = run(db, write=args.write, limit=args.limit, assets=args.asset,
                  tolerance_pp=args.tolerance_pp)
    print(json.dumps(summary, ensure_ascii=True))
    if summary["errors"]:
        return 1
    return 0 if not summary["without_series"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
