import type { BdbAssetDetail } from "../types/bdbAssets";

/** Lo que se escribe detrás de un coste que sale de los fundamentales y no de los costes del activo. */
export const COSTE_DE_LOS_FUNDAMENTALES = " · de los datos del ETF";

/**
 * ACT-07: un solo coste corriente en la ficha anterior. Antes Resumen y Costes leían los costes del activo y
 * Fundamentales los datos del ETF, y la misma ficha podía decir dos cifras. Manda el de los costes, como en el
 * Buscador y el Comparador; si no está, el de los fundamentales (que vienen en por ciento), y se dice de dónde sale.
 */
export function costeCorrienteDeLaFicha(asset: BdbAssetDetail): { valor: number; deLosFundamentales: boolean } | null {
  const propio = asset.costs?.ongoing_charge;
  if (typeof propio === "number" && Number.isFinite(propio)) return { valor: propio, deLosFundamentales: false };
  const delFondo = asset.fundamentals_summary?.fund_metrics;
  const corriente = delFondo?.ongoing_charge_pct;
  const neto = delFondo?.net_expense_ratio_pct;
  const pct = typeof corriente === "number" && corriente > 0 ? corriente : typeof neto === "number" ? neto : corriente;
  return typeof pct === "number" && Number.isFinite(pct) ? { valor: pct / 100, deLosFundamentales: true } : null;
}
