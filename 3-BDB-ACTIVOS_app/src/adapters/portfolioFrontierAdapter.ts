/**
 * Adapter PURO para el contrato portfolio-frontier.v1.
 *
 * - Valida discriminantes y campos obligatorios.
 * - Mantiene las tasas en DECIMAL internamente.
 * - Convierte la respuesta del contrato a un view model de UI.
 * - NO realiza ninguna llamada remota (la callable se cableará en O1).
 * - NO recibe ni procesa series crudas.
 * - NO calcula retornos, covarianzas ni frontera (eso es del backend).
 */
import {
  HISTORICAL_FRONTIER_LABEL,
  LIMITE_DEL_PERIODO,
  PREFIJO_SIN_SOLUCION,
  type FrontierExclusionReason,
  type FrontierNotSelectableReason,
  type FrontierNotSelectableView,
  type FrontierHistoricalState,
  type FrontierObjective,
  type FrontierPointView,
  type FrontierViewModel,
  type FrontierWindow,
  type PortfolioFrontierAssetLimit,
  type PortfolioFrontierExcludedAsset,
  type PortfolioFrontierExtension,
  type PortfolioFrontierMeasure,
  type PortfolioFrontierPoint,
  type PortfolioFrontierResponse,
  type PortfolioFrontierTargetReturnMeasured,
  type PortfolioRiskContribution,
  type PortfolioRiskContributionMeta,
  type PortfolioOptimizationRequest
} from "../types/portfolioFrontier";
import { numero, oFalta, peso, porcentaje, ratio, rentabilidad } from "../core/formato";
import { AppError, esFaltaDeDatos, limiteDelCalculo, MENSAJE_GENERICO_PRECONDICION, sinEstadoHttp, toAppError } from "../core/appError";

const WINDOWS: FrontierWindow[] = ["1Y", "3Y", "5Y", "10Y"];
const OBJECTIVES: FrontierObjective[] = ["MAX_SHARPE", "MIN_VOLATILITY", "TARGET_RETURN", "TARGET_RISK"];
const EXCLUSION_REASONS: FrontierExclusionReason[] = [
  "PRICE_SERIES_MISSING",
  "INSUFFICIENT_HISTORY",
  "REFERENCE_LINK_FAILED",
  "SERIES_ENDS_EARLY",
  "FX_SERIES_MISSING",
  "FX_QUARANTINE",
  "NON_INVESTABLE",
  "QUALITY_BLOCKED",
  "DISTRIBUTES_WITHOUT_PAYMENTS"
];

const REASON_LABELS: Record<FrontierExclusionReason, string> = {
  PRICE_SERIES_MISSING: "Sin serie de precios",
  INSUFFICIENT_HISTORY: "Histórico insuficiente",
  REFERENCE_LINK_FAILED: "Su historia no se pudo completar con su referencia",
  SERIES_ENDS_EARLY: "Sus precios acaban antes del final del periodo",
  FX_SERIES_MISSING: "Sin conversión a euros",
  FX_QUARANTINE: "Sin conversión a euros fiable",
  NON_INVESTABLE: "No invertible",
  QUALITY_BLOCKED: "Bloqueado por calidad de dato",
  DISTRIBUTES_WITHOUT_PAYMENTS: "Reparte y no tenemos todos los pagos"
};

const NOT_SELECTABLE_LABELS: Record<FrontierNotSelectableReason, string> = {
  FROZEN_PRICE: "precio congelado",
  CORPORATE_ACTION: "operación corporativa",
  SELECTION_BLOCKED: "bloqueado para nuevas compras",
  OTHER: "no se puede comprar"
};

/**
 * Lo medido que no entra en la frontera de Simular (`frontier_excluded_assets`). Un servidor de antes no lo manda: entonces es
 * una lista vacía, y la frontera es la de siempre. Cada activo ha de estar entre los medidos y con un peso de 0 a 1.
 */
export function parseFrontierNotSelectable(value: unknown, measuredAssetIds: readonly string[]): FrontierNotSelectableView[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("frontier_excluded_assets debe ser un array.");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const ctx = `frontier_excluded_assets[${index}]`;
    if (!isObject(item)) throw new Error(`${ctx} inválido`);
    const assetId = requireString(item.asset_id, `${ctx}.asset_id`);
    if (!measuredAssetIds.includes(assetId) || seen.has(assetId)) throw new Error(`${ctx}.asset_id ajeno a la cartera medida: ${assetId}`);
    seen.add(assetId);
    const weight = requireNumber(item.weight, `${ctx}.weight`);
    if (weight < 0 || weight > 1 + 1e-9) throw new Error(`${ctx}.weight fuera de 0 a 1: ${weight}`);
    const raw = item.reason;
    const reason: FrontierNotSelectableReason = raw === "FROZEN_PRICE" || raw === "CORPORATE_ACTION" || raw === "SELECTION_BLOCKED" ? raw : "OTHER";
    return { assetId, reason, reasonLabel: NOT_SELECTABLE_LABELS[reason], weight };
  });
}

/* ---------------------------- formato ---------------------------- */

/** Decimal -> porcentaje es-ES con coma, sin signo. 0.0193 -> "1,93 %". */
export function formatDecimalAsPercent(value: number, digits = 2): string {
  return oFalta(porcentaje(value, { decimales: digits }));
}

/** Ratio con coma decimal. 0.55 -> "0,55". */
export function formatRatio(value: number, digits = 2): string {
  return oFalta(numero(value, { decimales: digits }));
}

export function reasonLabel(reason: FrontierExclusionReason): string {
  return REASON_LABELS[reason] ?? reason;
}

/* --------------------------- validación -------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireNumber(value: unknown, field: string): number {
  if (!isFiniteNumber(value)) {
    throw new Error(`Campo numérico inválido: ${field}`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Campo de texto inválido: ${field}`);
  }
  return value;
}

function requireLiteral<T extends string | number>(value: unknown, expected: T, field: string): T {
  if (value !== expected) {
    throw new Error(`${field} inesperado: ${String(value)}`);
  }
  return expected;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNumber(value, field);
}

function parseWeights(value: unknown, ctx: string): Record<string, number> {
  if (!isObject(value)) {
    throw new Error(`${ctx}.weights inválido`);
  }
  const out: Record<string, number> = {};
  for (const [assetId, weight] of Object.entries(value)) {
    out[assetId] = requireNumber(weight, `${ctx}.weights.${assetId}`);
  }
  return out;
}

/**
 * El Sharpe de un punto: con volatilidad cero no existe y va `null` (hallazgo 11, 15-11-2026), también si un servidor anterior
 * manda un 0. Con volatilidad tiene que ser un número.
 */
function sharpeDelPunto(raw: unknown, volatility: number, ctx: string): number | null {
  if (volatility <= 1e-12) return null;
  return requireNumber(raw, `${ctx}.sharpe_ratio`);
}

function parsePoint(value: unknown, ctx: string): PortfolioFrontierPoint {
  if (!isObject(value)) {
    throw new Error(`${ctx} inválido`);
  }
  return {
    expected_return: requireNumber(value.expected_return, `${ctx}.expected_return`),
    volatility: requireNumber(value.volatility, `${ctx}.volatility`),
    sharpe_ratio: sharpeDelPunto(value.sharpe_ratio, requireNumber(value.volatility, `${ctx}.volatility`), ctx),
    weights: parseWeights(value.weights, ctx)
  };
}

function parseExcluded(value: unknown, ctx: string): PortfolioFrontierExcludedAsset {
  if (!isObject(value)) {
    throw new Error(`${ctx} inválido`);
  }
  const assetId = requireString(value.asset_id, `${ctx}.asset_id`);
  const reason = value.reason;
  if (typeof reason !== "string" || !EXCLUSION_REASONS.includes(reason as FrontierExclusionReason)) {
    throw new Error(`${ctx}.reason inválido: ${String(reason)}`);
  }
  return { asset_id: assetId, reason: reason as FrontierExclusionReason };
}

function parseExtensions(value: unknown): PortfolioFrontierExtension[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("extensions debe ser un array");
  }
  return value.map((raw, index) => {
    if (!isObject(raw)) {
      throw new Error(`extensions[${index}] inválido`);
    }
    return {
      asset_id: requireString(raw.asset_id, `extensions[${index}].asset_id`),
      reference: requireString(raw.reference, `extensions[${index}].reference`),
      estimated_from: requireString(raw.estimated_from, `extensions[${index}].estimated_from`),
      estimated_until: requireString(raw.estimated_until, `extensions[${index}].estimated_until`)
    };
  });
}

function parseMeasure(value: unknown, ctx: string): PortfolioFrontierMeasure | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    throw new Error(`${ctx} inválido`);
  }
  return {
    cagr: requireNumber(value.cagr, `${ctx}.cagr`),
    volatility: requireNumber(value.volatility, `${ctx}.volatility`),
    sharpe: requireNumber(value.sharpe, `${ctx}.sharpe`),
    max_drawdown: requireNumber(value.max_drawdown, `${ctx}.max_drawdown`)
  };
}

function parseAssetLimit(value: unknown): PortfolioFrontierAssetLimit | undefined {
  /* Aditivo: un servidor anterior no lo manda, y uno que lo mande mal no tira la propuesta, que sí es válida. */
  if (!isObject(value)) return undefined;
  const numero = (campo: unknown) => (typeof campo === "number" && Number.isInteger(campo) && campo > 0 ? campo : undefined);
  const weekly = numero(value.weekly_returns);
  const max = numero(value.max_assets);
  const refWeekly = numero(value.reference_weekly_returns);
  const refMax = numero(value.reference_max_assets);
  if (weekly === undefined || max === undefined || refWeekly === undefined || refMax === undefined) return undefined;
  return {
    window: typeof value.window === "string" ? value.window : "",
    weekly_returns: weekly,
    max_assets: max,
    reference_window: typeof value.reference_window === "string" ? value.reference_window : "",
    reference_weekly_returns: refWeekly,
    reference_max_assets: refMax
  };
}

function parseTargetReturnMeasured(value: unknown): PortfolioFrontierTargetReturnMeasured | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error("target_return_measured inválido");
  }
  return {
    portfolio: parseMeasure(value.portfolio, "target_return_measured.portfolio"),
    current: parseMeasure(value.current, "target_return_measured.current")
  };
}

function parseRiskContributions(value: unknown): PortfolioRiskContribution[] | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!Array.isArray(value)) {
    throw new Error("risk_contributions debe ser un array o null");
  }
  return value.map((raw, index) => {
    if (!isObject(raw)) {
      throw new Error(`risk_contributions[${index}] inválido`);
    }
    return {
      asset_id: requireString(raw.asset_id, `risk_contributions[${index}].asset_id`),
      weight_pct: requireNumber(raw.weight_pct, `risk_contributions[${index}].weight_pct`),
      risk_pct: requireNumber(raw.risk_pct, `risk_contributions[${index}].risk_pct`)
    };
  });
}

function parseRiskContributionsMeta(value: unknown): PortfolioRiskContributionMeta | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error("risk_contributions_meta inválido");
  }
  const covModel = value.cov_model;
  if (covModel !== "LEDOIT_WOLF" && covModel !== "OAS" && covModel !== "SAMPLE") {
    throw new Error(`risk_contributions_meta.cov_model inválido: ${String(covModel)}`);
  }
  const reason = value.reason;
  if (reason !== undefined && reason !== "ZERO_VOLATILITY") {
    throw new Error(`risk_contributions_meta.reason inválido: ${String(reason)}`);
  }
  return { cov_model: covModel, reason };
}

/**
 * La aportación al riesgo con el mismo contrato que dentro de la frontera. La simulación la manda fuera de `frontier`
 * cuando la cartera pasa de 40 activos medidos y no hay frontera (portfolio_horizon.py, 10-11-2026).
 */
export function parseRiskContributionBlock(items: unknown, meta: unknown): {
  riskContributions: PortfolioRiskContribution[] | null | undefined;
  riskContributionsMeta: PortfolioRiskContributionMeta | undefined;
} {
  const riskContributions = parseRiskContributions(items);
  const riskContributionsMeta = parseRiskContributionsMeta(meta);
  validateRiskContributionContract(riskContributions, riskContributionsMeta);
  return { riskContributions, riskContributionsMeta };
}

function validateRiskContributionContract(
  items: PortfolioRiskContribution[] | null | undefined,
  meta: PortfolioRiskContributionMeta | undefined
): void {
  if (items === undefined && meta === undefined) {
    return; // Compatibilidad durante un rollout aditivo.
  }
  if (!meta) {
    throw new Error("risk_contributions_meta es obligatorio cuando hay atribución de riesgo");
  }
  if (items === null) {
    if (meta.reason !== "ZERO_VOLATILITY") {
      throw new Error("risk_contributions null requiere reason ZERO_VOLATILITY");
    }
    return;
  }
  if (!items || items.length === 0 || meta.reason !== undefined) {
    throw new Error("risk_contributions calculado requiere filas y no admite reason");
  }
  const weightTotal = items.reduce((sum, item) => sum + item.weight_pct, 0);
  const signedRiskTotal = items.reduce((sum, item) => sum + item.risk_pct, 0);
  if (Math.abs(weightTotal - 100) > 0.02) {
    throw new Error(`risk_contributions.weight_pct no suma 100: ${weightTotal}`);
  }
  if (Math.abs(signedRiskTotal - 100) > 1e-6) {
    throw new Error(`risk_contributions.risk_pct firmado no suma 100: ${signedRiskTotal}`);
  }
}

/**
 * Valida y normaliza una respuesta cruda de la callable contra portfolio-frontier.v1.
 * Lanza Error si el discriminante o algún campo obligatorio no cumple.
 */
export function parsePortfolioFrontierResponse(raw: unknown): PortfolioFrontierResponse {
  if (!isObject(raw)) {
    throw new Error("Respuesta vacía o con formato no esperado.");
  }
  if (raw.schema_version !== "portfolio-frontier.v1") {
    throw new Error(`schema_version inesperado: ${String(raw.schema_version)}`);
  }
  if (raw.units !== "decimal") {
    throw new Error(`units inesperado (se espera "decimal"): ${String(raw.units)}`);
  }
  if (raw.base_currency !== "EUR") {
    throw new Error(`base_currency inesperado: ${String(raw.base_currency)}`);
  }

  const methodology = raw.methodology;
  if (!isObject(methodology)) {
    throw new Error("methodology ausente.");
  }
  const window = methodology.window;
  if (typeof window !== "string" || !WINDOWS.includes(window as FrontierWindow)) {
    throw new Error(`methodology.window inválido: ${String(window)}`);
  }
  const frequency = requireLiteral(methodology.frequency, "WEEKLY", "methodology.frequency");
  const annualizationFactor = requireLiteral(methodology.annualization_factor, 52, "methodology.annualization_factor");
  const alignmentPolicy = requireLiteral(methodology.alignment_policy, "COMMON_WEEKLY_DATES", "methodology.alignment_policy");
  const riskFreeSource = requireLiteral(methodology.risk_free_source, "ECB_ESTR", "methodology.risk_free_source");
  const riskFreeRatePolicy = methodology.risk_free_rate_policy;
  if (riskFreeRatePolicy !== "WINDOW_AVERAGE" && riskFreeRatePolicy !== "STATIC_FALLBACK") {
    throw new Error(`methodology.risk_free_rate_policy inesperado: ${String(riskFreeRatePolicy)}`);
  }

  const parsedMethodology: PortfolioFrontierResponse["methodology"] = {
    window: window as FrontierWindow,
    frequency,
    annualization_factor: annualizationFactor,
    alignment_policy: alignmentPolicy,
    risk_free_source: riskFreeSource,
    risk_free_rate: requireNumber(methodology.risk_free_rate, "methodology.risk_free_rate"),
    risk_free_rate_policy: riskFreeRatePolicy
  };

  parsedMethodology.optimizer = optionalString(methodology.optimizer, "methodology.optimizer");
  parsedMethodology.covariance_estimator = optionalString(methodology.covariance_estimator, "methodology.covariance_estimator");
  parsedMethodology.expected_return_model = optionalString(methodology.expected_return_model, "methodology.expected_return_model");
  parsedMethodology.return_estimator = optionalString(methodology.return_estimator, "methodology.return_estimator");
  parsedMethodology.return_units = optionalString(methodology.return_units, "methodology.return_units");
  parsedMethodology.risk_free_first_date = optionalString(methodology.risk_free_first_date, "methodology.risk_free_first_date");
  parsedMethodology.risk_free_last_date = optionalString(methodology.risk_free_last_date, "methodology.risk_free_last_date");
  parsedMethodology.risk_free_observations = optionalNumber(methodology.risk_free_observations, "methodology.risk_free_observations");
  parsedMethodology.risk_free_coverage_ratio = optionalNumber(methodology.risk_free_coverage_ratio, "methodology.risk_free_coverage_ratio");
  if (methodology.weight_bounds !== undefined) {
    if (!Array.isArray(methodology.weight_bounds) || methodology.weight_bounds.length !== 2) {
      throw new Error("methodology.weight_bounds inválido");
    }
    parsedMethodology.weight_bounds = [
      requireNumber(methodology.weight_bounds[0], "methodology.weight_bounds[0]"),
      requireNumber(methodology.weight_bounds[1], "methodology.weight_bounds[1]")
    ];
  }
  if (methodology.objective !== undefined) {
    const objective = methodology.objective;
    if (typeof objective !== "string" || !OBJECTIVES.includes(objective as FrontierObjective)) {
      throw new Error(`methodology.objective inválido: ${String(objective)}`);
    }
    parsedMethodology.objective = objective as FrontierObjective;
  }
  if (methodology.target_risk_mode !== undefined) {
    if (methodology.target_risk_mode !== "FRONTIER_PERCENTILE" && methodology.target_risk_mode !== "ABSOLUTE_VOL") {
      throw new Error(`methodology.target_risk_mode inválido: ${String(methodology.target_risk_mode)}`);
    }
    parsedMethodology.target_risk_mode = methodology.target_risk_mode;
  }
  parsedMethodology.risk_slider_value = optionalNumber(methodology.risk_slider_value, "methodology.risk_slider_value");
  parsedMethodology.frontier_percentile = optionalNumber(methodology.frontier_percentile, "methodology.frontier_percentile");
  parsedMethodology.target_volatility = optionalNumber(methodology.target_volatility, "methodology.target_volatility");
  parsedMethodology.achieved_volatility = optionalNumber(methodology.achieved_volatility, "methodology.achieved_volatility");
  if (typeof methodology.max_turnover === "number" && Number.isFinite(methodology.max_turnover)) {
    parsedMethodology.max_turnover = methodology.max_turnover;
  }
  parsedMethodology.target_return = optionalNumber(methodology.target_return, "methodology.target_return");
  parsedMethodology.target_return_floor = optionalNumber(methodology.target_return_floor, "methodology.target_return_floor");

  const coverage = raw.coverage;
  if (!isObject(coverage)) {
    throw new Error("coverage ausente.");
  }

  const frontierRaw = raw.frontier;
  if (!Array.isArray(frontierRaw)) {
    throw new Error("frontier debe ser un array.");
  }

  const excludedRaw = Array.isArray(raw.excluded_assets) ? raw.excluded_assets : [];
  const warningsRaw = Array.isArray(raw.warnings) ? raw.warnings : [];
  const parsedRiskContributions = parseRiskContributions(raw.risk_contributions);
  const parsedRiskContributionsMeta = parseRiskContributionsMeta(raw.risk_contributions_meta);
  validateRiskContributionContract(parsedRiskContributions, parsedRiskContributionsMeta);

  return {
    schema_version: "portfolio-frontier.v1",
    as_of_date: requireString(raw.as_of_date, "as_of_date"),
    units: "decimal",
    base_currency: "EUR",
    methodology: parsedMethodology,
    coverage: {
      requested_assets: requireNumber(coverage.requested_assets, "coverage.requested_assets"),
      included_assets: requireNumber(coverage.included_assets, "coverage.included_assets"),
      common_observations: requireNumber(coverage.common_observations, "coverage.common_observations"),
      first_date: requireString(coverage.first_date, "coverage.first_date"),
      last_date: requireString(coverage.last_date, "coverage.last_date")
    },
    current_portfolio: raw.current_portfolio === undefined
      ? undefined
      : parsePoint(raw.current_portfolio, "current_portfolio"),
    min_volatility_portfolio: parsePoint(raw.min_volatility_portfolio, "min_volatility_portfolio"),
    max_sharpe_portfolio: parsePoint(raw.max_sharpe_portfolio, "max_sharpe_portfolio"),
    target_return_portfolio: raw.target_return_portfolio === undefined || raw.target_return_portfolio === null
      ? undefined
      : parsePoint(raw.target_return_portfolio, "target_return_portfolio"),
    target_portfolio: raw.target_portfolio === undefined || raw.target_portfolio === null
      ? undefined
      : parsePoint(raw.target_portfolio, "target_portfolio"),
    risk_contributions: parsedRiskContributions,
    risk_contributions_meta: parsedRiskContributionsMeta,
    frontier: frontierRaw.map((point, i) => parsePoint(point, `frontier[${i}]`)),
    excluded_assets: excludedRaw.map((item, i) => parseExcluded(item, `excluded_assets[${i}]`)),
    warnings: warningsRaw.filter((item): item is string => typeof item === "string"),
    extensions: parseExtensions(raw.extensions),
    target_return_measured: parseTargetReturnMeasured(raw.target_return_measured),
    asset_limit: parseAssetLimit(raw.asset_limit)
  };
}

/* --------------------------- view model -------------------------- */

function buildPointView(point: PortfolioFrontierPoint): FrontierPointView {
  const weights = Object.entries(point.weights)
    .filter(([, weight]) => weight >= 0.0005)
    .sort((a, b) => b[1] - a[1])
    .map(([assetId, weight]) => ({
      assetId,
      weight,
      weightLabel: oFalta(peso(weight))
    }));

  return {
    expectedReturn: point.expected_return,
    volatility: point.volatility,
    sharpeRatio: point.sharpe_ratio,
    /* Qué es cada cifra decide cómo se escribe: la rentabilidad, con signo; la volatilidad, sin él; el Sharpe, un ratio. */
    expectedReturnLabel: oFalta(rentabilidad(point.expected_return)),
    volatilityLabel: oFalta(porcentaje(point.volatility)),
    sharpeLabel: oFalta(ratio(point.sharpe_ratio)),
    weights,
    pesosCompletos: { ...point.weights }
  };
}

/** Convierte la respuesta validada en el view model de UI (sin series crudas). */
export function buildFrontierViewModel(response: PortfolioFrontierResponse): FrontierViewModel {
  return {
    kind: "historical",
    label: HISTORICAL_FRONTIER_LABEL,
    asOfDate: response.as_of_date,
    window: response.methodology.window,
    riskFreeRateLabel: oFalta(porcentaje(response.methodology.risk_free_rate)),
    riskFreeSource: response.methodology.risk_free_source,
    riskFreeRatePolicy: response.methodology.risk_free_rate_policy,
    coverage: {
      requested: response.coverage.requested_assets,
      included: response.coverage.included_assets,
      commonObservations: response.coverage.common_observations,
      firstDate: response.coverage.first_date,
      lastDate: response.coverage.last_date
    },
    insufficientCoverage: response.coverage.included_assets < 2,
    current: response.current_portfolio ? buildPointView(response.current_portfolio) : undefined,
    minVolatility: buildPointView(response.min_volatility_portfolio),
    maxSharpe: buildPointView(response.max_sharpe_portfolio),
    targetReturn: response.target_return_portfolio
      ? buildPointView(response.target_return_portfolio)
      : undefined,
    frontier: response.frontier.map((point) => ({
      expectedReturn: point.expected_return,
      volatility: point.volatility,
      sharpeRatio: point.sharpe_ratio
    })),
    excluded: response.excluded_assets.map((item) => ({
      assetId: item.asset_id,
      reason: item.reason,
      reasonLabel: reasonLabel(item.reason)
    })),
    warnings: response.warnings,
    target: response.target_portfolio ? buildPointView(response.target_portfolio) : undefined,
    riskContributions: response.risk_contributions,
    riskContributionsMeta: response.risk_contributions_meta,
    extensions: response.extensions?.map((item) => ({
      assetId: item.asset_id,
      reference: item.reference,
      estimatedFrom: item.estimated_from,
      estimatedUntil: item.estimated_until
    })),
    medidaDelObjetivo: response.target_return_measured
      ? { propuesta: response.target_return_measured.portfolio, actual: response.target_return_measured.current }
      : undefined,
    limiteDeActivos: response.asset_limit
      ? { semanas: response.asset_limit.weekly_returns, maximo: response.asset_limit.max_assets }
      : undefined,
    methodologyV2: {
      optimizer: response.methodology.optimizer,
      objective: response.methodology.objective,
      covarianceEstimator: response.methodology.covariance_estimator,
      expectedReturnModel: response.methodology.expected_return_model,
      targetRiskMode: response.methodology.target_risk_mode,
      riskSliderValue: response.methodology.risk_slider_value,
      frontierPercentile: response.methodology.frontier_percentile,
      targetVolatility: response.methodology.target_volatility,
      achievedVolatility: response.methodology.achieved_volatility,
      weightBounds: response.methodology.weight_bounds,
      targetReturn: response.methodology.target_return,
      targetReturnFloor: response.methodology.target_return_floor,
      maxTurnover: response.methodology.max_turnover
    }
  };
}

/* ----------------------------- estados --------------------------- */

/** Respuesta cruda OK -> estado "result"; si no valida -> estado "error". */
export function frontierStateFromRawResponse(raw: unknown): FrontierHistoricalState {
  try {
    return { status: "result", model: buildFrontierViewModel(parsePortfolioFrontierResponse(raw)) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Respuesta de frontera no válida."
    };
  }
}

/** Error de la futura callable -> estado UI (UNAUTHENTICATED se distingue del resto). */
export function frontierStateFromError(error: unknown): FrontierHistoricalState {
  if (error instanceof AppError && error.kind === "AUTH") {
    return { status: "unauthenticated" };
  }
  // Acepta "UNAUTHENTICATED", "unauthenticated" y el formato de Firebase "functions/unauthenticated".
  const code = isObject(error) && typeof error.code === "string" ? error.code.toLowerCase() : "";
  if (code.includes("unauthenticated")) {
    return { status: "unauthenticated" };
  }
  /* Decisión 40: si ninguna cartera cumple lo pedido, se dice, con sus cifras. `toAppError` deja ese texto en `detail` y pone
     en su lugar «La petición contiene un dato no válido», que no es lo que ha pasado. El SDK le añade el estado HTTP al final: « [400]». */
  if (error instanceof AppError) {
    const sinSolucion = [error.message, error.detail].find((texto) => texto?.startsWith(PREFIJO_SIN_SOLUCION));
    if (sinSolucion) return { status: "error", message: sinEstadoHttp(sinSolucion) };
  }
  /* Hallazgo 12: el periodo tiene pocos datos para tantos activos. Se enseña el texto del servidor, que dice las cifras y qué
     hacer, y se marca para que la pantalla ofrezca pasar a 3 años. Llega igual del SDK que ya traducido por `toAppError`. */
  const limite = limiteDelCalculo(error)?.replace(/\s*\[\d{3}\]\s*$/, "");
  const delPeriodo = limite ? LIMITE_DEL_PERIODO.exec(limite) : null;
  if (limite && delPeriodo) {
    return { status: "error", message: limite, limiteDelPeriodo: { maximo: Number(delPeriodo[1]), activos: Number(delPeriodo[2]) } };
  }
  /* 15-11-2026. Un `failed-precondition` con texto propio es el servidor diciendo por qué no puede (optimizador sin solución,
     generador sin base nueva…): ese texto es el principal, y la pantalla no lo repite como «Detalle técnico». */
  if (esFaltaDeDatos(error)) {
    const propio = error instanceof AppError ? error : toAppError(error);
    if (propio.message !== MENSAJE_GENERICO_PRECONDICION) return { status: "error", message: sinEstadoHttp(propio.message), textoDelServidor: true };
  }
  const message = isObject(error) && typeof error.message === "string"
    ? error.message
    : "No se pudo calcular la frontera histórica.";
  return { status: "error", message };
}

/* ----------------------------- request --------------------------- */

export interface FrontierRequestInput {
  /** Local provenance, never sent to the callable. Weights before selection/normalization. */
  portfolioWeightsPercent?: Record<string, number>;
  selectionExclusions?: Array<{ assetId: string; reasonLabel: string }>;
  assetIds: string[];
  currentWeights?: Record<string, number>; // decimales
  window?: FrontierWindow;
  objective?: FrontierObjective;
  targetReturn?: number; // decimal
  minWeight?: number; // decimal
  maxWeight?: number; // decimal
  /** M2: rotación máxima Σ|w − w₀| (decimal 0..2) respecto a currentWeights; solo motor v2. */
  maxTurnover?: number;
  lockedWeights?: Record<string, number>; // decimales por activo fijado
  frontierPoints?: number;
  /** v2 (opcional). */
  riskSlider?: number;
  riskTargetMode?: "FRONTIER_PERCENTILE" | "ABSOLUTE_VOL";
  targetVolatility?: number;
  expectedReturnModel?: "HISTORICAL_SHRINKAGE" | "RISK_ONLY" | "EQUAL_RETURN";
}

/**
 * Construye el request del contrato. NO incluye series crudas: solo identificadores,
 * pesos (decimales) y parámetros de optimización.
 */
export function buildOptimizationRequest(input: FrontierRequestInput): PortfolioOptimizationRequest {
  const constraints: NonNullable<PortfolioOptimizationRequest["constraints"]> = {
    long_only: true,
    fully_invested: true
  };
  if (isFiniteNumber(input.minWeight)) {
    constraints.min_weight = input.minWeight;
  }
  if (isFiniteNumber(input.maxWeight)) {
    constraints.max_weight = input.maxWeight;
  }
  if (isFiniteNumber(input.maxTurnover) && input.maxTurnover > 0 && input.currentWeights && Object.keys(input.currentWeights).length > 0) {
    constraints.max_turnover = input.maxTurnover;
  }

  const request: PortfolioOptimizationRequest = {
    schema_version: "portfolio-optimization-request.v1",
    asset_ids: [...input.assetIds],
    window: input.window ?? "3Y",
    base_currency: "EUR",
    frequency: "WEEKLY",
    objective: input.objective ?? "TARGET_RISK",
    constraints
  };

  if (input.currentWeights && Object.keys(input.currentWeights).length > 0) {
    request.current_weights = { ...input.currentWeights };
  }
  if (input.lockedWeights && Object.keys(input.lockedWeights).length > 0) {
    request.locked_weights = { ...input.lockedWeights };
  }
  if (request.objective === "TARGET_RETURN" && isFiniteNumber(input.targetReturn)) {
    request.target_return = input.targetReturn;
  }
  if (isFiniteNumber(input.frontierPoints)) {
    request.frontier_points = input.frontierPoints;
  }
  if (isFiniteNumber(input.riskSlider)) {
    request.risk_slider = input.riskSlider;
  }
  if (input.riskTargetMode) {
    request.risk_target_mode = input.riskTargetMode;
  }
  if (input.expectedReturnModel) {
    request.expected_return_model = input.expectedReturnModel;
  }
  if (request.objective === "TARGET_RISK" && isFiniteNumber(input.targetVolatility)) {
    request.target_volatility = input.targetVolatility;
  }

  return request;
}
