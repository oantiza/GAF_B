"""Politicas de historico de fondos y la identidad de sus posiciones.

Las pruebas del inventario de calidad de la base vieja (`inventory_row`, `summary`, `refresh_inventory_if_due`) y de la
ficha de ingesta (`build_profile`, `sanitized`) se fueron el 21-11-2026 con ese codigo (censo de la base vieja, decision 31).
"""
from copy import deepcopy
import pytest
from fund_data_quality import normalize_holdings
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


def test_read_mapper_does_not_show_metrics_from_wrong_history():
    from readmodel.mappers import map_quant_metrics, quality_flags
    root={'asset_id':'LU0048293368','performance':{'returns':{'trailing_pct':{'3a_anualizada':{'fondo':10.75}}}}}
    metrics={'source':'FONDOSDB_EODHD_DAILY_HISTORY','windows':{'3y':{'annualized_return':0.04}},
             'max_drawdown_hist':{'value':-.96}}
    mapped=map_quant_metrics(root,metrics)
    assert mapped['annualized_return_3y']==.1075
    assert 'max_drawdown_hist' not in mapped
    assert 'HISTORY_RESTRICTED_AFTER_REVIEW' in quality_flags(root,mapped,{},'PARTIAL')
