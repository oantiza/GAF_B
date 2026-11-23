"""Bounded report publication with a durable lease and create-only output."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from google.api_core.exceptions import AlreadyExists, FailedPrecondition
from google.cloud.firestore import LastUpdateOption

MAX_ATTEMPTS = 3
LEASE_SECONDS = 600  # longer than the 540-second publisher invocation
PUBLICATION_CHECK_TIME = (8, 10)  # Madrid; primary jobs and recovery have had time to run.


def expected_report_date(report_type, now):
    """Latest publication slot due, including weekends and Monday's grace period."""
    if report_type not in ("DAILY_REPORT", "WEEKLY_REPORT"):
        raise ValueError("Unsupported report type")
    local = now.astimezone(ZoneInfo("Europe/Madrid"))
    day = local.date()
    if report_type == "WEEKLY_REPORT":
        day -= timedelta(days=day.weekday())
        if local.weekday() == 0 and (local.hour, local.minute) < PUBLICATION_CHECK_TIME:
            day -= timedelta(days=7)
    else:
        if (local.hour, local.minute) < PUBLICATION_CHECK_TIME:
            day -= timedelta(days=1)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
    return day


def _replaced_summary(report_id, data):
    """Lo justo para saber qué informe se sustituyó: su fecha real y con qué se generó."""
    data = data or {}
    generation = data.get("generation") or {}
    return {"report_id": report_id, "date": data.get("date"),
            "research_model": generation.get("research_model"),
            "report_model": generation.get("report_model")}


def _mark_failed(lease, owned, exc):
    try:
        lease.update({"status": "FAILED", "failed_at": datetime.now(timezone.utc),
                      "error_type": type(exc).__name__}, option=LastUpdateOption(owned.update_time))
    except FailedPrecondition:
        pass  # A newer owner has already taken over; never alter its lease.


def publish(report_type, *, db, generate, validate, prefix, collection, api_key=None, now=None,
            force=False, forced_by=None):
    """Publica una vez por tipo y día.

    `force` (solo administradores, desde `admin_publish_report`) permite un intento más con los
    intentos agotados, y regenera y sustituye el informe del día si ya existe. Nunca fuerza contra
    otra publicación con el cerrojo vivo: dos generaciones a la vez no pueden darse. Cada forzado
    queda en `force_history` del cerrojo, con el hash del uid, la hora y el informe sustituido.
    Sin `force`, el comportamiento es el de siempre.
    """
    force = force is True
    if force and not forced_by:
        raise ValueError("Forzar una publicación exige identificar a quien la fuerza.")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    day = now.astimezone(ZoneInfo("Europe/Madrid")).date().isoformat()
    report_id = f"{prefix}-{day}"
    ref = db.collection(collection).document(report_id)
    existing = ref.get()
    replaced = None
    if existing.exists:
        if not force:
            # An invalid existing report must not be silently replaced either.
            validate(existing.to_dict(), expected_type=report_type, require_sources=True)
            return {"status": "ALREADY_PUBLISHED", "report_id": report_id, "type": report_type}
        replaced = _replaced_summary(report_id, existing.to_dict())
    lease = db.collection("_report_publication").document(report_id)
    token = uuid4().hex
    wall_now = datetime.now(timezone.utc)
    state = {"status": "RUNNING", "token": token, "attempts": 1,
             "started_at": wall_now, "lease_until": wall_now + timedelta(seconds=LEASE_SECONDS),
             "report_id": report_id, "type": report_type}
    force_entry = None
    if force:
        force_entry = {"by_uid_hash": forced_by, "at": wall_now, "replaced": replaced}
        state["force_history"] = [force_entry]
    try:
        lease.create(state)
    except AlreadyExists:
        snap = lease.get()
        previous = snap.to_dict() or {}
        if previous.get("status") == "RUNNING" and previous.get("lease_until", wall_now) > wall_now:
            return {"status": "IN_PROGRESS", "report_id": report_id, "type": report_type}
        if previous.get("attempts", 0) >= MAX_ATTEMPTS and not force:
            return {"status": "ATTEMPTS_EXHAUSTED", "report_id": report_id, "type": report_type}
        state["attempts"] = previous.get("attempts", 0) + 1
        if force:
            state["force_history"] = list(previous.get("force_history") or []) + [force_entry]
        try:
            lease.update(state, option=LastUpdateOption(snap.update_time))
        except FailedPrecondition:
            return {"status": "IN_PROGRESS", "report_id": report_id, "type": report_type}
    owned = lease.get()
    if (owned.to_dict() or {}).get("token") != token:
        return {"status": "IN_PROGRESS", "report_id": report_id, "type": report_type}
    try:
        report = validate(generate(report_type, api_key=api_key, now=now),
                          expected_type=report_type, require_sources=True)
        # Madrid determines the publication slot, while date retains its real UTC timestamp.
        report["id"] = report_id
        batch = db.batch()
        if force:
            # Forced: the lease we own guarantees no concurrent writer, so it replaces whatever is there now. Using
            # `create` here failed with AlreadyExists when the report had appeared after the first read (the ~90 s of
            # generation are a long window) and marked the lease FAILED for a report that was already published.
            if replaced is None:
                late = ref.get()
                if late.exists:
                    replaced = _replaced_summary(report_id, late.to_dict())
            batch.set(ref, report)
        else:
            batch.create(ref, report)
        batch.update(lease, {"status": "PUBLISHED", "completed_at": datetime.now(timezone.utc)},
                     option=LastUpdateOption(owned.update_time))
        batch.commit()
    except AlreadyExists:
        # Not forced, and the report was published between our first read and the commit: nothing is lost, and the
        # lease must not say FAILED. If what is there does not validate, it is a real failure and goes the usual way.
        published = ref.get()
        try:
            validate(published.to_dict(), expected_type=report_type, require_sources=True)
        except Exception as exc:
            _mark_failed(lease, owned, exc)
            raise
        try:
            lease.update({"status": "PUBLISHED", "completed_at": datetime.now(timezone.utc),
                          "note": "published_by_another_writer"}, option=LastUpdateOption(owned.update_time))
        except FailedPrecondition:
            pass  # A newer owner has already taken over; never alter its lease.
        return {"status": "ALREADY_PUBLISHED", "report_id": report_id, "type": report_type}
    except Exception as exc:
        _mark_failed(lease, owned, exc)
        raise
    generation = report.get("generation") or {}
    result = {"status": "PUBLISHED", "report_id": report_id, "type": report_type,
              "date": report["date"], "source_count": len(report.get("sources") or []),
              "research_model": generation.get("research_model"), "report_model": generation.get("report_model")}
    if force:
        result["forced"] = True
        result["replaced"] = replaced
    return result


def recover_due_reports(*, db, publish_report, now=None):
    """Two scheduler visits after primary jobs; attempts persist across invocations."""
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Europe/Madrid"))
    if local.weekday() >= 5:
        return []
    types = ["DAILY_REPORT"] + (["WEEKLY_REPORT"] if local.weekday() == 0 else [])
    results = []
    for report_type in types:
        try:
            result = publish_report(report_type, db=db, now=local)
        except Exception as exc:
            result = {"type": report_type, "status": "FAILED", "error_type": type(exc).__name__}
        results.append(result)
        missing = result["status"] not in ("PUBLISHED", "ALREADY_PUBLISHED")
        db.collection("meta").document("report_status_" + report_type.lower()).set({
            "checked_at": datetime.now(timezone.utc).isoformat(), "expected_date": local.date().isoformat(),
            "missing": missing, **result})
        if missing:
            import json
            print(json.dumps({"severity": "ERROR", "event": "strategy_report_missing", **result}))
    return results


def check_due_report_publications(db, now, *, write=False):
    """Independent daily watchdog: detects missing output even if recovery dies."""
    from weekly_report import REPORT_CONFIG, REPORTS_COLLECTION, validate_weekly_report
    local = now.astimezone(ZoneInfo("Europe/Madrid"))
    if local.weekday() >= 5 or (local.hour, local.minute) < PUBLICATION_CHECK_TIME:
        return []
    problems = []
    for kind in ("DAILY_REPORT", "WEEKLY_REPORT"):
        day = expected_report_date(kind, now)
        report_id = REPORT_CONFIG[kind]["prefix"] + "-" + day.isoformat()
        snap = db.collection(REPORTS_COLLECTION).document(report_id).get()
        status = "MISSING"
        if snap.exists:
            try:
                validate_weekly_report(snap.to_dict(), expected_type=kind, require_sources=True)
                status = "PUBLISHED"
            except ValueError:
                status = "INVALID"
        missing = status != "PUBLISHED"
        if write:
            db.collection("meta").document("report_status_"+kind.lower()).set({
                "type": kind, "report_id": report_id, "checked_at": now.isoformat(),
                "expected_date": day.isoformat(), "missing": missing, "status": status})
        if missing:
            problems.append({"severity": "FAIL", "check": "strategy_report_publication",
                             "detail": f"Informe {report_id}: {status}", "sample": [report_id]})
    return problems
