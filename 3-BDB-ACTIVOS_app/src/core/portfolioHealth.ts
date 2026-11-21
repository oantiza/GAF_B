import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { PortfolioRiskContribution } from "../types/portfolioFrontier";
import { summarizeCoveredRate } from "./coveredFinancialMetrics";
import { oFalta, peso, porcentaje } from "./formato";
import { assetRateForAverage } from "./portfolioCosts";
import { WEIGHT_TOLERANCE_PERCENT, isWeightBalanced } from "./weightTolerance";
import { CONCENTRATION_THRESHOLDS, concentrationBand } from "./concentration";

export const PORTFOLIO_HEALTH_RULES = {
  /** El umbral único de concentración (`concentration.ts`), el mismo que la Radiografía y «Salud y control». */
  POSITION_WARN_WEIGHT_PCT: CONCENTRATION_THRESHOLDS.watch,
  POSITION_FAIL_WEIGHT_PCT: CONCENTRATION_THRESHOLDS.high,
  WEIGHT_SUM_TARGET_PCT: 100,
  /** La tolerancia única de «suma 100 %» (`weightTolerance.ts`), la misma que el constructor. */
  WEIGHT_SUM_TOLERANCE_PCT: WEIGHT_TOLERANCE_PERCENT,
  MISSING_RISK_WEIGHT_WARN_PCT: 20,
  RISK_CONTRIBUTION_WARN_PCT: 40
} as const;

export type PortfolioHealthStatus = "OK" | "WARN" | "FAIL";
export type PortfolioHealthRuleId =
  | "POSITION_WEIGHT"
  | "WEIGHT_SUM"
  | "MISSING_RISK_METRICS"
  | "RISK_CONTRIBUTION"
  | "RISK_NOT_MEASURED";

export interface PortfolioHealthViolation {
  rule: PortfolioHealthRuleId;
  severity: Exclude<PortfolioHealthStatus, "OK">;
  message: string;
  threshold: string;
  asset_id?: string;
  observed?: number;
}

export interface PortfolioHealthResult {
  status: PortfolioHealthStatus;
  violations: PortfolioHealthViolation[];
  weight_sum_pct: number;
  weighted_ter_rate: number | null;
  ter_coverage_weight_pct: number;
  missing_risk_weight_pct: number;
}

export interface PortfolioHealthInput {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  riskContributions?: PortfolioRiskContribution[] | null;
  /**
   * Si se ha medido el riesgo de la cartera entera. Sin decirlo no se evalúa: `false` impide el
   * aprobado, porque no incumplir ninguna regla no es estar sana si la de riesgo no se pudo mirar.
   */
  riesgoMedido?: boolean;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasRiskMetric(asset: BdbAssetDetail | undefined): boolean {
  if (!asset) return false;
  const metrics = asset.metrics;
  return [metrics.risk_score, metrics.volatility_1y, metrics.volatility_3y, metrics.volatility_5y]
    .some((value) => typeof value === "number" && Number.isFinite(value));
}

function labelFor(assetId: string, assetById: Map<string, BdbAssetDetail>, positions: BdbManualPortfolioPosition[]): string {
  return assetById.get(assetId)?.display_name
    ?? positions.find((position) => position.asset_id === assetId)?.label
    ?? assetId;
}

/**
 * El peso escrito de cada activo, sumando sus líneas (auditoría del 16-11-2026, INF-7). El mismo activo en dos líneas
 * de 30 % es una concentración del 60 %, no dos avisos del 30 %. El constructor y la importación ya no dejan repetir un
 * activo, así que esto protege de una cartera guardada de otra forma. Es el peso ESCRITO; sobre cuál se mide la
 * concentración lo dice `pesoMedidoPorActivo`.
 */
export function pesoEscritoPorActivo(positions: readonly BdbManualPortfolioPosition[]): Map<string, number> {
  const pesos = new Map<string, number>();
  for (const position of positions) {
    if (!finitePositive(position.weight_percent)) continue;
    pesos.set(position.asset_id, (pesos.get(position.asset_id) ?? 0) + position.weight_percent);
  }
  return pesos;
}

/** El peso de un activo para medir la concentración: el escrito y el que se mide, que solo difieren si la suma no cuadra. */
export interface PesoMedido {
  escrito: number;
  /** Sobre lo asignado: el escrito entre la suma de los pesos, si esa suma no es 100. Si cuadra, el escrito. */
  medido: number;
}

/**
 * Sobre qué peso se mide la concentración de cada activo. Decisión A-164 de Óscar (16-11-2026, hallazgo INF-7).
 *
 * Cuando los pesos suman 100 es el escrito. Cuando no cuadran —una cartera a medio asignar—, se mide sobre lo
 * asignado: con pesos que suman 70, una posición de 40 es el 57,1 % de lo que hay, y eso es crítico aunque el 40
 * escrito solo fuese un aviso. Es como mide ya el resto del programa (la simulación y el informe interno normalizan).
 * Sustituye a lo elegido antes, que era el peso escrito en la fila y en la alerta para que dijesen lo mismo: ahora
 * las dos dicen las dos cifras.
 */
export function pesoMedidoPorActivo(positions: readonly BdbManualPortfolioPosition[]): { cuadra: boolean; pesos: Map<string, PesoMedido> } {
  const escritos = pesoEscritoPorActivo(positions);
  const suma = [...escritos.values()].reduce((total, peso) => total + peso, 0);
  const cuadra = isWeightBalanced(suma) || !(suma > 0);
  const pesos = new Map<string, PesoMedido>();
  for (const [assetId, escrito] of escritos) pesos.set(assetId, { escrito, medido: cuadra ? escrito : (escrito / suma) * 100 });
  return { cuadra, pesos };
}

/** «40,0 % de la cartera», y si la suma no cuadra, además lo que es de lo asignado. */
export function pesoDicho({ escrito, medido }: PesoMedido, cuadra: boolean): string {
  const deLaCartera = `${oFalta(peso(escrito / 100))} de la cartera`;
  return cuadra ? deLaCartera : `${deLaCartera}, el ${oFalta(peso(medido / 100))} de lo asignado`;
}

export function evaluatePortfolioHealth(input: PortfolioHealthInput): PortfolioHealthResult {
  const positions = input.positions.filter((position) => finitePositive(position.weight_percent));
  const assetById = new Map(input.assets.map((asset) => [asset.asset_id, asset]));
  const weightSum = positions.reduce((sum, position) => sum + position.weight_percent, 0);
  const violations: PortfolioHealthViolation[] = [];

  const { cuadra, pesos } = pesoMedidoPorActivo(positions);
  for (const [assetId, pesoDelActivo] of pesos) {
    const label = labelFor(assetId, assetById, positions);
    const band = concentrationBand(pesoDelActivo.medido);
    if (band === "HIGH") {
      violations.push({
        rule: "POSITION_WEIGHT",
        severity: "FAIL",
        asset_id: assetId,
        observed: pesoDelActivo.medido,
        threshold: `FAIL si peso > ${PORTFOLIO_HEALTH_RULES.POSITION_FAIL_WEIGHT_PCT} %`,
        message: `${label} concentra ${pesoDicho(pesoDelActivo, cuadra)}.`
      });
    } else if (band === "WATCH") {
      violations.push({
        rule: "POSITION_WEIGHT",
        severity: "WARN",
        asset_id: assetId,
        observed: pesoDelActivo.medido,
        threshold: `WARN si peso > ${PORTFOLIO_HEALTH_RULES.POSITION_WARN_WEIGHT_PCT} %`,
        message: `${label} pesa ${pesoDicho(pesoDelActivo, cuadra)}.`
      });
    }
  }

  if (!isWeightBalanced(weightSum)) {
    violations.push({
      rule: "WEIGHT_SUM",
      severity: "WARN",
      observed: weightSum,
      threshold: `${PORTFOLIO_HEALTH_RULES.WEIGHT_SUM_TARGET_PCT} % ± ${oFalta(porcentaje(PORTFOLIO_HEALTH_RULES.WEIGHT_SUM_TOLERANCE_PCT / 100))}`,
      message: `La suma de pesos es ${oFalta(porcentaje(weightSum / 100))}.`
    });
  }

  // TER medio sobre el peso con dato; la cobertura (en puntos de peso) va aparte. Una acción cuenta a cero y como conocida.
  const ter = summarizeCoveredRate(positions.map((position) => ({
    amount: position.weight_percent,
    rate: assetRateForAverage(assetById.get(position.asset_id))
  })));

  const missingRiskWeight = positions
    .filter((position) => !hasRiskMetric(assetById.get(position.asset_id)))
    .reduce((sum, position) => sum + position.weight_percent, 0);
  const missingRiskPct = weightSum > 0 ? (missingRiskWeight / weightSum) * 100 : 0;
  if (missingRiskPct > PORTFOLIO_HEALTH_RULES.MISSING_RISK_WEIGHT_WARN_PCT) {
    violations.push({
      rule: "MISSING_RISK_METRICS",
      severity: "WARN",
      observed: missingRiskPct,
      threshold: `WARN si falta riesgo en > ${PORTFOLIO_HEALTH_RULES.MISSING_RISK_WEIGHT_WARN_PCT} % del peso`,
      message: `Faltan métricas de riesgo para ${oFalta(peso(missingRiskPct / 100))} del peso.`
    });
  }

  if (input.riesgoMedido === false) {
    violations.push({
      rule: "RISK_NOT_MEASURED",
      severity: "WARN",
      threshold: "WARN si la simulación con series no cubre al menos el 80 % del peso",
      message: "El riesgo de la cartera no está medido."
    });
  }

  (input.riskContributions ?? []).forEach((contribution) => {
    if (contribution.risk_pct > PORTFOLIO_HEALTH_RULES.RISK_CONTRIBUTION_WARN_PCT) {
      violations.push({
        rule: "RISK_CONTRIBUTION",
        severity: "WARN",
        asset_id: contribution.asset_id,
        observed: contribution.risk_pct,
        threshold: `WARN si contribución al riesgo > ${PORTFOLIO_HEALTH_RULES.RISK_CONTRIBUTION_WARN_PCT} %`,
        message: `${labelFor(contribution.asset_id, assetById, positions)} aporta ${oFalta(peso(contribution.risk_pct / 100))} del riesgo.`
      });
    }
  });

  return {
    status: violations.some((violation) => violation.severity === "FAIL")
      ? "FAIL"
      : violations.length > 0
        ? "WARN"
        : "OK",
    violations,
    weight_sum_pct: weightSum,
    weighted_ter_rate: ter.weightedAverage,
    ter_coverage_weight_pct: ter.coveredAmount,
    missing_risk_weight_pct: missingRiskPct
  };
}
