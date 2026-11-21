"""Documentary SRI must not be replaced by legacy SRRI or a price proxy."""
from copy import deepcopy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from readmodel.mappers import map_quant_metrics, map_asset_detail
from contract_validation import validate_contract
from fund_ingest import _risk_snapshot


def root(isin="LU0563745743"):
    return {
        "asset_id": isin, "asset_type": "FUND",
        "identity": {"name": "Reviewed fund", "currency": "EUR"},
        "identifiers": {"isin": isin}, "classification": {"asset_class": "RV"},
        "product": {"product_type": "fund"},
        "risk": {"srri_1a7": 6, "sri_kid_1a7": 4, "sri_kid_evidence": {
            "sri": 4, "verified_isin": isin, "document_type": "PRIIPS_KID",
            "date": "2026-06-25", "url": "https://example.org/kid.pdf",
            "sha256": "a" * 64, "verified_at": "2026-09-28T07:00:00Z",
        }},
    }


@pytest.mark.parametrize("metrics", [None,
    {"srri": 6, "risk_score_source": "SRRI", "max_drawdown_5y": -0.2},
    {"risk_score_source": "VOL_BUCKET", "windows": {"3y": {"annualized_volatility": 0.4}}},
])
def test_verified_kid_has_priority_without_rewriting_other_metrics(metrics):
    r = root(); before = deepcopy(r)
    mapped = map_asset_detail(r, metrics, None)
    validate_contract(mapped, "asset-for-bdb.v1.schema.json")
    assert mapped["metrics"]["risk_score"] == 4
    assert mapped["metrics"]["risk_score_source"] == "SRI_KID"
    if metrics and "max_drawdown_5y" in metrics:
        assert mapped["metrics"]["max_drawdown_5y"] == -0.2
    assert r == before


@pytest.mark.parametrize("field,value", [("verified_isin", "OTHER"), ("sri", 5),
    ("document_type", "FACTSHEET"), ("sha256", None), ("verified_at", None)])
def test_incomplete_or_mismatched_evidence_cannot_override_metrics(field, value):
    r = root(); r["risk"]["sri_kid_evidence"][field] = value
    mapped = map_quant_metrics(r, {"srri": 6, "risk_score_source": "SRRI"})
    assert mapped["risk_score"] == 6
    assert mapped["risk_score_source"] == "SRRI"


def test_documentary_risk_does_not_bypass_blocked_history():
    # This policy must still suppress unsafe drawdown numbers.
    from fund_history_quality import policies
    blocked = next(isin for isin, p in policies().items() if p.get("blocked"))
    r = root(blocked)
    mapped = map_quant_metrics(r, {"srri": 6, "risk_score_source": "SRRI", "max_drawdown_5y": -0.99})
    assert mapped["risk_score"] == 4
    assert "max_drawdown_5y" not in mapped


def test_provider_srri_is_not_mislabeled_as_priips_sri():
    risk = _risk_snapshot({}, {"srri": "4"})
    assert risk["srri_1a7"] == 4
    assert "sri_kid_1a7" not in risk


@pytest.mark.parametrize("value", [0, 8, 3.5, "not available"])
def test_invalid_provider_risk_is_not_truncated_or_published(value):
    assert _risk_snapshot({}, {"srri": value}) is None
