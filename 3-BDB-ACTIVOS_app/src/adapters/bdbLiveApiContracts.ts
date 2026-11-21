import { AppError, type ParteSinLeer } from "../core/appError";
import type {
  AlcanceDeLasPosiciones,
  BdbAssetDataQualitySummary,
  BdbAssetDetail,
  BdbAssetPerformancePreview,
  BdbFixedIncomeProfile,
  BdbFundamentalsSummary,
  ContextoDeLasMetricas
} from "../types/bdbAssets";
import {
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
  type GuardObject
} from "./contractGuards";

export interface RawMetrics extends ContextoDeLasMetricas {
  risk_score?: number;
  risk_score_source?: string;
  metrics_source?: string;
  /** metrics.v1.2: con que metodologia y frecuencia se midio el activo. */
  metrics_method?: string;
  metrics_frequency?: string;
  /** Solo si el activo mezcla cifras nuestras y del proveedor (decisión 110). */
  metrics_by_window?: Record<string, { method?: string; frequency?: string }>;
  ytd_return?: number;
  volatility_3y?: number;
  volatility_1y?: number;
  volatility_5y?: number;
  volatility_10y?: number;
  annualized_return_1y?: number;
  annualized_return_3y?: number;
  annualized_return_5y?: number;
  annualized_return_10y?: number;
  sharpe_1y?: number;
  sharpe_3y?: number;
  sharpe_5y?: number;
  sharpe_10y?: number;
  max_drawdown_5y?: number;
  max_drawdown_hist?: number | { value?: number; date?: string };
  max_drawdown_hist_date?: string;
}

export interface RawPmsExposure {
  equity?: number;
  fixed_income?: number;
  cash?: number;
  alternative?: number;
  other?: number;
  real_asset?: number;
  source?: string;
}

export interface RawIdentity {
  display_name?: string;
  isin?: string;
  ticker?: string;
  currency?: string;
  region?: string;
  benchmark?: unknown;
}

export interface RawCosts {
  ongoing_charge?: number;
  management_fee?: number;
  transaction_costs?: number;
  entry_charge?: number;
  document_url?: string;
  document_date?: string;
  ongoing_charge_source?: string;
  transaction_costs_source?: string;
  entry_charge_source?: string;
}

export interface RawProduct {
  provider?: string;
  product_type?: string;
  domicile?: string;
  share_class?: string;
  distribution_policy?: string;
  inception_date?: string;
  ucits?: boolean | string;
  replication?: string;
  legal_structure?: string;
  benchmark?: unknown;
  official_benchmark?: unknown;
  reference_index?: unknown;
}

export interface RawFundProfile {
  product_type?: string;
  domicile?: string;
  share_class?: string;
  distribution_policy?: string;
  inception_date?: string;
  ucits?: boolean | string;
  replication?: string;
  legal_structure?: string;
  benchmark?: unknown;
}

export interface RawSustainability {
  sfdr?: string;
  esg_rating?: string | number;
  sustainability_rating?: string | number;
}

export interface RawClassification {
  category?: string;
  region?: string;
  region_primary?: string;
  sector?: string;
  gics_sector?: string;
  industry?: string;
  strategy?: string;
  morningstar_rating?: number;
  benchmark?: unknown;
  official_benchmark?: unknown;
  reference_index?: unknown;
}

export interface RawPerformancePreview extends Omit<BdbAssetPerformancePreview, "max_drawdown_hist"> {
  max_drawdown_hist?: number | { value?: number; date?: string };
  max_drawdown_hist_date?: string;
}

export interface RawAssetDetail {
  asset_id: string;
  updated_at?: string;
  identity?: RawIdentity;
  instrument_type: string;
  economic_asset_class?: string;
  coverage_status?: string;
  is_investable?: boolean;
  role?: string;
  quality_flags?: string[];
  metrics?: RawMetrics | null;
  performance_preview?: RawPerformancePreview | null;
  benchmark?: unknown;
  official_benchmark?: unknown;
  reference_index?: unknown;
  index_id?: unknown;
  costs?: RawCosts | null;
  product?: RawProduct | null;
  profile?: RawFundProfile | null;
  fund_profile?: RawFundProfile | null;
  sustainability?: RawSustainability | null;
  classification?: RawClassification | null;
  category?: string;
  pms_exposure?: RawPmsExposure | null;
  holdings_summary?: BdbAssetDetail["holdings_summary"];
  exposure_detail?: {
    sectors?: Record<string, number>;
    equity_styles?: Record<string, number>;
    equity_regions?: Record<string, number>;
    market_caps?: Record<string, number>;
    equity_style_box?: Record<string, number>;
    confidence?: number;
  } | null;
  fixed_income_profile?: BdbFixedIncomeProfile | null;
  available_sections?: string[];
  data_quality_summary?: BdbAssetDataQualitySummary | string | null;
  fundamentals_summary?: BdbFundamentalsSummary | null;
}

export interface RawSearchItem {
  asset_id: string;
  display_name?: string;
  instrument_type: string;
  economic_asset_class?: string;
  isin?: string;
  ticker?: string;
  provider?: string;
  product?: RawProduct | null;
  currency?: string;
  region?: string;
  category?: string;
  sector?: string;
  strategy?: string;
  coverage_status?: string;
  is_investable?: boolean;
  role?: string;
  quality_flags?: string[];
  metrics?: RawMetrics | null;
  morningstar_rating?: number;
  benchmark?: unknown;
  official_benchmark?: unknown;
  reference_index?: unknown;
  index_id?: unknown;
}

export interface RawResolvedPortfolioRow {
  is_investable?: boolean;
  role?: string;
  asset_id: string;
  /** 01-10-2026: id pedido cuando el backend resolvió un alias (ISIN sustituido) al sucesor;
   *  `asset_id` lleva entonces el canónico. El readmodel lo emite en todas las filas. */
  requested_asset_id?: string;
  weight?: number;
  display_name?: string;
  instrument_type: string;
  economic_asset_class?: string;
  coverage_status?: string;
  metrics?: RawMetrics | null;
  pms_exposure?: RawPmsExposure | null;
  quality_flags?: string[];
  costs?: RawCosts | null;
  currency?: string;
  region?: string;
  category?: string;
  sector?: string;
}

export interface DiscardedResolvedRow {
  /** Posición de la fila en la respuesta. */
  index: number;
  /** Ids de la fila, si se pueden leer. */
  asset_id?: string;
  requested_asset_id?: string;
  reason: string;
}

export interface RawResolvedPortfolio {
  rows: RawResolvedPortfolioRow[];
  /** Filas fuera de contrato: se descartan una a una y el resto se carga. */
  discarded_rows: DiscardedResolvedRow[];
  warnings?: { asset_id?: string; code?: string; message?: string; severity?: string; part?: string }[];
  positions?: { asset_id?: string; weight?: number }[];
}

/** Lo que el servidor no pudo leer (`READ_FAILED`, hallazgo 19): una parte de unos activos. No es que no existan. */
export interface RawReadWarning {
  part: ParteSinLeer;
  asset_ids: string[];
}

const PARTES_SIN_LEER = new Set<string>(["asset", "metrics", "holdings"]);

/**
 * Los avisos `read_warnings` de una respuesta. Son aditivos: un servidor aún sin actualizar no los manda, y entonces
 * no hay ninguno. Un aviso que no se entiende se ignora en vez de tumbar la respuesta, que sigue siendo válida.
 */
export function parseReadWarnings(value: unknown): RawReadWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RawReadWarning[] => {
    if (!item || typeof item !== "object") return [];
    const aviso = item as Record<string, unknown>;
    if (aviso.code !== "READ_FAILED" || typeof aviso.part !== "string" || !PARTES_SIN_LEER.has(aviso.part)) return [];
    const ids = Array.isArray(aviso.asset_ids)
      ? aviso.asset_ids.filter((id): id is string => typeof id === "string" && id.trim() !== "")
      : typeof aviso.asset_id === "string" ? [aviso.asset_id] : [];
    return ids.length > 0 ? [{ part: aviso.part as ParteSinLeer, asset_ids: ids }] : [];
  });
}

const METRIC_NUMBER_FIELDS = [
  "risk_score",
  "ytd_return",
  "volatility_3y",
  "volatility_1y",
  "volatility_5y",
  "volatility_10y",
  "annualized_return_1y",
  "annualized_return_3y",
  "annualized_return_5y",
  "annualized_return_10y",
  "sharpe_1y",
  "sharpe_3y",
  "sharpe_5y",
  "sharpe_10y",
  "max_drawdown_5y"
] as const;

function fail(field: string, message: string): never {
  throw new AppError("BACKEND", `Contrato de lectura en vivo inválido en ${field}: ${message}.`);
}

function nonEmptyString(value: unknown, field: string): string {
  const parsed = requireString(value, field).trim();
  if (!parsed) fail(field, "texto vacío");
  return parsed;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : requireString(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : requireNumber(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === undefined || value === null ? undefined : requireBoolean(value, field);
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  return value === undefined || value === null ? undefined : requireStringArray(value, field);
}

function optionalScalar(value: unknown, field: string): string | number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return requireNumber(value, field);
}

function optionalBooleanOrString(value: unknown, field: string): boolean | string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean" || typeof value === "string") return value;
  fail(field, "se esperaba booleano o texto");
}

function parseNumberRecord(value: unknown, field: string): Record<string, number> | undefined {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, requireNumber(item, `${field}.${key}`)])
  );
}

function parseScalarRecord(value: unknown, field: string): Record<string, string | number | boolean> | undefined {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return [key, item];
    fail(`${field}.${key}`, "se esperaba texto, número o booleano");
  }));
}

function parseFundamentalsSummary(value: unknown, field: string): BdbFundamentalsSummary | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    schema_version: nonEmptyString(source.schema_version, `${field}.schema_version`),
    source: nonEmptyString(source.source, `${field}.source`),
    as_of_date: optionalString(source.as_of_date, `${field}.as_of_date`),
    fetched_at: optionalString(source.fetched_at, `${field}.fetched_at`),
    currency: optionalString(source.currency, `${field}.currency`),
    coverage_status: nonEmptyString(source.coverage_status, `${field}.coverage_status`),
    profile: parseScalarRecord(source.profile, `${field}.profile`),
    valuation: parseNumberRecord(source.valuation, `${field}.valuation`),
    profitability: parseNumberRecord(source.profitability, `${field}.profitability`),
    growth: parseNumberRecord(source.growth, `${field}.growth`),
    per_share: parseNumberRecord(source.per_share, `${field}.per_share`),
    dividends: parseScalarRecord(source.dividends, `${field}.dividends`),
    fund_metrics: parseNumberRecord(source.fund_metrics, `${field}.fund_metrics`),
    holdings_summary: parseScalarRecord(source.holdings_summary, `${field}.holdings_summary`)
  };
}

function parseDrawdown(value: unknown, field: string): RawMetrics["max_drawdown_hist"] {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return requireNumber(value, field);
  const source = requireObject(value, field);
  return {
    value: optionalNumber(source.value, `${field}.value`),
    date: optionalString(source.date, `${field}.date`)
  };
}

function parseMetricsByWindow(value: unknown, field: string): RawMetrics["metrics_by_window"] {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  return Object.fromEntries(
    Object.entries(source).map(([ventana, rotulo]) => {
      const suyo = requireObject(rotulo, `${field}.${ventana}`);
      return [ventana, { method: optionalString(suyo.method, `${field}.${ventana}.method`), frequency: optionalString(suyo.frequency, `${field}.${ventana}.frequency`) }];
    })
  );
}

function parseDatesByWindow(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  return Object.fromEntries(Object.entries(source).map(([ventana, fecha]) => [ventana, requireString(fecha, `${field}.${ventana}`)]));
}

/**
 * De cuándo son las cifras y qué miden (hallazgo 16, 15-11-2026). Un servidor anterior no lo manda, y entonces todo va vacío: no se
 * supone ni una fecha ni una base.
 */
function parseContextoDeLasMetricas(source: GuardObject, field: string): ContextoDeLasMetricas {
  const proveedor = source.provider === undefined || source.provider === null ? undefined : requireObject(source.provider, `${field}.provider`);
  const contexto: ContextoDeLasMetricas = {
    as_of: optionalString(source.as_of, `${field}.as_of`),
    returns_as_of: optionalString(source.returns_as_of, `${field}.returns_as_of`),
    returns_as_of_by_window: parseDatesByWindow(source.returns_as_of_by_window, `${field}.returns_as_of_by_window`),
    return_basis: optionalString(source.return_basis, `${field}.return_basis`),
    series_class: optionalString(source.series_class, `${field}.series_class`),
    distribution_policy: optionalString(source.distribution_policy, `${field}.distribution_policy`),
    windows_out_of_range: optionalStringArray(source.windows_out_of_range, `${field}.windows_out_of_range`),
    provider: proveedor
      ? {
          as_of: optionalString(proveedor.as_of, `${field}.provider.as_of`),
          returns_as_of: optionalString(proveedor.returns_as_of, `${field}.provider.returns_as_of`),
          returns_as_of_by_window: parseDatesByWindow(proveedor.returns_as_of_by_window, `${field}.provider.returns_as_of_by_window`)
        }
      : undefined
  };
  return Object.fromEntries(Object.entries(contexto).filter(([, valor]) => valor !== undefined)) as ContextoDeLasMetricas;
}

function parseMetrics(value: unknown, field: string): RawMetrics | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  const metrics: RawMetrics = {
    risk_score_source: optionalString(source.risk_score_source, `${field}.risk_score_source`),
    metrics_source: optionalString(source.metrics_source, `${field}.metrics_source`),
    metrics_method: optionalString(source.metrics_method, `${field}.metrics_method`),
    metrics_frequency: optionalString(source.metrics_frequency, `${field}.metrics_frequency`),
    metrics_by_window: parseMetricsByWindow(source.metrics_by_window, `${field}.metrics_by_window`),
    max_drawdown_hist: parseDrawdown(source.max_drawdown_hist, `${field}.max_drawdown_hist`),
    max_drawdown_hist_date: optionalString(source.max_drawdown_hist_date, `${field}.max_drawdown_hist_date`),
    ...parseContextoDeLasMetricas(source, field)
  };
  for (const key of METRIC_NUMBER_FIELDS) {
    metrics[key] = optionalNumber(source[key], `${field}.${key}`);
  }
  return metrics;
}

function parsePmsExposure(value: unknown, field: string): RawPmsExposure | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    equity: optionalNumber(source.equity, `${field}.equity`),
    fixed_income: optionalNumber(source.fixed_income, `${field}.fixed_income`),
    cash: optionalNumber(source.cash, `${field}.cash`),
    alternative: optionalNumber(source.alternative, `${field}.alternative`),
    real_asset: optionalNumber(source.real_asset, `${field}.real_asset`),
    other: optionalNumber(source.other, `${field}.other`),
    source: optionalString(source.source, `${field}.source`)
  };
}

function parseIdentity(value: unknown, field: string): RawIdentity | undefined {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  return {
    display_name: optionalString(source.display_name, `${field}.display_name`),
    isin: optionalString(source.isin, `${field}.isin`),
    ticker: optionalString(source.ticker, `${field}.ticker`),
    currency: optionalString(source.currency, `${field}.currency`),
    region: optionalString(source.region, `${field}.region`),
    benchmark: source.benchmark
  };
}

function parseCosts(value: unknown, field: string): RawCosts | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    ongoing_charge: optionalNumber(source.ongoing_charge, `${field}.ongoing_charge`),
    management_fee: optionalNumber(source.management_fee, `${field}.management_fee`),
    transaction_costs: optionalNumber(source.transaction_costs, `${field}.transaction_costs`),
    entry_charge: optionalNumber(source.entry_charge, `${field}.entry_charge`),
    document_url: optionalString(source.document_url, `${field}.document_url`),
    document_date: optionalString(source.document_date, `${field}.document_date`),
    ongoing_charge_source: optionalString(source.ongoing_charge_source, `${field}.ongoing_charge_source`),
    transaction_costs_source: optionalString(source.transaction_costs_source, `${field}.transaction_costs_source`),
    entry_charge_source: optionalString(source.entry_charge_source, `${field}.entry_charge_source`)
  };
}

function parseProduct(value: unknown, field: string): RawProduct | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    provider: optionalString(source.provider, `${field}.provider`),
    product_type: optionalString(source.product_type, `${field}.product_type`),
    domicile: optionalString(source.domicile, `${field}.domicile`),
    share_class: optionalString(source.share_class, `${field}.share_class`),
    distribution_policy: optionalString(source.distribution_policy, `${field}.distribution_policy`),
    inception_date: optionalString(source.inception_date, `${field}.inception_date`),
    ucits: optionalBooleanOrString(source.ucits, `${field}.ucits`),
    replication: optionalString(source.replication, `${field}.replication`),
    legal_structure: optionalString(source.legal_structure, `${field}.legal_structure`),
    benchmark: source.benchmark,
    official_benchmark: source.official_benchmark,
    reference_index: source.reference_index
  };
}

function parseProfile(value: unknown, field: string): RawFundProfile | null | undefined {
  const product = parseProduct(value, field);
  if (product === undefined || product === null) return product;
  return {
    product_type: product.product_type,
    domicile: product.domicile,
    share_class: product.share_class,
    distribution_policy: product.distribution_policy,
    inception_date: product.inception_date,
    ucits: product.ucits,
    replication: product.replication,
    legal_structure: product.legal_structure,
    benchmark: product.benchmark
  };
}

function parseSustainability(value: unknown, field: string): RawSustainability | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    sfdr: optionalString(source.sfdr, `${field}.sfdr`),
    esg_rating: optionalScalar(source.esg_rating, `${field}.esg_rating`),
    sustainability_rating: optionalScalar(source.sustainability_rating, `${field}.sustainability_rating`)
  };
}

function parseClassification(value: unknown, field: string): RawClassification | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    category: optionalString(source.category, `${field}.category`),
    region: optionalString(source.region, `${field}.region`),
    region_primary: optionalString(source.region_primary, `${field}.region_primary`),
    sector: optionalString(source.sector, `${field}.sector`),
    gics_sector: optionalString(source.gics_sector, `${field}.gics_sector`),
    industry: optionalString(source.industry, `${field}.industry`),
    strategy: optionalString(source.strategy, `${field}.strategy`),
    morningstar_rating: optionalNumber(source.morningstar_rating, `${field}.morningstar_rating`),
    benchmark: source.benchmark,
    official_benchmark: source.official_benchmark,
    reference_index: source.reference_index
  };
}

function parsePerformance(value: unknown, field: string): RawPerformancePreview | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  const metrics = parseMetrics(source, field) ?? {};
  return {
    available: requireBoolean(source.available, `${field}.available`),
    ...metrics,
    latest_value: optionalNumber(source.latest_value, `${field}.latest_value`),
    latest_value_date: optionalString(source.latest_value_date, `${field}.latest_value_date`),
    latest_value_currency: optionalString(source.latest_value_currency, `${field}.latest_value_currency`),
    source: optionalString(source.source, `${field}.source`),
    data_quality: optionalString(source.data_quality, `${field}.data_quality`)
  };
}

function parseHoldingsSummary(value: unknown, field: string): BdbAssetDetail["holdings_summary"] {
  if (value === undefined || value === null) return undefined;
  const source = requireObject(value, field);
  const positionsCount = optionalNumber(source.positions_count, `${field}.positions_count`);
  if (positionsCount !== undefined && (!Number.isInteger(positionsCount) || positionsCount < 0)) {
    fail(`${field}.positions_count`, "entero no negativo esperado");
  }
  return {
    has_holdings: requireBoolean(source.has_holdings, `${field}.has_holdings`),
    positions_count: positionsCount,
    top10_weight: optionalNumber(source.top10_weight, `${field}.top10_weight`),
    as_of_date: optionalString(source.as_of_date, `${field}.as_of_date`),
    full_holdings_loaded: optionalBoolean(source.full_holdings_loaded, `${field}.full_holdings_loaded`),
    ...parseAlcanceDeLasPosiciones(source, field)
  };
}

/** El total de títulos, la cobertura y si la lista es entera (hallazgo 20). Sin servidor al día, no constan. */
export function parseAlcanceDeLasPosiciones(source: GuardObject, field: string): AlcanceDeLasPosiciones {
  const titulos = optionalNumber(source.securities_count, `${field}.securities_count`);
  if (titulos !== undefined && (!Number.isInteger(titulos) || titulos < 1)) fail(`${field}.securities_count`, "entero positivo esperado");
  const cobertura = optionalNumber(source.coverage, `${field}.coverage`);
  if (cobertura !== undefined && (cobertura < 0 || cobertura > 1)) fail(`${field}.coverage`, "tanto por uno esperado");
  const alcance = optionalString(source.list_scope, `${field}.list_scope`);
  if (alcance !== undefined && alcance !== "FULL" && alcance !== "TOP") fail(`${field}.list_scope`, "FULL o TOP esperado");
  return {
    ...(titulos !== undefined ? { securities_count: titulos } : {}),
    ...(cobertura !== undefined ? { coverage: cobertura } : {}),
    ...(alcance !== undefined ? { list_scope: alcance } : {})
  };
}

function parseExposureDetail(value: unknown, field: string): RawAssetDetail["exposure_detail"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  return {
    sectors: parseNumberRecord(source.sectors, `${field}.sectors`),
    equity_styles: parseNumberRecord(source.equity_styles, `${field}.equity_styles`),
    equity_regions: parseNumberRecord(source.equity_regions, `${field}.equity_regions`),
    market_caps: parseNumberRecord(source.market_caps, `${field}.market_caps`),
    equity_style_box: parseNumberRecord(source.equity_style_box, `${field}.equity_style_box`),
    confidence: optionalNumber(source.confidence, `${field}.confidence`)
  };
}

function parseFixedIncomeProfile(value: unknown, field: string): RawAssetDetail["fixed_income_profile"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = requireObject(value, field);
  const profile: BdbFixedIncomeProfile = {
    effective_duration: optionalNumber(source.effective_duration, `${field}.effective_duration`),
    modified_duration: optionalNumber(source.modified_duration, `${field}.modified_duration`),
    effective_maturity: optionalNumber(source.effective_maturity, `${field}.effective_maturity`),
    avg_credit_quality: optionalString(source.avg_credit_quality, `${field}.avg_credit_quality`),
    yield_to_maturity: optionalNumber(source.yield_to_maturity, `${field}.yield_to_maturity`),
    investment_grade_pct: optionalNumber(source.investment_grade_pct, `${field}.investment_grade_pct`),
    high_yield_pct: optionalNumber(source.high_yield_pct, `${field}.high_yield_pct`),
    bond_types: parseNumberRecord(source.bond_types, `${field}.bond_types`)
  };
  return Object.fromEntries(Object.entries(profile).filter(([, item]) => item !== undefined));
}

function parseDataQuality(value: unknown, field: string): RawAssetDetail["data_quality_summary"] {
  if (value === undefined || value === null || typeof value === "string") return value;
  const source = requireObject(value, field);
  const warningsCount = requireNumber(source.warnings_count, `${field}.warnings_count`);
  if (!Number.isInteger(warningsCount) || warningsCount < 0) fail(`${field}.warnings_count`, "entero no negativo esperado");
  return {
    coverage_status: nonEmptyString(source.coverage_status, `${field}.coverage_status`) as BdbAssetDataQualitySummary["coverage_status"],
    has_identity: requireBoolean(source.has_identity, `${field}.has_identity`),
    has_metrics: requireBoolean(source.has_metrics, `${field}.has_metrics`),
    has_pms_exposure: requireBoolean(source.has_pms_exposure, `${field}.has_pms_exposure`),
    has_costs: requireBoolean(source.has_costs, `${field}.has_costs`),
    has_holdings_summary: requireBoolean(source.has_holdings_summary, `${field}.has_holdings_summary`),
    has_fundamentals: optionalBoolean(source.has_fundamentals, `${field}.has_fundamentals`),
    has_history_years: requireBoolean(source.has_history_years, `${field}.has_history_years`),
    quality_flags: requireStringArray(source.quality_flags, `${field}.quality_flags`) as BdbAssetDataQualitySummary["quality_flags"],
    warnings_count: warningsCount
  };
}

function commonAssetFields(source: GuardObject, field: string) {
  return {
    asset_id: nonEmptyString(source.asset_id, `${field}.asset_id`),
    instrument_type: nonEmptyString(source.instrument_type, `${field}.instrument_type`),
    economic_asset_class: optionalString(source.economic_asset_class, `${field}.economic_asset_class`),
    coverage_status: optionalString(source.coverage_status, `${field}.coverage_status`),
    is_investable: optionalBoolean(source.is_investable, `${field}.is_investable`),
    role: optionalString(source.role, `${field}.role`),
    quality_flags: optionalStringArray(source.quality_flags, `${field}.quality_flags`),
    metrics: parseMetrics(source.metrics, `${field}.metrics`)
  };
}

export function parseRawAssetDetail(value: unknown, field = "asset"): RawAssetDetail {
  const source = requireObject(value, field);
  return {
    ...commonAssetFields(source, field),
    updated_at: optionalString(source.updated_at, `${field}.updated_at`),
    identity: parseIdentity(source.identity, `${field}.identity`),
    performance_preview: parsePerformance(source.performance_preview, `${field}.performance_preview`),
    benchmark: source.benchmark,
    official_benchmark: source.official_benchmark,
    reference_index: source.reference_index,
    index_id: source.index_id,
    costs: parseCosts(source.costs, `${field}.costs`),
    product: parseProduct(source.product, `${field}.product`),
    profile: parseProfile(source.profile, `${field}.profile`),
    fund_profile: parseProfile(source.fund_profile, `${field}.fund_profile`),
    sustainability: parseSustainability(source.sustainability, `${field}.sustainability`),
    classification: parseClassification(source.classification, `${field}.classification`),
    category: optionalString(source.category, `${field}.category`),
    pms_exposure: parsePmsExposure(source.pms_exposure, `${field}.pms_exposure`),
    holdings_summary: parseHoldingsSummary(source.holdings_summary, `${field}.holdings_summary`),
    exposure_detail: parseExposureDetail(source.exposure_detail, `${field}.exposure_detail`),
    fixed_income_profile: parseFixedIncomeProfile(source.fixed_income_profile, `${field}.fixed_income_profile`),
    available_sections: optionalStringArray(source.available_sections, `${field}.available_sections`),
    data_quality_summary: parseDataQuality(source.data_quality_summary, `${field}.data_quality_summary`),
    fundamentals_summary: parseFundamentalsSummary(source.fundamentals_summary, `${field}.fundamentals_summary`)
  };
}

export function parseRawSearchItem(value: unknown, field = "asset"): RawSearchItem {
  const source = requireObject(value, field);
  return {
    ...commonAssetFields(source, field),
    display_name: optionalString(source.display_name, `${field}.display_name`),
    isin: optionalString(source.isin, `${field}.isin`),
    ticker: optionalString(source.ticker, `${field}.ticker`),
    provider: optionalString(source.provider, `${field}.provider`),
    product: parseProduct(source.product, `${field}.product`),
    currency: optionalString(source.currency, `${field}.currency`),
    region: optionalString(source.region, `${field}.region`),
    category: optionalString(source.category, `${field}.category`),
    sector: optionalString(source.sector, `${field}.sector`),
    strategy: optionalString(source.strategy, `${field}.strategy`),
    morningstar_rating: optionalNumber(source.morningstar_rating, `${field}.morningstar_rating`),
    benchmark: source.benchmark,
    official_benchmark: source.official_benchmark,
    reference_index: source.reference_index,
    index_id: source.index_id
  };
}

function parseRawResolvedRow(value: unknown, index: number): RawResolvedPortfolioRow {
  const field = `rows[${index}]`;
  const source = requireObject(value, field);
  return {
    ...commonAssetFields(source, field),
    requested_asset_id: optionalString(source.requested_asset_id, `${field}.requested_asset_id`),
    weight: optionalNumber(source.weight, `${field}.weight`),
    display_name: optionalString(source.display_name, `${field}.display_name`),
    pms_exposure: parsePmsExposure(source.pms_exposure, `${field}.pms_exposure`),
    costs: parseCosts(source.costs, `${field}.costs`),
    currency: optionalString(source.currency, `${field}.currency`),
    region: optionalString(source.region, `${field}.region`),
    category: optionalString(source.category, `${field}.category`),
    sector: optionalString(source.sector, `${field}.sector`)
  };
}

function ensureUniqueAssetIds<T extends { asset_id: string }>(items: T[], field: string): T[] {
  if (new Set(items.map((item) => item.asset_id)).size !== items.length) fail(field, "asset_id duplicado");
  return items;
}

export interface RawSearchPage {
  assets: RawSearchItem[];
  /** Total real de coincidencias en el universo; null si el backend no lo conoce (fallback sin índice o backend antiguo). */
  total_matches: number | null;
  /** Cursor para la página siguiente; null cuando no quedan más. */
  next_cursor: string | null;
  /** Lo que no se pudo leer de los resultados; vacío con un servidor antiguo. */
  read_warnings: RawReadWarning[];
}

export function parseLiveSearchPageResponse(value: unknown): RawSearchPage {
  const source = requireObject(value, "search_assets response");
  const assets = ensureUniqueAssetIds(
    requireArray(source.assets, "assets").map((item, index) => parseRawSearchItem(item, `assets[${index}]`)),
    "assets"
  );
  const total = source.total_matches;
  const cursor = source.next_cursor;
  return {
    assets,
    total_matches:
      typeof total === "number" && Number.isFinite(total) && total >= 0 ? Math.floor(total) : null,
    next_cursor: typeof cursor === "string" && cursor.trim() !== "" ? cursor : null,
    read_warnings: parseReadWarnings(source.read_warnings)
  };
}

export function parseLiveSearchResponse(value: unknown): RawSearchItem[] {
  return parseLiveSearchPageResponse(value).assets;
}

export function parseLiveAssetDetailResponse(value: unknown): RawAssetDetail | null {
  return value === null ? null : parseRawAssetDetail(value, "get_asset_detail response");
}

export function parseLiveCompareResponse(value: unknown): RawAssetDetail[] {
  return parseLiveComparePage(value).assets;
}

export interface RawComparePage {
  assets: RawAssetDetail[];
  /** Los ids pedidos que no existen en la base; vacío con un servidor antiguo, que los callaba. */
  missing_asset_ids: string[];
  read_warnings: RawReadWarning[];
}

/** La comparación con lo que el servidor añadió el 15-11-2026, todo aditivo: sin ello, la respuesta de siempre. */
export function parseLiveComparePage(value: unknown): RawComparePage {
  const source = requireObject(value, "compare_assets response");
  const assets = ensureUniqueAssetIds(
    requireArray(source.assets, "assets").map((item, index) => parseRawAssetDetail(item, `assets[${index}]`)),
    "assets"
  );
  const missing = Array.isArray(source.missing_asset_ids)
    ? source.missing_asset_ids.filter((id): id is string => typeof id === "string")
    : [];
  return { assets, missing_asset_ids: missing, read_warnings: parseReadWarnings(source.read_warnings) };
}

/**
 * La forma de la respuesta (objeto con `rows` como lista) es obligatoria; cada
 * fila se valida por separado. Una fila fuera de contrato se descarta con su
 * motivo y la carga sigue: antes una sola tumbaba la resolución entera del
 * Extracto externo (revisión del 14-10-2026, como H04).
 */
export function parseLiveResolvedPortfolio(value: unknown): RawResolvedPortfolio {
  const source = requireObject(value, "resolve_portfolio response");
  const rows: RawResolvedPortfolioRow[] = [];
  const discarded_rows: DiscardedResolvedRow[] = [];
  requireArray(source.rows, "rows").forEach((item, index) => {
    try {
      rows.push(parseRawResolvedRow(item, index));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const raw = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
      discarded_rows.push({
        index,
        asset_id: typeof raw.asset_id === "string" ? raw.asset_id : undefined,
        requested_asset_id: typeof raw.requested_asset_id === "string" ? raw.requested_asset_id : undefined,
        reason: error.message
      });
    }
  });
  const warnings = source.warnings === undefined
    ? undefined
    : requireArray(source.warnings, "warnings").map((item, index) => {
        const warning = requireObject(item, `warnings[${index}]`);
        return {
          asset_id: optionalString(warning.asset_id, `warnings[${index}].asset_id`),
          code: optionalString(warning.code, `warnings[${index}].code`),
          message: optionalString(warning.message, `warnings[${index}].message`),
          severity: optionalString(warning.severity, `warnings[${index}].severity`),
          part: typeof warning.part === "string" ? warning.part : undefined
        };
      });
  const positions = source.positions === undefined
    ? undefined
    : requireArray(source.positions, "positions").map((item, index) => {
        const position = requireObject(item, `positions[${index}]`);
        return {
          asset_id: optionalString(position.asset_id, `positions[${index}].asset_id`),
          weight: optionalNumber(position.weight, `positions[${index}].weight`)
        };
      });
  return { rows, discarded_rows, warnings, positions };
}
