# -*- coding: utf-8 -*-
"""Decision 6.3 de Oscar (17-10-2026): un solo Sharpe ex post, (CAGR - rf) / sigma.

La misma serie en la misma ventana, con la misma tasa sin riesgo, da el mismo Sharpe en
la simulacion historica diaria (backtest_portfolio) y en metrics/latest de la maestra
(build_metrics_latest). El Sharpe del optimizador es otro (el «Sharpe del modelo», sobre la
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

import ingest_asset  # noqa: E402
from optimization.repository import _clear_price_series_cache, backtest_portfolio  # noqa: E402
from weekly_sampling import DAYS_PER_YEAR, ex_post_sharpe, sample_volatility  # noqa: E402

AID = "LU0000000PAR"
NAME = "FONDO PARIDAD"
LAST = date(2026, 10, 15)          # jueves
FIRST = LAST - timedelta(days=365 * 3)  # 2023-10-16, lunes: la ventana 3y exacta de la maestra
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


def _master_sharpe(points):
    metrics = ingest_asset.build_metrics_latest(
        AID, "FUND", [{"date": d.isoformat(), "value": v} for d, v in points], "2026-10-16T08:00:00+00:00",
        risk_free_resolver=resolver,
    )
    return metrics["windows"]["3y"]


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
def test_mismo_sharpe_ex_post_en_backtest_y_maestra(seed):
    points = _series(seed)
    master = _master_sharpe(points)
    backtest = _backtest(points)
    assert master["risk_free_rate"] == RF and backtest["rf_rate"] == RF

    # Misma rentabilidad anualizada por fechas (365,2425) y misma volatilidad semanal.
    cagr = (points[-1][1] / points[0][1]) ** (DAYS_PER_YEAR / (LAST - FIRST).days) - 1.0
    assert master["annualized_return"] == pytest.approx(cagr, abs=1e-8)
    assert backtest["cagr"] == pytest.approx(cagr, abs=1e-6)
    assert backtest["volatility"] == pytest.approx(master["annualized_volatility"], abs=1e-6)

    expected = ex_post_sharpe(cagr, RF, master["annualized_volatility"])
    assert master["sharpe_ratio"] == pytest.approx(expected, abs=1e-6)
    assert backtest["sharpe"] == pytest.approx(expected, abs=1e-4)


def test_ex_post_sharpe_y_sus_bordes():
    assert ex_post_sharpe(0.08, 0.02, 0.12) == pytest.approx(0.5)
    assert ex_post_sharpe(0.01, 0.02, 0.10) == pytest.approx(-0.1)
    for missing in [(None, 0.02, 0.1), (0.08, None, 0.1), (0.08, 0.02, None), (0.08, 0.02, 0.0),
                    (float("nan"), 0.02, 0.1), (0.08, 0.02, float("inf"))]:
        assert ex_post_sharpe(*missing) is None
        assert ex_post_sharpe(*missing, default=0.0) == 0.0


def test_la_volatilidad_de_la_paridad_es_la_muestral_semanal():
    points = _series(5)
    weekly = {}
    for day, value in points:
        iso = day.isocalendar()
        weekly[(iso.year, iso.week)] = value
    levels = list(weekly.values())
    returns = [b / a - 1.0 for a, b in zip(levels, levels[1:])]
    assert _master_sharpe(points)["annualized_volatility"] == pytest.approx(sample_volatility(returns, 52), abs=1e-8)
    assert math.isfinite(_backtest(points)["sharpe"])
