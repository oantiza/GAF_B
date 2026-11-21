#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pasada en seco de «Mejorar cartera» sobre la copia local de la maestra.

No abre Firestore ni sale a la red: lee `assets.ndjson.gz` de la copia verificada
y ejecuta el MISMO servicio que la callable `improve_portfolio` con un lector en
memoria. Sirve para validar con fondos reales (fase 5 del plan) sin desplegar:
que candidatos entran, que propone, que descarta y cuanto tarda.

    python functions_python/scripts/dryrun_mejorar_cartera.py \
        [--backup <ruta>/assets.ndjson.gz] [--cartera ISIN=peso,ISIN=peso,...] \
        [--window 3Y|5Y] [--candidatos 5] [--max-sustituciones 3] [--json salida.json]

Sin `--cartera` usa una cartera de nueve fondos reales repartida por categorias
(una posicion por categoria, elegida entre los fondos con serie 3A, TER y
categoria). Los candidatos se preseleccionan como lo hace el cliente: misma
categoria, invertibles, ordenados por Sharpe 3A de metrics/latest.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from asset_eligibility import operator_blocks_selection  # noqa: E402
from optimization.improvement_service import improve_portfolio  # noqa: E402
from optimization.repository import InvalidOptimizationRequest, OptimizationError  # noqa: E402
from readmodel.mappers import map_category, map_costs, map_instrument_type  # noqa: E402

BACKUPS_DIR = ROOT.parents[1] / "2-plataforma-datos" / "data" / "backups"
DEFAULT_CATEGORIES = [
    "EAA Fund Global Large-Cap Blend Equity",
    "EAA Fund Europe Large-Cap Blend Equity",
    "EAA Fund US Large-Cap Blend Equity",
    "EAA Fund Global Emerging Markets Equity",
    "EAA Fund Sector Equity Technology",
    "EAA Fund EUR Corporate Bond",
    "EAA Fund EUR Ultra Short-Term Bond",
    "EAA Fund Global Emerging Markets Bond - EUR Hedged",
    "EAA Fund EUR Moderate Allocation - Global",
]
DEFAULT_WEIGHTS = [0.15, 0.12, 0.13, 0.08, 0.07, 0.15, 0.10, 0.08, 0.12]


class LectorLocal:
    """Lector con la interfaz de FirestoreOptimizationReader sobre la copia local."""

    def __init__(self, roots: dict, series: dict):
        self.roots, self.series = roots, series
        self.reads = 0

    def get_asset(self, asset_id):
        self.reads += 1
        return self.roots.get(asset_id)

    def get_price_series(self, asset_id):
        self.reads += 1
        return list(self.series.get(asset_id, []))


def latest_backup() -> Path:
    marks = sorted(glob.glob(str(BACKUPS_DIR / "*" / "assets.ndjson.gz")))
    if not marks:
        raise SystemExit("No hay copias en %s" % BACKUPS_DIR)
    return Path(marks[-1])


def read_backup(path: Path):
    roots, metrics = {}, {}
    series = defaultdict(list)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            record = json.loads(line)
            parts = str(record.get("path") or "").split("/")
            if len(parts) < 2 or parts[0] != "assets":
                continue
            asset_id, data = parts[1], record.get("data") or {}
            if len(parts) == 2:
                roots[asset_id] = data
            elif len(parts) == 4 and parts[2] == "metrics" and parts[3] == "latest":
                metrics[asset_id] = data
            elif len(parts) == 4 and parts[2] == "price_series":
                data.setdefault("document_id", parts[3])
                series[asset_id].append(data)
    return roots, metrics, series


def sharpe_3y(metrics_latest: dict | None) -> float:
    try:
        return float(((metrics_latest or {}).get("windows") or {}).get("3y", {}).get("sharpe_ratio"))
    except (TypeError, ValueError):
        return float("-inf")


def funds_by_category(roots, metrics):
    out = defaultdict(list)
    for asset_id, root in roots.items():
        if map_instrument_type(root) != "FUND" or operator_blocks_selection(root):
            continue
        if str((root.get("quality") or {}).get("status") or "").upper() in ("BLOCKED",):
            continue
        category = map_category(root)
        if not category or not (map_costs(root) or {}).get("ongoing_charge"):
            continue
        out[category].append(asset_id)
    for category in out:
        out[category].sort(key=lambda a: -sharpe_3y(metrics.get(a)))
    return out


def parse_portfolio(text: str) -> dict:
    out = {}
    for item in text.split(","):
        if "=" not in item:
            continue
        asset_id, weight = item.split("=", 1)
        out[asset_id.strip()] = float(weight.replace(",", "."))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backup", type=Path, default=None)
    parser.add_argument("--cartera", default=None, help="ISIN=peso,ISIN=peso,... (pesos en fraccion o en %%)")
    parser.add_argument("--window", default="3Y", choices=["3Y", "5Y"])
    parser.add_argument("--candidatos", type=int, default=5)
    parser.add_argument("--max-sustituciones", type=int, default=3)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    backup = args.backup or latest_backup()
    t0 = time.perf_counter()
    roots, metrics, series = read_backup(backup)
    t_read = time.perf_counter() - t0
    by_category = funds_by_category(roots, metrics)

    if args.cartera:
        portfolio = parse_portfolio(args.cartera)
    else:
        portfolio = {}
        for category, weight in zip(DEFAULT_CATEGORIES, DEFAULT_WEIGHTS):
            ids = by_category.get(category) or []
            if not ids:
                print("Sin fondos en la categoria %s: se omite." % category)
                continue
            # La posicion es el fondo de Sharpe mediano de su categoria, no el mejor:
            # asi la busqueda tiene margen real de mejora y de empeoramiento.
            portfolio[ids[len(ids) // 2]] = weight
    total = sum(portfolio.values())
    portfolio = {k: v / total for k, v in portfolio.items()}

    candidates = {}
    for asset_id in portfolio:
        category = map_category(roots.get(asset_id) or {})
        pool = [c for c in by_category.get(category, []) if c != asset_id and c not in portfolio]
        candidates[asset_id] = pool[:args.candidatos]

    print("Copia: %s (lectura %.1f s; %d raices, %d con serie)" % (backup.parent.name, t_read, len(roots), len(series)))
    print("\nCartera de partida (%s):" % args.window)
    for asset_id, weight in portfolio.items():
        root = roots.get(asset_id) or {}
        print("  %5.1f %%  %s  %s  [%s]  %d candidatos" % (
            weight * 100, asset_id, (root.get("identity") or {}).get("name"), map_category(root), len(candidates[asset_id])))

    reader = LectorLocal(roots, series)
    request = {
        "positions": [{"asset_id": a, "weight": w} for a, w in portfolio.items()],
        "candidates": candidates, "window": args.window, "max_substitutions": args.max_sustituciones,
    }
    t1 = time.perf_counter()
    try:
        result = improve_portfolio(reader, request)
    except (InvalidOptimizationRequest, OptimizationError) as exc:
        print("\nEl servicio rechazo la peticion: %s" % exc)
        return 1
    t_run = time.perf_counter() - t1

    print("\nEstado: %s  (%.1f s, %d combinaciones, busqueda %s, %d lecturas)" % (
        result["status"], t_run, result.get("evaluated_combinations", 0), result.get("search"), reader.reads))
    if result.get("reason"):
        print("Motivo: %s" % result["reason"])
    cov = result.get("coverage") or {}
    print("Ventana comun: %s a %s, %s semanas; tasa sin riesgo %.2f %% (%s)" % (
        cov.get("first_date"), cov.get("last_date"), cov.get("common_observations"),
        100 * result["risk_free"]["risk_free_rate"], result["risk_free"]["risk_free_rate_policy"]))
    orig = result.get("original") or {}
    if orig:
        m = orig["metrics"]
        print("Original  seleccion: rent %.2f %% vol %.2f %% sharpe %.2f mdd %.2f %% | confirmacion: rent %.2f %% vol %.2f %% sharpe %.2f mdd %.2f %% | coste %s" % (
            100 * m["selection"]["cagr"], 100 * m["selection"]["volatility"], m["selection"]["sharpe"], 100 * m["selection"]["max_drawdown"],
            100 * m["confirmation"]["cagr"], 100 * m["confirmation"]["volatility"], m["confirmation"]["sharpe"], 100 * m["confirmation"]["max_drawdown"],
            "N/D" if orig.get("weighted_cost") is None else "%.2f %%" % (100 * orig["weighted_cost"])))
    for index, proposal in enumerate(result.get("proposals") or [], start=1):
        m = proposal["metrics"]
        print("\nPropuesta %d (%d sustituciones):" % (index, len(proposal["substitutions"])))
        for sub in proposal["substitutions"]:
            print("  %5.1f %%  %s (%s) -> %s (%s)  corr %.2f  TE %.2f %%" % (
                100 * sub["weight"], sub["from_asset_id"], sub["from_name"][:40], sub["to_asset_id"], sub["to_name"][:40],
                sub["correlation"], 100 * sub["tracking_error"]))
        print("  confirmacion: rent %.2f %% vol %.2f %% sharpe %.2f mdd %.2f %% | coste %s | mejoras: %s" % (
            100 * m["confirmation"]["cagr"], 100 * m["confirmation"]["volatility"], m["confirmation"]["sharpe"], 100 * m["confirmation"]["max_drawdown"],
            "N/D" if proposal.get("weighted_cost") is None else "%.2f %%" % (100 * proposal["weighted_cost"]),
            ", ".join(i["label"] for i in proposal["improvements"])))
        for check in proposal["validation"]:
            if check["status"] != "PASS":
                print("  %-14s %s · %s" % (check["status"], check["label"], check["detail"]))
    if result.get("best_rejected"):
        print("\nMejor combinacion rechazada: %s -> no cumple %s" % (
            "; ".join("%s->%s" % (s["from_asset_id"], s["to_asset_id"]) for s in result["best_rejected"]["substitutions"]),
            ", ".join(result["best_rejected"]["failed"])))
    rejected = result.get("rejected_candidates") or {}
    if rejected:
        print("\nCandidatos descartados por series:")
        for position, items in rejected.items():
            for item in items:
                print("  %s: %s  %s  %s" % (position, item["asset_id"], item["reason"], item.get("detail", "")))
    excluded = result.get("excluded_assets") or []
    if excluded:
        print("\nActivos fuera: %s" % ", ".join("%s (%s)" % (e["asset_id"], e["reason"]) for e in excluded))
    if args.json:
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        print("\nJSON: %s" % args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
