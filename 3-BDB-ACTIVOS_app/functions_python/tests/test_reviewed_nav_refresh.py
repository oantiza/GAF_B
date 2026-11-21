from copy import deepcopy
from datetime import date
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from google.api_core.exceptions import FailedPrecondition
from atomic_firestore_fake import Database
import reviewed_nav_refresh as refresh
from capitalgroup_nav import prepare_plan

AID = 'LU1378997107'


def fixture():
    points = [{'date': f'2026-10-{d:02}', 'value': 30+d/100} for d in range(5,10)]
    series = dict(asset_id=AID, asset_type='FUND', series_type='NAV', source='OTHER',
                  schema_version='asset-price-series.v1.2', currency='EUR', source_currency='EUR',
                  source_listing_id='CAPITALGROUP:'+AID, source_price_id='CAPITALGROUP:'+AID,
                  document_id='CG_2026', year=2026, points=points, first_date='2026-10-05',
                  last_date='2026-10-09', observations_count=5, interval='1d',
                  updated_at='2026-10-09T00:00:00Z', history_quality_status='PARTIAL',
                  metadata={'history_ingestion_review': {'proof':'retained'}})
    incoming = points + [{'date':'2026-10-12','value':30.12}]
    plan = prepare_plan(AID, series, incoming, incoming[-1], date(2026,10,13))
    plan.update(source_url='https://capgroup-website.publifund.com/', provider_sha256='a'*64,
                provider='capitalgroup', source_listing_id='CAPITALGROUP:'+AID)
    return series, plan


def setup(monkeypatch):
    db = Database()
    series, plan = fixture()
    ref = db.collection('assets').document(AID)
    ref.create({'asset_id': AID, 'asset_type':'FUND','updated_at':'old',
                'performance':{'valuation':{'vl':30.09,'vl_fecha':'2026-10-09'},'untouched':123}})
    ref.collection('price_series').document('CG_2026').create(series)
    monkeypatch.setattr(refresh, 'fetch_capitalgroup', lambda *a: deepcopy(plan))
    monkeypatch.setenv('BDB_ACTIVOS_ENABLE_MASTER_WRITES','YES_I_UNDERSTAND_MASTER_DB_WRITES')
    return db, ref, series, plan


def test_append_preserves_old_points_and_atomic_audit(monkeypatch):
    db, ref, series, plan = setup(monkeypatch)
    result = refresh.refresh_reviewed_one(AID, db=db, write=True)
    after = ref.collection('price_series').document('CG_2026').get().to_dict()
    assert after['points'] == series['points'] + plan['append_only_points']
    assert after['metadata']['history_ingestion_review'] == series['metadata']['history_ingestion_review']
    assert ref.get().to_dict()['performance']['untouched'] == 123
    assert ref.get().to_dict()['performance']['valuation']['vl'] == 30.12
    assert db.values['_nav_refresh_audit/'+result['audit_id']]['previous_series'] == series


def test_concurrent_root_change_aborts_series_and_audit(monkeypatch):
    db, ref, series, plan = setup(monkeypatch)
    def fetch(*a):
        ref.update({'is_active':False})
        return plan
    monkeypatch.setattr(refresh,'fetch_capitalgroup',fetch)
    with pytest.raises(FailedPrecondition):
        refresh.refresh_reviewed_one(AID, db=db, write=True)
    assert ref.collection('price_series').document('CG_2026').get().to_dict() == series
    assert not any(p.startswith('_nav_refresh_audit/') for p in db.values)


def test_dry_run_and_up_to_date_do_not_write(monkeypatch):
    db, ref, series, plan = setup(monkeypatch)
    before = deepcopy(db.values)
    assert not refresh.refresh_reviewed_one(AID, db=db)['applied']
    plan.update(append_only_points=[],status='UP_TO_DATE')
    monkeypatch.setattr(refresh,'fetch_capitalgroup',lambda *a: plan)
    assert not refresh.refresh_reviewed_one(AID, db=db, write=True)['applied']
    assert db.values == before


def test_new_year_creates_separate_bucket_without_copying_old_points():
    series, plan = fixture()
    plan['append_only_points'] = [{'date':'2027-01-04','value':31}]
    docs = refresh.prepare_documents(series,plan,'2027-01-05T00:00:00Z')
    assert len(docs)==1 and docs[0]['year']==2027
    assert docs[0]['points']==plan['append_only_points']
    assert docs[0]['document_id'] != series['document_id']


def test_reviewed_source_transition_keeps_original_bucket_and_rollover_context():
    series,plan=fixture()
    plan.update(provider='morningstar',source_listing_id='MORNINGSTAR:REVIEWED')
    docs=refresh.prepare_documents(series,plan,'2026-10-13T00:00:00Z')
    assert docs[0]['points']==plan['append_only_points']
    assert docs[0]['source']=='MORNINGSTAR'
    assert docs[0]['metadata']['source_transition']['previous_source_listing_id']==series['source_listing_id']
    context=refresh.overlap_context(docs[0],[docs[0],series],series['source_listing_id'])
    assert len(context['points'])==6
    assert len(refresh.overlap_context(docs[0],[docs[0],series])['points'])==1


def test_existing_future_bucket_is_never_overwritten(monkeypatch):
    db, ref, series, plan = setup(monkeypatch)
    plan['append_only_points'] = [{'date':'2027-01-04','value':31}]
    new_id = refresh.prepare_documents(series,plan,'now')[0]['document_id']
    ref.collection('price_series').document(new_id).create({'points':[{'date':'2025-01-01','value':7}]})
    before = deepcopy(db.values)
    with pytest.raises(ValueError,match='already exists'):
        refresh.refresh_reviewed_one(AID,db=db,write=True)
    assert db.values == before


def test_write_gate_and_unreviewed_assets_are_rejected(monkeypatch):
    db, _, _, _ = setup(monkeypatch)
    monkeypatch.delenv('BDB_ACTIVOS_ENABLE_MASTER_WRITES')
    with pytest.raises(RuntimeError,match='MASTER_WRITES_DISABLED'):
        refresh.refresh_reviewed_one(AID,db=db,write=True)
    with pytest.raises(ValueError,match='not been admitted'):
        refresh.refresh_reviewed_one('ES0125140A14',db=db,write=False)
