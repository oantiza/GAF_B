import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ecb_rates  # noqa: E402


@pytest.fixture
def yc_jsondata_fixture():
    """Recorte fiel del SDMX jsondata devuelto por ECB Data Portal."""
    return {
        "header": {"id": "fixture", "test": False, "sender": {"id": "ECB"}},
        "dataSets": [{
            "action": "Replace",
            "series": {
                "0:0:0:0:0:0:0": {"observations": {"0": [2.32218836]}},
                "0:0:0:0:0:0:1": {"observations": {"0": [2.413792025]}},
                "0:0:0:0:0:0:2": {"observations": {}},
                "0:0:0:0:0:0:3": {"observations": {"0": [2.559879765]}},
            },
        }],
        "structure": {"dimensions": {
            "series": [
                {"id": "FREQ", "values": [{"id": "B"}]},
                {"id": "REF_AREA", "values": [{"id": "U2"}]},
                {"id": "CURRENCY", "values": [{"id": "EUR"}]},
                {"id": "PROVIDER_FM", "values": [{"id": "4F"}]},
                {"id": "INSTRUMENT_FM", "values": [{"id": "G_N_A"}]},
                {"id": "PROVIDER_FM_ID", "values": [{"id": "SV_C_YM"}]},
                {"id": "DATA_TYPE_FM", "values": [
                    {"id": "SR_3M"}, {"id": "SR_6M"}, {"id": "SR_9M"}, {"id": "SR_1Y"},
                ]},
            ],
            "observation": [{"id": "TIME_PERIOD", "values": [{"id": "2026-07-09"}]}],
        }},
    }


def test_parse_latest_csv_uses_latest_valid_observation():
    payload = (
        "TIME_PERIOD,OBS_VALUE\n"
        "2026-07-08,2.181\n"
        "bad-date,999\n"
        "2026-07-09,2.182\n"
    )

    assert ecb_rates._parse_latest_csv(payload) == {
        "date": "2026-07-09",
        "value": 2.182,
    }


def test_parse_latest_csv_rejects_missing_or_implausible_values():
    for payload in (
        "TIME_PERIOD,OBS_VALUE\n",
        "TIME_PERIOD,OBS_VALUE\n2026-07-09,\n",
        "TIME_PERIOD,OBS_VALUE\n2026-07-09,999\n",
    ):
        try:
            ecb_rates._parse_latest_csv(payload)
        except ValueError as exc:
            assert "sin observaciones" in str(exc)
        else:
            raise AssertionError("se esperaba ValueError")


def test_weighted_average_carries_last_business_day_over_weekend():
    result = ecb_rates._weighted_average_percent(
        [
            (ecb_rates.date(2026, 7, 3), 2.0),
            (ecb_rates.date(2026, 7, 6), 3.0),
        ],
        ecb_rates.date(2026, 7, 3),
        ecb_rates.date(2026, 7, 6),
    )

    assert result["rate"] == 0.0225
    assert result["coverage_ratio"] == 1.0
    assert result["observations"] == 2
    assert result["first_observation_date"] == "2026-07-03"
    assert result["last_observation_date"] == "2026-07-06"


def test_weighted_average_reports_partial_pre_inception_coverage():
    result = ecb_rates._weighted_average_percent(
        [(ecb_rates.date(2019, 10, 1), -0.55)],
        ecb_rates.date(2019, 9, 29),
        ecb_rates.date(2019, 10, 2),
    )

    assert result["rate"] == -0.0055
    assert result["coverage_ratio"] == 0.5
    assert result["first_date"] == "2019-10-01"


def test_resolve_window_average_uses_cache(monkeypatch):
    calls = []
    payload = "TIME_PERIOD,OBS_VALUE\n2026-07-03,2.0\n2026-07-06,3.0\n"

    def fake_http(url, timeout=10):
        calls.append((url, timeout))
        return payload

    monkeypatch.setattr(ecb_rates, "_http_text", fake_http)
    ecb_rates._estr_average_cache.clear()

    first = ecb_rates.resolve_estr_window_average("2026-07-03", "2026-07-06")
    second = ecb_rates.resolve_estr_window_average("2026-07-03", "2026-07-06")

    assert first == second
    assert first["rate"] == 0.0225
    assert len(calls) == 1
    assert "startPeriod=2026-06-19" in calls[0][0]
    assert calls[0][1] == 12


def test_resolve_window_average_negative_cache_after_an_outage(monkeypatch):
    # M-1 (quinta pasada, 17-10-2026): tras un fallo de red no se reintenta durante unos
    # minutos; el llamador cae a su respaldo al momento. Un 4xx no activa la cache negativa.
    import urllib.error
    from types import SimpleNamespace
    calls = []
    clock = SimpleNamespace(now=1000.0)
    outcome = {"error": urllib.error.URLError("timed out")}

    def fake_http(url, timeout=10):
        calls.append(timeout)
        if outcome["error"] is not None:
            raise outcome["error"]
        return "TIME_PERIOD,OBS_VALUE\n2026-07-03,2.0\n2026-07-06,3.0\n"

    monkeypatch.setattr(ecb_rates, "_http_text", fake_http)
    monkeypatch.setattr(ecb_rates.time, "monotonic", lambda: clock.now)
    ecb_rates.clear_estr_cache()

    def resolve(start, end, **kwargs):
        # Solo la pide la cartera real (I-6, sexta pasada).
        return ecb_rates.resolve_estr_window_average(start, end, negative_cache=True, **kwargs)

    try:
        with pytest.raises(urllib.error.URLError):
            resolve("2026-07-03", "2026-07-06", timeout=5)
        assert calls == [5]
        with pytest.raises(ecb_rates.EstrUnavailable):
            resolve("2026-07-01", "2026-07-06")  # otra ventana, sin llamada
        assert calls == [5]
        clock.now += ecb_rates._ESTR_NEGATIVE_TTL_SECONDS + 1
        outcome["error"] = None
        assert resolve("2026-07-03", "2026-07-06")["rate"] == 0.0225
        assert len(calls) == 2
        # Un 404 (ventana sin datos) no bloquea las demas ventanas.
        outcome["error"] = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with pytest.raises(urllib.error.HTTPError):
            resolve("2016-01-01", "2016-02-01")
        outcome["error"] = None
        assert resolve("2026-07-02", "2026-07-06")["rate"] > 0
        # M-13 (sexta pasada): un 429 no activa la cache negativa; un 5xx si.
        outcome["error"] = urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
        with pytest.raises(urllib.error.HTTPError):
            resolve("2026-06-01", "2026-07-06")
        outcome["error"] = None
        assert resolve("2026-06-02", "2026-07-06")["rate"] > 0
        outcome["error"] = urllib.error.HTTPError("u", 503, "Service Unavailable", {}, None)
        before = len(calls)
        with pytest.raises(urllib.error.HTTPError):
            resolve("2026-06-03", "2026-07-06")
        with pytest.raises(ecb_rates.EstrUnavailable):
            resolve("2026-06-04", "2026-07-06")
        assert len(calls) == before + 1
    finally:
        ecb_rates.clear_estr_cache()


def test_sin_cache_negativa_la_maestra_solo_pierde_el_activo_del_fallo(monkeypatch):
    """I-6 (sexta pasada; sonda probe5c de la revision): un unico fallo transitorio del BCE
    en el primer activo. Con la cache negativa global, los cuatro activos salian NO_RATE
    durante 5 minutos; sin ella (la maestra no la pide), solo el del fallo."""
    import urllib.error
    from datetime import date, timedelta
    import ingest_asset
    import metrics_refresh

    state = {"calls": 0}
    csv = "TIME_PERIOD,OBS_VALUE\n" + "\n".join(
        f"{(date(2019, 10, 1) + timedelta(days=i)).isoformat()},2.0" for i in range(0, 2600))

    def fake_http(url, timeout=10, headers=None):
        state["calls"] += 1
        if state["calls"] == 1:
            raise urllib.error.URLError("fallo transitorio")
        return csv

    def points(last):
        out, day, value = [], last - timedelta(days=4 * 366), 100.0
        while day <= last:
            if day.weekday() < 5:
                out.append({"date": day, "value": value})
                value *= 1.0003 + (0.004 if day.day % 2 else -0.004)
            day += timedelta(days=1)
        return out

    monkeypatch.setattr(ecb_rates, "_http_text", fake_http)
    ecb_rates.clear_estr_cache()
    try:
        status = []
        for index, last in enumerate((date(2026, 10, 15), date(2026, 10, 14), date(2026, 10, 13), date(2026, 10, 12))):
            doc = ingest_asset.build_metrics_latest(f"LU00000000{index:02d}", "FUND", points(last),
                                                    "2026-10-16T08:00:00Z",
                                                    risk_free_resolver=ingest_asset._estr_window_resolver)
            status.append("NO_RATE" if metrics_refresh.sharpe_without_rate(doc["windows"]) else "ok")
        assert status == ["NO_RATE", "ok", "ok", "ok"]
        assert state["calls"] > 2  # la maestra vuelve a preguntar tras el fallo
        # La cartera real si salta a su respaldo sin esperar tras un fallo suyo...
        state["calls"] = 0
        ecb_rates.clear_estr_cache()
        with pytest.raises(urllib.error.URLError):
            ecb_rates.resolve_estr_window_average("2025-10-01", "2026-10-01", negative_cache=True)
        with pytest.raises(ecb_rates.EstrUnavailable):
            ecb_rates.resolve_estr_window_average("2025-10-02", "2026-10-01", negative_cache=True)
        assert state["calls"] == 1
        # ...pero ese fallo no afecta a la maestra.
        assert ecb_rates.resolve_estr_window_average("2025-10-03", "2026-10-01")["rate"] == 0.02
    finally:
        ecb_rates.clear_estr_cache()


def test_get_ecb_rates_keeps_configured_order(monkeypatch):
    values = {"estr": 2.182, "dfr": 2.25, "mro": 2.4, "mlf": 2.65}

    def fake_fetch(series):
        return {"id": series["id"], "date": "2026-07-10", "value": values[series["id"]]}

    monkeypatch.setattr(ecb_rates, "_fetch_rate", fake_fetch)
    ecb_rates._shared_cache.clear()

    result = ecb_rates.get_ecb_rates({})

    assert result["schema_version"] == "ecb-rates.v1"
    assert [row["id"] for row in result["rates"]] == ["estr", "dfr", "mro", "mlf"]
    assert result["requested_count"] == 4
    assert result["live_count"] == 4
    assert result["source"] == "ECB_DATA_PORTAL"
    assert result["notes"] == ""
    assert result["retrieved_at"].endswith("Z")


def test_get_ecb_rates_returns_partial_result(monkeypatch):
    def fake_fetch(series):
        if series["id"] == "mro":
            raise OSError("temporary outage")
        return {"id": series["id"], "date": "2026-07-10", "value": 2.0}

    monkeypatch.setattr(ecb_rates, "_fetch_rate", fake_fetch)
    ecb_rates._shared_cache.clear()

    result = ecb_rates.get_ecb_rates({})

    assert [row["id"] for row in result["rates"]] == ["estr", "dfr", "mlf"]
    assert result["live_count"] == 3
    assert "mro: temporary outage" in result["notes"]
    # Auditoría 11-08 (P9): un resultado parcial NO se cachea 6 h.
    assert ecb_rates._shared_cache == {}


def test_get_ecb_rates_serves_complete_result_from_cache(monkeypatch):
    """Auditoría 11-08 (P9): la 2.ª llamada dentro del TTL no vuelve al BCE."""
    calls = []

    def fake_fetch(series):
        calls.append(series["id"])
        return {"id": series["id"], "date": "2026-07-10", "value": 2.0}

    monkeypatch.setattr(ecb_rates, "_fetch_rate", fake_fetch)
    ecb_rates._shared_cache.clear()

    first = ecb_rates.get_ecb_rates({})
    second = ecb_rates.get_ecb_rates({})

    assert first == second
    assert len(calls) == len(ecb_rates.RATE_SERIES)
    ecb_rates._shared_cache.clear()


def test_yield_curve_url_uses_verified_svensson_spot_series():
    aaa_url = ecb_rates._yield_curve_url(ecb_rates.YIELD_CURVES[0])
    all_url = ecb_rates._yield_curve_url(ecb_rates.YIELD_CURVES[1])

    assert "/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M+SR_6M+SR_9M+SR_1Y" in aaa_url
    assert "/YC/B.U2.EUR.4F.G_N_C.SV_C_YM." in all_url
    assert "SR_30Y" in aaa_url
    assert "lastNObservations=1" in aaa_url


def test_parse_yield_curve_jsondata_omits_missing_series(yc_jsondata_fixture):
    result = ecb_rates.parse_yield_curve_payload(yc_jsondata_fixture)

    assert result == {
        "as_of_date": "2026-07-09",
        "points": [
            {"maturity_years": 0.25, "yield_pct": 2.32218836},
            {"maturity_years": 0.5, "yield_pct": 2.41379202},
            {"maturity_years": 1.0, "yield_pct": 2.55987976},
        ],
    }


def test_parse_yield_curve_omits_stale_or_invalid_points(yc_jsondata_fixture):
    yc_jsondata_fixture["structure"]["dimensions"]["observation"][0]["values"].append({"id": "2026-07-08"})
    yc_jsondata_fixture["dataSets"][0]["series"]["0:0:0:0:0:0:0"]["observations"] = {"1": [2.1]}
    yc_jsondata_fixture["dataSets"][0]["series"]["0:0:0:0:0:0:1"]["observations"] = {"0": [999]}

    result = ecb_rates.parse_yield_curve_payload(yc_jsondata_fixture)

    assert result["as_of_date"] == "2026-07-09"
    assert result["points"] == [{"maturity_years": 1.0, "yield_pct": 2.55987976}]


def test_get_euro_yield_curve_returns_other_curve_when_aaa_fails(monkeypatch):
    def fake_fetch(curve):
        if curve["id"] == "aaa":
            raise OSError("temporary outage")
        return {
            "id": "all_bonds",
            "as_of_date": "2026-07-09",
            "points": [{"maturity_years": 0.25, "yield_pct": 2.4}],
        }

    monkeypatch.setattr(ecb_rates, "_fetch_yield_curve", fake_fetch)
    ecb_rates._shared_cache.clear()
    result = ecb_rates.get_euro_yield_curve({})

    assert result["schema_version"] == "ecb-yield-curve.v1"
    assert result["as_of_date"] == "2026-07-09"
    assert result["aaa"] == []
    assert result["all_bonds"] == [{"maturity_years": 0.25, "yield_pct": 2.4}]
    assert result["source"] == "ECB_DATA_PORTAL"
    assert "AAA: temporary outage" in result["notes"]
    assert "todos los bonos: 1/18 vencimientos disponibles" in result["notes"]


def test_get_euro_yield_curve_returns_empty_response_with_notes_when_both_curves_fail(monkeypatch):
    monkeypatch.setattr(ecb_rates, "_fetch_yield_curve", lambda _curve: (_ for _ in ()).throw(OSError("down")))
    ecb_rates._shared_cache.clear()

    result = ecb_rates.get_euro_yield_curve({})

    assert result["aaa"] == [] and result["all_bonds"] == []
    assert result["as_of_date"] is None
    assert "ninguna curva" in result["notes"] and "down" in result["notes"]
    assert "yield_curve" not in ecb_rates._shared_cache  # un fallo no se cachea


def test_estr_average_cache_has_a_cap(monkeypatch):
    ecb_rates.clear_estr_cache()
    monkeypatch.setattr(ecb_rates, "_http_text", lambda *_a, **_k: "")
    monkeypatch.setattr(ecb_rates, "_parse_observations_csv", lambda _t: [])
    monkeypatch.setattr(ecb_rates, "_weighted_average_percent", lambda *_a: {"average_pct": 2.0})
    for day in range(1, ecb_rates._ESTR_CACHE_MAX_ENTRIES + 10):
        end = date(2026, 1, 1) + timedelta(days=day)
        ecb_rates.resolve_estr_window_average("2026-01-01", end.isoformat())
    assert len(ecb_rates._estr_average_cache) == ecb_rates._ESTR_CACHE_MAX_ENTRIES
    ecb_rates.clear_estr_cache()


def test_build_yield_curve_never_mixes_observation_dates():
    result = ecb_rates.build_euro_yield_curve({
        "aaa": {"as_of_date": "2026-07-08", "points": [{"maturity_years": 1.0, "yield_pct": 2.5}]},
        "all_bonds": {"as_of_date": "2026-07-09", "points": [{"maturity_years": 1.0, "yield_pct": 2.7}]},
    })

    assert result["as_of_date"] == "2026-07-09"
    assert result["aaa"] == []
    assert result["all_bonds"] == [{"maturity_years": 1.0, "yield_pct": 2.7}]
    assert "AAA: omitida por fecha antigua 2026-07-08" in result["notes"]
