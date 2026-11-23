export type InstrumentType = "FUND" | "ETF" | "STOCK" | "INDEX";

export type BdbAssetDataSourceKind =
  | "LOCAL_MOCK"
  | "BBDD_STATIC_EXPORT_SAMPLE"
  | "BBDD_LIVE_API";

export type EconomicAssetClass =
  | "EQUITY"
  | "FIXED_INCOME"
  | "MIXED"
  | "MONEY_MARKET"
  | "ALTERNATIVE"
  | "REAL_ASSET"
  | "COMMODITIES"
  | "OTHER"
  | "UNKNOWN";

export type BdbCoverageStatus = "COMPLETE" | "PARTIAL" | "ROOT_ONLY" | "MISSING" | "COMPLETE_LATER";

export type BdbQualityFlag =
  | "MOCK_DATA"
  | "MISSING_HOLDINGS"
  | "MISSING_HISTORY"
  | "MISSING_QUANT_METRICS"
  /** @deprecated Use MISSING_QUANT_METRICS for AssetForBdb-compatible payloads. */
  | "MISSING_METRICS"
  | "PARTIAL_COVERAGE"
  | "NON_INVESTABLE_BENCHMARK"
  | "NON_INVESTABLE_CORPORATE_ACTION"
  | "NON_INVESTABLE_SUSPENDED"
  | "NON_INVESTABLE_DELISTED"
  | "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"
  /** Nunca se resolvió su símbolo: no tiene precio ni métricas (decisión 44). El estado lo dice la base nueva, no el ISIN. */
  | "NON_INVESTABLE_NEVER_RESOLVED"
  /** Cotiza y se puede comprar: lo que falla es su serie de precios, y por eso no se propone ni se mide (decisión 75). */
  | "QUALITY_BLOCKED"
  | "UNSUPPORTED_INSTRUMENT_TYPE"
  | "MISSING_ASSET"
  | "SUITABILITY_REVIEW_REQUIRED"
  /**
   * Las cinco marcas de la revisión del histórico que limitan la historia de un fondo (decisión 120): se dicen, y no deciden nada; el
   * servidor ya recorta esa historia en el cálculo. Las dos buenas noticias de esa revisión no son un aviso y no llegan aquí
   * (`MARCAS_QUE_NO_SON_AVISO`, en `core/labels`).
   */
  | "HISTORY_CONTINUITY_UNVERIFIED"
  | "HISTORY_RESTRICTED_AFTER_REVIEW"
  | "TOTAL_RETURN_UNVERIFIED"
  | "HISTORY_SPLICED_SISTER_CLASS"
  | "PRICE_FROZEN_DELISTED";

export interface BdbAdapterWarning {
  code: BdbQualityFlag;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
  asset_id?: string;
}

export type VentanaDeMetricas = "1y" | "3y" | "5y" | "10y";

export interface RotuloDeVentana {
  method?: string;
  frequency?: string;
}

/**
 * Lo que el servidor dice de las métricas sin ser una cifra (hallazgo 16, 15-11-2026): de cuándo son y qué miden, con los nombres de
 * `read/card.metrics`. Solo lo manda un servidor al día y solo de la base nueva; sin él, no consta, y no se supone.
 */
export interface ContextoDeLasMetricas {
  /** A qué fecha se refieren las cifras. */
  as_of?: string;
  /** La fecha de las rentabilidades del titular cuando no es `as_of`. */
  returns_as_of?: string;
  returns_as_of_by_window?: Partial<Record<VentanaDeMetricas | "ytd", string>>;
  /** Rentabilidad total (con dividendos) o de precio. */
  return_basis?: "TOTAL_RETURN" | "PRICE_RETURN" | string;
  /** `MARKET_PRICE` si se midió sobre el cierre de mercado y no sobre el valor liquidativo. */
  series_class?: string;
  distribution_policy?: "ACCUMULATING" | "DISTRIBUTING" | "UNKNOWN" | string;
  /** Las cifras nuestras apartadas por salirse de rango, por su ruta («annualized_return.10y»). */
  windows_out_of_range?: string[];
  /** Las fechas del bloque del proveedor, cuando alguna ventana es suya. */
  provider?: { as_of?: string; returns_as_of?: string; returns_as_of_by_window?: Partial<Record<VentanaDeMetricas, string>> };
}

export interface BdbAssetMetrics extends ContextoDeLasMetricas {
  risk_score?: number;
  risk_score_source?: "SRRI" | "VOL_BUCKET" | string;
  metrics_source?: string;
  /** metrics.v1.2: `GEOMETRIC_CAGR` (calculado por BDB) o `TRAILING_PROVIDER`
   *  (cifra del proveedor). Sin valor = metodologia desconocida. */
  metrics_method?: string;
  /** Frecuencia de las observaciones con las que se midio la volatilidad. */
  metrics_frequency?: string;
  /** Solo si el activo mezcla cifras nuestras y del proveedor (decisión 110): el método y la frecuencia de cada ventana. Se lee con `rotuloDeLaVentana`. */
  metrics_by_window?: Partial<Record<VentanaDeMetricas, RotuloDeVentana>>;
  ytd_return?: number;
  volatility_3y?: number;
  volatility_1y?: number;
  volatility_5y?: number;
  volatility_10y?: number;
  annualized_return_3y?: number;
  annualized_return_1y?: number;
  annualized_return_5y?: number;
  annualized_return_10y?: number;
  sharpe_3y?: number;
  sharpe_1y?: number;
  sharpe_5y?: number;
  sharpe_10y?: number;
  max_drawdown_5y?: number;
  max_drawdown_hist?: {
    value?: number;
    date?: string;
  };
}

export interface BdbPmsExposure {
  equity: number;
  fixed_income: number;
  cash: number;
  alternative: number;
  real_asset?: number;
  other: number;
  source?: string;
}

export interface BdbExposureDetail {
  sectors?: Record<string, number>;
  equity_styles?: Record<string, number>;
  equity_regions?: Record<string, number>;
  market_caps?: Record<string, number>;
  /** Las nueve celdas de la caja de estilo y tamaño, netas de cortos. El instrumento que no las trae se lee por los dos repartos. */
  equity_style_box?: Record<string, number>;
  confidence?: number;
}

export interface BdbHoldingsSummary extends AlcanceDeLasPosiciones {
  has_holdings: boolean;
  /** En la base nueva, el número de bonos o, si no hay, el de acciones: no el total. El total es `securities_count`. */
  positions_count?: number;
  top10_weight?: number;
  as_of_date?: string;
  full_holdings_loaded?: boolean;
}

/** Lo que hace falta para no leer una lista parcial como completa (hallazgo 20, 15-11-2026). Sin servidor al día, no consta. */
export interface AlcanceDeLasPosiciones {
  /** Los títulos de la cartera según el proveedor, acciones más bonos. */
  securities_count?: number;
  /** La parte del patrimonio que cubren las posiciones de la fuente, en tanto por uno. */
  coverage?: number;
  /** `FULL`: la cartera entera; `TOP`: solo las principales. */
  list_scope?: "FULL" | "TOP";
}

export type BdbHoldingsStorageMode = "SINGLE_DOCUMENT" | "CHUNKED";

export interface BdbHoldingPosition {
  holding_id?: string;
  name: string;
  isin?: string;
  ticker?: string;
  weight_pct: number;
  holding_type?: string;
  /** El código fino del proveedor (`E`, `CU`, `SI`…), que es lo que dice qué es la línea: ver `core/lineaDeCartera`. */
  holding_type_code?: string;
  currency?: string;
  sector?: string;
  country?: string;
}

export interface BdbAssetHoldings {
  /** El id con el que se pidió (también si era un ISIN sustituido por fusión). */
  asset_id: string;
  /** Activo vigente cuya cartera se devuelve, solo cuando el id pedido era un alias. */
  resolved_to?: string;
  storage_mode: BdbHoldingsStorageMode;
  /** Las líneas recibidas, que no son por fuerza todas: el total y el alcance van en `securities_count` y `list_scope`. */
  holdings_count?: number;
  securities_count?: AlcanceDeLasPosiciones["securities_count"];
  coverage?: AlcanceDeLasPosiciones["coverage"];
  list_scope?: AlcanceDeLasPosiciones["list_scope"];
  top10_weight?: number;
  as_of_date?: string;
  holdings: BdbHoldingPosition[];
  /**
   * Si esta cartera no es la del proveedor sino la completa que publica el emisor del ETF (decisión B-79). La pone
   * `adapters/carteraDelEmisor`. Con ella se mide el solapamiento en todas partes (decisión del 14-11-2026); la cartera misma y quién la
   * publica solo se enseñan al asesor. Sin el campo, es la del proveedor.
   */
  issuer_portfolio?: BdbIssuerPortfolioOrigin;
}

/** De dónde sale una cartera del emisor: quién la publica, de qué fecha es y cómo se han hecho sus pesos. */
export interface BdbIssuerPortfolioOrigin {
  /** El adaptador del emisor, sin el prefijo `issuer:` (`ishares`, `vanguard`…). */
  source: string;
  /** La fecha de la cartera que declara el emisor, no la de la descarga. */
  as_of: string;
  /** `MARKET_VALUE`: valor de mercado de cada línea sobre la suma de la lista. `DECLARED_WEIGHT`: el peso que declara el emisor. */
  weighting: "MARKET_VALUE" | "DECLARED_WEIGHT";
}

export interface BdbPortfolioLookThroughRow {
  key: string;
  name: string;
  identifier?: string;
  weight_percent: number;
  fund_count: number;
  source_asset_ids: string[];
  /** Lo que pesa en la cartera como acción en directo. Sin ella, el campo no viene. Va sumado en `weight_percent`. */
  direct_weight_percent?: number;
  /** La línea es un fondo que lleva dentro algún fondo de la cartera: no se ha mirado por dentro (decisión A-165). */
  fund_not_opened?: true;
}

/** Lo que se ha recibido de verdad de la cartera de un fondo. */
export interface BdbFundPublishedPortfolio {
  asset_id: string;
  display_name: string;
  lines: number;
  /** De esas líneas, las que son títulos (`CarteraPublicada.titulos`): con ellas se comprueba la cuenta de posiciones que declara el proveedor. */
  security_lines?: number;
  published_weight_percent: number;
  /** Si llega a la mitad de su cartera, que es la regla del solapamiento. */
  sufficient: boolean;
  /** Lo que el fondo tiene en otros fondos, sobre su propia cartera. No se mira por dentro ni cuenta como mirado (A-165). Solo si hay. */
  funds_inside_weight_percent?: number;
  /** Si lo mirado es la cartera del emisor y no la del proveedor (decisión B-79): solo el asesor ve de quién es. */
  issuer_portfolio?: BdbIssuerPortfolioOrigin;
}

/** «Mayores acciones de la cartera»: lo que llevan los fondos más lo que hay en directo, sin derivados, divisa ni efectivo. */
export interface BdbPortfolioEquities {
  rows: BdbPortfolioLookThroughRow[];
  /** Lo que suman todas las líneas de acción sobre la cartera, no solo las filas. Con su signo: una venta en corto resta. */
  identified_weight_percent: number;
  /** La renta variable de la cartera, según la exposición de cada posición: de esto, cuánto se ha podido ver. */
  equity_exposure_percent: number;
  /** Los fondos con renta variable cuyas líneas no dicen qué son. Mientras haya alguno, la tabla no se puede dar. */
  unclassified_funds: string[];
}

export interface BdbPortfolioLookThrough {
  rows: BdbPortfolioLookThroughRow[];
  equities: BdbPortfolioEquities;
  /** Posiciones que no son una acción: de cuántas se esperaría una cartera. */
  fund_positions: number;
  /** Las que han publicado algo, aunque sea poco: cuánto lo dice `fund_portfolios`. */
  covered_funds: number;
  /** Acciones en directo: se ven enteras, no les falta ningún dato y no son fondos. */
  direct_positions: number;
  /**
   * Lo que se ha mirado de verdad: las acciones enteras, y de cada fondo la parte de su cartera que se ha recibido y que
   * no es, a su vez, otro fondo (decisión A-165).
   */
  seen_weight_percent: number;
  /** Lo que pesan en la cartera los fondos que llevan dentro sus fondos: recibido, pero no mirado por dentro. Solo si hay. */
  unopened_funds_weight_percent?: number;
  fund_portfolios: BdbFundPublishedPortfolio[];
  warnings: string[];
}

/** De dónde sale una cifra de coste. Manda el KID y, donde no lo haya, el proveedor (decisión 43). */
export type FuenteDeCoste = "KID" | "PROVIDER";

export interface BdbAssetCosts {
  ongoing_charge?: number;
  management_fee?: number;
  /** Costes de operación del fondo, al año y en fracción. No van dentro de `ongoing_charge`. */
  transaction_costs?: number;
  /** Entrada máxima, en fracción. Es un pago único: no se suma a un coste anual. */
  entry_charge?: number;
  /** El KID del activo, si lo tiene. Que esté no prueba que una cifra salga de él: lo dice su fuente. */
  document_url?: string;
  /** La fecha que dice ese KID, si se ha podido leer. */
  document_date?: string;
  ongoing_charge_source?: FuenteDeCoste;
  transaction_costs_source?: FuenteDeCoste;
  entry_charge_source?: FuenteDeCoste;
}

export interface BdbFundamentalsSummary {
  schema_version: string;
  source: string;
  as_of_date?: string;
  fetched_at?: string;
  currency?: string;
  coverage_status: string;
  profile?: Record<string, string | number | boolean>;
  valuation?: Record<string, number>;
  profitability?: Record<string, number>;
  growth?: Record<string, number>;
  per_share?: Record<string, number>;
  dividends?: Record<string, string | number | boolean>;
  fund_metrics?: Record<string, number>;
  holdings_summary?: Record<string, string | number | boolean>;
}

export interface BdbAssetDataQualitySummary {
  coverage_status: BdbCoverageStatus;
  has_identity: boolean;
  has_metrics: boolean;
  has_pms_exposure: boolean;
  has_costs: boolean;
  has_holdings_summary: boolean;
  has_fundamentals?: boolean;
  has_history_years: boolean;
  quality_flags: BdbQualityFlag[];
  warnings_count: number;
}

export interface BdbAssetPerformancePreview {
  available: boolean;
  ytd_return?: number;
  annualized_return_1y?: number;
  annualized_return_3y?: number;
  annualized_return_5y?: number;
  annualized_return_10y?: number;
  volatility_1y?: number;
  volatility_3y?: number;
  volatility_5y?: number;
  volatility_10y?: number;
  sharpe_1y?: number;
  sharpe_3y?: number;
  sharpe_5y?: number;
  sharpe_10y?: number;
  max_drawdown_5y?: number;
  max_drawdown_hist?: {
    value?: number;
    date?: string;
  };
  risk_score?: number;
  risk_score_source?: string;
  latest_value?: number;
  latest_value_date?: string;
  /** La divisa de `latest_value`, que no es por fuerza la de la clase (hallazgo 17). Sin ella, no consta. */
  latest_value_currency?: string;
  source?: string;
  /** El origen, o `NOT_AVAILABLE` si no hay ninguno (un servidor anterior al 15-11-2026 decía `MOCK_PROXY`). */
  data_quality?: string;
}

export interface BdbOfficialBenchmark {
  name: string;
  asset_id?: string;
  isin?: string;
  ticker?: string;
  source?: string;
}

/**
 * Perfil de renta fija del fondo (plan «Mejorar cartera», fase 1). La raíz de la
 * maestra lo trae en `fixed_income_profile`; el readmodel lo expone en la ficha.
 * Duración en años; calidad media como rating del proveedor («AA-», «BBB»…);
 * porcentajes (IG, HY, TIR) en fracción 0..1.
 */
export interface BdbFixedIncomeProfile {
  effective_duration?: number;
  modified_duration?: number;
  effective_maturity?: number;
  avg_credit_quality?: string;
  yield_to_maturity?: number;
  investment_grade_pct?: number;
  high_yield_pct?: number;
  /** Reparto por tipo de emisor, en fracción y solo sus partes > 0: government, municipal, corporate, securitized, cash
   *  y derivative (las dos que faltaban llegan desde la decisión C-33, 21-11-2026). */
  bond_types?: Record<string, number>;
}

export interface BdbAssetProductProfile {
  product_type?: string;
  domicile?: string;
  share_class?: string;
  distribution_policy?: string;
  inception_date?: string;
  ucits?: boolean;
  replication?: string;
  legal_structure?: string;
}

export interface BdbAssetSustainabilityProfile {
  sfdr?: string;
  esg_rating?: string | number;
  sustainability_rating?: string | number;
}

export interface BdbAssetSearchResult {
  asset_id: string;
  display_name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  isin?: string;
  ticker?: string;
  provider?: string;
  currency: string;
  coverage_status: BdbCoverageStatus;
  is_investable: boolean;
  role: "INVESTABLE" | "BENCHMARK";
  quality_flags: BdbQualityFlag[];
  warnings: BdbAdapterWarning[];
  metrics: BdbAssetMetrics;
  /** Rating Morningstar 1-5 (opcional; se muestra como estrellas cuando el dato existe). */
  morningstar_rating?: number;
  /** Region geografica (opcional; alimenta el filtro de Region cuando el dato existe). */
  region?: string;
  /** Categoria Morningstar / subcategoria (opcional; fondos y ETF, ausente en acciones). */
  category?: string;
  /** Sector propio del activo cuando la fuente lo trae; especialmente util en acciones individuales. */
  sector?: string;
  /** Estrategia/estilo declarado por la fuente o folleto, sin inferir por nombre. */
  strategy?: string;
  /** Benchmark oficial/de folleto del producto si la BBDD lo trae. No se infiere ni se usa para optimizar. */
  official_benchmark?: BdbOfficialBenchmark;
}

export interface BdbAssetDetail extends BdbAssetSearchResult {
  description: string;
  updated_at?: string;
  region?: string;
  category?: string;
  costs?: BdbAssetCosts;
  official_metrics_envelope?: BdbOfficialMetricsEnvelope;
  product_profile?: BdbAssetProductProfile;
  sustainability_profile?: BdbAssetSustainabilityProfile;
  /** Solo fondos y ETF de renta fija; ausente si el readmodel no trae dato. */
  fixed_income_profile?: BdbFixedIncomeProfile;
  pms_exposure: BdbPmsExposure;
  exposure_detail?: BdbExposureDetail;
  holdings_summary?: BdbHoldingsSummary;
  fundamentals_summary?: BdbFundamentalsSummary;
  available_sections?: string[];
  performance_preview?: BdbAssetPerformancePreview;
  data_quality_summary?: string | BdbAssetDataQualitySummary;
}

export interface BdbPortfolioPosition {
  asset_id: string;
  weight: number;
  label?: string;
}

export interface BdbManualPortfolioPosition {
  asset_id: string;
  weight_percent: number;
  label?: string;
  keepEuros?: boolean;
  targetEuros?: number;
}

export interface BdbSavedLocalPortfolio {
  portfolio_id: string;
  name: string;
  positions: BdbManualPortfolioPosition[];
  created_at: string;
  updated_at: string;
  sourceKind: BdbAssetDataSourceKind;
  total_capital?: number;
  /** Decisión 59: nivel de perfil de la cartera modelo, entero de 1 a 10. Ausente si el asesor no lo ha definido. */
  risk_profile_level?: number;
  /** Decisión 59: horizonte de la cartera modelo en años, mayor que cero. Ausente si no se ha escrito; no se deduce del nivel. */
  horizon_years?: number;
}

export type BdbPortfolioImportRejectReason =
  | "MALFORMED_LINE"
  | "INVALID_ASSET_ID"
  | "INVALID_WEIGHT"
  | "MISSING_ASSET"
  | "NON_INVESTABLE_BENCHMARK"
  | "NON_INVESTABLE"
  | "NON_INVESTABLE_NEVER_RESOLVED"
  | "DUPLICATE_ASSET";

export interface BdbPortfolioImportRejectedPosition {
  line_number: number;
  raw_line: string;
  asset_id?: string;
  weight_percent?: number;
  reason: BdbPortfolioImportRejectReason;
  message: string;
}

export interface BdbPortfolioImportResult {
  sourceKind: BdbAssetDataSourceKind;
  imported_positions: BdbManualPortfolioPosition[];
  rejected_positions: BdbPortfolioImportRejectedPosition[];
  total_weight_percent: number;
  /** Patrimonio total del extracto importado, en euros, cuando el fichero lo trae.
   *  Los pesos salen de dividir cada importe por este total, asi que aplicarlo como
   *  capital devuelve a cada posicion su importe original. Ausente en el formato
   *  simple `asset_id,weight`, que no lleva importes. */
  detected_capital?: number;
  warnings: string[];
  /** Resumen de la importación (quinta pasada de la auditoría del 16-10-2026):
   *  posiciones y euros leídos, columna del importe, criterio de divisa, hojas
   *  o tablas y filas descartadas. Se enseña siempre tras importar. */
  import_summary?: string[];
  /** Séptima pasada: lo leído de un extracto (cada posición con su nombre y su
   *  importe, y el criterio de divisa) que el asesor tiene que confirmar. Toda
   *  importación con posiciones queda pendiente —también la de pesos, que no
   *  trae este campo— hasta que el asesor la confirma. */
  euro_confirmation?: {
    positions: Array<{ id: string; name?: string; amount: number; eurStated?: boolean; notes?: string[] }>;
    reason: string;
  };
  /** Octava pasada: lo que el lector no elige por el asesor (columna de importe, titular). Con alguna
   *  pendiente (`chosen: null`), la importación no se puede confirmar. */
  import_choices?: Array<{
    kind: "amount" | "holder" | "date";
    key: string;
    question: string;
    where: string;
    reason: string;
    options: Array<{ value: string; label: string; total: number; positions: number; pendingInside?: boolean; outside?: { positions: number; total: number } }>;
    chosen: string | null;
  }>;
  /** Novena pasada (I5): las posiciones sin prueba de EUR que la regla de divisa deja fuera, con su importe y su
   *  motivo en `notes`, o las que el asesor ha incluido con la segunda casilla (`included`). */
  import_unproven?: {
    positions: Array<{ id: string; name?: string; amount: number; eurStated?: boolean; notes?: string[] }>;
    included: boolean;
  };
  /** El asesor ha confirmado la importación (los importes en euros o, en el formato de pesos, los activos y pesos). */
  euro_confirmed?: boolean;
  local_only_notice: string;
}

export type BdbPortfolioValidationStatus = "EMPTY" | "UNDER_ALLOCATED" | "VALID" | "OVER_ALLOCATED";

export interface BdbPortfolioAllocationBucket {
  key: string;
  weight_percent: number;
}

export type BdbPreviewMetricsMode = "PREVIEW_ONLY";

export type BdbOfficialMetricsMode = "OFFICIAL_READ_MODEL" | "FUTURE_API";

export type BdbMetricsMode = BdbPreviewMetricsMode | BdbOfficialMetricsMode;

export interface BdbPreviewMetricsBoundary {
  mode: BdbPreviewMetricsMode;
  source_label: string;
  limitations: string[];
}

export interface BdbOfficialMetricsDataQuality {
  status: "COMPLETE" | "PARTIAL" | "MISSING";
  flags: string[];
  warnings: string[];
}

export interface BdbOfficialPerformanceMetrics {
  annualized_return_3y?: number;
  ytd_return?: number;
}

export interface BdbOfficialRiskMetrics {
  volatility_3y?: number;
  volatility_1y?: number;
  volatility_5y?: number;
  sharpe_1y?: number;
  sharpe_3y?: number;
  sharpe_5y?: number;
  max_drawdown_5y?: number;
  max_drawdown_hist?: {
    value?: number;
    date?: string;
  };
}

export interface BdbOfficialCostMetrics {
  ongoing_charge?: number;
  management_fee?: number;
}

export interface BdbOfficialMetricsEnvelope {
  mode: BdbOfficialMetricsMode;
  source: "BBDD_ACTIVOS";
  as_of_date: string;
  calculation_policy: string;
  data_quality: BdbOfficialMetricsDataQuality;
  official_metrics?: {
    risk_score?: number;
  };
  official_performance?: BdbOfficialPerformanceMetrics;
  official_risk?: BdbOfficialRiskMetrics;
  official_costs?: BdbOfficialCostMetrics;
  suitability_allowed: false;
  optimization_allowed: false;
  recommendation_allowed: false;
}

/** Por qué hay o no hay volatilidad estimada: «sin dato» y «métodos distintos» no son lo mismo. */
export type BdbVolatilityStatus = "ok" | "sin_dato" | "metodos_distintos";

export interface BdbPortfolioWeightedMetrics {
  preview_boundary: BdbPreviewMetricsBoundary;
  annualized_return_3y?: number;
  annualized_return_1y?: number;
  annualized_return_5y?: number;
  annualized_return_10y?: number;
  volatility_3y?: number;
  volatility_1y?: number;
  volatility_5y?: number;
  sharpe_1y?: number;
  sharpe_3y?: number;
  sharpe_5y?: number;
  max_drawdown_5y?: number;
  max_drawdown_hist?: {
    value?: number;
    date?: string;
  };
  /** Cobertura ponderada (0-1) de las métricas 3A: parte de la cartera con dato. */
  metric_coverage?: number;
  /** F-06: cobertura propia de cada ventana. 5A y 10A quedan N/D por debajo del umbral. */
  metric_coverage_1y?: number;
  metric_coverage_5y?: number;
  /** Cobertura de la rentabilidad 5A, independiente de la volatilidad disponible. */
  return_coverage_5y?: number;
  /** Cobertura de la rentabilidad 3A. `metric_coverage` cae a 0 si las volatilidades no se pueden sumar. */
  return_coverage_3y?: number;
  /** false si las volatilidades de la cartera vienen de métodos distintos: no se suman. */
  volatility_comparable?: boolean;
  metric_coverage_10y?: number;
  currency_mix_warning?: boolean;
  /**
   * Cobertura propia de la volatilidad de cada ventana y por qué no la hay. `metric_coverage` es el mínimo con la
   * rentabilidad: un activo con volatilidad y sin rentabilidad daba 0 %. Solo lo lee la pantalla.
   */
  volatility_detail?: Partial<Record<"1Y" | "3Y" | "5Y", { coverage: number; status: BdbVolatilityStatus }>>;
  /** Cobertura de cada caída media. Solo la lee la pantalla. */
  max_drawdown_coverage?: { hist: number; "5Y": number };
}

export interface BdbManualPortfolioSummary {
  source: BdbAssetDataSourceKind;
  position_count: number;
  total_weight_percent: number;
  validation_status: BdbPortfolioValidationStatus;
  is_valid: boolean;
  by_instrument_type: BdbPortfolioAllocationBucket[];
  by_economic_asset_class: BdbPortfolioAllocationBucket[];
  non_investable_assets: string[];
  /** El peso de lo que `by_*` no cuenta porque no es invertible. Solo si hay algo, y solo lo lee la pantalla. */
  non_investable_weight_percent?: number;
  /** La parte de esas dos listas que está fuera por su serie de precios y no porque no se pueda comprar (decisión 75). Solo si hay algo. */
  quality_blocked_assets?: string[];
  quality_blocked_weight_percent?: number;
  /** La parte de lo no invertible que nunca se resolvió y no tiene serie de precios, como la CAM (decisión 44). Solo si hay algo. */
  never_resolved_weight_percent?: number;
  /** Lo mismo, de lo que no está en el catálogo. */
  not_found_weight_percent?: number;
  /** Las posiciones que suman ese peso: el papel las lista, porque el informe solo trae las que tienen ficha (decisión 85). Solo si hay. */
  not_found_positions?: Array<{ asset_id: string; label?: string; weight_percent: number }>;
  warnings: string[];
  weighted_metrics: BdbPortfolioWeightedMetrics;
}

export interface BdbPortfolioReportPosition {
  asset_id: string;
  display_name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  currency: string;
  region?: string;
  category?: string;
  coverage_status: BdbCoverageStatus;
  weight_percent: number;
  is_investable: boolean;
  role: "INVESTABLE" | "BENCHMARK";
  quality_flags: BdbQualityFlag[];
  pms_exposure: BdbPmsExposure;
  performance_preview?: BdbAssetPerformancePreview;
  data_quality_summary?: string | BdbAssetDataQualitySummary;
  /** La réplica que da el proveedor (`product_profile.replication` de su ficha), para el solapamiento de los dos papeles. Nunca la del emisor (B-53). */
  replica?: string;
}

export interface BdbPortfolioXrayPosition {
  asset_id: string;
  display_name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  weight_percent: number;
}

export interface BdbPortfolioXray {
  total_positions: number;
  investable_positions: number;
  excluded_non_investable_positions: number;
  top_position?: BdbPortfolioXrayPosition;
  position_concentration: BdbPortfolioXrayPosition[];
  concentration_level: "BALANCED" | "WATCH" | "CONCENTRATED";
  by_instrument_type: BdbPortfolioAllocationBucket[];
  by_economic_asset_class: BdbPortfolioAllocationBucket[];
  by_currency: BdbPortfolioAllocationBucket[];
  by_region: BdbPortfolioAllocationBucket[];
  by_category: BdbPortfolioAllocationBucket[];
  pms_exposure_percent: BdbPmsExposure;
  /** S6a (P5): % del peso invertido con vector PMS real y % rellenado por
   *  clase económica — para poder DECIR la cobertura junto al reparto. */
  pms_exposure_coverage_percent?: number;
  pms_exposure_fallback_percent?: number;
  /**
   * A-203 (Óscar, 21-11-2026): % del peso invertido sin reparto de activos —un fondo que no lo declara, o una posición sin clase—.
   * No se reparte: `pms_exposure_percent` suma 100 menos esto, y la pantalla lo dice con «Falta el dato».
   */
  pms_exposure_sin_reparto_percent?: number;
  /** Las posiciones sin reparto, de más a menos peso (en % del peso invertido), para nombrarlas. */
  pms_exposure_sin_reparto?: Array<{ asset_id: string; display_name: string; weight_percent: number }>;
  coverage_complete_positions: number;
  performance_preview_available: number;
  data_quality_summary_available: number;
  data_risk_signals: string[];
}

export interface BdbPortfolioDataQualityFlagSummary {
  flag: BdbQualityFlag;
  count: number;
}

export interface BdbPortfolioDataDiagnostic {
  total_positions: number;
  investable_positions: number;
  excluded_non_investable_positions: number;
  enriched_positions: number;
  partial_or_warning_positions: number;
  performance_preview_available: number;
  data_quality_summary_available: number;
  quality_flags: BdbPortfolioDataQualityFlagSummary[];
  top_warnings: string[];
  local_only_notice: string;
}

export interface BdbPortfolioReport {
  portfolio_name: string;
  mode: BdbAssetDataSourceKind;
  summary: BdbManualPortfolioSummary;
  positions: BdbPortfolioReportPosition[];
  xray: BdbPortfolioXray;
  data_diagnostic: BdbPortfolioDataDiagnostic;
  warnings: string[];
}

export interface BdbPortfolioDraft {
  source: BdbAssetDataSourceKind;
  portfolio_id: string;
  base_currency: string;
  positions: BdbPortfolioPosition[];
  warnings: BdbAdapterWarning[];
}

export interface BdbOptimizationAsset {
  asset_id: string;
  display_name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  currency: string;
  is_investable: boolean;
  role: "INVESTABLE" | "BENCHMARK";
  metrics: BdbAssetMetrics;
  pms_exposure: BdbPmsExposure;
  quality_flags: BdbQualityFlag[];
  warnings: BdbAdapterWarning[];
}

export interface BdbOptimizationInput {
  portfolio_id: string;
  base_currency: string;
  assets: BdbOptimizationAsset[];
  positions: BdbPortfolioPosition[];
  warnings: BdbAdapterWarning[];
  source: BdbAssetDataSourceKind;
}

export type BdbOptimizationPreviewStatus = "PREVIEW_ONLY";

export interface BdbOptimizationPreviewAsset {
  asset_id: string;
  display_name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  weight_percent: number;
  metrics_available: string[];
  metrics_missing: string[];
  quality_warnings: string[];
}

export interface BdbOptimizationPreviewExcludedAsset {
  asset_id: string;
  display_name: string;
  weight_percent: number;
  reason: "NON_INVESTABLE_BENCHMARK" | "QUALITY_BLOCKED" | "INVALID_WEIGHT" | "MISSING_ASSET";
}

export interface BdbOptimizationPreview {
  status: BdbOptimizationPreviewStatus;
  sourceKind: BdbAssetDataSourceKind;
  metrics_boundary: BdbPreviewMetricsBoundary;
  total_weight_percent: number;
  validation_status: BdbPortfolioValidationStatus;
  eligible_assets: BdbOptimizationPreviewAsset[];
  excluded_assets: BdbOptimizationPreviewExcludedAsset[];
  quality_warnings: string[];
  metrics_available: string[];
  metrics_missing: string[];
  portfolio_warnings: string[];
  disclaimer: string;
}

export type BdbRiskProfileId =
  | "RISK_1"
  | "RISK_2"
  | "RISK_3"
  | "RISK_4"
  | "RISK_5"
  | "RISK_6"
  | "RISK_7"
  | "RISK_8"
  | "RISK_9"
  | "RISK_10";

export type BdbRiskProfilePreviewStatus = "PREVIEW_ONLY";

export interface BdbRiskProfileContract {
  risk_profile_id: BdbRiskProfileId;
  risk_profile_label: string;
  level: number;
  indicative_time_horizon: string;
  indicative_volatility_tolerance: string;
  informative_constraints: string[];
  status: BdbRiskProfilePreviewStatus;
}

export interface BdbRiskProfilePreviewExcludedAsset {
  asset_id: string;
  display_name: string;
  weight_percent: number;
  reason: "NON_INVESTABLE_BENCHMARK" | "QUALITY_BLOCKED" | "INVALID_WEIGHT" | "MISSING_ASSET";
}

export interface BdbRiskProfilePreview {
  status: BdbRiskProfilePreviewStatus;
  sourceKind: BdbAssetDataSourceKind;
  metrics_boundary: BdbPreviewMetricsBoundary;
  selected_profile: BdbRiskProfileContract;
  total_weight_percent: number;
  validation_status: BdbPortfolioValidationStatus;
  investable_position_count: number;
  excluded_assets: BdbRiskProfilePreviewExcludedAsset[];
  portfolio_metrics_available: string[];
  portfolio_metrics_missing: string[];
  data_warnings: string[];
  risk_signals: string[];
  serious_evaluation_notice: string;
  disclaimer: string;
}

