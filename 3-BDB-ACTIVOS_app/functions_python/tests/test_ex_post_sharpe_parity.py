# -*- coding: utf-8 -*-
"""Decision 6.3 de Oscar (17-10-2026): un solo Sharpe ex post, (CAGR - rf) / sigma.

La misma serie en la misma ventana, con la misma tasa sin riesgo, da en la simulacion historica
diaria (backtest_portfolio) el Sharpe que sale de la cuenta a mano: CAGR por fechas, volatilidad
muestral de los retornos semanales (ultima observacion de cada semana ISO) x raiz(52), y
`ex_post_sharpe`. La otra pata era metrics/latest de la maestra vieja (`ingest_asset.build_metrics_latest`,
el estimador `GEOMETRIC_CAGR` / `WEEKLY`), borrada el 21-11-2026 con ella (decision 37 del censo
CENSO_BASE_VIEJA_2026-11-21.md; etiqueta referencia-base-vieja-2026-11-21). El Sharpe del optimizador es otro (el «Sharpe del modelo», sobre la
media aritmetica esperada) y no entra aqui. La tercera pata era la cartera real del motor
`portfolio_real/`, borrado el 17-11-2026 (decision A-188); su paridad, y la del respaldo con
el €STR capitalizado (B-70), estan en la etiqueta de Git `referencia-portfolio-real-2026-11-17`.

Ejecuta: pytest functions_python/tests/test_ex_post_sharpe_parity.py
"""
from datetime import date, timedelta
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import _clear_price_series_cache, backtest_portfolio  # noqa: E402
from weekly_sampling import DAYS_PER_YEAR, ex_post_sharpe, sample_volatility  # noqa: E402

AID = "LU0000000PAR"
NAME = "FONDO PARIDAD"
LAST = date(2026, 10, 15)          # jueves
FIRST = LAST - timedelta(days=365 * 3)  # 2023-10-16, lunes: la ventana 3y exacta
RF = 0.021


def resolver(start, end):
    return {"rate": RF, "coverage_ratio": 1.0}


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def _series(seed, drift=0.0003, vol=0.008):
    rng = np.random.default_rng(seed)
    points, value, day = [], 100.0, FIRST
    while day <= LAST:
        if day.weekday() < 5:
            points.append((day, round(value, 6)))
            value *= 1.0 + drift + rng.normal(0.0, vol)
        day += timedelta(days=1)
    return points


def _volatilidad_semanal(points):
    """A mano: ultima observacion de cada semana ISO, retornos consecutivos, muestral x raiz(52)."""
    weekly = {}
    for day, value in points:
        iso = day.isocalendar()
        weekly[(iso.year, iso.week)] = value
    levels = list(weekly.values())
    returns = [b / a - 1.0 for a, b in zip(levels, levels[1:])]
    return sample_volatility(returns, 52)


class _Reader:
    def __init__(self, points):
        self.points = points

    def get_asset(self, asset_id):
        return {"asset_id": AID, "asset_type": "FUND", "identity": {"name": NAME, "currency": "EUR"},
                "quality": {"status": "OK"}}

    def get_price_series(self, asset_id):
        by_year = {}
        for day, value in self.points:
            by_year.setdefault(day.year, []).append({"date": day.isoformat(), "value": value})
        return [{
            "schema_version": "asset-price-series.v1.2", "asset_id": AID, "asset_type": "FUND", "series_type": "NAV",
            "source": "EODHD", "currency": "EUR", "interval": "1d", "year": year, "points": pts,
            "first_date": pts[0]["date"], "last_date": pts[-1]["date"], "observations_count": len(pts),
            "history_quality_status": "COMPLETE",
        } for year, pts in sorted(by_year.items())]


def _backtest(points):
    return backtest_portfolio(_Reader(points), {"positions": [{"asset_id": AID, "weight": 1.0}],
                                                "period": "3Y", "frequency": "DAILY"},
                              risk_free_resolver=resolver)["metrics"]


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_el_sharpe_ex_post_del_backtest_es_el_de_la_cuenta_a_mano(seed):
    points = _series(seed)
    backtest = _backtest(points)
    assert backtest["rf_rate"] == RF

    # Rentabilidad anualizada por fechas (365,2425) y volatilidad semanal.
    cagr = (points[-1][1] / points[0][1]) ** (DAYS_PER_YEAR / (LAST - FIRST).days) - 1.0
    volatilidad = _volatilidad_semanal(points)
    assert backtest["cagr"] == pytest.approx(cagr, abs=1e-6)
    assert backtest["volatility"] == pytest.approx(volatilidad, abs=1e-6)

    expected = ex_post_sharpe(cagr, RF, volatilidad)
    assert backtest["sharpe"] == pytest.approx(expected, abs=1e-4)


def test_ex_post_sharpe_y_sus_bordes():
    assert ex_post_sharpe(0.08, 0.02, 0.12) == pytest.approx(0.5)
    assert ex_post_sharpe(0.01, 0.02, 0.10) == pytest.approx(-0.1)
    for missing in [(None, 0.02, 0.1), (0.08, None, 0.1), (0.08, 0.02, None), (0.08, 0.02, 0.0),
                    (float("nan"), 0.02, 0.1), (0.08, 0.02, float("inf"))]:
        assert ex_post_sharpe(*missing) is None
        assert ex_post_sharpe(*missing, default=0.0) == 0.0


def test_la_volatilidad_del_backtest_es_la_muestral_semanal():
    points = _series(5)
    backtest = _backtest(points)
    assert backtest["volatility"] == pytest.approx(_volatilidad_semanal(points), abs=1e-6)
    assert math.isfinite(backtest["sharpe"])
