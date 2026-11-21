import pytest
from fund_return_basis import reconcile_return
from fund_ingest import _trailing_returns

POINTS = [{'date':'2023-08-31','value':100}, {'date':'2026-08-31','value':133.1}]

def test_cumulative_is_converted_not_labelled_annualized():
    result = reconcile_return(33.1, POINTS, '2026-08-31', 36)
    assert result['basis'] == 'CUMULATIVE'
    assert result['annualized_pct'] == pytest.approx(10)

def test_annualized_value_is_preserved():
    assert reconcile_return(10, POINTS, '2026-08-31', 36)['annualized_pct'] == 10

@pytest.mark.parametrize('points,end,start', [
    (POINTS,'2026-08-30',None), (POINTS,'2026-08-31','2024-01-01'),
    (POINTS+POINTS,'2026-08-31',None),
    ([{'date':'2023-08-31','value':0}]+POINTS[1:],'2026-08-31',None),
])
def test_missing_duplicate_invalid_or_pre_class_anchors_rejected(points,end,start):
    assert reconcile_return(33.1,points,end,36,class_start=start) is None

def test_disagreement_and_ambiguity_are_not_forced():
    assert reconcile_return(60,POINTS,'2026-08-31',36) is None
    assert reconcile_return(.04,[POINTS[0],{'date':'2026-08-31','value':100.04}],'2026-08-31',36) is None

def test_ingestion_requires_currency_date_and_graph_proof():
    block = {'columnDefs':['1Month','3Year','SinceInception'],'totalReturnNAV':[2,33.1,80],
             'cur':'EUR','fundReturnDate':'2026-08-31T05:00:00.000'}
    graph = {'baseCurrency':'EUR','graphData':{'fund':POINTS}}
    result = _trailing_returns(block,graph,'2020-01-01')
    assert result['trailing_pct'] == {'1m':{'fondo':2},'3a_anualizada':{'fondo':10}}
    assert result['fecha_dato'] == '2026-08-31'
    # R-09: sin prueba no hay `fondo` (cifra verificada); la cruda queda aparte.
    assert 'fondo' not in _trailing_returns(block)['trailing_pct']['3a_anualizada']
    assert 'fondo' not in _trailing_returns(block,{**graph,'baseCurrency':'USD'})['trailing_pct']['3a_anualizada']
    assert 'fondo' not in _trailing_returns({**block,'extendedPerformanceFlag':[False,True]},graph)['trailing_pct']['3a_anualizada']


# R-09 (auditoria 29-09): sin prueba del grafico (divisa distinta, punto exacto
# ausente, cifra extendida) la rentabilidad 3/5/10A del proveedor DESAPARECIA
# sin rastro. Ahora se conserva cruda como UNVERIFIED, separada de `fondo`,
# que sigue reservado a cifras anualizadas verificadas.
def test_unverified_multi_year_return_is_kept_raw_and_never_labelled_annualized():
    from readmodel.mappers import map_quant_metrics
    block = {'columnDefs':['1Month','3Year','5Year'],'totalReturnNAV':[2,33.1,45.0],
             'cur':'EUR','fundReturnDate':'2026-08-31T05:00:00.000'}
    graph = {'baseCurrency':'EUR','graphData':{'fund':POINTS}}
    # 3A reconcilia; 5A no tiene el punto exacto en el grafico.
    result = _trailing_returns(block, graph, '2020-01-01')
    assert result['trailing_pct']['3a_anualizada'] == {'fondo':10}
    assert result['trailing_pct']['5a_anualizada'] == {'fondo_sin_verificar':45.0}
    assert result['multi_year_reconciliation']['5a_anualizada'] == {
        'basis':'UNVERIFIED','reported_pct':45.0,'reason':'GRAPH_PROOF_MISSING'}
    # Divisa distinta: tampoco hay prueba, pero la cifra queda con su motivo.
    other = _trailing_returns(block, {**graph,'baseCurrency':'USD'})
    assert other['trailing_pct']['3a_anualizada'] == {'fondo_sin_verificar':33.1}
    assert other['multi_year_reconciliation']['3a_anualizada']['reason'] == 'CURRENCY_MISMATCH'
    # El read model no la publica como rentabilidad anualizada.
    root = {'asset_id':'LU0000000000','asset_type':'FUND','performance':{'returns':other},
            'risk':{'volatilidad_pct':{'3a':{'fondo':12}}}}
    mapped = map_quant_metrics(root, None)
    assert 'annualized_return_3y' not in mapped
    assert mapped['annualized_return_1y'] if '1a' in other['trailing_pct'] else True
