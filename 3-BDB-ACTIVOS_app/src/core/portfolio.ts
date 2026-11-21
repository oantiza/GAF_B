import { resolveMetricsFrequency, rotuloDeLaVentana } from "./metricsFrequency";
import {
  bloqueadoPorCalidadDelDato,
  historicalSelectionRestriction,
  isInvestableAsset,
  missingAssetWarning,
  seConservaEnLaCartera,
  toOptimizationAsset,
  warningFromQualityFlag
} from "./assetMapping";
import { estimatePortfolioSharpe, estimatePortfolioVolatility } from "./portfolioRiskModel";
import { clonePreviewMetricsBoundary } from "./previewMetricsBoundary";
import { QUALITY_FLAG_LABELS, readableBackendLabel } from "./labels";
import { isWeightBalanced } from "./weightTolerance";
import { concentrationBand } from "./concentration";
import { categoriaLegible } from "./etiquetasDeReparto";
import type {
  BdbAdapterWarning,
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationInput,
  BdbPortfolioWeightedMetrics,
  BdbPortfolioAllocationBucket,
  BdbPortfolioDataDiagnostic,
  BdbPortfolioDraft,
  BdbPortfolioXray,
  BdbPmsExposure,
  BdbPortfolioPosition,
  BdbPortfolioReport,
  BdbPortfolioReportPosition,
  BdbSavedLocalPortfolio,
  BdbVolatilityStatus,
  VentanaDeMetricas
} from "../types/bdbAssets";

/**
 * Tolerancia compartida de "cartera cuadrada" (±0,05 puntos de 100 %). Vive en
 * `weightTolerance.ts`; se reexporta aquí para quien ya la importaba de este
 * módulo (constructor, importación).
 */
export { WEIGHT_TOLERANCE_PERCENT, isWeightBalanced } from "./weightTolerance";

export function roundPercent(value: number): number {
  return Number(value.toFixed(4));
}

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

/**
 * La clave bajo la que un reparto junta las posiciones que no traen ese dato: sin divisa, sin región o sin categoría. Es una clave, no un texto de
 * pantalla: quien pinta un reparto la reconoce y dice «Falta el dato» (`FilasDeReparto`, con `claveDeLoQueFalta`). No se cambia sin decisión, porque
 * el informe interno del asesor la imprime tal cual en su reparto por divisa y por región, y el papel no se toca de rebote.
 */
export const CLAVE_SIN_DATO_DEL_REPARTO = "N/D";

function addBucketWeight(buckets: Map<string, number>, key: string, weightPercent: number): void {
  buckets.set(key, (buckets.get(key) ?? 0) + weightPercent);
}

function toBuckets(buckets: Map<string, number>): BdbPortfolioAllocationBucket[] {
  return Array.from(buckets.entries())
    .map(([key, weight]) => ({
      key,
      weight_percent: roundPercent(weight)
    }))
    .sort((a, b) => b.weight_percent - a.weight_percent || a.key.localeCompare(b.key));
}

function getWeightFraction(position: BdbManualPortfolioPosition): number {
  return clampPercent(position.weight_percent) / 100;
}

function getValidationStatus(totalWeight: number, positionCount: number): BdbManualPortfolioSummary["validation_status"] {
  if (positionCount === 0) {
    return "EMPTY";
  }

  if (isWeightBalanced(totalWeight)) {
    return "VALID";
  }

  return totalWeight < 100 ? "UNDER_ALLOCATED" : "OVER_ALLOCATED";
}

function cloneManualPositions(positions: BdbManualPortfolioPosition[]): BdbManualPortfolioPosition[] {
  return positions.map((position) => ({
    asset_id: position.asset_id,
    weight_percent: clampPercent(position.weight_percent),
    label: position.label,
    keepEuros: position.keepEuros,
    targetEuros: position.targetEuros
  }));
}

export function createSavedLocalPortfolio(options: {
  sourceKind: BdbAssetDataSourceKind;
  name: string;
  positions: BdbManualPortfolioPosition[];
  assets?: BdbAssetDetail[];
  now?: string;
  portfolioId?: string;
  /** La fecha de alta al sobrescribir una cartera que ya existe. */
  createdAt?: string;
  totalCapital?: number;
}): BdbSavedLocalPortfolio {
  const timestamp = options.now ?? new Date().toISOString();
  const assetsById = new Map(options.assets?.map((asset) => [asset.asset_id, asset]) ?? []);
  const safePositions =
    options.assets === undefined
      ? cloneManualPositions(options.positions)
      : cloneManualPositions(
          options.positions.filter((position) => {
            const asset = assetsById.get(position.asset_id);
            // A reviewed restriction blocks new selection, not persistence of an
            // existing historical position when the user saves their draft.
            // Lo mismo lo que no se propone por una incidencia en su serie: cotiza, y un cliente puede tenerlo (decisión 113).
            return asset ? seConservaEnLaCartera(asset) : false;
          })
        );
  const safeName = options.name.trim() || "Cartera local sin nombre";

  return {
    portfolio_id: options.portfolioId ?? `local-${timestamp.replace(/[^0-9A-Za-z]/g, "")}`,
    name: safeName,
    positions: safePositions,
    created_at: options.createdAt ?? timestamp,
    updated_at: timestamp,
    sourceKind: options.sourceKind,
    total_capital: options.totalCapital
  };
}

export function saveLocalPortfolio(
  savedPortfolios: BdbSavedLocalPortfolio[],
  portfolio: BdbSavedLocalPortfolio
): BdbSavedLocalPortfolio[] {
  return [...savedPortfolios, { ...portfolio, positions: cloneManualPositions(portfolio.positions) }];
}

export function loadLocalPortfolio(portfolio: BdbSavedLocalPortfolio): BdbManualPortfolioPosition[] {
  return cloneManualPositions(portfolio.positions);
}

export function deleteLocalPortfolio(
  savedPortfolios: BdbSavedLocalPortfolio[],
  portfolioId: string
): BdbSavedLocalPortfolio[] {
  return savedPortfolios.filter((portfolio) => portfolio.portfolio_id !== portfolioId);
}

function buildPortfolioDataDiagnostic(options: {
  positions: BdbPortfolioReportPosition[];
  summary: BdbManualPortfolioSummary;
  qualityWarnings: string[];
}): BdbPortfolioDataDiagnostic {
  const investablePositions = options.positions.filter((position) => position.is_investable);
  const flagCounts = new Map<string, number>();

  for (const position of options.positions) {
    for (const flag of position.quality_flags) {
      flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
  }

  return {
    total_positions: options.positions.length,
    investable_positions: investablePositions.length,
    excluded_non_investable_positions: options.summary.non_investable_assets.length,
    enriched_positions: investablePositions.filter(
      (position) => Boolean(position.data_quality_summary) || position.performance_preview?.available === true
    ).length,
    partial_or_warning_positions: investablePositions.filter(
      (position) =>
        position.quality_flags.some((flag) => flag !== "MOCK_DATA") ||
        dataQualitySummaryText(position.data_quality_summary).toLowerCase().includes("parcial")
    ).length,
    performance_preview_available: investablePositions.filter(
      (position) => position.performance_preview?.available === true
    ).length,
    data_quality_summary_available: investablePositions.filter((position) =>
      Boolean(position.data_quality_summary)
    ).length,
    quality_flags: Array.from(flagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([flag, count]) => ({
        flag: flag as BdbPortfolioDataDiagnostic["quality_flags"][number]["flag"],
        count
      })),
    top_warnings: [...options.summary.warnings, ...options.qualityWarnings].slice(0, 5),
    local_only_notice:
      "Diagnóstico de datos: no evalúa idoneidad ni recomienda."
  };
}

export function dataQualitySummaryText(summary: BdbPortfolioReportPosition["data_quality_summary"]): string {
  if (!summary) {
    return "";
  }
  if (typeof summary === "string") {
    return summary;
  }
  return `Cobertura ${summary.coverage_status}; métricas ${summary.has_metrics ? "disponibles" : "no disponibles"}; warnings ${summary.warnings_count}.`;
}

/** Entrada mínima del cálculo canónico de exposición PMS (S6a, P5). */
export interface PmsExposureInput {
  weight_percent: number;
  pms_exposure?: Partial<BdbPmsExposure> | null;
  economic_asset_class?: string | null;
}

export interface PmsExposureDistribution {
  /** Reparto por clases, normalizado: SIEMPRE suma 100 de lo invertido. */
  percent: Required<Omit<BdbPmsExposure, "source">>;
  /** % del peso invertido cuyo activo aporta vector PMS real. */
  covered_weight_percent: number;
  /** % del peso invertido rellenado por clase económica (sin vector). */
  fallback_weight_percent: number;
  /** % del peso cubierto cuyo vector viene de PORTFOLIO_EXPOSURE (look-through real). */
  real_lookthrough_weight_percent: number;
}

const PMS_KEYS = ["equity", "fixed_income", "cash", "alternative", "real_asset", "other"] as const;
type PmsKey = (typeof PMS_KEYS)[number];

const ECONOMIC_CLASS_TO_PMS: Record<string, PmsKey> = {
  EQUITY: "equity",
  FIXED_INCOME: "fixed_income",
  MONEY_MARKET: "cash",
  ALTERNATIVE: "alternative",
  REAL_ASSET: "real_asset",
  MIXED: "other",
  COMMODITIES: "other",
  OTHER: "other"
};

/**
 * Cuánto puede salirse una clase de 0-1, y cuánto puede no sumar 1 el conjunto, para leer el reparto tal cual (decisión A-63 de
 * Óscar, 05-11-2026). Es lo que admite el contrato de `declared/exposure` en la base nueva, así que allí pasa todo; la base
 * vieja no se valida, y trae hasta bonos al 241 % con liquidez al −143 %.
 */
const TOLERANCIA_DE_UNA_CLASE = 0.01;
const TOLERANCIA_DE_LA_SUMA = 0.01;

function esUnRepartoNeto(valores: readonly number[]): boolean {
  const suma = valores.reduce((total, valor) => total + valor, 0);
  return (
    Math.abs(suma - 1) <= TOLERANCIA_DE_LA_SUMA &&
    valores.every((valor) => valor >= -TOLERANCIA_DE_UNA_CLASE && valor <= 1 + TOLERANCIA_DE_UNA_CLASE)
  );
}

export interface AssetPmsShares {
  /**
   * Fracciones por clase que suman 1. No tienen por qué estar entre 0 y 1: el reparto del proveedor es neto de cortos, y una clase
   * puede ser un poco negativa y otra pasar de 1. Quien la use como un peso que no puede ser negativo, que lo mire (`eqW <= 0`).
   */
  shares: Record<PmsKey, number>;
  /** `vector`: del vector PMS del activo; `class`: relleno por su clase económica. */
  source: "vector" | "class";
}

/**
 * Reparto por clases de UN activo con las reglas 1 y 2 de
 * `computePmsExposureDistribution`: su vector PMS normalizado por su propia suma
 * o, si no lo tiene (o es todo ceros), el 100 % en el cubo de su clase económica.
 * Es la misma definición de «peso en renta variable» para el reparto por clases,
 * el look-through de regiones y el de sectores.
 *
 * Un reparto neto se lee tal cual (decisión A-63): la renta fija de Lazard, −0,08 %, no se esconde ni se reparte entre las demás, y
 * con ella la bolsa es su 100,04 %, no un 99,96 %. Un vector fuera de eso, que solo trae la base vieja, no se deja describir así:
 * cuenta lo positivo, normalizado, como siempre.
 */
export function assetPmsShares(item: Pick<PmsExposureInput, "pms_exposure" | "economic_asset_class">): AssetPmsShares {
  const vector = item.pms_exposure;
  const brutos = PMS_KEYS.map((key) => {
    const value = vector?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  });
  const parts = esUnRepartoNeto(brutos) ? brutos : brutos.map((value) => (value > 0 ? value : 0));
  const vectorSum = parts.reduce((sum, value) => sum + value, 0);
  const shares: Record<PmsKey, number> = { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 };
  if (vector && vectorSum > 0) {
    PMS_KEYS.forEach((key, index) => {
      shares[key] = parts[index] / vectorSum;
    });
    return { shares, source: "vector" };
  }
  shares[ECONOMIC_CLASS_TO_PMS[String(item.economic_asset_class || "").toUpperCase()] ?? "other"] = 1;
  return { shares, source: "class" };
}

/**
 * Cálculo CANÓNICO del reparto por clases (decisión 27-07, P5): antes había
 * cuatro implementaciones que podían enseñar números distintos de la misma
 * cartera (core sin normalizar; Resumen normalizado sin relleno; los dos PDF
 * sin normalizar con relleno). Criterio único, elegido por Oscar:
 *   1. Cada vector PMS se normaliza por su propia suma (defensa ante vectores
 *      que no suman 1).
 *   2. Un activo SIN vector cuenta por su clase económica (relleno, como los
 *      PDF) — nunca desaparece del reparto.
 *   3. El resultado se normaliza al 100% de lo invertido; la cobertura del
 *      vector real se devuelve aparte para poder decirla.
 */
export function computePmsExposureDistribution(items: PmsExposureInput[]): PmsExposureDistribution | null {
  const acc: Record<PmsKey, number> = {
    equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0
  };
  let covered = 0;
  let fallback = 0;
  let real = 0;

  for (const item of items) {
    const weight = clampPercent(item.weight_percent);
    if (weight <= 0) {
      continue;
    }
    const { shares, source } = assetPmsShares(item);
    PMS_KEYS.forEach((key) => {
      acc[key] += weight * shares[key];
    });
    /* El servidor rellena por su clase al activo que no trae mezcla (`CLASSIFICATION_FALLBACK`): reparte igual, pero no es un vector, y no cubre. */
    if (source === "vector" && item.pms_exposure?.source !== "CLASSIFICATION_FALLBACK") {
      covered += weight;
      if (item.pms_exposure?.source === "PORTFOLIO_EXPOSURE") {
        real += weight;
      }
    } else {
      fallback += weight;
    }
  }

  const total = covered + fallback;
  if (total <= 0) {
    return null;
  }
  const percent = {
    equity: (acc.equity / total) * 100,
    fixed_income: (acc.fixed_income / total) * 100,
    cash: (acc.cash / total) * 100,
    alternative: (acc.alternative / total) * 100,
    real_asset: (acc.real_asset / total) * 100,
    other: (acc.other / total) * 100
  };
  return {
    percent,
    covered_weight_percent: (covered / total) * 100,
    fallback_weight_percent: (fallback / total) * 100,
    real_lookthrough_weight_percent: covered > 0 ? (real / covered) * 100 : 0
  };
}

function buildPortfolioXray(options: {
  positions: BdbPortfolioReportPosition[];
  summary: BdbManualPortfolioSummary;
}): BdbPortfolioXray {
  const investablePositions = options.positions.filter((position) => position.is_investable);
  const byCurrency = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byCategory = new Map<string, number>();

  for (const position of investablePositions) {
    const weight = clampPercent(position.weight_percent);

    addBucketWeight(byCurrency, position.currency || CLAVE_SIN_DATO_DEL_REPARTO, weight);
    addBucketWeight(byRegion, position.region || CLAVE_SIN_DATO_DEL_REPARTO, weight);
    /* Por el nombre que se enseña, y no por el texto del proveedor: la misma categoría en dos idiomas es una sola fila (decisión 101). */
    addBucketWeight(byCategory, categoriaLegible(position.category) ?? CLAVE_SIN_DATO_DEL_REPARTO, weight);
  }

  // S6a (P5): reparto por clases por la vía canónica única.
  const pmsDistribution = computePmsExposureDistribution(investablePositions);

  const positionConcentration = investablePositions
    .map((position) => ({
      asset_id: position.asset_id,
      display_name: position.display_name,
      instrument_type: position.instrument_type,
      economic_asset_class: position.economic_asset_class,
      weight_percent: roundPercent(clampPercent(position.weight_percent))
    }))
    .sort((a, b) => b.weight_percent - a.weight_percent || a.display_name.localeCompare(b.display_name));
  const topPosition = positionConcentration[0];
  const topWeight = topPosition?.weight_percent ?? 0;
  // Umbral único de concentración (MEDIA-06, 17-10-2026): antes 35/50 aquí.
  const band = concentrationBand(topWeight);
  const concentrationLevel = band === "HIGH" ? "CONCENTRATED" : band;
  const dataRiskSignals: string[] = [];
  const missingPerformanceCount = investablePositions.filter(
    (position) => position.performance_preview?.available !== true
  ).length;
  const warningPositionCount = investablePositions.filter((position) =>
    position.quality_flags.some((flag) => flag !== "MOCK_DATA")
  ).length;

  if (concentrationLevel === "CONCENTRATED") {
    dataRiskSignals.push("Concentración alta en la posición principal.");
  } else if (concentrationLevel === "WATCH") {
    dataRiskSignals.push("Concentración relevante en la posición principal.");
  }
  const bloqueados = options.summary.quality_blocked_assets?.length ?? 0;
  if (options.summary.non_investable_assets.length > bloqueados) {
    dataRiskSignals.push("Índices y activos no invertibles excluidos de la lectura.");
  }
  if (bloqueados > 0) {
    dataRiskSignals.push("Posiciones con una incidencia en su serie de precios, excluidas de la lectura.");
  }
  if (missingPerformanceCount > 0) {
    // Misma etiqueta que la ficha y el diagnóstico: «Métricas de rentabilidad y riesgo».
    dataRiskSignals.push(`${missingPerformanceCount} posiciones invertibles sin métricas de rentabilidad y riesgo.`);
  }
  if (warningPositionCount > 0) {
    dataRiskSignals.push(`${warningPositionCount} posiciones invertibles con avisos de calidad.`);
  }

  return {
    total_positions: options.positions.length,
    investable_positions: investablePositions.length,
    excluded_non_investable_positions: options.summary.non_investable_assets.length,
    top_position: topPosition,
    position_concentration: positionConcentration.slice(0, 5),
    concentration_level: concentrationLevel,
    by_instrument_type: options.summary.by_instrument_type,
    by_economic_asset_class: options.summary.by_economic_asset_class,
    by_currency: toBuckets(byCurrency),
    by_region: toBuckets(byRegion),
    by_category: toBuckets(byCategory),
    pms_exposure_percent: {
      equity: roundPercent(pmsDistribution?.percent.equity ?? 0),
      fixed_income: roundPercent(pmsDistribution?.percent.fixed_income ?? 0),
      cash: roundPercent(pmsDistribution?.percent.cash ?? 0),
      alternative: roundPercent(pmsDistribution?.percent.alternative ?? 0),
      real_asset: roundPercent(pmsDistribution?.percent.real_asset ?? 0),
      other: roundPercent(pmsDistribution?.percent.other ?? 0)
    },
    pms_exposure_coverage_percent: roundPercent(pmsDistribution?.covered_weight_percent ?? 0),
    pms_exposure_fallback_percent: roundPercent(pmsDistribution?.fallback_weight_percent ?? 0),
    coverage_complete_positions: investablePositions.filter((position) => position.coverage_status === "COMPLETE")
      .length,
    performance_preview_available: investablePositions.filter(
      (position) => position.performance_preview?.available === true
    ).length,
    data_quality_summary_available: investablePositions.filter((position) =>
      Boolean(position.data_quality_summary)
    ).length,
    data_risk_signals: dataRiskSignals
  };
}

export function toPortfolioPositions(manualPositions: BdbManualPortfolioPosition[]): BdbPortfolioPosition[] {
  return manualPositions.map((position) => ({
    asset_id: position.asset_id,
    weight: getWeightFraction(position),
    label: position.label
  }));
}

export function buildPortfolioDraft(options: {
  source: BdbAssetDataSourceKind;
  portfolioId: string;
  baseCurrency?: string;
  positions: BdbPortfolioPosition[];
  selectedAssets: BdbAssetDetail[];
}): BdbPortfolioDraft {
  const selectedAssetIds = new Set(options.selectedAssets.map((asset) => asset.asset_id));

  return {
    source: options.source,
    portfolio_id: options.portfolioId,
    base_currency: options.baseCurrency ?? "EUR",
    positions: options.positions.map((position) => ({ ...position })),
    warnings: options.positions
      .filter((position) => !selectedAssetIds.has(position.asset_id))
      .map((position) => missingAssetWarning(position.asset_id))
  };
}

export interface PortfolioPreviewMetricsResult {
  metrics: BdbPortfolioWeightedMetrics;
  coverage: number;
  currencyMixWarning: boolean;
}

function weightedMetric(
  positions: BdbManualPortfolioPosition[],
  assetsById: Map<string, BdbAssetDetail>,
  pick: (asset: BdbAssetDetail) => number | undefined
): { value?: number; coverage: number } {
  let weighted = 0;
  let contributingWeight = 0;
  let totalWeight = 0;

  for (const position of positions) {
    const asset = assetsById.get(position.asset_id);
    const weight = clampPercent(position.weight_percent) / 100;
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    if (!asset || !isInvestableAsset(asset)) continue;
    const value = pick(asset);
    if (typeof value === "number" && Number.isFinite(value)) {
      weighted += value * weight;
      contributingWeight += weight;
    }
  }

  return {
    value: contributingWeight > 0 ? roundPercent(weighted / contributingWeight) : undefined,
    coverage: totalWeight > 0 ? contributingWeight / totalWeight : 0
  };
}

function portfolioVolatilityMetric(
  positions: BdbManualPortfolioPosition[],
  assetsById: Map<string, BdbAssetDetail>,
  ventana: VentanaDeMetricas,
  pick: (asset: BdbAssetDetail) => number | undefined
) {
  const inputs = positions.map((position) => {
    const asset = assetsById.get(position.asset_id);
    return {
      assetClass: asset?.economic_asset_class ?? "UNKNOWN",
      volatility: asset && isInvestableAsset(asset) ? pick(asset) : undefined,
      frequency: rotuloDeLaVentana(asset?.metrics, ventana).frequency,
      weight: clampPercent(position.weight_percent) / 100
    };
  });
  const conDato = inputs.filter((row) =>
    row.weight > 0 && typeof row.volatility === "number" && Number.isFinite(row.volatility)
  );
  const frequency = resolveMetricsFrequency(conDato.map((row) => row.frequency));
  /* `compatible` también es falso si nadie trae el dato, y eso no es que los métodos difieran. */
  const status: BdbVolatilityStatus = conDato.length === 0 ? "sin_dato" : frequency.compatible ? "ok" : "metodos_distintos";
  return {
    ...(frequency.compatible ? estimatePortfolioVolatility(inputs) : { value: undefined, coverage: 0 }),
    frequency,
    status
  };
}

/**
 * Auditoría 29-09 (F-06): cobertura ponderada mínima para dar por buena una
 * métrica de ventana larga (5A/10A). La suma ponderada se reescala a la parte
 * de la cartera con dato, así que con un 30 % de la cartera con 5A salía una
 * «Rentabilidad 5A» que era la de ese 30 %, presentada como de toda la cartera
 * y con `metric_coverage` (que solo mira 3A) al 100 %. Por debajo del umbral la
 * métrica queda N/D y la cobertura propia de cada ventana viaja en el resumen.
 */
export const LONG_WINDOW_METRIC_COVERAGE_THRESHOLD = 0.8;

function metricIfCovered(metric: { value?: number; coverage: number }): number | undefined {
  return metric.coverage >= LONG_WINDOW_METRIC_COVERAGE_THRESHOLD ? metric.value : undefined;
}

export function computePortfolioPreviewMetrics(options: {
  manualPositions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
}): PortfolioPreviewMetricsResult {
  const assetsById = new Map(options.assets.map((asset) => [asset.asset_id, asset]));
  const metric = (pick: (asset: BdbAssetDetail) => number | undefined) =>
    weightedMetric(options.manualPositions, assetsById, pick);
  const ret3 = metric((asset) => asset.metrics.annualized_return_3y);
  const ret1 = metric((asset) => asset.metrics.annualized_return_1y);
  const ret5 = metric((asset) => asset.metrics.annualized_return_5y);
  const ret10 = metric((asset) => asset.metrics.annualized_return_10y);
  const vol1 = portfolioVolatilityMetric(options.manualPositions, assetsById, "1y", (asset) => asset.metrics.volatility_1y);
  const vol3 = portfolioVolatilityMetric(options.manualPositions, assetsById, "3y", (asset) => asset.metrics.volatility_3y);
  const vol5 = portfolioVolatilityMetric(options.manualPositions, assetsById, "5y", (asset) => asset.metrics.volatility_5y);
  const coverage = Math.min(ret3.coverage || 0, vol3.coverage || 0);
  // F-06: cobertura por ventana; 5A y 10A solo se publican si la alcanzan.
  const coverage1y = Math.min(ret1.coverage || 0, vol1.coverage || 0);
  const coverage5y = Math.min(ret5.coverage || 0, vol5.coverage || 0);
  const coverage10y = ret10.coverage || 0;
  const ret5Value = metricIfCovered(ret5);
  const vol5Value = metricIfCovered({ value: vol5.value, coverage: vol5.coverage || 0 });
  const caida5 = metric((asset) => asset.metrics.max_drawdown_5y);
  const caidaHistorica = metric((asset) => asset.metrics.max_drawdown_hist?.value);
  const currencies = new Set<string>();

  for (const position of options.manualPositions) {
    const asset = assetsById.get(position.asset_id);
    if (asset && isInvestableAsset(asset) && clampPercent(position.weight_percent) > 0) {
      currencies.add(asset.currency || "EUR");
    }
  }

  return {
    coverage,
    currencyMixWarning: Array.from(currencies).some((currency) => currency !== "EUR"),
    metrics: {
      preview_boundary: clonePreviewMetricsBoundary(vol3.frequency.note),
      annualized_return_3y: ret3.value,
      volatility_3y: vol3.value,
      sharpe_3y: estimatePortfolioSharpe(ret3.value, vol3.value),
      // MEDIA-05 (auditoría 16-10-2026): la máxima caída se reescalaba a la
      // parte con dato sin umbral; con un 30 % de la cartera salía la caída de
      // ese 30 % como «media de activos». Mismo umbral que 5A y 10A (F-06).
      max_drawdown_5y: metricIfCovered(caida5),
      max_drawdown_hist: {
        value: metricIfCovered(caidaHistorica)
      },
      annualized_return_1y: ret1.value,
      annualized_return_5y: ret5Value,
      annualized_return_10y: metricIfCovered(ret10),
      volatility_1y: vol1.value,
      volatility_5y: vol5Value,
      sharpe_1y: estimatePortfolioSharpe(ret1.value, vol1.value),
      sharpe_5y: estimatePortfolioSharpe(ret5Value, vol5Value),
      metric_coverage: roundPercent(coverage),
      metric_coverage_1y: roundPercent(coverage1y),
      metric_coverage_5y: roundPercent(coverage5y),
      return_coverage_5y: roundPercent(ret5.coverage || 0),
      return_coverage_3y: roundPercent(ret3.coverage || 0),
      volatility_comparable: vol3.frequency.compatible,
      metric_coverage_10y: roundPercent(coverage10y),
      currency_mix_warning: Array.from(currencies).some((currency) => currency !== "EUR"),
      volatility_detail: {
        "1Y": { coverage: roundPercent(vol1.coverage || 0), status: vol1.status },
        "3Y": { coverage: roundPercent(vol3.coverage || 0), status: vol3.status },
        "5Y": { coverage: roundPercent(vol5.coverage || 0), status: vol5.status }
      },
      max_drawdown_coverage: { hist: roundPercent(caidaHistorica.coverage || 0), "5Y": roundPercent(caida5.coverage || 0) }
    }
  };
}

export function buildSummaryFromAssets(options: {
  source: BdbAssetDataSourceKind;
  manualPositions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
}): BdbManualPortfolioSummary {
  const assetsById = new Map(options.assets.map((asset) => [asset.asset_id, asset]));
  const totalWeight = roundPercent(
    options.manualPositions.reduce((sum, position) => sum + clampPercent(position.weight_percent), 0)
  );
  const byInstrumentType = new Map<string, number>();
  const byEconomicAssetClass = new Map<string, number>();
  const nonInvestableAssets: string[] = [];
  const bloqueadosPorCalidad: string[] = [];
  const warnings: string[] = [];
  let nonInvestableWeight = 0;
  let pesoBloqueadoPorCalidad = 0;
  let pesoSinSerie = 0;
  let notFoundWeight = 0;
  const fueraDelCatalogo: NonNullable<BdbManualPortfolioSummary["not_found_positions"]> = [];

  for (const position of options.manualPositions) {
    const asset = assetsById.get(position.asset_id);

    if (!asset) {
      notFoundWeight += clampPercent(position.weight_percent);
      if (clampPercent(position.weight_percent) > 0) {
        fueraDelCatalogo.push({ asset_id: position.asset_id, ...(position.label ? { label: position.label } : {}), weight_percent: clampPercent(position.weight_percent) });
      }
      warnings.push(`Activo no encontrado: ${position.asset_id}`);
      continue;
    }

    if (!isInvestableAsset(asset)) {
      nonInvestableWeight += clampPercent(position.weight_percent);
      nonInvestableAssets.push(asset.asset_id);
      if (bloqueadoPorCalidadDelDato(asset)) {
        bloqueadosPorCalidad.push(asset.asset_id);
        pesoBloqueadoPorCalidad += clampPercent(position.weight_percent);
        warnings.push(`${asset.asset_id} tiene una incidencia en su serie de precios, y no entra en las métricas ni en el reparto.`);
        continue;
      }
      const restriction = historicalSelectionRestriction(asset);
      /* La CAM: nunca se resolvió y no tiene serie de precios. Queda fuera por eso, y así lo dice la pantalla (decisión 44). */
      if ((asset.quality_flags ?? []).includes("NON_INVESTABLE_NEVER_RESOLVED")) pesoSinSerie += clampPercent(position.weight_percent);
      warnings.push(restriction
        ? `${asset.asset_id}: ${(QUALITY_FLAG_LABELS[restriction] ?? readableBackendLabel(restriction)).toLocaleLowerCase("es")}. La posición se conserva para consulta; queda excluida de nuevas propuestas de inversión.`
        : `${asset.asset_id} es benchmark/no invertible y no contribuye a métricas ni allocation invertible.`);
      continue;
    }

    const clampedWeight = clampPercent(position.weight_percent);
    addBucketWeight(byInstrumentType, asset.instrument_type, clampedWeight);
    addBucketWeight(byEconomicAssetClass, asset.economic_asset_class, clampedWeight);
  }

  const validationStatus = getValidationStatus(totalWeight, options.manualPositions.length);

  if (validationStatus === "UNDER_ALLOCATED") {
    warnings.push("La suma de pesos está por debajo de 100%.");
  }
  if (validationStatus === "OVER_ALLOCATED") {
    warnings.push("La suma de pesos supera 100%.");
  }
  const preview = computePortfolioPreviewMetrics({
    manualPositions: options.manualPositions,
    assets: options.assets
  });
  if (options.manualPositions.length > 0 && preview.coverage < 1) {
    warnings.push(`Metricas parciales (${roundPercent(preview.coverage * 100)}% de la cartera).`);
  }
  if (preview.currencyMixWarning) {
    warnings.push("Mezcla de divisas sin convertir.");
  }

  return {
    source: options.source,
    position_count: options.manualPositions.length,
    total_weight_percent: totalWeight,
    validation_status: validationStatus,
    is_valid: validationStatus === "VALID" && options.manualPositions.every((position) => {
      const asset = assetsById.get(position.asset_id);
      return clampPercent(position.weight_percent) === 0 || Boolean(asset && isInvestableAsset(asset));
    }),
    by_instrument_type: toBuckets(byInstrumentType),
    by_economic_asset_class: toBuckets(byEconomicAssetClass),
    non_investable_assets: nonInvestableAssets,
    /* Lo que las filas de arriba no cuentan. Solo lo lee la pantalla (`repartoDeLaCartera`), y solo sale si hay algo. */
    ...(nonInvestableWeight > 0 ? { non_investable_weight_percent: roundPercent(nonInvestableWeight) } : {}),
    ...(bloqueadosPorCalidad.length > 0
      ? { quality_blocked_assets: bloqueadosPorCalidad, quality_blocked_weight_percent: roundPercent(pesoBloqueadoPorCalidad) }
      : {}),
    ...(pesoSinSerie > 0 ? { never_resolved_weight_percent: roundPercent(pesoSinSerie) } : {}),
    ...(notFoundWeight > 0 ? { not_found_weight_percent: roundPercent(notFoundWeight), not_found_positions: fueraDelCatalogo } : {}),
    warnings,
    weighted_metrics: preview.metrics
  };
}

export function buildReportFromAssets(options: {
  source: BdbAssetDataSourceKind;
  portfolioName: string;
  manualPositions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  summary?: BdbManualPortfolioSummary;
}): BdbPortfolioReport {
  const summary =
    options.summary ??
    buildSummaryFromAssets({
      source: options.source,
      manualPositions: options.manualPositions,
      assets: options.assets
    });
  const assetsById = new Map(options.assets.map((asset) => [asset.asset_id, asset]));
  const positions: BdbPortfolioReportPosition[] = options.manualPositions
    .map((position): BdbPortfolioReportPosition | null => {
      const asset = assetsById.get(position.asset_id);

      if (!asset) {
        return null;
      }

      return {
        asset_id: asset.asset_id,
        display_name: asset.display_name,
        instrument_type: asset.instrument_type,
        economic_asset_class: asset.economic_asset_class,
        currency: asset.currency,
        region: asset.region,
        category: asset.category,
        coverage_status: asset.coverage_status,
        weight_percent: clampPercent(position.weight_percent),
        is_investable: isInvestableAsset(asset),
        role: asset.role,
        quality_flags: asset.quality_flags,
        pms_exposure: asset.pms_exposure,
        performance_preview: asset.performance_preview,
        data_quality_summary: asset.data_quality_summary
      };
    })
    .filter((position): position is BdbPortfolioReportPosition => Boolean(position));
  /* El aviso llega a pantalla: código traducido, no jerga del backend. */
  const qualityWarnings = positions.flatMap((position) =>
    position.quality_flags
      .filter((flag) => flag !== "MOCK_DATA")
      .map((flag) => `${position.asset_id} · ${QUALITY_FLAG_LABELS[flag] ?? readableBackendLabel(flag)}.`)
  );
  const dataDiagnostic = buildPortfolioDataDiagnostic({
    positions,
    summary,
    qualityWarnings
  });
  const xray = buildPortfolioXray({
    positions,
    summary
  });

  return {
    portfolio_name: options.portfolioName,
    mode: options.source,
    summary,
    positions,
    xray,
    data_diagnostic: dataDiagnostic,
    warnings: [...summary.warnings, ...qualityWarnings]
  };
}

export function buildOptimizationInputFromDraft(options: {
  source: BdbAssetDataSourceKind;
  draft: BdbPortfolioDraft;
  selectedAssets: BdbAssetDetail[];
}): BdbOptimizationInput {
  const selectedAssetIds = new Set(options.selectedAssets.map((asset) => asset.asset_id));
  const investableAssets = options.selectedAssets.filter(isInvestableAsset);
  const investableAssetIds = new Set(investableAssets.map((asset) => asset.asset_id));
  const missingWarnings = options.draft.positions
    .filter((position) => !selectedAssetIds.has(position.asset_id))
    .map((position) => missingAssetWarning(position.asset_id));
  const nonInvestableWarnings: BdbAdapterWarning[] = options.selectedAssets
    .filter((asset) => !isInvestableAsset(asset))
    .map((asset) => warningFromQualityFlag(asset, historicalSelectionRestriction(asset) ?? (bloqueadoPorCalidadDelDato(asset) ? "QUALITY_BLOCKED" : "NON_INVESTABLE_BENCHMARK")));

  return {
    portfolio_id: options.draft.portfolio_id,
    base_currency: options.draft.base_currency,
    positions: options.draft.positions.filter((position) => investableAssetIds.has(position.asset_id)),
    assets: investableAssets.map(toOptimizationAsset),
    warnings: [
      ...options.draft.warnings,
      ...options.selectedAssets.flatMap((asset) => asset.warnings),
      ...missingWarnings,
      ...nonInvestableWarnings
    ],
    source: options.source
  };
}
