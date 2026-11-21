# -*- coding: utf-8 -*-
"""Quinta pasada (revision del 6.3), I-3: un solo Sortino ex post, alineado con el Sharpe.

Sortino = (CAGR - rf) / DD, con la misma rf que el Sharpe y
DD = raiz(media(min(0, r_s - rf_s)^2)) x raiz(52), rf_s = (1 + rf)^(1/52) - 1, minimo 26
semanas. Es la definicion de `sortinoRatio` (src/core/portfolioExtendedAnalytics.ts); el
fixture `fixtures/sortino_parity.json` lo comprueban este test y
tests/sortinoParity.test.ts con el mismo valor esperado.

Antes, la cartera real usaba la media aritmetica del exceso semanal frente a XEON x 52, y
con el Sharpe nuevo (CAGR geometrico - €STR) los dos podian salir con signo contrario. Las
pruebas de la cartera real (su Sortino del fixture y el signo en las semillas 1-43) iban
contra el motor `portfolio_real/`, borrado el 17-11-2026 (decision A-188): estan en la
etiqueta de Git `referencia-portfolio-real-2026-11-17`.

Ejecuta: pytest functions_python/tests/test_ex_post_sortino_parity.py
"""
from datetime import date
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from weekly_sampling import (  # noqa: E402
    SORTINO_MIN_WEEKLY_RETURNS,
    ex_post_sortino,
    weekly_last_observations,
    weekly_returns,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sortino_parity.json")


def _load_fixture():
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)


def test_el_sortino_del_fixture_es_el_de_sortinoRatio():
    fixture = _load_fixture()
    points = [(date.fromisoformat(item["date"]), float(item["value"])) for item in fixture["series"]]
    returns, _dates, bridged = weekly_returns(weekly_last_observations(points))
    assert not bridged, "el fixture no tiene huecos: sortinoRatio no puentea semanas"
    assert len(returns) == fixture["weekly_returns"]
    value = ex_post_sortino(fixture["annual_return"], fixture["risk_free_rate"], list(returns.values()))
    assert value == pytest.approx(fixture["expected_sortino"], abs=1e-12)


def test_ex_post_sortino_y_sus_bordes():
    weeks = [0.01, -0.02, 0.015, -0.005] * 7  # 28 semanas
    assert len(weeks) >= SORTINO_MIN_WEEKLY_RETURNS
    weekly_rf = (1.02) ** (1 / 52) - 1
    downside = (sum(min(0.0, r - weekly_rf) ** 2 for r in weeks) / len(weeks)) ** 0.5 * 52 ** 0.5
    assert ex_post_sortino(0.08, 0.02, weeks) == pytest.approx((0.08 - 0.02) / downside)
    # Menos de 26 semanas, datos que faltan o no finitos, ninguna semana bajo la rf.
    assert ex_post_sortino(0.08, 0.02, weeks[:25]) is None
    assert ex_post_sortino(None, 0.02, weeks) is None
    assert ex_post_sortino(0.08, None, weeks) is None
    assert ex_post_sortino(float("nan"), 0.02, weeks) is None
    assert ex_post_sortino(0.08, 0.02, [0.01] * 30) is None
    assert ex_post_sortino(0.08, -1.0, weeks) is None
    assert ex_post_sortino(0.08, 0.02, weeks[:25], default=0.0) == 0.0
    # Los None de semanas sin medir no cuentan.
    assert ex_post_sortino(0.08, 0.02, weeks + [None]) == pytest.approx(ex_post_sortino(0.08, 0.02, weeks))
