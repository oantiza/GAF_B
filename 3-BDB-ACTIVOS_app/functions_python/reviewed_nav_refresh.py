"""Append-only refresh for explicitly reviewed NAV sources.

An atomic audit record keeps the previous series and valuation. Every mutation
uses update-time preconditions; failures leave the complete asset unchanged.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

from google.cloud import firestore

from capitalgroup_nav import ASSETS, BASE_URL, fetch, official_quote, parse_navs, prepare_plan
from reviewed_nav_sources import REGISTRY, fetch_reviewed_source
from contract_validation import validate_contract
from master_write_client import get_master_write_db
from write_governance import require_master_writes_enabled


def fetch_capitalgroup(asset_id, series, as_of):
    url = f"{BASE_URL}/fundcentre/history/{asset_id}/LU/en/"
    page = fetch(url)
    quote = official_quote(page.decode("utf-8", errors="replace"), asset_id, "EUR")
    params = dict(action="showHistory", tab="history", countryCode="LU", languageCode="en",
                  isin=asset_id, historyType="price", frequency="Daily",
                  fromDate=(date.fromisoformat(series["last_date"]) - timedelta(days=45)).strftime("%d/%m/%Y"),
                  toDate=date.fromisoformat(quote["date"]).strftime("%d/%m/%Y"))
    raw = fetch(BASE_URL + "/ajax/fundcenter", params)
    plan = prepare_plan(asset_id, series, parse_navs(raw.decode("utf-8", errors="replace")), quote, as_of)
    return {**plan, "source_url": url, "provider_sha256": hashlib.sha256(raw).hexdigest(),
            "provider": "capitalgroup", "source_listing_id": "CAPITALGROUP:" + asset_id}


def prepare_documents(series, plan, now):
    """Preserve existing observations and provenance; split new years explicitly."""
    updates = {}
    transition = series["source_listing_id"] != plan["source_listing_id"]
    for point in plan["append_only_points"]:
        year = int(point["date"][:4])
        if point["date"] <= series["last_date"]:
            raise ValueError("Only strictly newer observations may be appended")
        if year not in updates:
            doc = deepcopy(series)
            if year != series["year"] or transition:
                doc.update(year=year, points=[], document_id=f"{plan['source_listing_id'].replace(':', '_')}_{year}_refresh")
            if transition:
                doc.update(source="MORNINGSTAR", source_listing_id=plan["source_listing_id"],
                           source_price_id=plan["source_listing_id"],
                           metadata={"source_transition": {"previous_source_listing_id":series["source_listing_id"],
                                      "previous_last_date":series["last_date"],"verified_at":now}})
            updates[year] = doc
        updates[year]["points"].append(dict(point))
    for doc in updates.values():
        doc.update(first_date=doc["points"][0]["date"], last_date=doc["points"][-1]["date"],
                   observations_count=len(doc["points"]), updated_at=now)
        doc.setdefault("metadata", {})["last_incremental_refresh"] = {
            "source_url": plan["source_url"], "provider_sha256": plan["provider_sha256"],
            "overlap_checks": plan["overlap_checks"], "max_overlap_error_pct": plan["max_overlap_error_pct"],
            "verified_at": now, "previous_last_date": series["last_date"], "append_only": True}
        if plan.get("fx_source"):
            doc["metadata"]["last_incremental_refresh"].update(
                fx_source=plan["fx_source"], fx_sha256=plan["fx_sha256"])
        validate_contract(doc, "price-series.v1.2.schema.json")
    return list(updates.values())


def refresh_reviewed_one(asset_id, *, write=False, db=None, as_of=None):
    if asset_id not in ASSETS and asset_id not in REGISTRY:
        raise ValueError("NAV source has not been admitted for this share class")
    if write:
        require_master_writes_enabled("refresh_reviewed_nav")
    db = db or get_master_write_db()
    as_of = as_of or datetime.now(ZoneInfo("Europe/Madrid")).date()
    ref = db.collection("assets").document(asset_id)
    root = ref.get()
    from price_refresh import _is_active_canonical_asset
    if not root.exists or not _is_active_canonical_asset(asset_id, root.to_dict()):
        raise ValueError("Asset is not active and canonical")
    snapshots = list(ref.collection("price_series").order_by(
        "last_date", direction=firestore.Query.DESCENDING).limit(1).stream())
    if not snapshots:
        raise ValueError("No reviewed price series")
    snapshot = snapshots[0]
    series = snapshot.to_dict()
    admission = series
    if len(series.get("points", [])) < 5:
        # Immediately after a year rollover the latest bucket has only one NAV.
        # Prior reviewed buckets supply overlap, but are not rewritten.
        context = list(ref.collection("price_series").order_by(
            "last_date", direction=firestore.Query.DESCENDING).limit(3).stream())
        admission = overlap_context(series, [s.to_dict() for s in context],
                                    REGISTRY.get(asset_id, {}).get("accepted_previous_listing"))
    plan = (fetch_capitalgroup if asset_id in ASSETS else fetch_reviewed_source)(asset_id, admission, as_of)
    result = {k: v for k, v in plan.items() if k != "append_only_points"}
    result.update(new_points=len(plan["append_only_points"]), applied=False)
    if not write or not plan["append_only_points"]:
        return result
    now = datetime.now(timezone.utc).isoformat()
    documents = prepare_documents(series, plan, now)
    # Read every target before preparing the batch; never replace an existing
    # future-year bucket after a concurrent writer has created it.
    targets = [(ref.collection("price_series").document(doc["document_id"]), doc) for doc in documents]
    for target, _ in targets:
        if target.path != snapshot.reference.path and target.get().exists:
            raise ValueError("A target year bucket already exists; review required")
    valuation = (root.to_dict().get("performance") or {}).get("valuation") or {}
    quote = plan["quote"]
    audit_id = hashlib.sha256(f"{snapshot.reference.path}|{snapshot.update_time}|{plan['provider_sha256']}".encode()).hexdigest()
    batch = db.batch()
    batch.create(db.collection("_nav_refresh_audit").document(audit_id), {
        "asset_id": asset_id, "created_at": now, "source_url": plan["source_url"],
        "provider_sha256": plan["provider_sha256"], "previous_series": series,
        "previous_series_path": snapshot.reference.path,
        "previous_series_update_time": snapshot.update_time,
        "previous_valuation": valuation, "previous_root_update_time": root.update_time,
        "new_points": plan["append_only_points"], "written_paths": [t.path for t, _ in targets]})
    for target, doc in targets:
        if target.path == snapshot.reference.path:
            batch.update(target, doc, option=firestore.LastUpdateOption(snapshot.update_time))
        else:
            batch.create(target, doc)
    nav_patch = {}
    if str(valuation.get("vl_fecha") or "") <= quote["date"]:
        nav_patch = {"performance.valuation." + key: value for key, value in {
            "vl": quote["value"], "vl_fecha": quote["date"], "vl_divisa": plan.get("source_currency", "EUR"),
            "vl_fuente": plan["provider"], "vl_source_listing_id": plan["source_listing_id"],
            "vl_fetched_at": now}.items()}
    # Also guards active status when the root quote is already newer.
    batch.update(ref, nav_patch or {"asset_id": asset_id},
                 option=firestore.LastUpdateOption(root.update_time))
    batch.commit()
    return {**result, "applied": True, "audit_id": audit_id, "read_only": False}


def overlap_context(latest, documents, accepted_previous_listing=None):
    points = {}
    for doc in documents:
        if any(doc.get(key) != latest.get(key) for key in ("asset_id", "currency", "source_currency", "series_type")):
            continue
        if doc.get("source_listing_id") not in (latest["source_listing_id"], accepted_previous_listing):
            continue
        for point in doc.get("points", []):
            day = point["date"]
            if day in points and points[day] != point:
                raise ValueError("Conflicting observations in reviewed source buckets")
            if day <= latest["last_date"]:
                points[day] = point
    return {**latest, "points": [points[day] for day in sorted(points)]}


def refresh_reviewed_navs(*, write=False):
    if write:
        from price_refresh import require_price_scheduler_writes_enabled
        require_master_writes_enabled("refresh_reviewed_navs")
        require_price_scheduler_writes_enabled("refresh_reviewed_navs")
    def refresh(asset_id):
        try:
            return refresh_reviewed_one(asset_id, write=write)
        except Exception as exc:
            # Provider exceptions can contain credential-bearing request URLs.
            return {"asset_id": asset_id, "status": "REVIEW_REQUIRED", "error_type": type(exc).__name__,
                    "error": str(exc)[:300] if isinstance(exc, ValueError) else "Provider request or atomic write failed"}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(refresh, (*ASSETS, *REGISTRY)))
    summary = {"results": results, "errors": sum(row["status"] == "REVIEW_REQUIRED" for row in results),
               "updated": sum(bool(row.get("applied")) for row in results)}
    if write:
        get_master_write_db().collection("meta").document("reviewed_nav_refresh").set({
            "last_run":datetime.now(timezone.utc).isoformat(), **summary})
    return summary
