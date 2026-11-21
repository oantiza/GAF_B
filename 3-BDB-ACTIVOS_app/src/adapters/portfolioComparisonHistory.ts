import { fetchBacktest } from "./backtestPortfolioBackend";
import { comparisonPositions, type ComparisonHistory, type ComparisonPeriod } from "../core/portfolioComparison";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

/** Reuses the same approved history extensions as the constructor for 3/5Y.
 * No extensions exist for 10Y: enforce actual coverage and disclose exclusions. */
export async function fetchComparisonHistory(positions: readonly BdbManualPortfolioPosition[], period: ComparisonPeriod): Promise<ComparisonHistory> {
  const normalized = comparisonPositions(positions);
  if (period !== "10Y") {
    const { fetchPortfolioHorizon } = await import("./portfolioHorizon");
    const horizon = await fetchPortfolioHorizon(normalized, period);
    return { backtest: horizon.backtest, extensionNotes: horizon.extensions.map((extension) =>
      `${extension.assetId}: tramo estimado con ${extension.reference}, del ${extension.estimatedFrom} al ${extension.estimatedUntil}.`) };
  }
  const backtest = await fetchBacktest(normalized.map((p) => ({ asset_id: p.asset_id, weight: p.weight_percent / 100 })), period, "DAILY", "ENFORCE");
  if (!backtest) throw new Error("No hay histórico suficiente para comparar esta cartera a 10 años.");
  return { backtest, extensionNotes: [] };
}
