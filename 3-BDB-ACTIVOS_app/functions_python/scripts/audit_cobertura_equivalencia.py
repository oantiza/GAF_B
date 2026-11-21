#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Auditoria de cobertura de datos para «Mejorar cartera» (fase 0, solo lectura).

No abre Firestore ni sale a la red: lee la copia local verificada
(`2-plataforma-datos/data/backups/<marca>/assets.ndjson.gz`) y cuenta, por
vehiculo y clase economica, cuantos activos tienen cada dato que el motor de
equivalencia necesita (plan en docs/PLAN_MEJORA_CARTERA_EQUIVALENTES_2026-10-13.md):

  - serie propia en EUR que cubre 3A / 5A en semanal (regla del optimizador:
    48 semanas por anio de ventana), respetando `usable_from` y `blocked` de
    fund_history_policies.json;
  - coste corriente (TER), categoria, region, politica de distribucion, clase,
    fecha de lanzamiento, patrimonio;
  - mezcla de activos, sectores, regiones RV, tamanos, estilo RV;
  - perfil de renta fija (duracion, calidad crediticia): ingerido, no expuesto;
  - frecuencia declarada de metrics/latest (A1: semanal frente a diario);
  - familias con mas de una clase (mismo fondo, distinta clase).

Ademas inventaria las claves presentes en `classification`, `product`, `costs`,
`risk` y `fixed_income_profile`, para no disenar sobre campos que no existen.

    python functions_python/scripts/audit_cobertura_equivalencia.py \
        --backup <ruta>/assets.ndjson.gz [--salida docs/COBERTURA.md]

Sin `--backup` usa la marca mas reciente de 2-plataforma-datos/data/backups.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from readmodel.mappers import (  # noqa: E402
    _uniform_window_label, get_currency, is_investable, map_category, map_costs,
    map_economic_asset_class, map_exposure_detail, map_instrument_type, map_pms_exposure, map_region,
)
from weekly_sampling import weekly_last_observations  # noqa: E402

BACKUPS_DIR = ROOT.parents[1] / "2-plataforma-datos" / "data" / "backups"
POLICIES = json.loads((ROOT / "fund_history_policies.json").read_text(encoding="utf-8"))["assets"]
SERIES_SCHEMAS = {"asset-price-series.v1", "asset-price-series.v1.1", "asset-price-series.v1.2"}
WEEKS_PER_YEAR_REQUIRED = 48  # MIN_WEEKS_PER_WINDOW_YEAR del optimizador
WINDOWS = {"3A": 3, "5A": 5}
VEHICLES = ("FUND", "ETF")
# Sin campo de distribucion ni de cobertura en la raiz: solo se pueden INFERIR del nombre.
# «Cap» solo cuenta como capitalizacion si no va tras small/mid/large/flex/all/micro
# («Small Cap» es tamano, no clase); «Income» solo cuenta como «Inc» aislado.
DISTRIBUTION_TOKEN = re.compile(r"(?<!small )(?<!mid )(?<!large )(?<!flex )(?<!all )(?<!micro )\b(acc|accumulation|acum|capitalisation|cap|dis|dist|distribution|inc)\b", re.I)
# Cobertura de divisa: la MISMA expresion que src/core/fundEquivalence.ts (MEDIA-16 y
# ronda 2, 14-10-2026), sobre el nombre plegado a minusculas sin tildes. Cuenta
# «Hedged»/«Hdg»/«Hgd»/«cubierta» (no «Interest Rate/Duration Hedged», que cubre tipos),
# la H junto a la divisa («EUR H», «EURH», «H EUR», no «Class H EUR») y el sufijo «-H»
# de la clase («A-H»). Una «H» suelta («Clase H», «B&H») no dice nada.
HEDGE_CURRENCIES = "eur|usd|gbp|chf|jpy|sek|nok|dkk|aud|cad|nzd|hkd|sgd|cnh|czk|pln|huf"
HEDGED_TOKEN = re.compile("|".join([
    r"(?<!rate )(?<!duration )\b(?:hedged|hdg|hgd|cubiert[ao])\b",
    r"\b(?:%s)[- ]?h\b" % HEDGE_CURRENCIES,
    r"(?<!class )(?<!clase )\bh[- ](?:%s)\b" % HEDGE_CURRENCIES,
    r"\b[a-z0-9]{1,3}-h\b",
]))
UNHEDGED_TOKEN = re.compile(r"\b(unhedged|non[- ]hedged|no cubiert[ao]|sin cobertura)\b")

# Tokens de clase que se quitan del nombre para agrupar por familia (misma estrategia).
CLASS_TOKENS = {
    "class", "clase", "cl", "acc", "acum", "accumulation", "accumulating", "cap", "dis", "dist",
    "inc", "income", "distribution", "distributing", "eur", "usd", "gbp", "chf", "jpy", "sek",
    "nok", "dkk", "hedged", "hdg", "h", "unhedged", "a", "b", "c", "d", "e", "f", "g", "i", "ia",
    "ic", "id", "ie", "k", "l", "m", "n", "p", "q", "r", "s", "t", "u", "w", "x", "y", "z", "z2",
    "ae", "ad", "ah", "pa", "pb", "pd", "pi", "ra", "rd", "re", "ri", "ucits", "etf", "fi", "fund",
    "fonds", "fondo", "sicav", "plc", "lux", "ie", "de", "es", "fr", "the", "of", "and", "y",
    "retail", "institutional", "inst", "clean", "seed", "founder", "share", "shares",
    # Como familyKey del frontend: «capitalisation», «hgd» y las divisas de clase con
    # su variante cubierta (PLN Hedged, AUDH...).
    "capitalisation", "hgd",
    *HEDGE_CURRENCIES.split("|"), *("%sh" % ccy for ccy in HEDGE_CURRENCIES.split("|")),
}


def _fold(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn").lower()


def infer_hedged(name: str):
    """True/False con senal clara en el nombre, None si no dice nada (inferHedged)."""
    text = _fold(name)
    if UNHEDGED_TOKEN.search(text):
        return False
    return True if HEDGED_TOKEN.search(text) else None


def family_key(name: str) -> str:
    tokens = re.split(r"[^a-z0-9]+", _fold(name))
    kept = [t for t in tokens if t and t not in CLASS_TOKENS and not t.isdigit()]
    return " ".join(kept)


def _parse_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def latest_backup() -> Path:
    marks = sorted(glob.glob(str(BACKUPS_DIR / "*" / "assets.ndjson.gz")))
    if not marks:
        raise SystemExit("No hay copias en %s" % BACKUPS_DIR)
    return Path(marks[-1])


def read_backup(path: Path):
    """Raices FUND/ETF, su metrics/latest y, por activo, sus fechas de serie EUR."""
    roots, metrics = {}, {}
    series = defaultdict(dict)       # asset_id -> {date: value}
    series_problem = {}              # asset_id -> motivo (divisa, esquema, bloqueada)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            record = json.loads(line)
            parts = str(record.get("path") or "").split("/")
            if len(parts) < 2 or parts[0] != "assets":
                continue
            asset_id, data = parts[1], record.get("data") or {}
            if len(parts) == 2:
                if str(data.get("asset_type") or "").upper() in VEHICLES:
                    roots[asset_id] = data
            elif len(parts) == 4 and parts[2] == "metrics" and parts[3] == "latest":
                metrics[asset_id] = data
            elif len(parts) == 4 and parts[2] == "price_series":
                if data.get("schema_version") not in SERIES_SCHEMAS:
                    series_problem.setdefault(asset_id, "esquema de serie no soportado")
                    continue
                if data.get("currency") != "EUR":
                    series_problem.setdefault(asset_id, "serie sin version EUR")
                    continue
                if data.get("history_quality_status") == "BLOCKED":
                    series_problem[asset_id] = "serie bloqueada por calidad"
                    continue
                for point in data.get("points") or []:
                    d = _parse_date((point or {}).get("date"))
                    try:
                        v = float(point.get("value"))
                    except (TypeError, ValueError, AttributeError):
                        continue
                    if d is not None and v > 0:
                        series[asset_id][d] = v
    return roots, metrics, series, series_problem


def series_coverage(asset_id: str, points: dict[date, float]) -> dict:
    """Semanas observadas por ventana (desde la ultima fecha), con la politica del activo."""
    policy = POLICIES.get(asset_id, {})
    out = {"blocked": bool(policy.get("blocked")), "usable_from": policy.get("usable_from")}
    usable_from = _parse_date(policy.get("usable_from"))
    dated = sorted((d, v) for d, v in points.items() if usable_from is None or d >= usable_from)
    if not dated:
        out.update(first=None, last=None, weeks={k: 0 for k in WINDOWS}, covers={k: False for k in WINDOWS})
        return out
    last = dated[-1][0]
    out["first"], out["last"] = dated[0][0].isoformat(), last.isoformat()
    out["weeks"], out["covers"] = {}, {}
    for label, years in WINDOWS.items():
        cutoff = last - timedelta(days=years * 366)
        weeks = len(weekly_last_observations([(d, v) for d, v in dated if d >= cutoff]))
        out["weeks"][label] = weeks
        out["covers"][label] = weeks >= WEEKS_PER_YEAR_REQUIRED * years and not out["blocked"]
    return out


def _present(value) -> bool:
    """Un mapa de tramos con todos los valores a 0/None (p. ej. credit_quality en un fondo
    de RV) no es un dato: cuenta como ausente."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value)
    if isinstance(value, dict):
        return any(_present(v) and (not isinstance(v, (int, float)) or v > 0) for v in value.values())
    return True


def _credit_band(quality) -> str | None:
    """IG / HY a partir del rating medio del proveedor; None si no se puede."""
    q = _fold(str(quality or "")).replace(" ", "")
    if not q:
        return None
    if q.startswith("bbb") or (q.startswith("a") and not q.startswith("ab")):
        return "IG"  # AAA, AA, A, BBB
    if q.startswith(("bb", "b", "ccc", "cc", "c", "belowb", "nr", "notrated")):
        return "HY/sin grado"
    return "otro: %s" % quality


def audit(roots, metrics, series, series_problem):
    rows = []
    key_inventory = {section: Counter() for section in ("classification", "product", "costs", "risk", "fixed_income_profile", "portfolio_exposure")}
    families = defaultdict(list)
    for asset_id, root in roots.items():
        vehicle = map_instrument_type(root)
        if vehicle not in VEHICLES:
            continue
        econ = map_economic_asset_class(root)
        product = root.get("product") or {}
        classification = root.get("classification") or {}
        quality = root.get("quality") or {}
        fip = root.get("fixed_income_profile") or {}
        exposure = map_exposure_detail(root)
        pms = map_pms_exposure(root, econ)
        costs = map_costs(root) or {}
        fundamentals = root.get("fundamentals") or {}
        fund_metrics = fundamentals.get("fund_metrics") if isinstance(fundamentals.get("fund_metrics"), dict) else {}
        ml = metrics.get(asset_id) or {}
        for section in key_inventory:
            node = root.get(section)
            if isinstance(node, dict):
                key_inventory[section].update(k for k, v in node.items() if _present(v))
        cov = series_coverage(asset_id, series.get(asset_id, {}))
        name = str((root.get("identity") or {}).get("name") or asset_id)
        fam = family_key(name)
        if fam:
            families[fam].append(asset_id)
        rows.append({
            "asset_id": asset_id,
            "name": name,
            "vehicle": vehicle,
            "econ": econ,
            "investable": is_investable(root),
            "status": quality.get("status"),
            "currency": get_currency(root),
            "category": map_category(root),
            "region": map_region(root),
            "strategy_text": _present(classification.get("strategy")) or _present(product.get("strategy")),
            "ter": costs.get("ongoing_charge"),
            "distribution": product.get("distribution_policy") or product.get("distribution") or product.get("inc_acc"),
            "share_class": product.get("share_class"),
            "inception": product.get("inception_date") or product.get("launch_date"),
            "total_assets": fund_metrics.get("total_assets") or (root.get("fund_metrics") or {}).get("total_assets"),
            "asset_mix": any(_present(pms.get(k)) and pms.get(k) for k in ("equity", "fixed_income", "cash", "alternative")),
            "sectors": bool(exposure.get("sectors")),
            "equity_regions": bool(exposure.get("equity_regions")),
            "market_caps": bool(exposure.get("market_caps")),
            "equity_styles": bool(exposure.get("equity_styles")),
            "fi_duration": fip.get("effective_duration") if fip.get("effective_duration") is not None else fip.get("modified_duration"),
            "fi_credit": _credit_band(fip.get("avg_credit_quality")),
            "fi_any": bool(fip),
            "metrics_frequency": _uniform_window_label(ml.get("windows") or {}, "frequency"),
            "metrics_method": _uniform_window_label(ml.get("windows") or {}, "method"),
            "pe_duration": _present((root.get("portfolio_exposure") or {}).get("duration")),
            "pe_credit": _present((root.get("portfolio_exposure") or {}).get("credit")),
            "pe_bond_types": _present((root.get("portfolio_exposure") or {}).get("bond_types")),
            "fi_credit_quality_map": _present(fip.get("credit_quality")),
            "fi_maturity_map": _present(fip.get("maturity_allocation")),
            "fi_ig_hy_pct": fip.get("investment_grade_pct") is not None,
            "tracking_error": (root.get("risk") or {}).get("tracking_error_pct") is not None,
            "name_distribution": (lambda m: m.group(1).lower() if m else None)(DISTRIBUTION_TOKEN.search(name)),
            "name_hedged": infer_hedged(name) is True,
            "series_problem": series_problem.get(asset_id),
            "series": cov,
            "family": fam,
        })
    return rows, key_inventory, families


def pct(n: int, total: int) -> str:
    return "%d (%d %%)" % (n, round(100 * n / total)) if total else "0"


def render(rows, key_inventory, families, backup: Path) -> str:
    lines = []
    lines.append("# Cobertura de datos para «Mejorar cartera» (fase 0)\n")
    lines.append("**Fuente:** copia local verificada `%s` (solo lectura, sin Firestore).  " % backup.parent.name)
    lines.append("**Generado por:** `functions_python/scripts/audit_cobertura_equivalencia.py`.  ")
    lines.append("**Regla de ventana:** 48 semanas por anio (la del optimizador), desde la ultima fecha de la serie, respetando `usable_from`/`blocked` de `fund_history_policies.json`.\n")

    def block(title, subset):
        total = len(subset)
        lines.append("## %s\n" % title)
        lines.append("Activos: **%d** (invertibles: %d, estado ACCEPTED: %d)\n" % (
            total, sum(r["investable"] for r in subset), sum(r["status"] == "ACCEPTED" for r in subset)))
        if not total:
            return
        checks = [
            ("Serie EUR que cubre 3A (>= 144 semanas)", lambda r: r["series"]["covers"]["3A"]),
            ("Serie EUR que cubre 5A (>= 240 semanas)", lambda r: r["series"]["covers"]["5A"]),
            ("Serie con `usable_from` (recorte CNMV)", lambda r: bool(r["series"]["usable_from"])),
            ("Serie bloqueada por politica", lambda r: r["series"]["blocked"]),
            ("Serie con problema (divisa/esquema/calidad)", lambda r: bool(r["series_problem"])),
            ("metrics/latest en semanal (WEEKLY)", lambda r: r["metrics_frequency"] == "WEEKLY"),
            ("metrics/latest en diario u otra frecuencia", lambda r: r["metrics_frequency"] not in (None, "WEEKLY")),
            ("metrics/latest sin frecuencia uniforme", lambda r: r["metrics_frequency"] is None),
            ("Tracking error frente a su benchmark (risk)", lambda r: r["tracking_error"]),
            ("Coste corriente (TER)", lambda r: r["ter"] is not None),
            ("Categoria", lambda r: bool(r["category"])),
            ("Region", lambda r: bool(r["region"])),
            ("Texto de estrategia", lambda r: r["strategy_text"]),
            ("Politica de distribucion (campo)", lambda r: bool(r["distribution"])),
            ("Distribucion INFERIDA del nombre (Acc/Dist/Inc/Cap)", lambda r: bool(r["name_distribution"])),
            ("Cobertura de divisa INFERIDA del nombre (Hedged/Hgd/<divisa> H/-H)", lambda r: r["name_hedged"]),
            ("Clase declarada (share_class)", lambda r: bool(r["share_class"])),
            ("Fecha de lanzamiento", lambda r: bool(r["inception"])),
            ("Patrimonio", lambda r: r["total_assets"] is not None),
            ("Mezcla de activos (pms_exposure)", lambda r: r["asset_mix"]),
            ("Sectores", lambda r: r["sectors"]),
            ("Regiones RV", lambda r: r["equity_regions"]),
            ("Tamanos de empresa", lambda r: r["market_caps"]),
            ("Estilo RV (equity_styles)", lambda r: r["equity_styles"]),
            ("Perfil RF: algun dato (fixed_income_profile)", lambda r: r["fi_any"]),
            ("Perfil RF: duracion", lambda r: r["fi_duration"] is not None),
            ("Perfil RF: calidad crediticia media (avg_credit_quality)", lambda r: r["fi_credit"] is not None),
            ("Perfil RF: reparto por calidad (credit_quality)", lambda r: r["fi_credit_quality_map"]),
            ("Perfil RF: reparto por vencimiento (maturity_allocation)", lambda r: r["fi_maturity_map"]),
            ("Perfil RF: % IG / % HY", lambda r: r["fi_ig_hy_pct"]),
            ("Exposicion: duracion por tramos (portfolio_exposure.duration)", lambda r: r["pe_duration"]),
            ("Exposicion: credito por tramos (portfolio_exposure.credit)", lambda r: r["pe_credit"]),
            ("Exposicion: tipos de bono (portfolio_exposure.bond_types)", lambda r: r["pe_bond_types"]),
        ]
        lines.append("| Dato | Con dato |")
        lines.append("|---|---|")
        for label, fn in checks:
            lines.append("| %s | %s |" % (label, pct(sum(1 for r in subset if fn(r)), total)))
        lines.append("")
        # Candidatos utilizables de verdad: invertible + serie 3A + TER + categoria.
        usable = [r for r in subset if r["investable"] and r["series"]["covers"]["3A"] and r["ter"] is not None and r["category"]]
        lines.append("**Utilizables como candidato hoy** (invertible + serie 3A + TER + categoria): **%s**\n" % pct(len(usable), total))

    lines.append("## Resumen por vehiculo\n")
    for vehicle in VEHICLES:
        block("Vehiculo %s" % vehicle, [r for r in rows if r["vehicle"] == vehicle])
    lines.append("## Fondos por clase economica\n")
    funds = [r for r in rows if r["vehicle"] == "FUND"]
    by_econ = Counter(r["econ"] for r in funds)
    lines.append("| Clase | Fondos | Invertibles | Serie 3A | Serie 5A | TER | Categoria | Region | Distribucion | Mezcla | Sectores | Regiones RV | Tamanos | Perfil RF | Utilizables |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for econ, n in by_econ.most_common():
        s = [r for r in funds if r["econ"] == econ]
        usable = sum(1 for r in s if r["investable"] and r["series"]["covers"]["3A"] and r["ter"] is not None and r["category"])
        lines.append("| %s | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d |" % (
            econ, n, sum(r["investable"] for r in s),
            sum(r["series"]["covers"]["3A"] for r in s), sum(r["series"]["covers"]["5A"] for r in s),
            sum(r["ter"] is not None for r in s), sum(bool(r["category"]) for r in s), sum(bool(r["region"]) for r in s),
            sum(bool(r["distribution"]) for r in s), sum(r["asset_mix"] for r in s), sum(r["sectors"] for r in s),
            sum(r["equity_regions"] for r in s), sum(r["market_caps"] for r in s), sum(r["fi_any"] for r in s), usable))
    lines.append("")

    lines.append("## Categorias con mas fondos utilizables (candidatos por categoria)\n")
    usable_funds = [r for r in funds if r["investable"] and r["series"]["covers"]["3A"] and r["ter"] is not None and r["category"]]
    cats = Counter(r["category"] for r in usable_funds)
    lines.append("| Categoria | Fondos utilizables |")
    lines.append("|---|---|")
    for cat, n in cats.most_common(40):
        lines.append("| %s | %d |" % (cat, n))
    singles = sum(1 for n in cats.values() if n == 1)
    lines.append("\nCategorias con un solo fondo utilizable (sin sustituto dentro de la categoria): **%d de %d**.\n" % (singles, len(cats)))

    lines.append("## Valores de distribucion y frecuencia de metricas\n")
    lines.append("Distribucion (fondos): %s\n" % dict(Counter(str(r["distribution"]) for r in funds).most_common(8)))
    lines.append("Frecuencia metrics/latest (fondos): %s\n" % dict(Counter(str(r["metrics_frequency"]) for r in funds).most_common(8)))
    lines.append("Banda crediticia RF (fondos con perfil): %s\n" % dict(Counter(str(r["fi_credit"]) for r in funds if r["fi_any"]).most_common(8)))

    lines.append("## Familias con mas de una clase (mismo fondo, distinta clase)\n")
    multi = {k: v for k, v in families.items() if len(v) > 1}
    lines.append("Familias detectadas por nombre normalizado: **%d** con mas de una clase, que agrupan %d activos. Deteccion heuristica: confirmar con correlacion ~1 en la fase 3.\n" % (
        len(multi), sum(len(v) for v in multi.values())))
    by_id = {r["asset_id"]: r for r in rows}
    lines.append("| Familia | Clases | Ejemplos (id · TER) |")
    lines.append("|---|---|---|")
    for fam, ids in sorted(multi.items(), key=lambda kv: -len(kv[1]))[:25]:
        examples = ", ".join("%s · %s" % (i, ("%.2f %%" % (by_id[i]["ter"] * 100)) if by_id[i]["ter"] is not None else "TER N/D") for i in ids[:4])
        lines.append("| %s | %d | %s |" % (fam[:60], len(ids), examples))
    lines.append("")

    lines.append("## Inventario de claves presentes (numero de activos con la clave rellena)\n")
    for section, counter in key_inventory.items():
        lines.append("- `%s`: %s" % (section, ", ".join("%s (%d)" % (k, n) for k, n in counter.most_common(30)) or "ninguna"))
    lines.append("")

    lines.append("## Lectura para el plan\n")
    lines.append("- Los criterios de la capa 1 (vehiculo, clase, categoria, region, distribucion) y la capa 2 (mezcla, sectores, regiones RV, tamanos) se evaluan con las columnas de arriba; un dato ausente se declara «sin dato» y nunca cuenta como coincidencia.")
    lines.append("- El perfil de renta fija existe solo en la raiz: para usarlo en la app hay que mapearlo en `readmodel/mappers.map_asset_detail` (fase 1 del plan).")
    lines.append("- La politica de distribucion, la clase y la fecha de lanzamiento NO existen como campo en la raiz: solo se pueden inferir del nombre y hay que marcarlas como inferidas.")
    lines.append("- Las series de fondos son NAV: comparar solo dentro de la misma politica de distribucion (inferida), o avisar.")
    lines.append("- La deteccion de familias por nombre tiene falsos positivos (fondos distintos de una misma gestora): confirmar siempre con correlacion de series.")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backup", type=Path, default=None, help="assets.ndjson(.gz) de la copia local")
    parser.add_argument("--salida", type=Path, default=None, help="markdown de salida (por defecto, stdout)")
    parser.add_argument("--json", type=Path, default=None, help="volcado JSON por activo (opcional)")
    args = parser.parse_args()
    backup = args.backup or latest_backup()
    roots, metrics, series, series_problem = read_backup(backup)
    rows, key_inventory, families = audit(roots, metrics, series, series_problem)
    report = render(rows, key_inventory, families, backup)
    if args.salida:
        args.salida.parent.mkdir(parents=True, exist_ok=True)
        args.salida.write_text(report, encoding="utf-8")
        print("escrito %s (%d activos)" % (args.salida, len(rows)))
    else:
        sys.stdout.write(report)
    if args.json:
        args.json.write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
