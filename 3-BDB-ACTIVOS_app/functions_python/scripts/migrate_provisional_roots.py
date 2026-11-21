#!/usr/bin/env python3
"""Normaliza roots provisionales EODHD sin tocar sus subcolecciones."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from google.cloud import firestore as gcf  # noqa: E402

from contract_validation import ContractValidationError, validate_contract  # noqa: E402
from ingest_asset import build_market_root, build_stock_root  # noqa: E402
from master_project import master_project_id  # noqa: E402
from write_governance import require_master_writes_enabled  # noqa: E402

APPROVAL = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def _root_is_valid(root: dict) -> bool:
    schemas = ["asset-stock.v1.1.schema.json"] if root.get("asset_type") == "STOCK" else [
        "asset.v1.2.schema.json",
        "asset-market.v1.schema.json",
    ]
    for schema in schemas:
        try:
            validate_contract(root, schema)
            return True
        except ContractValidationError:
            pass
    return False


def _symbol(asset_ref, root: dict) -> str | None:
    identifiers = root.get("identifiers") if isinstance(root.get("identifiers"), dict) else {}
    value = identifiers.get("eodhd_code")
    if isinstance(value, str) and "." in value:
        return value
    query = asset_ref.collection("price_series").order_by("last_date", direction=gcf.Query.DESCENDING).limit(1)
    for snap in query.stream():
        source_listing_id = str((snap.to_dict() or {}).get("source_listing_id") or "")
        if source_listing_id.startswith("EODHD:") and "." in source_listing_id:
            return source_listing_id.split(":", 1)[1]
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--approval")
    args = parser.parse_args()
    if args.write and args.approval != APPROVAL:
        raise SystemExit("Aprobacion de escritura ausente.")
    if args.write:
        require_master_writes_enabled("migrate_provisional_roots")  # hallazgo 31: el cerrojo general, antes de abrir el cliente

    db = gcf.Client(project=master_project_id())
    summary = {
        "mode": "WRITE" if args.write else "DRY_RUN",
        "active_roots": 0,
        "valid": 0,
        "invalid": 0,
        "eligible": 0,
        "written": 0,
        "candidate_ids": [],
        "blocked": [],
    }
    for snap in db.collection("assets").stream():
        root = snap.to_dict() or {}
        quality = root.get("quality") if isinstance(root.get("quality"), dict) else {}
        if not ISIN_RE.fullmatch(snap.id) or quality.get("status") == "ARCHIVED_LEGACY":
            continue
        summary["active_roots"] += 1
        if _root_is_valid(root):
            summary["valid"] += 1
            continue
        summary["invalid"] += 1
        asset_type = str(root.get("asset_type") or "").upper()
        symbol = _symbol(snap.reference, root)
        if asset_type not in {"STOCK", "ETF", "INDEX"} or not symbol:
            summary["blocked"].append({"asset_id": snap.id, "reason": "UNSUPPORTED_OR_NO_SYMBOL"})
            continue
        ticker, exchange = symbol.rsplit(".", 1)
        identity = root.get("identity") if isinstance(root.get("identity"), dict) else {}
        match = {
            "ticker": ticker,
            "exchange": exchange,
            "currency": identity.get("currency") or root.get("currency"),
            "name": identity.get("name") or snap.id,
            "type": asset_type,
            "type_class": asset_type,
        }
        candidate = build_stock_root(snap.id, match, {}) if asset_type == "STOCK" else build_market_root(snap.id, match)
        if isinstance(root.get("classification"), dict):
            candidate["classification"].update(root["classification"])
        if root.get("risk") is not None:
            candidate["risk"] = root["risk"]
        schema = "asset-stock.v1.1.schema.json" if asset_type == "STOCK" else "asset-market.v1.schema.json"
        validate_contract(candidate, schema)
        summary["eligible"] += 1
        summary["candidate_ids"].append(snap.id)
        if args.write:
            snap.reference.set(candidate)
            summary["written"] += 1

    print(json.dumps(summary, ensure_ascii=True))
    return 0 if not summary["blocked"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
