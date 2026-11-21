"""Production regressions: an overlong draft and yesterday labelled current."""
from copy import deepcopy
from datetime import datetime, timezone
import json

import pytest
import weekly_report
from atomic_firestore_fake import Database
from test_weekly_report import valid_daily_report, valid_report

NOW = datetime(2026, 10, 21, 7, tzinfo=timezone.utc)


def generator(monkeypatch, drafts, *, spent_after_draft=0):
    calls = []
    clock = [100.0]
    monkeypatch.setattr(weekly_report, '_monotonic', lambda: clock[0])
    sources = valid_report()['sources']
    payload = {'candidates':[{'groundingMetadata':{'groundingChunks':[
        {'web':{'title':s['title'], 'uri':s['url']}} for s in sources]}}]}

    def generate(key, prompt, *, grounded, json_output, deadline=None, accept_until=None):
        calls.append({'grounded':grounded, 'prompt':prompt, 'deadline':deadline})
        if grounded:
            return 'Base factual comprobada', payload, 'research'
        clock[0] += spent_after_draft
        value = drafts.pop(0)
        if isinstance(value, Exception):
            raise value
        return value if isinstance(value,str) else json.dumps(value), {}, 'writer'

    monkeypatch.setattr(weekly_report, '_generate_with_fallback', generate)
    return calls, sources


@pytest.mark.parametrize('failure', ['length', 'schema', 'json'])
def test_one_editorial_correction_reuses_research_and_validates_before_atomic_publish(monkeypatch, failure):
    invalid = valid_daily_report()
    if failure == 'length':
        invalid['fullReport']['narrative'] = ' '.join(['dato'] * 478)
    elif failure == 'schema':
        invalid['summary']['marketTemperature'] = 'Optimista'
    else:
        invalid = '{"summary": broken'
    corrected = valid_daily_report()
    corrected['sources'] = [{'title':'Invented source', 'url':'https://example.com'}]
    calls, sources = generator(monkeypatch, [invalid, corrected])
    db = Database()
    result = weekly_report.publish_strategy_report('DAILY_REPORT', db=db, api_key='test', now=NOW)
    published = db.values['bdb_activos_reports/daily-2026-10-21']
    assert result['status'] == 'PUBLISHED'
    assert [call['grounded'] for call in calls] == [True, False, False]
    assert calls[1]['deadline'] == calls[2]['deadline'] == 520
    assert 'CORRECCION EDITORIAL' in calls[2]['prompt']
    assert 'Base factual comprobada' in calls[2]['prompt']
    assert published['sources'] == sources  # Model cannot replace the grounded sources.
    assert published['fullReport'] == corrected['fullReport']
    assert db.values['_report_publication/daily-2026-10-21']['attempts'] == 1


def test_second_invalid_draft_is_not_published_or_retried_indefinitely(monkeypatch):
    invalid = valid_daily_report()
    invalid['fullReport']['narrative'] = ' '.join(['dato'] * 478)
    calls, _ = generator(monkeypatch, [deepcopy(invalid), deepcopy(invalid)])
    db = Database()
    with pytest.raises(weekly_report.WeeklyReportValidationError, match='460'):
        weekly_report.publish_strategy_report('DAILY_REPORT', db=db, api_key='test', now=NOW)
    assert len(calls) == 3
    assert 'bdb_activos_reports/daily-2026-10-21' not in db.values
    assert db.values['_report_publication/daily-2026-10-21']['status'] == 'FAILED'


def test_editorial_correction_does_not_extend_the_global_deadline(monkeypatch):
    invalid = valid_daily_report()
    invalid['fullReport']['narrative'] = ' '.join(['dato'] * 478)
    calls, _ = generator(monkeypatch, [invalid], spent_after_draft=405)
    with pytest.raises(weekly_report.WeeklyReportValidationError, match='460'):
        weekly_report.generate_strategy_report('DAILY_REPORT', api_key='test', now=NOW)
    assert len(calls) == 2  # Only 15 seconds remain; no useful correction call fits.


def test_transport_failure_does_not_start_an_editorial_retry(monkeypatch):
    calls, _ = generator(monkeypatch, [weekly_report.WeeklyReportError('provider unavailable')])
    with pytest.raises(weekly_report.WeeklyReportError, match='provider unavailable'):
        weekly_report.generate_strategy_report('DAILY_REPORT', api_key='test', now=NOW)
    assert len(calls) == 2


def test_two_slow_research_models_leave_time_for_a_third_with_sources(monkeypatch):
    clock = [0.0]
    calls = []
    monkeypatch.setattr(weekly_report, '_monotonic', lambda: clock[0])
    monkeypatch.setattr(weekly_report, 'RESEARCH_MODELS', ('slow-a','slow-b','available'))
    monkeypatch.setattr(weekly_report, '_sleep', lambda seconds: pytest.fail('No retry delay for exhausted models'))
    def generate(model, *args, timeout, **kwargs):
        calls.append((model,timeout))
        if model != 'available':
            clock[0] += timeout
            error = weekly_report.WeeklyReportError('timed out')
            error.transient = True
            raise error
        clock[0] += 20
        return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'Grounded research'}]},
                               'groundingMetadata':{'groundingChunks':[
                                   {'web':{'title':s['title'],'uri':s['url']}} for s in valid_report()['sources']]}}]}
    monkeypatch.setattr(weekly_report, '_generate_content', generate)
    result = weekly_report._generate_with_fallback('key','prompt',grounded=True,json_output=False,deadline=270)
    assert result[2] == 'available'
    assert calls == [('slow-a',100),('slow-b',100),('available',70)]
    assert clock[0] == 220


@pytest.mark.parametrize('kind,published,now,expected', [
    ('DAILY_REPORT','2026-10-20T05:00:00Z','2026-10-21T06:09:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-20T05:00:00Z','2026-10-21T06:10:00Z','STALE'),
    ('DAILY_REPORT','2026-10-20T05:00:00Z','2026-10-21T15:00:00Z','STALE'),
    ('DAILY_REPORT','2026-10-21T05:00:00Z','2026-10-21T05:01:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-22T05:00:00Z','2026-10-21T15:00:00Z','STALE'),
    ('DAILY_REPORT','2026-10-16T05:00:00Z','2026-10-17T09:00:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-16T05:00:00Z','2026-10-18T22:30:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-16T05:00:00Z','2026-10-19T06:09:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-16T05:00:00Z','2026-10-19T06:10:00Z','STALE'),
    ('DAILY_REPORT','2026-10-23T05:00:00Z','2026-10-26T07:09:00Z','CURRENT'),
    ('DAILY_REPORT','2026-10-23T05:00:00Z','2026-10-26T07:10:00Z','STALE'),
    ('WEEKLY_REPORT','2026-10-12T05:15:00Z','2026-10-19T06:09:00Z','CURRENT'),
    ('WEEKLY_REPORT','2026-10-12T05:15:00Z','2026-10-19T06:10:00Z','STALE'),
    ('WEEKLY_REPORT','2026-10-19T05:15:00Z','2026-10-25T15:00:00Z','CURRENT'),
])
def test_freshness_tracks_madrid_publication_slots_including_weekends_and_dst(kind, published, now, expected):
    report = {'date':published}
    assert weekly_report._freshness(report, kind, datetime.fromisoformat(now))[0] == expected
