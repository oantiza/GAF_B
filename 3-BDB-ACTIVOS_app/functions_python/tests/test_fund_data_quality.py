from copy import deepcopy
import pytest
from fund_data_quality import build_profile, normalize_holdings, sanitized
from fund_history_quality import usable_documents, policy_for


def test_wrong_donor_is_excluded_without_mutating_originals():
    # 30-09-2026: LU0171304552 se re-empalmo con la clase hermana correcta y dejo de
    # ser el ejemplo; LU0048293368 (split 30:1, usable_from 2021-07-20) sigue restringido.
    docs=[{'points':[{'date':'2021-07-19','value':10},{'date':'2021-07-20','value':20.01}]}]
    original=deepcopy(docs)
    actual=usable_documents('LU0048293368',docs)
    assert actual[0]['points']==[{'date':'2021-07-20','value':20.01}]
    assert docs==original


def test_unreconciled_distribution_nav_is_not_used_as_total_return():
    assert policy_for('IE00BYYPF581')['blocked']
    assert usable_documents('IE00BYYPF581',[{'points':[{'date':'2026-09-25','value':10}]}])==[]


NUEVE = ['DE0005318406','FR0013460961','IE00BYYPF581','IE00BZ18VT34','LU0102219945',
         'LU0162660350','LU0321373184','LU0404220724','LU1095739733']


@pytest.mark.parametrize('isin',NUEVE)
def test_reviewed_distribution_nav_only_opens_for_drawing(isin):
    docs=[{'points':[{'date':'2026-09-25','value':10}]}]
    assert policy_for(isin)['blocked'] is True
    assert usable_documents(isin,docs)==[]
    assert usable_documents(isin,docs,para_dibujar=False)==[]
    assert usable_documents(isin,docs,para_dibujar=True)[0]['points']==docs[0]['points']


def test_a_block_without_review_stays_closed_for_drawing(bloqueo_sin_revision):
    assert 'draw_after_review' not in policy_for('XS0000000001')
    assert usable_documents('XS0000000001',[{'points':[{'date':'2026-06-18','value':10}]}],para_dibujar=True)==[]


def test_excluded_dates_also_apply_when_drawing_without_touching_the_original():
    docs=[{'points':[{'date':'2025-01-31','value':0.98926},{'date':'2025-02-04','value':1.0411},{'date':'2025-02-05','value':0.9986}]}]
    original=deepcopy(docs)
    actual=usable_documents('IE00BZ18VT34',docs,para_dibujar=True)
    assert [p['date'] for p in actual[0]['points']]==['2025-01-31','2025-02-05']
    assert actual[0]['observations_count']==2
    assert docs==original
    # Solo a BNY: otro de los nueve conserva esa fecha.
    otro=usable_documents('LU0102219945',docs,para_dibujar=True)
    assert [p['date'] for p in otro[0]['points']]==['2025-01-31','2025-02-04','2025-02-05']


def test_every_review_says_when_who_and_where_its_evidence_is():
    import json, re
    from pathlib import Path
    from fund_history_quality import policies, _fichero_de_politicas
    app=Path(__file__).resolve().parents[2]
    fichero=_fichero_de_politicas()
    def comprueba(isin,revision):
        assert revision['reviewed_at']=='2026-11-05'
        assert 'Óscar' in revision['reviewed_by']
        ruta,_,ancla=revision['evidence'].partition('#')
        assert ancla==isin.lower()
        assert re.search(r'^### %s\b'%isin,(app/ruta).read_text(encoding='utf-8'),re.M),isin
    con_dibujo=[isin for isin,p in policies().items() if p.get('draw_after_review')]
    assert sorted(con_dibujo)==sorted(NUEVE)
    for isin in con_dibujo:
        assert policies()[isin]['blocked'] is True
        assert policies()[isin]['flags']==['TOTAL_RETURN_RECONCILED']
        comprueba(isin,policies()[isin]['draw_after_review'])
    comprueba('IE00BZ18VT34',policies()['IE00BZ18VT34']['excluded_dates_notes']['2025-02-04'])
    # Decision 72: Fidelity sale de aqui, y con el el unico motivo por el que una revision dejaba una serie fuera.
    assert set(fichero['reviews'])=={'LU2133220793'}
    for isin,revision in fichero['reviews'].items():
        assert isin not in policies()
        comprueba(isin,revision)
        assert 'exclusion_reason' not in revision


def test_classes_never_use_unverified_prelaunch_observations():
    docs=[{'points':[{'date':'2013-01-10','value':905.22},{'date':'2015-11-19','value':100}]}]
    assert usable_documents('LU1299311164',docs)[0]['first_date']=='2015-11-19'


def test_cash_currencies_and_identical_rows_keep_unique_stable_ids():
    rows=[{'name':'Cash','currency':'EUR','weight_pct':2},
          {'name':'Cash','currency':'USD','weight_pct':3},
          {'name':'Cash','currency':'EUR','weight_pct':4}]
    actual=normalize_holdings('LU0171304552',rows)
    assert len({r['holding_id'] for r in actual})==3
    assert sum(r['holding_weight'] for r in actual)==9
    assert actual==normalize_holdings('LU0171304552',actual)
    changed=deepcopy(rows);changed[0]['weight_pct']=8
    assert normalize_holdings('LU0171304552',changed)[0]['holding_id']==actual[0]['holding_id']


def test_enrichment_identity_and_sensitive_provenance():
    with pytest.raises(ValueError):
        build_profile('AAA',{'isin':'BBB'},{'_id':'AAA'},'2026-09-28')
    assert sanitized({'api_token':'sensitive','kid':{'url':'https://issuer.test/kid.pdf'},
                      'endpoint':'https://example.test/?api_token=secret'}) == {
                          'kid':{'url':'https://issuer.test/kid.pdf'},'endpoint':None}


def test_read_mapper_does_not_show_metrics_from_wrong_history():
    from readmodel.mappers import map_quant_metrics, quality_flags
    root={'asset_id':'LU0048293368','performance':{'returns':{'trailing_pct':{'3a_anualizada':{'fondo':10.75}}}}}
    metrics={'source':'FONDOSDB_EODHD_DAILY_HISTORY','windows':{'3y':{'annualized_return':0.04}},
             'max_drawdown_hist':{'value':-.96}}
    mapped=map_quant_metrics(root,metrics)
    assert mapped['annualized_return_3y']==.1075
    assert 'max_drawdown_hist' not in mapped
    assert 'HISTORY_RESTRICTED_AFTER_REVIEW' in quality_flags(root,mapped,{},'PARTIAL')


def test_complete_small_portfolio_and_old_kid_are_classified_independently():
    from datetime import date
    from fund_data_quality import inventory_row
    root={'asset_id':'TESTFUND','holdings_summary':{'full_holdings_loaded':True,'as_of_date':'2026-08-31'}}
    profile={'regulatory':{'kid':{'url':'https://issuer.test/kid.pdf','date':'2025-08-31'}}}
    row=inventory_row(root,profile,[],[{'name':'A'}],today=date(2026,9,28))
    assert 'SOLO_POSICIONES_PRINCIPALES' not in row['flags']
    assert 'KID_ANTIGUO' in row['flags']
    root['holdings_summary']['full_holdings_loaded']=False
    assert 'SOLO_POSICIONES_PRINCIPALES' in inventory_row(root,profile,[],[{}],today=date(2026,9,28))['flags']


def test_portfolio_review_and_merger_survive_inventory_refresh():
    from fund_data_quality import inventory_row
    profile = {'holdings_review': {'review_flags': ['RECUENTO_POSICIONES_PENDIENTE',
               'RECUENTO_POSICIONES_PENDIENTE', 'UNREVIEWED_VALUE']},
               'corporate_action_review': {'status': 'DEREGISTERED_MERGER_VERIFIED'}}
    row = inventory_row({'asset_id': 'TESTFUND'}, profile, [], [])
    assert row['flags'].count('RECUENTO_POSICIONES_PENDIENTE') == 1
    assert 'BAJA_CNMV_VERIFICADA' in row['flags']
    assert 'UNREVIEWED_VALUE' not in row['flags']


@pytest.mark.parametrize('isin', ['TESTFUND', 'IE00BYYPF581'])
def test_monthly_reference_never_clears_daily_history_restrictions(isin):
    from fund_data_quality import inventory_row, summary
    profile = {'monthly_history_reference': {'status': 'VERIFIED_MONTHLY_REFERENCE',
               'observations_count': 36, 'first_date': '2023-09-30', 'last_date': '2026-08-31'}}
    row = inventory_row({'asset_id': isin}, profile, [], [])
    assert row['reference_history_observations'] == 36
    assert row['reference_history_last_date'] == '2026-08-31'
    assert row['history_observations'] == 0
    assert 'SIN_HISTORICO_UTILIZABLE' in row['flags']
    report = summary([row], '2026-09-28')
    assert report['with_monthly_reference'] == 1
    assert report['with_history'] == 0
    assert report['history_blocked'] == int(isin == 'IE00BYYPF581')
    profile['monthly_history_reference']['status'] = 'PENDING_REVIEW'
    unverified = inventory_row({'asset_id': isin}, profile, [], [])
    assert unverified['reference_history_observations'] == 0
    assert unverified['reference_history_first_date'] is None
    assert summary([unverified], '2026-09-28')['with_monthly_reference'] == 0


# ---------------------------------------------------------------------------
# B-07 (auditoria 29-09): el inventario semanal recorria TODAS las price_series
# de todos los FUND con documentos completos (puntos incluidos). Ahora lee solo
# los campos resumen que usa, salvo para los fondos con politica de historico,
# que necesitan los puntos para aplicar `usable_documents`.
# ---------------------------------------------------------------------------

class _Snap:
    def __init__(self, id_, data, reference=None):
        self.id = id_; self._data = data; self.exists = data is not None; self.reference = reference
        self.update_time = 1
    def to_dict(self):
        return None if self._data is None else deepcopy(self._data)


class _Query:
    def __init__(self, coll, fields):
        self.coll = coll; self.fields = fields
    def stream(self):
        self.coll.db.selects.append((self.coll.path, list(self.fields)))
        return [_Snap(i, {k: v for k, v in d.items() if k in self.fields})
                for i, d in self.coll.db.docs_in(self.coll.path)]


class _Doc:
    def __init__(self, db, path):
        self.db = db; self.path = path
    def get(self, field_paths=None):
        data = self.db.data.get(self.path)
        return _Snap(self.path.split('/')[-1], data, reference=self)
    def collection(self, name):
        return _Coll(self.db, self.path + '/' + name)
    def update(self, payload, option=None):
        self.db.updates.append((self.path, payload))


class _Coll:
    def __init__(self, db, path):
        self.db = db; self.path = path
    def document(self, name):
        return _Doc(self.db, self.path + '/' + name)
    def select(self, fields):
        return _Query(self, fields)
    def stream(self):
        self.db.full_streams.append(self.path)
        return [_Snap(i, d, reference=_Doc(self.db, self.path + '/' + i)) for i, d in self.db.docs_in(self.path)]


class _Db:
    def __init__(self, data):
        self.data = data; self.selects = []; self.full_streams = []; self.updates = []
    def collection(self, name):
        return _Coll(self, name)
    def docs_in(self, path):
        return [(p.split('/')[-1], d) for p, d in self.data.items()
                if p.startswith(path + '/') and p.count('/') == path.count('/') + 1]


def _series(first, last, n, points=None):
    doc = {'asset_id': 'X', 'first_date': first, 'last_date': last, 'observations_count': n,
           'points': points or [{'date': first, 'value': 1}, {'date': last, 'value': 2}],
           'interval': '1d', 'source': 'EODHD', 'metadata': {'big': 'x' * 10}}
    return doc


def test_weekly_inventory_projects_price_series_and_keeps_policy_points():
    from datetime import datetime, timezone
    from fund_data_quality import refresh_inventory_if_due
    now = datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc)
    con_politica = 'LU1299311164'  # usable_from 2015-11-19
    db = _Db({
        'meta/fund_data_quality': {'generated_at': '2026-09-01T00:00:00+00:00'},
        'assets/TESTFUND': {'asset_id': 'TESTFUND', 'asset_type': 'FUND'},
        'assets/TESTFUND/price_series/A_2024': _series('2024-01-02', '2024-12-31', 250),
        'assets/TESTFUND/price_series/A_2025': _series('2025-01-02', '2026-09-25', 430),
        'assets/' + con_politica: {'asset_id': con_politica, 'asset_type': 'FUND'},
        'assets/%s/price_series/B_2013' % con_politica: _series(
            '2013-01-10', '2015-11-19', 2,
            points=[{'date': '2013-01-10', 'value': 905.22}, {'date': '2015-11-19', 'value': 100}]),
        'assets/ES0000000001': {'asset_id': 'ES0000000001', 'asset_type': 'STOCK'},
    })
    assert refresh_inventory_if_due(db, now) is True
    # Ninguna lectura de price_series con documentos completos.
    assert not [p for p in db.full_streams if p.endswith('/price_series')]
    fields = dict(db.selects)
    assert 'points' not in fields['assets/TESTFUND/price_series']
    assert {'first_date', 'last_date', 'observations_count'} <= set(fields['assets/TESTFUND/price_series'])
    assert 'points' in fields['assets/%s/price_series' % con_politica]
    (_path, payload), = db.updates
    rows = {r['isin']: r for r in payload['rows']}
    assert rows['TESTFUND']['history_first_date'] == '2024-01-02'
    assert rows['TESTFUND']['history_last_date'] == '2026-09-25'
    assert rows['TESTFUND']['history_observations'] == 680
    assert 'HISTORICO_ANTIGUO' not in rows['TESTFUND']['flags']
    # La politica sigue aplicandose sobre los puntos: el tramo pre-clase no cuenta.
    assert rows[con_politica]['history_first_date'] == '2015-11-19'
    assert rows[con_politica]['history_observations'] == 1
    assert 'ES0000000001' not in rows


def test_inventory_row_uses_summary_fields_when_points_are_not_loaded():
    from datetime import date
    from fund_data_quality import inventory_row
    docs = [{'first_date': '2024-01-02', 'last_date': '2024-12-31', 'observations_count': 250},
            {'first_date': '2025-01-02', 'last_date': '2026-09-25', 'observations_count': 430}]
    row = inventory_row({'asset_id': 'TESTFUND'}, None, docs, [], today=date(2026, 9, 28))
    assert (row['history_first_date'], row['history_last_date'], row['history_observations']) == (
        '2024-01-02', '2026-09-25', 680)
    assert 'SIN_HISTORICO_UTILIZABLE' not in row['flags']
