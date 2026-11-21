"""
Ola A2 (A2.1 y A2.7): endurecimiento de lectura y limites app-owned.

Run: `python -m pytest functions_python/tests/test_a2_hardening.py -q`
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel.firestore_client import FirestoreReader, _unique_ids, _valid_asset_id  # noqa: E402
from portfolios.repository import (  # noqa: E402
    InvalidPortfolio,
    MAX_PORTFOLIOS_PER_USER,
    save_portfolio,
)


class ExplodingDb:
    """Si el lector toca Firestore con un id invalido, el test explota."""

    def collection(self, *args, **kwargs):
        raise AssertionError("no debe construirse ninguna ruta de Firestore")


class TestAssetIdValidation:
    def test_path_traversal_ids_are_treated_as_missing(self):
        reader = FirestoreReader(db=ExplodingDb())
        # Ids con separador de ruta: jamas deben tocar Firestore.
        assert reader.get_asset("X/holdings/latest") is None
        assert reader.get_asset("../assets") is None
        assert reader.get_asset("a/b") is None
        assert reader.get_metrics_latest("X/metrics/latest") is None
        assert reader.get_holdings("X/holdings/latest") is None

    def test_valid_ids_pass_through_to_firestore(self):
        reader = FirestoreReader(db=ExplodingDb())
        # Un id legitimo SI llega a Firestore (aqui, el stub explota: correcto).
        with pytest.raises(AssertionError):
            reader.get_asset("IE00B4L5Y983")

    def test_unique_ids_filters_invalid_entries(self):
        assert _unique_ids(["IE00B4L5Y983", "X/holdings/latest", "GSPC", "GSPC"]) == [
            "IE00B4L5Y983",
            "GSPC",
        ]

    def test_alphabet_matches_master_ids(self):
        for good in ("IE00B4L5Y983", "GSPC", "MOCK-FUND_1", "a.b"):
            assert _valid_asset_id(good), good
        for bad in ("", None, 42, "a/b", "a b", "a" * 129):
            assert not _valid_asset_id(bad), bad


class FakePortfolioStore:
    def __init__(self, existing: int, has_doc: bool = False):
        self.existing = existing
        self.has_doc = has_doc
        self.saved = []

    def count(self, uid):
        return self.existing

    def get(self, uid, portfolio_id):
        return {"portfolio_id": portfolio_id} if self.has_doc else None

    def save(self, uid, portfolio_id, doc):
        self.saved.append(portfolio_id)


def _portfolio_payload():
    return {
        "portfolio_id": "cartera-1",
        "name": "Cartera 1",
        "positions": [
            {"asset_id": "IE00B4L5Y983", "weight_percent": 60},
            {"asset_id": "LU0996182563", "weight_percent": 40},
        ],
    }


class TestPortfolioCap:
    def test_new_portfolio_over_cap_is_rejected(self):
        store = FakePortfolioStore(existing=MAX_PORTFOLIOS_PER_USER, has_doc=False)
        with pytest.raises(InvalidPortfolio):
            save_portfolio(store, "uid", _portfolio_payload())
        assert store.saved == []

    def test_overwriting_existing_portfolio_is_always_allowed(self):
        store = FakePortfolioStore(existing=MAX_PORTFOLIOS_PER_USER, has_doc=True)
        result = save_portfolio(store, "uid", _portfolio_payload())
        assert store.saved == ["cartera-1"]
        assert result["portfolio_id"] == "cartera-1"
