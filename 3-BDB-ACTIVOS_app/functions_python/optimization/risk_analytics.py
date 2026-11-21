"""Pure portfolio-risk attribution helpers.

This module deliberately receives an already estimated covariance matrix.  It
does not load price history or choose an estimator, so callers can reuse the
same covariance model that was used by their portfolio engine.
"""
from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Optional


_MIN_PORTFOLIO_SIGMA = 1e-12


def risk_contributions(weights: Iterable[float], cov: Iterable[Iterable[float]]) -> Optional[list[float]]:
    """Return signed percentage contributions to portfolio volatility.

    The marginal contribution is ``MCR_i = (cov @ weights)_i / sigma_p`` and
    the total contribution is ``RC_i = weights_i * MCR_i``.  Returned values
    are normalized so their signed sum is 100.  A negative value is preserved:
    it identifies a position that diversifies total portfolio risk.

    ``None`` is returned when attribution is undefined because all weights are
    zero or portfolio volatility is below ``1e-12``.
    """
    try:
        normalized_weights = [float(value) for value in weights]
    except (TypeError, ValueError) as exc:
        raise ValueError("weights must be a finite numeric vector") from exc

    if any(not math.isfinite(value) for value in normalized_weights):
        raise ValueError("weights must contain only finite numbers")

    size = len(normalized_weights)
    try:
        covariance = [[float(value) for value in row] for row in cov]
    except (TypeError, ValueError) as exc:
        raise ValueError("cov must be a finite square numeric matrix") from exc

    if len(covariance) != size or any(len(row) != size for row in covariance):
        raise ValueError("cov dimensions must match weights")
    if any(not math.isfinite(value) for row in covariance for value in row):
        raise ValueError("cov must contain only finite numbers")

    if size == 0 or all(value == 0.0 for value in normalized_weights):
        return None

    covariance_times_weights = [
        sum(covariance[i][j] * normalized_weights[j] for j in range(size))
        for i in range(size)
    ]
    variance = sum(
        normalized_weights[i] * covariance_times_weights[i]
        for i in range(size)
    )
    if variance < -(_MIN_PORTFOLIO_SIGMA ** 2):
        raise ValueError("cov produces a negative portfolio variance")

    portfolio_sigma = math.sqrt(max(0.0, variance))
    if portfolio_sigma < _MIN_PORTFOLIO_SIGMA:
        return None

    total_contributions = [
        normalized_weights[i] * covariance_times_weights[i] / portfolio_sigma
        for i in range(size)
    ]
    signed_total = sum(total_contributions)
    if abs(signed_total) < _MIN_PORTFOLIO_SIGMA:
        return None

    return [100.0 * contribution / signed_total for contribution in total_contributions]
