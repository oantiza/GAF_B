import { describe, expect, test } from "vitest";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import { canProjectReportBacktest } from "../src/core/reportMonteCarlo";

const positions = [
  { asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 7.5 }, { asset_id: "D", weight_percent: 2.5 }
];
function backtest(count: number, window: "3Y" | "5Y" = "3Y", assetIds = ["A", "B", "C", "D"]): BacktestResponse {
  const series = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2021, 0, 4) + i * 7 * 86_400_000).toISOString().slice(0, 10), value: 100
  }));
  return {
    schema_version: "backtest.v1", window, frequency: "WEEKLY", asset_ids: assetIds,
    portfolio_series: series, metrics: { cagr: .13, volatility: .09, sharpe: 1.2, max_drawdown: -.1 },
    benchmark_series: {}, stress_scenarios: [], synthetics: [],
    coverage: { requested_assets: 4, included_assets: assetIds.length, common_observations: count,
      first_date: series[0]?.date, last_date: series.at(-1)?.date },
    excluded_assets: positions.filter(p => !assetIds.includes(p.asset_id)).map(p => ({ asset_id: p.asset_id,
      reason: p.asset_id === "D" ? "QUALITY_BLOCKED" : "INSUFFICIENT_HISTORY" }))
  } as unknown as BacktestResponse;
}
const short = backtest(82);

describe("la proyección del informe no se hace con una serie que no le sirve", () => {
  test("320 observaciones diarias no se confunden con 320 semanas", () => {
    const daily = { ...short, frequency: "DAILY" as const, portfolio_series: Array.from({ length: 82 }, (_, week) =>
      [0, 1, 3, 4].filter(day => !(day === 1 && week < 80 && week % 10 === 0)).map(day => ({
        date: new Date(Date.UTC(2025, 1, 10) + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10), value: 100
      }))).flat() };
    expect(daily.portfolio_series).toHaveLength(320);
    expect(canProjectReportBacktest(daily)).toBe(false);
  });
});
