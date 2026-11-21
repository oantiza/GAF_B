from datetime import date
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.stress_analytics import stress_windows


def points(*rows):
    return [{"date": item[0], "value": item[1]} for item in rows]


def by_id(result):
    return {item["id"]: item for item in result}


def test_covid_uses_internal_locf_renormalises_and_reports_worst_asset():
    series = {
        "A": points(
            ("2020-02-19", 100), ("2020-03-01", 80), ("2020-03-23", 70),
            ("2020-04-01", 100), ("2020-05-01", 100),
        ),
        "B": points(
            ("2020-02-20", 200), ("2020-03-01", 180), ("2020-03-23", 160),
            ("2020-04-02", 200), ("2020-05-01", 200),
        ),
        # More than five business days after 19 February: excluded.
        "LATE": points(("2020-03-02", 100), ("2020-05-01", 90)),
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
        "ON_TIME": points(
            ("2022-01-07", 100), ("2022-06-01", 85), ("2022-10-31", 80),
            ("2023-02-01", 100), ("2023-03-01", 105),
        ),
        "TOO_LATE": points(("2022-01-10", 100), ("2023-03-01", 90)),
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
    series = {
        "SHORT": points(
            ("2020-02-19", 100), ("2020-03-23", 70), ("2020-04-01", 80),
        ),
        "LONG": points(
            ("2020-02-19", 100), ("2020-03-23", 80), ("2020-04-01", 90),
            ("2020-06-01", 120),
        ),
    }
    covid = by_id(stress_windows(series, {"SHORT": 0.5, "LONG": 0.5}, today="2020-06-01"))["COVID"]

    assert covid["common_data_end_date"] == "2020-04-01"
    assert covid["end_date"] == "2020-03-23"
    assert covid["recovery_status"] == "NOT_RECOVERED"
    assert covid["recovery_date"] is None
    assert covid["recovery_days"] is None
    assert covid["remaining_to_recover_pct"] == pytest.approx(15.0)


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
        "COVERED": points(
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
            {"date": "2020-03-23", "value": 80},
            {"date": "2020-03-23", "value": 70},
            {"date": "2020-04-01", "value": 100},
            {"date": "2030-01-01", "value": 500},
        ]
    }
    covid = by_id(stress_windows(series, {"A": 1}, today="2020-04-01"))["COVID"]

    assert covid["drawdown_pct"] == -30.0
    assert covid["common_data_end_date"] == "2020-04-01"
