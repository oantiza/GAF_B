"""Maintain one adjusted-price basis across every EODHD document of an asset.

Planning is read-only. An update is atomic per asset (prices, metrics and cached
drawdown state), with optimistic preconditions. Missing history is never deleted
or silently replaced by a partial response from a provider.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date

SYNC_VERSION = 1
MAX_ATOMIC_DOCUMENTS = 440
MAX_ATOMIC_BYTES = 8_000_000
ADJUSTMENT_QUARANTINE_ASSETS = frozenset({
    "US0320951017",  # APH: split on 2026-09-03, old prices remain on the old scale.
    "ES0116870314",  # Naturgy: confirmed inconsistent dividend-adjustment versions.
})


class HistoryRepairRequired(RuntimeError):
    pass


def positive(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _day(value):
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (TypeError, ValueError):
        raise HistoryRepairRequired("INVALID_PRICE_DATE") from None


def adjustment_problem(asset_id, docs=()):
    from price_repair_release import repair_released
    if asset_id in ADJUSTMENT_QUARANTINE_ASSETS and not repair_released(asset_id):
        return "PRICE_ADJUSTMENT_QUARANTINE"
    if any((doc.get("metadata") or {}).get("price_history_sync", {}).get("status") == "REPAIR_REQUIRED"
           for doc in docs or ()):
        return "PRICE_ADJUSTMENT_QUARANTINE"
    return None


def revision_detected(previous, rows, currency):
    """Compare native values, so revised FX rates do not masquerade as a split.

    Check all matching observations in the overlap, including when there are no
    new dates. Allow only provider/serialization rounding, not a 2% price error.
    """
    old_currency = str(previous.get("source_currency") or previous.get("currency") or "").upper()
    if old_currency != currency.upper():
        return True
    current = {str(row.get("date")): positive(row.get("adjusted_close", row.get("close"))) for row in rows}
    compared = 0
    for point in previous.get("points") or []:
        new = current.get(str(point.get("date")))
        if new is None:
            continue
        old = positive(point.get("source_value", point.get("value") if currency == "EUR" else None))
        if old is None:
            return True  # No trustworthy native anchor: rebuild, never append blindly.
        compared += 1
        if abs(old - new) > max(0.00011, abs(new) * 0.00001):
            return True
    return compared == 0


def _belongs(doc_id, doc, symbol):
    declared = doc.get("source_listing_id") or doc.get("source_price_id")
    if declared:
        return str(declared).upper() == ("EODHD:" + symbol).upper()
    prefixes = ("EODHD_" + symbol + "_", "EODHD_" + symbol.replace(".", "_") + "_")
    return str(doc.get("source") or "").upper() == "EODHD" and doc_id.startswith(prefixes)


def _signature(doc):
    data = dict(doc)
    data.pop("updated_at", None)
    metadata = dict(data.get("metadata") or {})
    sync = dict(metadata.get("price_history_sync") or {})
    sync.pop("verified_at", None)
    if sync:
        metadata["price_history_sync"] = sync
    if metadata:
        data["metadata"] = metadata
    return json.dumps(data, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def build_repair_plan(asset_id, asset_type, symbol, currency, documents, rows, converted, fx_meta, now):
    from contract_validation import validate_contract
    from price_refresh import _refresh_doc_id, _series_type, PRICE_SERIES_SCHEMA

    if not documents:
        raise HistoryRepairRequired("NO_EXISTING_HISTORY")
    if not currency:
        raise HistoryRepairRequired("UNRESOLVED_LISTING_CURRENCY")
    expected_dates = set()
    for doc_id, doc in documents.items():
        if not _belongs(doc_id, doc, symbol):
            raise HistoryRepairRequired("AMBIGUOUS_PRICE_LISTINGS: " + doc_id)
        if doc.get("history_quality_status") == "BLOCKED" and not adjustment_problem("", [doc]):
            raise HistoryRepairRequired("UNRELATED_QUALITY_BLOCK: " + doc_id)
        expected_dates.update(_day(p.get("date")) for p in doc.get("points") or [])
    if not expected_dates:
        raise HistoryRepairRequired("EMPTY_EXISTING_HISTORY")
    native = {}
    for row in rows:
        day = _day(row.get("date"))
        value = positive(row.get("adjusted_close", row.get("close")))
        if value is None:
            raise HistoryRepairRequired("INVALID_PROVIDER_VALUE: " + day)
        if day in native and native[day] != row:
            raise HistoryRepairRequired("CONFLICTING_PROVIDER_DATES: " + day)
        native[day] = row
    canonical = {}
    for point in converted:
        day = _day(point.get("date"))
        if positive(point.get("value")) is None or day not in native:
            raise HistoryRepairRequired("INVALID_CONVERTED_POINT: " + day)
        value = dict(point)
        # El valor de origen viaja con un solo nombre. source_currency es constante de
        # la serie y vive en el documento.
        value["source_value"] = float(native[day].get("adjusted_close", native[day].get("close")))
        canonical[day] = value
    missing = sorted((expected_dates | set(native)) - set(canonical))
    if missing:
        raise HistoryRepairRequired("INCOMPLETE_PROVIDER_OR_FX_HISTORY: " + ",".join(missing[:6]))
    missing = sorted(expected_dates - set(native))
    if missing:
        raise HistoryRepairRequired("MISSING_OLD_PRICE_DATES: " + ",".join(missing[:6]))
    canonical = {d: canonical[d] for d in sorted(canonical) if d >= min(expected_dates)}
    if not canonical or max(canonical) < max(expected_dates):
        raise HistoryRepairRequired("PROVIDER_HISTORY_TRUNCATED")
    revision = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assignments = {doc_id: {_day(p["date"]) for p in doc.get("points") or []}
                   for doc_id, doc in documents.items()}
    for day in set(canonical) - expected_dates:
        assignments.setdefault(_refresh_doc_id(symbol, int(day[:4])), set()).add(day)
    desired = {}
    differences = []
    for doc_id, dates in assignments.items():
        if not dates:
            raise HistoryRepairRequired("EMPTY_DOCUMENT: " + doc_id)
        old = documents.get(doc_id) or {}
        points = [canonical[d] for d in sorted(dates)]
        metadata = dict(old.get("metadata") or {})
        metadata["price_history_sync"] = {
            "version": SYNC_VERSION, "status": "VERIFIED", "basis": "EODHD_ADJUSTED_CLOSE",
            "revision": revision, "verified_at": now,
        }
        doc = {
            "schema_version": PRICE_SERIES_SCHEMA, "asset_id": asset_id,
            "asset_type": asset_type, "series_type": _series_type(asset_type), "source": "EODHD",
            "source_listing_id": "EODHD:" + symbol, "source_price_id": "EODHD:" + symbol,
            "document_id": doc_id, "currency": "EUR", "source_currency": currency,
            "interval": old.get("interval", "1d"), "year": int(points[0]["date"][:4]),
            "points": points, "first_date": points[0]["date"], "last_date": points[-1]["date"],
            "observations_count": len(points), "history_quality_status": "COMPLETE", "updated_at": now,
            "metadata": metadata,
        }
        if "_REFRESH_" in doc_id or old.get("refresh"):
            doc["refresh"] = True
        doc.update(fx_meta)
        validate_contract(doc, "price-series.v1.2.schema.json")
        if _signature(doc) != _signature(old):
            desired[doc_id] = doc
        old_points = {p["date"]: p for p in old.get("points") or []}
        changed = sum(1 for p in points if p["date"] in old_points
                      and abs(p["value"] - float(old_points[p["date"]]["value"])) > 0.000001)
        differences.append({"document_id": doc_id, "old_points": len(old_points), "new_points": len(points),
                            "changed_values": changed, "added_dates": len(dates - set(old_points))})
    if len(desired) + 4 > MAX_ATOMIC_DOCUMENTS:
        raise HistoryRepairRequired("ATOMIC_DOCUMENT_LIMIT")
    if len(json.dumps(desired, ensure_ascii=True).encode()) > MAX_ATOMIC_BYTES:
        raise HistoryRepairRequired("ATOMIC_BYTE_LIMIT")
    return {"asset_id": asset_id, "symbol": symbol, "currency": currency, "revision": revision,
            "documents": desired, "points": list(canonical.values()), "differences": differences,
            "old_unique_points": len(expected_dates), "new_unique_points": len(canonical),
            "first_date": min(canonical), "last_date": max(canonical), "verified_at": now}


def prepare_repair(db, ref, asset_id, asset_type, symbol, currency, today, fx_cache, budget=None):
    from price_refresh import fetch_eod, _convert_eur, _now_iso
    snapshots = {}
    for snap in ref.collection("price_series").stream():
        if budget:
            budget.add(1, "history_revision/document")
        snapshots[snap.id] = snap
    documents = {key: snap.to_dict() or {} for key, snap in snapshots.items()}
    dates = [_day(p.get("date")) for doc in documents.values() for p in doc.get("points") or []]
    if not dates:
        raise HistoryRepairRequired("EMPTY_EXISTING_HISTORY")
    start = min(dates)
    rows = fetch_eod(symbol, start, today)
    converted, meta = _convert_eur(rows, currency, fx_cache, start, today)
    return build_repair_plan(asset_id, asset_type, symbol, currency, documents, rows, converted, meta, _now_iso()), snapshots


def apply_repair(db, ref, plan, snapshots, root_data, root_update_time, budget=None):
    from google.cloud import firestore as gcf
    from contract_validation import validate_contract
    from ingest_asset import build_metrics_latest, _estr_window_resolver
    from price_refresh import _fund_nav_update, require_master_writes_enabled
    from price_series_cache import invalidate_price_series_cache
    if not plan["documents"]:
        return {"write_count": 0, "series_writes": 0, "root_nav_writes": 0}
    require_master_writes_enabled("repair_price_history")
    atype = next(iter(plan["documents"].values()))["asset_type"]
    latest_ref = ref.collection("metrics").document("latest")
    state_ref = ref.collection("metrics").document("drawdown_state")
    if budget:
        budget.add(2, "history_revision/metrics")
    latest = latest_ref.get()
    state = state_ref.get()
    # A1 (auditoria 29-09): el SRRI del KID solo lo publica el proveedor;
    # recalcular sin pasarlo lo borraba (ver build_metrics_latest).
    previo = latest.to_dict() if latest.exists else {}
    srri = previo.get("srri") if previo.get("risk_score_source") == "SRRI" else None
    metrics = build_metrics_latest(plan["asset_id"], atype, plan["points"], plan["verified_at"],
                                   risk_free_resolver=_estr_window_resolver,
                                   srri=srri if isinstance(srri, int) and not isinstance(srri, bool) else None)
    validate_contract(metrics, "metrics.v1.3.schema.json")
    batch = db.batch()
    for doc_id, payload in plan["documents"].items():
        doc_ref = ref.collection("price_series").document(doc_id)
        old = snapshots.get(doc_id)
        if old is not None:
            deleted = {key: gcf.DELETE_FIELD for key in (old.to_dict() or {}) if key not in payload}
            batch.update(doc_ref, {**deleted, **payload}, option=gcf.LastUpdateOption(old.update_time))
        else:
            batch.create(doc_ref, payload)
    if latest.exists:
        removed = {key: gcf.DELETE_FIELD for key in (latest.to_dict() or {}) if key not in metrics}
        batch.update(latest_ref, {**removed, **metrics}, option=gcf.LastUpdateOption(latest.update_time))
    else:
        batch.create(latest_ref, metrics)
    if state.exists:
        batch.delete(state_ref, option=gcf.LastUpdateOption(state.update_time))
    nav = _fund_nav_update(atype, plan["points"][-1], plan["currency"], plan["symbol"], plan["verified_at"],
                           (root_data.get("performance") or {}).get("valuation"))
    if nav is not None:
        if root_update_time is None:
            raise HistoryRepairRequired("ROOT_NAV_PRECONDITION_MISSING")
        batch.update(ref, {"performance.valuation": nav}, option=gcf.LastUpdateOption(root_update_time))
    batch.commit()
    invalidate_price_series_cache(plan["asset_id"])
    return {"write_count": len(plan["documents"]) + 1 + int(state.exists) + int(nav is not None),
            "series_writes": len(plan["documents"]), "root_nav_writes": int(nav is not None)}


def mark_repair_required(latest, reason):
    from google.cloud import firestore as gcf
    from price_refresh import _now_iso
    from price_series_cache import invalidate_price_series_cache
    doc = latest.to_dict() or {}
    # Preserve unrelated quality holds; relabeling one as our own repair flag
    # would allow a later retry to clear a block imposed for another reason.
    if doc.get("history_quality_status") == "BLOCKED" and not adjustment_problem("", [doc]):
        return
    metadata = dict(doc.get("metadata") or {})
    metadata["price_history_sync"] = {"version": SYNC_VERSION, "status": "REPAIR_REQUIRED",
                                      "reason": str(reason)[:250], "detected_at": _now_iso()}
    latest.reference.update({"history_quality_status": "BLOCKED", "metadata": metadata},
                            option=gcf.LastUpdateOption(latest.update_time))
    invalidate_price_series_cache(doc.get("asset_id"))


def mark_repair_deferred(latest, reason):
    """B-05: the provider failed (network, quota, 5xx), nothing was verified.

    Leaves `history_quality_status` untouched so frontier, backtest and metrics
    keep serving the previous history; only records a REPAIR_DEFERRED notice.
    `adjustment_problem` ignores this status, and the next cycle detects the
    revision again and retries. A BLOCKED document is never relabeled here.
    """
    from google.cloud import firestore as gcf
    from price_refresh import _now_iso
    doc = latest.to_dict() or {}
    if doc.get("history_quality_status") == "BLOCKED":
        return
    metadata = dict(doc.get("metadata") or {})
    previous = dict(metadata.get("price_history_sync") or {})
    metadata["price_history_sync"] = {"version": SYNC_VERSION, "status": "REPAIR_DEFERRED",
                                      "reason": str(reason)[:250], "deferred_at": _now_iso(),
                                      "previous_status": previous.get("status")}
    latest.reference.update({"metadata": metadata}, option=gcf.LastUpdateOption(latest.update_time))
