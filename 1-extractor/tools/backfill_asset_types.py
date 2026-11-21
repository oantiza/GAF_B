"""Completa identificacion.tipo desde config/fondos.csv en JSON históricos.

Por defecto solo informa. ``--write`` aplica escrituras atómicas locales; nunca
consulta ni modifica Firestore.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.package_integrity import atomic_write_text


def load_types(csv_path: Path) -> dict[str, str]:
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        return {
            str(row.get("isin") or "").strip().upper():
            str(row.get("tipo") or "").strip().lower()
            for row in csv.DictReader(handle)
            if str(row.get("isin") or "").strip()
            and str(row.get("tipo") or "").strip()
        }


def backfill_types(funds_dir: Path, types: dict[str, str], write: bool = False) -> dict:
    changed: list[str] = []
    conflicts: list[dict] = []
    missing_catalog: list[str] = []
    for path in sorted(funds_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        isin = str((data.get("meta") or {}).get("isin") or path.stem).strip().upper()
        configured = types.get(isin)
        current = str((data.get("identificacion") or {}).get("tipo") or "").strip().lower()
        if current:
            if configured and current != configured:
                conflicts.append({"isin": isin, "json": current, "catalog": configured})
            continue
        if not configured:
            missing_catalog.append(isin)
            continue
        data.setdefault("identificacion", {})["tipo"] = configured
        changed.append(isin)
        if write:
            atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))
    return {
        "mode": "WRITE" if write else "DRY_RUN",
        "changed": changed,
        "conflicts": conflicts,
        "missing_catalog": missing_catalog,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--base", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = backfill_types(
        args.base / "data" / "funds",
        load_types(args.base / "config" / "fondos.csv"),
        write=args.write,
    )
    print(json.dumps({**result, "changed_count": len(result["changed"])}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
