"""Pure historical-stress analytics for a current model portfolio.

The module deliberately has no Firestore or callable dependencies.  Callers pass
the EUR master-price series already loaded by the backtest path as::

    {asset_id: [{"date": "YYYY-MM-DD", "value": 123.45}, ...]}

Only observations inside each asset's own first/last dates may be carried
forward.  In particular, this module never backfills before the first point or
extends a stale series beyond its last point.

P1-06 (auditoria del 20-11-2026). A series that stopped (its last point more than
``MAX_BRIDGED_WEEK_GAP_DAYS`` before the most recent one) is set aside in every
scenario with ``SERIES_ENDS_EARLY``, the same code and the same tolerance as the
period of the simulation (decision A-161). Before, as every scenario ends at the
earliest last date, it cut the recovery of a crisis (a COVID reported as not
recovered because one fund stopped in April 2020) and, in the common history,
the loop removed the youngest healthy asset instead of the stopped one. And a
scenario in which the portfolio never fell below its reference level says so,
``NO_DRAWDOWN``: before it was "recovered in 1 day", or "not recovered" with 0 %
left to recover.

N03 (22-11-2026, approved by Oscar). A crisis only takes a series that is observed
through it: if, inside the window, two consecutive points are more than
``MAX_BRIDGED_WEEK_GAP_DAYS`` apart, it is set aside with ``GAP_IN_WINDOW``, like
the other exclusions (the measured weight and ``representative`` drop with it).
Before, the last price was carried across the gap: a fund with a quote on
19-02-2020 and the next on 01-04-2020 gave a COVID of 0,00 %, "did not fall".
H1-05 (22-11-2026) closes the same hole at the end: a series with no point after its last one inside the crisis is
unobserved from there to the end of the crisis (or to today, while it lasts), and the same 14 days apply.
"""
from __future__ import annotations

from bisect import bisect_right
from datetime import date, datetime, timedelta
import math
from typing import Dict, Iterable, Mapping, Optional

from fund_history_quality import tiene_precio_congelado
from weekly_sampling import MAX_BRIDGED_WEEK_GAP_DAYS


COVID_START = date(2020, 2, 19)
COVID_END = date(2020, 3, 23)
RATES_2022_START = date(2022, 1, 1)
RATES_2022_END = date(2022, 10, 31)
START_TOLERANCE_BUSINESS_DAYS = 5
REPRESENTATIVE_WEIGHT_THRESHOLD = 0.60
# The code of `optimization.repository.MOTIVO_SERIE_PARADA` (A-161), which the screen already names.
SERIES_ENDS_EARLY = "SERIES_ENDS_EARLY"
# N03: inside a crisis, two consecutive points of the series are more than MAX_BRIDGED_WEEK_GAP_DAYS apart. Carrying
# the last price across that gap would invent a flat path exactly where the fall is measured.
GAP_IN_WINDOW = "GAP_IN_WINDOW"
# The portfolio never went below the level the fall is measured from: there is nothing to recover.
NO_DRAWDOWN = "NO_DRAWDOWN"
# The same tolerance with which a level counts as recovered.
LEVEL_TOLERANCE = 1e-12


_FIXED_SCENARIOS = (
    ("COVID", "COVID-19", COVID_START, COVID_END),
    ("RATES_2022", "Tipos-2022", RATES_2022_START, RATES_2022_END),
)


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    raise ValueError("today must be a date, datetime, or ISO date string")


def _add_business_days(start: date, count: int) -> date:
    current = start
    remaining = count
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def _three_year_anniversary(start: date) -> date:
    try:
        return start.replace(year=start.year + 3)
    except ValueError:  # 29 February -> 28 February three years later.
        return start.replace(year=start.year + 3, day=28)


def _normalise_points(raw_points: object, today: date) -> list[tuple[date, float]]:
    """Return sorted, de-duplicated positive observations up to ``today``.

    A malformed point is ignored rather than converted into an invented price.
    When a date is repeated, the last occurrence supplied by the caller wins.
    """
    if isinstance(raw_points, Mapping):
        iterable: Iterable = ({"date": key, "value": value} for key, value in raw_points.items())
    elif isinstance(raw_points, (list, tuple)):
        iterable = raw_points
    else:
        return []

    by_date: Dict[date, float] = {}
    for point in iterable:
        try:
            if isinstance(point, Mapping):
                point_date = _as_date(point.get("date"))
                value = float(point.get("value"))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                point_date = _as_date(point[0])
                value = float(point[1])
            else:
                continue
        except (TypeError, ValueError, OverflowError):
            continue
        if point_date <= today and math.isfinite(value) and value > 0:
            by_date[point_date] = value
    return sorted(by_date.items())


def _positive_weights(weights: Mapping[str, object]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for raw_asset_id, raw_weight in (weights or {}).items():
        asset_id = str(raw_asset_id).strip()
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError, OverflowError):
            continue
        if asset_id and math.isfinite(weight) and weight > 0:
            out[asset_id] = out.get(asset_id, 0.0) + weight
    return out


def _coverage(
    requested_weights: Mapping[str, float],
    included_ids: Iterable[str],
) -> dict:
    included = list(included_ids)
    total_weight = sum(requested_weights.values())
    included_weight = sum(requested_weights.get(asset_id, 0.0) for asset_id in included)
    ratio = included_weight / total_weight if total_weight > 0 else 0.0
    return {
        "weight_pct": round(ratio * 100.0, 6),
        "included_assets": len(included),
        "total_assets": len(requested_weights),
    }


def _empty_result(
    scenario_id: str,
    label: str,
    configured_start: Optional[date],
    configured_end: Optional[date],
    requested_weights: Mapping[str, float],
    included_ids: Iterable[str],
    excluded_assets: list[dict],
    reason: str,
) -> dict:
    coverage = _coverage(requested_weights, included_ids)
    return {
        "id": scenario_id,
        "label": label,
        "configured_start_date": configured_start.isoformat() if configured_start else None,
        "configured_end_date": configured_end.isoformat() if configured_end else None,
        "start_date": None,
        "end_date": None,
        "peak_date": None,
        "trough_date": None,
        "common_data_end_date": None,
        "drawdown_pct": None,
        "duration_days": None,
        "recovery_date": None,
        "recovery_days": None,
        "recovery_status": "NO_DATA",
        # NO_DATA has no terminal portfolio level from which to measure a gap.
        "remaining_to_recover_pct": None,
        "worst_asset": None,
        "coverage": coverage,
        "representative": coverage["weight_pct"] >= REPRESENTATIVE_WEIGHT_THRESHOLD * 100.0,
        "included_assets": list(included_ids),
        "excluded_assets": excluded_assets,
        "reason": reason,
    }


def _value_on_or_before(points: list[tuple[date, float]], dates: list[date], when: date) -> Optional[float]:
    index = bisect_right(dates, when) - 1
    if index < 0 or when > points[-1][0]:
        return None
    return points[index][1]


def _calculate_result(
    scenario_id: str,
    label: str,
    configured_start: Optional[date],
    configured_end: Optional[date],
    requested_weights: Mapping[str, float],
    series: Mapping[str, list[tuple[date, float]]],
    excluded_assets: list[dict],
    analysis_start: date,
    analysis_end: date,
    common_end: date,
    *,
    from_peak: bool = False,
) -> dict:
    included_ids = list(series)
    if not included_ids or analysis_start > analysis_end or analysis_start > common_end:
        return _empty_result(
            scenario_id, label, configured_start, configured_end,
            requested_weights, included_ids, excluded_assets, "INSUFFICIENT_COMMON_DATA",
        )

    # The union of observed dates preserves every actual price movement.  LOCF
    # supplies only internal values because the timeline is bounded by the
    # latest first point and earliest last point of all included series.
    timeline = sorted({
        point_date
        for points in series.values()
        for point_date, _value in points
        if analysis_start <= point_date <= common_end
    } | {analysis_start})
    if not timeline:
        return _empty_result(
            scenario_id, label, configured_start, configured_end,
            requested_weights, included_ids, excluded_assets, "INSUFFICIENT_COMMON_DATA",
        )

    date_indexes = {asset_id: [item[0] for item in points] for asset_id, points in series.items()}
    base_values: Dict[str, float] = {}
    for asset_id, points in series.items():
        value = _value_on_or_before(points, date_indexes[asset_id], analysis_start)
        if value is None:
            return _empty_result(
                scenario_id, label, configured_start, configured_end,
                requested_weights, included_ids, excluded_assets, "INSUFFICIENT_COMMON_DATA",
            )
        base_values[asset_id] = value

    included_weight = sum(requested_weights[asset_id] for asset_id in included_ids)
    normalised_weights = {
        asset_id: requested_weights[asset_id] / included_weight
        for asset_id in included_ids
    }

    levels: list[tuple[date, float, Dict[str, float]]] = []
    for point_date in timeline:
        relatives: Dict[str, float] = {}
        for asset_id, points in series.items():
            value = _value_on_or_before(points, date_indexes[asset_id], point_date)
            if value is None:
                break
            relatives[asset_id] = value / base_values[asset_id]
        if len(relatives) != len(included_ids):
            continue
        level = sum(normalised_weights[asset_id] * relatives[asset_id] for asset_id in included_ids)
        levels.append((point_date, level, relatives))

    loss_levels = [item for item in levels if analysis_start <= item[0] <= analysis_end]
    if not loss_levels:
        return _empty_result(
            scenario_id, label, configured_start, configured_end,
            requested_weights, included_ids, excluded_assets, "INSUFFICIENT_COMMON_DATA",
        )

    if from_peak:
        # Decision 115 (06-11-2026), only for the common history: the worst fall from the highest level
        # reached so far, not from the first day. A high repeated at the same level moves forward, so the
        # stated duration starts on the last day at that high, as the internal report's drawdown episodes
        # do; the first trough still wins ties.
        running_peak = reference = trough = loss_levels[0]
        worst_fall = 0.0
        for item in loss_levels:
            if item[1] >= running_peak[1]:
                running_peak = item
            fall = item[1] / running_peak[1] - 1.0
            if fall < worst_fall:
                worst_fall, reference, trough = fall, running_peak, item
    else:
        # Fixed-date crises measure from their first day, whose level is 1 by construction.
        # First occurrence wins ties: the stated duration therefore never grows
        # merely because a flat trough is repeated on later dates.
        reference = (analysis_start, 1.0, {asset_id: 1.0 for asset_id in included_ids})
        trough = min(loss_levels, key=lambda item: (item[1], item[0]))
    # P1-06: with no level below the reference (within the recovery tolerance) there is no fall, no
    # recovery and no asset that took the most away. The trough is then the reference day itself, so the
    # duration is zero even if a float rounding left a later level a hair below it.
    no_drawdown = trough[1] >= reference[1] - LEVEL_TOLERANCE
    if no_drawdown:
        trough = reference
    reference_date, reference_level, reference_relatives = reference
    trough_date, trough_level, trough_relatives = trough
    drawdown = 0.0 if no_drawdown else trough_level / reference_level - 1.0

    if no_drawdown:
        recovery_date = None
        recovery_days = None
        remaining_to_recover = 0.0
        recovery_status = NO_DRAWDOWN
        worst_asset = None
    else:
        # First return to the reference level after the trough. `levels` continues through common_end,
        # so the search is deliberately not capped at the scenario's configured end.
        recovery = next(
            (item for item in levels if item[0] > trough_date and item[1] >= reference_level - LEVEL_TOLERANCE),
            None,
        )
        recovery_date = recovery[0] if recovery else None
        recovery_days = (recovery_date - trough_date).days if recovery_date else None
        # The final common observation is the only admissible terminal value: using
        # any later value from a longer individual series would be external LOCF.
        last_common_level = levels[-1][1]
        remaining_to_recover = 0.0 if recovery else max(0.0, 1.0 - last_common_level / reference_level)
        recovery_status = "RECOVERED" if recovery_date else "NOT_RECOVERED"

        # Each asset's weight on the reference day times its own move to the trough: the contributions add up
        # to the fall. On a crisis that day is the first one, so it is today's weight and its move since then.
        contributions = []
        for asset_id in included_ids:
            weight = normalised_weights[asset_id] * reference_relatives[asset_id] / reference_level
            asset_return = trough_relatives[asset_id] / reference_relatives[asset_id] - 1.0
            contribution = weight * asset_return
            contributions.append((contribution, asset_id, asset_return, weight))
        worst_contribution, worst_asset_id, worst_return, worst_weight = min(contributions, key=lambda item: (item[0], item[1]))
        worst_asset = {
            "asset_id": worst_asset_id,
            "weight_pct": round(worst_weight * 100.0, 6),
            "return_pct": round(worst_return * 100.0, 6),
            "contribution_pct": round(worst_contribution * 100.0, 6),
        }

    coverage = _coverage(requested_weights, included_ids)
    return {
        "id": scenario_id,
        "label": label,
        "configured_start_date": configured_start.isoformat() if configured_start else None,
        "configured_end_date": configured_end.isoformat() if configured_end else None,
        "start_date": analysis_start.isoformat(),
        "end_date": loss_levels[-1][0].isoformat(),
        # The high the fall is measured from; null on a crisis, which measures from `start_date`.
        "peak_date": reference_date.isoformat() if from_peak else None,
        "trough_date": trough_date.isoformat(),
        "common_data_end_date": common_end.isoformat(),
        "drawdown_pct": round(drawdown * 100.0, 6),
        "duration_days": max(0, (trough_date - reference_date).days),
        "recovery_date": recovery_date.isoformat() if recovery_date else None,
        "recovery_days": recovery_days,
        "recovery_status": recovery_status,
        # RECOVERED and NO_DRAWDOWN are exactly zero.  NO_DATA uses null in `_empty_result`.
        "remaining_to_recover_pct": round(remaining_to_recover * 100.0, 6),
        # Null with NO_DRAWDOWN: every contribution is zero, and naming one would be inventing it.
        "worst_asset": worst_asset,
        "coverage": coverage,
        "representative": coverage["weight_pct"] >= REPRESENTATIVE_WEIGHT_THRESHOLD * 100.0,
        "included_assets": included_ids,
        "excluded_assets": excluded_assets,
        "reason": None,
    }


def stopped_series(
    all_series: Mapping[str, list[tuple[date, float]]],
    requested_weights: Mapping[str, float],
) -> set[str]:
    """The assets whose series ends more than MAX_BRIDGED_WEEK_GAP_DAYS before the most recent one.

    The rule of the simulation's period (A-161, `portfolio_horizon._periodo_comun`): the end is the most recent
    last point, and a series that stops before it, beyond the gap that is bridged, has history but no recent
    prices. As there (P1-04), a frozen-price asset (`frozen_price`, NH Hotel) does not set that end, because its
    series is extended flat to today when read; only a portfolio made only of them takes it from them. A single
    asset, or several ending together, never stop: the end is theirs.
    """
    with_series = {asset_id: all_series[asset_id] for asset_id in requested_weights if all_series.get(asset_id)}
    if not with_series:
        return set()
    real_ends = [points[-1][0] for asset_id, points in with_series.items() if not tiene_precio_congelado(asset_id)]
    latest = max(real_ends or [points[-1][0] for points in with_series.values()])
    return {
        asset_id for asset_id, points in with_series.items()
        if (latest - points[-1][0]).days > MAX_BRIDGED_WEEK_GAP_DAYS
    }


def _gap_in_window(points: list[tuple[date, float]], start: date, end: date, as_of: date) -> bool:
    """Whether the series leaves a stretch of the window [start, end] unobserved for more than the bridged gap.

    The gaps counted are those between consecutive points from the first one on or after ``start``. The last stretch
    runs from the last point on or before ``end`` to the first point after it, capped at ``end``: what is checked is
    the window, and a pause that starts on its last day leaves nothing in it unobserved. A series with no point after
    it runs to the end of the window that can be observed, ``min(end, as_of)``: a window still in course ends today,
    and a series that is up to date is not cut. The tolerance is ``MAX_BRIDGED_WEEK_GAP_DAYS``, in calendar days as
    in ``stopped_series``: a weekly series that misses one week (14 days) still passes, and 15 days do not.

    H1-05 (auditoria del 22-11-2026). Until then a series with no point after the window was taken to end there, on
    the grounds that ``stopped_series`` (``SERIES_ENDS_EARLY``) set the stopped ones aside. It does not when there is
    nothing to compare with: a single asset, several that end together, or one that ends beside a frozen-price asset,
    which does not set the end. A fund whose last price was on 19-02-2020 then gave a COVID of 0,0 %, representative.
    """
    previous: Optional[date] = None
    for point_date, _value in points:
        if point_date < start:
            continue
        if previous is not None and (min(point_date, end) - previous).days > MAX_BRIDGED_WEEK_GAP_DAYS:
            return True
        if point_date > end:
            return False
        previous = point_date
    return previous is not None and (min(end, as_of) - previous).days > MAX_BRIDGED_WEEK_GAP_DAYS


def _fixed_window(
    scenario_id: str,
    label: str,
    start: date,
    end: date,
    all_series: Mapping[str, list[tuple[date, float]]],
    requested_weights: Mapping[str, float],
    exclusion_reasons: Mapping[str, str],
    stopped: set[str],
    as_of: date,
) -> dict:
    included: Dict[str, list[tuple[date, float]]] = {}
    excluded: list[dict] = []
    latest_allowed_start = _add_business_days(start, START_TOLERANCE_BUSINESS_DAYS)

    for asset_id in requested_weights:
        points = all_series.get(asset_id) or []
        if not points:
            excluded.append({"asset_id": asset_id, "reason": exclusion_reasons.get(asset_id, "NO_SERIES")})
            continue
        # P1-06: a stopped series would end the scenario at its last point, and a crisis could come out
        # as not recovered only because of it. It is set aside even if it covers the crisis itself.
        if asset_id in stopped:
            excluded.append({"asset_id": asset_id, "reason": SERIES_ENDS_EARLY})
            continue
        first_in_window = next((item for item in points if item[0] >= start), None)
        if first_in_window is None or first_in_window[0] > latest_allowed_start or first_in_window[0] > end:
            excluded.append({"asset_id": asset_id, "reason": "NO_DATA_AT_WINDOW_START"})
            continue
        # N03: with a hole inside the crisis the fall would be measured on a carried-forward price.
        if _gap_in_window(points, start, end, as_of):
            excluded.append({"asset_id": asset_id, "reason": GAP_IN_WINDOW})
            continue
        included[asset_id] = points

    if not included:
        return _empty_result(
            scenario_id, label, start, end, requested_weights, [], excluded, "NO_ELIGIBLE_ASSETS",
        )

    analysis_start = max(next(item[0] for item in points if item[0] >= start) for points in included.values())
    common_end = min(points[-1][0] for points in included.values())
    analysis_end = min(end, common_end)
    return _calculate_result(
        scenario_id, label, start, end, requested_weights, included, excluded,
        analysis_start, analysis_end, common_end,
    )


def _common_history(
    all_series: Mapping[str, list[tuple[date, float]]],
    requested_weights: Mapping[str, float],
    today: date,
    exclusion_reasons: Mapping[str, str],
    stopped: set[str],
) -> dict:
    active: Dict[str, list[tuple[date, float]]] = {}
    excluded: list[dict] = []
    for asset_id in requested_weights:
        points = all_series.get(asset_id) or []
        if not points:
            excluded.append({"asset_id": asset_id, "reason": exclusion_reasons.get(asset_id, "NO_SERIES")})
        elif asset_id in stopped:
            # P1-06: set aside before the loop below, which only looks at first dates. With a stopped series
            # in, the shortfall was at the end, and the loop removed the youngest healthy asset instead.
            excluded.append({"asset_id": asset_id, "reason": SERIES_ENDS_EARLY})
        else:
            active[asset_id] = points

    # With every stopped series out, all the others end within the bridged gap of each other, so what
    # keeps the common span under three years is the start: removing the youngest is the right cut.
    while len(active) > 1:
        common_start = max(points[0][0] for points in active.values())
        common_end = min(points[-1][0] for points in active.values())
        if common_end >= _three_year_anniversary(common_start):
            break
        # Stable tie-break: among equally young series, the lexicographically
        # greatest asset id is removed first.
        youngest_id = max(active, key=lambda asset_id: (active[asset_id][0][0], asset_id))
        active.pop(youngest_id)
        excluded.append({"asset_id": youngest_id, "reason": "YOUNGEST_TO_REACH_THREE_YEARS"})

    if not active:
        return _empty_result(
            "COMMON_HISTORY", "Historia común", None, None,
            requested_weights, [], excluded, "NO_ELIGIBLE_ASSETS",
        )

    common_start = max(points[0][0] for points in active.values())
    common_end = min(points[-1][0] for points in active.values())
    if common_start > common_end:
        return _empty_result(
            "COMMON_HISTORY", "Historia común", common_start, today,
            requested_weights, list(active), excluded, "INSUFFICIENT_COMMON_DATA",
        )
    return _calculate_result(
        "COMMON_HISTORY", "Historia común", common_start, today,
        requested_weights, active, excluded,
        common_start, common_end, common_end,
        from_peak=True,
    )


def stress_windows(
    series_por_activo: Mapping[str, object],
    weights: Mapping[str, object],
    *,
    today=None,
    exclusion_reasons: Optional[Mapping[str, str]] = None,
) -> list[dict]:
    """Calculate COVID, 2022 rates, and oldest representative common history.

    Percent fields are expressed on a 0..100 scale.  Coverage is the original
    positive portfolio weight represented by each scenario; calculation weights
    are renormalised to 100% among that scenario's included assets.  A scenario
    remains calculable below 60% coverage, but ``representative`` is false.

    Every call returns exactly three entries in deterministic order.  Missing or
    insufficient data are represented by an entry with null metrics and a
    machine-readable ``reason`` rather than by omitting the scenario.

    Each scenario starts with today's weights on its own first day and lets them
    drift.  The two crises measure from that first day to their lowest point, and
    their ``peak_date`` is null.  The common history measures the worst fall from
    the highest level reached so far (decision 115, 06-11-2026): ``peak_date`` is
    that high, ``duration_days`` runs from it to the trough, recovery is the first
    return to it, and the worst asset is weighted as it stood on that day.

    A stopped series (``stopped_series``) is excluded from all three with
    ``SERIES_ENDS_EARLY``, and a series with a gap of more than
    ``MAX_BRIDGED_WEEK_GAP_DAYS`` inside a crisis, from that crisis with
    ``GAP_IN_WINDOW`` (the common history keeps its rule). A scenario with no level below its reference has
    ``recovery_status`` ``NO_DRAWDOWN``: drawdown 0, trough on the reference day,
    nothing to recover and no ``worst_asset``.
    """
    as_of = _as_date(today) if today is not None else date.today()
    requested_weights = _positive_weights(weights)
    raw_series = series_por_activo if isinstance(series_por_activo, Mapping) else {}
    declared_exclusions = exclusion_reasons if isinstance(exclusion_reasons, Mapping) else {}
    all_series = {
        asset_id: _normalise_points(raw_series.get(asset_id), as_of)
        for asset_id in requested_weights
    }

    if not requested_weights:
        return [
            _empty_result(scenario_id, label, start, end, {}, [], [], "NO_POSITIVE_WEIGHTS")
            for scenario_id, label, start, end in _FIXED_SCENARIOS
        ] + [
            _empty_result(
                "COMMON_HISTORY", "Historia común", None, None,
                {}, [], [], "NO_POSITIVE_WEIGHTS",
            )
        ]

    stopped = stopped_series(all_series, requested_weights)
    fixed = [
        _fixed_window(
            scenario_id, label, start, end, all_series, requested_weights, declared_exclusions, stopped, as_of,
        )
        for scenario_id, label, start, end in _FIXED_SCENARIOS
    ]
    return fixed + [_common_history(all_series, requested_weights, as_of, declared_exclusions, stopped)]
