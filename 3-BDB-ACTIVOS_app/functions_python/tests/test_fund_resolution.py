import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fund_ingest
import ingest_asset

ISIN = "LU1084165304"
ROW = {"ISIN": ISIN, "SecId": "F00000TVF3", "Universe": "FO", "Name": "Fondo de prueba"}


def test_lookup_uses_current_host_and_exact_isin(monkeypatch):
    calls = []
    def get(url, **kwargs):
        calls.append((url, kwargs))
        return {"rows": [{**ROW, "ISIN": "LU0232524495"}, ROW]}
    monkeypatch.setattr(fund_ingest, "_get_json", get)
    result = fund_ingest.resolve_fund(ISIN.lower())
    assert result["sec_id"] == ROW["SecId"]
    assert calls[0][0].startswith("https://lt.morningstar.com/")
    assert calls[0][1]["params"]["term"] == ISIN
    assert calls[0][1]["timeout"] == 15


def test_lookup_provider_failure_is_not_unknown_isin(monkeypatch):
    def fail(*args, **kwargs):
        raise TimeoutError("sensitive-provider-detail")
    monkeypatch.setattr(fund_ingest, "_get_json", fail)
    with pytest.raises(fund_ingest.FundLookupUnavailable, match="no se ha descartado") as error:
        fund_ingest.resolve_fund(ISIN)
    assert "sensitive-provider-detail" not in str(error.value)


@pytest.mark.parametrize("payload", [{"error": "unauthorized"}, [], {"rows": None}, {"rows": [None]}])
def test_malformed_provider_response_is_not_not_found(monkeypatch, payload):
    monkeypatch.setattr(fund_ingest, "_get_json", lambda *a, **k: payload)
    with pytest.raises(fund_ingest.FundLookupUnavailable):
        fund_ingest.resolve_fund(ISIN)


def test_completed_empty_global_search_can_confirm_absence(monkeypatch):
    def get(*args, params, **kwargs):
        if params.get("universeIds"):
            raise TimeoutError()
        return {"rows": []}
    monkeypatch.setattr(fund_ingest, "_get_json", get)
    assert fund_ingest.resolve_fund(ISIN) is None


def test_transient_timeout_is_retried_once(monkeypatch):
    calls = []
    def get(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise TimeoutError()
        return {"rows": [ROW]}
    monkeypatch.setattr(fund_ingest, "_get_json", get)
    assert fund_ingest.resolve_fund(ISIN)["sec_id"] == ROW["SecId"]
    assert len(calls) == 2


@pytest.mark.parametrize("universe", ["ET", "ST", "EQ"])
def test_other_vehicles_never_become_funds(monkeypatch, universe):
    monkeypatch.setattr(fund_ingest, "_get_json", lambda *a, **k: {"rows": [{**ROW, "Universe": universe}]})
    assert fund_ingest.resolve_fund(ISIN) is None


def test_invalid_isin_does_not_call_provider(monkeypatch):
    monkeypatch.setattr(fund_ingest, "_get_json", lambda *a, **k: pytest.fail("network"))
    assert fund_ingest.resolve_fund("LU1084165305") is None


@pytest.mark.parametrize("price_match", [None, {"type_class": "OTHER", "type": "FUND", "symbol": ISIN + ".EUFUND"}])
def test_admin_ingestion_reports_retryable_outage_without_writes(monkeypatch, price_match):
    ref = SimpleNamespace(get=lambda: SimpleNamespace(exists=False))
    db = SimpleNamespace(collection=lambda _: SimpleNamespace(document=lambda _: ref))
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)
    monkeypatch.setattr(ingest_asset, "resolve_symbol", lambda _: price_match)
    def fail(_):
        raise fund_ingest.FundLookupUnavailable("Morningstar no está disponible. Inténtalo de nuevo.")
    monkeypatch.setattr(fund_ingest, "resolve_fund", fail)
    result = ingest_asset.ingest_one(ISIN, with_history=True, write=False)
    assert result["ok"] is False and result["applied"] is False
    assert result["retryable"] is True and result["error_code"] == "FUND_LOOKUP_UNAVAILABLE"
    assert "resolved" not in result
