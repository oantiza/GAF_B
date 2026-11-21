import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { entraAlCargarUnaCartera } from "./accionDeCartera";

export interface PositionsPortfolioTransfer {
  positions: BdbManualPortfolioPosition[];
  totalCapital: number;
  name: string;
  excludedIds: string[];
  excludedCapital: number;
}

/**
 * Lo que Rendimiento lleva a Diseño de cartera: las posiciones vivas del análisis, con su valor de
 * mercado. Una línea vendida sigue en la atribución con valor cero, y en una cartera no pinta nada.
 * La caja no es una posición: el capital que llega a Diseño es solo lo invertido.
 */
export function posicionesDelAnalisis(
  lineas: ReadonlyArray<{ asset_id: string; market_value: number }>
): Array<{ asset_id: string; amount: number }> {
  return lineas
    .filter((linea) => Number.isFinite(linea.market_value) && linea.market_value > 0)
    .map((linea) => ({ asset_id: linea.asset_id, amount: linea.market_value }));
}

/**
 * Lo que pasa a Diseño, con la regla de guardar (decisión 113): lo que un cliente tiene y no se puede proponer, como Deoleo o una clase
 * cerrada de Amundi, pasa con su importe. Se queda fuera lo que no está en el catálogo, lo que no es una posición y lo que la decisión 44 no
 * deja entrar.
 */
export function positionsToPortfolio(rows: Array<{ id: string; amount: number; asset: BdbAssetDetail | null }>): PositionsPortfolioTransfer {
  const grouped = new Map<string, { label: string; amount: number }>();
  const excludedIds: string[] = [];
  let excludedCapital = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount <= 0 || !row.asset || !entraAlCargarUnaCartera(row.asset)) {
      excludedIds.push(row.id);
      if (Number.isFinite(row.amount)) excludedCapital += row.amount;
      continue;
    }
    const previous = grouped.get(row.asset.asset_id);
    grouped.set(row.asset.asset_id, { label: row.asset.display_name, amount: (previous?.amount ?? 0) + row.amount });
  }
  const totalCapital = [...grouped.values()].reduce((total, row) => total + row.amount, 0);
  const positions = [...grouped].map(([asset_id, row]) => ({
    asset_id, label: row.label, weight_percent: row.amount / totalCapital * 100
  }));
  return { positions, totalCapital, name: "Extracto externo", excludedIds, excludedCapital };
}
