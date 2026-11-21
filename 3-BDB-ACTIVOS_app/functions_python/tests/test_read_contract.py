import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from readmodel.mappers import map_asset_detail


SCHEMA_NAME = "asset-for-bdb.v1.schema.json"


def _schema_path() -> Path:
    local_ssot = (
        Path(__file__).resolve().parents[3]
        / "2-plataforma-datos"
        / "contracts"
        / "read"
        / SCHEMA_NAME
    )
    if local_ssot.exists():
        return local_ssot
    return Path(__file__).resolve().parents[1] / "contracts_cache" / SCHEMA_NAME


def _validator():
    schema = json.loads(_schema_path().read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def test_map_asset_fund_validates_asset_for_bdb_contract():
    root = {
        "asset_id": "BE0946564383",
        "asset_type": "FUND",
        "updated_at": "2026-07-02T10:00:00Z",
        "identity": {"name": "DPAM B Equities NewGems Sustainable B Cap", "currency": "EUR"},
        "identifiers": {"isin": "BE0946564383"},
        "classification": {
            "asset_class": "RV",
            "fondosdb_asset_type": "equity",
            "region_primary": "global",
            "morningstar_rating": 4,
            "official_benchmark": "MSCI World NR EUR",
        },
        "product": {"product_type": "fund"},
        "costs": {"management_fee_pct": 1.6, "ter_pct": 1.73, "mifid_ongoing_pct": 1.73486},
        "portfolio_exposure": {"asset_mix": {"equity": 0.97, "bond": 0.0, "cash": 0.02, "other": 0.01}},
    }
    metrics_latest = {
        "asset_id": "BE0946564383",
        "population": "fund",
        "source": "FONDOSDB_ROOT_ES",
        "updated_at": "2026-07-02T10:00:00Z",
        "windows": {
            "1y": {"annualized_return": 0.1, "annualized_volatility": 0.12, "sharpe_ratio": 0.8},
            "3y": {"annualized_return": 0.145242, "annualized_volatility": 0.172646, "sharpe_ratio": 0.7428},
            "5y": {"annualized_return": 0.08, "annualized_volatility": 0.18, "sharpe_ratio": 0.5},
            "10y": {"annualized_return": 0.09, "annualized_volatility": 0.19, "sharpe_ratio": 0.6},
        },
        "ytd_return": 0.135282,
        "max_drawdown_5y": -0.22,
        "max_drawdown_hist": {"value": -0.35, "date": "2020-03-23"},
        "srri": 6,
        "risk_score_source": "SRRI",
    }

    mapped = map_asset_detail(root, metrics_latest, {"data": {"holdings_count": 10}})

    _validator().validate(mapped)
    assert mapped["classification"]["morningstar_rating"] == 4
    assert mapped["classification"]["official_benchmark"] == "MSCI World NR EUR"
    assert mapped["metrics"]["metrics_source"] == "FONDOSDB_ROOT_ES"
    assert "max_drawdown_3y" not in mapped["metrics"]
    assert mapped["metrics"]["max_drawdown_5y"] == -0.22
    assert mapped["metrics"]["volatility_10y"] == 0.19
    assert mapped["metrics"]["sharpe_10y"] == 0.6


def test_map_asset_stock_validates_asset_for_bdb_contract():
    root = {
        "asset_id": "US0378331005",
        "asset_type": "STOCK",
        "updated_at": "2026-07-02T10:00:00Z",
        "identity": {"name": "Apple Inc", "currency": "USD"},
        "identifiers": {"isin": "US0378331005", "ticker": "AAPL"},
        "classification": {"asset_class": "EQUITY", "region_primary": "united_states"},
        "product": {"product_type": "stock"},
        "portfolio_exposure": None,
    }
    metrics_latest = {
        "asset_id": "US0378331005",
        "population": "stock",
        "source": "FONDOSDB_EODHD_DAILY_HISTORY",
        "updated_at": "2026-07-02T10:00:00Z",
        "windows": {
            "3y": {"annualized_return": 0.2, "annualized_volatility": 0.308, "sharpe_ratio": 0.661},
        },
        "max_drawdown_hist": {"value": -0.196},
        "risk_score_source": "VOL_BUCKET",
        "observations_count": 1880,
        "first_date": "2019-01-02",
        "last_date": "2026-06-19",
    }

    mapped = map_asset_detail(root, metrics_latest, None)

    _validator().validate(mapped)
    assert mapped["metrics"]["metrics_source"] == "FONDOSDB_EODHD_DAILY_HISTORY"
    assert mapped["metrics"]["risk_score_source"] == "VOL_BUCKET"
    assert "max_drawdown_3y" not in mapped["metrics"]
    assert mapped["metrics"]["max_drawdown_hist"] == -0.196


def _rf_root(**overrides):
    root = {
        "asset_id": "DE000A0X7541",
        "asset_type": "FUND",
        "updated_at": "2026-10-13T10:00:00Z",
        "identity": {"name": "Fondo RF Flexible", "currency": "EUR"},
        "identifiers": {"isin": "DE000A0X7541"},
        "classification": {"asset_class": "RF", "fondosdb_asset_type": "fixed_income", "region_primary": "europe"},
        "product": {"product_type": "fund"},
        "costs": {"ter_pct": 0.9},
        "fixed_income_profile": {
            "effective_duration": 3.79, "modified_duration": 3.79, "effective_maturity": 8.76,
            "avg_credit_quality": "BBB+", "yield_to_maturity": 3.62,
            "investment_grade_pct": 54.49, "high_yield_pct": 41.83,
        },
        "portfolio_exposure": {
            "asset_mix": {"equity": 0.0, "bond": 0.78, "cash": 0.22, "other": 0.0},
            "bond_types": {"corporate": 0.540825, "cash": 0.22268, "government": 0.236494},
        },
    }
    root.update(overrides)
    return root


def test_map_asset_fixed_income_fund_validates_asset_for_bdb_contract():
    mapped = map_asset_detail(_rf_root(), None, None)

    _validator().validate(mapped)
    profile = mapped["fixed_income_profile"]
    assert profile["avg_credit_quality"] == "BBB+"
    assert profile["investment_grade_pct"] == 0.5449
    assert profile["high_yield_pct"] == 0.4183
    assert profile["yield_to_maturity"] == 0.0362
    assert profile["bond_types"] == {"corporate": 0.540825, "cash": 0.22268, "government": 0.236494}


def test_map_asset_with_a_small_negative_class_validates_and_keeps_it():
    # El reparto es neto: una clase puede salirse de 0-1 hasta un punto (decision A-63), y el contrato de lectura la deja pasar.
    root = _rf_root(portfolio_exposure={"asset_mix": {"equity": 1.000401, "bond": -0.000844, "cash": 0.000432, "other": 0.000011}})
    mapped = map_asset_detail(root, None, None)

    _validator().validate(mapped)
    assert mapped["pms_exposure"]["equity"] == 1.000401
    assert mapped["pms_exposure"]["fixed_income"] == -0.000844


def test_map_asset_equity_fund_zero_bond_types_validates_with_null_profile():
    root = _rf_root(
        fixed_income_profile={"bond_sectors": {}},
        portfolio_exposure={
            "asset_mix": {"equity": 0.97, "bond": 0.0, "cash": 0.03, "other": 0.0},
            "bond_types": {"government": 0, "corporate": 0, "securitized": 0, "cash": 0},
        },
    )
    mapped = map_asset_detail(root, None, None)

    _validator().validate(mapped)
    assert mapped["fixed_income_profile"] is None


def test_map_asset_without_fixed_income_profile_validates():
    root = _rf_root()
    del root["fixed_income_profile"]
    root["portfolio_exposure"] = {"asset_mix": {"equity": 0.0, "bond": 1.0, "cash": 0.0, "other": 0.0}}
    mapped = map_asset_detail(root, None, None)

    _validator().validate(mapped)
    assert mapped["fixed_income_profile"] is None


def test_official_benchmark_viaja_vacio_cuando_la_maestra_no_lo_tiene():
    """Una raiz anterior a asset.v1.3 no trae el indice: el payload lo lleva nulo, no ausente,
    para que la app distinga 'sin indice' de 'campo que todavia no existe'."""
    root = {
        "asset_id": "LU0000000001",
        "asset_type": "FUND",
        "updated_at": "2026-10-31T10:00:00Z",
        "identity": {"name": "Fondo sin indice", "currency": "EUR"},
        "identifiers": {"isin": "LU0000000001"},
        "classification": {"asset_class": "RV", "morningstar_rating": None},
        "product": {"product_type": "fund"},
    }

    mapped = map_asset_detail(root)

    _validator().validate(mapped)
    assert mapped["classification"]["official_benchmark"] is None
