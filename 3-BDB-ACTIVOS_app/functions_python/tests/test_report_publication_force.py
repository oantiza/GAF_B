# -*- coding: utf-8 -*-
"""Publicación a mano del informe de estrategia (15-11-2026): forzado de administrador y
errores tipados de `admin_publish_report`. Sin Gemini ni nube: generador y base son dobles."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import inspect
import logging
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from firebase_functions import https_fn

from atomic_firestore_fake import Database
import main
import weekly_report
from test_weekly_report import valid_report

NOW = datetime(2026, 7, 10, 7, tzinfo=timezone.utc)
REPORT_PATH = weekly_report.REPORTS_COLLECTION + '/weekly-2026-07-10'
LEASE_PATH = '_report_publication/weekly-2026-07-10'
WHO = main._uid_hash('oscar')


def setup(monkeypatch, date='2026-07-10T07:00:00Z'):
    db = Database()
    calls = []
    def generate(*a, **kw):
        calls.append(1)
        return valid_report(date=date)
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', generate)
    return db, calls


def publish(db, **kw):
    return weekly_report.publish_strategy_report(db=db, now=NOW, **kw)


def test_force_regenerates_and_replaces_todays_report_with_its_trace(monkeypatch):
    db, calls = setup(monkeypatch)
    assert publish(db)['status'] == 'PUBLISHED'
    old = deepcopy(db.values[REPORT_PATH])
    monkeypatch.setattr(weekly_report, 'generate_strategy_report',
                        lambda *a, **kw: calls.append(2) or valid_report(date='2026-07-10T09:30:00Z'))
    result = publish(db, force=True, forced_by=WHO)
    assert result['status'] == 'PUBLISHED' and result['forced'] is True
    assert result['replaced']['date'] == old['date'] == '2026-07-10T07:00:00Z'
    assert calls == [1, 2]
    assert db.values[REPORT_PATH]['date'] == '2026-07-10T09:30:00Z'
    lease = db.values[LEASE_PATH]
    assert lease['status'] == 'PUBLISHED' and lease['attempts'] == 2
    [entry] = lease['force_history']
    assert entry['by_uid_hash'] == WHO and 'oscar' not in str(lease)
    assert entry['replaced']['report_id'] == 'weekly-2026-07-10'
    assert isinstance(entry['at'], datetime)


def test_force_after_exhausted_attempts_allows_exactly_one_more(monkeypatch):
    db, _ = setup(monkeypatch)
    def fail(*a, **kw):
        raise RuntimeError('provider unavailable')
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', fail)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            publish(db)
    assert publish(db)['status'] == 'ATTEMPTS_EXHAUSTED'
    with pytest.raises(RuntimeError):
        publish(db, force=True, forced_by=WHO)  # el intento forzado también falla
    assert db.values[LEASE_PATH]['attempts'] == 4
    assert publish(db)['status'] == 'ATTEMPTS_EXHAUSTED'  # sin force, sigue cerrado
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', lambda *a, **kw: valid_report())
    result = publish(db, force=True, forced_by=WHO)
    assert result['status'] == 'PUBLISHED' and result['replaced'] is None
    lease = db.values[LEASE_PATH]
    assert lease['attempts'] == 5 and len(lease['force_history']) == 2
    assert all(e['replaced'] is None for e in lease['force_history'])


def test_force_never_overrides_a_live_lease(monkeypatch):
    db, calls = setup(monkeypatch)
    assert publish(db)['status'] == 'PUBLISHED'
    db.values[LEASE_PATH].update({'status': 'RUNNING',
                                  'lease_until': datetime.now(timezone.utc) + timedelta(seconds=300)})
    before = deepcopy(db.values)
    assert publish(db, force=True, forced_by=WHO)['status'] == 'IN_PROGRESS'
    assert calls == [1] and db.values == before


def test_force_during_a_running_publication_is_busy_without_second_generation(monkeypatch):
    db, calls = setup(monkeypatch)
    def generate(*a, **kw):
        calls.append(publish(db, force=True, forced_by=WHO)['status'])
        return valid_report()
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', generate)
    assert publish(db)['status'] == 'PUBLISHED'
    assert calls == ['IN_PROGRESS']


def test_failed_forced_regeneration_keeps_the_old_report(monkeypatch):
    db, _ = setup(monkeypatch)
    publish(db)
    old = deepcopy(db.values[REPORT_PATH])
    def fail(*a, **kw):
        raise RuntimeError('provider unavailable')
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', fail)
    with pytest.raises(RuntimeError):
        publish(db, force=True, forced_by=WHO)
    assert db.values[REPORT_PATH] == old
    assert db.values[LEASE_PATH]['status'] == 'FAILED'
    assert publish(db)['status'] == 'ALREADY_PUBLISHED'


def test_force_requires_who_forces(monkeypatch):
    db, calls = setup(monkeypatch)
    with pytest.raises(ValueError):
        publish(db, force=True)
    assert calls == [] and not db.values


def test_without_force_results_carry_no_new_fields(monkeypatch):
    db, _ = setup(monkeypatch)
    result = publish(db)
    assert 'forced' not in result and 'replaced' not in result
    assert 'force_history' not in db.values[LEASE_PATH]


# --- Auditoria 20-11-2026 (P2-10): el informe aparece mientras se genera ------------------

def _aparece_durante_la_generacion(db):
    def generate(*a, **kw):
        # Otro escritor publica durante los ~90 s de generacion (despues de la primera lectura).
        db.values[REPORT_PATH] = {**valid_report(date='2026-07-10T07:30:00Z'), 'id': 'weekly-2026-07-10'}
        return valid_report(date='2026-07-10T09:30:00Z')
    return generate


def test_forced_publication_replaces_a_report_that_appeared_while_generating(monkeypatch):
    db, _ = setup(monkeypatch)
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', _aparece_durante_la_generacion(db))
    result = publish(db, force=True, forced_by=WHO)
    assert result['status'] == 'PUBLISHED' and result['forced'] is True
    assert result['replaced']['date'] == '2026-07-10T07:30:00Z'
    assert db.values[REPORT_PATH]['date'] == '2026-07-10T09:30:00Z'
    assert db.values[LEASE_PATH]['status'] == 'PUBLISHED'


def test_unforced_publication_does_not_mark_failed_a_report_published_meanwhile(monkeypatch):
    db, _ = setup(monkeypatch)
    monkeypatch.setattr(weekly_report, 'generate_strategy_report', _aparece_durante_la_generacion(db))
    result = publish(db)
    assert result['status'] == 'ALREADY_PUBLISHED'
    assert db.values[REPORT_PATH]['date'] == '2026-07-10T07:30:00Z'  # no se pisa lo ya publicado
    assert db.values[LEASE_PATH]['status'] == 'PUBLISHED'


# --- admin_publish_report -------------------------------------------------------------

class _Auth:
    uid = 'oscar'
    token = {'admin': True, 'email_verified': True}


class _Req:
    def __init__(self, data=None):
        self.auth, self.app, self.data = _Auth(), None, data or {}


def _call(data):
    return inspect.unwrap(main.admin_publish_report)(_Req(data))


@pytest.fixture
def service(monkeypatch):
    seen = []
    def fake(report_type, **kw):
        seen.append((report_type, kw))
        return {'status': 'PUBLISHED', 'report_id': 'daily-2026-07-10', 'type': report_type}
    monkeypatch.setattr(main, '_require_admin', lambda req, **limits: 'oscar')
    monkeypatch.setattr(main, 'publish_strategy_report_service', fake)
    return seen


def test_admin_publish_without_force_calls_as_before(service):
    assert _call({'type': 'WEEKLY_REPORT'})['status'] == 'PUBLISHED'
    assert service == [('WEEKLY_REPORT', {'force': False, 'forced_by': None})]


def test_admin_publish_with_force_passes_the_uid_hash_not_the_uid(service):
    _call({'type': 'DAILY_REPORT', 'force': True})
    assert service == [('DAILY_REPORT', {'force': True, 'forced_by': WHO})]
    assert WHO != 'oscar' and len(WHO) == 12


@pytest.mark.parametrize('value', ['true', 1, 'yes', None, False])
def test_only_a_real_true_forces(service, value):
    _call({'force': value})
    assert service[-1][1] == {'force': False, 'forced_by': None}


def test_admin_publish_still_requires_admin(monkeypatch):
    def deny(req, **limits):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, 'no')
    monkeypatch.setattr(main, '_require_admin', deny)
    monkeypatch.setattr(main, 'publish_strategy_report_service', lambda *a, **k: pytest.fail('ran'))
    with pytest.raises(https_fn.HttpsError) as err:
        _call({'force': True})
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


def test_invalid_type_is_invalid_argument(service):
    with pytest.raises(https_fn.HttpsError) as err:
        _call({'type': 'MONTHLY_REPORT'})
    assert err.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT
    assert service == []


def test_provider_failure_is_internal_without_raw_detail(monkeypatch, caplog):
    raw = 'Gemini 503: ' + 'x' * 900 + ' SECRET-PROVIDER-DETAIL'
    def boom(*a, **kw):
        raise RuntimeError(raw)
    monkeypatch.setattr(main, '_require_admin', lambda req, **limits: 'oscar')
    monkeypatch.setattr(main, 'publish_strategy_report_service', boom)
    with caplog.at_level(logging.ERROR):
        with pytest.raises(https_fn.HttpsError) as err:
            _call({'type': 'DAILY_REPORT'})
    assert err.value.code == https_fn.FunctionsErrorCode.INTERNAL
    assert 'SECRET' not in str(err.value.message) and len(err.value.message) < 120
    assert err.value.details == {'error_type': 'RuntimeError'}
    assert 'SECRET-PROVIDER-DETAIL' in caplog.text  # el detalle va al registro


def test_generated_report_failing_validation_is_internal_too(monkeypatch):
    def invalid(*a, **kw):
        raise weekly_report.WeeklyReportValidationError('narrative demasiado corta')
    monkeypatch.setattr(main, '_require_admin', lambda req, **limits: 'oscar')
    monkeypatch.setattr(main, 'publish_strategy_report_service', invalid)
    with pytest.raises(https_fn.HttpsError) as err:
        _call({'type': 'DAILY_REPORT'})
    assert err.value.code == https_fn.FunctionsErrorCode.INTERNAL
