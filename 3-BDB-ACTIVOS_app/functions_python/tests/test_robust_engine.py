# -*- coding: utf-8 -*-
"""Bateria degenerada para robust_engine (motor v2). Modulo puro; requiere numpy + pypfopt."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from optimization import robust_engine as re  # noqa: E402


def _universe(seed=1, nrf=4, nrv=11, weeks=160, dups=0, drift=True):
    rng = np.random.default_rng(seed)
    fac = rng.normal(0, 0.02, (weeks, 1))
    cols = {}
    for i in range(nrf):
        cols["RF%02d" % i] = rng.normal(0.0007, 0.004, weeks) + fac[:, 0] * rng.uniform(0.05, 0.2)
    for i in range(nrv):
        d = rng.uniform(0.0006, 0.0018) if drift else 0.0
        cols["RV%02d" % i] = fac[:, 0] * rng.uniform(0.7, 1.4) + rng.normal(d, 0.02, weeks)
    for i in range(dups):
        cols["DUP%d" % i] = cols["RV%02d" % i] + rng.normal(0, 1e-4, weeks)
    ids = list(cols)
    return ids, np.column_stack([cols[k] for k in ids]).tolist()


def test_smoke_two_assets():
    ids, M = _universe(nrf=1, nrv=1)
    r = re.solve(ids, M, risk_slider=5)
    assert r["frontier"]
    w = r["target_portfolio"]["weights"]
    assert abs(sum(w.values()) - 1.0) < 1e-6


def test_collinearity_positive_definite():
    ids, M = _universe(dups=3)
    r = re.solve(ids, M, risk_slider=5)
    assert r["diagnostics"]["min_eigenvalue"] > 0
    assert r["diagnostics"]["N"] == len(ids)


def test_all_returns_below_rf_fallback():
    ids, M = _universe(drift=False)
    r = re.solve(ids, M, risk_slider=5, risk_free_rate=0.019)
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" in r["warnings"]
    assert r["max_sharpe_portfolio"] is not None


def test_frontier_percentile_monotone_no_clip():
    ids, M = _universe(seed=5)
    vols = []
    for sl in range(1, 11):
        r = re.solve(ids, M, risk_slider=sl)
        vols.append(r["target_portfolio"]["volatility"])
        assert not any(w.startswith("TARGET_ABSOLUTE_VOL_CLIPPED") for w in r["warnings"])
    for a, b in zip(vols, vols[1:]):
        assert b >= a - 1e-9  # no decreciente


def test_absolute_vol_clips():
    ids, M = _universe(seed=5)
    lo = re.solve(ids, M, risk_target_mode="ABSOLUTE_VOL", target_volatility=0.002)
    hi = re.solve(ids, M, risk_target_mode="ABSOLUTE_VOL", target_volatility=0.40)
    assert "TARGET_ABSOLUTE_VOL_CLIPPED_LOW" in lo["warnings"]
    assert "TARGET_ABSOLUTE_VOL_CLIPPED_HIGH" in hi["warnings"]


def test_dominance_monotone_frontier():
    ids, M = _universe(seed=7)
    fr = re.solve(ids, M, risk_slider=5)["frontier"]
    for a, b in zip(fr, fr[1:]):
        assert b["expected_return"] >= a["expected_return"] - 1e-9  # no dominados


def test_determinism():
    ids, M = _universe(seed=3)
    a = re.solve(ids, M, risk_slider=6)["target_portfolio"]["volatility"]
    b = re.solve(ids, M, risk_slider=6)["target_portfolio"]["volatility"]
    assert abs(a - b) < 1e-12


def test_diagnostics_and_methodology_present():
    ids, M = _universe(seed=2)
    r = re.solve(ids, M, risk_slider=5)
    for k in ("covariance_estimator", "T_over_N", "condition_number", "min_eigenvalue",
              "return_signal_status", "frontier_min_volatility", "frontier_max_volatility",
              "effective_number_of_positions", "hhi", "realized_volatility"):
        assert k in r["diagnostics"], k
    for k in ("optimizer", "covariance_estimator", "expected_return_model", "target_risk_mode",
              "frontier_percentile", "weight_bounds"):
        assert k in r["methodology_extra"], k


def test_risk_only_mode_runs():
    ids, M = _universe(seed=4)
    r = re.solve(ids, M, risk_slider=5, return_mode="RISK_ONLY")
    assert r["methodology_extra"]["return_estimator"] == "RISK_ONLY"
    assert r["target_portfolio"] is not None


def test_forty_asset_frontier_is_finite_and_fully_invested():
    ids, matrix = _universe(seed=19, nrf=10, nrv=30, weeks=160)
    result = re.solve(ids, matrix, risk_slider=5)
    assert result["diagnostics"]["N"] == 40
    assert len(result["frontier"]) >= 2
    for point in [*result["frontier"], result["target_portfolio"], result["min_volatility_portfolio"], result["max_sharpe_portfolio"]]:
        assert np.isfinite(point["volatility"]) and point["volatility"] >= 0
        assert np.isfinite(point["expected_return"])
        # clean_weights serializa a cinco decimales: tolerancia acumulada por 40 activos.
        assert abs(sum(point["weights"].values()) - 1) <= len(ids) * 0.000005 + 1e-9
        assert all(weight >= -1e-8 for weight in point["weights"].values())


def test_turnover_limit_bounds_the_distance_to_current_weights():
    ids, M = _universe(seed=7, nrf=3, nrv=6)
    current = {a: 1.0 / len(ids) for a in ids}
    free = re.solve(ids, M, risk_slider=8, current_weights=current)
    capped = re.solve(ids, M, risk_slider=8, current_weights=current, max_turnover=0.20)
    distance = lambda w: sum(abs(w.get(a, 0.0) - current[a]) for a in ids)  # noqa: E731
    assert distance(capped["target_portfolio"]["weights"]) <= 0.20 + 1e-6
    assert distance(capped["max_sharpe_portfolio"]["weights"]) <= 0.20 + 1e-6
    assert all(distance(p["weights"]) <= 0.20 + 1e-6 for p in capped["frontier"])
    assert capped["methodology_extra"]["max_turnover"] == 0.2
    assert capped["methodology_extra"]["optimizer"] == "QP"
    assert capped["diagnostics"]["realized_turnover"] <= 0.20 + 1e-6
    assert distance(free["target_portfolio"]["weights"]) >= distance(capped["target_portfolio"]["weights"]) - 1e-9


def _correlated_returns(seed, mus, vols, weeks=156, rho=0.3):
    """Retornos semanales con medias y volatilidades ANUALES dadas y correlacion comun."""
    rng = np.random.default_rng(seed)
    n = len(mus)
    corr = np.full((n, n), rho) + np.eye(n) * (1 - rho)
    sd = np.array(vols) / np.sqrt(52)
    return rng.multivariate_normal(np.array(mus) / 52, np.outer(sd, sd) * corr, size=weeks).tolist()


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_max_sharpe_reference_respects_the_turnover_cap_when_excess_return_is_high(seed):
    # Auditoria 16-11-2026 (OPT-1). Con mucho exceso de rentabilidad el problema transformado de `max_sharpe` SI se
    # resolvia, con la rotacion mal escrita (norm1(w - w0/k) en vez de norm1(w - w0)): con 79/20/1 y un tope del 45 %
    # del patrimonio (0,90) salian 15,4/84,6/0, 12,0/29,0/59,0 y 14,9/0/85,1, que mueven el 64,6 %, el 67,0 % y el
    # 84,1 %, dos de las tres sin ningun aviso. El caso anterior (test_turnover_limit_...) pasaba porque alli salia
    # infactible y se tomaba el punto de la frontera.
    ids = ["A", "B", "C"]
    current = {"A": 0.79, "B": 0.20, "C": 0.01}
    M = _correlated_returns(seed, [0.10, 0.15, 0.30], [0.20, 0.18, 0.15])
    r = re.solve(ids, M, objective="TARGET_RISK", current_weights=current, max_turnover=0.90,
                 risk_free_rate=0.02, max_weight=1.0)
    distance = lambda w: sum(abs(w.get(a, 0.0) - current[a]) for a in ids)  # noqa: E731
    assert distance(r["max_sharpe_portfolio"]["weights"]) <= 0.90 + 1e-4
    assert distance(r["min_volatility_portfolio"]["weights"]) <= 0.90 + 1e-4
    assert distance(r["target_portfolio"]["weights"]) <= 0.90 + 1e-4
    assert all(distance(p["weights"]) <= 0.90 + 1e-4 for p in r["frontier"])
    # Sale de la frontera y lo dice: es el mejor punto de los calculados, no el optimo exacto.
    assert "MAX_SHARPE_FROM_FRONTIER" in r["warnings"]
    best = max(r["frontier"], key=lambda p: p["sharpe_ratio"])
    assert r["max_sharpe_portfolio"]["weights"] == best["weights"]


def test_turnover_requires_current_weights_and_a_valid_cap():
    import pytest
    ids, M = _universe(seed=3, nrf=2, nrv=4)
    with pytest.raises(re.WeightConstraintError):
        re.solve(ids, M, risk_slider=5, max_turnover=0.3)
    with pytest.raises(re.WeightConstraintError):
        re.solve(ids, M, risk_slider=5, current_weights={a: 1.0 / len(ids) for a in ids}, max_turnover=3.0)


# --- CRIT-02 (auditoria 16-10-2026): frontera sobre el rango FACTIBLE ---------------------

def _drift_matrix(drifts, seed, noise=0.15, weeks=156):
    """Seis activos con deriva semanal fija y ruido proporcional (caso reproducido)."""
    rng = np.random.default_rng(seed)
    vols = np.array([0.01, 0.015, 0.02, 0.025, 0.03, 0.035])[:len(drifts)]
    return (np.array(drifts)[None, :] + rng.normal(0, 1, (weeks, len(drifts))) * vols * noise).tolist()


def _feasible_max_return(ids, M, bounds):
    import pandas as pd
    from pypfopt import EfficientFrontier
    mu, _ = re.estimate_returns(M)
    S, _ = re.estimate_covariance(M, ids)
    return float(EfficientFrontier(pd.Series(mu, index=ids), S, weight_bounds=bounds)._max_return())


def _distinct_returns(frontier):
    return len({round(p["expected_return"], 6) for p in frontier})


def test_qp_frontier_reaches_feasible_max_with_locks():
    # Candado A0=30 % y tope dinamico 0,35 (< 1): mu.max()*0.999 no es alcanzable y la
    # frontera antigua se quedaba en 0,0935 con 6 puntos distintos de 8.
    ids = [f"A{i}" for i in range(6)]
    M = _drift_matrix([0.0005, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030], seed=1)
    r = re.solve(ids, M, risk_slider=10, locked_weights={"A0": 0.30})
    hi = _feasible_max_return(ids, M, [(0.30, 0.30)] + [(0.0, 0.35)] * 5)
    frontier = r["frontier"]
    assert r["methodology_extra"]["optimizer"] == "QP"
    assert max(p["expected_return"] for p in frontier) >= hi - 1e-4
    assert _distinct_returns(frontier) >= 15 - 1
    assert r["target_portfolio"]["expected_return"] >= hi - 1e-4  # slider 10 = maximo factible
    assert r["max_sharpe_portfolio"]["weights"] != r["min_volatility_portfolio"]["weights"]
    for p in frontier:
        assert abs(p["weights"]["A0"] - 0.30) < 1e-9


def test_all_returns_negative_frontier_reaches_max_and_sharpe_reference_is_min_vol():
    # mu.max() < 0: el fallback antiguo pedia efficient_return(mu.max()*0.999), que queda por
    # encima de mu.max() y fallaba siempre. Con el Sharpe negativo en toda la frontera, su
    # maximo es el punto de mas volatilidad; la referencia sigue siendo la minima volatilidad.
    ids = [f"A{i}" for i in range(6)]
    M = _drift_matrix([-0.0030, -0.0025, -0.0020, -0.0015, -0.0012, -0.0010], seed=2)
    mu, _ = re.estimate_returns(M)
    assert float(np.max(mu)) < 0
    r = re.solve(ids, M, risk_slider=10, locked_weights={"A0": 0.10})
    frontier = r["frontier"]
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" in r["warnings"]
    assert r["max_sharpe_portfolio"]["weights"] == r["min_volatility_portfolio"]["weights"]
    hi = _feasible_max_return(ids, M, [(0.10, 0.10)] + [(0.0, 0.35)] * 5)
    assert max(p["expected_return"] for p in frontier) >= hi - 1e-4
    assert _distinct_returns(frontier) >= 15 - 1


def _review_universe(n, seed, weeks=156, drift=0.0015):
    """Universo de la segunda pasada (review1016/crit02_guard.py)."""
    rng = np.random.default_rng(seed)
    vols = rng.uniform(0.01, 0.035, n)
    means = drift + rng.normal(0, 0.0012, n)
    base = rng.normal(0, 1, (weeks, 1))
    idio = rng.normal(0, 1, (weeks, n))
    R = means + vols * (0.6 * base + 0.8 * idio)
    return [f"A{i}" for i in range(n)], R.tolist()


@pytest.mark.parametrize("n, optimizer, feasible_max", [(5, "CLA", 0.0011), (10, "QP", 0.0156)])
def test_feasible_max_below_rf_keeps_min_vol_even_if_some_mu_beats_rf(n, optimizer, feasible_max):
    # Segunda pasada (17-10-2026): un activo supera rf (mu.max ~0,03-0,04) pero el tope dinamico
    # deja el retorno maximo FACTIBLE por debajo (0,0011 y 0,0156 frente a rf 0,0193). Todos
    # los Sharpe de la frontera son negativos: el Max. Sharpe no puede ser el punto de mas
    # volatilidad, que es lo que elegia la guarda sobre mu.max().
    rf = 0.0193
    ids, R = _review_universe(n, 1)
    mu, _ = re.estimate_returns(R)
    assert float(np.max(mu)) > rf
    r = re.solve(ids, R, risk_slider=5, frontier_points=12, risk_free_rate=rf)
    frontier = r["frontier"]
    assert r["methodology_extra"]["optimizer"] == optimizer
    assert max(p["expected_return"] for p in frontier) == pytest.approx(feasible_max, abs=5e-4)
    assert max(p["expected_return"] for p in frontier) < rf
    assert all(p["sharpe_ratio"] < 0 for p in frontier)
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" in r["warnings"]
    assert r["max_sharpe_portfolio"]["weights"] == r["min_volatility_portfolio"]["weights"]
    assert r["max_sharpe_portfolio"]["volatility"] < frontier[-1]["volatility"]


@pytest.mark.parametrize("n, lock", [(10, 0.10), (6, 0.15)])
def test_min_volatility_with_a_lock_retries_with_clarabel(n, lock):
    # Tercera pasada (17-10-2026): en estos dos casos (de 54 con un candado del 5-15 %) OSQP
    # se sale de las cotas en la minima volatilidad, bounded_weights lanzaba RuntimeError y
    # el cliente recibia INTERNAL. Ahora se reintenta con CLARABEL.
    ids, R = _review_universe(n, 0)
    r = re.solve(ids, R, risk_slider=5, frontier_points=12, risk_free_rate=0.0193, locked_weights={"A0": lock})
    mv = r["min_volatility_portfolio"]
    assert mv["weights"]["A0"] == lock
    assert abs(sum(mv["weights"].values()) - 1.0) < 1e-9
    assert all(-1e-12 <= w <= 0.35 + 1e-9 for a, w in mv["weights"].items() if a != "A0")
    assert mv["volatility"] <= r["frontier"][0]["volatility"] + 1e-6


def test_max_sharpe_solver_failure_uses_best_frontier_point(monkeypatch):
    # Si el problema transformado falla con alguna mu por encima del tipo sin riesgo, el
    # Max. Sharpe es el mejor punto de la frontera (antes: la minima volatilidad).
    from pypfopt import EfficientFrontier

    def boom(self, risk_free_rate=0.0):
        raise RuntimeError("solver")

    monkeypatch.setattr(EfficientFrontier, "max_sharpe", boom)
    ids = [f"A{i}" for i in range(6)]
    M = _drift_matrix([0.0005, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030], seed=1)
    r = re.solve(ids, M, risk_slider=5, locked_weights={"A0": 0.30})
    best = max(r["frontier"], key=lambda p: p["sharpe_ratio"])
    # Hay carteras que baten al tipo sin riesgo: el aviso no puede decir que no las hay.
    assert "MAX_SHARPE_FROM_FRONTIER" in r["warnings"]
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" not in r["warnings"]
    assert r["max_sharpe_portfolio"]["weights"] == best["weights"]
    assert r["max_sharpe_portfolio"]["sharpe_ratio"] > r["min_volatility_portfolio"]["sharpe_ratio"]


def test_frontier_points_are_deduplicated():
    ids = [f"A{i}" for i in range(6)]
    M = _drift_matrix([0.0005, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030], seed=1)
    for kwargs in ({}, {"locked_weights": {"A0": 0.30}}):
        frontier = re.solve(ids, M, risk_slider=5, **kwargs)["frontier"]
        keys = [(round(p["volatility"], 7), round(p["expected_return"], 7)) for p in frontier]
        assert len(keys) == len(set(keys))


# --- P2-03 (auditoria del 20-11-2026): reintento con CLARABEL y reserva segura en ABSOLUTE_VOL ---------------------

def _falla_con_el_solver_por_defecto(monkeypatch, metodo, tambien_clarabel=False):
    """Simula que OSQP (el solver por defecto, `solver=None`) no resuelve `metodo`; con `tambien_clarabel`, ninguno."""
    from pypfopt import EfficientFrontier
    original = getattr(EfficientFrontier, metodo)

    def envuelto(self, *args, **kwargs):
        if self._solver is None or tambien_clarabel:
            raise RuntimeError(f"solver simulado: {metodo}")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(EfficientFrontier, metodo, envuelto)


def _absoluta(tv):
    ids, M = _universe(seed=5)
    return re.solve(ids, M, objective="TARGET_RISK", risk_target_mode="ABSOLUTE_VOL", target_volatility=tv)


def test_absolute_vol_retries_with_clarabel(monkeypatch):
    # La frontera de este universo va de ~2,6 % a ~5,8 %: un 4 % se alcanza. Antes, si OSQP fallaba, la propuesta era la
    # de maximo riesgo (5,84 %) con el aviso de que el 4 % pasaba de la maxima.
    _falla_con_el_solver_por_defecto(monkeypatch, "efficient_risk")
    r = _absoluta(0.04)
    assert r["target_portfolio"]["volatility"] == pytest.approx(0.04, abs=1e-5)
    assert not any(w.startswith("TARGET_ABSOLUTE_VOL") for w in r["warnings"])


def test_absolute_vol_without_any_solver_takes_the_closest_point_not_above_the_target(monkeypatch):
    _falla_con_el_solver_por_defecto(monkeypatch, "efficient_risk", tambien_clarabel=True)
    r = _absoluta(0.04)
    frontera = r["frontier"]
    por_debajo = [p for p in frontera if p["volatility"] <= 0.04]
    assert frontera[0]["volatility"] < 0.04 < frontera[-1]["volatility"]
    assert r["target_portfolio"]["volatility"] <= 0.04
    assert r["target_portfolio"]["volatility"] == max(p["volatility"] for p in por_debajo)
    assert r["target_portfolio"]["volatility"] < frontera[-1]["volatility"]
    assert "TARGET_ABSOLUTE_VOL_FROM_FRONTIER" in r["warnings"]
    assert "TARGET_ABSOLUTE_VOL_CLIPPED_HIGH" not in r["warnings"], "el 4 % no pasa de la maxima: decirlo seria falso"


def test_absolute_vol_above_the_frontier_without_any_solver_is_the_top_and_says_so(monkeypatch):
    _falla_con_el_solver_por_defecto(monkeypatch, "efficient_risk", tambien_clarabel=True)
    r = _absoluta(0.20)
    assert r["target_portfolio"]["weights"] == r["frontier"][-1]["weights"]
    assert "TARGET_ABSOLUTE_VOL_CLIPPED_HIGH" in r["warnings"]
    assert "TARGET_ABSOLUTE_VOL_FROM_FRONTIER" not in r["warnings"]


def test_group_probe_retries_before_saying_there_is_no_solution(monkeypatch):
    # Antes: «Sin solución: ninguna cartera cumple a la vez estos límites por grupo…» solo porque OSQP fallaba.
    _falla_con_el_solver_por_defecto(monkeypatch, "min_volatility")
    ids, M = _universe(seed=5)
    grupos = [{"dimension": "asset_class", "mapper": {a: a[:2] for a in ids}, "upper": {"RV": 0.7}}]
    r = re.solve(ids, M, risk_slider=5, group_constraints=grupos)
    assert sum(w for a, w in r["target_portfolio"]["weights"].items() if a.startswith("RV")) <= 0.7 + 1e-6


def test_turnover_probe_retries_before_saying_there_is_no_solution(monkeypatch):
    _falla_con_el_solver_por_defecto(monkeypatch, "min_volatility")
    ids, M = _universe(seed=5)
    actual = {a: 1 / len(ids) for a in ids}
    r = re.solve(ids, M, risk_slider=5, current_weights=actual, max_turnover=0.5)
    movido = sum(abs(r["target_portfolio"]["weights"][a] - actual[a]) for a in ids)
    assert movido <= 0.5 + 1e-6


def test_max_return_retries_and_the_qp_frontier_keeps_its_points(monkeypatch):
    # Antes, con un candado (frontera por QP), la frontera se quedaba en un solo punto, la minima volatilidad, sin aviso.
    _falla_con_el_solver_por_defecto(monkeypatch, "_max_return")
    ids, M = _universe(seed=5)
    r = re.solve(ids, M, risk_slider=5, locked_weights={ids[0]: 0.10})
    assert len(r["frontier"]) > 3


def test_target_return_max_return_retries(monkeypatch):
    # Antes: error interno, aunque el objetivo se alcanzaba.
    _falla_con_el_solver_por_defecto(monkeypatch, "_max_return")
    ids, M = _universe(seed=5)
    r = re.solve(ids, M, objective="TARGET_RETURN", target_return=0.03)
    assert r["target_portfolio"] is not None


def test_condition_number_without_positive_eigenvalues_is_empty_and_serialisable():
    import json
    assert re._cond(np.zeros((3, 3))) == (None, 0.0)
    _S, meta = re.estimate_covariance(np.zeros((160, 3)).tolist(), ["A", "B", "C"])
    assert meta["condition_number"] is None
    json.dumps(meta, allow_nan=False)


def test_condition_number_is_the_ratio_of_the_extreme_positive_eigenvalues():
    # diag(4, 1, 0): autovalores positivos 4 y 1, numero de condicion 4.
    assert re._cond(np.diag([4.0, 1.0, 0.0])) == (4.0, 0.0)

