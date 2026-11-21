from datetime import datetime, timedelta, timezone
from copy import deepcopy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from google.api_core.exceptions import FailedPrecondition

from atomic_firestore_fake import Database
import weekly_report
import report_publication
from test_weekly_report import valid_report

NOW = datetime(2026, 7, 10, 7, tzinfo=timezone.utc)
REPORT_PATH = weekly_report.REPORTS_COLLECTION + '/weekly-2026-07-10'


def test_watchdog_detects_missing_output_without_recovery_marker():
    db = Database()
    monday = datetime(2026,10,19,9,tzinfo=timezone.utc)
    problems = report_publication.check_due_report_publications(db,monday,write=True)
    assert len(problems)==2 and all(p['severity']=='FAIL' for p in problems)
    assert db.values['meta/report_status_daily_report']['missing'] is True
    assert db.values['meta/report_status_weekly_report']['expected_date']=='2026-10-19'
    before = deepcopy(db.values)
    assert report_publication.check_due_report_publications(db,monday.replace(hour=5))==[]
    assert db.values==before


def setup(monkeypatch):
    db = Database()
    calls = []
    def generate(*a, **kw):
        calls.append(1)
        return valid_report()
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', generate)
    return db, calls


def test_second_delivery_does_not_generate_or_overwrite(monkeypatch):
    db, calls = setup(monkeypatch)
    assert weekly_report.publish_strategy_report(db=db, now=NOW)['status'] == 'PUBLISHED'
    before = deepcopy(db.values)
    assert weekly_report.publish_strategy_report(db=db, now=NOW)['status'] == 'ALREADY_PUBLISHED'
    assert calls == [1] and db.values == before


def test_concurrent_delivery_is_busy_without_second_generation(monkeypatch):
    db, calls = setup(monkeypatch)
    def generate(*a, **kw):
        calls.append(weekly_report.publish_strategy_report(db=db, now=NOW)['status'])
        return valid_report()
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', generate)
    assert weekly_report.publish_strategy_report(db=db, now=NOW)['status'] == 'PUBLISHED'
    assert calls == ['IN_PROGRESS']


def test_three_failed_attempts_are_durable_and_bounded(monkeypatch):
    db, _ = setup(monkeypatch)
    def fail(*a, **kw):
        raise RuntimeError('provider unavailable')
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', fail)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            weekly_report.publish_strategy_report(db=db, now=NOW)
    assert weekly_report.publish_strategy_report(db=db, now=NOW)['status'] == 'ATTEMPTS_EXHAUSTED'
    assert not db.collection(weekly_report.REPORTS_COLLECTION).document('weekly-2026-07-10').get().exists


def test_expired_owner_cannot_publish_after_lease_taken_over(monkeypatch):
    db, _ = setup(monkeypatch)
    def generate(*a, **kw):
        ref = db.collection('_report_publication').document('weekly-2026-07-10')
        ref.update({'token': 'new-owner'})
        return valid_report()
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', generate)
    with pytest.raises(FailedPrecondition):
        weekly_report.publish_strategy_report(db=db, now=NOW)
    assert REPORT_PATH not in db.values
    assert db.values['_report_publication/weekly-2026-07-10']['token'] == 'new-owner'


def test_expired_lease_is_recovered(monkeypatch):
    db, _ = setup(monkeypatch)
    db.collection('_report_publication').document('weekly-2026-07-10').create({
        'status': 'RUNNING', 'attempts': 1, 'lease_until': datetime.now(timezone.utc)-timedelta(seconds=1)})
    assert weekly_report.publish_strategy_report(db=db, now=NOW)['status'] == 'PUBLISHED'
    assert db.values['_report_publication/weekly-2026-07-10']['attempts'] == 2


def test_missing_report_status_is_published_without_email(monkeypatch, capsys):
    db = Database()
    monday = datetime(2026, 10, 19, 5, 50, tzinfo=timezone.utc)
    result = report_publication.recover_due_reports(db=db, now=monday,
        publish_report=lambda kind, **kw: {'status': 'ATTEMPTS_EXHAUSTED', 'type': kind})
    assert len(result) == 2
    assert all(row['missing'] for row in db.values.values())
    assert 'strategy_report_missing' in capsys.readouterr().out


def test_weekend_recovery_does_not_generate_or_write():
    db = Database()
    assert report_publication.recover_due_reports(db=db, now=datetime(2026,10,18,tzinfo=timezone.utc),
        publish_report=lambda *a, **k: pytest.fail('weekend generation')) == []
    assert not db.values


def test_publication_slot_uses_madrid_at_midnight(monkeypatch):
    db, _ = setup(monkeypatch)
    result = weekly_report.publish_strategy_report(db=db, now=datetime(2026,7,9,23,tzinfo=timezone.utc))
    assert result['report_id'] == 'weekly-2026-07-10'
