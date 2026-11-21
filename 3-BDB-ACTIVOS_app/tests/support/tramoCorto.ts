import type { ComparisonHistory, ComparisonPeriod } from "../../src/core/portfolioComparison";

/**
 * Una simulación de `dias` días naturales que acaba el 03-09-2026, de 100 a `100 × (1 + total)` en línea recta: la
 * rentabilidad del periodo es `total` exacto, sin depender del camino. Con la forma de la respuesta del servidor nuevo
 * (15-11-2026): por debajo de 330 días, `cagr` y `sharpe` vacíos.
 */
export function historiaDeTramo(dias: number, total: number, id = "A", period: ComparisonPeriod = "10Y"): ComparisonHistory {
  const fin = Date.UTC(2026, 8, 3);
  const inicio = fin - dias * 86400000;
  const points = [];
  for (let i = 0; i <= dias; i++) {
    points.push({ date: new Date(inicio + i * 86400000).toISOString().slice(0, 10), value: 100 * (1 + total * i / dias) });
  }
  const annualized = dias >= 330;
  return { extensionNotes: [], backtest: { schema_version: "backtest.v1", base_currency: "EUR", window: period, frequency: "DAILY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY", units: "decimal",
    metrics: { cagr: annualized ? .99 : null, volatility: .01, sharpe: annualized ? 99 : null, max_drawdown: 0, rf_rate: .02,
      cumulative_return: total, period_start: points[0].date, period_end: points[points.length - 1].date, period_days: dias, annualized },
    portfolio_series: points, asset_ids: [id, "cash"], weights_normalized: { [id]: .8, cash: .2 }, correlation_matrix: [[1, 0], [0, 1]], benchmark_series: {}, synthetics: [], stress_scenarios: [],
    warnings: annualized ? [] : ["WINDOW_COLLAPSED", "PERIOD_TOO_SHORT_TO_ANNUALIZE"], excluded_assets: [],
    coverage: { requested_assets: 2, included_assets: 2, common_observations: points.length, first_date: points[0].date, last_date: points[points.length - 1].date } } };
}
