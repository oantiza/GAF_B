# -*- coding: utf-8 -*-
"""Decision de Oscar (15-11-2026): la simulacion no anualiza un tramo de menos de un ano.

`backtest_portfolio` (la simulacion suelta, sin `analysis_bundle`) cruzaba las fechas
comunes de todos los activos y anualizaba lo que quedase: con un ETF lanzado hace cuatro
meses, un +6 % en 119 dias se publicaba como un 19,5 % anual. Con menos de
MIN_ANNUALIZATION_DAYS (330 dias, el umbral de la maestra y de la cartera real) el CAGR y
el Sharpe van vacios (None) y se publica la rentabilidad acumulada del tramo con sus dias
y fechas. Volatilidad y caida maxima no cambian.

Cada cifra esperada sale de una cuenta escrita aqui, no de la salida del motor.

Ejecuta: pytest functions_python/tests/test_backtest_tramo_corto_no_anualiza.py
"""
from datetime import date, timedelta
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import _clear_price_series_cache, backtest_portfolio  # noqa: E402
from weekly_sampling import MIN_ANNUALIZATION_DAYS  # noqa: E402

AID = "LU0000000TRAMO"
RF = 0.02
DIAS_ANIO = 365.2425
AVISO = "PERIOD_TOO_SHORT_TO_ANNUALIZE"


def resolver(start, end):
    return {"rate": RF, "coverage_ratio": 1.0}


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


class _Lector:
    def __init__(self, puntos):
        self.puntos = puntos

    def get_asset(self, asset_id):
        return {"asset_id": AID, "asset_type": "FUND", "identity": {"name": "FONDO TRAMO", "currency": "EUR"},
                "quality": {"status": "OK"}}

    def get_price_series(self, asset_id):
        por_anio = {}
        for dia, valor in self.puntos:
            por_anio.setdefault(dia.year, []).append({"date": dia.isoformat(), "value": valor})
        return [{
            "schema_version": "asset-price-series.v1.2", "asset_id": AID, "asset_type": "FUND", "series_type": "NAV",
            "source": "EODHD", "currency": "EUR", "interval": "1d", "year": anio, "points": pts,
            "first_date": pts[0]["date"], "last_date": pts[-1]["date"], "observations_count": len(pts),
            "history_quality_status": "COMPLETE",
        } for anio, pts in sorted(por_anio.items())]


def _simula(puntos, period="3Y"):
    return backtest_portfolio(_Lector(puntos), {"positions": [{"asset_id": AID, "weight": 1.0}],
                                                "period": period, "frequency": "DAILY"},
                              risk_free_resolver=resolver)


def _dias_habiles_planos(inicio, fin, final):
    """100 cada dia habil de inicio a fin, y `final` el ultimo dia: un solo salto."""
    puntos, dia = [], inicio
    while dia <= fin:
        if dia.weekday() < 5:
            puntos.append((dia, 100.0))
        dia += timedelta(days=1)
    puntos[-1] = (puntos[-1][0], final)
    return puntos


def _vol_de_un_salto(r, n):
    """Volatilidad anualizada de n retornos semanales: n-1 ceros y uno r.

    media = r/n; suma de cuadrados = r^2 (n-1)/n; varianza muestral = r^2/n;
    desviacion = r/raiz(n); anualizada por raiz(52)."""
    return r / math.sqrt(n) * math.sqrt(52)


# --- El caso del encargo: +6 % en 119 dias -----------------------------------------------

def _tramo_de_17_semanas():
    """Un viernes por semana, 17 semanas (119 dias): 100, 104, 102 x 15, 106."""
    viernes0 = date(2026, 6, 5)  # viernes
    valores = [100.0, 104.0] + [102.0] * 15 + [106.0]
    return [(viernes0 + timedelta(days=7 * i), v) for i, v in enumerate(valores)]


def test_un_6_por_ciento_en_119_dias_no_se_publica_como_anual():
    puntos = _tramo_de_17_semanas()
    assert (puntos[-1][0] - puntos[0][0]).days == 119
    resp = _simula(puntos)
    m = resp["metrics"]

    # Lo que se publicaba antes: 1,06^(365,2425/119) - 1 = 19,58 % «anual». Ya no.
    assert m["cagr"] is None
    assert m["sharpe"] is None
    assert m["annualized"] is False
    assert AVISO in resp["warnings"]

    # Rentabilidad del periodo: 106/100 - 1 = 0,06, con sus dias y fechas.
    assert m["cumulative_return"] == pytest.approx(0.06, abs=1e-12)
    assert m["period_days"] == 119
    assert m["period_start"] == "2026-06-05"
    assert m["period_end"] == "2026-10-02"

    # Volatilidad: 17 retornos semanales: +0,04; 102/104-1; catorce ceros; 106/102-1.
    r = [0.04, 102 / 104 - 1] + [0.0] * 14 + [106 / 102 - 1]
    media = sum(r) / 17
    varianza = sum((x - media) ** 2 for x in r) / 16
    assert m["volatility"] == pytest.approx(math.sqrt(varianza) * math.sqrt(52), abs=1e-9)
    # Caida maxima: de 104 a 102.
    assert m["max_drawdown"] == pytest.approx(102 / 104 - 1, abs=1e-9)
    assert m["rf_rate"] == RF


# --- El borde: 329 dias no anualiza, 330 si ------------------------------------------------

LUNES = date(2025, 1, 6)


def test_el_umbral_es_el_de_la_maestra():
    assert MIN_ANNUALIZATION_DAYS == 330


def test_329_dias_no_anualiza():
    fin = LUNES + timedelta(days=329)  # lunes
    resp = _simula(_dias_habiles_planos(LUNES, fin, 110.0))
    m = resp["metrics"]
    assert m["period_days"] == 329
    assert m["annualized"] is False
    assert m["cagr"] is None and m["sharpe"] is None
    assert m["cumulative_return"] == pytest.approx(0.10, abs=1e-12)
    assert AVISO in resp["warnings"]
    # 48 semanas ISO, 47 retornos: 46 ceros y +10 %. La volatilidad se sigue publicando.
    assert m["volatility"] == pytest.approx(_vol_de_un_salto(0.10, 47), abs=1e-9)
    assert m["max_drawdown"] == 0.0


def test_330_dias_si_anualiza():
    fin = LUNES + timedelta(days=330)  # martes
    resp = _simula(_dias_habiles_planos(LUNES, fin, 110.0))
    m = resp["metrics"]
    assert m["period_days"] == 330
    assert m["annualized"] is True
    assert AVISO not in resp["warnings"]
    cagr = 1.10 ** (DIAS_ANIO / 330) - 1  # 11,12 %
    vol = _vol_de_un_salto(0.10, 47)      # el martes cierra la semana 48: 47 retornos
    assert m["cumulative_return"] == pytest.approx(0.10, abs=1e-12)
    assert m["cagr"] == pytest.approx(cagr, abs=1e-12)
    assert m["volatility"] == pytest.approx(vol, abs=1e-9)
    assert m["sharpe"] == pytest.approx((cagr - RF) / vol, abs=1e-9)


# --- Un tramo largo: nada cambia ---------------------------------------------------------

def test_tres_anos_publican_lo_mismo_que_antes():
    fin = LUNES + timedelta(days=1092)  # 156 semanas: lunes
    resp = _simula(_dias_habiles_planos(LUNES, fin, 133.1))
    m = resp["metrics"]
    # 133,1/100 = 1,1^3. CAGR por fechas, el de siempre: 1,331^(365,2425/1092) - 1 = 10,04 %.
    cagr = 1.331 ** (DIAS_ANIO / 1092) - 1
    vol = _vol_de_un_salto(0.331, 156)  # 157 semanas ISO, 156 retornos
    assert m["annualized"] is True
    assert m["period_days"] == 1092
    assert m["cumulative_return"] == pytest.approx(0.331, abs=1e-12)
    assert m["cagr"] == pytest.approx(cagr, abs=1e-12)
    assert m["volatility"] == pytest.approx(vol, abs=1e-9)
    assert m["sharpe"] == pytest.approx((cagr - RF) / vol, abs=1e-9)
    assert m["max_drawdown"] == 0.0
    assert AVISO not in resp["warnings"]
