"""Unit tests for pure portfolio risk attribution."""
from __future__ import annotations

import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.risk_analytics import risk_contributions


def test_uncorrelated_assets_follow_weight_squared_variance() -> None:
    weights = [0.6, 0.4]
    covariance = [[0.1 ** 2, 0.0], [0.0, 0.2 ** 2]]

    result = risk_contributions(weights, covariance)

    expected_first = (0.6 ** 2 * 0.1 ** 2) / (
        0.6 ** 2 * 0.1 ** 2 + 0.4 ** 2 * 0.2 ** 2
    ) * 100.0
    assert result == pytest.approx([expected_first, 100.0 - expected_first])


def test_perfect_correlation_follows_weight_times_volatility() -> None:
    weights = [0.6, 0.4]
    covariance = [[0.1 ** 2, 0.1 * 0.2], [0.1 * 0.2, 0.2 ** 2]]

    result = risk_contributions(weights, covariance)

    expected_first = (0.6 * 0.1) / (0.6 * 0.1 + 0.4 * 0.2) * 100.0
    assert result == pytest.approx([expected_first, 100.0 - expected_first])


def test_signed_contributions_sum_to_one_hundred() -> None:
    result = risk_contributions(
        [0.2, 0.3, 0.5],
        [
            [0.01, 0.002, -0.001],
            [0.002, 0.0225, 0.003],
            [-0.001, 0.003, 0.04],
        ],
    )

    assert result is not None
    assert sum(result) == pytest.approx(100.0)


def test_zero_weight_has_zero_risk_contribution() -> None:
    result = risk_contributions([0.0, 1.0], [[0.01, 0.002], [0.002, 0.04]])

    assert result == pytest.approx([0.0, 100.0])


def test_negative_risk_contribution_is_preserved() -> None:
    # Positive-semidefinite covariance with a negatively correlated first asset.
    result = risk_contributions([0.2, 0.8], [[0.01, -0.02], [-0.02, 0.09]])

    assert result is not None
    assert result[0] < 0.0
    assert result[1] > 100.0
    assert sum(result) == pytest.approx(100.0)


@pytest.mark.parametrize(
    ("weights", "covariance"),
    [
        ([0.0, 0.0], [[0.01, 0.0], [0.0, 0.04]]),
        ([0.5, 0.5], [[0.0, 0.0], [0.0, 0.0]]),
    ],
)
def test_degenerate_portfolio_returns_none(weights, covariance) -> None:
    assert risk_contributions(weights, covariance) is None


@pytest.mark.parametrize(
    ("weights", "covariance"),
    [
        ([0.5, 0.5], [[0.01]]),
        ([0.5, math.inf], [[0.01, 0.0], [0.0, 0.04]]),
        ([0.5, 0.5], [[0.01, math.nan], [0.0, 0.04]]),
    ],
)
def test_invalid_dimensions_or_non_finite_values_raise(weights, covariance) -> None:
    with pytest.raises(ValueError):
        risk_contributions(weights, covariance)
