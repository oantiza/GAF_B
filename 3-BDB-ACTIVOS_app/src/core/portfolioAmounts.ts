import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

export interface PortfolioAmountUpdate {
  positions: BdbManualPortfolioPosition[];
  totalCapital: number;
}

/** Importe de una posición al céntimo; los pesos internos conservan precisión. */
export function portfolioPositionAmount(position: BdbManualPortfolioPosition, totalCapital: number): number {
  return Math.round((position.weight_percent / 100) * totalCapital * 100) / 100;
}

/** Editar euros cambia el patrimonio: conserva los demás importes y vuelve a
 * repartir el total. No redondear los pesos a dos decimales: eso cambia euros
 * de otras posiciones y acumula diferencias en cada edición. */
export function updatePortfolioAmount(
  positions: BdbManualPortfolioPosition[],
  totalCapital: number,
  assetId: string,
  euros: number
): PortfolioAmountUpdate | null {
  if (!Number.isFinite(euros) || euros < 0 || !Number.isFinite(totalCapital) || totalCapital < 0
    || positions.filter((position) => position.asset_id === assetId).length !== 1
    || positions.some((position) => !Number.isFinite(position.weight_percent) || position.weight_percent < 0)) {
    return null;
  }
  const amountsInCents = positions.map((position) => Math.round(
    position.asset_id === assetId ? euros * 100 : (position.weight_percent / 100) * totalCapital * 100
  ));
  const totalCents = amountsInCents.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(totalCents) || amountsInCents.some((amount) => !Number.isSafeInteger(amount))) {
    return null;
  }
  return {
    totalCapital: totalCents / 100,
    positions: positions.map((position, index) => ({
      ...position,
      weight_percent: totalCents > 0 ? amountsInCents[index] / totalCents * 100 : 0,
      ...(position.asset_id === assetId && position.keepEuros ? { targetEuros: amountsInCents[index] / 100 } : {})
    }))
  };
}
