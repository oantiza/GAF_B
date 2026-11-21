import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { FrontierPointView } from "../types/portfolioFrontier";
import { peso } from "./formato";

/**
 * Los pesos de una propuesta, para aplicarla. No los que se pintan: esos pierden lo que no llega a una décima de
 * punto, y una posición que la propuesta deja a 0 % parecía una que no había considerado. Bloqueaba «Aplicar» en
 * cualquier cartera en la que el optimizador sacara una posición.
 */
export function pesosDelPunto(point: Pick<FrontierPointView, "weights" | "pesosCompletos">): Record<string, number> {
  return point.pesosCompletos ?? Object.fromEntries(point.weights.map((peso) => [peso.assetId, peso.weight]));
}

/**
 * Cobertura exigida a una propuesta (auditoría 29-09-2026, R-01): el optimizador
 * recorta la petición al tope del cálculo, así que una cartera con más posiciones describe
 * solo las que entran. Aplicarla tal cual ponía a 0 % las demás, sin candado.
 */
export interface OptimizationCoverage {
  /** Posiciones con peso > 0 en la cartera: todas deben aparecer en la propuesta. */
  requiredAssetIds: readonly string[];
  /** Tope de activos del cálculo, solo si la cartera lo pasa: para que el mensaje explique el recorte. */
  maxAssets?: number;
}

/** Identificadores de la cartera (peso > 0) que la propuesta no menciona. */
export function missingOptimizationAssetIds(
  weights: Record<string, number>, requiredAssetIds: readonly string[]
): string[] {
  return [...new Set(requiredAssetIds)].filter((id) => !(id in weights));
}

export function optimizationCoverageMessage(missingCount: number, maxAssets?: number): string {
  const base = `La propuesta no cubre ${missingCount} ${missingCount === 1 ? "posición" : "posiciones"} de la cartera`;
  /* El límite y su consejo, solo si de verdad se ha recortado la petición: con 7 posiciones decía «límite de 10». */
  if (!maxAssets) return `${base}. Vuelve a calcularla.`;
  return `${base} (límite de ${maxAssets} activos por cálculo). Reduce la cartera.`;
}

/**
 * Posiciones con peso > 0 y sin candado que la propuesta no cubre. Es la última
 * defensa antes de escribir pesos: el constructor no debe poner a 0 una posición
 * que el optimizador ni siquiera consideró.
 */
export function uncoveredPositionIds(
  positions: readonly BdbManualPortfolioPosition[],
  weights: Record<string, number>,
  locks: Record<string, boolean> = {}
): string[] {
  const required = positions
    .filter((position) => (position.weight_percent || 0) > 0 && !locks[position.asset_id])
    .map((position) => position.asset_id);
  return missingOptimizationAssetIds(weights, required);
}

/**
 * La rotación con la que se calculó una propuesta: los pesos de partida que usó el servidor (los de la cartera,
 * repartidos sobre los activos del cálculo) y el máximo pedido, como Σ|w − w₀| (0..2; 0,90 = el 45 % del patrimonio).
 */
export interface OptimizationTurnover {
  currentWeights: Record<string, number>;
  max: number;
}

/**
 * Holgura de la rotación, en Σ|w − w₀|: lo que se pasa el solver (1e-4, medido en las pruebas del motor) más el redondeo
 * de los pesos a cinco decimales en 40 activos (2e-4). Media décima de punto: un cuarto de milésima del patrimonio.
 */
export const TURNOVER_TOLERANCE = 0.0005;

/** Σ|w − w₀| sobre todos los activos de cualquiera de los dos lados. */
export function turnoverDistance(weights: Record<string, number>, currentWeights: Record<string, number>): number {
  const ids = new Set([...Object.keys(weights), ...Object.keys(currentWeights)]);
  let total = 0;
  for (const id of ids) total += Math.abs((weights[id] ?? 0) - (currentWeights[id] ?? 0));
  return total;
}

/** Validate before applying backend weights; never normalize away a constraint violation. */
export function optimizationWeightIssue(
  weights: Record<string, number>, assetIds: readonly string[],
  lockedWeights: Record<string, number> = {}, maxWeight = 1,
  coverage?: OptimizationCoverage, minWeight = 0, turnover?: OptimizationTurnover
): string | null {
  const ids = new Set(assetIds);
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([id, w]) => !ids.has(id) || !Number.isFinite(w) || w < 0 || w > 1)) {
    return "La propuesta contiene pesos inválidos. Vuelve a calcularla.";
  }
  if (coverage) {
    const missing = missingOptimizationAssetIds(weights, coverage.requiredAssetIds);
    if (missing.length > 0) return optimizationCoverageMessage(missing.length, coverage.maxAssets);
  }
  // Legacy frontier points may be rounded to six decimal places.
  if (Math.abs(entries.reduce((total, [, w]) => total + w, 0) - 1) > 0.00005) {
    return "Los pesos de la propuesta no suman el 100 %. Vuelve a calcularla.";
  }
  if (Object.entries(lockedWeights).some(([id, w]) => !Number.isFinite(w) || Math.abs((weights[id] ?? 0) - w) > 0.000001)) {
    return "La propuesta modifica un peso bloqueado. Conserva la cartera y vuelve a calcularla.";
  }
  if (!Number.isFinite(maxWeight) || entries.some(([, w]) => w > maxWeight + 0.000001)) {
    return "La propuesta supera el peso máximo por activo. Revisa el límite y vuelve a calcularla.";
  }
  /* Mín. por activo (14-11-2026): todos los activos del cálculo, también los que estaban al 0 %, se quedan con al menos él. */
  if (!Number.isFinite(minWeight) || (minWeight > 0 && entries.some(([, w]) => w < minWeight - 0.000001))) {
    return "La propuesta deja algún activo por debajo del peso mínimo por activo. Revisa el límite y vuelve a calcularla.";
  }
  /* Rotación máxima (auditoría 16-11-2026, OPT-1): «Máx. Sharpe» llegó a mover el 72 % con un tope del 45 % y esta
     comprobación no lo miraba. El motor ya no lo hace; aquí se comprueba igual, con lo que el servidor dice que usó. */
  if (turnover) {
    if (!Number.isFinite(turnover.max) || turnover.max < 0) return "La propuesta contiene pesos inválidos. Vuelve a calcularla.";
    const moved = turnoverDistance(weights, turnover.currentWeights);
    if (moved > turnover.max + TURNOVER_TOLERANCE) {
      /* En pantalla la rotación es lo que cambia de sitio: la mitad de Σ|w − w₀|. */
      return `La propuesta mueve el ${peso(moved / 2)} del patrimonio y la rotación máxima pedida es del ${peso(turnover.max / 2)}. Vuelve a calcularla.`;
    }
  }
  return null;
}
