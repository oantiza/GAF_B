/**
 * Tolerancia ÚNICA de «los pesos suman 100 %» (MEDIA-15, auditoría 14-10-2026).
 *
 * Un total dentro de ±0,05 puntos de 100 % se da por cuadrado: cubre el
 * redondeo de pesos iguales (3 × 33,33 % = 99,99 %) y coincide con lo que el
 * titular enseña como 100,0 % (un decimal). Antes convivían siete umbrales
 * (0,000001, 0,01, 0,05, 0,1 y 0,0005 en fracción), así que la misma cartera
 * podía estar cuadrada en el constructor y descuadrada en salud o en costes.
 *
 * Módulo hoja (sin importaciones) para que cualquier pieza de `src/core` lo use
 * sin ciclos.
 */
export const WEIGHT_TOLERANCE_PERCENT = 0.05;

/** La misma tolerancia para pesos expresados en fracción (1 = 100 %). */
export const WEIGHT_TOLERANCE_FRACTION = WEIGHT_TOLERANCE_PERCENT / 100;

/** Único criterio de «cuadrada» para un total de pesos en porcentaje. */
export function isWeightBalanced(totalWeightPercent: number): boolean {
  return Math.abs(totalWeightPercent - 100) < WEIGHT_TOLERANCE_PERCENT;
}
