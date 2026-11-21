"""Reconcile provider multi-year returns before labelling them annualized."""
import calendar
import math
from datetime import date


def reconcile_return(reported, points, end, months, *, class_start=None):
    """Infer a basis only when exact dated graph endpoints support the value.

    The graph is an independent representation from the same provider, not an
    independent source. Never interpolate or relax the 0.10 percentage-point
    tolerance to accommodate a mismatch.
    """
    try:
        if isinstance(reported, bool):
            return None
        reported = float(reported)
        end = date.fromisoformat(str(end)[:10])
        if end > date.today() or not math.isfinite(reported) or months not in (1, 3, 12, 36, 60, 120):
            return None
        year, month = divmod(end.year * 12 + end.month - 1 - months, 12)
        month += 1
        start = date(year, month, calendar.monthrange(year, month)[1])
        if class_start and start < date.fromisoformat(str(class_start)[:10]):
            return None
        values = {}
        for point in points:
            key = str(point['date'])[:10]
            value = float(point['value'])
            if key in values or not math.isfinite(value) or value <= 0:
                return None
            values[key] = value
        ratio = values[end.isoformat()] / values[start.isoformat()]
        cumulative = (ratio - 1) * 100
        annualized = (ratio ** (12 / months) - 1) * 100 if months > 12 else cumulative
        matches_annualized = abs(reported - annualized) <= .10
        matches_cumulative = abs(reported - cumulative) <= .10
        if not (matches_annualized or matches_cumulative):
            return None
        # Near zero, both hypotheses may fit the rounding tolerance. Do not
        # choose the more convenient interpretation of an ambiguous return.
        if months > 12 and matches_annualized and matches_cumulative and abs(annualized-cumulative) > .00001:
            return None
        basis = 'ANNUALIZED' if months > 12 and matches_annualized else 'CUMULATIVE'
        normalized = reported if basis == 'ANNUALIZED' or months <= 12 else ((1+reported/100)**(12/months)-1)*100
        return {'basis':basis, 'annualized_pct':round(normalized,8), 'reported_pct':reported,
                'graph_cumulative_pct':cumulative, 'graph_annualized_pct':annualized,
                'start_date':start.isoformat(), 'end_date':end.isoformat(),
                'error_pp':abs(reported-(annualized if basis == 'ANNUALIZED' else cumulative))}
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError):
        return None
