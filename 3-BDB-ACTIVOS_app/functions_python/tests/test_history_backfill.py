# -*- coding: utf-8 -*-
"""Logica pura de history_backfill: resolucion de simbolo, forma de docs, extraccion de pistas."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import history_backfill as hb  # noqa: E402
import price_refresh  # noqa: E402


def _item(code, exchange, isin=None, **extra):
    base = {"Code": code, "Exchange": exchange, "Name": code, "Type": "FUND",
            "Country": "LU", "Currency": "EUR", "ISIN": isin}
    base.update(extra)
    return base


def test_choose_search_match_prefers_eufund_for_funds():
    chosen = hb.choose_search_match("LU0000000001", "FUND", [
        _item("AAA", "F", "LU0000000001"),
        _item("LU0000000001", "EUFUND", "LU0000000001"),
    ])
    assert chosen["symbol"] == "LU0000000001.EUFUND"
    assert chosen["exact_isin"] is True
    assert "AAA.F" in chosen["alternatives"]


def test_choose_search_match_primary_then_first():
    chosen = hb.choose_search_match("US0000000001", "STOCK", [
        _item("AAA", "F", "US0000000001"),
        _item("AAA", "US", "US0000000001", isPrimary=True),
    ])
    assert chosen["symbol"] == "AAA.US"
    fallback = hb.choose_search_match("US0000000001", "STOCK", [_item("BBB", "PA", "XX0000000009")])
    assert fallback["symbol"] == "BBB.PA"
    assert fallback["exact_isin"] is False
    assert hb.choose_search_match("US0000000001", "STOCK", []) is None


def test_build_year_docs_shape_matches_production():
    points = [
        {"date": "2025-12-30", "value": 10.0},
        {"date": "2026-01-02", "value": 11.0,
         "source_currency": "USD", "source_value": 12.0, "fx_pair": "EURUSD.FOREX", "fx_rate": 1.09},
    ]
    fx_meta = {"source_currency": "USD", "fx_pair": "EURUSD.FOREX", "minor_scale": 1.0,
               "fx_policy": "price_EUR = (price_source * scale) / EURMAJOR.FOREX"}
    docs = hb.build_year_docs("LU0000000001", "FUND", "LU0000000001.EUFUND", "USD",
                              points, fx_meta, "2026-07-02T10:00:00.000Z")
    assert [d["year"] for d in docs] == [2025, 2026]
    first = docs[0]
    assert first["document_id"] == "EODHD_LU0000000001_EUFUND_2025"
    assert first["schema_version"] == "asset-price-series.v1.2"
    assert first["series_type"] == "NAV"
    assert first["currency"] == "EUR"
    assert first["source_currency"] == "USD"
    assert first["fx_pair"] == "EURUSD.FOREX"
    assert first["observations_count"] == 1
    assert first["source_listing_id"] == "EODHD:LU0000000001.EUFUND"
    # sin claves con None
    for doc in docs:
        assert all(v is not None for v in doc.values())


def test_build_year_docs_eur_has_no_fx_keys():
    docs = hb.build_year_docs("ES0000000001", "ETF", "AAA.MC", "EUR",
                              [{"date": "2026-01-02", "value": 1.5}],
                              {"source_currency": "EUR"}, "2026-07-02T10:00:00.000Z")
    assert docs[0]["series_type"] == "ADJUSTED_CLOSE"
    assert "fx_pair" not in docs[0] and "fx_policy" not in docs[0] and "minor_scale" not in docs[0]


def test_root_extractors():
    d = {
        "identity": {"name": "Fondo X", "currency": "usd"},
        "identifiers": {"eodhd_code": None},
        "listings": [{"eodhd_code": "XXX.EUFUND", "currency": "USD"}],
        "classification": {"asset_class": "FIXED_INCOME"},
    }
    assert hb.root_name(d) == "Fondo X"
    assert hb.root_currency(d) == "USD"
    assert hb.eodhd_hint(d) == "XXX.EUFUND"
    assert hb.root_type(d) == "FIXED_INCOME"
    assert hb.root_type({"instrument_type": "fund"}) == "FUND"
    assert hb.series_type_for("FUND") == "NAV"
    assert hb.series_type_for("INDEX") == "INDEX_LEVEL"
    assert hb.series_type_for(None) == "ADJUSTED_CLOSE"
    assert hb.load_doc_id("IE00B4L5Y983.LSE", 2020) == "EODHD_IE00B4L5Y983_LSE_2020"


def test_list_candidates_reuses_materialized_inventory(monkeypatch):
    rows = [
        {"asset_id": "ES0000000001", "canonical_active": True, "points": 0,
         "name": "Sin serie", "type": "FUND", "symbol": "A.EUFUND", "currency": "EUR"},
        {"asset_id": "ES0000000012", "canonical_active": True, "points": 100,
         "name": "Con serie", "type": "ETF", "symbol": "B.MC", "currency": "EUR"},
        {"asset_id": "SYNTHETIC", "canonical_active": False, "points": 0,
         "name": "Excluido", "type": "OTHER", "symbol": None, "currency": None},
    ]

    class Snap:
        exists = True
        def to_dict(self):
            return {"schema_version": "admin-asset-inventory.v1", "generated_at": "now", "rows": rows}

    class Doc:
        def get(self): return Snap()

    class Collection:
        def document(self, doc_id):
            assert doc_id == "admin_asset_inventory"
            return Doc()

    class Db:
        def collection(self, name):
            assert name == "meta"  # delata cualquier fallback N+1 a assets
            return Collection()

    monkeypatch.setattr(price_refresh, "_master_db", lambda: Db())

    result = hb.list_candidates()

    assert result["total_roots"] == 3
    assert result["excluded"] == 1
    assert result["with_series"] == 1
    assert [item["asset_id"] for item in result["candidates"]] == ["ES0000000001"]
