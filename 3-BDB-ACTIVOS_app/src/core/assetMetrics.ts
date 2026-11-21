import type { BdbAssetMetrics, BdbPortfolioWeightedMetrics } from "../types/bdbAssets";

type MetricsWithDrawdown = Pick<BdbAssetMetrics | BdbPortfolioWeightedMetrics, "max_drawdown_hist" | "max_drawdown_5y">;

export function maxDrawdownMetric(metrics: MetricsWithDrawdown): {
  label: "Máx. caída (hist.)" | "Máx. caída 5A";
  value?: number;
  date?: string;
} {
  if (typeof metrics.max_drawdown_hist?.value === "number") {
    return {
      label: "Máx. caída (hist.)",
      value: metrics.max_drawdown_hist.value,
      date: metrics.max_drawdown_hist.date
    };
  }
  return {
    label: "Máx. caída 5A",
    value: metrics.max_drawdown_5y
  };
}
