import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { summarizeCoveredRate } from "./coveredFinancialMetrics";
import { assetRateForAverage } from "./portfolioCosts";

export type PortfolioWeightChange = "NEW" | "REMOVED" | "INCREASED" | "DECREASED" | "UNCHANGED";

export interface PortfolioMetricSnapshot {
  expected_return?: number | null;
  volatility?: number | null;
  sharpe?: number | null;
}

export interface PortfolioOptimizationApplyContext {
  source: string;
  beforeMetrics?: PortfolioMetricSnapshot;
  afterMetrics?: PortfolioMetricSnapshot;
}

export interface PortfolioOptimizationDiffRow {
  asset_id: string;
  label: string;
  before_weight_pct: number;
  after_weight_pct: number;
  delta_weight_pct: number;
  change: PortfolioWeightChange;
}

export interface PortfolioOptimizationDiffResult {
  source: string;
  rows: PortfolioOptimizationDiffRow[];
  before_weighted_ter_rate: number | null;
  after_weighted_ter_rate: number | null;
  delta_weighted_ter_rate: number | null;
  before_weighted_retro_pct: number | null;
  after_weighted_retro_pct: number | null;
  delta_weighted_retro_pct: number | null;
  before_metrics: PortfolioMetricSnapshot;
  after_metrics: PortfolioMetricSnapshot;
  metric_deltas: PortfolioMetricSnapshot;
}

interface DiffInput {
  source: string;
  before: BdbManualPortfolioPosition[];
  after: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  retroPctByAssetId?: ReadonlyMap<string, number>;
  beforeMetrics?: PortfolioMetricSnapshot;
  afterMetrics?: PortfolioMetricSnapshot;
}

const EPSILON_WEIGHT = 0.005;
const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function weightMap(positions: BdbManualPortfolioPosition[]): Map<string, number> {
  const out = new Map<string, number>();
  positions.forEach((position) => {
    const weight = Number.isFinite(position.weight_percent) ? Math.max(0, position.weight_percent) : 0;
    out.set(position.asset_id, (out.get(position.asset_id) ?? 0) + weight);
  });
  return out;
}

/** Media ponderada sobre el peso con dato (definición única, `summarizeCoveredRate`); los restos ≤ EPSILON no cuentan. */
function weightedKnownRate(
  weights: Map<string, number>,
  valueFor: (assetId: string) => number | null
): number | null {
  return summarizeCoveredRate([...weights]
    .filter(([, weight]) => weight > EPSILON_WEIGHT)
    .map(([assetId, weight]) => ({ amount: weight, rate: valueFor(assetId) }))).weightedAverage;
}

function retroValue(source: DiffInput["retroPctByAssetId"], assetId: string): number | null {
  const value = source?.get(assetId);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function metricDelta(before: number | null | undefined, after: number | null | undefined): number | null {
  return typeof before === "number" && Number.isFinite(before) && typeof after === "number" && Number.isFinite(after)
    ? round6(after - before)
    : null;
}

/** La fila Total de una tabla de cambios: lo que suman las columnas de peso. */
export function totalesDeCambios(rows: readonly PortfolioOptimizationDiffRow[]) {
  const suma = (valor: (row: PortfolioOptimizationDiffRow) => number) => round6(rows.reduce((total, row) => total + valor(row), 0));
  return {
    before_weight_pct: suma((row) => row.before_weight_pct),
    after_weight_pct: suma((row) => row.after_weight_pct),
    delta_weight_pct: suma((row) => row.delta_weight_pct)
  };
}

/**
 * Cuánto dinero mueve una fila con ese capital, en euros enteros: positivo se compra y negativo se vende. Una fila
 * «Sin cambio» no mueve nada, aunque le quede un resto por debajo de la tolerancia de peso.
 */
export function importeAMover(row: Pick<PortfolioOptimizationDiffRow, "delta_weight_pct" | "change">, capital: number): number {
  if (row.change === "UNCHANGED") return 0;
  const importe = Math.round((row.delta_weight_pct / 100) * capital);
  return importe === 0 ? 0 : importe;
}

/**
 * El dinero que cambia de sitio. Se suma lo que enseñan las filas, para que el total cuadre con lo que hay encima. Las
 * compras y las ventas coinciden si la cartera suma lo mismo antes y después; si no, lo que se mueve es la mayor de las dos.
 */
export function dineroQueSeMueve(rows: readonly PortfolioOptimizationDiffRow[], capital: number) {
  const importes = rows.map((row) => importeAMover(row, capital));
  const compras = importes.filter((importe) => importe > 0).reduce((total, importe) => total + importe, 0);
  const ventas = -importes.filter((importe) => importe < 0).reduce((total, importe) => total + importe, 0);
  return { compras, ventas, movido: Math.max(compras, ventas) };
}

export function buildPortfolioOptimizationDiff(input: DiffInput): PortfolioOptimizationDiffResult {
  const beforeWeights = weightMap(input.before);
  const afterWeights = weightMap(input.after);
  const assetsById = new Map(input.assets.map((asset) => [asset.asset_id, asset]));
  const positionLabels = new Map([...input.before, ...input.after].map((position) => [position.asset_id, position.label]));
  const ids = new Set([...beforeWeights.keys(), ...afterWeights.keys()]);

  const rows = [...ids].map((assetId): PortfolioOptimizationDiffRow => {
    const before = beforeWeights.get(assetId) ?? 0;
    const after = afterWeights.get(assetId) ?? 0;
    const delta = after - before;
    const change: PortfolioWeightChange = before <= EPSILON_WEIGHT && after > EPSILON_WEIGHT
      ? "NEW"
      : before > EPSILON_WEIGHT && after <= EPSILON_WEIGHT
        ? "REMOVED"
        : delta > EPSILON_WEIGHT
          ? "INCREASED"
          : delta < -EPSILON_WEIGHT
            ? "DECREASED"
            : "UNCHANGED";
    return {
      asset_id: assetId,
      label: assetsById.get(assetId)?.display_name ?? positionLabels.get(assetId) ?? assetId,
      before_weight_pct: round6(before),
      after_weight_pct: round6(after),
      delta_weight_pct: round6(delta),
      change
    };
  }).sort((left, right) => Math.abs(right.delta_weight_pct) - Math.abs(left.delta_weight_pct) || left.label.localeCompare(right.label, "es"));

  /* Una acción cuenta a cero: pasar un 30 % de un fondo a una acción baja el coste de la cartera, y hay que verlo. */
  const terFor = (assetId: string) => assetRateForAverage(assetsById.get(assetId));
  const beforeTer = weightedKnownRate(beforeWeights, terFor);
  const afterTer = weightedKnownRate(afterWeights, terFor);
  const beforeRetro = weightedKnownRate(beforeWeights, (assetId) => retroValue(input.retroPctByAssetId, assetId));
  const afterRetro = weightedKnownRate(afterWeights, (assetId) => retroValue(input.retroPctByAssetId, assetId));
  const beforeMetrics = input.beforeMetrics ?? {};
  const afterMetrics = input.afterMetrics ?? {};

  return {
    source: input.source,
    rows,
    before_weighted_ter_rate: beforeTer,
    after_weighted_ter_rate: afterTer,
    delta_weighted_ter_rate: metricDelta(beforeTer, afterTer),
    before_weighted_retro_pct: beforeRetro,
    after_weighted_retro_pct: afterRetro,
    delta_weighted_retro_pct: metricDelta(beforeRetro, afterRetro),
    before_metrics: beforeMetrics,
    after_metrics: afterMetrics,
    metric_deltas: {
      expected_return: metricDelta(beforeMetrics.expected_return, afterMetrics.expected_return),
      volatility: metricDelta(beforeMetrics.volatility, afterMetrics.volatility),
      sharpe: metricDelta(beforeMetrics.sharpe, afterMetrics.sharpe)
    }
  };
}
