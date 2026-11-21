import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

/** Cuántas posiciones caben en las dos matrices de Analítica avanzada, la de correlación y la de solapamiento.
 *
 *  10-11-2026: ya no es un tope del servidor. La simulación mide la cartera entera (hasta 85 posiciones,
 *  MAX_POSICIONES_SIMULACION en functions_python/portfolio_horizon.py), y su evolución, sus cifras y su caída
 *  máxima son de toda la cartera. Lo que se queda en 40 es lo que se dibuja como matriz: una de 120 × 120
 *  casillas no se lee. Con carteras mayores, las dos matrices son de las 40 mayores posiciones y SE DICE —
 *  nunca se rompe ni se calla (auditoría 27-07, D3).
 *
 *  Antes (04-09-2026) era el tope de series del servidor, CAP_BACKTEST_ASSETS = 40; ese tope sigue para
 *  get_price_series y para el backtest sin `analysis_bundle` (CAP_SERIES_ASSETS en main.py). */
export const MATRICES_MAX_POSITIONS = 40;

export interface TopPositionsSelection {
  /** Las N mayores posiciones por peso (desempate estable por asset_id). */
  positions: BdbManualPortfolioPosition[];
  /** Cuántas posiciones quedaron fuera del análisis. */
  omittedCount: number;
  /** % del peso total de la cartera cubierto por las seleccionadas (0-100). */
  coveredWeightPercent: number;
}

export function selectTopPositionsByWeight(
  positions: BdbManualPortfolioPosition[],
  max: number = MATRICES_MAX_POSITIONS
): TopPositionsSelection {
  const totalWeight = positions.reduce((sum, p) => sum + (p.weight_percent || 0), 0);
  if (positions.length <= max) {
    return { positions, omittedCount: 0, coveredWeightPercent: 100 };
  }
  const selected = [...positions]
    .sort(
      (a, b) =>
        (b.weight_percent || 0) - (a.weight_percent || 0) ||
        a.asset_id.localeCompare(b.asset_id)
    )
    .slice(0, max);
  const coveredWeight = selected.reduce((sum, p) => sum + (p.weight_percent || 0), 0);
  return {
    positions: selected,
    omittedCount: positions.length - selected.length,
    coveredWeightPercent: totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 100
  };
}
