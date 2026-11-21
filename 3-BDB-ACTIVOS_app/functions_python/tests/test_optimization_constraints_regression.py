"""Regression coverage for the production audit's lock and bound violations."""
import pytest

from test_optimization import make_large_reader, request
from test_robust_engine import _universe
from optimization import repository as repo
from optimization import robust_engine as re


@pytest.fixture(autouse=True)
def reset_cache():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


def proposals(result):
    for name in ('min_volatility_portfolio', 'max_sharpe_portfolio', 'target_portfolio', 'target_return_portfolio'):
        if result.get(name):
            yield result[name]
    yield from result['frontier']


@pytest.mark.parametrize('fixed', [0, .2, .6, .123456789])
def test_public_risk_optimizer_preserves_every_locked_proposal(fixed):
    reader = make_large_reader(8)
    ids = list(reader.roots)
    result = repo.optimize_portfolio(reader, request(
        asset_ids=ids, current_weights={a: fixed if i == 0 else (1-fixed)/7 for i, a in enumerate(ids)},
        objective='TARGET_RISK', locked_weights={ids[0]: fixed}, risk_slider=5))
    for point in proposals(result):
        assert point['weights'][ids[0]] == pytest.approx(fixed, abs=1e-12)
        assert sum(point['weights'].values()) == pytest.approx(1, abs=1e-9)


def test_infeasible_cap_is_rejected_instead_of_relaxed():
    reader = make_large_reader(8)
    with pytest.raises(repo.InvalidOptimizationRequest, match='Sin solución: 8 activos, con un máximo del 10,0 % por activo, no llegan al 100 %'):
        repo.optimize_portfolio(reader, request(asset_ids=list(reader.roots), objective='TARGET_RISK',
            constraints={'max_weight': .1}))


def test_feasible_cap_and_lock_hold_across_the_frontier():
    ids, matrix = _universe(nrf=2, nrv=6)
    result = re.solve(ids, matrix, max_weight=.2, locked_weights={ids[0]: .1})
    for point in proposals(result):
        assert point['weights'][ids[0]] == pytest.approx(.1, abs=1e-12)
        assert all(0 <= w <= .2 for w in point['weights'].values())
        assert sum(point['weights'].values()) == pytest.approx(1, abs=1e-9)


def test_all_locked_portfolio_is_preserved():
    ids, matrix = _universe(nrf=2, nrv=6)
    locked = {a: 1 / len(ids) for a in ids}
    result = re.solve(ids, matrix, max_weight=1, locked_weights=locked)
    for point in proposals(result):
        assert point['weights'] == locked


def test_infeasible_remaining_free_allocation_is_rejected():
    ids, matrix = _universe(nrf=1, nrv=2)
    with pytest.raises(re.WeightConstraintError, match='Sin solución: los candados suman 10,0 %'):
        re.solve(ids, matrix, max_weight=.4, locked_weights={ids[0]: .1})


def test_group_limit_cannot_override_a_lock():
    ids, matrix = _universe(nrf=2, nrv=6)
    groups = [{'dimension': 'test', 'mapper': {a: ('fixed' if a == ids[0] else 'free') for a in ids},
               'upper': {'fixed': .1}}]
    with pytest.raises(re.WeightConstraintError, match='Sin solución: en fixed .test., los candados y los mínimos suman 20,0 %, más que su máximo del 10,0 %'):
        re.solve(ids, matrix, max_weight=1, locked_weights={ids[0]: .2}, group_constraints=groups)


@pytest.mark.parametrize('locked, motivo', [
    ({'LARGE_00': -.1}, 'locked'),
    ({'LARGE_00': float('nan')}, 'locked'),
    ({'UNKNOWN': .2}, 'Sin solución: UNKNOWN tiene candado'),
])
def test_invalid_locks_are_not_silently_dropped(locked, motivo):
    reader = make_large_reader(8)
    with pytest.raises(repo.InvalidOptimizationRequest, match=motivo):
        repo.optimize_portfolio(reader, request(asset_ids=list(reader.roots), objective='TARGET_RISK', locked_weights=locked))


def test_locked_asset_without_history_is_not_removed():
    reader = make_large_reader(8)
    ids = list(reader.roots)
    reader.series[ids[0]] = []
    for extra in ({'objective': 'TARGET_RISK'}, {'objective': 'TARGET_RETURN', 'target_return': .01}):
        with pytest.raises(repo.InvalidOptimizationRequest, match='tiene candado y se queda fuera'):
            repo.optimize_portfolio(reader, request(asset_ids=ids, locked_weights={ids[0]: .2}, **extra))


def test_unattainable_return_is_not_replaced_with_another_goal():
    reader = make_large_reader(8)
    with pytest.raises(repo.InvalidOptimizationRequest, match='Sin solución: con un tope del 35,0 % por posición, la media de la serie llega como mucho a un .*, y has pedido un 50,00 %'):
        repo.optimize_portfolio(reader, request(asset_ids=list(reader.roots), objective='TARGET_RETURN', target_return=.5))


@pytest.mark.parametrize('objective', ['TARGET_RISK', 'MAX_SHARPE'])
def test_all_locked_below_full_investment_is_rejected(objective):
    reader = make_large_reader(3)
    ids = list(reader.roots)
    with pytest.raises(repo.InvalidOptimizationRequest, match='Sin solución: todas las posiciones tienen candado'):
        repo.optimize_portfolio(reader, request(asset_ids=ids, objective=objective,
            locked_weights={a: .2 for a in ids}))


@pytest.mark.parametrize('objective', ['TARGET_RISK', 'MAX_SHARPE'])
def test_history_exclusions_cannot_relax_the_maximum(objective):
    reader = make_large_reader(8)
    ids = list(reader.roots)
    for aid in ids[:3]:
        reader.series[aid] = []
    with pytest.raises(repo.InvalidOptimizationRequest, match='Sin solución: 5 activos'):
        repo.optimize_portfolio(reader, request(asset_ids=ids, objective=objective,
            constraints={'max_weight': .15}))


# R-02 (auditoria 29-09-2026): `_optimize_v2` pasaba el relleno max_weight=1.0 de
# validate_request al motor y anulaba el tope dinamico (0,20 con 20 activos).
def test_default_cap_is_dynamic_when_the_user_sets_no_maximum():
    reader = make_large_reader(20)
    ids = list(reader.roots)
    result = repo.optimize_portfolio(reader, request(
        asset_ids=ids, current_weights={a: 1 / len(ids) for a in ids}, objective='TARGET_RISK', risk_slider=5))
    assert result['methodology']['weight_bounds'] == [0.0, .2]
    for point in proposals(result):
        assert max(point['weights'].values()) <= .2 + 1e-6
        assert sum(point['weights'].values()) == pytest.approx(1, abs=1e-9)


def test_engine_default_cap_holds_for_max_sharpe_with_twenty_assets():
    ids, matrix = _universe(nrf=4, nrv=16)
    result = re.solve(ids, matrix, objective='MAX_SHARPE')
    for point in proposals(result):
        assert max(point['weights'].values()) <= .2 + 1e-6


def test_explicit_cap_is_still_honoured_over_the_dynamic_one():
    reader = make_large_reader(20)
    ids = list(reader.roots)
    result = repo.optimize_portfolio(reader, request(
        asset_ids=ids, objective='TARGET_RISK', risk_slider=5, constraints={'max_weight': .1}))
    for point in proposals(result):
        assert max(point['weights'].values()) <= .1 + 1e-6


def test_a_lock_above_the_dynamic_cap_is_kept_but_free_assets_stay_capped():
    reader = make_large_reader(8)
    ids = list(reader.roots)
    result = repo.optimize_portfolio(reader, request(
        asset_ids=ids, objective='TARGET_RISK', risk_slider=5, locked_weights={ids[0]: .6}))
    for point in proposals(result):
        assert point['weights'][ids[0]] == pytest.approx(.6, abs=1e-12)
        assert max(w for a, w in point['weights'].items() if a != ids[0]) <= .35 + 1e-6
