import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { getAssetDataSource } from "../src/adapters/assetDataSource";
import { AssetComparison } from "../src/components/AssetComparison";
import type { AssetDataSourceKind } from "../src/types/assetDataSource";

const sourceKinds: AssetDataSourceKind[] = ["LOCAL_MOCK", "BBDD_STATIC_EXPORT_SAMPLE"];

const blockedInternalKeys = [
  "official_metrics_envelope",
  "internal_metrics",
  "private_metrics",
  "suitability_inputs",
  "raw_official_metrics",
  "official_metrics",
  "official_performance",
  "official_risk",
  "official_costs",
  "suitability_allowed",
  "optimization_allowed",
  "recommendation_allowed"
];

const appOwnedPortfolioPublicKeys = [
  "asset_id",
  "created_at",
  "label",
  "local_only_notice",
  "name",
  "portfolio_id",
  "positions",
  "saved_portfolios",
  "schema_version",
  "sourceKind",
  "total_capital",
  "updated_at",
  "weight_percent"
];

const searchResultPublicKeys = [
  "annualized_return_1y",
  "annualized_return_5y",
  "annualized_return_10y",
  "annualized_return_3y",
  "asset_id",
  "category",
  "code",
  "coverage_status",
  "currency",
  "display_name",
  "economic_asset_class",
  "instrument_type",
  "is_investable",
  "isin",
  "max_drawdown_5y",
  "max_drawdown_hist",
  "metric_coverage",
  // F-06: cobertura por ventana de las métricas ponderadas (porcentajes, sin datos internos).
  "metric_coverage_1y",
  "metric_coverage_5y",
  "return_coverage_5y",
  "return_coverage_3y",
  "volatility_comparable",
  "metric_coverage_10y",
  // Cobertura propia de la volatilidad y de la caída por ventana (porcentajes y un estado, sin datos internos).
  "volatility_detail",
  "max_drawdown_coverage",
  "1Y",
  "3Y",
  "5Y",
  "hist",
  "coverage",
  "status",
  "currency_mix_warning",
  "message",
  "metrics",
  "morningstar_rating",
  "name",
  "official_benchmark",
  "provider",
  "quality_flags",
  "real_asset",
  "region",
  "risk_score",
  "role",
  "sector",
  "severity",
  "sharpe_3y",
  "ticker",
  "updated_at",
  "volatility_3y",
  "volatility_1y",
  "volatility_5y",
  "volatility_10y",
  "sharpe_1y",
  "sharpe_5y",
  "sharpe_10y",
  "source",
  "strategy",
  "risk_score_source",
  "metrics_source",
  "warnings",
  "ytd_return"
];

const optimizationInputPublicKeys = [
  ...searchResultPublicKeys,
  "asset_id",
  "assets",
  "alternative",
  "base_currency",
  "cash",
  "economic_asset_class",
  "equity",
  "fixed_income",
  "other",
  "pms_exposure",
  "portfolio_id",
  "positions",
  "real_asset",
  "source",
  "weight"
];

const reportPayloadPublicKeys = [
  ...searchResultPublicKeys,
  "annualized_return_1y",
  "annualized_return_3y",
  "annualized_return_5y",
  "annualized_return_10y",
  "alternative",
  "available",
  "by_category",
  "by_currency",
  "by_economic_asset_class",
  "by_instrument_type",
  "by_region",
  "cash",
  "category",
  "concentration_level",
  "count",
  "coverage_complete_positions",
  "data_diagnostic",
  "data_quality_summary",
  "data_quality_summary_available",
  "data_risk_signals",
  "date",
  "enriched_positions",
  "equity",
  "excluded_non_investable_positions",
  "fixed_income",
  "flag",
  "investable_positions",
  "is_valid",
  "key",
  "limitations",
  "local_only_notice",
  "mode",
  "non_investable_assets",
  "other",
  "partial_or_warning_positions",
  "performance_preview",
  "performance_preview_available",
  "pms_exposure",
  "pms_exposure_percent",
  // S6a (P5): cobertura del reparto canónico — % agregados, sin datos internos.
  "pms_exposure_coverage_percent",
  "pms_exposure_fallback_percent",
  "portfolio_name",
  "position_concentration",
  "position_count",
  "positions",
  "preview_boundary",
  "quality_flags",
  "region",
  "real_asset",
  "sharpe_3y",
  "source",
  "source_label",
  "summary",
  "top_position",
  "top_warnings",
  "total_positions",
  "total_weight_percent",
  "validation_status",
  "value",
  "volatility_3y",
  "volatility_1y",
  "warnings",
  "weight_percent",
  "weighted_metrics",
  "xray"
];

function collectObjectKeys(payload: unknown): Set<string> {
  const keys = new Set<string>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      visit(child);
    }
  }

  visit(payload);
  return keys;
}

function expectAllowedPublicKeys(payload: unknown, allowedKeys: string[]): void {
  const allowed = new Set(allowedKeys);

  for (const key of collectObjectKeys(payload)) {
    expect(allowed.has(key), `Unexpected public payload key: ${key}`).toBe(true);
  }
}

function expectNoBlockedInternalKeys(payload: unknown): void {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  const keys = collectObjectKeys(payload);

  for (const key of blockedInternalKeys) {
    expect(keys.has(key), `Blocked internal key reached public payload: ${key}`).toBe(false);
    expect(serialized).not.toContain(key);
  }
}

describe("public payload allowlist guards", () => {
  test("UI export reporting optimization and search payloads only expose allowlisted keys", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const searchResults = await dataSource.searchAssets();
      const [asset] = searchResults;
      const [stock] = await dataSource.searchAssets({ instrumentTypes: ["STOCK"] });
      const positions = [
        { asset_id: asset.asset_id, weight_percent: 60 },
        { asset_id: stock.asset_id, weight_percent: 40 }
      ];
      const comparisonAssets = await dataSource.getComparableAssets(positions.map((position) => position.asset_id));
      const optimizationInput = await dataSource.buildOptimizationInput({
        positions: positions.map((position) => ({
          asset_id: position.asset_id,
          weight: position.weight_percent / 100
        }))
      });
      const report = await dataSource.buildManualPortfolioReport(positions);
      const comparisonRowsHtml = renderToStaticMarkup(
        createElement(AssetComparison, {
          assets: comparisonAssets,
          sourceKind: "LOCAL_MOCK",
          onRemove: () => undefined
        })
      );

      expectAllowedPublicKeys(searchResults, searchResultPublicKeys);
      expectAllowedPublicKeys(optimizationInput, optimizationInputPublicKeys);
      expectAllowedPublicKeys(report, reportPayloadPublicKeys);

      expectNoBlockedInternalKeys(searchResults);
      expectNoBlockedInternalKeys(comparisonRowsHtml);
      expectNoBlockedInternalKeys(optimizationInput);
      expectNoBlockedInternalKeys(report);
    }
  });

  test("app-owned portfolio persistence serializes only ids weights and minimal metadata", async () => {
    const { createSavedLocalPortfolio } = await import("../src/core/portfolio");
    const { serializeLocalPortfolios } = await import("../src/core/localPortfolioStorage");
    const dataSource = getAssetDataSource("BBDD_STATIC_EXPORT_SAMPLE");
    const assets = await dataSource.getComparableAssets(["LU0996182563", "US0378331005"]);
    const portfolio = createSavedLocalPortfolio({
      sourceKind: "BBDD_LIVE_API",
      name: "Contrato app-owned",
      positions: [
        { asset_id: "LU0996182563", weight_percent: 50 },
        { asset_id: "US0378331005", weight_percent: 50 }
      ],
      assets,
      now: "2026-06-24T12:00:00.000Z",
      portfolioId: "app-owned-contract"
    });
    const polluted = {
      ...portfolio,
      assets,
      official_metrics_envelope: { mode: "OFFICIAL_READ_MODEL" },
      suitability_inputs: { profile: "real" },
      positions: portfolio.positions.map((position) => ({
        ...position,
        metrics: { annualized_return_3y: 0.2 },
        official_metrics: { risk_score: 3 },
        pms_exposure: { equity: 1 }
      }))
    };
    const serialized = serializeLocalPortfolios([polluted], "2026-06-24T12:01:00.000Z");
    const parsed = JSON.parse(serialized) as unknown;

    expectAllowedPublicKeys(parsed, appOwnedPortfolioPublicKeys);
    expectNoBlockedInternalKeys(serialized);
    expect(serialized).not.toContain("metrics");
    expect(serialized).not.toContain("pms_exposure");
    expect(serialized).not.toContain("assets");
  });
});
