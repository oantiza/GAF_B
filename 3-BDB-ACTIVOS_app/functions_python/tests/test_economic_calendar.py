import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import economic_calendar  # noqa: E402


NOW = datetime(2026, 7, 10, 10, 0, tzinfo=economic_calendar.MADRID)


def _reset(monkeypatch):
    economic_calendar._PRIMARY_CACHE.update({"fetched_at": None, "events": None, "source": None})
    monkeypatch.setattr(economic_calendar, "_now_madrid", lambda: NOW)


def test_json_feed_is_filtered_by_date_and_country(monkeypatch):
    _reset(monkeypatch)
    payload = json.dumps([
        {
            "title": "US CPI m/m",
            "country": "USD",
            "date": "2026-07-10T14:30:00+02:00",
            "impact": "High",
            "forecast": "0.3%",
            "previous": "0.2%",
        },
        {
            "title": "ECB speech",
            "country": "EUR",
            "date": "2026-07-10T16:00:00+02:00",
            "impact": "Medium",
        },
        {
            "title": "Old event",
            "country": "USD",
            "date": "2026-07-09T12:00:00+02:00",
            "impact": "Low",
        },
    ]).encode()
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: payload)

    result = economic_calendar.get_economic_calendar({
        "from": "2026-07-10",
        "to": "2026-07-10",
        "country": "US",
    })

    assert result["source"] == "FOREX_FACTORY_JSON_LIVE"
    assert result["count"] == 1
    assert result["events"][0]["type"] == "US CPI m/m"
    assert result["events"][0]["source"] == "FOREX_FACTORY"
    assert result["events"][0]["estimate"] == "0.3%"
    assert result["events"][0]["previous"] == "0.2%"
    assert result["events"][0]["date"] == "2026-07-10T14:30:00+02:00"
    assert result["status"] == "OK"


def test_xml_feed_is_used_when_json_is_unavailable(monkeypatch):
    _reset(monkeypatch)
    xml = b"""<?xml version=\"1.0\" encoding=\"windows-1252\"?>
    <weeklyevents><event><title>US CPI m/m</title><country>USD</country>
    <date>07-06-2026</date><time>1:00am</time><impact>High</impact>
    <forecast>0.3%</forecast><previous>0.2%</previous></event></weeklyevents>"""

    def fake_read(url):
        if url.endswith(".json"):
            raise OSError("limited")
        return xml

    monkeypatch.setattr(economic_calendar, "_read_url", fake_read)

    result = economic_calendar.get_economic_calendar({"from": "2026-07-06", "to": "2026-07-06"})

    assert result["source"] == "FOREX_FACTORY_XML_LIVE"
    assert result["count"] == 1
    assert result["events"][0]["date"] == "2026-07-06T03:00:00+02:00"


def _feed(*dates):
    return json.dumps([
        {"title": f"Evento {d}", "country": "USD", "date": f"{d}T14:30:00+02:00", "impact": "High"}
        for d in dates
    ]).encode()


def test_range_crossing_sunday_says_where_the_source_ends(monkeypatch):
    _reset(monkeypatch)  # viernes 10-07-2026; la semana acaba el domingo 12
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: _feed("2026-07-10"))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-17"})

    assert result["status"] == "OK"
    assert result["count"] == 1
    assert result["covers_to"] == "2026-07-12"
    assert "solo cubre hasta el domingo 12 de julio de 2026" in result["note"]


def test_range_crossing_sunday_without_events_is_not_plain_empty(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: _feed("2026-07-08"))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-17"})

    assert result["status"] == "NO_EVENTS_IN_COVERAGE"
    assert result["source"] == "FOREX_FACTORY_JSON_LIVE"
    assert "solo cubre hasta" in result["note"]


def test_range_entirely_outside_the_source_has_its_own_state(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: _feed("2026-07-10"))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-14", "to": "2026-07-20"})

    assert result["status"] == "OUT_OF_SOURCE_RANGE"
    assert result["source"] == "OUT_OF_SOURCE_RANGE"
    assert result["events"] == []
    assert "fuera del alcance" in result["note"]
    assert "no se encontraron" not in result["note"].lower()


def test_source_down_is_an_error_not_an_empty_calendar(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: (_ for _ in ()).throw(OSError("429")))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-17"})

    assert result["status"] == "SOURCE_ERROR"
    assert result["source"] == "ERROR"
    assert result["count"] == 0


def test_strategy_report_fallback_is_gone():
    assert not hasattr(economic_calendar, "_load_grounded_events")
    assert not hasattr(economic_calendar, "_get_strategy_report")


def test_invalid_or_excessive_ranges_return_a_stable_contract(monkeypatch):
    _reset(monkeypatch)

    reversed_result = economic_calendar.get_economic_calendar({"from": "2026-07-11", "to": "2026-07-10"})
    long_result = economic_calendar.get_economic_calendar({"from": "2026-07-01", "to": "2026-09-01"})

    assert reversed_result["source"] == "INVALID_REQUEST"
    assert reversed_result["events"] == []
    assert reversed_result["count"] == 0
    assert long_result["source"] == "INVALID_REQUEST"
    assert "31 dias" in long_result["note"]


# --- Auditoria 20-11-2026 (P2-10): la descarga vieja dice su antiguedad ---------------------------------------------

def test_stale_cache_says_how_old_the_download_is(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: _feed("2026-07-10"))
    economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-10"})  # llena la cache en NOW
    # 40 minutos despues (cache caducada, 15 min) la fuente cae: se sirve la guardada, y se dice de cuando es.
    monkeypatch.setattr(economic_calendar, "_now_madrid", lambda: NOW + timedelta(minutes=40))
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: (_ for _ in ()).throw(OSError("429")))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-10"})

    assert result["source"].endswith("_STALE_CACHE")
    assert result["count"] == 1
    assert "hace 40 min" in result["note"]


def test_stale_cache_hours_over_two_hours(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: _feed("2026-07-10"))
    economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-10"})
    monkeypatch.setattr(economic_calendar, "_now_madrid", lambda: NOW + timedelta(hours=3, minutes=5))
    monkeypatch.setattr(economic_calendar, "_read_url", lambda _url: (_ for _ in ()).throw(OSError("429")))

    result = economic_calendar.get_economic_calendar({"from": "2026-07-10", "to": "2026-07-10"})

    assert "hace 3 h" in result["note"]  # 185 min // 60
