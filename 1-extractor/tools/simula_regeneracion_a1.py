"""Simula el efecto del fix A1 usando solo canonicos y cache local.

No modifica ``data/funds`` ni consulta servicios externos. El CSV contiene la
mejor rentabilidad Morningstar disponible por campo: snapshot explicitamente
anualizado, screener como respaldo, o null.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from fetchers import morningstar_lt  # noqa: E402


PERIODS = {
    "3a_anualizada": ("3Year", "M36"),
    "5a_anualizada": ("5Year", "M60"),
    "10a_anualizada": ("10Year", "M120"),
}


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _get(data: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _same(left: Any, right: Any, tolerance: float = 1e-5) -> bool:
    try:
        return abs(float(left) - float(right)) <= tolerance
    except (TypeError, ValueError):
        return False


def _mapped_returns(raw_dir: Path) -> tuple[dict, dict]:
    screener: dict = {}
    snapshot: dict = {}

    screener_path = raw_dir / "screener.json"
    if screener_path.exists():
        morningstar_lt._mapea_screener(screener, _read_json(screener_path))

    for name in ("MFsnapshot.json", "ETFsnapshot.json"):
        path = raw_dir / name
        if path.exists():
            morningstar_lt._mapea_snapshot(snapshot, _read_json(path))
    return screener, snapshot


def _sal_values(raw_dir: Path) -> dict[str, float]:
    path = raw_dir / "sal_trailingReturn.json"
    if not path.exists():
        return {}
    payload = _read_json(path)
    columns = [str(value).replace(" ", "").lower()
               for value in payload.get("columnDefs") or []]
    values = payload.get("totalReturnNAV")
    if not isinstance(values, list):
        return {}

    result = {}
    for field, (column, _snapshot_period) in PERIODS.items():
        if column.lower() not in columns:
            continue
        index = columns.index(column.lower())
        if index >= len(values):
            continue
        try:
            result[field] = float(values[index])
        except (TypeError, ValueError):
            pass
    return result


def _snapshot_cumulative_values(raw_dir: Path) -> dict[str, float]:
    """Extrae la pareja no anualizada del snapshot para confirmar contaminacion."""
    path = raw_dir / "MFsnapshot.json"
    if not path.exists():
        return {}
    payload = _read_json(path)
    series = next((item for item in payload.get("TrailingPerformance") or []
                   if item.get("Type") == "MonthEnd"
                   and item.get("ReturnType") == "ItPostTax"), None)
    if series is None:
        series = next((item for item in payload.get("TrailingPerformance") or []
                       if item.get("Type") == "MonthEnd"), None)
    if not series:
        return {}

    by_period = {snapshot_period: field
                 for field, (_sal_column, snapshot_period) in PERIODS.items()}
    result = {}
    for item in series.get("Return") or []:
        field = by_period.get(item.get("TimePeriod"))
        if not field or item.get("Annualized") is True:
            continue
        try:
            result[field] = float(item.get("Value"))
        except (TypeError, ValueError):
            pass
    return result


def _value(mapped: dict, field: str) -> Any:
    return _get(mapped, "rentabilidad", "trailing_pct", field, "fondo")


def simulate(output_path: Path) -> dict:
    funds_dir = BASE / "data" / "funds"
    raw_base = BASE / "cache" / "raw_morningstar_lt"
    canonical_paths = sorted(funds_dir.glob("*.json"))
    rows = []
    coverage = Counter()
    sources = Counter()
    all_current_to_null = Counter()
    sal_without_replacement = Counter()
    contaminated_ids: set[str] = set()
    missing_raw = []
    missing_screener = []

    for canonical_path in canonical_paths:
        isin = canonical_path.stem
        canonical = _read_json(canonical_path)
        raw_dir = raw_base / isin
        if not raw_dir.is_dir():
            missing_raw.append(isin)
        elif not (raw_dir / "screener.json").exists():
            missing_screener.append(isin)

        screener, snapshot = _mapped_returns(raw_dir) if raw_dir.is_dir() else ({}, {})
        sal = _sal_values(raw_dir) if raw_dir.is_dir() else {}
        cumulative = _snapshot_cumulative_values(raw_dir) if raw_dir.is_dir() else {}

        for field in PERIODS:
            current = _get(canonical, "rentabilidad", "trailing_pct", field, "fondo")
            snapshot_value = _value(snapshot, field)
            screener_value = _value(screener, field)
            if snapshot_value is not None:
                new_value, source = snapshot_value, "snapshot"
            elif screener_value is not None:
                new_value, source = screener_value, "screener"
            else:
                new_value, source = None, "null"

            if new_value is not None:
                coverage[field] += 1
            sources[(field, source)] += 1
            if current is not None and new_value is None:
                all_current_to_null[field] += 1
            if _same(current, sal.get(field)) and new_value is None:
                sal_without_replacement[field] += 1
            if (_same(current, sal.get(field))
                    and _same(sal.get(field), cumulative.get(field))
                    and new_value is not None
                    and not _same(current, new_value)):
                contaminated_ids.add(isin)

            rows.append({
                "isin": isin,
                "campo": field,
                "valor_actual": "" if current is None else current,
                "valor_nuevo": "" if new_value is None else new_value,
                "fuente": source,
            })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=("isin", "campo", "valor_actual", "valor_nuevo", "fuente"),
        )
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(output_path)

    return {
        "canonical_assets": len(canonical_paths),
        "csv_rows": len(rows),
        "new_value_coverage": dict(coverage),
        "source_counts": {
            field: {source: sources[(field, source)]
                    for source in ("snapshot", "screener", "null")}
            for field in PERIODS
        },
        "confirmed_contaminated_funds": len(contaminated_ids),
        "confirmed_contaminated_isins": sorted(contaminated_ids),
        "a1_sal_values_without_replacement": dict(sal_without_replacement),
        "all_existing_values_without_morningstar_replacement": dict(all_current_to_null),
        "missing_raw_cache": len(missing_raw),
        "missing_raw_cache_isins": missing_raw,
        "missing_screener": len(missing_screener),
        "missing_screener_isins": missing_screener,
        "output": str(output_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=BASE / "reports" / "simulacion_regeneracion_A1.csv",
    )
    args = parser.parse_args()
    summary = simulate(args.output.resolve())
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
