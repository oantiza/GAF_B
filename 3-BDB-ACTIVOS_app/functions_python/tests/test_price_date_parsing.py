from datetime import datetime, timedelta, date
from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from optimization.repository import _parse_date


def test_iso_fast_path_matches_original_parser_over_fifteen_years():
    for offset in range(15 * 366):
        value = (date(2012, 1, 1) + timedelta(days=offset)).isoformat()
        assert _parse_date(value) == datetime.strptime(value, "%Y-%m-%d").date()


@pytest.mark.parametrize("value", ["2024-2-9", "2024-02-9", "2024-2-09", "２０２４-02-29"])
def test_legacy_date_acceptance_is_preserved(value):
    assert _parse_date(value) == datetime.strptime(value, "%Y-%m-%d").date()


@pytest.mark.parametrize("value", [None, 20240101, "", "2024-02-30", "2023-02-29", "2024-W01-1", "20240101", "2024-01-01T00:00:00", "2024-00-01", "2024-13-01", "2024-01-00"])
def test_rejected_dates_keep_the_original_error(value):
    with pytest.raises((TypeError, ValueError)) as expected:
        datetime.strptime(value, "%Y-%m-%d").date()
    with pytest.raises(type(expected.value)) as actual:
        _parse_date(value)
    assert str(actual.value) == str(expected.value)
