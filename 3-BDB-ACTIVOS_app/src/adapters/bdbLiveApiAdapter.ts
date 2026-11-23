/**
 * Adapter BBDD_LIVE_API: consume el backend (Cloud Functions callable) que lee la BD maestra
 * y devuelve asset-for-bdb.v1. Mapea ese contrato a los tipos internos de la app y reutiliza
 * `createPortfolioWorkspace` para las carteras (misma logica que las demas fuentes).
 *
 * Frontend SIN Firestore directo: todo va por las callable (con token de Auth automatico).
 */
import { historicalSelectionRestriction, warningsFromQualityFlags } from "../core/assetMapping";
import { esAccion } from "../core/esAccion";
import { sectoresDeLaCasa } from "../core/equitySectors";
import { MARCAS_QUE_NO_SON_AVISO } from "../core/labels";
import { createPortfolioWorkspace } from "../core/portfolioWorkspace";
import { normalizeOfficialBenchmark } from "../core/officialBenchmark";
import { normalizeProductProfile, normalizeSustainabilityProfile } from "../core/assetProductMetadata";
import { mapAssetHoldingsPayload } from "./assetHoldingsAdapter";
import type {
  BdbAssetDetail,
  BdbAssetCosts,
  BdbAssetDataSourceKind,
  BdbAssetHoldings,
  BdbAssetMetrics,
  BdbAssetPerformancePreview,
  BdbAssetSearchResult,
  BdbCoverageStatus,
  BdbFixedIncomeProfile,
  BdbOptimizationInput,
  BdbPmsExposure,
  BdbPortfolioDraft,
  BdbQualityFlag,
  ContextoDeLasMetricas,
  EconomicAssetClass,
  FuenteDeCoste,
  InstrumentType
} from "../types/bdbAssets";
import type { PortfolioInputOptions, SearchAssetsOptions } from "./bdbAssetsAdapter";
import type { AssetResolvePosition, AssetResolvedPosition } from "../types/assetDataSource";
import { callBackend } from "./callableBackend";
import { isNotFoundError, lecturaIncompleta, type ParteSinLeer } from "../core/appError";
import { appLogger } from "../core/appLogger";
import { registerSessionCache, sessionCacheEpoch } from "../core/sessionCaches";
import {
  parseLiveAssetDetailResponse,
  parseLiveComparePage,
  parseLiveResolvedPortfolio,
  parseReadWarnings,
  parseLiveSearchPageResponse,
  type RawAssetDetail,
  type RawClassification,
  type RawCosts,
  type RawFundProfile,
  type RawIdentity,
  type RawMetrics,
  type RawPerformancePreview,
  type RawPmsExposure,
  type RawProduct,
  type RawReadWarning,
  type RawResolvedPortfolioRow,
  type RawSearchItem,
  type RawSustainability
} from "./bdbLiveApiContracts";

const SOURCE: BdbAssetDataSourceKind = "BBDD_LIVE_API";

const ECON_CLASSES: EconomicAssetClass[] = [
  "EQUITY",
  "FIXED_INCOME",
  "MIXED",
  "MONEY_MARKET",
  "ALTERNATIVE",
  "REAL_ASSET",
  "COMMODITIES",
  "OTHER",
  "UNKNOWN"
];
const INSTRUMENT_TYPES: InstrumentType[] = ["FUND", "ETF", "STOCK", "INDEX"];
/* Las marcas que se conservan. Las cinco de la revisión del histórico que limitan la historia de un fondo están desde la decisión 120:
   antes se tiraban y el resumen las seguía contando, y Análisis decía «1 aviso» de Goldman sin decir cuál mientras el interno decía que no
   había ninguno. Las dos buenas noticias de esa revisión (`MARCAS_QUE_NO_SON_AVISO`) no están a propósito: no son un aviso. */
const QUALITY_FLAGS: BdbQualityFlag[] = [
  "NON_INVESTABLE_SUSPENDED", "NON_INVESTABLE_DELISTED", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS",
  "NON_INVESTABLE_CORPORATE_ACTION", "NON_INVESTABLE_NEVER_RESOLVED", "QUALITY_BLOCKED",
  "MOCK_DATA", "MISSING_HOLDINGS", "MISSING_HISTORY", "MISSING_QUANT_METRICS", "MISSING_METRICS",
  "PARTIAL_COVERAGE", "NON_INVESTABLE_BENCHMARK", "UNSUPPORTED_INSTRUMENT_TYPE", "MISSING_ASSET",
  "SUITABILITY_REVIEW_REQUIRED",
  "HISTORY_CONTINUITY_UNVERIFIED", "HISTORY_RESTRICTED_AFTER_REVIEW", "TOTAL_RETURN_UNVERIFIED", "HISTORY_SPLICED_SISTER_CLASS",
  "PRICE_FROZEN_DELISTED"
];
const COVERAGE_STATUSES: BdbCoverageStatus[] = ["COMPLETE", "PARTIAL", "ROOT_ONLY", "MISSING", "COMPLETE_LATER"];

function callFn(name: string, data: unknown): Promise<unknown> {
  return callBackend<unknown>(name, data, `No se pudo ejecutar ${name}.`);
}

/* 15-11-2026 (hallazgo 19). Si el servidor dice que no pudo leer una parte (`read_warnings`), la respuesta no se enseña
   como si estuviera completa ni se guarda en caché: un activo que no se leyó no es un activo que no existe, y unas
   métricas que no se leyeron no son «sin métricas». Se dice el fallo, que se arregla reintentando. Un servidor aún sin
   actualizar no manda avisos, y entonces todo sigue como antes. */
function exigirLecturaCompleta(avisos: RawReadWarning[]): void {
  if (avisos.length === 0) return;
  throw lecturaIncompleta(avisos.map((aviso) => aviso.part), [...new Set(avisos.flatMap((aviso) => aviso.asset_ids))]);
}

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

interface AssetDetailCacheEntry {
  promise: Promise<BdbAssetDetail | null>;
  result?: BdbAssetDetail;
  settled: boolean;
  timestamp: number;
}

function lruGet<T>(cache: Map<string, CacheEntry<T>>, key: string): Promise<T> | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.promise;
}

function lruSet<T>(cache: Map<string, CacheEntry<T>>, key: string, promise: Promise<T>, ttlMs: number, maxEntries: number): Promise<T> {
  cache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  promise.catch(() => cache.delete(key));
  return promise;
}

const comparableCache = new Map<string, CacheEntry<BdbAssetDetail[]>>();
const searchCache = new Map<string, CacheEntry<LiveApiSearchPage>>();
const holdingsCache = new Map<string, CacheEntry<BdbAssetHoldings | null>>();
const assetDetailCache = new Map<string, AssetDetailCacheEntry>();
const COMPARABLE_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 2 * 60 * 1000;
const HOLDINGS_TTL_MS = 10 * 60 * 1000;
const ASSET_DETAIL_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;
/* Ola 3b: la caché de holdings pasa de 20 a 50 entradas — 20 era menos que
   una cartera grande y la carga batch del X-Ray expulsaba sus propios ids. */
const MAX_HOLDINGS_CACHE_ENTRIES = 50;
const MAX_ASSET_DETAIL_CACHE_ENTRIES = 250;
// El backend rechaza `compare_assets` con más de 25 ids
// («Maximo 25 activos por peticion», INVALID_ARGUMENT). Con lotes de 100 toda
// petición de más de 25 activos devolvía 400 y se perdían los nombres.
const COMPARE_BATCH_SIZE = 25;

function normalizeAssetIds(assetIds: string[]): string[] {
  return [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function comparableCacheKey(assetIds: string[]): string {
  return normalizeAssetIds(assetIds).sort().join("|");
}

function touchAssetDetailCache(assetId: string, entry: AssetDetailCacheEntry): void {
  assetDetailCache.delete(assetId);
  assetDetailCache.set(assetId, entry);
}

function trimAssetDetailCache(): void {
  while (assetDetailCache.size > MAX_ASSET_DETAIL_CACHE_ENTRIES) {
    const completed = [...assetDetailCache.entries()].find(([, entry]) => entry.settled);
    if (!completed) return;
    assetDetailCache.delete(completed[0]);
  }
}

function getCachedAssetDetail(assetId: string): Promise<BdbAssetDetail | null> | null {
  const entry = assetDetailCache.get(assetId);
  if (!entry) return null;
  if (entry.settled && Date.now() - entry.timestamp > ASSET_DETAIL_TTL_MS) {
    assetDetailCache.delete(assetId);
    return null;
  }
  touchAssetDetailCache(assetId, entry);
  return entry.promise;
}

function cacheAssetDetailPromise(
  assetId: string,
  source: Promise<BdbAssetDetail | null>
): Promise<BdbAssetDetail | null> {
  const entry: AssetDetailCacheEntry = {
    promise: Promise.resolve(null),
    settled: false,
    timestamp: Date.now()
  };
  entry.promise = source.then(
    (result) => {
      if (!result) {
        if (assetDetailCache.get(assetId) === entry) assetDetailCache.delete(assetId);
        return null;
      }
      entry.result = result;
      entry.settled = true;
      entry.timestamp = Date.now();
      if (assetDetailCache.get(assetId) === entry) {
        touchAssetDetailCache(assetId, entry);
        trimAssetDetailCache();
      }
      return result;
    },
    (error: unknown) => {
      if (assetDetailCache.get(assetId) === entry) assetDetailCache.delete(assetId);
      throw error;
    }
  );
  assetDetailCache.set(assetId, entry);
  trimAssetDetailCache();
  return entry.promise;
}

function seedAssetDetailCache(detail: BdbAssetDetail): void {
  if (getCachedAssetDetail(detail.asset_id)) return;
  const entry: AssetDetailCacheEntry = {
    promise: Promise.resolve(detail),
    result: detail,
    settled: true,
    timestamp: Date.now()
  };
  assetDetailCache.set(detail.asset_id, entry);
  trimAssetDetailCache();
}

/** Invalida las lecturas live compartidas tras una escritura administrativa o entre tests. */
export function invalidateLiveAssetCaches(assetIds?: string[]): void {
  comparableCache.clear();
  searchCache.clear();
  if (!assetIds) {
    assetDetailCache.clear();
    holdingsCache.clear();
    return;
  }
  for (const assetId of normalizeAssetIds(assetIds)) {
    assetDetailCache.delete(assetId);
    holdingsCache.delete(assetId);
  }
}

/* ALTA-21 (auditoría 14-10-2026): las lecturas en memoria no sobreviven a la
   sesión que las cargó. Cerrar sesión o cambiar de usuario (AuthGate →
   clearSessionCaches) vacía fichas, búsquedas, comparables y posiciones
   subyacentes, como ya hacían la frontera, el horizonte y las retrocesiones. */
registerSessionCache(() => invalidateLiveAssetCaches());

function searchCacheKey(options: SearchAssetsOptions): string {
  const query = (options.query ?? "").trim().toLocaleLowerCase("es-ES");
  const types = [...(options.instrumentTypes ?? [])].sort().join(",");
  return `${query}|${types}|${options.limit ?? 200}|${options.cursor ?? ""}`;
}

function mapEconClass(value: unknown): EconomicAssetClass {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ECON_CLASSES.includes(raw as EconomicAssetClass) ? (raw as EconomicAssetClass) : "OTHER";
}

function mapInstrumentType(value: unknown): InstrumentType {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (INSTRUMENT_TYPES.includes(raw as InstrumentType)) {
    return raw as InstrumentType;
  }
  return "FUND";
}

function isUnsupportedInstrumentType(value: unknown): boolean {
  return !INSTRUMENT_TYPES.includes(value as InstrumentType);
}

function mapCoverageStatus(value: unknown): BdbCoverageStatus {
  return COVERAGE_STATUSES.includes(value as BdbCoverageStatus) ? (value as BdbCoverageStatus) : "PARTIAL";
}

function mapRole(value: unknown, instrumentType: InstrumentType): "INVESTABLE" | "BENCHMARK" {
  if (value === "BENCHMARK" || instrumentType === "INDEX") {
    return "BENCHMARK";
  }
  return "INVESTABLE";
}

function mapInvestable(value: unknown, role: "INVESTABLE" | "BENCHMARK", instrumentType: InstrumentType): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return role === "INVESTABLE" && instrumentType !== "INDEX";
}

function mapQualityFlags(flags: unknown, options: { unsupportedInstrument?: boolean; tipo?: InstrumentType } = {}): BdbQualityFlag[] {
  const out: BdbQualityFlag[] = [];
  for (const raw of Array.isArray(flags) ? flags : []) {
    const mapped = raw === "MISSING_METRICS" ? "MISSING_QUANT_METRICS" : raw;
    /* A una acción no le aplica publicar cartera (decisiones 10 y 17): el servidor la marca igual, y aquí deja de ser un aviso. */
    if (mapped === "MISSING_HOLDINGS" && esAccion(options.tipo)) continue;
    if (QUALITY_FLAGS.includes(mapped as BdbQualityFlag)) {
      out.push(mapped as BdbQualityFlag);
    }
  }
  if (options.unsupportedInstrument) {
    out.push("UNSUPPORTED_INSTRUMENT_TYPE", "PARTIAL_COVERAGE");
  }
  return [...new Set(out)];
}

/**
 * El servidor cuenta un aviso por cada marca. Lo que no es un aviso se quita de la lista y de la cuenta a la vez: a una acción, la cartera
 * que no le aplica publicar (decisiones 10 y 17); a cualquiera, las dos buenas noticias de la revisión del histórico (decisión 120).
 */
function resumenDeCalidad(resumen: RawAssetDetail["data_quality_summary"], tipo: InstrumentType): BdbAssetDetail["data_quality_summary"] {
  if (!resumen) return undefined;
  if (typeof resumen === "string") return resumen;
  const noEsAviso = (marca: string) => MARCAS_QUE_NO_SON_AVISO.has(marca) || (marca === "MISSING_HOLDINGS" && esAccion(tipo));
  const quitadas = (resumen.quality_flags ?? []).filter(noEsAviso).length;
  if (quitadas === 0) return resumen;
  return { ...resumen, quality_flags: resumen.quality_flags.filter((marca) => !noEsAviso(marca)), warnings_count: Math.max(0, resumen.warnings_count - quitadas) };
}

/** Lo que el servidor dice del coste de un activo, con la fuente de cada cifra. Una fuente que no sea una de las dos no se cree. */
function costesDelActivo(costes: RawCosts | null | undefined): BdbAssetCosts | undefined {
  if (!costes) return undefined;
  const fuente = (valor: string | undefined): FuenteDeCoste | undefined => (valor === "KID" || valor === "PROVIDER" ? valor : undefined);
  return {
    ongoing_charge: costes.ongoing_charge,
    management_fee: costes.management_fee,
    transaction_costs: costes.transaction_costs,
    entry_charge: costes.entry_charge,
    document_url: costes.document_url,
    document_date: costes.document_date,
    ongoing_charge_source: fuente(costes.ongoing_charge_source),
    transaction_costs_source: fuente(costes.transaction_costs_source),
    entry_charge_source: fuente(costes.entry_charge_source)
  };
}

function mapMetrics(m?: RawMetrics | null): BdbAssetMetrics {
  const x = m ?? {};
  const hist =
    typeof x.max_drawdown_hist === "number"
      ? { value: x.max_drawdown_hist, date: x.max_drawdown_hist_date }
      : x.max_drawdown_hist;
  return {
    risk_score: x.risk_score,
    risk_score_source: x.risk_score_source,
    metrics_source: x.metrics_source,
    metrics_method: x.metrics_method,
    metrics_frequency: x.metrics_frequency,
    metrics_by_window: x.metrics_by_window,
    ytd_return: x.ytd_return,
    volatility_3y: x.volatility_3y,
    volatility_1y: x.volatility_1y,
    volatility_5y: x.volatility_5y,
    volatility_10y: x.volatility_10y,
    annualized_return_3y: x.annualized_return_3y,
    annualized_return_1y: x.annualized_return_1y,
    annualized_return_5y: x.annualized_return_5y,
    annualized_return_10y: x.annualized_return_10y,
    sharpe_1y: x.sharpe_1y,
    sharpe_3y: x.sharpe_3y,
    sharpe_5y: x.sharpe_5y,
    sharpe_10y: x.sharpe_10y,
    max_drawdown_5y: x.max_drawdown_5y,
    max_drawdown_hist: hist,
    /* Hallazgo 16: de cuándo son y qué miden. Un servidor anterior al 15-11-2026 no lo manda, y todo queda vacío. */
    ...contextoDe(x)
  };
}

function contextoDe(x: RawMetrics): ContextoDeLasMetricas {
  const contexto: ContextoDeLasMetricas = {
    as_of: x.as_of,
    returns_as_of: x.returns_as_of,
    returns_as_of_by_window: x.returns_as_of_by_window,
    return_basis: x.return_basis,
    series_class: x.series_class,
    distribution_policy: x.distribution_policy,
    windows_out_of_range: x.windows_out_of_range,
    provider: x.provider
  };
  return Object.fromEntries(Object.entries(contexto).filter(([, valor]) => valor !== undefined)) as ContextoDeLasMetricas;
}

function mapPerformancePreview(preview?: RawPerformancePreview | null): BdbAssetPerformancePreview | undefined {
  if (!preview) return undefined;
  const metrics = mapMetrics(preview);
  return {
    available: preview.available,
    ytd_return: metrics.ytd_return,
    annualized_return_1y: metrics.annualized_return_1y,
    annualized_return_3y: metrics.annualized_return_3y,
    annualized_return_5y: metrics.annualized_return_5y,
    annualized_return_10y: metrics.annualized_return_10y,
    volatility_1y: metrics.volatility_1y,
    volatility_3y: metrics.volatility_3y,
    volatility_5y: metrics.volatility_5y,
    volatility_10y: metrics.volatility_10y,
    sharpe_1y: metrics.sharpe_1y,
    sharpe_3y: metrics.sharpe_3y,
    sharpe_5y: metrics.sharpe_5y,
    sharpe_10y: metrics.sharpe_10y,
    max_drawdown_5y: metrics.max_drawdown_5y,
    max_drawdown_hist: metrics.max_drawdown_hist,
    risk_score: metrics.risk_score,
    risk_score_source: metrics.risk_score_source,
    latest_value: preview.latest_value,
    latest_value_date: preview.latest_value_date,
    latest_value_currency: preview.latest_value_currency,
    source: preview.source,
    data_quality: preview.data_quality
  };
}

/** Perfil de RF del readmodel: el contrato ya lo entrega en fracción; sin dato -> ausente. */
function mapFixedIncomeProfile(profile?: BdbFixedIncomeProfile | null): BdbFixedIncomeProfile | undefined {
  if (!profile) return undefined;
  const bondTypes = profile.bond_types
    ? Object.fromEntries(Object.entries(profile.bond_types).filter(([, weight]) => weight > 0))
    : undefined;
  const mapped: BdbFixedIncomeProfile = {
    ...profile,
    bond_types: bondTypes && Object.keys(bondTypes).length ? bondTypes : undefined
  };
  const entries = Object.entries(mapped).filter(([, item]) => item !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function mapPms(pe?: RawPmsExposure | null): BdbPmsExposure {
  if (!pe) {
    /* Ola A1 (A1.2). Sin vector PMS del backend, el vector va VACÍO (suma 0):
       así `computePmsExposureDistribution` (portfolio.ts, regla 2) reparte el
       peso por la clase económica del activo. El antiguo `{ other: 1 }` se
       hacía pasar por vector real: un fondo de renta variable sin cartera
       publicada salía como 100 % «Otros» y la cobertura marcaba 100 %. */
    return { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 };
  }
  return {
    equity: pe.equity ?? 0,
    fixed_income: pe.fixed_income ?? 0,
    cash: pe.cash ?? 0,
    alternative: pe.alternative ?? 0,
    real_asset: pe.real_asset ?? 0,
    other: pe.other ?? 0,
    source: pe.source
  };
}

function finalizeDetail(base: BdbAssetDetail): BdbAssetDetail {
  return {
    ...base,
    is_investable: base.is_investable && !historicalSelectionRestriction(base),
    warnings: warningsFromQualityFlags(base)
  };
}

function benchmarkFromRaw(c: {
  official_benchmark?: unknown;
  benchmark?: unknown;
  reference_index?: unknown;
  index_id?: unknown;
  identity?: RawIdentity;
  product?: RawProduct | null;
  profile?: RawFundProfile | null;
  fund_profile?: RawFundProfile | null;
  sustainability?: RawSustainability | null;
  classification?: RawClassification | null;
}) {
  return (
    normalizeOfficialBenchmark(c.official_benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.product?.official_benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.product?.benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.product?.reference_index, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.classification?.official_benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.classification?.benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.classification?.reference_index, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.identity?.benchmark, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.reference_index, "BBDD_ACTIVOS") ??
    normalizeOfficialBenchmark(c.index_id, "BBDD_ACTIVOS")
  );
}

/** Detalle del contrato (AssetDetailForBdb) -> BdbAssetDetail interno. */
function mapDetail(c: RawAssetDetail): BdbAssetDetail {
  const id: RawIdentity = c.identity ?? {};
  const instrumentType = mapInstrumentType(c.instrument_type);
  const role = mapRole(c.role, instrumentType);
  const metrics = mapMetrics(c.metrics);
  const qualityFlags = mapQualityFlags(c.quality_flags, {
    unsupportedInstrument: isUnsupportedInstrumentType(c.instrument_type),
    tipo: instrumentType
  });
  const base: BdbAssetDetail = {
    asset_id: c.asset_id,
    updated_at: c.updated_at,
    display_name: id.display_name || c.asset_id,
    instrument_type: instrumentType,
    economic_asset_class: mapEconClass(c.economic_asset_class),
    isin: id.isin || undefined,
    ticker: id.ticker || undefined,
    provider: c.product?.provider,
    /* El «EUR» de relleno, medido el 20-11-2026 y dejado a propósito. La base nueva (la de producción) no tiene ningún
       instrumento sin divisa (0 de 1.334, raíz y tarjeta); la vieja, que lee el desarrollo local, uno, ES0132526031
       (Oportunidad Bursátil SICAV), que en la nueva es EUR. Quitarlo dejaría sin divisa a lectores que no saben decir
       «Falta el dato»: la ficha antigua (`AssetDetail`, una casilla en blanco), el cambio de fondo (`FundSwapModal`,
       «undefined → USD») y tres informes en PDF —el interno escribe «· » sin divisa, el comparador de carteras la llama
       «Sin clasificar» y el de cliente la deja vacía—, que no se tocan sin decisión de Óscar. Vale para los tres
       rellenos de este fichero (búsqueda, ficha y cartera resuelta). */
    currency: id.currency || "EUR",
    region: id.region || c.classification?.region_primary || c.classification?.region || undefined,
    category: c.category || c.classification?.category || undefined,
    sector: c.classification?.sector || c.classification?.gics_sector || c.classification?.industry || undefined,
    strategy: c.classification?.strategy || undefined,
    coverage_status: mapCoverageStatus(c.coverage_status),
    is_investable: mapInvestable(c.is_investable, role, instrumentType),
    role,
    quality_flags: qualityFlags,
    warnings: [],
    metrics,
    morningstar_rating: c.classification?.morningstar_rating,
    official_benchmark: benchmarkFromRaw(c),
    product_profile: normalizeProductProfile(c.product, c.fund_profile, c.profile),
    sustainability_profile: normalizeSustainabilityProfile(c.sustainability),
    description: `${id.display_name || c.asset_id} (datos en vivo de BBDD-ACTIVOS).`,
    costs: costesDelActivo(c.costs),
    pms_exposure: mapPms(c.pms_exposure),
    holdings_summary: c.holdings_summary,
    exposure_detail: c.exposure_detail
      ? {
          sectors: sectoresDeLaCasa(c.exposure_detail.sectors),
          equity_styles: c.exposure_detail.equity_styles ?? undefined,
          equity_regions: c.exposure_detail.equity_regions ?? undefined,
          market_caps: c.exposure_detail.market_caps ?? undefined,
          equity_style_box: c.exposure_detail.equity_style_box ?? undefined,
          confidence: c.exposure_detail.confidence ?? undefined
        }
      : undefined,
    fixed_income_profile: mapFixedIncomeProfile(c.fixed_income_profile),
    available_sections: Array.isArray(c.available_sections) ? [...c.available_sections] : undefined,
    fundamentals_summary: c.fundamentals_summary ?? undefined,
    performance_preview: c.performance_preview
      ? mapPerformancePreview(c.performance_preview)
      : c.metrics
        ? {
            available: true,
            ytd_return: metrics.ytd_return,
            annualized_return_1y: metrics.annualized_return_1y,
            annualized_return_3y: metrics.annualized_return_3y,
            annualized_return_5y: metrics.annualized_return_5y,
            annualized_return_10y: metrics.annualized_return_10y,
            volatility_1y: metrics.volatility_1y,
            volatility_3y: metrics.volatility_3y,
            volatility_5y: metrics.volatility_5y,
            volatility_10y: metrics.volatility_10y,
            sharpe_1y: metrics.sharpe_1y,
            sharpe_3y: metrics.sharpe_3y,
            sharpe_5y: metrics.sharpe_5y,
            sharpe_10y: metrics.sharpe_10y,
            max_drawdown_5y: metrics.max_drawdown_5y,
            max_drawdown_hist: metrics.max_drawdown_hist,
            risk_score: metrics.risk_score,
            risk_score_source: metrics.risk_score_source
          }
        : undefined,
    data_quality_summary: resumenDeCalidad(c.data_quality_summary, instrumentType)
  };
  return finalizeDetail(base);
}

/** Resultado de busqueda del contrato -> BdbAssetSearchResult interno. */
function mapSearch(c: RawSearchItem): BdbAssetSearchResult {
  const instrumentType = mapInstrumentType(c.instrument_type);
  const role = mapRole(c.role, instrumentType);
  const base: BdbAssetSearchResult = {
    asset_id: c.asset_id,
    display_name: c.display_name || c.asset_id,
    instrument_type: instrumentType,
    economic_asset_class: mapEconClass(c.economic_asset_class),
    isin: c.isin || undefined,
    ticker: c.ticker || undefined,
    provider: c.provider || c.product?.provider,
    currency: c.currency || "EUR", // Relleno dejado a propósito: ver `mapDetail`.
    region: c.region || undefined,
    category: c.category || undefined,
    sector: c.sector || undefined,
    strategy: c.strategy || undefined,
    coverage_status: mapCoverageStatus(c.coverage_status),
    is_investable: mapInvestable(c.is_investable, role, instrumentType),
    role,
    quality_flags: mapQualityFlags(c.quality_flags, {
      unsupportedInstrument: isUnsupportedInstrumentType(c.instrument_type),
      tipo: instrumentType
    }),
    warnings: [],
    metrics: mapMetrics(c.metrics),
    morningstar_rating: c.morningstar_rating,
    official_benchmark: benchmarkFromRaw(c)
  };
  return {
    ...base,
    is_investable: base.is_investable && !historicalSelectionRestriction(base),
    warnings: warningsFromQualityFlags(base)
  };
}

export interface LiveApiSearchPage {
  results: BdbAssetSearchResult[];
  /** Total real de coincidencias en el universo; null si el backend no lo conoce. */
  totalMatches: number | null;
  /** Cursor para pedir la página siguiente; null cuando no quedan más. */
  nextCursor: string | null;
}

export async function searchLiveApiAssetsPage(options: SearchAssetsOptions = {}): Promise<LiveApiSearchPage> {
  const normalizedOptions = { ...options, limit: options.limit ?? 200 };
  const key = searchCacheKey(normalizedOptions);
  const cached = lruGet(searchCache, key);
  if (cached) {
    return cached;
  }
  return lruSet(
    searchCache,
    key,
    callFn("search_assets", {
      query: normalizedOptions.query ?? "",
      types: normalizedOptions.instrumentTypes,
      limit: normalizedOptions.limit,
      ...(normalizedOptions.cursor ? { cursor: normalizedOptions.cursor } : {})
    }).then(parseLiveSearchPageResponse).then((page) => {
      exigirLecturaCompleta(page.read_warnings);
      return page;
    }).then((page) => ({
      results: page.assets.map(mapSearch),
      totalMatches: page.total_matches,
      nextCursor: page.next_cursor
    })),
    SEARCH_TTL_MS,
    MAX_CACHE_ENTRIES
  );
}

export async function searchLiveApiAssets(options: SearchAssetsOptions = {}): Promise<BdbAssetSearchResult[]> {
  return (await searchLiveApiAssetsPage(options)).results;
}

export async function getLiveApiAssetDetail(assetId: string): Promise<BdbAssetDetail | null> {
  const key = assetId.trim();
  if (!key) return null;
  const cached = getCachedAssetDetail(key);
  if (cached) return cached;
  return cacheAssetDetailPromise(
    key,
    callFn("get_asset_detail", { asset_id: key })
      .then((res) => {
        exigirLecturaCompleta(parseReadWarnings((res as { read_warnings?: unknown } | null)?.read_warnings));
        return parseLiveAssetDetailResponse(res);
      })
      .then((res) => (res ? mapDetail(res) : null))
      /* 04-09-2026: el backend responde NOT_FOUND cuando el id no está en la
         maestra, y eso llegaba aquí como excepción pese a que el contrato de
         este método es devolver null. Un solo ISIN ausente tumbaba la
         importación entera de una cartera. */
      .catch((error: unknown) => {
        if (isNotFoundError(error)) return null;
        throw error;
      })
  );
}

export async function getLiveApiAssetHoldings(assetId: string): Promise<BdbAssetHoldings | null> {
  const key = assetId.trim();
  if (!key) {
    return null;
  }
  const cached = lruGet(holdingsCache, key);
  if (cached) {
    return cached;
  }
  return lruSet(
    holdingsCache,
    key,
    callFn("get_asset_holdings", { asset_id: key }).then((res) => mapAssetHoldingsPayload(key, res)),
    HOLDINGS_TTL_MS,
    MAX_HOLDINGS_CACHE_ENTRIES
  );
}

interface RawHoldingsBatchResponse {
  holdings?: Record<string, unknown>;
  read_warnings?: unknown;
}

/**
 * Ola 3b: holdings de hasta n activos en UNA llamada (`get_asset_holdings_batch`,
 * troceada a 25 como `compare_assets`). El abanico de 10 llamadas simultáneas
 * del X-Ray provocaba cola y arranques en frío en Cloud Run (~7 s hasta
 * pantalla utilizable, medido en producción el 11-08). Comparte la caché por
 * activo con la vía unitaria: los ids ya cacheados no viajan.
 */
export async function getLiveApiAssetHoldingsMany(
  assetIds: string[]
): Promise<Map<string, BdbAssetHoldings | null>> {
  const requestedIds = normalizeAssetIds(assetIds);
  const out = new Map<string, BdbAssetHoldings | null>();
  if (requestedIds.length === 0) {
    return out;
  }

  const pending = new Map<string, Promise<BdbAssetHoldings | null>>();
  const missingIds: string[] = [];
  for (const assetId of requestedIds) {
    const cached = lruGet(holdingsCache, assetId);
    if (cached) {
      pending.set(assetId, cached);
    } else {
      missingIds.push(assetId);
    }
  }

  if (missingIds.length > 0) {
    const batchById = Promise.all(
      chunks(missingIds, COMPARE_BATCH_SIZE).map((batchIds) =>
        callFn("get_asset_holdings_batch", { asset_ids: batchIds }).then((res) => {
          const payload = (res ?? {}) as RawHoldingsBatchResponse;
          // Unas posiciones que no se pudieron leer no son un fondo sin posiciones.
          exigirLecturaCompleta(parseReadWarnings(payload.read_warnings));
          const rows = payload.holdings && typeof payload.holdings === "object" ? payload.holdings : {};
          return batchIds.map((assetId) => {
            // El mapper valida por elemento que payload.asset_id === assetId
            // (misma garantía anti-cruce que la vía unitaria).
            const raw = (rows as Record<string, unknown>)[assetId] ?? null;
            return [assetId, raw === null ? null : mapAssetHoldingsPayload(assetId, raw)] as const;
          });
        })
      )
    ).then((batches) => new Map(batches.flat()));

    for (const assetId of missingIds) {
      pending.set(
        assetId,
        lruSet(
          holdingsCache,
          assetId,
          batchById.then((byId) => byId.get(assetId) ?? null),
          HOLDINGS_TTL_MS,
          MAX_HOLDINGS_CACHE_ENTRIES
        )
      );
    }
  }

  await Promise.all(
    requestedIds.map(async (assetId) => {
      out.set(assetId, (await pending.get(assetId)) ?? null);
    })
  );
  return out;
}

export async function getLiveApiComparableAssets(assetIds: string[]): Promise<BdbAssetDetail[]> {
  const epoch = sessionCacheEpoch();
  const requestedIds = normalizeAssetIds(assetIds);
  const key = comparableCacheKey(requestedIds);
  if (!key) {
    return [];
  }
  const canonicalIds = key.split("|");
  let canonicalPromise = lruGet(comparableCache, key);
  if (!canonicalPromise) {
    const detailPromises = new Map<string, Promise<BdbAssetDetail | null>>();
    const missingIds: string[] = [];
    for (const assetId of canonicalIds) {
      const detail = getCachedAssetDetail(assetId);
      if (detail) detailPromises.set(assetId, detail);
      else missingIds.push(assetId);
    }

    if (missingIds.length > 0) {
      const batchById = Promise.all(
        chunks(missingIds, COMPARE_BATCH_SIZE).map((batchIds) =>
          callFn("compare_assets", { asset_ids: batchIds }).then((res) => {
            const page = parseLiveComparePage(res);
            exigirLecturaCompleta(page.read_warnings);
            return page.assets;
          })
        )
      ).then((batches) => new Map(batches.flat().map((asset) => {
        const detail = mapDetail(asset);
        return [detail.asset_id, detail] as const;
      })));
      for (const assetId of missingIds) {
        detailPromises.set(
          assetId,
          cacheAssetDetailPromise(assetId, batchById.then((byId) => byId.get(assetId) ?? null))
        );
      }
    }

    canonicalPromise = Promise.all(
      canonicalIds.map((assetId) => detailPromises.get(assetId) ?? Promise.resolve(null))
    ).then((assets) => assets.filter((asset): asset is BdbAssetDetail => asset !== null));
    lruSet(comparableCache, key, canonicalPromise, COMPARABLE_TTL_MS, MAX_CACHE_ENTRIES);
  }

  const canonicalAssets = await canonicalPromise;
  // Una respuesta que llega después de cerrar sesión no repuebla la caché de fichas.
  if (epoch === sessionCacheEpoch()) canonicalAssets.forEach(seedAssetDetailCache);
  const byId = new Map(canonicalAssets.map((asset) => [asset.asset_id, asset]));
  return requestedIds.flatMap((assetId) => {
    const asset = byId.get(assetId);
    return asset ? [asset] : [];
  });
}

function mapResolvedRow(row: RawResolvedPortfolioRow): BdbAssetDetail {
  const instrumentType = mapInstrumentType(row.instrument_type);
  const role = mapRole(row.role, instrumentType);
  const qualityFlags = mapQualityFlags(row.quality_flags, {
    unsupportedInstrument: isUnsupportedInstrumentType(row.instrument_type),
    tipo: instrumentType
  });
  return finalizeDetail({
    asset_id: row.asset_id,
    display_name: row.display_name || row.asset_id,
    instrument_type: instrumentType,
    economic_asset_class: mapEconClass(row.economic_asset_class),
    currency: row.currency || "EUR", // Relleno dejado a propósito: ver `mapDetail`.
    region: row.region,
    category: row.category,
    sector: row.sector,
    coverage_status: mapCoverageStatus(row.coverage_status),
    /* Un activo con restricción conserva su importe en la cartera, pero no
       es seleccionable aunque el backend no lo diga en `is_investable`. */
    is_investable:
      role === "INVESTABLE" &&
      mapInvestable(row.is_investable, role, instrumentType) &&
      !historicalSelectionRestriction({ quality_flags: qualityFlags }),
    role,
    quality_flags: qualityFlags,
    warnings: [],
    metrics: mapMetrics(row.metrics),
    costs: costesDelActivo(row.costs),
    pms_exposure: mapPms(row.pms_exposure),
    description: `${row.display_name || row.asset_id} (resuelto por cartera).`
  });
}

/* `resolve_portfolio` admite 200 posiciones por petición y 30 peticiones por
   minuto: las cargas grandes van en lotes espaciados. */
const RESOLVE_BATCH_SIZE = 200;
const RESOLVE_BATCH_SPACING_MS = 2100;

/**
 * Resolución de una cartera contra la maestra. MEDIA-11 (auditoría 14-10-2026):
 * es la ÚNICA implementación de `resolve_portfolio`; el Extracto externo la usa
 * como `resolvePortfolioBatch` y el catálogo del comparador a través de la
 * fuente en vivo. Antes había dos copias que ya divergían.
 *
 * CRIT-02.3: cada fila se casa con la posición por el id PEDIDO. Un ISIN
 * sustituido se resuelve al sucesor: `asset_id` trae el canónico y
 * `requested_asset_id` el que mandó la pantalla (readmodel/repository.py).
 */
export async function resolveLiveApiPortfolioPositions(
  positions: AssetResolvePosition[]
): Promise<AssetResolvedPosition[]> {
  if (positions.length === 0) {
    return [];
  }
  const byRequestedId = new Map<string, BdbAssetDetail>();
  // 15-11-2026 (hallazgo 19): lo que el servidor no pudo leer de cada posición pedida, para no darla por inexistente.
  const sinLeerPorId = new Map<string, Set<ParteSinLeer>>();
  for (let offset = 0; offset < positions.length; offset += RESOLVE_BATCH_SIZE) {
    if (offset > 0) await new Promise<void>((resolve) => setTimeout(resolve, RESOLVE_BATCH_SPACING_MS));
    const response = parseLiveResolvedPortfolio(
      await callBackend<unknown>(
        "resolve_portfolio",
        {
          positions: positions.slice(offset, offset + RESOLVE_BATCH_SIZE).map((position) => ({
            asset_id: position.asset_id,
            weight: position.amount
          }))
        },
        "No se pudo resolver la cartera."
      )
    );
    for (const row of response.rows) {
      byRequestedId.set(row.requested_asset_id ?? row.asset_id, mapResolvedRow(row));
    }
    for (const aviso of parseReadWarnings(response.warnings)) {
      for (const assetId of aviso.asset_ids) {
        sinLeerPorId.set(assetId, (sinLeerPorId.get(assetId) ?? new Set<ParteSinLeer>()).add(aviso.part));
      }
    }
    if (response.discarded_rows.length > 0) {
      // La posición de una fila descartada queda sin activo; el resto se carga.
      appLogger.warn(
        `resolve_portfolio: ${response.discarded_rows.length === 1 ? "1 fila descartada" : `${response.discarded_rows.length} filas descartadas`} por no cumplir el contrato; el resto se carga`,
        response.discarded_rows
      );
    }
  }
  return positions.map((position) => {
    const sinLeer = sinLeerPorId.get(position.asset_id);
    return {
      id: position.asset_id,
      amount: position.amount,
      asset: byRequestedId.get(position.asset_id) ?? null,
      ...(sinLeer ? { sinLeer: [...sinLeer] } : {})
    };
  });
}

/** Para el workspace (posiciones por defecto): trae una lista via search y la mapea a detalle minimo. */
async function getLiveApiAssets(): Promise<BdbAssetDetail[]> {
  const assets = await searchLiveApiAssets({ query: "", limit: 200 });
  return assets.map((c) =>
    mapDetail({
      asset_id: c.asset_id,
      instrument_type: c.instrument_type,
      economic_asset_class: c.economic_asset_class,
      identity: { display_name: c.display_name, isin: c.isin, ticker: c.ticker, currency: c.currency },
      coverage_status: c.coverage_status,
      is_investable: c.is_investable,
      role: c.role,
      quality_flags: c.quality_flags,
      metrics: c.metrics,
      classification: { category: c.category, region: c.region, sector: c.sector, strategy: c.strategy },
      official_benchmark: c.official_benchmark,
      pms_exposure: null
    })
  );
}

const liveApiWorkspace = createPortfolioWorkspace({
  source: SOURCE,
  defaultPortfolioId: "live-api-portfolio",
  manualPortfolioId: "live-api-manual-portfolio",
  defaultPortfolioName: "Cartera sin nombre",
  getAssets: getLiveApiAssets,
  getComparableAssets: getLiveApiComparableAssets
});

export const getLiveApiPortfolioInputs: (
  options?: PortfolioInputOptions
) => Promise<BdbPortfolioDraft> = liveApiWorkspace.getPortfolioInputs;
export const buildLiveApiOptimizationInput: (
  options?: PortfolioInputOptions
) => Promise<BdbOptimizationInput> = liveApiWorkspace.buildOptimizationInput;
export const buildLiveApiManualPortfolioSummary = liveApiWorkspace.buildManualPortfolioSummary;
export const buildLiveApiManualPortfolioOptimizationPreview = liveApiWorkspace.buildManualPortfolioOptimizationPreview;
export const buildLiveApiManualPortfolioReport = liveApiWorkspace.buildManualPortfolioReport;

export const bdbLiveApiAdapterTestHelpers = {
  mapDetail,
  mapSearch,
  invalidateLiveAssetCaches,
  assetDetailCacheSize: () => assetDetailCache.size
};
