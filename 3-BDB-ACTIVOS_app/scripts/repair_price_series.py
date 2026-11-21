#!/usr/bin/env python3
"""Audits and performs tightly-scoped repairs on Firestore price_series docs.

The script defaults to dry-run. Use --write for database changes.

Decision 106 (05-11-2026): el proyecto sale de `master_project`, y --write exige el gate de
la maestra antes de la primera lectura. Hasta entonces llevaba fijo el proyecto de BDB, y
--fix-mixed-currency --write borraba alli documentos de price_series sin pedir nada.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import firestore

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT / "functions_python") not in sys.path:
    sys.path.insert(0, str(APP_ROOT / "functions_python"))

from master_project import master_project_id  # noqa: E402
from write_governance import log_master_write_decision, require_master_writes_enabled  # noqa: E402

OPERATION = "repair_price_series"
PRICE_SERIES_SCHEMA = "asset-price-series.v1.2"
SUPPORTED_PRICE_SERIES_SCHEMAS = {
    "asset-price-series.v1",
    "asset-price-series.v1.1",
    PRICE_SERIES_SCHEMA,
}


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _db() -> firestore.Client:
    root = Path(__file__).resolve().parents[1]
    _load_env_file(root / "functions_python" / ".env")
    _load_env_file(root / ".env.local")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": master_project_id()})
    return firestore.client()


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _points_count(doc: dict[str, Any]) -> int:
    points = doc.get("points")
    return len(points) if isinstance(points, list) else 0


def _has_valid_eur_series(price_docs: list[tuple[str, dict[str, Any]]]) -> bool:
    for _doc_id, doc in price_docs:
        if (
            doc.get("schema_version") in SUPPORTED_PRICE_SERIES_SCHEMAS
            and str(doc.get("currency", "")).upper() == "EUR"
            and _points_count(doc) > 0
        ):
            return True
    return False


def _is_empty_malformed_non_eur(doc: dict[str, Any]) -> bool:
    return (
        str(doc.get("currency", "")).upper() != "EUR"
        and _points_count(doc) == 0
        and doc.get("schema_version") not in SUPPORTED_PRICE_SERIES_SCHEMAS
    )


def find_mixed_currency_cleanup_candidates(db: firestore.Client, asset_id: str | None = None) -> list[dict[str, Any]]:
    assets = [db.collection("assets").document(asset_id).get()] if asset_id else db.collection("assets").stream()
    candidates: list[dict[str, Any]] = []
    for asset_snap in assets:
        if not asset_snap.exists:
            continue
        docs = [
            (price_snap.id, price_snap.to_dict() or {})
            for price_snap in asset_snap.reference.collection("price_series").stream()
        ]
        if not _has_valid_eur_series(docs):
            continue
        for doc_id, doc in docs:
            if _is_empty_malformed_non_eur(doc):
                candidates.append(
                    {
                        "asset_id": asset_snap.id,
                        "doc_id": doc_id,
                        "currency": doc.get("currency"),
                        "source": doc.get("source"),
                        "source_price_id": doc.get("source_price_id"),
                        "points_count": _points_count(doc),
                        "schema_version": doc.get("schema_version"),
                    }
                )
    return candidates


def write_backup(records: list[dict[str, Any]], backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = backup_dir / f"price-series-cleanup-backup-{stamp}.json"
    path.write_text(json.dumps(_json_safe(records), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def cleanup_mixed_currency(db: firestore.Client, candidates: list[dict[str, Any]], write: bool, backup_dir: Path) -> Path | None:
    if not write or not candidates:
        return None

    backup_records: list[dict[str, Any]] = []
    for candidate in candidates:
        doc_ref = (
            db.collection("assets")
            .document(candidate["asset_id"])
            .collection("price_series")
            .document(candidate["doc_id"])
        )
        snap = doc_ref.get()
        if not snap.exists:
            continue
        backup_records.append(
            {
                "asset_id": candidate["asset_id"],
                "doc_id": candidate["doc_id"],
                "path": doc_ref.path,
                "data": snap.to_dict() or {},
            }
        )

    backup_path = write_backup(backup_records, backup_dir)

    for record in backup_records:
        (
            db.collection("assets")
            .document(record["asset_id"])
            .collection("price_series")
            .document(record["doc_id"])
            .delete()
        )
    return backup_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair Firestore price_series data safely.")
    parser.add_argument("--asset-id", help="Limit the scan to one asset id.")
    parser.add_argument("--fix-mixed-currency", action="store_true", help="Delete empty malformed non-EUR docs when valid EUR docs exist.")
    parser.add_argument("--write", action="store_true", help="Apply changes. Without this flag the script is read-only.")
    parser.add_argument(
        "--backup-dir",
        default="output/price-series-repair",
        help="Directory for deletion backups when --write is used.",
    )
    args = parser.parse_args()

    if args.write:
        # Antes de la primera lectura, y antes de cargar ningun .env: una puerta no se abre desde un fichero.
        require_master_writes_enabled(OPERATION)
    else:
        log_master_write_decision(OPERATION, enabled=False, dry_run=True)
    db = _db()

    if args.fix_mixed_currency:
        candidates = find_mixed_currency_cleanup_candidates(db, args.asset_id)
        print(json.dumps({"write": args.write, "cleanup_candidates": candidates}, ensure_ascii=False, indent=2))
        backup_path = cleanup_mixed_currency(db, candidates, args.write, Path(args.backup_dir))
        if backup_path:
            print(json.dumps({"deleted": len(candidates), "backup": str(backup_path)}, ensure_ascii=False, indent=2))
        return

    parser.error("Choose at least one operation, for example --fix-mixed-currency.")


if __name__ == "__main__":
    main()
