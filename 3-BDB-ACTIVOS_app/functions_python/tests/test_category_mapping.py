"""Regression check for commercial category fallback in the BDB read model."""

import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel.mappers import map_asset_detail


def test_commercial_type_is_used_as_category_fallback():
    asset = {
        "asset_id": "TEST_FUND",
        "asset_type": "FUND",
        "identity": {"name": "Test Fund", "currency": "EUR"},
        "classification": {"asset_class": "RV"},
        "product": {
            "product_type": "fund",
            "commercial_type": "EAA Fund Global Large-Cap Growth Equity",
        },
    }

    detail = map_asset_detail(asset, None, None)

    assert detail["category"] == "EAA Fund Global Large-Cap Growth Equity"
