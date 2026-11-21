"""Precio congelado (valor excluido de cotizacion) prolongado plano hasta hoy — 01-10-2026."""
from copy import deepcopy
from datetime import date

from fund_history_quality import extend_frozen_price, policy_for, public_flags
import price_series_cache


POLICY = {"frozen_price": {"from": "2025-09-25", "value": 6.5}}


def _docs():
    return [
        {"points": [{"date": "2024-12-30", "value": 6.29}, {"date": "2024-12-31", "value": 6.3}], "last_date": "2024-12-31"},
        {"points": [{"date": "2026-09-03", "value": 6.5}, {"date": "2026-09-04", "value": 6.5}], "last_date": "2026-09-04",
         "metadata": {"extended_flat": True}},
    ]


def test_extends_only_the_latest_document_with_business_days_until_today():
    docs = _docs()
    original = deepcopy(docs)
    out = extend_frozen_price("X", docs, today=date(2026, 9, 9), policy=POLICY)  # miercoles
    assert docs == original, "no muta los originales"
    assert out[0] == original[0], "el documento antiguo no se toca"
    added = out[1]["points"][2:]
    assert [p["date"] for p in added] == ["2026-09-07", "2026-09-08", "2026-09-09"], "salta sabado y domingo"
    assert all(p["value"] == 6.5 for p in added)
    assert out[1]["last_date"] == "2026-09-09"
    assert out[1]["observations_count"] == 5
    assert out[1]["metadata"]["frozen_price_runtime"] is True
    assert out[1]["metadata"]["extended_flat"] is True, "conserva la metadata de la maestra"


def test_no_change_when_series_is_current_or_policy_absent():
    docs = _docs()
    assert extend_frozen_price("X", docs, today=date(2026, 9, 4), policy=POLICY) is docs
    assert extend_frozen_price("X", docs, today=date(2026, 9, 9), policy={}) is docs
    assert extend_frozen_price("X", [], today=date(2026, 9, 9), policy=POLICY) == []


def test_does_not_extend_a_series_that_ends_before_the_freeze():
    docs = [{"points": [{"date": "2025-09-01", "value": 6.1}]}]
    assert extend_frozen_price("X", docs, today=date(2026, 9, 9), policy=POLICY) is docs


def test_nh_hotel_policy_is_declared_and_applied_through_the_cache():
    policy = policy_for("ES0161560018")
    assert policy["frozen_price"] == {"from": "2025-09-15", "value": 6.5}
    assert "PRICE_FROZEN_DELISTED" in public_flags("ES0161560018")

    class Reader:
        def get_price_series(self, asset_id):
            return _docs()

    price_series_cache.clear_price_series_cache()
    docs = price_series_cache.cached_price_series(Reader(), "ES0161560018")
    last = docs[-1]["points"][-1]
    today = date.today()
    expected_last = today
    while expected_last.weekday() >= 5:
        expected_last = expected_last.fromordinal(expected_last.toordinal() - 1)
    assert last == {"date": expected_last.isoformat(), "value": 6.5}
    assert docs[-1]["points"][0]["date"] == "2026-09-03", "la serie real se conserva delante"
    price_series_cache.clear_price_series_cache()
