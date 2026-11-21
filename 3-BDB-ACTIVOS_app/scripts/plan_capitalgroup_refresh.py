"""Prepare a read-only NAV refresh plan for four reviewed Capital Group classes.

No Firestore write operations are implemented. Preserve existing points, verify
the official share class/currency and overlap, then export only new dates.
"""
import argparse
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions_python"))
from capitalgroup_nav import ASSETS, BASE_URL, fetch, official_quote, parse_navs, prepare_plan, point_map, tables
from master_project import master_project_id

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    from google.cloud import firestore
    db = firestore.Client(project=master_project_id())
    plans = []
    for asset_id in ASSETS:
        try:
            ref = db.collection("assets").document(asset_id)
            snapshots = list(ref.collection("price_series").order_by(
                "last_date", direction=firestore.Query.DESCENDING).limit(1).stream(timeout=30))
            if not snapshots:
                raise ValueError("No existing price series")
            snap = snapshots[0]
            series = snap.to_dict()
            source_url = f"{BASE_URL}/fundcentre/history/{asset_id}/LU/en/"
            page = fetch(source_url)
            quote = official_quote(page.decode("utf-8", errors="replace"), asset_id, "EUR")
            start = date.fromisoformat(series["last_date"]) - timedelta(days=45)
            params = dict(action="showHistory", tab="history", countryCode="LU", languageCode="en",
                          isin=asset_id, historyType="price", fromDate=start.strftime("%d/%m/%Y"),
                          toDate=date.fromisoformat(quote["date"]).strftime("%d/%m/%Y"), frequency="Daily")
            raw = fetch(BASE_URL + "/ajax/fundcenter", params)
            (args.output / f"{asset_id}-page.html").write_bytes(page)
            (args.output / f"{asset_id}-nav.html").write_bytes(raw)
            (args.output / f"{asset_id}-before.json").write_text(
                json.dumps(series, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
            plan = prepare_plan(asset_id, series, parse_navs(raw.decode("utf-8", errors="replace")), quote, args.as_of)
            plan.update(series_path=snap.reference.path, expected_update_time=str(snap.update_time),
                        source_url=source_url, request=params, provider_sha256=hashlib.sha256(raw).hexdigest())
        except Exception as exc:
            plan = {"asset_id": asset_id, "status": "REVIEW_REQUIRED", "error": str(exc), "read_only": True}
        plans.append(plan)
        print(json.dumps({key: value for key, value in plan.items() if key not in ("append_only_points", "request")}, ensure_ascii=True))
    output = {"checked_at": datetime.now(timezone.utc).isoformat(), "as_of": str(args.as_of),
              "read_only": True, "plans": plans,
              "publication_requirements": ["Re-read with the recorded update-time precondition",
                                           "Preserve all existing observations and other series",
                                           "Recalculate metrics after a separately reviewed write"]}
    (args.output / "plan.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    return int(any(plan["status"] == "REVIEW_REQUIRED" for plan in plans))


if __name__ == "__main__":
    raise SystemExit(main())
