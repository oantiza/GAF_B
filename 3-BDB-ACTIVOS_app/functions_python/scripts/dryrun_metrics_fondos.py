#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pasada en seco del recalculo de metricas de FONDOS, sobre la copia local.

No abre Firestore ni sale a la red: lee el backup verificado
(`2-plataforma-datos/data/backups/<marca>/assets.ndjson.gz`) y aplica la misma
politica que `migrate_metrics_latest.py` para ensenar, antes de tocar nada, que
ventana se sustituiria, cual se quedaria con el proveedor y por que.

    python scripts/dryrun_metrics_fondos.py --backup <ruta>/assets.ndjson.gz

La tasa €STR no se resuelve aqui (seria una peticion al BCE por ventana y
activo), asi que el Sharpe del informe sale sin descontar. La rentabilidad, la
volatilidad y los veredictos NO dependen de la tasa: son los mismos que
escribiria la migracion.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest_asset import (  # noqa: E402
    METRIC_WINDOWS,
    _valid_metric_points,
    _window_metrics,
    build_metrics_latest,
)
from metrics_reconciliation import (  # noqa: E402
    DEFAULT_TOLERANCE_PP,
    MATCH,
    MISMATCH,
    NO_BASIS,
    NO_PROVIDER,
    NO_WINDOW,
    STALE_SERIES,
    computable_labels,
    merge_windows,
    reconcile_windows,
)

FUND_PROVIDER_SOURCE = "FONDOSDB_ROOT_ES"
LABELS = ("1y", "3y", "5y", "10y")


def _leer_backup(ruta: Path):
    """Raices de fondo, su metrics/latest y su serie, desde el ndjson.gz."""
    roots, metrics, series = {}, {}, defaultdict(dict)
    abrir = gzip.open if ruta.suffix == ".gz" else open
    with abrir(ruta, "rt", encoding="utf-8") as fichero:
        for linea in fichero:
            registro = json.loads(linea)
            partes = str(registro.get("path") or "").split("/")
            if len(partes) < 2:
                continue
            asset_id, datos = partes[1], registro.get("data") or {}
            if len(partes) == 2:
                if datos.get("asset_type") == "FUND":
                    roots[asset_id] = datos
            elif len(partes) == 4 and partes[2] == "metrics" and partes[3] == "latest":
                metrics[asset_id] = datos
            elif len(partes) == 4 and partes[2] == "price_series":
                for punto in datos.get("points") or []:
                    if isinstance(punto, dict) and punto.get("date") is not None:
                        series[asset_id][str(punto["date"])] = punto
    ordenadas = {k: [v[fecha] for fecha in sorted(v)] for k, v in series.items()}
    return roots, metrics, ordenadas


def _window_at_provider_cut(points, label):
    valid = _valid_metric_points(points)
    if not valid:
        return None
    nominal_days = 365 * METRIC_WINDOWS[label]
    cutoff = valid[-1]["date"] - timedelta(days=nominal_days)
    return _window_metrics([p for p in valid if p["date"] >= cutoff], 0.0,
                           nominal_days=nominal_days)


def _serie_iso(points):
    return [{"date": p["date"].isoformat(), "value": p["value"]}
            for p in _valid_metric_points(points)]


def _pct(n, total):
    return "%.0f%%" % (100.0 * n / total) if total else "-"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", required=True, type=Path,
                        help="assets.ndjson.gz de un backup verificado")
    parser.add_argument("--tolerance-pp", type=float, default=DEFAULT_TOLERANCE_PP,
                        dest="tolerance_pp")
    parser.add_argument("--json", type=Path, help="volcar el detalle por fondo")
    parser.add_argument("--top", type=int, default=15,
                        help="cuantas discrepancias listar")
    args = parser.parse_args()

    roots, metrics, series = _leer_backup(args.backup)
    candidatos = [a for a in roots
                  if str((metrics.get(a) or {}).get("source") or "") == FUND_PROVIDER_SOURCE]

    por_ventana = {label: Counter() for label in LABELS}
    recalculados, intactos, sin_serie = [], [], []
    gana_mdd5y = gana_diaria = 0
    detalle = []
    discrepancias = []

    for asset_id in sorted(candidatos):
        raiz, actual = roots[asset_id], metrics[asset_id]
        puntos = series.get(asset_id) or []
        if not puntos:
            sin_serie.append(asset_id)
            continue

        veredictos = reconcile_windows(raiz, _serie_iso(puntos), _window_at_provider_cut,
                                       labels=LABELS, tolerance_pp=args.tolerance_pp)
        for label, nodo in veredictos.items():
            por_ventana[label][nodo["verdict"]] += 1
            if nodo["verdict"] == MISMATCH:
                discrepancias.append((abs(nodo["diff_pp"]), asset_id, label, nodo,
                                      (raiz.get("identity") or {}).get("name") or ""))

        permitidas = computable_labels(veredictos)
        fila = {
            "asset_id": asset_id,
            "nombre": (raiz.get("identity") or {}).get("name"),
            "clase": (raiz.get("classification") or {}).get("fondosdb_asset_type"),
            "veredictos": veredictos,
            "sustituidas": sorted(permitidas),
        }
        if not permitidas:
            intactos.append(asset_id)
            detalle.append(fila)
            continue

        srri = actual.get("srri")
        nuevo = build_metrics_latest(asset_id, "FUND", puntos, "DRY_RUN",
                                     srri=srri if isinstance(srri, int) else None)
        nuevo["windows"] = merge_windows(nuevo.get("windows"), actual.get("windows"), permitidas)
        if nuevo.get("max_drawdown_5y") is not None and actual.get("max_drawdown_5y") is None:
            gana_mdd5y += 1
        # A1 (auditoria 29-09): el calculo propio mide en semanal, no en diario.
        if any(nuevo["windows"].get(l, {}).get("frequency") == "WEEKLY" for l in permitidas):
            gana_diaria += 1
        fila["srri_conservado"] = nuevo.get("srri") == srri
        fila["risk_score_source"] = nuevo.get("risk_score_source")
        fila["last_date"] = {"antes": actual.get("last_date"), "despues": nuevo.get("last_date")}
        recalculados.append(asset_id)
        detalle.append(fila)

    total = len(candidatos)
    print("PASADA EN SECO - recalculo de metricas de fondos")
    print("copia: %s" % args.backup)
    print("tolerancia: %.2f pp frente al trailing del proveedor" % args.tolerance_pp)
    print()
    print("Fondos con metricas del proveedor:      %4d" % total)
    print("  con alguna ventana sustituible:       %4d  (%s)" % (len(recalculados), _pct(len(recalculados), total)))
    print("  que se quedan enteros con el proveedor:%3d  (%s)" % (len(intactos), _pct(len(intactos), total)))
    print("  sin serie con la que calcular:        %4d" % len(sin_serie))
    print()
    print("Por ventana:")
    cabecera = ("vent", "sustit.", "discrep.", "sin prov.", "sin tramo", "divisa", "serie vieja")
    print("  %-5s %8s %9s %10s %10s %8s %12s" % cabecera)
    for label in LABELS:
        cuenta = por_ventana[label]
        print("  %-5s %8d %9d %10d %10d %8d %12d"
              % (label, cuenta[MATCH], cuenta[MISMATCH], cuenta[NO_PROVIDER],
                 cuenta[NO_WINDOW], cuenta[NO_BASIS], cuenta[STALE_SERIES]))
    print()
    print("  sustit.     el calculo reproduce al proveedor: se sustituye")
    print("  discrep.    no lo reproduce: se queda la cifra del proveedor")
    print("  sin prov.   el proveedor no publica esa ventana")
    print("  sin tramo   la serie no cubre la ventana (guard de cobertura)")
    print("  divisa      clase no EUR: serie en EUR, trailing en su divisa")
    print("  serie vieja la serie no llega al corte del proveedor")
    print()
    print("Lo que se gana:")
    print("  fondos que estrenan max_drawdown_5y:  %4d" % gana_mdd5y)
    print("  fondos que pasan a frecuencia semanal: %4d" % gana_diaria)
    print()
    print("Mayores discrepancias (se quedan con el proveedor):")
    print("  %8s %-5s %8s %8s  %-14s %s" % ("dif pp", "vent", "prov", "calc", "ISIN", "fondo"))
    for _abs, asset_id, label, nodo, nombre in sorted(discrepancias, reverse=True)[:args.top]:
        print("  %+8.2f %-5s %8.2f %8.2f  %-14s %s"
              % (nodo["diff_pp"], label, nodo["provider_pct"], nodo["computed_pct"],
                 asset_id, nombre[:44]))

    if args.json:
        args.json.write_text(json.dumps({
            "backup": str(args.backup),
            "tolerance_pp": args.tolerance_pp,
            "totales": {"candidatos": total, "recalculados": len(recalculados),
                        "intactos": len(intactos), "sin_serie": sin_serie},
            "por_ventana": {k: dict(v) for k, v in por_ventana.items()},
            "detalle": detalle,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        print()
        print("detalle por fondo en %s" % args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
