from copy import deepcopy
from datetime import date, timedelta
import math
import json
import os
from pathlib import Path
import sys

import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import portfolio_horizon as h
from optimization.repository import _clear_price_series_cache


class Reader:
    def __init__(self):
        self.points={}
        for aid,start in [('LONG','2020-01-01'),('IE000M7V94E1','2023-02-08'),('IE000DR59CI3','2025-02-10')]:
            d=date.fromisoformat(start); values={}; i=0
            while d<=date(2026,9,4):
                if d.weekday()<5:
                    values[d.isoformat()]=100*math.exp(i*.0002+.025*math.sin(i/17)+.015*math.sin(i/5))
                    i+=1
                d+=timedelta(days=1)
            self.points[aid]=values
    def get_asset(self,aid):
        return {'asset_id':aid,'asset_type':'ETF','quality':{'status':'BLOCKED' if aid=='TSK' else 'OK'}}
    def get_price_series(self,aid):
        return [{'schema_version':'asset-price-series.v1.2','currency':'EUR','interval':'1d',
                 'points':[{'date':d,'value':v} for d,v in self.points[aid].items()]}]


@pytest.fixture(autouse=True)
def released(monkeypatch):
    monkeypatch.setenv('BDB_VERIFIED_PRICE_REPAIR_RELEASES','IE000M7V94E1,IE000DR59CI3')
    _clear_price_series_cache(); yield; _clear_price_series_cache()


@pytest.mark.parametrize('window',['3Y','5Y'])
def test_full_window_same_universe_for_every_result_without_mutating_prices(window, capsys):
    reader=Reader(); original=deepcopy(reader.points)
    positions=[{'asset_id':a,'weight':w} for a,w in [('LONG',.90),('IE000M7V94E1',.05),('IE000DR59CI3',.04),('TSK',.01)]]
    result=h.analyze_horizon(reader,{'window':window,'positions':positions},today=date(2026,9,6))
    bt=result['backtest']; coverage=bt['coverage']
    assert (date.fromisoformat(coverage['last_date'])-date.fromisoformat(coverage['first_date'])).days>=int(window[0])*365
    assert coverage['measured_observations']>=int(window[0])*52+1
    assert set(bt['asset_ids'])=={'LONG','IE000M7V94E1','IE000DR59CI3'}
    assert result['coverage_weight_percent']==pytest.approx(99)
    assert bt['excluded_assets']==[{'asset_id':'TSK','reason':'QUALITY_BLOCKED'}]
    assert result['frontier'] is not None
    assert result['frontier']['coverage']['first_date']==coverage['first_date']
    assert set(result['frontier']['current_portfolio']['weights'])==set(bt['asset_ids'])
    for comparison in [result['equal_weight'],result['max_sharpe']]:
        assert comparison['asset_ids']==bt['asset_ids']
        assert comparison['coverage']==coverage
    assert reader.points==original
    assert {d.isoformat():v for d,v in h._load_window_values(reader,'IE000DR59CI3',reader.get_asset('IE000DR59CI3'),'10Y').items()}==original['IE000DR59CI3']
    # Timings must reach stdout even with Python's default WARNING log threshold.
    logs = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith('{')]
    phases = [row for row in logs if row.get('message') == 'portfolio_horizon_phase']
    assert [row['phase'] for row in phases] == ['read', 'solve']
    assert all(row['severity'] == 'INFO' and row['seconds'] >= 0 for row in phases)
    assert all(aid not in json.dumps(phases) for aid in reader.points)


def test_extension_reproducible_keeps_real_values_and_idiosyncratic_risk():
    reader=Reader(); aid='IE000DR59CI3'; bundle=h.references(); original=reader.points[aid]
    result, detail=h.extend_history(aid,original,bundle['assets'][aid],bundle['version'])
    again,_=h.extend_history(aid,original,bundle['assets'][aid],bundle['version'])
    assert result==again
    assert all(result[d]==v for d,v in original.items())
    assert detail['residual_volatility']>0
    assert min(result) < '2021-01-01'
    assert all(math.isfinite(v) and v>0 for v in result.values())
    assert len({round(result[p['date']]/p['value'],6) for p in bundle['assets'][aid]['prices'] if p['date']<min(original)})>50


def test_never_uses_a_proxy_to_cover_a_hole_after_inception():
    reader=Reader(); aid='IE000DR59CI3'
    reader.points[aid]={d:v for d,v in reader.points[aid].items() if not '2026-01-01'<=d<='2026-02-01'}
    result=h.analyze_horizon(reader,{'window':'5Y','positions':[{'asset_id':'LONG','weight':.8},{'asset_id':aid,'weight':.2}]},today=date(2026,9,6))
    assert result['backtest']['asset_ids']==['LONG']
    assert result['coverage_weight_percent']==80
    assert not result['extensions']


def test_rejects_low_quality_reference_and_missing_real_join():
    reader=Reader(); aid='IE000DR59CI3'; ref=deepcopy(h.references()['assets'][aid])
    ref['validation']['holdout_correlation']=.1
    with pytest.raises(h.OptimizationError,match='validación'):
        h.extend_history(aid,reader.points[aid],ref,'test')
    ref=h.references()['assets'][aid]
    with pytest.raises(h.OptimizationError,match='inicio real'):
        h.extend_history(aid,{d:v for d,v in reader.points[aid].items() if d>'2025-03-01'},ref,'test')


@pytest.mark.parametrize('payload',[
 {'window':'1Y','positions':[]}, {'window':'3Y','positions':[{'asset_id':'A','weight':-1}]},
 {'window':'5Y','positions':[{'asset_id':'A','weight':float('nan')}]},
 {'window':'5Y','positions':[{'asset_id':'A','weight':1}]*(h.MAX_POSICIONES_SIMULACION+1)},
])
def test_invalid_requests_fail_closed(payload):
    with pytest.raises(h.InvalidOptimizationRequest): h.analyze_horizon(Reader(),payload)


# R-05 (auditoria 29-09): el horizonte es analisis retrospectivo, igual que el
# backtest 10A; un fondo dado de baja por fusion verificada sigue teniendo un
# historico real y debe entrar, no salir con NON_INVESTABLE_CORPORATE_ACTION.
def test_merged_fund_with_real_history_enters_the_retrospective_horizon():
    class MergedReader(Reader):
        def get_asset(self,aid):
            root=super().get_asset(aid)
            if aid=='LONG':
                root['quality']={'status':'OK','review_flags':['DEREGISTERED_MERGER_VERIFIED']}
            return root
    reader=MergedReader()
    positions=[{'asset_id':'LONG','weight':.9},{'asset_id':'IE000M7V94E1','weight':.1}]
    result=h.analyze_horizon(reader,{'window':'3Y','positions':positions},today=date(2026,9,6))
    assert 'LONG' in result['backtest']['asset_ids']
    assert result['backtest']['excluded_assets']==[]
    assert result['coverage_weight_percent']==pytest.approx(100)


# ALTA-03 (auditoria 16-10-2026): diez dias sin dato caben en el puenteo de 14 dias del
# optimizador y del backtest; antes (max_age=7) el activo salia entero del horizonte.
def test_a_ten_day_gap_is_bridged_and_volatility_is_measured_with_weekly_sampling():
    from weekly_sampling import sample_volatility, weekly_last_observations, weekly_returns
    reader=Reader(); aid='IE000M7V94E1'
    reader.points[aid]={d:v for d,v in reader.points[aid].items() if not '2025-03-03'<=d<='2025-03-12'}
    positions=[{'asset_id':'LONG','weight':.6},{'asset_id':aid,'weight':.4}]
    result=h.analyze_horizon(reader,{'window':'3Y','positions':positions},today=date(2026,9,6))
    bt=result['backtest']
    assert bt['asset_ids']==sorted(['LONG',aid]) and bt['excluded_assets']==[]
    puntos=[(date.fromisoformat(p['date']),p['value']) for p in bt['portfolio_series']]
    semanas=weekly_last_observations(puntos)
    retornos,_fechas,puenteadas=weekly_returns(semanas)
    assert not puenteadas and len(retornos)==len(semanas)-1
    assert bt['coverage']['measured_observations']==len(semanas)
    assert bt['metrics']['volatility']==pytest.approx(sample_volatility(list(retornos.values()),52),abs=1e-12)
    # Un hueco de mas de 14 dias sigue excluyendo el activo entero.
    reader.points[aid]={d:v for d,v in reader.points[aid].items() if not '2025-06-02'<=d<='2025-06-20'}
    _clear_price_series_cache()
    result=h.analyze_horizon(reader,{'window':'3Y','positions':positions},today=date(2026,9,6))
    assert result['backtest']['excluded_assets']==[{'asset_id':aid,'reason':'INSUFFICIENT_HISTORY'}]


def test_week_indices_are_the_last_observation_of_each_iso_week():
    dias=[date(2026,9,7)+timedelta(days=i) for i in range(12)]  # lunes 7 a viernes 18
    laborables=[d.isoformat() for d in dias if d.weekday()<5]
    assert [laborables[i] for i in h._week_indices(laborables)]==['2026-09-11','2026-09-18']
    # Una semana que acaba en jueves (festivo el viernes) cuenta con su ultimo dato.
    sin_viernes=[d for d in laborables if d!='2026-09-18']
    assert [sin_viernes[i] for i in h._week_indices(sin_viernes)]==['2026-09-11','2026-09-17']
