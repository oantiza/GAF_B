"""OPT-2 (auditoria integral del 16-11-2026): hasta donde llega el periodo, y quien no llega.

El fin del periodo de Simular y de Optimizar era la mediana de las ultimas fechas de los activos. Con la mayoria de
las series paradas, la cartera entera se media hasta donde llegaba esa mayoria: las que si estaban al dia se
recortaban, la cobertura salia del 100 % y nada avisaba.

Decision A-161 de Oscar, del mismo dia: el periodo acaba en el dato mas reciente, y la serie que no llega se aparta con
su motivo, `SERIES_ENDS_EARLY`. «No llega» es acabar mas de catorce dias antes del final, que es el hueco que ya se
puenteaba con el ultimo precio. El aviso `PERIOD_END_STALE` se queda para cuando ni el dato mas reciente es de este mes.
"""
from datetime import date, timedelta
import math
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import portfolio_horizon as h
from optimization.repository import _clear_price_series_cache


def _serie(hasta: date, fase: float) -> dict:
    """Dias laborables desde el 01-01-2020 hasta `hasta`, con un nivel distinto por activo."""
    d = date(2020, 1, 1); values = {}; i = 0
    while d <= hasta:
        if d.weekday() < 5:
            values[d.isoformat()] = 100 * math.exp(i * .0002 + .02 * math.sin(i / 17 + fase))
            i += 1
        d += timedelta(days=1)
    return values


class Reader:
    def __init__(self, hasta_por_activo):
        self.points = {aid: _serie(hasta, n) for n, (aid, hasta) in enumerate(hasta_por_activo.items())}

    def get_asset(self, aid):
        return {'asset_id': aid, 'asset_type': 'ETF', 'quality': {'status': 'OK'}}

    def get_price_series(self, aid):
        return [{'schema_version': 'asset-price-series.v1.2', 'currency': 'EUR', 'interval': '1d',
                 'points': [{'date': d, 'value': v} for d, v in self.points[aid].items()]}]


@pytest.fixture(autouse=True)
def cache_limpia():
    _clear_price_series_cache(); yield; _clear_price_series_cache()


HOY = date(2026, 9, 6)
POSICIONES = [{'asset_id': aid, 'weight': peso} for aid, peso in [('A', .4), ('B', .3), ('C', .3)]]


def test_el_aviso_va_por_dias_desde_el_ultimo_medido():
    assert h.DIAS_DE_PERIODO_ATRASADO == 30
    # Del 07-08 al 06-09 de 2026 van 30 dias: aun no. Del 06-08, 31: si.
    assert h.avisos_del_periodo(['2026-08-07'], HOY) == []
    assert h.avisos_del_periodo(['2026-08-06'], HOY) == ['PERIOD_END_STALE']


def test_con_dos_de_tres_series_paradas_en_enero_de_2024_el_periodo_llega_hasta_la_que_sigue_y_las_otras_se_apartan():
    # A y B acaban el 26-01-2024 (viernes); C llega al viernes 04-09-2026. Es el caso que reprodujo la auditoria: con la
    # mediana, el periodo acababa el 26-01-2024, entraban las tres y la cobertura era del 100 %.
    reader = Reader({'A': date(2024, 1, 26), 'B': date(2024, 1, 26), 'C': date(2026, 9, 4)})
    result = h.analyze_horizon(reader, {'window': '3Y', 'positions': POSICIONES}, today=HOY)
    backtest = result['backtest']
    assert backtest['coverage']['last_date'] == '2026-09-04'
    assert backtest['asset_ids'] == ['C']
    assert backtest['excluded_assets'] == [{'asset_id': 'A', 'reason': 'SERIES_ENDS_EARLY'},
                                           {'asset_id': 'B', 'reason': 'SERIES_ENDS_EARLY'}]
    # A pesa 0,4 y B 0,3: lo medido es el 0,3 de C, y lo dice. La pantalla decide con esa cifra si hay o no medida.
    assert result['coverage_weight_percent'] == pytest.approx(30)
    # El periodo esta al dia, asi que no hay nada que avisar de el.
    assert 'PERIOD_END_STALE' not in backtest['warnings']


def test_una_sola_serie_parada_se_aparta_y_las_demas_no_se_recortan():
    # B va un dia por detras (jueves 03-09), lo normal en un fondo: entra. C se paro en enero de 2024: fuera.
    reader = Reader({'A': date(2026, 9, 4), 'B': date(2026, 9, 3), 'C': date(2024, 1, 26)})
    result = h.analyze_horizon(reader, {'window': '3Y', 'positions': POSICIONES}, today=HOY)
    backtest = result['backtest']
    assert backtest['coverage']['last_date'] == '2026-09-04'
    assert backtest['asset_ids'] == ['A', 'B']
    assert backtest['excluded_assets'] == [{'asset_id': 'C', 'reason': 'SERIES_ENDS_EARLY'}]
    assert result['coverage_weight_percent'] == pytest.approx(70)  # 0,4 + 0,3


@pytest.mark.parametrize('ultima_de_c, entra', [
    # El periodo acaba el viernes 04-09-2026. Catorce dias antes es el viernes 21-08: aun se puentea.
    (date(2026, 8, 21), True),
    # Quince dias antes, el jueves 20-08: ya no llega.
    (date(2026, 8, 20), False),
])
def test_no_llegar_es_acabar_mas_de_catorce_dias_antes_del_final(ultima_de_c, entra):
    assert h.MAX_BRIDGED_WEEK_GAP_DAYS == 14
    reader = Reader({'A': date(2026, 9, 4), 'B': date(2026, 9, 4), 'C': ultima_de_c})
    result = h.analyze_horizon(reader, {'window': '3Y', 'positions': POSICIONES}, today=HOY)
    assert ('C' in result['backtest']['asset_ids']) is entra
    assert result['backtest']['excluded_assets'] == ([] if entra else [{'asset_id': 'C', 'reason': 'SERIES_ENDS_EARLY'}])


def test_si_todas_van_atrasadas_el_periodo_acaba_donde_llegan_y_se_avisa():
    # Ninguna pasa del viernes 03-07-2026, y hoy es 06-09: 65 dias. Nadie se aparta —todas llegan al final que hay—, y
    # el aviso viaja con las metricas y con la frontera, que es donde la pantalla los ensenia.
    reader = Reader({'A': date(2026, 7, 3), 'B': date(2026, 7, 3), 'C': date(2026, 7, 2)})
    result = h.analyze_horizon(reader, {'window': '3Y', 'positions': POSICIONES}, today=HOY)
    backtest = result['backtest']
    assert backtest['coverage']['last_date'] == '2026-07-03'
    assert backtest['asset_ids'] == ['A', 'B', 'C']
    assert backtest['excluded_assets'] == []
    assert 'PERIOD_END_STALE' in backtest['warnings']
    assert 'PERIOD_END_STALE' in result['frontier']['warnings']


def test_con_las_series_al_dia_no_hay_aviso():
    reader = Reader({'A': date(2026, 9, 4), 'B': date(2026, 9, 4), 'C': date(2026, 9, 4)})
    result = h.analyze_horizon(reader, {'window': '3Y', 'positions': POSICIONES}, today=HOY)
    assert result['backtest']['coverage']['last_date'] == '2026-09-04'
    assert 'PERIOD_END_STALE' not in result['backtest']['warnings']
    assert 'PERIOD_END_STALE' not in result['frontier']['warnings']
