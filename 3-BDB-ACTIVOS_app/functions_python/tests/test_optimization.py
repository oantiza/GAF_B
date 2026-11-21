"""
Backend tests for optimize_portfolio.
Run: `python functions_python/tests/test_optimization.py`
"""
from datetime import date, timedelta
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import (  # noqa: E402
    DEFAULT_RISK_FREE_RATE,
    InvalidOptimizationRequest,
    MAX_REBASED_SERIES_ASSETS,
    _clear_price_series_cache,
    _load_asset_returns,
    optimize_portfolio,
    backtest_portfolio,
)


@pytest.fixture(autouse=True)
def clear_price_series_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


PILOT_ASSETS = {
    "BE0946564383": {
        "asset_type": "FUND",
        "source": "CNMV",
        "source_price_id": "NAV:BE0946564383",
        "source_listing_id": None,
        "first_year": 2021,
        "start_value": 100.0,
        "weekly_return": 0.0007,
    },
    "IE00B3Q19T94": {
        "asset_type": "ETF",
        "source": "EODHD",
        "source_price_id": "EODHD:S7XE.XETRA",
        "source_listing_id": "EODHD:S7XE.XETRA",
        "first_year": 2015,
        "start_value": 80.0,
        "weekly_return": 0.0010,
    },
    "ES0113900J37": {
        "asset_type": "STOCK",
        "source": "EODHD",
        "source_price_id": "EODHD:SAN.MC",
        "source_listing_id": "EODHD:SAN.MC",
        "first_year": 2015,
        "start_value": 60.0,
        "weekly_return": 0.0013,
    },
}


class FakeReader:
    def __init__(self, roots, series):
        self.roots = roots
        self.series = series
        self.reads = 0
        self.writes = 0

    def get_asset(self, asset_id):
        self.reads += 1
        return self.roots.get(asset_id)

    def get_price_series(self, asset_id):
        self.reads += 1
        return self.series.get(asset_id, [])

    def set(self, *_args, **_kwargs):  # pragma: no cover - should never be called
        self.writes += 1
        raise AssertionError("Optimization must not write.")


def document_id(source_price_id, year):
    prefix, value = source_price_id.split(":", 1)
    return f"{prefix}_{value}_YEAR_{year}"


def make_points(start_year, start_value, weekly_return, weeks=285):
    points = []
    current = start_value
    day = date(start_year, 1, 3)
    while day.weekday() != 4:  # Friday
        day += timedelta(days=1)
    for i in range(weeks):
        current = current * (1 + weekly_return + ((i % 7) - 3) * 0.00015)
        points.append({"date": day.isoformat(), "value": round(current, 6)})
        day += timedelta(days=7)
    return points


def make_series(asset_id, config, weeks=285):
    by_year = {}
    for point in make_points(config["first_year"], config["start_value"], config["weekly_return"], weeks):
        by_year.setdefault(int(point["date"][:4]), []).append(point)
    docs = []
    for year, points in sorted(by_year.items()):
        docs.append({
            "schema_version": "asset-price-series.v1",
            "asset_id": asset_id,
            "asset_type": config["asset_type"],
            "series_type": "NAV" if config["asset_type"] == "FUND" else "ADJUSTED_CLOSE",
            "source": config["source"],
            "source_price_id": config["source_price_id"],
            "document_id": document_id(config["source_price_id"], year),
            "source_listing_id": config["source_listing_id"],
            "currency": "EUR",
            "interval": "1d",
            "year": year,
            "points": points,
            "first_date": points[0]["date"],
            "last_date": points[-1]["date"],
            "observations_count": len(points),
            "history_quality_status": "COMPLETE",
            "updated_at": "2026-06-23T00:00:00.000Z",
        })
    return docs


def make_reader():
    roots = {
        asset_id: {
            "asset_id": asset_id,
            "asset_type": config["asset_type"],
            "identity": {"currency": "EUR", "name": asset_id},
            "quality": {"status": "ACCEPTED"},
        }
        for asset_id, config in PILOT_ASSETS.items()
    }
    series = {
        asset_id: make_series(asset_id, config, weeks=598 if config["first_year"] < 2020 else 285)
        for asset_id, config in PILOT_ASSETS.items()
    }
    return FakeReader(roots, series)


def make_large_reader(count=12):
    roots = {}
    series = {}
    for i in range(count):
        asset_id = f"LARGE_{i:02d}"
        roots[asset_id] = {
            "asset_id": asset_id,
            "asset_type": "FUND",
            "identity": {"currency": "EUR", "name": asset_id},
            "quality": {"status": "ACCEPTED"},
        }
        config = {
            "asset_type": "FUND",
            "source": "CNMV",
            "source_price_id": f"NAV:{asset_id}",
            "source_listing_id": None,
            "first_year": 2015,
            "start_value": 80.0 + i,
            "weekly_return": 0.00045 + (i * 0.00004),
        }
        series[asset_id] = make_series(asset_id, config, weeks=598)
    return FakeReader(roots, series)


def request(**overrides):
    base = {
        "schema_version": "portfolio-optimization-request.v1",
        "asset_ids": list(PILOT_ASSETS),
        "current_weights": {
            "BE0946564383": 0.34,
            "IE00B3Q19T94": 0.33,
            "ES0113900J37": 0.33,
        },
        "window": "3Y",
        "base_currency": "EUR",
        "frequency": "WEEKLY",
        "objective": "MAX_SHARPE",
        "frontier_points": 7,
        "constraints": {"long_only": True, "fully_invested": True},
    }
    base.update(overrides)
    return base


ok = 0


def check(condition, message):
    global ok
    assert condition, "FALLO: " + message
    ok += 1
    print("  ok:", message)


def approx(value, expected, tolerance=1e-9):
    return abs(value - expected) <= tolerance


def estr_result(first_date, last_date, rate=0.028):
    return {
        "rate": rate,
        "source": "ECB_ESTR",
        "policy": "WINDOW_AVERAGE",
        "first_date": first_date,
        "last_date": last_date,
        "observations": 750,
        "coverage_ratio": 1.0,
    }


def weights_sum_to_one(point):
    return abs(sum(point["weights"].values()) - 1.0) <= 1e-9


def test_contract_and_portfolios():
    reader = make_reader()
    res = optimize_portfolio(reader, request(), as_of_date="2026-06-22")
    check(res["schema_version"] == "portfolio-frontier.v1", "schema response portfolio-frontier.v1")
    check(res["units"] == "decimal" and res["base_currency"] == "EUR", "units/base_currency decimal EUR")
    check(approx(res["methodology"]["risk_free_rate"], DEFAULT_RISK_FREE_RATE), "risk-free decimal ECB_ESTR")
    check(res["methodology"]["risk_free_rate_policy"] == "STATIC_FALLBACK", "risk-free fallback policy")
    check(res["coverage"]["requested_assets"] == 3 and res["coverage"]["included_assets"] == 3, "coverage 3/3")
    check(res["coverage"]["common_observations"] >= 156, "common weekly observations >= 156")
    check(weights_sum_to_one(res["min_volatility_portfolio"]), "min-vol weights sum 1")
    check(weights_sum_to_one(res["max_sharpe_portfolio"]), "max-Sharpe weights sum 1")
    check(res["max_sharpe_portfolio"]["sharpe_ratio"] >= res["min_volatility_portfolio"]["sharpe_ratio"], "max-Sharpe available")
    check(len(res["frontier"]) >= 2, "frontier points generated")
    check(res["current_portfolio"] is not None and weights_sum_to_one(res["current_portfolio"]), "current portfolio point")
    # Decision 40: Maximo Sharpe va al motor regularizado, y la atribucion de riesgo declara su covarianza.
    check(res["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}, "RC declares the regularized covariance")
    check(abs(sum(item["risk_pct"] for item in res["risk_contributions"]) - 100.0) < 1e-9,
          "signed risk contributions sum 100")
    check(reader.writes == 0, "no Firestore writes")


def test_price_series_cache_reuses_reader_for_same_asset():
    reader = make_reader()
    asset_id = next(iter(PILOT_ASSETS))
    root = reader.roots[asset_id]

    first = _load_asset_returns(reader, asset_id, root, "3Y")
    reads_after_first = reader.reads
    second = _load_asset_returns(reader, asset_id, root, "3Y")

    assert first.returns_by_week == second.returns_by_week
    assert reader.reads == reads_after_first


def test_zero_current_weights_return_explicit_zero_volatility_attribution():
    zero_weights = {asset_id: 0.0 for asset_id in PILOT_ASSETS}
    res = optimize_portfolio(make_reader(), request(current_weights=zero_weights))

    assert res["risk_contributions"] is None
    assert res["risk_contributions_meta"]["reason"] == "ZERO_VOLATILITY"
    assert res["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}

    # Con «Rentabilidad objetivo» es el mismo calculo, y sin cartera actual no hay nada con que comparar la medida.
    res = optimize_portfolio(make_reader(), request(objective="TARGET_RETURN", target_return=0.05, current_weights=zero_weights))
    assert res["risk_contributions"] is None
    assert res["risk_contributions_meta"]["reason"] == "ZERO_VOLATILITY"
    assert res["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}
    assert res["target_return_measured"]["current"] is None
    assert res["target_return_measured"]["portfolio"] is not None


def test_dynamic_estr_window_average_is_used_by_optimizer_and_backtest():
    calls = []

    def resolver(first_date, last_date):
        calls.append((first_date, last_date))
        return estr_result(first_date, last_date)

    optimized = optimize_portfolio(
        make_reader(), request(), as_of_date="2026-06-22", risk_free_resolver=resolver
    )
    methodology = optimized["methodology"]
    check(approx(methodology["risk_free_rate"], 0.028), "optimizer uses dynamic ECB_ESTR")
    check(methodology["risk_free_rate_policy"] == "WINDOW_AVERAGE", "optimizer declares window average")
    check(methodology["risk_free_observations"] == 750, "optimizer exposes ECB observation count")
    check(methodology["risk_free_coverage_ratio"] == 1.0, "optimizer exposes ECB coverage")

    positions = [{"asset_id": asset_id, "weight": 1 / 3} for asset_id in PILOT_ASSETS]
    tested = backtest_portfolio(
        make_reader(), {"positions": positions, "period": "3Y", "frequency": "WEEKLY"},
        risk_free_resolver=resolver,
    )
    check(approx(tested["metrics"]["rf_rate"], 0.028), "backtest uses dynamic ECB_ESTR")
    check(tested["risk_free"]["risk_free_rate_policy"] == "WINDOW_AVERAGE", "backtest exposes ECB policy")
    check(len(calls) == 2 and all(first < last for first, last in calls), "resolver receives aligned windows")


def test_estr_resolver_failure_is_explicit_fallback():
    def resolver(_first_date, _last_date):
        raise OSError("ECB unavailable")

    res = optimize_portfolio(make_reader(), request(), risk_free_resolver=resolver)

    check(res["methodology"]["risk_free_rate_policy"] == "STATIC_FALLBACK", "fallback policy is explicit")
    check(approx(res["methodology"]["risk_free_rate"], DEFAULT_RISK_FREE_RATE), "fallback rate remains bounded")
    check("RISK_FREE_RATE_STATIC_FALLBACK" in res["warnings"], "fallback emits warning")


def test_target_return():
    reader = make_reader()
    res = optimize_portfolio(reader, request(objective="TARGET_RETURN", target_return=0.05), as_of_date="2026-06-22")
    check(res["target_return_portfolio"] is not None, "target-return portfolio present")
    check(weights_sum_to_one(res["target_return_portfolio"]), "target-return weights sum 1")
    check(res["methodology"]["optimizer"] in {"CLA", "QP"}, "target-return declares the regularized engine")
    check(res["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}, "RC declares the regularized covariance")
    check(abs(sum(item["risk_pct"] for item in res["risk_contributions"]) - 100.0) < 1e-9,
          "signed risk contributions sum 100")


def test_exclusions():
    reader = make_reader()
    # Auditoria de divisas (06-09-2026): una ficha en dolares con la serie ya en euros
    # NO se excluye (eran 135 activos fuera con un motivo falso). Lo que excluye es la
    # serie en otra divisa, y la cuarentena de los activos con error conocido.
    reader.roots["USD_ASSET"] = {
        "asset_id": "USD_ASSET",
        "asset_type": "ETF",
        "identity": {"currency": "USD"},
        "quality": {"status": "ACCEPTED"},
    }
    reader.roots["USD_SERIES"] = {
        "asset_id": "USD_SERIES",
        "asset_type": "ETF",
        "identity": {"currency": "USD"},
        "quality": {"status": "ACCEPTED"},
    }
    reader.series["USD_SERIES"] = [{
        "schema_version": "asset-price-series.v1.2",
        "currency": "USD",
        "points": [{"date": "2026-06-%02d" % day, "value": 10.0 + day} for day in range(1, 20)],
    }]
    req = request(asset_ids=list(PILOT_ASSETS) + ["USD_ASSET", "USD_SERIES", "MISSING_SERIES"])
    reader.roots["MISSING_SERIES"] = {
        "asset_id": "MISSING_SERIES",
        "asset_type": "ETF",
        "identity": {"currency": "EUR"},
        "quality": {"status": "ACCEPTED"},
    }
    res = optimize_portfolio(reader, req, as_of_date="2026-06-22")
    excluded = {item["asset_id"]: item["reason"] for item in res["excluded_assets"]}
    check(excluded.get("USD_SERIES") == "FX_SERIES_MISSING", "FX_SERIES_MISSING lo decide la serie")
    check("USD_ASSET" not in excluded or excluded["USD_ASSET"] != "FX_SERIES_MISSING",
          "una ficha en USD con serie en EUR ya no se excluye por divisa")
    check(excluded["MISSING_SERIES"] == "PRICE_SERIES_MISSING", "PRICE_SERIES_MISSING supported")
    check(res["coverage"]["included_assets"] == 3, "excluded assets do not break optimization")


def test_insufficient_coverage_and_quality():
    reader = make_reader()
    reader.roots["SHORT"] = {
        "asset_id": "SHORT",
        "asset_type": "ETF",
        "identity": {"currency": "EUR"},
        "quality": {"status": "ACCEPTED"},
    }
    short_config = {
        "asset_type": "ETF",
        "source": "EODHD",
        "source_price_id": "EODHD:SHORT.X",
        "source_listing_id": "EODHD:SHORT.X",
        "first_year": 2026,
        "start_value": 50,
        "weekly_return": 0.001,
    }
    # 25 semanas y no 20: asi llega al final del periodo y lo que le falta es historia. Con 20 se paraba en mayo, y
    # desde la decision A-161 eso tiene su propio motivo (SERIES_ENDS_EARLY), que se prueba en test_periodo_atrasado.
    reader.series["SHORT"] = make_series("SHORT", short_config, weeks=25)
    reader.roots["BLOCKED"] = {
        "asset_id": "BLOCKED",
        "asset_type": "ETF",
        "identity": {"currency": "EUR"},
        "quality": {"status": "BLOCKED"},
    }
    res = optimize_portfolio(reader, request(asset_ids=list(PILOT_ASSETS) + ["SHORT", "BLOCKED"]), as_of_date="2026-06-22")
    excluded = {item["asset_id"]: item["reason"] for item in res["excluded_assets"]}
    check(excluded["SHORT"] == "INSUFFICIENT_HISTORY", "INSUFFICIENT_HISTORY supported")
    check(excluded["BLOCKED"] == "QUALITY_BLOCKED", "QUALITY_BLOCKED supported")


def test_other_etc_is_eligible_when_price_series_exists():
    reader = make_reader()
    reader.roots["GOLD_ETC"] = {
        "asset_id": "GOLD_ETC",
        "asset_type": "OTHER",
        "identity": {"currency": "EUR"},
        "product": {"product_type": "ETC", "commercial_type": "Materias Primas - Metales Preciosos"},
        "quality": {"status": "ACCEPTED"},
    }
    etc_config = {
        "asset_type": "ETF",
        "source": "EODHD",
        "source_price_id": "EODHD:GOLD.X",
        "source_listing_id": "EODHD:GOLD.X",
        "first_year": 2015,
        "start_value": 90,
        "weekly_return": 0.0009,
    }
    reader.series["GOLD_ETC"] = make_series("GOLD_ETC", etc_config, weeks=598)
    res = optimize_portfolio(reader, request(asset_ids=list(PILOT_ASSETS) + ["GOLD_ETC"]), as_of_date="2026-06-22")
    excluded = {item["asset_id"]: item["reason"] for item in res["excluded_assets"]}
    check("GOLD_ETC" not in excluded, "OTHER/ETC con historico EUR no se excluye")
    check(res["coverage"]["included_assets"] == 4, "OTHER/ETC incluido en optimizacion")


def test_target_risk_v2_accepts_more_than_ten_assets():
    reader = make_large_reader(12)
    asset_ids = list(reader.roots)
    weights = {asset_id: 1 / len(asset_ids) for asset_id in asset_ids}
    req = request(
        asset_ids=asset_ids,
        current_weights=weights,
        objective="TARGET_RISK",
        risk_slider=5,
        expected_return_model="HISTORICAL_SHRINKAGE",
        frontier_points=9,
    )
    res = optimize_portfolio(
        reader, req, as_of_date="2026-06-22",
        risk_free_resolver=lambda first, last: estr_result(first, last, 0.025),
    )
    check(res["coverage"]["requested_assets"] == 12, "TARGET_RISK solicita mas de 10 activos")
    check(res["coverage"]["included_assets"] == 12, "TARGET_RISK incluye mas de 10 activos con historico")
    check(res["methodology"]["objective"] == "TARGET_RISK", "TARGET_RISK usa metodologia v2")
    check(res["methodology"]["risk_free_rate"] == 0.025, "TARGET_RISK usa ECB_ESTR dinamico")
    check(res["target_portfolio"] is not None and weights_sum_to_one(res["target_portfolio"]), "TARGET_RISK devuelve objetivo aplicable")
    check(res["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"},
          "TARGET_RISK RC declara la covarianza robusta usada")
    check(abs(sum(item["risk_pct"] for item in res["risk_contributions"]) - 100.0) < 1e-9,
          "TARGET_RISK RC firmada suma 100")


def test_backtest_accepts_more_than_eight_assets():
    reader = make_large_reader(12)
    asset_ids = list(reader.roots)
    positions = [{"asset_id": asset_id, "weight": 1 / len(asset_ids)} for asset_id in asset_ids]
    res = backtest_portfolio(reader, {"positions": positions, "period": "3Y", "frequency": "WEEKLY"})

    check(res["coverage"]["requested_assets"] == 12, "backtest solicita mas de 8 activos")
    check(res["coverage"]["included_assets"] == 12, "backtest incluye mas de 8 activos con historico")
    check(len(res["asset_ids"]) == 12, "backtest conserva todos los activos incluidos")
    check(len(res["correlation_matrix"]) == 12, "backtest devuelve matriz de correlacion completa")
    check([item["id"] for item in res["stress_scenarios"]] == ["COVID", "RATES_2022", "COMMON_HISTORY"],
          "backtest devuelve tres escenarios de estres")


def test_backtest_service_trunca_en_el_tope_de_activos():
    """El backtest nunca lee mas de MAX_REBASED_SERIES_ASSETS posiciones.

    04-09-2026: el tope paso de 25 a 40; la prueba se ata a la constante en vez
    de a la cifra para que no haya que reescribirla en el proximo cambio.
    """
    total = MAX_REBASED_SERIES_ASSETS + 5
    reader = make_large_reader(total)
    positions = [{"asset_id": asset_id, "weight": 1 / total} for asset_id in reader.roots]

    res = backtest_portfolio(reader, {"positions": positions, "period": "3Y", "frequency": "WEEKLY"})

    assert res["coverage"]["requested_assets"] == MAX_REBASED_SERIES_ASSETS
    assert len(res["asset_ids"]) == MAX_REBASED_SERIES_ASSETS


def test_backtest_stress_preserves_exclusion_reason_and_weight_coverage():
    reader = make_reader()
    reader.roots["BLOCKED_STRESS"] = {
        "asset_id": "BLOCKED_STRESS",
        "asset_type": "FUND",
        "identity": {"currency": "EUR", "name": "BLOCKED_STRESS"},
        "quality": {"status": "BLOCKED"},
    }
    positions = [
        {"asset_id": "IE00B3Q19T94", "weight": 0.4},
        {"asset_id": "ES0113900J37", "weight": 0.4},
        {"asset_id": "BLOCKED_STRESS", "weight": 0.2},
    ]

    res = backtest_portfolio(reader, {"positions": positions, "period": "3Y", "frequency": "WEEKLY"})

    for scenario in res["stress_scenarios"]:
        assert scenario["coverage"] == {"weight_pct": 80.0, "included_assets": 2, "total_assets": 3}
        assert {item["asset_id"]: item["reason"] for item in scenario["excluded_assets"]}["BLOCKED_STRESS"] == "QUALITY_BLOCKED"


def test_invalid_request():
    try:
        optimize_portfolio(make_reader(), {"schema_version": "wrong"})
    except InvalidOptimizationRequest:
        check(True, "invalid request raises InvalidOptimizationRequest")
    else:
        raise AssertionError("invalid request should fail")


def run():
    print("== optimization contract ==")
    test_contract_and_portfolios()
    test_zero_current_weights_return_explicit_zero_volatility_attribution()
    print("== target return ==")
    test_target_return()
    print("== dynamic ECB_ESTR ==")
    test_dynamic_estr_window_average_is_used_by_optimizer_and_backtest()
    print("== ECB_ESTR fallback ==")
    test_estr_resolver_failure_is_explicit_fallback()
    print("== exclusions ==")
    test_exclusions()
    print("== insufficient coverage / quality ==")
    test_insufficient_coverage_and_quality()
    print("== OTHER / ETC eligibility ==")
    test_other_etc_is_eligible_when_price_series_exists()
    print("== TARGET_RISK v2 >10 assets ==")
    test_target_risk_v2_accepts_more_than_ten_assets()
    print("== backtest >8 assets ==")
    test_backtest_accepts_more_than_eight_assets()
    test_backtest_service_never_reads_more_than_twenty_five_positions()
    test_backtest_stress_preserves_exclusion_reason_and_weight_coverage()
    print("== invalid request ==")
    test_invalid_request()
    print(f"\nOPTIMIZATION OK: {ok} checks passed.")


if __name__ == "__main__":
    run()
