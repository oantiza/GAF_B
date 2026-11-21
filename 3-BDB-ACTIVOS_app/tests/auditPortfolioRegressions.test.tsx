import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { buildSummaryFromAssets } from "../src/core/portfolio";
import { positionsToPortfolio } from "../src/core/positionsToPortfolio";
import { buildDisplayedHistoricalFrontierRequest } from "../src/core/historicalFrontierRequest";
import { frontierPortfolioCoverage, isPartialFrontier } from "../src/core/frontierPortfolioCoverage";
import { QueHayQueRevisar } from "../src/components/PortfolioStatusPanel";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import type { FrontierViewModel } from "../src/types/portfolioFrontier";

const asset = (id: string): BdbAssetDetail => ({
  asset_id: id, display_name: id, instrument_type: "FUND", is_investable: true, role: "INVESTABLE", quality_flags: [],
  economic_asset_class: "EQUITY", currency: "EUR", costs: {},
  metrics: { metrics_frequency: "DAILY", annualized_return_3y: 0.1, volatility_3y: 0.2, max_drawdown_5y: -0.3 }
} as unknown as BdbAssetDetail);
const model = { kind: "historical", window: "3Y", excluded: [], insufficientCoverage: false } as unknown as FrontierViewModel;

describe("audit: portfolio correctness", () => {
  test("missing half of the portfolio means 50% coverage, including LIVE previews", () => {
    const manualPositions = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "missing", weight_percent: 50 }];
    const summary = buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions, assets: [asset("A")] });
    expect(summary.weighted_metrics.metric_coverage).toBe(0.5);
    expect(summary.is_valid).toBe(false);
    // A8 (auditoría 29-09): PortfolioKeyMetrics se retiró (sin uso); la cobertura
    // parcial la declara el panel de Estado que sí está en el Constructor. Desde el rediseño del 14-11-2026, en «Qué hay
    // que revisar», arriba del paso Comprobar.
    const html = renderToStaticMarkup(createElement(QueHayQueRevisar, { summary, positions: manualPositions, assets: [asset("A")], riskProfilePreview: null }));
    expect(html).toContain("métricas para 50,0\u00a0% de la cartera");
  });
  test("transfer preserves money, groups duplicates and explicitly excludes unresolved and non-investable rows", () => {
    const transfer = positionsToPortfolio([
      { id: "A", amount: 100.01, asset: asset("A") }, { id: "A", amount: 200.02, asset: asset("A") },
      { id: "B", amount: 333.33, asset: asset("B") }, { id: "missing", amount: 50, asset: null },
      { id: "index", amount: 10, asset: { ...asset("index"), instrument_type: "INDEX" } }
    ]);
    expect(transfer.totalCapital).toBeCloseTo(633.36);
    expect(transfer.name).toBe("Extracto externo");
    expect(transfer.excludedIds).toEqual(["missing", "index"]);
    expect(transfer.excludedCapital).toBe(60);
    expect(transfer.positions[0].weight_percent / 100 * transfer.totalCapital).toBeCloseTo(300.03, 8);
    expect(transfer.positions[1].weight_percent / 100 * transfer.totalCapital).toBeCloseTo(333.33, 8);
  });
  test("41 positions disclose the one excluded by the 40-asset cap", () => {
    const assets = Array.from({ length: 41 }, (_, n) => asset(`A${String(n).padStart(2, "0")}`));
    const positions = assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 41 }));
    const input = buildDisplayedHistoricalFrontierRequest({ assets, positions })!;
    expect(input.assetIds).toHaveLength(40);
    const coverage = frontierPortfolioCoverage(input, model)!;
    expect(coverage.included).toBe(40);
    expect(coverage.excluded).toHaveLength(1);
    expect(coverage.excluded[0].reasonLabel).toContain("40 activos");
    expect(coverage.weightPercent).toBeCloseTo(4000 / 41);
  });
  test("40 equal positions retain original coverage with the 40-asset limit and backend exclusions", () => {
    const assets = Array.from({ length: 40 }, (_, n) => asset(`A${String(n).padStart(2, "0")}`));
    const positions = assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 2.5 }));
    const input = buildDisplayedHistoricalFrontierRequest({ assets, positions })!;
    expect(input.assetIds).toHaveLength(40);
    const coverage = frontierPortfolioCoverage(input, model)!;
    expect(coverage).toMatchObject({ requested: 40, included: 40, weightPercent: 100 });
    expect(coverage.excluded).toHaveLength(0);
    expect(isPartialFrontier({ ...model, portfolioCoverage: coverage })).toBe(false);
    const withBackendExclusion = frontierPortfolioCoverage(input, { ...model, excluded: [{ assetId: input.assetIds[0], reason: "PRICE_SERIES_MISSING", reasonLabel: "Sin precios" }] });
    expect(withBackendExclusion).toMatchObject({ requested: 40, included: 39, weightPercent: 97.5 });
  });
});
