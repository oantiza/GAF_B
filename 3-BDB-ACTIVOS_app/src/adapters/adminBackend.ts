/** Contratos validados para las callables del Panel Admin. */
import { AppError } from "../core/appError";
import { fecha, numero, oFalta, periodo } from "../core/formato";
import type {
  AdminAnomalies,
  AdminAssetDetail,
  AdminAssetRow,
  AdminAssetsPage,
  AdminBackfillAssetResult,
  AdminBackfillBatchResult,
  AdminBackfillCandidate,
  AdminBackfillCandidatesResult,
  AdminDbStatus,
  AdminDrawdown,
  AdminIngestAssetHistory,
  AdminIngestAssetResult,
  AdminLaggedAsset,
  AdminMetricsPresent,
  AdminRecomputeMetricResult,
  AdminRefreshAllStaleResult,
  AdminRefreshAssetPricesResult,
  AdminRefreshSampleItem,
  AdminSeriesAnalysis
} from "../types/admin";
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireBoolean,
  requireNullableNumber,
  requireNullableString,
  requireNumber,
  requireObject,
  requireOptionalBoolean,
  requireOptionalString,
  requireString,
  requireStringArray
} from "./contractGuards";

const LONG_CALL_OPTIONS = { timeout: 540_000 } as const;

async function invalidatePublicReadCaches(assetIds?: string[]): Promise<void> {
  const [{ invalidateLiveAssetCaches }, { invalidateFrontierCache }] = await Promise.all([
    import("./bdbLiveApiAdapter"),
    import("./optimizePortfolioBackend")
  ]);
  invalidateLiveAssetCaches(assetIds);
  invalidateFrontierCache();
}

function fail(field: string, message: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: ${message}.`);
}

function nonEmptyString(value: unknown, field: string): string {
  const parsed = requireString(value, field).trim();
  if (!parsed) fail(field, "texto vacío");
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = requireNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0) fail(field, "entero no negativo esperado");
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value, field);
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  return requireNullableString(value, field);
}

function dateLike(value: unknown, field: string): string {
  const parsed = requireString(value, field);
  if (!parsed || Number.isNaN(Date.parse(parsed))) fail(field, "fecha no valida");
  return parsed;
}

function optionalNullableDate(value: unknown, field: string): string | null | undefined {
  const parsed = optionalNullableString(value, field);
  return parsed === null || parsed === undefined ? parsed : dateLike(parsed, field);
}

function numberRecord(value: unknown, field: string): Record<string, number> {
  const raw = requireObject(value, field);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(raw)) {
    result[key] = nonNegativeInteger(item, `${field}.${key}`);
  }
  return result;
}

function dateRecord(value: unknown, field: string): Record<string, string> {
  const raw = requireObject(value, field);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(raw)) {
    result[key] = dateLike(item, `${field}.${key}`);
  }
  return result;
}

function sumRecord(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

export function parseAdminAssetRow(raw: unknown, field = "asset"): AdminAssetRow {
  const row = requireObject(raw, field);
  const years = row.years === undefined ? null : requireNullableNumber(row.years, `${field}.years`);
  if (years !== null && (!Number.isInteger(years) || years < 0)) fail(`${field}.years`, "entero no negativo esperado");
  return {
    asset_id: nonEmptyString(row.asset_id, `${field}.asset_id`),
    name: requireString(row.name, `${field}.name`),
    type: nonEmptyString(row.type, `${field}.type`),
    symbol: requireNullableString(row.symbol, `${field}.symbol`),
    currency: requireNullableString(row.currency, `${field}.currency`),
    first_date: optionalNullableDate(row.first_date, `${field}.first_date`) ?? null,
    last_date: optionalNullableDate(row.last_date, `${field}.last_date`) ?? null,
    points: nonNegativeInteger(row.points, `${field}.points`),
    year_docs: nonNegativeInteger(row.year_docs, `${field}.year_docs`),
    years,
    has_vol: requireBoolean(row.has_vol, `${field}.has_vol`),
    has_sharpe: requireBoolean(row.has_sharpe, `${field}.has_sharpe`),
    has_srri: requireBoolean(row.has_srri, `${field}.has_srri`),
    has_mdd: requireBoolean(row.has_mdd, `${field}.has_mdd`),
    has_mdd_hist: requireBoolean(row.has_mdd_hist, `${field}.has_mdd_hist`),
    flags: requireStringArray(row.flags, `${field}.flags`)
  };
}

function parseMetricsPresent(raw: unknown): AdminMetricsPresent {
  const value = requireObject(raw, "metrics_present");
  return {
    vol: nonNegativeInteger(value.vol, "metrics_present.vol"),
    sharpe: nonNegativeInteger(value.sharpe, "metrics_present.sharpe"),
    srri: nonNegativeInteger(value.srri, "metrics_present.srri"),
    mdd: nonNegativeInteger(value.mdd, "metrics_present.mdd"),
    mdd_hist: nonNegativeInteger(value.mdd_hist, "metrics_present.mdd_hist")
  };
}

function parseAnomalies(raw: unknown): AdminAnomalies {
  const value = requireObject(raw, "anomalies");
  return {
    sin_historico: nonNegativeInteger(value.sin_historico, "anomalies.sin_historico"),
    desactualizados: nonNegativeInteger(value.desactualizados, "anomalies.desactualizados"),
    no_llega_2011: nonNegativeInteger(value.no_llega_2011, "anomalies.no_llega_2011"),
    valle_reciente: nonNegativeInteger(value.valle_reciente, "anomalies.valle_reciente"),
    total_flagged: nonNegativeInteger(value.total_flagged, "anomalies.total_flagged")
  };
}

function parseLaggedAsset(raw: unknown, index: number): AdminLaggedAsset {
  const row = requireObject(raw, `most_lagged[${index}]`);
  return {
    asset_id: nonEmptyString(row.asset_id, `most_lagged[${index}].asset_id`),
    name: requireString(row.name, `most_lagged[${index}].name`),
    type: nonEmptyString(row.type, `most_lagged[${index}].type`),
    last_date: optionalNullableDate(row.last_date, `most_lagged[${index}].last_date`) ?? null
  };
}

export function parseAdminDbStatus(raw: unknown): AdminDbStatus {
  const data = requireObject(raw, "admin_db_status response");
  const totalAssets = nonNegativeInteger(data.total_assets, "total_assets");
  const byType = numberRecord(data.by_type, "by_type");
  const withHistory = nonNegativeInteger(data.with_history, "with_history");
  const withoutHistory = nonNegativeInteger(data.without_history, "without_history");
  const reach2011 = nonNegativeInteger(data.reach_2011, "reach_2011");
  const notReach2011 = nonNegativeInteger(data.not_reach_2011, "not_reach_2011");
  const metricsPresent = parseMetricsPresent(data.metrics_present);
  const anomalies = parseAnomalies(data.anomalies);
  if (sumRecord(byType) !== totalAssets) fail("by_type", "la suma no coincide con total_assets");
  if (withHistory + withoutHistory !== totalAssets) fail("with_history", "no reconcilia con total_assets");
  if (reach2011 + notReach2011 !== withHistory) fail("reach_2011", "no reconcilia con with_history");
  if (nonNegativeInteger(data.stale, "stale") > withHistory) fail("stale", "recuento superior a activos con histórico");
  if (Object.values(metricsPresent).some((value) => value > totalAssets)) fail("metrics_present", "recuento superior al total");
  if (anomalies.total_flagged > totalAssets) fail("anomalies.total_flagged", "recuento superior al total");
  if (anomalies.sin_historico !== withoutHistory) fail("anomalies.sin_historico", "no reconcilia con without_history");
  if (anomalies.desactualizados !== data.stale) fail("anomalies.desactualizados", "no reconcilia con stale");
  if (anomalies.no_llega_2011 !== notReach2011) fail("anomalies.no_llega_2011", "no reconcilia con not_reach_2011");
  const mode = requireOptionalString(data.master_writes_mode, "master_writes_mode");
  if (mode !== undefined && mode !== "enabled" && mode !== "disabled") fail("master_writes_mode", "valor inesperado");
  return {
    generated_at: dateLike(data.generated_at, "generated_at"),
    total_assets: totalAssets,
    by_type: byType,
    with_history: withHistory,
    without_history: withoutHistory,
    reach_2011: reach2011,
    not_reach_2011: notReach2011,
    stale: nonNegativeInteger(data.stale, "stale"),
    stale_days_threshold: nonNegativeInteger(data.stale_days_threshold, "stale_days_threshold"),
    last_refresh_date: optionalNullableDate(data.last_refresh_date, "last_refresh_date") ?? null,
    latest_data_date: optionalNullableDate(data.latest_data_date, "latest_data_date"),
    latest_by_type: data.latest_by_type === undefined ? undefined : dateRecord(data.latest_by_type, "latest_by_type"),
    most_lagged: data.most_lagged === undefined
      ? undefined
      : requireArray(data.most_lagged, "most_lagged").map(parseLaggedAsset),
    master_writes_enabled: requireOptionalBoolean(data.master_writes_enabled, "master_writes_enabled"),
    master_writes_env: requireOptionalString(data.master_writes_env, "master_writes_env"),
    master_writes_mode: mode,
    app_check_enforced: requireOptionalBoolean(data.app_check_enforced, "app_check_enforced"),
    metrics_present: metricsPresent,
    start_year_histogram: numberRecord(data.start_year_histogram, "start_year_histogram"),
    anomalies
  };
}

export function parseAdminAssetsPage(raw: unknown): AdminAssetsPage {
  const data = requireObject(raw, "admin_list_assets response");
  const total = nonNegativeInteger(data.total, "total");
  const offset = nonNegativeInteger(data.offset, "offset");
  const limit = nonNegativeInteger(data.limit, "limit");
  if (limit < 1) fail("limit", "debe ser positivo");
  const items = requireArray(data.items, "items").map((item, index) => parseAdminAssetRow(item, `items[${index}]`));
  if (items.length > limit) fail("items", "contiene más filas que limit");
  if (items.length > total || (items.length > 0 && offset + items.length > total)) {
    fail("items", "no reconcilia con total y offset");
  }
  if (new Set(items.map((item) => item.asset_id)).size !== items.length) fail("items", "asset_id duplicado");
  return { total, offset, limit, items };
}

/**
 * Máxima caída en la forma del contrato metrics.v1.2/1.3: `{value, date}` con `value`
 * decimal (≤ 0). Ronda 2 (14-10-2026): el panel esperaba `{pct, periodo, fecha}` del
 * root legado y salía en blanco. Se aceptan también un número suelto (`max_drawdown_5y`)
 * y la forma legada en porcentaje, para no depender del orden de despliegue.
 */
function parseDrawdown(raw: unknown, field: string): AdminDrawdown | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return { value: requireNumber(raw, field) };
  const node = requireObject(raw, field);
  let value: number | undefined;
  if (node.value !== undefined && node.value !== null) {
    value = requireNumber(node.value, `${field}.value`);
  } else if (node.pct !== undefined && node.pct !== null) {
    value = requireNumber(node.pct, `${field}.pct`) / 100;
  }
  if (value === undefined) return null;
  const rawDate = node.date ?? node.fecha;
  return rawDate === undefined || rawDate === null
    ? { value }
    : { value, date: dateLike(rawDate, `${field}.date`) };
}

function parseSeries(raw: unknown): AdminSeriesAnalysis {
  const data = requireObject(raw, "series");
  const bigGaps = requireArray(data.big_gaps, "series.big_gaps").map((item, index) => {
    const gap = requireObject(item, `series.big_gaps[${index}]`);
    return {
      from: dateLike(gap.from, `series.big_gaps[${index}].from`),
      to: dateLike(gap.to, `series.big_gaps[${index}].to`),
      days: nonNegativeInteger(gap.days, `series.big_gaps[${index}].days`)
    };
  });
  const bigGapsCount = nonNegativeInteger(data.big_gaps_count, "series.big_gaps_count");
  if (bigGapsCount < bigGaps.length) fail("series.big_gaps_count", "menor que el detalle incluido");
  return {
    points: nonNegativeInteger(data.points, "series.points"),
    first_date: optionalNullableDate(data.first_date, "series.first_date") ?? null,
    last_date: optionalNullableDate(data.last_date, "series.last_date") ?? null,
    duplicates: nonNegativeInteger(data.duplicates, "series.duplicates"),
    non_positive: nonNegativeInteger(data.non_positive, "series.non_positive"),
    big_gaps: bigGaps,
    big_gaps_count: bigGapsCount
  };
}

export function parseAdminAssetDetail(raw: unknown): AdminAssetDetail {
  const data = requireObject(raw, "admin_asset_detail response");
  return {
    meta: parseAdminAssetRow(data.meta, "meta"),
    identifiers: requireObject(data.identifiers, "identifiers"),
    classification: requireObject(data.classification, "classification"),
    max_drawdown_5y: parseDrawdown(data.max_drawdown_5y ?? data.max_drawdown, "max_drawdown_5y"),
    max_drawdown_hist: parseDrawdown(data.max_drawdown_hist, "max_drawdown_hist"),
    series: parseSeries(data.series)
  };
}

function parseRefreshSample(raw: unknown, index: number): AdminRefreshSampleItem {
  const row = requireObject(raw, `sample[${index}]`);
  return {
    asset_id: nonEmptyString(row.asset_id, `sample[${index}].asset_id`),
    last_date: optionalNullableDate(row.last_date, `sample[${index}].last_date`),
    new_last: optionalNullableDate(row.new_last, `sample[${index}].new_last`),
    new_points: optionalNonNegativeInteger(row.new_points, `sample[${index}].new_points`),
    history_rebuilt: requireOptionalBoolean(row.history_rebuilt, `sample[${index}].history_rebuilt`)
  };
}

/**
 * Texto de una fila reconstruida en la muestra del refresco masivo; null si es un refresco
 * normal (puntos nuevos). En una reconstrucción `new_points` es el histórico entero, no lo
 * añadido: sin esta etiqueta se leía como «4100 puntos nuevos» (segunda pasada, 17-10-2026).
 * En la vista previa (`applied` falso) no se ha escrito nada: «se reconstruiría» (tercera pasada).
 */
export function refreshSampleRebuildLabel(item: AdminRefreshSampleItem, applied: boolean): string | null {
  if (!item.history_rebuilt) return null;
  const points = typeof item.new_points === "number" ? `, ${oFalta(numero(item.new_points))} puntos` : "";
  const until = item.new_last ?? item.last_date;
  const verb = applied ? "histórico reconstruido" : "se reconstruiría el histórico";
  return `${verb}${points}${until ? ` hasta el ${oFalta(fecha(until))}` : ""}`;
}

export function parseAdminRefreshAllStale(raw: unknown): AdminRefreshAllStaleResult {
  const data = requireObject(raw, "admin_refresh_all_stale response");
  const processed = nonNegativeInteger(data.processed, "processed");
  const updated = nonNegativeInteger(data.updated, "updated");
  const wouldUpdate = nonNegativeInteger(data.would_update, "would_update");
  const skipped = nonNegativeInteger(data.skipped, "skipped");
  const errors = nonNegativeInteger(data.errors, "errors");
  const applied = requireBoolean(data.applied, "applied");
  if (applied && wouldUpdate !== 0) fail("would_update", "debe ser cero cuando applied=true");
  if (!applied && updated !== 0) fail("updated", "debe ser cero en previsualizacion");
  const changed = applied ? updated : wouldUpdate;
  if (changed + skipped + errors !== processed) fail("processed", "no reconcilia con resultados");
  const errorSample = data.error_sample === undefined
    ? undefined
    : requireArray(data.error_sample, "error_sample").map((item, index) => {
        const row = requireObject(item, `error_sample[${index}]`);
        return {
          asset_id: nonEmptyString(row.asset_id, `error_sample[${index}].asset_id`),
          error: nonEmptyString(row.error, `error_sample[${index}].error`)
        };
      });
  if (errorSample && errorSample.length > errors) fail("error_sample", "más filas que errors");
  const readBudgetMax = optionalNonNegativeInteger(data.read_budget_max, "read_budget_max");
  const readBudgetUsed = optionalNonNegativeInteger(data.read_budget_used, "read_budget_used");
  if (readBudgetMax && readBudgetUsed !== undefined && readBudgetUsed > readBudgetMax) {
    fail("read_budget_used", "supera read_budget_max");
  }
  return {
    processed,
    updated,
    would_update: wouldUpdate,
    applied,
    skipped,
    errors,
    error_sample: errorSample,
    sample: data.sample === undefined ? undefined : requireArray(data.sample, "sample").map(parseRefreshSample),
    ran_date: dateLike(data.ran_date, "ran_date"),
    read_budget_max: readBudgetMax,
    read_budget_used: readBudgetUsed,
    write_count: optionalNonNegativeInteger(data.write_count, "write_count"),
    next_cursor: data.next_cursor == null ? null : nonEmptyString(data.next_cursor, "next_cursor"),
    cycle_completed: data.cycle_completed === undefined ? undefined : requireBoolean(data.cycle_completed, "cycle_completed")
  };
}

function parseBackfillCandidate(raw: unknown, index: number): AdminBackfillCandidate {
  const row = requireObject(raw, `candidates[${index}]`);
  return {
    asset_id: nonEmptyString(row.asset_id, `candidates[${index}].asset_id`),
    name: nonEmptyString(row.name, `candidates[${index}].name`),
    type: nonEmptyString(row.type, `candidates[${index}].type`),
    eodhd_hint: requireNullableString(row.eodhd_hint, `candidates[${index}].eodhd_hint`),
    currency_hint: requireNullableString(row.currency_hint, `candidates[${index}].currency_hint`)
  };
}

export function parseAdminBackfillCandidates(raw: unknown): AdminBackfillCandidatesResult {
  const data = requireObject(raw, "admin_backfill_candidates response");
  const totalRoots = nonNegativeInteger(data.total_roots, "total_roots");
  const excluded = nonNegativeInteger(data.excluded, "excluded");
  const withSeries = nonNegativeInteger(data.with_series, "with_series");
  const candidates = requireArray(data.candidates, "candidates").map(parseBackfillCandidate);
  const byType = numberRecord(data.by_type, "by_type");
  if (excluded + withSeries + candidates.length !== totalRoots) fail("total_roots", "no reconcilia con inventario");
  if (sumRecord(byType) !== candidates.length) fail("by_type", "no reconcilia con candidates");
  if (new Set(candidates.map((item) => item.asset_id)).size !== candidates.length) fail("candidates", "asset_id duplicado");
  return {
    generated_at: dateLike(data.generated_at, "generated_at"),
    total_roots: totalRoots,
    excluded,
    with_series: withSeries,
    candidates,
    by_type: byType
  };
}

function parseBackfillResult(raw: unknown, index: number): AdminBackfillAssetResult {
  const row = requireObject(raw, `results[${index}]`);
  const result: AdminBackfillAssetResult = {
    asset_id: nonEmptyString(row.asset_id, `results[${index}].asset_id`),
    ok: requireBoolean(row.ok, `results[${index}].ok`),
    applied: requireBoolean(row.applied, `results[${index}].applied`),
    skipped: requireNullableString(row.skipped, `results[${index}].skipped`),
    reason: requireNullableString(row.reason, `results[${index}].reason`),
    resolution: requireNullableString(row.resolution, `results[${index}].resolution`),
    symbol: requireNullableString(row.symbol, `results[${index}].symbol`),
    currency: requireNullableString(row.currency, `results[${index}].currency`),
    points: nonNegativeInteger(row.points, `results[${index}].points`),
    first_date: optionalNullableDate(row.first_date, `results[${index}].first_date`) ?? null,
    last_date: optionalNullableDate(row.last_date, `results[${index}].last_date`) ?? null,
    years: nonNegativeInteger(row.years, `results[${index}].years`),
    docs_created: nonNegativeInteger(row.docs_created, `results[${index}].docs_created`),
    error: requireNullableString(row.error, `results[${index}].error`)
  };
  if (result.applied && !result.ok) fail(`results[${index}].applied`, "requiere ok=true");
  if (result.ok && (result.skipped || result.reason || result.error)) {
    fail(`results[${index}]`, "un resultado ok no puede estar omitido, pendiente o en error");
  }
  return result;
}

export function parseAdminBackfillBatch(raw: unknown): AdminBackfillBatchResult {
  const data = requireObject(raw, "admin_backfill_history response");
  const results = requireArray(data.results, "results").map(parseBackfillResult);
  const requested = nonNegativeInteger(data.requested, "requested");
  const processed = nonNegativeInteger(data.processed, "processed");
  const loadable = nonNegativeInteger(data.loadable, "loadable");
  const loaded = nonNegativeInteger(data.loaded, "loaded");
  const applied = requireBoolean(data.applied, "applied");
  const skipped = nonNegativeInteger(data.skipped, "skipped");
  const review = nonNegativeInteger(data.review, "review");
  const errors = nonNegativeInteger(data.errors, "errors");
  if (requested !== processed || processed !== results.length) fail("processed", "no reconcilia con results");
  if (loaded > loadable || loadable > processed) fail("loaded", "recuentos incompatibles");
  if (loadable + skipped + review + errors !== processed) fail("processed", "no reconcilia con categorias");
  if ((!applied && loaded !== 0) || (applied && loaded !== loadable)) fail("loaded", "no reconcilia con applied");
  return {
    applied,
    requested,
    processed,
    loadable,
    loaded,
    skipped,
    review,
    errors,
    results,
    ran_date: dateLike(data.ran_date, "ran_date")
  };
}

function parseIngestHistory(raw: unknown): AdminIngestAssetHistory {
  const data = requireObject(raw, "history");
  const metrics = data.metrics === undefined
    ? undefined
    : (() => {
        const value = requireObject(data.metrics, "history.metrics");
        return {
          available: requireOptionalBoolean(value.available, "history.metrics.available"),
          windows: value.windows === undefined ? undefined : requireStringArray(value.windows, "history.metrics.windows"),
          observations_count: optionalNonNegativeInteger(value.observations_count, "history.metrics.observations_count"),
          last_date: value.last_date === undefined ? undefined : dateLike(value.last_date, "history.metrics.last_date"),
          applied: requireOptionalBoolean(value.applied, "history.metrics.applied")
        };
      })();
  const history: AdminIngestAssetHistory = {
    loaded: requireOptionalBoolean(data.loaded, "history.loaded"),
    reason: requireOptionalString(data.reason, "history.reason"),
    error: requireOptionalString(data.error, "history.error"),
    symbol: requireOptionalString(data.symbol, "history.symbol"),
    points: optionalNonNegativeInteger(data.points, "history.points"),
    first_date: data.first_date === undefined ? undefined : dateLike(data.first_date, "history.first_date"),
    last_date: data.last_date === undefined ? undefined : dateLike(data.last_date, "history.last_date"),
    years: optionalNonNegativeInteger(data.years, "history.years"),
    applied: requireOptionalBoolean(data.applied, "history.applied"),
    interval: requireOptionalString(data.interval, "history.interval"),
    representation: requireOptionalString(data.representation, "history.representation"),
    metrics
  };
  if (history.loaded === true && (history.points === undefined || !history.first_date || !history.last_date)) {
    fail("history", "un histórico cargable requiere puntos y rango de fechas");
  }
  if (history.loaded === false && !history.reason && !history.error) {
    fail("history", "un histórico no cargado requiere motivo o error");
  }
  return history;
}

export function parseAdminIngestAsset(raw: unknown): AdminIngestAssetResult {
  const data = requireObject(raw, "admin_ingest_asset response");
  const result: AdminIngestAssetResult = {
    asset_id: nonEmptyString(data.asset_id, "asset_id"),
    ok: requireBoolean(data.ok, "ok"),
    applied: requireOptionalBoolean(data.applied, "applied"),
    preview: requireOptionalBoolean(data.preview, "preview"),
    resolved: requireOptionalBoolean(data.resolved, "resolved"),
    symbol: requireOptionalString(data.symbol, "symbol"),
    name: requireOptionalString(data.name, "name"),
    asset_type: requireOptionalString(data.asset_type, "asset_type"),
    provider: requireOptionalString(data.provider, "provider"),
    quality_status: requireOptionalString(data.quality_status, "quality_status"),
    quality_score: optionalNonNegativeInteger(data.quality_score, "quality_score"),
    quality_warnings: data.quality_warnings === undefined
      ? undefined
      : requireStringArray(data.quality_warnings, "quality_warnings"),
    fundamentals_source: optionalNullableString(data.fundamentals_source, "fundamentals_source"),
    exists_in_master: requireOptionalBoolean(data.exists_in_master, "exists_in_master"),
    root_action: requireOptionalString(data.root_action, "root_action"),
    with_history: requireOptionalBoolean(data.with_history, "with_history"),
    history: data.history === undefined ? undefined : parseIngestHistory(data.history),
    root_preview: data.root_preview === undefined ? undefined : requireObject(data.root_preview, "root_preview"),
    error: requireOptionalString(data.error, "error"),
    unsupported_type: requireOptionalString(data.unsupported_type, "unsupported_type"),
    note: requireOptionalString(data.note, "note"),
    root_written: requireOptionalBoolean(data.root_written, "root_written"),
    search_index_updated: requireOptionalBoolean(data.search_index_updated, "search_index_updated"),
    search_index_warning: requireOptionalString(data.search_index_warning, "search_index_warning"),
    metrics: data.metrics
  };
  if (result.ok && (result.applied === undefined || result.preview === undefined || result.resolved !== true)) {
    fail("admin_ingest_asset response", "una ingesta valida requiere estado de aplicación, preview y resolución");
  }
  if (result.applied === result.preview && result.applied !== undefined) {
    fail("admin_ingest_asset response", "applied y preview no pueden coincidir");
  }
  return result;
}

export function parseAdminRecomputeMetric(raw: unknown): AdminRecomputeMetricResult {
  const data = requireObject(raw, "admin_recompute_metric response");
  const maxDrawdown = data.max_drawdown_hist === undefined
    ? undefined
    : (() => {
        const value = requireObject(data.max_drawdown_hist, "max_drawdown_hist");
        return {
          value: requireNumber(value.value, "max_drawdown_hist.value"),
          date: optionalNullableDate(value.date, "max_drawdown_hist.date") ?? null
        };
      })();
  const result: AdminRecomputeMetricResult = {
    asset_id: nonEmptyString(data.asset_id, "asset_id"),
    found: requireBoolean(data.found, "found"),
    enough_data: requireOptionalBoolean(data.enough_data, "enough_data"),
    points: optionalNonNegativeInteger(data.points, "points"),
    applied: requireOptionalBoolean(data.applied, "applied"),
    error: requireOptionalString(data.error, "error"),
    max_drawdown_hist: maxDrawdown
  };
  if (result.applied && (!result.found || result.enough_data !== true || !result.max_drawdown_hist)) {
    fail("applied", "un recalculo aplicado requiere activo, datos suficientes y resultado");
  }
  if (result.max_drawdown_hist && result.enough_data !== true) {
    fail("max_drawdown_hist", "requiere enough_data=true");
  }
  return result;
}

export function parseAdminRefreshAssetPrices(raw: unknown): AdminRefreshAssetPricesResult {
  const data = requireObject(raw, "admin_refresh_prices response");
  const result: AdminRefreshAssetPricesResult = {
    asset_id: nonEmptyString(data.asset_id, "asset_id"),
    found: requireBoolean(data.found, "found"),
    has_series: requireOptionalBoolean(data.has_series, "has_series"),
    skipped: requireOptionalString(data.skipped, "skipped"),
    note: requireOptionalString(data.note, "note"),
    up_to_date: requireOptionalBoolean(data.up_to_date, "up_to_date"),
    applied: requireOptionalBoolean(data.applied, "applied"),
    new_points: optionalNonNegativeInteger(data.new_points, "new_points"),
    last_date: data.last_date === undefined ? undefined : dateLike(data.last_date, "last_date"),
    new_first: data.new_first === undefined ? undefined : dateLike(data.new_first, "new_first"),
    new_last: data.new_last === undefined ? undefined : dateLike(data.new_last, "new_last"),
    eodhd_symbol: requireOptionalString(data.eodhd_symbol, "eodhd_symbol"),
    history_rebuilt: requireOptionalBoolean(data.history_rebuilt, "history_rebuilt"),
    first_date: data.first_date === undefined ? undefined : dateLike(data.first_date, "first_date"),
    points: optionalNonNegativeInteger(data.points, "points"),
    history_documents: optionalNonNegativeInteger(data.history_documents, "history_documents"),
    revision: requireOptionalString(data.revision, "revision"),
    write_count: optionalNonNegativeInteger(data.write_count, "write_count")
  };
  if (result.applied && !result.found) {
    fail("applied", "un refresco aplicado requiere el activo");
  }
  // CRIT-03 (auditoría 16-10-2026): cuando el proveedor ha revisado precios ya guardados,
  // el backend reconstruye el histórico entero y responde con history_rebuilt, el rango
  // (first_date…last_date) y los puntos. Antes esta rama fallaba aunque la reparación ya
  // estuviera escrita, y la pasada en seco ocultaba que «Aplicar» la reescribiría.
  if (result.history_rebuilt) {
    if (!result.first_date || !result.last_date || result.points === undefined) {
      fail("history_rebuilt", "una reconstrucción del histórico requiere rango y puntos");
    }
  } else if (result.applied && (!result.new_points || !result.new_first || !result.new_last)) {
    fail("applied", "un refresco aplicado requiere nuevos puntos y rango");
  }
  return result;
}

/**
 * Aviso legible de un refresco individual que reconstruye el histórico entero; null si
 * es un refresco normal. La pasada en seco debe decir que «Aplicar» reescribirá todo.
 */
export function describeHistoryRebuild(result: AdminRefreshAssetPricesResult): string | null {
  if (!result.history_rebuilt) return null;
  const detail = `${oFalta(numero(result.points ?? null))} puntos, ${oFalta(periodo(result.first_date, result.last_date))}`;
  return result.applied
    ? `Histórico reconstruido (${detail}) y métricas recalculadas: el proveedor había revisado precios ya guardados.`
    : `El proveedor ha revisado precios ya guardados. «Aplicar» reconstruirá el histórico entero (${detail}) y recalculará las métricas.`;
}

/** Si la vista previa de precios tiene algo que aplicar: puntos nuevos o una reconstrucción. */
export function canApplyRefreshAssetPrices(result: AdminRefreshAssetPricesResult): boolean {
  return result.found
    && result.applied !== true
    && ((result.new_points ?? 0) > 0 || result.history_rebuilt === true);
}

export interface AdminAssetsQuery {
  type?: string | null;
  onlyFlagged?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "last_date" | null;
  sortDir?: "asc" | "desc";
}

export interface AdminRefreshChunk {
  limit?: number;
  offset?: number;
  startAfterAssetId?: string | null;
}

export async function fetchAdminDbStatus(): Promise<AdminDbStatus> {
  return parseAdminDbStatus(await callBackend<unknown>("admin_db_status", {}, "No se pudo cargar el estado de la base de datos."));
}

export async function fetchAdminAssets(query: AdminAssetsQuery = {}): Promise<AdminAssetsPage> {
  const raw = await callBackend<unknown>(
    "admin_list_assets",
    {
      type_filter: query.type ?? null,
      only_flagged: query.onlyFlagged ?? false,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
      sort_by: query.sortBy ?? null,
      sort_dir: query.sortDir ?? "asc"
    },
    "No se pudo cargar el inventario administrativo."
  );
  return parseAdminAssetsPage(raw);
}

export async function fetchAdminAssetDetail(assetId: string): Promise<AdminAssetDetail> {
  return parseAdminAssetDetail(await callBackend<unknown>(
    "admin_asset_detail",
    { asset_id: assetId },
    "No se pudo cargar la ficha administrativa."
  ));
}

export async function recomputeMetric(assetId: string, write = false): Promise<AdminRecomputeMetricResult> {
  const result = parseAdminRecomputeMetric(await callBackend<unknown>(
    "admin_recompute_metric",
    { asset_id: assetId, write },
    "No se pudo recalcular la métrica."
  ));
  if (write && result.applied) await invalidatePublicReadCaches([assetId]);
  return result;
}

export async function refreshAssetPrices(assetId: string, write = false): Promise<AdminRefreshAssetPricesResult> {
  const result = parseAdminRefreshAssetPrices(await callBackend<unknown>(
    "admin_refresh_prices",
    { asset_id: assetId, write },
    "No se pudieron refrescar los precios."
  ));
  if (write && result.applied) await invalidatePublicReadCaches([assetId]);
  return result;
}

export async function fetchAdminRefreshAllStale(
  write = false,
  chunk: AdminRefreshChunk = {}
): Promise<AdminRefreshAllStaleResult> {
  const result = parseAdminRefreshAllStale(await callBackend<unknown>(
    "admin_refresh_all_stale",
    {
      write,
      limit: chunk.limit ?? 0,
      offset: chunk.startAfterAssetId ? 0 : (chunk.offset ?? 0),
      start_after_asset_id: chunk.startAfterAssetId ?? null
    },
    "No se pudo ejecutar el refresco por lotes.",
    LONG_CALL_OPTIONS
  ));
  if (write && result.applied) await invalidatePublicReadCaches();
  return result;
}

export async function fetchAdminBackfillCandidates(): Promise<AdminBackfillCandidatesResult> {
  return parseAdminBackfillCandidates(await callBackend<unknown>(
    "admin_backfill_candidates",
    {},
    "No se pudo cargar el inventario de históricos.",
    LONG_CALL_OPTIONS
  ));
}

export async function runAdminBackfillHistory(ids: string[], write: boolean): Promise<AdminBackfillBatchResult> {
  const result = parseAdminBackfillBatch(await callBackend<unknown>(
    "admin_backfill_history",
    { ids, write },
    "No se pudo ejecutar el backfill de históricos.",
    LONG_CALL_OPTIONS
  ));
  if (write && result.applied) await invalidatePublicReadCaches(ids);
  return result;
}

export async function adminIngestAsset(
  isin: string,
  withHistory: boolean,
  write: boolean,
  preferredSymbol?: string
): Promise<AdminIngestAssetResult> {
  const result = parseAdminIngestAsset(await callBackend<unknown>(
    "admin_ingest_asset",
    {
      isin,
      with_history: withHistory,
      write,
      preferred_symbol: preferredSymbol?.trim().toUpperCase() || null
    },
    "No se pudo procesar el alta del activo.",
    LONG_CALL_OPTIONS
  ));
  if (write && result.applied) await invalidatePublicReadCaches([result.asset_id || isin]);
  return result;
}
