"""El tope de la simulacion de 3 y 5 anos y la frontera por encima de 40 activos (10-11-2026).

- Hasta 40 activos medidos, la respuesta es la de siempre: con frontera y sin aportacion al riesgo aparte.
- Por encima, sin frontera y diciendo por que, pero con la aportacion al riesgo, que es la misma que daria la
  frontera con esos retornos (misma covarianza).
- main.py y portfolio_horizon.py dicen el mismo tope.
"""
from datetime import date, timedelta
import math
from pathlib import Path
import re
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import portfolio_horizon as h  # noqa: E402
from optimization.repository import _clear_price_series_cache, _risk_contribution_contract  # noqa: E402
from optimization.robust_engine import solve  # noqa: E402

HOY = date(2026, 9, 6)


class Lector:
    """N activos con series deterministas y distintas entre si, desde 2019."""

    def __init__(self, n):
        self.ids = ["A%03d" % i for i in range(n)]
        self.puntos = {}
        for k, aid in enumerate(self.ids):
            d = date(2019, 1, 1)
            valores = {}
            i = 0
            while d <= date(2026, 9, 4):
                if d.weekday() < 5:
                    valores[d.isoformat()] = 100 * math.exp(i * .0001 * (1 + k % 7) + .02 * math.sin(i / (5 + k % 11)) + .01 * math.cos(i / (3 + k % 5)))
                    i += 1
                d += timedelta(days=1)
            self.puntos[aid] = valores

    def get_asset(self, aid):
        return {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"}}

    def get_price_series(self, aid):
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "interval": "1d",
                 "points": [{"date": d, "value": v} for d, v in self.puntos[aid].items()]}]


@pytest.fixture(autouse=True)
def cache_limpia():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def _simular(n, window="3Y"):
    lector = Lector(n)
    posiciones = [{"asset_id": a, "weight": 1 / n} for a in lector.ids]
    return h.analyze_horizon(lector, {"window": window, "positions": posiciones}, today=HOY)


def test_hasta_40_activos_la_respuesta_es_la_de_siempre():
    r = _simular(h.MAX_ACTIVOS_FRONTERA)
    assert r["frontier"] is not None and r["max_sharpe"] is not None
    assert r["frontier_unavailable_reason"] is None
    assert r["frontier"]["risk_contributions"]
    # Ninguna clave nueva: la respuesta de 40 o menos tiene las mismas que antes del 10-11-2026.
    assert set(r) == {"schema_version", "window", "horizon_years", "reference_version", "backtest", "frontier",
                      "frontier_unavailable_reason", "equal_weight", "max_sharpe", "coverage_weight_percent",
                      "extensions", "methodology"}


@pytest.mark.parametrize("window", ["3Y", "5Y"])
def test_por_encima_de_40_no_hay_frontera_y_se_dice_por_que(window):
    n = h.MAX_ACTIVOS_FRONTERA + 7
    r = _simular(n, window)
    assert r["frontier"] is None and r["max_sharpe"] is None
    motivo = r["frontier_unavailable_reason"]
    assert f"{h.MAX_ACTIVOS_FRONTERA} activos como máximo" in motivo and f"tiene {n} medidos" in motivo
    semanas = len(r["backtest"]["portfolio_series"])  # diario; las semanas se cuentan en el motivo
    assert semanas > 0 and re.search(r"con \d+ semanas", motivo)
    # Las metricas son de la cartera entera.
    assert len(r["backtest"]["asset_ids"]) == n
    assert all(math.isfinite(r["backtest"]["metrics"][k]) for k in ("cagr", "volatility", "max_drawdown"))


def test_la_aportacion_al_riesgo_sin_frontera_es_la_que_daria_la_frontera():
    n = h.MAX_ACTIVOS_FRONTERA + 5
    r = _simular(n)
    filas, meta = r["risk_contributions"], r["risk_contributions_meta"]
    assert [f["asset_id"] for f in filas] == r["backtest"]["asset_ids"]
    assert sum(f["weight_pct"] for f in filas) == pytest.approx(100)
    assert sum(f["risk_pct"] for f in filas) == pytest.approx(100)
    # La misma cuenta que el camino con frontera: la covarianza que `solve` usa por dentro con estos retornos.
    lector = Lector(n)
    loaded, excluded = h._load_horizon_prices(lector, {a: 1 / n for a in lector.ids})
    periodo = h._periodo_comun(loaded, excluded, "3Y", h.references(), HOY)
    retornos = h.retornos_semanales(periodo.matrix, periodo.week_indices)
    pesos = {a: 1 / n for a in periodo.ids}
    motor = solve(periodo.ids, retornos.tolist(), current_weights=pesos, frontier_points=h.PUNTOS_DE_LA_FRONTERA, risk_free_rate=.0193)
    esperadas, meta_esperada = _risk_contribution_contract(
        periodo.ids, [pesos[a] for a in periodo.ids], motor["covariance_matrix"], motor["covariance_meta"]["covariance_estimator"])
    assert meta == meta_esperada
    for fila, esperada in zip(filas, esperadas):
        assert fila["asset_id"] == esperada["asset_id"]
        assert fila["risk_pct"] == pytest.approx(esperada["risk_pct"], abs=1e-9)


def test_el_tope_de_la_simulacion_admite_su_numero_y_rechaza_el_siguiente():
    with pytest.raises(h.InvalidOptimizationRequest, match=f"entre 1 y {h.MAX_POSICIONES_SIMULACION}"):
        h.analyze_horizon(Lector(1), {"window": "3Y", "positions": [{"asset_id": "A000", "weight": 1}] * (h.MAX_POSICIONES_SIMULACION + 1)})


def test_main_y_la_simulacion_dicen_el_mismo_tope():
    main = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^CAP_SIMULATION_POSITIONS = (\d+)$", main, re.M).group(1) == str(h.MAX_POSICIONES_SIMULACION)
    assert re.search(r"^CAP_OPTIMIZE_ASSETS = (\d+)$", main, re.M).group(1) == str(h.MAX_ACTIVOS_FRONTERA)
    assert '_cap_list(req.data, "positions", CAP_SIMULATION_POSITIONS if bundle else CAP_SERIES_ASSETS, "posiciones")' in main
    # El mensaje del tope lleva cuantas llegan: la pantalla lo lee (src/core/appError.ts).
    assert '"Maximo %d %s por peticion; llegan %d." % (cap, label, len(items))' in main
