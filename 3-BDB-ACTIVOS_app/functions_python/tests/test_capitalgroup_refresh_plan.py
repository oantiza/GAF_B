"""Admission checks for a read-only official NAV refresh, without network/DB."""
import importlib.util
from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "capitalgroup_plan", Path(__file__).resolve().parents[2] / "scripts" / "plan_capitalgroup_refresh.py")
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)
ASSET = "LU1378997107"
AS_OF = date(2026, 10, 18)


def sample():
    old = [{"date": f"2026-10-{day:02d}", "value": 30 + day / 100} for day in range(5, 10)]
    new = [{"date": f"2026-10-{day:02d}", "value": 30 + day / 100} for day in range(12, 17)]
    series = {"asset_id": ASSET, "series_type": "NAV", "currency": "EUR", "source_currency": "EUR",
              "source_listing_id": "CAPITALGROUP:" + ASSET, "last_date": old[-1]["date"], "points": old}
    return series, old + new, {"date": "2026-10-16", "value": 30.16}


def test_official_nav_column_is_used_instead_of_indicative_month_end_nav():
    html = ('<table id="historyTable"><tr><th>Date</th><th>NAV per share</th><th>Month-end NAV</th></tr>'
            '<tr><td>30/09/2026</td><td><span>31.2816</span></td><td>31.1749</td></tr>'
            '<tr><td>01/10/2026</td><td>-</td><td>31.9999</td></tr></table>')
    assert plan.parse_navs(html) == [{"date": "2026-09-30", "value": 31.2816}]
    with pytest.raises(ValueError, match="NAV column"):
        plan.parse_navs(html.replace("NAV per share", "Month-end NAV", 1))


def test_identity_and_currency_must_match_the_official_share_class():
    page = (f'<table><tr><td>Capital Group ICA Z EUR</td><td>{ASSET}</td>'
            '<td>31.2587</td><td>16 Oct 2026</td></tr></table>')
    assert plan.official_quote(page, ASSET, "EUR")["date"] == "2026-10-16"
    for isin, currency in [("LU1295551144", "EUR"), (ASSET, "USD")]:
        with pytest.raises(ValueError, match="share class / currency"):
            plan.official_quote(page, isin, currency)


def test_plan_only_appends_new_dates_and_never_changes_the_original_series():
    series, incoming, quote = sample()
    before = deepcopy(series)
    incoming[0] = {**incoming[0], "value": incoming[0]["value"] + .0001}
    result = plan.prepare_plan(ASSET, series, incoming, quote, AS_OF)
    assert result["status"] == "CANDIDATE_VALIDATED"
    assert result["overlap_checks"] == 5
    assert len(result["append_only_points"]) == 5
    assert result["append_only_points"][0]["date"] == "2026-10-12"
    assert result["read_only"] is True
    assert series == before


@pytest.mark.parametrize("problem", ["source", "currency", "short_overlap", "last_overlap", "different_nav",
                                     "quote", "stale", "duplicate", "future", "nan", "negative", "large_jump", "gap"])
def test_uncertain_or_corrupt_data_is_rejected(problem):
    series, incoming, quote = sample()
    if problem == "source": series["source_listing_id"] = "EODHD:" + ASSET
    elif problem == "currency": series["source_currency"] = "USD"
    elif problem == "short_overlap": incoming = incoming[1:]
    elif problem == "last_overlap": incoming = [point for point in incoming if point["date"] != series["last_date"]]
    elif problem == "different_nav": incoming[0] = {**incoming[0], "value": 15}
    elif problem == "quote": quote["value"] = 99
    elif problem == "stale":
        incoming = incoming[:5]
        quote = dict(incoming[-1])
    elif problem == "duplicate": incoming.append(dict(incoming[0]))
    elif problem == "future": incoming.append({"date": "2026-10-19", "value": 31})
    elif problem == "nan": incoming[-2]["value"] = float("nan")
    elif problem == "negative": incoming[-2]["value"] = -1
    elif problem == "large_jump": incoming[-2]["value"] = 99
    elif problem == "gap":
        incoming[-1] = {"date": "2026-10-18", "value": 30.16}
        incoming = incoming[:5] + [incoming[-1]]
        quote = dict(incoming[-1])
    with pytest.raises(ValueError):
        plan.prepare_plan(ASSET, series, incoming, quote, AS_OF)
