from datetime import date, timedelta
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.stress_analytics import stress_windows


def points(*rows):
    return [{"date": item[0], "value": item[1]} for item in rows]


_CRISES = ((date(2020, 2, 19), date(2020, 3, 23)), (date(2022, 1, 1), date(2022, 10, 31)))


def observed(*rows):
    """`points`, with each gap of more than 14 days that opens inside a crisis filled every 7 days with the price before it.

    N03 (22-11-2026): a series with such a gap is now set aside from that crisis (GAP_IN_WINDOW). The fixtures below were
    written with two or three points per crisis and relied on the last price being carried across; the fill writes that
    same carried price as observations, up to the end of the crisis and never before its first day, so every hand result
    stays as it was and the series is observed through the crisis.
    """
    filled = []
    for (start, value), (following, _next_value) in zip(rows, rows[1:] + ((None, None),)):
        filled.append((start, value))
        if following is None:
            continue
        a, b = date.fromisoformat(start), date.fromisoformat(following)
        if (b - a).days <= 14:
            continue
        for crisis_start, crisis_end in _CRISES:
            if crisis_start <= a < crisis_end:
                day = a + timedelta(days=7)
                while day < b and day <= crisis_end:
                    filled.append((day.isoformat(), value))
                    day += timedelta(days=7)
    return points(*filled)


def by_id(result):
    return {item["id"]: item for item in result}


def test_covid_uses_internal_locf_renormalises_and_reports_worst_asset():
    series = {
        "A": observed(
            ("2020-02-19", 100), ("2020-03-01", 80), ("2020-03-23", 70),
            ("2020-04-01", 100), ("2020-05-01", 100),
        ),
        "B": observed(
            ("2020-02-20", 200), ("2020-03-01", 180), ("2020-03-23", 160),
            ("2020-04-02", 200), ("2020-05-01", 200),
        ),
        # More than five business days after 19 February: excluded.
        "LATE": observed(("2020-03-02", 100), ("2020-05-01", 90)),
    }
    covid = by_id(stress_windows(series, {"A": 50, "B": 30, "LATE": 20}, today="2020-05-01"))["COVID"]

    assert covid["start_date"] == "2020-02-20"
    assert covid["trough_date"] == "2020-03-23"
    assert covid["end_date"] == "2020-03-23"
    assert covid["drawdown_pct"] == pytest.approx(-26.25)
    assert covid["duration_days"] == 32
    assert covid["recovery_date"] == "2020-04-02"
    assert covid["recovery_days"] == 10
    assert covid["recovery_status"] == "RECOVERED"
    assert covid["remaining_to_recover_pct"] == 0.0
    assert covid["coverage"] == {"weight_pct": 80.0, "included_assets": 2, "total_assets": 3}
    assert covid["representative"] is True
    assert covid["worst_asset"] == {
        "asset_id": "A", "weight_pct": 62.5, "return_pct": -30.0, "contribution_pct": -18.75,
    }
    assert covid["excluded_assets"] == [{"asset_id": "LATE", "reason": "NO_DATA_AT_WINDOW_START"}]


def test_rates_window_accepts_first_business_week_and_rejects_later_start():
    series = {
        "ON_TIME": observed(
            ("2022-01-07", 100), ("2022-06-01", 85), ("2022-10-31", 80),
            ("2023-02-01", 100), ("2023-03-01", 105),
        ),
        "TOO_LATE": observed(("2022-01-10", 100), ("2023-03-01", 90)),
    }
    rates = by_id(stress_windows(series, {"ON_TIME": 0.7, "TOO_LATE": 0.3}, today=date(2023, 3, 1)))["RATES_2022"]

    # 1 January 2022 was Saturday; five business days ends on Friday 7 January.
    assert rates["start_date"] == "2022-01-07"
    assert rates["trough_date"] == "2022-10-31"
    assert rates["drawdown_pct"] == -20.0
    assert rates["duration_days"] == 297
    assert rates["recovery_date"] == "2023-02-01"
    assert rates["recovery_days"] == 93
    assert rates["coverage"]["weight_pct"] == 70.0
    assert rates["excluded_assets"] == [{"asset_id": "TOO_LATE", "reason": "NO_DATA_AT_WINDOW_START"}]


def test_common_history_removes_youngest_until_three_calendar_years():
    series = {
        "OLD": points(
            ("2010-01-01", 100), ("2020-01-01", 100), ("2021-06-01", 70),
            ("2022-06-01", 90), ("2024-01-01", 110),
        ),
        "MID": points(
            ("2020-01-01", 200), ("2021-06-01", 180), ("2022-06-01", 210),
            ("2024-01-01", 220),
        ),
        "YOUNG": points(("2023-01-01", 100), ("2024-01-01", 80)),
    }
    common = by_id(stress_windows(series, {"OLD": 50, "MID": 30, "YOUNG": 20}, today="2024-01-01"))["COMMON_HISTORY"]

    assert common["included_assets"] == ["OLD", "MID"]
    assert common["excluded_assets"] == [{"asset_id": "YOUNG", "reason": "YOUNGEST_TO_REACH_THREE_YEARS"}]
    assert common["start_date"] == "2020-01-01"
    assert common["configured_start_date"] == "2020-01-01"
    assert common["configured_end_date"] == "2024-01-01"
    assert common["common_data_end_date"] == "2024-01-01"
    assert common["coverage"] == {"weight_pct": 80.0, "included_assets": 2, "total_assets": 3}
    assert common["drawdown_pct"] == pytest.approx(-22.5)
    assert common["trough_date"] == "2021-06-01"
    assert common["worst_asset"]["asset_id"] == "OLD"
    assert common["recovery_date"] == "2024-01-01"


def test_common_history_keeps_one_even_when_three_years_are_unavailable():
    series = {
        "OLDER": points(("2022-01-01", 100), ("2024-01-01", 80)),
        "YOUNGER": points(("2023-01-01", 100), ("2024-01-01", 90)),
    }
    common = by_id(stress_windows(series, {"OLDER": 0.4, "YOUNGER": 0.6}, today="2024-01-01"))["COMMON_HISTORY"]

    assert common["included_assets"] == ["OLDER"]
    assert common["coverage"]["weight_pct"] == 40.0
    assert common["representative"] is False
    assert common["reason"] is None
    assert common["drawdown_pct"] == -20.0


def test_recovery_stops_at_earliest_last_date_and_never_extends_stale_series():
    # SHORT ends seven days before LONG, inside the bridged gap: it is not stopped, and the scenario ends with it.
    # Levels at 50/50: 23-03 0.5*0.7+0.5*0.8 = 0.75; 25-05 0.5*0.85+0.5*0.95 = 0.90, so 10 % left. LONG's 120
    # on 1 June would recover it, and is not used: it is after the last common date.
    series = {
        "SHORT": observed(
            ("2020-02-19", 100), ("2020-03-23", 70), ("2020-04-01", 80), ("2020-05-25", 85),
        ),
        "LONG": observed(
            ("2020-02-19", 100), ("2020-03-23", 80), ("2020-04-01", 90),
            ("2020-05-25", 95), ("2020-06-01", 120),
        ),
    }
    covid = by_id(stress_windows(series, {"SHORT": 0.5, "LONG": 0.5}, today="2020-06-01"))["COVID"]

    assert covid["excluded_assets"] == []
    assert covid["common_data_end_date"] == "2020-05-25"
    assert covid["end_date"] == "2020-03-23"
    assert covid["drawdown_pct"] == pytest.approx(-25.0)
    assert covid["recovery_status"] == "NOT_RECOVERED"
    assert covid["recovery_date"] is None
    assert covid["recovery_days"] is None
    assert covid["remaining_to_recover_pct"] == pytest.approx(10.0)


def test_a_stopped_series_is_set_aside_and_no_longer_cuts_the_recovery():
    # P1-06. SHORT stops on 1 April, 61 days before LONG. Before, it ended the crisis there: NOT_RECOVERED with
    # 15 % left. Now it is out with SERIES_ENDS_EARLY and the crisis is LONG's: -20 % on 23 March, back to 100
    # or more on 1 June (120), 70 days later. It measures 50 % of the portfolio, so it is not representative.
    series = {
        "SHORT": observed(("2020-02-19", 100), ("2020-03-23", 70), ("2020-04-01", 80)),
        "LONG": observed(
            ("2020-02-19", 100), ("2020-03-23", 80), ("2020-04-01", 90), ("2020-06-01", 120),
        ),
    }
    covid = by_id(stress_windows(series, {"SHORT": 0.5, "LONG": 0.5}, today="2020-06-01"))["COVID"]

    assert covid["excluded_assets"] == [{"asset_id": "SHORT", "reason": "SERIES_ENDS_EARLY"}]
    assert covid["included_assets"] == ["LONG"]
    assert covid["common_data_end_date"] == "2020-06-01"
    assert covid["drawdown_pct"] == pytest.approx(-20.0)
    assert covid["recovery_status"] == "RECOVERED"
    assert covid["recovery_date"] == "2020-06-01"
    assert covid["recovery_days"] == 70
    assert covid["remaining_to_recover_pct"] == 0.0
    assert covid["coverage"] == {"weight_pct": 50.0, "included_assets": 1, "total_assets": 2}
    assert covid["representative"] is False


@pytest.mark.parametrize("short_end, stopped", [("2020-05-18", False), ("2020-05-17", True)])
def test_stopped_means_more_than_fourteen_days_before_the_latest(short_end, stopped):
    # 1 June minus 14 days is 18 May: fourteen days is the gap that is bridged, fifteen is a stopped series.
    series = {
        "SHORT": observed(("2020-02-19", 100), ("2020-03-23", 70), (short_end, 90)),
        "LONG": observed(("2020-02-19", 100), ("2020-03-23", 80), ("2020-06-01", 120)),
    }
    result = stress_windows(series, {"SHORT": 0.5, "LONG": 0.5}, today="2020-06-01")

    expected = [{"asset_id": "SHORT", "reason": "SERIES_ENDS_EARLY"}] if stopped else []
    assert all(item["excluded_assets"][:len(expected)] == expected for item in (result[0], result[2]))
    assert by_id(result)["COVID"]["included_assets"] == (["LONG"] if stopped else ["SHORT", "LONG"])


def test_the_audit_case_sets_aside_the_stopped_fund_and_keeps_the_young_one():
    # P1-06, the auditor's example: A 2016-2026, B from 2021, C stopped in June 2022. Before, the common history
    # removed B (the youngest) and measured A and C until June 2022. Now C is out and A and B are measured from
    # 4 January 2021, at 50/50 among them. Levels: 30-06-2022 0.5*0.8+0.5*0.9 = 0.85, a -15 % fall from the
    # 1.0 of the first day; 02-01-2024 back to 1.0, 551 days after the trough; 20-11-2026 1.1.
    # The worst asset: A, 0.5 x -20 % = -10 %; B, 0.5 x -10 % = -5 %. The points of 2020 and January 2022 only give
    # the crises a first day; on 3 January 2022 the level is 0.5*0.95+0.5*1.0 = 0.975, not a new high.
    series = {
        "A": observed(("2016-01-04", 100), ("2020-02-19", 100), ("2021-01-04", 100), ("2022-01-03", 95),
                    ("2022-06-30", 80), ("2024-01-02", 100), ("2026-11-20", 110)),
        "B": observed(("2021-01-04", 50), ("2022-01-03", 50), ("2022-06-30", 45), ("2024-01-02", 50), ("2026-11-20", 55)),
        "C": observed(("2016-01-04", 10), ("2022-06-30", 10)),
    }
    result = by_id(stress_windows(series, {"A": 40, "B": 40, "C": 20}, today="2026-11-20"))
    common = result["COMMON_HISTORY"]

    assert common["included_assets"] == ["A", "B"]
    assert common["excluded_assets"] == [{"asset_id": "C", "reason": "SERIES_ENDS_EARLY"}]
    assert common["start_date"] == "2021-01-04"
    assert common["common_data_end_date"] == "2026-11-20"
    assert common["coverage"] == {"weight_pct": 80.0, "included_assets": 2, "total_assets": 3}
    assert common["peak_date"] == "2021-01-04"
    assert common["trough_date"] == "2022-06-30"
    assert common["drawdown_pct"] == pytest.approx(-15.0)
    assert common["recovery_date"] == "2024-01-02"
    assert common["recovery_days"] == 551
    assert common["worst_asset"]["asset_id"] == "A"
    assert common["worst_asset"]["contribution_pct"] == pytest.approx(-10.0)
    # The crises name C too, with the same reason, and B where it has no price.
    assert result["COVID"]["excluded_assets"] == [
        {"asset_id": "B", "reason": "NO_DATA_AT_WINDOW_START"},
        {"asset_id": "C", "reason": "SERIES_ENDS_EARLY"},
    ]
    assert result["RATES_2022"]["excluded_assets"] == [{"asset_id": "C", "reason": "SERIES_ENDS_EARLY"}]


def test_a_series_stopped_long_ago_no_longer_expels_every_live_asset():
    # P1-06: C ended in 2018 and A and B start in 2021. Before, the loop removed B and then A, the two live ones,
    # and the common history was C alone, 2014-2018.
    series = {
        "A": points(("2021-01-04", 100), ("2024-06-03", 90), ("2026-11-20", 110)),
        "B": points(("2021-01-04", 100), ("2024-06-03", 90), ("2026-11-20", 110)),
        "C": points(("2014-01-06", 100), ("2018-06-29", 120)),
    }
    common = by_id(stress_windows(series, {"A": 40, "B": 40, "C": 20}, today="2026-11-20"))["COMMON_HISTORY"]

    assert common["included_assets"] == ["A", "B"]
    assert common["excluded_assets"] == [{"asset_id": "C", "reason": "SERIES_ENDS_EARLY"}]
    assert common["drawdown_pct"] == pytest.approx(-10.0)


def test_a_frozen_price_extended_to_today_does_not_make_the_others_stopped():
    # NH Hotel (P1-04): its series is extended flat to today when read, so its last date says nothing about the
    # data. The others end 19 days before it; measured against NH they would all be stopped.
    nh = "ES0161560018"
    series = {
        nh: points(("2019-01-02", 6.5), ("2026-11-20", 6.5)),
        "A": points(("2019-01-02", 100), ("2020-03-23", 80), ("2026-11-01", 120)),
    }
    result = stress_windows(series, {nh: 10, "A": 90}, today="2026-11-20")

    assert not [item for scenario in result for item in scenario["excluded_assets"] if item["reason"] == "SERIES_ENDS_EARLY"]
    assert by_id(result)["COMMON_HISTORY"]["included_assets"] == [nh, "A"]
    assert by_id(result)["COMMON_HISTORY"]["common_data_end_date"] == "2026-11-01"


def test_no_drawdown_has_its_own_status_and_no_worst_asset():
    # P1-06. Never below the first day: before, "RECOVERED" in 1 day, and a worst asset with a 0 % contribution.
    series = {"A": observed(("2020-02-19", 100), ("2020-02-20", 101), ("2020-03-23", 105), ("2020-04-01", 106))}
    covid = by_id(stress_windows(series, {"A": 1}, today="2020-04-01"))["COVID"]

    assert covid["recovery_status"] == "NO_DRAWDOWN"
    assert covid["drawdown_pct"] == 0.0
    assert covid["trough_date"] == "2020-02-19"
    assert covid["duration_days"] == 0
    assert covid["recovery_date"] is None
    assert covid["recovery_days"] is None
    assert covid["remaining_to_recover_pct"] == 0.0
    assert covid["worst_asset"] is None
    assert covid["reason"] is None


def test_no_drawdown_when_the_data_ends_on_the_first_day():
    # Before: NOT_RECOVERED with 0 % left to recover.
    covid = by_id(stress_windows({"A": points(("2020-02-19", 100))}, {"A": 1}, today="2020-02-19"))["COVID"]

    assert covid["recovery_status"] == "NO_DRAWDOWN"
    assert covid["remaining_to_recover_pct"] == 0.0


def test_no_drawdown_survives_the_rounding_of_the_weights():
    # Weights 1, 6 and 15 renormalised add up to 0.9999999999999999, so flat prices start a hair below the
    # reference of 1: a fall of -1e-14 % that is not one.
    flat = observed(("2020-02-19", 100), ("2020-03-23", 100), ("2020-04-01", 100))
    covid = by_id(stress_windows({"A": flat, "B": flat, "C": flat}, {"A": 1, "B": 6, "C": 15}, today="2020-04-01"))["COVID"]

    assert covid["recovery_status"] == "NO_DRAWDOWN"
    assert covid["drawdown_pct"] == 0.0


def test_common_history_without_a_fall_from_any_high():
    series = {"A": points(("2019-01-02", 100), ("2020-03-23", 100), ("2022-10-31", 130), ("2024-01-02", 140))}
    common = by_id(stress_windows(series, {"A": 1}, today="2024-01-02"))["COMMON_HISTORY"]

    assert common["recovery_status"] == "NO_DRAWDOWN"
    assert common["peak_date"] == "2019-01-02"
    assert common["trough_date"] == "2019-01-02"
    assert common["duration_days"] == 0
    assert common["worst_asset"] is None


def test_a_tiny_real_fall_is_still_a_fall():
    series = {"A": observed(("2020-02-19", 100), ("2020-03-02", 99.99), ("2020-03-23", 100))}
    covid = by_id(stress_windows(series, {"A": 1}, today="2020-03-23"))["COVID"]

    assert covid["recovery_status"] == "RECOVERED"
    assert covid["drawdown_pct"] == pytest.approx(-0.01)
    assert covid["recovery_days"] == 21


def test_recovery_is_first_level_recovered_after_trough_even_inside_window():
    series = {
        "A": points(
            ("2020-02-19", 100),
            ("2020-02-25", 80),
            ("2020-03-10", 100),
            ("2020-03-23", 90),
            ("2020-04-01", 105),
        )
    }
    covid = by_id(stress_windows(series, {"A": 1.0}, today="2020-04-01"))["COVID"]

    assert covid["trough_date"] == "2020-02-25"
    assert covid["recovery_date"] == "2020-03-10"
    assert covid["recovery_days"] == 14


def test_partial_result_below_sixty_percent_is_calculated_but_not_representative():
    series = {
        "COVERED": observed(
            ("2020-02-19", 100), ("2020-03-23", 90), ("2020-04-01", 95),
        )
    }
    covid = by_id(stress_windows(series, {"COVERED": 59, "MISSING": 41}, today="2020-04-01"))["COVID"]

    assert covid["drawdown_pct"] == -10.0
    assert covid["coverage"] == {"weight_pct": 59.0, "included_assets": 1, "total_assets": 2}
    assert covid["representative"] is False
    assert covid["reason"] is None
    assert covid["excluded_assets"] == [{"asset_id": "MISSING", "reason": "NO_SERIES"}]


def test_no_data_still_returns_all_three_scenarios_with_reasons():
    result = stress_windows({}, {"A": 1.0}, today="2024-01-01")

    assert [item["id"] for item in result] == ["COVID", "RATES_2022", "COMMON_HISTORY"]
    assert [item["reason"] for item in result] == [
        "NO_ELIGIBLE_ASSETS", "NO_ELIGIBLE_ASSETS", "NO_ELIGIBLE_ASSETS",
    ]
    assert all(item["drawdown_pct"] is None for item in result)
    assert all(item["recovery_status"] == "NO_DATA" for item in result)


def test_declared_backend_exclusion_reason_is_preserved():
    result = stress_windows(
        {},
        {"BLOCKED": 1.0},
        today="2024-01-01",
        exclusion_reasons={"BLOCKED": "QUALITY_BLOCKED"},
    )

    assert all(
        item["excluded_assets"] == [{"asset_id": "BLOCKED", "reason": "QUALITY_BLOCKED"}]
        for item in result
    )
    assert all(item["end_date"] is None for item in result)
    assert all(item["remaining_to_recover_pct"] is None for item in result)


def test_no_positive_weights_returns_three_explicit_no_data_results():
    result = stress_windows({"A": points(("2020-01-01", 100))}, {"A": 0, "B": -1}, today="2024-01-01")

    assert len(result) == 3
    assert all(item["reason"] == "NO_POSITIVE_WEIGHTS" for item in result)
    assert all(item["coverage"] == {"weight_pct": 0.0, "included_assets": 0, "total_assets": 0} for item in result)


def test_today_discards_future_observations_and_duplicate_dates_use_last_value():
    series = {
        "A": [
            {"date": "2020-02-19", "value": 100},
            # N03: observed through the crisis (the price before the fall, as it was carried before).
            {"date": "2020-02-26", "value": 100},
            {"date": "2020-03-04", "value": 100},
            {"date": "2020-03-11", "value": 100},
            {"date": "2020-03-18", "value": 100},
            {"date": "2020-03-23", "value": 80},
            {"date": "2020-03-23", "value": 70},
            {"date": "2020-04-01", "value": 100},
            {"date": "2030-01-01", "value": 500},
        ]
    }
    covid = by_id(stress_windows(series, {"A": 1}, today="2020-04-01"))["COVID"]

    assert covid["drawdown_pct"] == -30.0
    assert covid["common_data_end_date"] == "2020-04-01"


# N03 (22-11-2026, approved by Oscar). A crisis only takes a series that is observed through it: more than
# MAX_BRIDGED_WEEK_GAP_DAYS (14) calendar days between two consecutive points inside the window set it aside with
# GAP_IN_WINDOW. Before, the last price was carried across the gap and the crisis came out flat.

def _business_days(first, last, value_of):
    day, out = date.fromisoformat(first), []
    while day <= date.fromisoformat(last):
        if day.weekday() < 5:
            out.append((day.isoformat(), value_of(day)))
        day += timedelta(days=1)
    return out


def _falls_thirty(day):
    # 100 on 19-02-2020, straight down to 70 on 23-03-2020 (33 days), 70 until 2021 and back to 100.
    if day <= date(2020, 2, 19):
        return 100.0
    if day <= date(2020, 3, 23):
        return 100.0 - 30.0 * (day - date(2020, 2, 19)).days / 33
    return 70.0 if day < date(2021, 1, 1) else 100.0


HOY_N03 = "2026-11-05"
# The audit's case: a quote on 19-02-2020 and the next one on 01-04-2020, then every business day.
GAPPED = [("2020-02-19", 100.0)] + _business_days(
    "2020-04-01", "2026-11-04", lambda day: 70.0 if day < date(2021, 1, 1) else 100.0,
)
DAILY = _business_days("2016-01-04", "2026-11-04", _falls_thirty)


def test_a_gap_inside_the_crisis_sets_the_series_aside_and_there_is_no_figure():
    # Before: 0,00 %, NO_DRAWDOWN, from 19-02 to 19-02, coverage 100 % and representative.
    covid = by_id(stress_windows({"A": points(*GAPPED)}, {"A": 1}, today=HOY_N03))["COVID"]

    assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
    assert covid["reason"] == "NO_ELIGIBLE_ASSETS"
    assert covid["drawdown_pct"] is None
    assert covid["recovery_status"] == "NO_DATA"
    assert covid["start_date"] is None
    assert covid["coverage"] == {"weight_pct": 0.0, "included_assets": 0, "total_assets": 1}
    assert covid["representative"] is False


def test_half_with_a_gap_measures_the_other_half_and_is_not_representative():
    # Before: 0,5 x 1 + 0,5 x 0,7 = -15 %, representative. Now A is out: the figure is B's, -30 %, on 50 % of the portfolio.
    covid = by_id(stress_windows(
        {"A": points(*GAPPED), "B": points(*DAILY)}, {"A": 0.5, "B": 0.5}, today=HOY_N03,
    ))["COVID"]

    assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
    assert covid["included_assets"] == ["B"]
    assert covid["drawdown_pct"] == pytest.approx(-30.0)
    assert covid["trough_date"] == "2020-03-23"
    assert covid["coverage"] == {"weight_pct": 50.0, "included_assets": 1, "total_assets": 2}
    assert covid["representative"] is False


def test_a_weekly_series_is_observed_and_keeps_its_figure():
    # Wednesdays: 19-02, 26-02, ..., 18-03, 25-03. Its lowest point inside the crisis is 18-03, 28 days into the fall:
    # 100 - 30 x 28 / 33 = 74,5454..., -25,4545 %.
    wednesdays = []
    day = date(2016, 1, 6)
    while day <= date(2026, 11, 4):
        wednesdays.append((day.isoformat(), _falls_thirty(day)))
        day += timedelta(days=7)
    covid = by_id(stress_windows({"W": points(*wednesdays)}, {"W": 1}, today=HOY_N03))["COVID"]

    assert covid["excluded_assets"] == []
    assert covid["trough_date"] == "2020-03-18"
    assert covid["drawdown_pct"] == pytest.approx(-30.0 * 28 / 33)
    assert covid["representative"] is True


@pytest.mark.parametrize("second_point, gapped", [("2020-03-04", False), ("2020-03-05", True)])
def test_a_gap_is_more_than_fourteen_days(second_point, gapped):
    # 19-02 to 04-03 is fourteen days, the gap a weekly series that misses one week leaves: bridged. Fifteen are not.
    series = {"A": points(("2020-02-19", 100), (second_point, 90), ("2020-03-11", 85), ("2020-03-18", 80),
                          ("2020-03-23", 80), ("2020-04-01", 90))}
    covid = by_id(stress_windows(series, {"A": 1}, today="2020-04-01"))["COVID"]

    if gapped:
        assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
        assert covid["drawdown_pct"] is None
    else:
        assert covid["excluded_assets"] == []
        assert covid["drawdown_pct"] == pytest.approx(-20.0)


@pytest.mark.parametrize("in_the_crisis, gapped", [
    # The last point of the crisis is on 09-03: fourteen days without prices until 23-03. Bridged.
    (["2020-02-19", "2020-02-24", "2020-03-02", "2020-03-09"], False),
    # On 08-03: fifteen. Out.
    (["2020-02-19", "2020-02-24", "2020-03-01", "2020-03-08"], True),
    # A pause that starts on the last day of the crisis leaves nothing in it without prices.
    (["2020-02-19", "2020-02-26", "2020-03-04", "2020-03-11", "2020-03-18", "2020-03-23"], False),
])
def test_the_last_stretch_runs_to_the_end_of_the_crisis(in_the_crisis, gapped):
    # The next quote is on 15-04, after the crisis. What counts is the part of the crisis without prices, not the
    # whole pause: from the last point inside it to 23-03.
    rows = [(day, 100.0 - index) for index, day in enumerate(in_the_crisis)] + [("2020-04-15", 100.0), ("2020-05-01", 101.0)]
    covid = by_id(stress_windows({"A": points(*rows)}, {"A": 1}, today="2020-05-01"))["COVID"]

    if gapped:
        assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
        assert covid["drawdown_pct"] is None
    else:
        assert covid["excluded_assets"] == []
        assert covid["drawdown_pct"] == pytest.approx(-(len(in_the_crisis) - 1))


def test_a_fund_suspended_in_2022_is_out_of_that_crisis_only():
    # Like the three LU funds of the base: no price from 25-02 to 18-07-2022. It still measures the COVID (flat, 0 %),
    # and the common history keeps its own rule: it is not a crisis window.
    def value(day):
        return 90.0 if date(2022, 1, 1) <= day < date(2023, 1, 1) else 100.0
    rows = [row for row in _business_days("2016-01-04", "2026-11-04", value)
            if not "2022-02-25" <= row[0] < "2022-07-18"]
    result = by_id(stress_windows({"F": points(*rows)}, {"F": 1}, today=HOY_N03))

    assert result["RATES_2022"]["excluded_assets"] == [{"asset_id": "F", "reason": "GAP_IN_WINDOW"}]
    assert result["RATES_2022"]["drawdown_pct"] is None
    assert result["COVID"]["excluded_assets"] == []
    assert result["COVID"]["drawdown_pct"] == 0.0
    assert result["COMMON_HISTORY"]["included_assets"] == ["F"]


# H1-05 (auditoria del 22-11-2026): a series that ends inside a crisis, with nothing after it. N03 took it to end there
# because SERIES_ENDS_EARLY would catch it, and that rule only sees a series that stops before another one: alone, with
# others that end on the same day, or beside a frozen-price asset (which does not set the end), it was never caught.

ENDS_ON_THE_FIRST_DAY = _business_days("2017-01-02", "2020-02-19", lambda day: 100.0)


def test_a_single_series_that_ends_on_the_first_day_of_the_crisis_is_out():
    # Before: 0,0 %, NO_DRAWDOWN, from 19-02 to 19-02, 100 % and representative. From its last price, 19-02-2020, to
    # the end of the crisis, 23-03-2020, there are 33 days without prices, more than 14.
    covid = by_id(stress_windows({"A": points(*ENDS_ON_THE_FIRST_DAY)}, {"A": 1}, today="2026-11-22"))["COVID"]

    assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
    assert covid["reason"] == "NO_ELIGIBLE_ASSETS"
    assert covid["drawdown_pct"] is None
    assert covid["recovery_status"] == "NO_DATA"
    assert covid["coverage"] == {"weight_pct": 0.0, "included_assets": 0, "total_assets": 1}
    assert covid["representative"] is False


def test_two_series_that_end_together_inside_the_crisis_are_both_out():
    # Neither stops before the other, so neither is SERIES_ENDS_EARLY; both leave 33 days of the crisis unobserved.
    other = _business_days("2017-01-02", "2020-02-19", lambda day: 50.0)
    covid = by_id(stress_windows(
        {"A": points(*ENDS_ON_THE_FIRST_DAY), "B": points(*other)}, {"A": 0.5, "B": 0.5}, today="2026-11-22",
    ))["COVID"]

    assert covid["excluded_assets"] == [
        {"asset_id": "A", "reason": "GAP_IN_WINDOW"}, {"asset_id": "B", "reason": "GAP_IN_WINDOW"},
    ]
    assert covid["drawdown_pct"] is None
    assert covid["representative"] is False


def test_a_dead_fund_beside_a_frozen_price_asset_is_out_and_the_other_half_is_measured():
    # The frozen-price asset (NH Hotel) does not set the end, so the dead fund was not stopped either. Before: 0,0 %,
    # 100 % and representative, from 19-02 to 19-02. Now the figure is NH's alone: 100 to 70 on 23-03, -30 %, on 50 %.
    nh = "ES0161560018"
    covid = by_id(stress_windows(
        {"F": points(*ENDS_ON_THE_FIRST_DAY), nh: points(*DAILY)}, {"F": 0.5, nh: 0.5}, today="2026-11-22",
    ))["COVID"]

    assert covid["excluded_assets"] == [{"asset_id": "F", "reason": "GAP_IN_WINDOW"}]
    assert covid["included_assets"] == [nh]
    assert covid["drawdown_pct"] == pytest.approx(-30.0)
    assert covid["trough_date"] == "2020-03-23"
    assert covid["coverage"] == {"weight_pct": 50.0, "included_assets": 1, "total_assets": 2}
    assert covid["representative"] is False


def test_a_series_that_ends_early_in_2022_is_out_of_that_crisis():
    # Before: 100 to 99,52 in three days, -0,48 %, representative. From 05-01-2022 to 31-10-2022 there are 299 days
    # without prices.
    rows = _business_days("2018-01-02", "2021-12-31", lambda day: 100.0) + [
        ("2022-01-03", 100.0), ("2022-01-04", 99.8), ("2022-01-05", 99.52),
    ]
    rates = by_id(stress_windows({"A": points(*rows)}, {"A": 1}, today="2026-11-22"))["RATES_2022"]

    assert rates["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
    assert rates["drawdown_pct"] is None
    assert rates["representative"] is False


@pytest.mark.parametrize("in_the_crisis, gapped", [
    # Its last price on 09-03-2020: fourteen days to 23-03. Bridged, and the fall is measured to its last price:
    # 100 -> 97, -3 %.
    (["2020-02-19", "2020-02-24", "2020-03-02", "2020-03-09"], False),
    # On 08-03: fifteen. Out.
    (["2020-02-19", "2020-02-24", "2020-03-01", "2020-03-08"], True),
])
def test_with_nothing_after_it_the_last_stretch_still_runs_to_the_end_of_the_crisis(in_the_crisis, gapped):
    # The same tolerance as a gap with a quote after the crisis (test_the_last_stretch_runs_to_the_end_of_the_crisis).
    rows = [(day, 100.0 - index) for index, day in enumerate(in_the_crisis)]
    covid = by_id(stress_windows({"A": points(*rows)}, {"A": 1}, today="2026-11-22"))["COVID"]

    if gapped:
        assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
        assert covid["drawdown_pct"] is None
    else:
        assert covid["excluded_assets"] == []
        assert covid["drawdown_pct"] == pytest.approx(-3.0)
        assert covid["end_date"] == "2020-03-09"


@pytest.mark.parametrize("last_point, gapped", [("2020-02-25", False), ("2020-02-24", True)])
def test_a_crisis_in_course_is_observed_up_to_today(last_point, gapped):
    # On 10-03-2020 the window ends today, not on 23-03: a series up to 25-02 leaves 14 days unobserved, bridged
    # (flat, 0 %); up to 24-02, fifteen, out.
    rows = _business_days("2020-01-02", last_point, lambda day: 100.0)
    covid = by_id(stress_windows({"A": points(*rows)}, {"A": 1}, today="2020-03-10"))["COVID"]

    if gapped:
        assert covid["excluded_assets"] == [{"asset_id": "A", "reason": "GAP_IN_WINDOW"}]
        assert covid["drawdown_pct"] is None
    else:
        assert covid["excluded_assets"] == []
        assert covid["drawdown_pct"] == 0.0
