#!/usr/bin/env python3
"""Ejecuta ciclos controlados del refresco de metrics/latest hasta completar la poblacion.

Puesta al dia de las ventanas congeladas (13-10-2026), primero en seco:
    python scripts/run_metrics_refresh.py --force-windows --max-reads 6000 --max-cycles 8 --detail-out ventanas.json
y solo con aprobacion:
    python scripts/run_metrics_refresh.py --force-windows --max-reads 6000 --max-cycles 8 --write --approval ...

El tope de lecturas es POR CICLO (el mismo que la ejecucion programada); el
recalculo completo (~22.000) se reparte en ciclos encadenados por el cursor de
raices. Cada ciclo recibe el cursor del anterior: en seco no se escribe en
meta/metrics_refresh y, sin pasarlo, cada ciclo repetiria las mismas raices.
--force-windows empieza desde la primera raiz (la puesta al dia es de toda la
poblacion); --start-after reanuda una puesta al dia interrumpida.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

APPROVAL = "YES_I_UNDERSTAND_MASTER_DB_WRITES"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--approval")
    parser.add_argument("--limit", type=int, default=800)
    parser.add_argument("--max-reads", type=int, default=6000)
    parser.add_argument("--max-cycles", type=int, default=10)
    parser.add_argument("--force-windows", action="store_true", dest="force_windows",
                        help="recalcula las metricas de calculo propio aunque la serie no haya avanzado")
    parser.add_argument("--detail-out", dest="detail_out",
                        help="fichero JSON con el antes/despues de cada recalculo")
    parser.add_argument("--start-after", dest="start_after",
                        help="raiz tras la que empieza el primer ciclo (por defecto: el cursor guardado; "
                             "con --force-windows, desde el principio)")
    args = parser.parse_args()
    if args.write and args.approval != APPROVAL:
        raise SystemExit("Aprobacion de escritura ausente.")

    if args.write:
        os.environ["BDB_ACTIVOS_ENABLE_MASTER_WRITES"] = APPROVAL
        os.environ["METRICS_WRITE_ENABLED"] = "true"

    from metrics_refresh import refresh_max_drawdown

    runs = []
    detail = []
    cursor = {}
    if args.start_after is not None:
        cursor["start_after"] = args.start_after
    elif args.force_windows:
        cursor["start_after"] = None
    for cycle in range(1, max(1, args.max_cycles) + 1):
        result = refresh_max_drawdown(
            limit=max(1, args.limit),
            write=args.write,
            max_reads=max(1, args.max_reads),
            force_windows=args.force_windows,
            collect_detail=bool(args.detail_out),
            **cursor,
        )
        cursor = {"start_after": result.get("next_scan_after_asset_id")}
        result["cycle"] = cycle
        detail.extend(result.pop("window_detail", None) or [])
        runs.append(result)
        print(json.dumps(result, ensure_ascii=True, default=str))
        if result.get("errors") and not result.get("stopped_by_budget"):
            break
        if result.get("cycle_completed"):
            break

    summary = {
        "applied": args.write,
        "runs": len(runs),
        "cycle_completed": bool(runs and runs[-1].get("cycle_completed")),
        "written": sum(int(run.get("written") or 0) for run in runs),
        "errors": sum(int(run.get("errors") or 0) for run in runs),
        "non_budget_errors": sum(
            max(0, int(run.get("errors") or 0) - (1 if run.get("stopped_by_budget") else 0))
            for run in runs
        ),
        "stopped_by_budget_runs": sum(1 for run in runs if run.get("stopped_by_budget")),
        "would_write": sum(int(run.get("would_write") or 0) for run in runs),
        "read_budget_max": args.max_reads,
        "reads_per_cycle": [int(run.get("read_budget_used") or 0) for run in runs],
        "reads_total": sum(int(run.get("read_budget_used") or 0) for run in runs),
        "windows_recomputed": sum(int(run.get("windows_recomputed") or 0) for run in runs),
        "windows_skipped": [item for run in runs for item in run.get("windows_skipped") or []],
        "excluded_assets": sorted({aid for run in runs for aid in run.get("excluded_assets") or []}),
    }
    if args.detail_out:
        Path(args.detail_out).write_text(json.dumps(detail, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"summary": summary}, ensure_ascii=True))
    return 0 if summary["cycle_completed"] and summary["non_budget_errors"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
