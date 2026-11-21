import type { ComparisonHistory, ComparisonPeriod } from "../../src/core/portfolioComparison";
import type { BdbAssetDetail, BdbSavedLocalPortfolio } from "../../src/types/bdbAssets";

export function comparisonFixture(period: ComparisonPeriod = "3Y", id = "A"): ComparisonHistory {
  const start = Date.UTC(2026 - Number.parseInt(period, 10), 8, 3);
  const end = Date.UTC(2026, 8, 3);
  const points = [];
  for (let time = start, i = 0; time <= end; time += 86400000, i++) {
    points.push({ date: new Date(time).toISOString().slice(0, 10), value: 100 * Math.exp(i * (id === "A" ? .00018 : .00022) + Math.sin(i / 23) * (id === "A" ? .035 : .05)) });
  }
  return { extensionNotes: [], backtest: { schema_version: "backtest.v1", base_currency: "EUR", window: period, frequency: "DAILY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY", units: "decimal",
    metrics: { cagr: .99, volatility: .99, sharpe: 99, max_drawdown: -.99, rf_rate: .02 },
    portfolio_series: points, asset_ids: [id, "cash"], weights_normalized: { [id]: .8, cash: .2 }, correlation_matrix: [[1, 0], [0, 1]], benchmark_series: {}, synthetics: [], stress_scenarios: [], warnings: [], excluded_assets: [],
    coverage: { requested_assets: 2, included_assets: 2, common_observations: points.length, first_date: points[0].date, last_date: points[points.length - 1].date } } };
}
export const comparisonPortfolios: BdbSavedLocalPortfolio[] = ["Alfa", "Beta", "Gamma"].map((name, i) => ({ portfolio_id: name, name: `Cartera ${name}`, positions: [{ asset_id: String.fromCharCode(65 + i), weight_percent: 80 }, { asset_id: "cash", weight_percent: 20 }], sourceKind: "BBDD_LIVE_API", created_at: "2026-01-01", updated_at: "2026-09-03" }));
export const comparisonAssets: BdbAssetDetail[] = ["A", "B", "C", "cash"].map((id, index) => ({ asset_id: id, display_name: `Activo ${id}`, instrument_type: "FUND", economic_asset_class: id === "cash" ? "MONEY_MARKET" : "EQUITY", category: id === "cash" ? "Monetario" : "Renta variable global", region: index % 2 ? "Europa" : "Global", currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, description: "", pms_exposure: { equity: id === "cash" ? 0 : 1, fixed_income: 0, cash: id === "cash" ? 1 : 0, alternative: 0, other: 0 } }));
