"""Bounded, read-only repair plan. Writes local evidence, never Firestore.

Example: python scripts/plan_price_history_repair.py --assets ISIN,ISIN --out tmp/repair-review
All price documents and all dates are checked. Includes a before-image and the
proposed replacement, hashes and metrics for review before an authorized repair.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions_python"))
from google.cloud import firestore
import price_refresh
from price_history_sync import prepare_repair
from ingest_asset import build_metrics_latest, _estr_window_resolver
from master_project import master_project_id


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def plan_asset(db, aid, today, fx_cache):
    ref = db.collection("assets").document(aid)
    root = ref.get()
    if not root.exists:
        raise ValueError("ASSET_NOT_FOUND")
    latest = list(ref.collection("price_series").order_by(
        "last_date", direction=firestore.Query.DESCENDING).limit(1).stream())
    if not latest:
        raise ValueError("NO_PRICE_HISTORY")
    data = root.to_dict() or {}
    source = latest[0].to_dict() or {}
    symbol, currency = price_refresh._symbol_and_currency(source, data, resolve=True)
    if not symbol or not currency:
        raise ValueError("UNRESOLVED_LISTING")
    plan, snapshots = prepare_repair(db, ref, aid, data.get("asset_type") or source["asset_type"],
                                     symbol, currency, today, fx_cache)
    metrics = ref.collection("metrics").document("latest").get()
    state = ref.collection("metrics").document("drawdown_state").get()
    before = {"root": data, "root_update_time": str(root.update_time),
              "documents": {key: snap.to_dict() for key, snap in snapshots.items()},
              "update_times": {key: str(snap.update_time) for key, snap in snapshots.items()},
              "metrics": metrics.to_dict(), "metrics_update_time": str(metrics.update_time),
              "drawdown_state": state.to_dict(), "drawdown_update_time": str(state.update_time)}
    after_metrics = build_metrics_latest(aid, data.get("asset_type") or source["asset_type"],
                                        plan["points"], plan["verified_at"],
                                        risk_free_resolver=_estr_window_resolver)
    # Independent acceptance checks on every date of every replacement document.
    expected = {p["date"]: p["value"] for p in plan["points"]}
    for doc_id, old in before["documents"].items():
        new = plan["documents"].get(doc_id, old)
        new_points = {p["date"]: p["value"] for p in new["points"]}
        assert {p["date"] for p in old["points"]} <= set(new_points)
        assert all(abs(v - expected[d]) <= 0.000001 for d, v in new_points.items())
    return {"before": before, "before_sha256": digest(before), "plan": plan,
            "after_metrics": after_metrics, "after_sha256": digest({"plan": plan, "metrics": after_metrics})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", required=True, help="explicit comma-separated ISINs (max 50)")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    ids = list(dict.fromkeys(s.strip().upper() for s in args.assets.split(",") if s.strip()))
    if not ids or len(ids) > 50 or any(not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", aid) for aid in ids):
        parser.error("Provide 1 to 50 explicit ISINs")
    if args.out.exists():
        parser.error("Output already exists; use a new path to preserve earlier evidence")
    args.out.mkdir(parents=True)
    db = firestore.Client(project=master_project_id())
    results, fx_cache = [], {}
    for aid in ids:
        try:
            evidence = plan_asset(db, aid, date.today().isoformat(), fx_cache)
            target = args.out / (aid + ".json")
            target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
            plan = evidence["plan"]
            row = {"asset_id": aid, "status": "PREPARED", "symbol": plan["symbol"],
                   "documents_to_rewrite": len(plan["documents"]),
                   "values_changed": sum(d["changed_values"] for d in plan["differences"]),
                   "dates_before": plan["old_unique_points"], "dates_after": plan["new_unique_points"],
                   "before_sha256": evidence["before_sha256"], "after_sha256": evidence["after_sha256"],
                   "max_drawdown_before": (evidence["before"]["metrics"] or {}).get("max_drawdown_hist"),
                   "max_drawdown_after": evidence["after_metrics"].get("max_drawdown_hist")}
        except Exception as error:
            # Never echo HTTP credentials or token-bearing exception URLs.
            row = {"asset_id": aid, "status": "BLOCKED", "error_type": type(error).__name__,
                   "reason": str(error)[:300] if type(error).__name__ in
                   {"HistoryRepairRequired", "ValueError", "AssertionError"} else "External read failed"}
        results.append(row)
        print(json.dumps(row, ensure_ascii=True), flush=True)
        (args.out / "summary.json").write_text(json.dumps({"read_only": True, "master_writes": 0,
            "assets": results}, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
