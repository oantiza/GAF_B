import type { BacktestResponse } from "../adapters/backtestPortfolioBackend";
import { monteCarloAvailability } from "./monteCarloProjection";
import { measurementSeries } from "./seriesFrequency";

export function canProjectReportBacktest(backtest?: BacktestResponse | null): boolean {
  if (!backtest?.portfolio_series?.length) return false;
  const measured = measurementSeries(backtest.portfolio_series, backtest.frequency);
  return monteCarloAvailability(measured.series, measured.frequency, 3).available;
}
