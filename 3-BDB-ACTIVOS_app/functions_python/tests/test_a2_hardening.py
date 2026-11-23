"""
Ola A2 (A2.1 y A2.7): endurecimiento de lectura y limites app-owned.

Run: `python -m pytest functions_python/tests/test_a2_hardening.py -q`
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel.firestore_client import _valid_asset_id  # noqa: E402
from portfolios.repository import (  # noqa: E402
    InvalidPortfolio,
    MAX_PORTFOLIOS_PER_USER,
    save_portfolio,
)


# Las pruebas del lector antiguo (`FirestoreReader`) ante ids con barras se fueron con el el 21-11-2026; las del lector
# de la base nueva estan en test_lector_base_nueva.py y test_lectura_y_entradas.py.
class TestAssetIdValidation:
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
