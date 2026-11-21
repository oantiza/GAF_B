import fs from "node:fs";
import path from "node:path";
import { normalizeIsoUtcDateTime } from "../utils/utcDates";
import { mapProvenance } from "./fondosdb/fondosDbMapper";

const RE_ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const REQUIRED_METRIC_PATHS = [
    "performance.returns.trailing_pct.1a.fondo",
    "performance.returns.trailing_pct.3a_anualizada.fondo",
    "performance.returns.trailing_pct.5a_anualizada.fondo",
    "risk.volatilidad_pct.3a.fondo",
    "risk.sharpe.3a.fondo",
];

export type StockIngestStatus = "READY" | "READY_WITH_WARNING" | "NOT_READY" | "EXCLUDED";

export interface StockSelectionManifest {
    exclude?: string[];
    include?: string[];
}

export interface StockWarning {
    asset_id: string;
    code: string;
    severity: "WARNING" | "BLOCKER";
    message: string;
}

export interface StockIngestRow {
    asset_id: string;
    root_path: string;
    metrics_path: string;
    listing_id: string | null;
    status: StockIngestStatus;
    status_reasons: string[];
    warnings: StockWarning[];
    root: Record<string, any>;
    metrics: Record<string, any>;
    has_complete_target_metrics: boolean;
}

export interface StockDryRunResult {
    summary: Record<string, any>;
    candidates: StockIngestRow[];
    excluded: StockIngestRow[];
    warnings: {
        warnings: StockWarning[];
        ready_with_warning: string[];
        not_ready: string[];
        excluded: string[];
    };
}

function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file: string, data: any): void {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function get(obj: any, pathExpr: string): any {
    return pathExpr.split(".").reduce((cur, key) => cur && cur[key], obj);
}

function num(value: any): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pctToDecimal(value: any): number | null {
    const n = num(value);
    return n === null ? null : Math.round((n / 100) * 1e8) / 1e8;
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

export function readSelectionManifest(selectionPath?: string): StockSelectionManifest {
    if (!selectionPath) return {};
    return readJson(selectionPath) as StockSelectionManifest;
}

function readUniversalFunds(inputDir: string): Map<string, any> {
    const file = path.join(inputDir, "export", "fondos.ndjson");
    const byIsin = new Map<string, any>();
    for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        const isin = String(parsed.meta?.isin || parsed._id || "").toUpperCase();
        if (isin) byIsin.set(isin, parsed);
    }
    return byIsin;
}

function readFundJson(inputDir: string, isin: string): any | null {
    const file = path.join(inputDir, "data", "funds", `${isin}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
}

function inferHistoryTrace(universal: any, exportBdb: any, fundJson: any, ticker: string | null, exchange: string | null) {
    const hp = get(universal, "riesgo.historial_precios") || get(fundJson, "riesgo.historial_precios") || {};
    const trace = get(exportBdb, "ms.stock.history_trace") || {};
    const eodhdSymbol = get(universal, "identificacion.simbolo_eodhd") || get(fundJson, "identificacion.simbolo_eodhd");
    const yahooSymbol = get(universal, "identificacion.simbolo_yahoo") || get(fundJson, "identificacion.simbolo_yahoo");
    const warnings: StockWarning[] = [];
    const assetId = String(exportBdb.isin || get(universal, "meta.isin") || "").toUpperCase();

    let sourceHistory = hp.source_history || trace.source_history || null;
    if (!sourceHistory) {
        if (eodhdSymbol) sourceHistory = "eodhd";
        else if (yahooSymbol) sourceHistory = "yahoo";
    }

    let sourceListingId = hp.source_listing_id || trace.source_listing_id || get(universal, "identificacion.source_listing_id") || null;
    if (!sourceListingId) {
        if (sourceHistory === "eodhd" && eodhdSymbol) sourceListingId = `EODHD:${eodhdSymbol}`;
        else if (sourceHistory === "yahoo" && yahooSymbol) sourceListingId = `YAHOO:${yahooSymbol}`;
        // Con historico de Yahoo, ticker.exchange lleva la bolsa de Yahoo (MCE, IOB): no es un codigo EODHD (CRIT-10).
        else if (ticker && exchange && sourceHistory !== "yahoo") sourceListingId = `EODHD:${ticker}.${exchange}`;
    }

    const firstDate = hp.first_date || hp.fecha_inicio || trace.first_date || null;
    const lastDate = hp.last_date || hp.fecha_fin || trace.last_date || get(universal, "riesgo.fecha_dato") || get(universal, "valoracion.vl_fecha") || null;
    const observationsCount = hp.observations_count || hp.observaciones || trace.observations_count || null;
    const completeMetrics = REQUIRED_METRIC_PATHS.every(p => get({ performance: { returns: universal?.rentabilidad }, risk: universal?.riesgo }, p) !== undefined);
    let historyQualityStatus = hp.history_quality_status || trace.history_quality_status || null;
    if (!historyQualityStatus) {
        historyQualityStatus = completeMetrics && observationsCount ? "COMPLETE" : completeMetrics ? "PARTIAL_METADATA" : "PARTIAL";
    }

    if (!sourceHistory) {
        warnings.push({ asset_id: assetId, code: "MISSING_SOURCE_HISTORY", severity: "BLOCKER", message: "No hay fuente local para el histórico." });
    }
    if (!sourceListingId) {
        warnings.push({ asset_id: assetId, code: "MISSING_SOURCE_LISTING_ID", severity: "BLOCKER", message: "No hay identificador local de listing de origen." });
    }
    if (completeMetrics && (!firstDate || !observationsCount)) {
        warnings.push({
            asset_id: assetId,
            code: "HISTORY_COVERAGE_METADATA_INCOMPLETE",
            severity: "WARNING",
            message: "Hay métricas completas, pero falta first_date u observations_count local.",
        });
    }

    return {
        source_history: sourceHistory,
        source_listing_id: sourceListingId,
        first_date: firstDate,
        last_date: lastDate,
        observations_count: observationsCount,
        history_quality_status: historyQualityStatus,
        warnings,
    };
}

function buildWindow(root: any, period: string, returnKey: string) {
    const window = cleanObject({
        annualized_return: pctToDecimal(get(root, `performance.returns.trailing_pct.${returnKey}.fondo`)),
        annualized_volatility: pctToDecimal(get(root, `risk.volatilidad_pct.${period}.fondo`)),
        risk_free_rate: pctToDecimal(get(root, `risk.rf_pct.${period}.fondo`)),
        sharpe_ratio: num(get(root, `risk.sharpe.${period}.fondo`)),
    });
    // Estas cifras salen del bloque `risk`/`performance` del canonico: son
    // trailing del proveedor, no el CAGR geometrico que calcula la app sobre la
    // serie EODHD. Etiquetarlas como propias seria mentir, y ademas hacia que
    // el recalculo las tratase como formula vieja (auditoria 03-09, hallazgo 02).
    // Una ventana sin ningun dato no se etiqueta: no hay nada que describir.
    if (Object.keys(window).length === 0) return window;
    return { ...window, method: 'TRAILING_PROVIDER', frequency: 'PROVIDER' };
}

function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined)) as Partial<T>;
}

function buildMetricsLatest(root: any, trace: any) {
    const w1 = buildWindow(root, "1a", "1a");
    const w3 = buildWindow(root, "3a", "3a_anualizada");
    const w5 = buildWindow(root, "5a", "5a_anualizada");
    const maxDrawdown = pctToDecimal(get(root, "risk.max_drawdown.pct"));
    return cleanObject({
        asset_id: root.asset_id,
        population: "stock",
        // Fuente propia, distinta de la de la ingesta de la app: hasta ahora las
        // dos puertas de alta de acciones firmaban igual y no habia forma de
        // saber en la maestra quien habia escrito un documento.
        source: "FONDOSDB_STOCK_ROOT_ES",
        risk_score_source: "VOL_BUCKET",
        first_date: trace.first_date,
        last_date: trace.last_date,
        observations_count: trace.observations_count,
        max_drawdown_hist: maxDrawdown !== null
            ? { value: maxDrawdown }
            : undefined,
        windows: { "1y": w1, "3y": w3, "5y": w5 },
        updated_at: normalizeIsoUtcDateTime(root.source_metadata.generated_at)
            || normalizeIsoUtcDateTime(root.source_metadata.report_date)
            || normalizeIsoUtcDateTime(trace.last_date)
            || new Date().toISOString(),
    });
}

/**
 * Codigo EODHD y listing_id de la accion. Antes salian siempre de `ticker.exchange`, y en las acciones con
 * historico de Yahoo eso fabricaba un codigo EODHD con la bolsa de Yahoo (AENA.MCE, TSK.MCE, 0P2N.IOB) que
 * acababa en identifiers, aliases y listings (CRIT-10, auditoria del 16-10-2026). Ahora:
 *   1. si el canonico declara `simbolo_eodhd`, ese es el codigo;
 *   2. si no y el historico es de Yahoo, no hay codigo EODHD y el listing es el de la traza (YAHOO:...);
 *   3. en otro caso, `ticker.exchange` como hasta ahora (la bolsa del extractor ya va en formato EODHD).
 */
function stockListingIdentity(
    eodhdSymbol: string | null,
    ticker: string | null,
    exchange: string | null,
    trace: { source_history: string | null; source_listing_id: string | null },
): { eodhdCode: string | null; listingId: string | null } {
    if (eodhdSymbol) return { eodhdCode: eodhdSymbol, listingId: `EODHD:${eodhdSymbol}` };
    if (trace.source_history === "yahoo") return { eodhdCode: null, listingId: trace.source_listing_id || null };
    const eodhdCode = ticker && exchange ? `${ticker}.${exchange}` : null;
    return { eodhdCode, listingId: eodhdCode ? `EODHD:${eodhdCode}` : null };
}

function buildStockRow(raw: any, universal: any, fundJson: any, sourceFile: string): StockIngestRow {
    const isin = String(raw.isin || "").toUpperCase();
    const stock = raw.ms?.stock || {};
    const ticker = stock.ticker || get(universal, "identificacion.ticker") || null;
    const exchange = stock.exchange || get(universal, "identificacion.mercado") || null;
    // La traza va antes que el codigo: de ella depende si `ticker.exchange` es un codigo EODHD.
    const trace = inferHistoryTrace(universal, raw, fundJson, ticker, exchange);
    const eodhdSymbol = get(universal, "identificacion.simbolo_eodhd") || get(fundJson, "identificacion.simbolo_eodhd") || null;
    const { eodhdCode, listingId } = stockListingIdentity(eodhdSymbol, ticker, exchange, trace);
    const provenance = mapProvenance(raw.provenance);
    const root = {
        asset_id: isin,
        asset_type: "STOCK",
        identity: { name: raw.name || get(universal, "identificacion.nombre") || isin, currency: raw.currency || get(universal, "identificacion.divisa_base") || null },
        identifiers: {
            isin,
            ticker,
            eodhd_code: eodhdCode,
            aliases: unique([isin, ticker || "", eodhdCode || "", listingId || ""]),
        },
        classification: {
            asset_class: "EQUITY",
            fondosdb_asset_class: raw.derived?.asset_class || "EQUITY",
            fondosdb_asset_type: "stock",
            asset_subtype: "common_stock",
            region_primary: raw.classification_v2?.region_primary || raw.derived?.primary_region || null,
            strategy_tags: [],
            confidence: raw.classification_v2?.classification_confidence ?? raw.derived?.confidence ?? null,
        },
        product: { product_type: "stock", commercial_type: "accion", vehicle_complexity: "standard", has_listing: Boolean(listingId) },
        listings: listingId ? [{
            listing_id: listingId,
            ticker,
            exchange,
            currency: raw.currency || get(universal, "identificacion.divisa_base") || null,
            eodhd_code: eodhdCode,
            source_listing_id: trace.source_listing_id,
            is_primary: true,
            data_sources: ["fondosdb", trace.source_history].filter(Boolean),
        }] : [],
        performance: universal?.rentabilidad ? { returns: universal.rentabilidad, valuation: universal.valoracion || null } : null,
        risk: universal?.riesgo || null,
        fundamentals: stock.fundamentals || universal?.fundamentales || null,
        portfolio_exposure: raw.portfolio_exposure_v2 || null,
        quality: {
            fondosdb_bucket: raw.validation?.diagnostics?.calidad_fondosdb || get(universal, "calidad.bucket") || null,
            fondosdb_ok: raw.quality?.ok ?? raw.validation?.ok ?? null,
            warnings: [...(raw.quality?.warnings || []), ...(raw.validation?.warnings || []), ...trace.warnings.map((w: StockWarning) => w.code)],
            validation_errors: raw.validation?.errors || [],
            review_flags: raw.validation?.warnings || [],
            history_trace: trace,
        },
        source_metadata: {
            source: "FondosDB",
            source_file: `export_bdb/${sourceFile}`,
            generated_at: normalizeIsoUtcDateTime(raw.generated_at),
            report_date: raw.report_date || null,
            universal_export_present: Boolean(universal),
            source_history: trace.source_history,
            source_listing_id: trace.source_listing_id,
            firestore_import_block: "fondosdb_stock_root_assets",
        },
        // master.asset-stock.v1.1: procedencia por campo del canonico de acciones.
        ...(provenance ? { provenance } : {}),
    };
    const metrics = buildMetricsLatest(root, trace);
    const hasCompleteTargetMetrics = REQUIRED_METRIC_PATHS.every(p => get(root, p) !== undefined);
    return {
        asset_id: isin,
        root_path: `assets/${isin}`,
        metrics_path: `assets/${isin}/metrics/latest`,
        listing_id: listingId,
        status: "READY",
        status_reasons: [],
        warnings: trace.warnings,
        root,
        metrics,
        has_complete_target_metrics: hasCompleteTargetMetrics,
    };
}

/** Criterio unico de poblacion: el canonico es una accion si classification_v2.asset_type === 'stock'. */
export function isStockCanonical(raw: any): boolean {
    return raw?.classification_v2?.asset_type === "stock";
}

export function readStockRows(inputDir: string): StockIngestRow[] {
    const exportBdbDir = path.join(inputDir, "export_bdb");
    const universalByIsin = readUniversalFunds(inputDir);
    const out: StockIngestRow[] = [];
    for (const name of fs.readdirSync(exportBdbDir).sort()) {
        if (!name.endsWith(".json") || name.startsWith("_")) continue;
        const raw = readJson(path.join(exportBdbDir, name));
        if (!isStockCanonical(raw)) continue;
        const isin = String(raw.isin || "").toUpperCase();
        out.push(buildStockRow(raw, universalByIsin.get(isin), readFundJson(inputDir, isin), name));
    }
    return out;
}

function addWarning(row: StockIngestRow, code: string, severity: "WARNING" | "BLOCKER", message: string) {
    row.warnings.push({ asset_id: row.asset_id, code, severity, message });
}

export function evaluateStockRows(rows: StockIngestRow[], selection: StockSelectionManifest): StockDryRunResult {
    const include = new Set((selection.include || []).map(x => x.toUpperCase()));
    const exclude = new Set((selection.exclude || []).map(x => x.toUpperCase()));
    const selected = rows.filter(row => include.size === 0 || include.has(row.asset_id));
    const assetCounts = new Map<string, number>();
    const listingCounts = new Map<string, number>();
    for (const row of selected) {
        assetCounts.set(row.asset_id, (assetCounts.get(row.asset_id) || 0) + 1);
        if (row.listing_id) listingCounts.set(row.listing_id, (listingCounts.get(row.listing_id) || 0) + 1);
    }

    const candidates: StockIngestRow[] = [];
    const excludedRows: StockIngestRow[] = [];
    for (const row of selected) {
        const blockers: string[] = [];
        if (exclude.has(row.asset_id)) {
            row.status = "EXCLUDED";
            row.status_reasons = ["EXCLUDED_BY_SELECTION"];
            excludedRows.push(row);
            continue;
        }
        if (!RE_ISIN.test(row.asset_id)) blockers.push("INVALID_ISIN");
        if ((assetCounts.get(row.asset_id) || 0) > 1) blockers.push("ASSET_ID_COLLISION");
        if (!row.listing_id) blockers.push("MISSING_LISTING_ID");
        if (row.listing_id && (listingCounts.get(row.listing_id) || 0) > 1) blockers.push("LISTING_ID_COLLISION");
        if (!row.root.identifiers?.ticker) blockers.push("MISSING_TICKER");
        if (!row.root.listings?.[0]?.exchange) blockers.push("MISSING_EXCHANGE");
        if (row.root.quality?.fondosdb_bucket === "BLOQUEADO") blockers.push("FONDOSDB_BLOCKED");
        if (!row.has_complete_target_metrics) blockers.push("PARTIAL_TARGET_METRICS");
        if (!row.root.quality?.history_trace?.source_history) blockers.push("MISSING_SOURCE_HISTORY");
        if (!row.root.quality?.history_trace?.source_listing_id) blockers.push("MISSING_SOURCE_LISTING_ID");

        if (!row.root.fundamentals && blockers.length === 0) {
            addWarning(row, "MISSING_FUNDAMENTALS", "WARNING", "Sin fundamentales locales; identidad e histórico son válidos.");
        }

        const warningBlockers = row.warnings.filter(w => w.severity === "BLOCKER").map(w => w.code);
        blockers.push(...warningBlockers);
        if (blockers.length > 0) {
            row.status = "NOT_READY";
            row.status_reasons = unique(blockers);
            excludedRows.push(row);
        } else if (row.warnings.some(w => w.severity === "WARNING")) {
            row.status = "READY_WITH_WARNING";
            row.status_reasons = unique(row.warnings.map(w => w.code));
            candidates.push(row);
        } else {
            row.status = "READY";
            row.status_reasons = [];
            candidates.push(row);
        }
    }

    const selectedPartials = candidates.filter(row => !row.has_complete_target_metrics).map(row => row.asset_id);
    const notReady = excludedRows.filter(row => row.status === "NOT_READY").map(row => row.asset_id);
    const readyWithWarning = candidates.filter(row => row.status === "READY_WITH_WARNING").map(row => row.asset_id);
    const warnings = [...candidates, ...excludedRows].flatMap(row => row.warnings);
    const globalStatus = notReady.length > 0 || selectedPartials.length > 0
        ? "NOT_READY"
        : readyWithWarning.length > 0
            ? "READY_WITH_WARNING"
            : "READY";

    return {
        summary: {
            generated_at: new Date().toISOString(),
            universe_total: rows.length,
            input_total: selected.length,
            selected_total: selected.length,
            excluded: excludedRows.filter(row => row.status === "EXCLUDED").length,
            candidates: candidates.length,
            READY: candidates.filter(row => row.status === "READY").length,
            READY_WITH_WARNING: readyWithWarning.length,
            NOT_READY: notReady.length,
            EXCLUDED: excludedRows.filter(row => row.status === "EXCLUDED").length,
            global_status: globalStatus,
            isin_collisions: Array.from(assetCounts.values()).filter(count => count > 1).length,
            listing_id_collisions: Array.from(listingCounts.values()).filter(count => count > 1).length,
            partials_selected: selectedPartials.length,
            partial_target_metrics: selectedPartials,
            firestore_reads_executed: 0,
            firestore_writes_executed: 0,
            firestore_deletes_executed: 0,
        },
        candidates,
        excluded: excludedRows,
        warnings: {
            warnings,
            ready_with_warning: readyWithWarning,
            not_ready: notReady,
            excluded: excludedRows.filter(row => row.status === "EXCLUDED").map(row => row.asset_id),
        },
    };
}

export function runStockDryRun(inputDir: string, selectionPath?: string, outputDir?: string): StockDryRunResult {
    const result = evaluateStockRows(readStockRows(inputDir), readSelectionManifest(selectionPath));
    if (outputDir) writeStockDryRunArtifacts(result, outputDir);
    return result;
}

export function writeStockDryRunArtifacts(result: StockDryRunResult, outputDir: string): void {
    fs.mkdirSync(outputDir, { recursive: true });
    writeJson(path.join(outputDir, "stock_ingest_summary.json"), result.summary);
    fs.writeFileSync(
        path.join(outputDir, "stock_ingest_candidates.ndjson"),
        result.candidates.map(row => JSON.stringify(row)).join("\n") + (result.candidates.length ? "\n" : ""),
        "utf-8",
    );
    fs.writeFileSync(
        path.join(outputDir, "stock_ingest_excluded.ndjson"),
        result.excluded.map(row => JSON.stringify(row)).join("\n") + (result.excluded.length ? "\n" : ""),
        "utf-8",
    );
    writeJson(path.join(outputDir, "stock_ingest_warnings.json"), result.warnings);
}
