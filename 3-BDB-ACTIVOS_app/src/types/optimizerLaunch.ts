import type { FrontierObjective } from "./portfolioFrontier";

/** Parámetros admitidos al abrir el optimizador desde otra pantalla. */
export interface OptimizerLaunchConfig {
  objective: FrontierObjective;
  riskSlider?: number;
  maxWeightPercent?: number;
  lockedWeights?: Record<string, number>;
  autoRun?: boolean;
}
