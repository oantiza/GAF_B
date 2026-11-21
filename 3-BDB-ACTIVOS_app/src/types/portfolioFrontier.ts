/**
 * Contrato CONGELADO de la futura callable `optimize_portfolio`.
 * Request:  portfolio-optimization-request.v1
 * Response: portfolio-frontier.v1
 *
 * Todas las tasas son DECIMALES (0.10 = 10 %, 0.0193 = 1,93 %).
 * Este archivo NO implementa ninguna llamada remota ni cálculo de frontera.
 */

export type FrontierWindow = "1Y" | "3Y" | "5Y" | "10Y";
export type FrontierObjective = "MAX_SHARPE" | "MIN_VOLATILITY" | "TARGET_RETURN" | "TARGET_RISK";

export type FrontierExclusionReason =
  | "PRICE_SERIES_MISSING"
  | "INSUFFICIENT_HISTORY"
  /** Su historia se iba a completar con su referencia y el enlace no se pudo hacer (hallazgo 15, 15-11-2026). */
  | "REFERENCE_LINK_FAILED"
  /** Su serie acaba antes del final del periodo, que desde la decisión A-161 es el dato más reciente (16-11-2026). */
  | "SERIES_ENDS_EARLY"
  | "FX_SERIES_MISSING"
  | "FX_QUARANTINE"
  | "NON_INVESTABLE"
  | "QUALITY_BLOCKED"
  | "DISTRIBUTES_WITHOUT_PAYMENTS";

export interface PortfolioOptimizationRequest {
  schema_version: "portfolio-optimization-request.v1";
  asset_ids: string[];
  current_weights?: Record<string, number>;
  locked_weights?: Record<string, number>;
  window: FrontierWindow;
  base_currency: "EUR";
  frequency?: "WEEKLY";
  objective: FrontierObjective;
  target_return?: number;
  /** v2 (Robust Frontier Engine, aditivos, opcionales). */
  risk_slider?: number;
  risk_target_mode?: "FRONTIER_PERCENTILE" | "ABSOLUTE_VOL";
  target_volatility?: number;
  expected_return_model?: "HISTORICAL_SHRINKAGE" | "RISK_ONLY" | "EQUAL_RETURN";
  constraints?: {
    long_only?: true;
    fully_invested?: true;
    min_weight?: number;
    max_weight?: number;
    /** M2 «Mejorar cartera»: rotación máxima Σ|w − w₀| respecto a current_weights (0..2). */
    max_turnover?: number;
  };
  frontier_points?: number;
}

export interface PortfolioFrontierPoint {
  expected_return: number;
  volatility: number;
  /** `null` con volatilidad cero: el Sharpe no existe (hallazgo 11, 15-11-2026). */
  sharpe_ratio: number | null;
  weights: Record<string, number>;
}

export interface PortfolioFrontierMethodology {
  window: FrontierWindow;
  frequency: "WEEKLY";
  annualization_factor: 52;
  alignment_policy: "COMMON_WEEKLY_DATES";
  risk_free_source: "ECB_ESTR";
  risk_free_rate: number;
  risk_free_rate_policy: "WINDOW_AVERAGE" | "STATIC_FALLBACK";
  risk_free_first_date?: string;
  risk_free_last_date?: string;
  risk_free_observations?: number;
  risk_free_coverage_ratio?: number;
  /** v2 aditivos (opcionales). */
  optimizer?: string;
  covariance_estimator?: string;
  expected_return_model?: string;
  return_estimator?: string;
  return_units?: string;
  weight_bounds?: [number, number];
  objective?: FrontierObjective;
  target_risk_mode?: "FRONTIER_PERCENTILE" | "ABSOLUTE_VOL";
  risk_slider_value?: number;
  frontier_percentile?: number;
  target_volatility?: number;
  achieved_volatility?: number;
  max_turnover?: number;
  /** Lo que se ha pedido con «Rentabilidad objetivo», en decimal: la media de la serie (decisión 94). Solo con ese objetivo. */
  target_return?: number;
  /** La media de la serie de la cartera de menor riesgo. Por debajo, la propuesta es esa. Solo con ese objetivo. */
  target_return_floor?: number;
}

export interface PortfolioFrontierCoverage {
  requested_assets: number;
  included_assets: number;
  common_observations: number;
  first_date: string;
  last_date: string;
}

export interface PortfolioFrontierExcludedAsset {
  asset_id: string;
  reason: FrontierExclusionReason;
}

export type RiskContributionCovModel = "LEDOIT_WOLF" | "OAS" | "SAMPLE";

export interface PortfolioRiskContribution {
  asset_id: string;
  weight_pct: number;
  /** Contribución firmada, normalizada para que el total sea 100 %. */
  risk_pct: number;
}

export interface PortfolioRiskContributionMeta {
  cov_model: RiskContributionCovModel;
  reason?: "ZERO_VOLATILITY";
}

/** Un tramo estimado con una referencia validada: entra en el cálculo, igual que en la simulación, y se dice cuál es. */
export interface PortfolioFrontierExtension {
  asset_id: string;
  reference: string;
  estimated_from: string;
  estimated_until: string;
}

/** Lo que mide la serie de una cartera: la misma cuenta que la Comparativa de Simular, con los pesos fijos desde el primer día. */
export interface PortfolioFrontierMeasure {
  cagr: number;
  volatility: number;
  sharpe: number;
  max_drawdown: number;
}

/** Aditivo (decisión 61): solo con «Rentabilidad objetivo». `null` en una cartera es que no se ha podido medir o que no hay cartera actual. */
export interface PortfolioFrontierTargetReturnMeasured {
  portfolio: PortfolioFrontierMeasure | null;
  current: PortfolioFrontierMeasure | null;
}

export interface PortfolioFrontierResponse {
  schema_version: "portfolio-frontier.v1";
  as_of_date: string;
  units: "decimal";
  base_currency: "EUR";
  methodology: PortfolioFrontierMethodology;
  coverage: PortfolioFrontierCoverage;
  current_portfolio?: PortfolioFrontierPoint;
  min_volatility_portfolio: PortfolioFrontierPoint;
  max_sharpe_portfolio: PortfolioFrontierPoint;
  target_return_portfolio?: PortfolioFrontierPoint;
  /** v2 aditivos (opcionales). */
  target_portfolio?: PortfolioFrontierPoint;
  /** Aditivo F5a. `null` significa que la volatilidad de cartera es degenerada. */
  risk_contributions?: PortfolioRiskContribution[] | null;
  risk_contributions_meta?: PortfolioRiskContributionMeta;
  frontier: PortfolioFrontierPoint[];
  excluded_assets: PortfolioFrontierExcludedAsset[];
  warnings: string[];
  /** Aditivo (decisión 40): solo lo trae lo que resuelve el motor regularizado. */
  extensions?: PortfolioFrontierExtension[];
  target_return_measured?: PortfolioFrontierTargetReturnMeasured;
  /** Aditivo (hallazgo 12, 15-11-2026): los retornos semanales de la ventana y cuántos activos admitía. Un servidor anterior no lo trae. */
  asset_limit?: PortfolioFrontierAssetLimit;
}

/** Cuántos activos caben en la frontera de una ventana: la proporción entre datos y activos aceptada a 3 años. */
export interface PortfolioFrontierAssetLimit {
  window: string;
  weekly_returns: number;
  max_assets: number;
  reference_window: string;
  reference_weekly_returns: number;
  reference_max_assets: number;
}

/* ------------------------------------------------------------------ *
 * View model de UI (derivado del contrato; SIN series crudas).
 * ------------------------------------------------------------------ */

export interface FrontierWeightView {
  assetId: string;
  weight: number; // decimal interno
  weightLabel: string; // "40,0 %"
}

export interface FrontierPointView {
  expectedReturn: number; // decimal interno
  volatility: number; // decimal interno
  sharpeRatio: number | null; // decimal interno; null con volatilidad cero
  expectedReturnLabel: string; // "8,20 %"
  volatilityLabel: string; // "12,00 %"
  sharpeLabel: string; // "0,55"
  /** Los que se pintan: sin los que no llegan a una décima de punto. */
  weights: FrontierWeightView[];
  /** Todos los que manda el servidor, ceros incluidos: una propuesta se aplica con estos. */
  pesosCompletos?: Record<string, number>;
}

export interface FrontierCurveView {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number | null;
}

export interface FrontierExcludedView {
  assetId: string;
  reason: FrontierExclusionReason;
  reasonLabel: string;
}

/**
 * Por qué un activo que sí se mide no entra en la frontera de Simular (decisión de Óscar, 15-11-2026): la frontera y sus
 * carteras solo usan lo que se puede comprar. Un motivo que este sitio no conozca se lee como «no se puede comprar».
 */
export type FrontierNotSelectableReason = "FROZEN_PRICE" | "CORPORATE_ACTION" | "SELECTION_BLOCKED" | "OTHER";

/** Un activo medido en la cartera y apartado de la frontera. No es un `FrontierExcludedView`: aquel no se ha podido medir. */
export interface FrontierNotSelectableView {
  assetId: string;
  reason: FrontierNotSelectableReason;
  reasonLabel: string;
  /** Su peso en la cartera medida, en decimal: la misma base que los pesos del punto de la cartera. */
  weight: number;
}

export interface FrontierMethodologyV2 {
  optimizer?: string;
  covarianceEstimator?: string;
  expectedReturnModel?: string;
  targetRiskMode?: string;
  riskSliderValue?: number;
  frontierPercentile?: number;
  targetVolatility?: number;
  achievedVolatility?: number;
  /** Peso mínimo y máximo por activo que se han aplicado. Depende del número de activos si nadie los fija. */
  weightBounds?: [number, number];
  /** Lo que se ha pedido con «Rentabilidad objetivo», en decimal: el que devuelve el servidor, no el que haya ahora en el campo. */
  targetReturn?: number;
  /** La media de la serie de la cartera de menor riesgo: por debajo, la propuesta es esa. */
  targetReturnFloor?: number;
  /** La rotación máxima con la que se calculó, como Σ|w − w₀| (0..2): la que devuelve el servidor. Falta si no se pidió. */
  maxTurnover?: number;
}

export interface FrontierExtensionView {
  assetId: string;
  reference: string;
  estimatedFrom: string;
  estimatedUntil: string;
}

export interface FrontierViewModel {
  requestFingerprint?: string;
  requestInput?: import("../adapters/portfolioFrontierAdapter").FrontierRequestInput;
  sessionEpoch?: number;
  portfolioCoverage?: {
    requested: number;
    included: number;
    weightPercent: number;
    excluded: Array<{ assetId: string; weightPercent: number; reasonLabel: string }>;
  };
  kind: "historical";
  label: string; // HISTORICAL_FRONTIER_LABEL
  asOfDate: string;
  window: FrontierWindow;
  riskFreeRateLabel: string; // "1,93 %"
  riskFreeSource: "ECB_ESTR";
  riskFreeRatePolicy: "WINDOW_AVERAGE" | "STATIC_FALLBACK";
  coverage: {
    requested: number;
    included: number;
    commonObservations: number;
    firstDate: string;
    lastDate: string;
  };
  insufficientCoverage: boolean;
  current?: FrontierPointView;
  minVolatility: FrontierPointView;
  maxSharpe: FrontierPointView;
  targetReturn?: FrontierPointView;
  frontier: FrontierCurveView[];
  excluded: FrontierExcludedView[];
  warnings: string[];
  /** v2 (opcional). */
  target?: FrontierPointView;
  methodologyV2?: FrontierMethodologyV2;
  riskContributions?: PortfolioRiskContribution[] | null;
  riskContributionsMeta?: PortfolioRiskContributionMeta;
  /** Tramos estimados que han entrado en el cálculo. */
  extensions?: FrontierExtensionView[];
  /** Con «Rentabilidad objetivo»: lo que mide la serie, la propuesta y la cartera actual. Si una no se ha medido, `null`. */
  medidaDelObjetivo?: { propuesta: PortfolioFrontierMeasure | null; actual: PortfolioFrontierMeasure | null };
  /** Hallazgo 12: semanas de datos de la ventana y máximo de activos que admitía. Falta con un servidor anterior. */
  limiteDeActivos?: { semanas: number; maximo: number };
}

/** Estados de UI para el panel histórico (la callable se cableará en O1). */
export type FrontierHistoricalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string; limiteDelPeriodo?: LimiteDelPeriodo; textoDelServidor?: true }
  | { status: "result"; model: FrontierViewModel };

/** Hallazgo 12: el periodo tiene pocos datos para tantos activos. Lo dice el servidor, con sus cifras. */
export interface LimiteDelPeriodo {
  maximo: number;
  activos: number;
}

/**
 * Así empieza el texto del servidor cuando los activos que entran en la frontera pasan de los que admite el periodo
 * (`_mensaje_de_pocos_datos_por_activo`, optimization/repository.py). Empieza como todo límite del cálculo (appError.ts).
 */
export const LIMITE_DEL_PERIODO = /^El cálculo admite (\d+) activos como máximo y esta cartera tiene (\d+) con el periodo de /;

/** Con esto empieza lo que dice el servidor cuando ninguna cartera cumple lo pedido: lleva sus cifras y se enseña tal cual. */
export const PREFIJO_SIN_SOLUCION = "Sin solución:";

export const HISTORICAL_FRONTIER_LABEL = "Frontera histórica";
export const APPROXIMATE_FRONTIER_LABEL = "Estimación aproximada";
