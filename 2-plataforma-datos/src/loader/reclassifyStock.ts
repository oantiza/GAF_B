/**
 * src/loader/reclassifyStock.ts — reclasificación fund->stock LIMPIA (cierra los casos que republish aparta).
 *
 * Para cada activo cuyo canónico ahora dice STOCK pero el doc vivo no, reescribe el doc como ROOT STOCK
 * (buildStockRow) en REEMPLAZO TOTAL => dropea los campos fund-only (costs, fixed_income_profile,
 * clasificacion/product de fondo), preservando `performance.valuation` (refresh diario). En la misma
 * escritura atómica:
 *   - raíz: `update` con precondición sobre la lectura (lastUpdateTime) y borrado de las claves que el
 *     doc nuevo no trae: misma semántica que `set()`, sin pisar una valuation que el refresco de precios
 *     escriba entre la lectura y la escritura;
 *   - `metrics/latest`: se INVALIDA como acción (ver buildReclassifiedMetricsMarker) para que el refresco de
 *     la app lo recalcule entero como STOCK; si no existía, se crea el marcador (el refresco no crea docs).
 * Después, la entrada de `meta/search_index` pasa a STOCK con `rebuildSearchIndexWithRetry` (escritura con
 * precondición y reintento). price_series y holdings no se tocan: un `holdings/latest` de fondo que quede
 * colgando de la acción se LISTA (holdings_left), no se borra.
 *
 * Mismos bloqueos que la alta: la población stock pasa por `evaluateStockRows`, y una acción NOT_READY
 * (sin listing, sin ticker, FONDOSDB_BLOCKED, MISSING_SOURCE_HISTORY, PARTIAL_TARGET_METRICS…) no se
 * reclasifica; READY_WITH_WARNING queda retenida salvo `--include-review`, como en `load:fondosdb`.
 *
 * Lo que ya es STOCK en la maestra no se reescribe, pero se REPARA (acción REPAIR) si quedó a medias:
 *   - la entrada del buscador no es STOCK (un lote confirmado cuyo índice falló);
 *   - con `--repair-metrics`, un metrics/latest de fondo (reclasificaciones hechas con la versión `set()`,
 *     que no tocaba las métricas). Sin la opción solo se avisa (metrics_fund_left).
 *
 * El documento que se escribe (`newDoc`, con la valuation viva) es el que se valida contra
 * master/asset-stock.v1.1, no el del canónico. Gated + postverify (raíz, métricas e índice).
 *
 *   npm run reclassify:stock -- --input "<dir>" [--ids A,B] [--out <dir>] [--include-review] [--repair-metrics] --dry-run
 *   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
 *     npm run reclassify:stock -- --input "<dir>" [--ids A,B] [--repair-metrics] --write
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { validators } from '../../contracts/validators';
import { evaluateStockRows, readStockRows } from '../ingestion/fondosdbStockAssets';
import { writeIngestionRun } from './ingestionRun';
import { STOCK_ROOT_SCHEMA_VERSION, validateCurrentRoot } from './ownership';
import { entryFromRoot, mergeSearchIndexDocument, SEARCH_INDEX_PATH, SEARCH_INDEX_SCHEMA_VERSION, SearchIndexEntry } from './searchIndex';
import { rebuildSearchIndexWithRetry, SearchIndexRef } from './searchIndexWrite';
import { ALLOWED_PROJECT_IDS } from '../config/projectAllowlist';

const PLATFORM_WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const PLATFORM_WRITE_GATE_VALUE = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';
const FUND_ONLY_FIELDS = ['costs', 'fixed_income_profile'];
const HOLDINGS_PATHS = ['holdings/latest', 'holdings/manifest'];
// update() interpreta los puntos de una clave como ruta: solo se reemplazan claves simples.
const SIMPLE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Firma con la que queda `metrics/latest` tras reclasificar. Es una de las fuentes de cálculo propio
 * (`SELF_COMPUTED_SOURCES` de functions_python/metrics_refresh.py): solo esas se recalculan enteras en
 * el refresco de la app, que toma la población del propio documento (`population: 'stock'` -> STOCK).
 */
export const RECLASSIFIED_METRICS_SOURCE = 'FONDOSDB_EODHD_DAILY_HISTORY';

export type ReclassifySkipReason = 'NO_STOCK_CANONICAL' | 'NOT_IN_MASTER' | 'ALREADY_STOCK' | 'NOT_READY' | 'REVIEW_HOLD';
export type ReclassifyRepair = 'search_index' | 'metrics_latest';

/** Fila de la población stock tal como la deja evaluateStockRows (status y motivos). */
export interface ReclassifyStockRow {
    root: Record<string, any>;
    status?: string;
    status_reasons?: string[];
}

export interface ReclassifySnapshot {
    exists: boolean;
    updateTime?: admin.firestore.Timestamp;
    data(): Record<string, any> | undefined;
}

export interface ReclassifyRef extends SearchIndexRef {
    path: string;
    get(): Promise<ReclassifySnapshot>;
}

export interface ReclassifyBatch {
    update(ref: ReclassifyRef, data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition): unknown;
    create(ref: ReclassifyRef, data: Record<string, unknown>): unknown;
    commit(): Promise<unknown>;
}

export interface ReclassifyDb {
    doc(docPath: string): ReclassifyRef;
    batch(): ReclassifyBatch;
}

export interface ReclassifyPlanRow {
    asset_id: string;
    action: 'RECLASSIFY' | 'REPAIR' | 'SKIP' | 'ERROR';
    reason?: ReclassifySkipReason;
    /** NOT_READY / REVIEW_HOLD: los motivos de evaluateStockRows. */
    blockers?: string[];
    from?: string;
    to?: 'STOCK';
    /** Claves de la raíz viva que el documento nuevo no trae (las fund-only, entre otras). */
    dropped?: string[];
    /** MARK: se invalida el metrics/latest existente; CREATE_MARKER: no había y se crea el marcador. */
    metrics_latest?: 'MARK' | 'CREATE_MARKER';
    search_index?: 'ADD' | 'UPDATE' | 'SAME';
    /** REPAIR: qué se repara de una acción que ya es STOCK. */
    repairs?: ReclassifyRepair[];
    /** HOLDINGS_LEFT (cartera de fondo colgando de la acción), METRICS_LATEST_FUND (métricas de fondo sin reparar). */
    warnings?: string[];
    holdings_left?: string[];
    error?: string;
    written?: boolean;
    postverify?: { root: boolean; metrics: boolean; search_index: boolean; ok: boolean };
}

export interface ReclassifySummary {
    run_id: string;
    write: boolean;
    requested: number;
    to_reclassify: number;
    to_repair: number;
    /** Activos a reclasificar (en seco) o reclasificados (con --write: solo los escritos). */
    reclassified: Array<{ asset_id: string; from: string; to: 'STOCK'; dropped: string[] }>;
    skipped: number;
    skipped_items: Array<{ asset_id: string; reason: ReclassifySkipReason; blockers?: string[] }>;
    written: number;
    repaired: number;
    metrics_marked: number;
    search_index_entries: number;
    search_index_written: boolean;
    search_index_attempts: number;
    /** Carteras de fondo que siguen colgando de una acción: se listan, no se borran. */
    holdings_left: Array<{ asset_id: string; paths: string[] }>;
    /** Acciones con metrics/latest de fondo que no se reparan (falta --repair-metrics). */
    metrics_fund_left: string[];
    errors: Array<{ asset_id: string; error: string }>;
    postverify_ok: number;
    postverify_failed: number;
}

export interface ReclassifyOptions {
    write: boolean;
    runId: string;
    nowIso?: string;
    env?: NodeJS.ProcessEnv;
    /** Como `load:fondosdb --include-review`: deja pasar READY_WITH_WARNING. */
    includeReview?: boolean;
    /** Invalida el metrics/latest de fondo de las acciones ya reclasificadas (en seco solo se planifica). */
    repairMetrics?: boolean;
}

export function assertReclassifyWriteGate(write: boolean, env: NodeJS.ProcessEnv = process.env): void {
    if (write && env[PLATFORM_WRITE_GATE] !== PLATFORM_WRITE_GATE_VALUE) {
        throw new Error(`SECURITY FAULT: ${PLATFORM_WRITE_GATE} debe valer '${PLATFORM_WRITE_GATE_VALUE}' para reclasificar.`);
    }
}

/**
 * metrics/latest invalidado como acción. metrics.v1.3 no admite campos de marca (additionalProperties:
 * false), así que la invalidación es el propio documento mínimo y válido:
 *   - `population: 'stock'` y firma de cálculo propio: el refresco de la app lo recalcula entero como STOCK;
 *   - sin `max_drawdown_hist` ni `last_date`: `_should_update_metrics_latest` lo da por pendiente en la
 *     siguiente pasada, avance o no la serie;
 *   - sin ventanas: las del fondo (y las TRAILING_PROVIDER, que el recálculo conservaría) no se publican
 *     como si fueran de la acción; sin `srri`: el SRRI del KID no aplica a una acción.
 * Hasta ese refresco la acción se ve sin métricas, no con las del fondo.
 */
export function buildReclassifiedMetricsMarker(isin: string, nowIso: string): Record<string, unknown> {
    return {
        asset_id: isin,
        population: 'stock',
        source: RECLASSIFIED_METRICS_SOURCE,
        updated_at: nowIso,
        windows: {},
        risk_score_source: 'VOL_BUCKET'
    };
}

/** Payload de `update()` con la semántica de `set(next)`: lo que `live` tenía y `next` no, se borra. */
export function replacePayload(live: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) {
        if (!SIMPLE_FIELD.test(key)) throw new Error(`RECLASSIFY_UNSAFE_FIELD: la clave '${key}' no se puede escribir con update().`);
        update[key] = value;
    }
    for (const key of Object.keys(live)) {
        if (key in next) continue;
        if (!SIMPLE_FIELD.test(key)) throw new Error(`RECLASSIFY_UNSAFE_FIELD: no se puede borrar la clave '${key}' con update().`);
        update[key] = admin.firestore.FieldValue.delete();
    }
    return update;
}

function isConcurrencyFailure(error: any): boolean {
    const code = error?.code;
    return code === 9 || code === 6 || code === 5 || code === 'failed-precondition' || code === 'already-exists' || code === 'not-found'
        || /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(String(error?.message || error || ''));
}

function sameEntry(left: unknown, right: SearchIndexEntry): boolean {
    if (!left || typeof left !== 'object') return false;
    const a = left as Record<string, unknown>;
    return (['id', 'name', 'name_folded', 'ticker', 'type', 'class', 'currency'] as const)
        .every((k) => (a[k] ?? null) === ((right as unknown as Record<string, unknown>)[k] ?? null));
}

function entriesOf(index: Record<string, any> | null): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const entry of Array.isArray(index?.entries) ? index!.entries : []) {
        if (entry && typeof entry === 'object' && typeof entry.id === 'string') out.set(entry.id, entry);
    }
    return out;
}

/** Población stock con los bloqueos de la alta, indexada por ISIN. */
export function stockRowsForReclassification(inputDir: string): Map<string, ReclassifyStockRow> {
    const evaluated = evaluateStockRows(readStockRows(inputDir), {});
    const out = new Map<string, ReclassifyStockRow>();
    for (const row of [...evaluated.candidates, ...evaluated.excluded]) {
        out.set(row.asset_id, { root: row.root, status: row.status, status_reasons: row.status_reasons });
    }
    return out;
}

async function holdingsLeft(db: ReclassifyDb, isin: string): Promise<string[]> {
    const left: string[] = [];
    for (const rel of HOLDINGS_PATHS) {
        const p = `assets/${isin}/${rel}`;
        if ((await db.doc(p).get()).exists) left.push(p);
    }
    return left;
}

/**
 * Reclasifica `targets` en la maestra. En seco no escribe nada y devuelve el mismo plan que se
 * escribiría; con `write` exige el gate y escribe cada activo en un batch atómico con precondición.
 */
export async function reclassifyStocks(
    db: ReclassifyDb,
    stockRows: Map<string, ReclassifyStockRow>,
    targets: string[],
    options: ReclassifyOptions
): Promise<{ summary: ReclassifySummary; plan: ReclassifyPlanRow[] }> {
    assertReclassifyWriteGate(options.write, options.env);
    const nowIso = options.nowIso || new Date().toISOString();
    const summary: ReclassifySummary = {
        run_id: options.runId, write: options.write, requested: targets.length, to_reclassify: 0, to_repair: 0, reclassified: [],
        skipped: 0, skipped_items: [], written: 0, repaired: 0, metrics_marked: 0, search_index_entries: 0,
        search_index_written: false, search_index_attempts: 0, holdings_left: [], metrics_fund_left: [], errors: [],
        postverify_ok: 0, postverify_failed: 0
    };
    const plan: ReclassifyPlanRow[] = [];
    const incoming = new Map<string, SearchIndexEntry>();
    const indexRef = db.doc(SEARCH_INDEX_PATH);
    const indexSnap = await indexRef.get();
    const indexBefore = entriesOf(indexSnap.exists ? (indexSnap.data() || {}) : null);

    for (const isin of targets) {
        const skip = (reason: ReclassifySkipReason, blockers?: string[], extra: Partial<ReclassifyPlanRow> = {}) => {
            summary.skipped++;
            summary.skipped_items.push({ asset_id: isin, reason, ...(blockers && blockers.length ? { blockers } : {}) });
            plan.push({ asset_id: isin, action: 'SKIP', reason, ...(blockers && blockers.length ? { blockers } : {}), ...extra });
        };
        const fail = (row: ReclassifyPlanRow, error: string) => {
            summary.errors.push({ asset_id: isin, error });
            plan.push({ ...row, action: 'ERROR', error });
        };
        const leftover = async (row: Partial<ReclassifyPlanRow>) => {
            const paths = await holdingsLeft(db, isin);
            if (paths.length === 0) return;
            row.holdings_left = paths;
            row.warnings = [...(row.warnings || []), 'HOLDINGS_LEFT'];
            summary.holdings_left.push({ asset_id: isin, paths });
        };

        const stockRow = stockRows.get(isin);
        if (!stockRow) { skip('NO_STOCK_CANONICAL'); continue; }
        const rootRef = db.doc(`assets/${isin}`);
        const rootSnap = await rootRef.get();
        if (!rootSnap.exists) { skip('NOT_IN_MASTER'); continue; }
        const live: Record<string, any> = rootSnap.data() || {};
        const metricsRef = db.doc(`assets/${isin}/metrics/latest`);

        // --- Ya es STOCK: no se reescribe; se repara lo que haya quedado a medias. ---
        if (live.asset_type === 'STOCK') {
            const extra: Partial<ReclassifyPlanRow> = { from: 'STOCK', to: 'STOCK' };
            const repairs: ReclassifyRepair[] = [];
            const entry = entryFromRoot(isin, live);
            const current = indexBefore.get(isin) as { type?: string } | undefined;
            if (entry && current?.type !== 'STOCK') {
                repairs.push('search_index');
                extra.search_index = current ? 'UPDATE' : 'ADD';
            }
            const metricsSnap = await metricsRef.get();
            const metricsLive = metricsSnap.exists ? (metricsSnap.data() || {}) : null;
            let metricsUpdate: Record<string, unknown> | null = null;
            if (metricsLive && metricsLive.population !== 'stock') {
                if (options.repairMetrics) {
                    repairs.push('metrics_latest');
                    extra.metrics_latest = 'MARK';
                    metricsUpdate = replacePayload(metricsLive, buildReclassifiedMetricsMarker(isin, nowIso));
                } else {
                    extra.warnings = [...(extra.warnings || []), 'METRICS_LATEST_FUND'];
                    summary.metrics_fund_left.push(isin);
                }
            }
            await leftover(extra);
            if (repairs.length === 0) { skip('ALREADY_STOCK', undefined, extra); continue; }
            const row: ReclassifyPlanRow = { asset_id: isin, action: 'REPAIR', reason: 'ALREADY_STOCK', repairs, ...extra };
            if (options.write && metricsUpdate) {
                try {
                    if (!metricsSnap.updateTime) throw new Error('RECLASSIFY_PRECONDITION_MISSING: la lectura de metrics/latest no trae updateTime.');
                    const batch = db.batch();
                    batch.update(metricsRef, metricsUpdate as admin.firestore.UpdateData<Record<string, unknown>>, { lastUpdateTime: metricsSnap.updateTime });
                    await batch.commit();
                    summary.metrics_marked++;
                    row.written = true;
                } catch (e: any) {
                    fail(row, isConcurrencyFailure(e)
                        ? `RECLASSIFY_CONCURRENT_MODIFICATION: assets/${isin}/metrics/latest cambió entre la lectura y la escritura; no se escribe (repite la pasada en seco).`
                        : String(e?.message || e));
                    continue;
                }
            }
            if (repairs.includes('search_index') && entry) incoming.set(isin, entry);
            plan.push(row);
            continue;
        }

        // --- Mismos bloqueos que la alta (evaluateStockRows). ---
        if (stockRow.status === 'NOT_READY' || stockRow.status === 'EXCLUDED') { skip('NOT_READY', stockRow.status_reasons); continue; }
        if (stockRow.status === 'READY_WITH_WARNING' && !options.includeReview) { skip('REVIEW_HOLD', stockRow.status_reasons); continue; }

        // Reemplazo total por el root stock; preserva la valuation del refresh diario.
        const expected = stockRow.root;
        const newDoc: Record<string, any> = { ...expected, schema_version: STOCK_ROOT_SCHEMA_VERSION, updated_at: nowIso };
        const liveVal = live.performance ? live.performance.valuation : undefined;
        if (liveVal !== undefined) newDoc.performance = { ...(expected.performance || {}), valuation: liveVal };
        const base: ReclassifyPlanRow = {
            asset_id: isin, action: 'RECLASSIFY', from: String(live.asset_type), to: 'STOCK',
            dropped: Object.keys(live).filter((k) => !(k in newDoc)).sort()
        };

        const contract = validateCurrentRoot(newDoc, true);
        if (!contract.ok) {
            fail(base, `el documento nuevo no valida ${STOCK_ROOT_SCHEMA_VERSION}: ` + contract.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()).join('; '));
            continue;
        }
        const metricsSnap = await metricsRef.get();
        const marker = buildReclassifiedMetricsMarker(isin, nowIso);
        const markerContract = validators.masterMetricsV13(marker);
        if (!markerContract.ok) {
            fail(base, 'el marcador de metrics/latest no valida metrics.v1.3: ' + markerContract.errors.map((e) => e.message).join('; '));
            continue;
        }
        let rootUpdate: Record<string, unknown>;
        let metricsUpdate: Record<string, unknown> | null = null;
        try {
            rootUpdate = replacePayload(live, newDoc);
            if (metricsSnap.exists) metricsUpdate = replacePayload(metricsSnap.data() || {}, marker);
        } catch (e: any) {
            fail(base, String(e?.message || e));
            continue;
        }
        const row: ReclassifyPlanRow = { ...base, metrics_latest: metricsSnap.exists ? 'MARK' : 'CREATE_MARKER' };
        await leftover(row);
        summary.reclassified.push({ asset_id: isin, from: row.from as string, to: 'STOCK', dropped: row.dropped || [] });

        if (options.write) {
            if (!rootSnap.updateTime || (metricsSnap.exists && !metricsSnap.updateTime)) {
                summary.reclassified.pop();
                fail(row, 'RECLASSIFY_PRECONDITION_MISSING: la lectura no trae updateTime.');
                continue;
            }
            try {
                const batch = db.batch();
                batch.update(rootRef, rootUpdate as admin.firestore.UpdateData<Record<string, unknown>>, { lastUpdateTime: rootSnap.updateTime });
                if (metricsUpdate) batch.update(metricsRef, metricsUpdate as admin.firestore.UpdateData<Record<string, unknown>>, { lastUpdateTime: metricsSnap.updateTime });
                else batch.create(metricsRef, marker);
                await batch.commit();
                row.written = true;
                summary.written++;
                summary.metrics_marked++;
            } catch (e: any) {
                summary.reclassified.pop();
                const reason = isConcurrencyFailure(e)
                    ? `RECLASSIFY_CONCURRENT_MODIFICATION: assets/${isin} o su metrics/latest cambió entre la lectura y la escritura; no se escribe nada (repite la pasada en seco).`
                    : String(e?.message || e);
                fail(row, reason);
                continue;
            }
        }
        plan.push(row);
        const entry = entryFromRoot(isin, newDoc);
        if (entry) incoming.set(isin, entry);
    }
    summary.to_reclassify = plan.filter((r) => r.action === 'RECLASSIFY').length;
    summary.to_repair = plan.filter((r) => r.action === 'REPAIR').length;

    // Índice de búsqueda: la entrada de cada reclasificado (o reparado) pasa a STOCK (en seco, solo se compara).
    const entries = [...incoming.values()];
    summary.search_index_entries = entries.length;
    let indexOkForWrite = true;
    const decide = (current: Record<string, any> | null) => {
        const liveIndex = entriesOf(current);
        for (const entry of entries) {
            const row = plan.find((r) => r.asset_id === entry.id && r.action !== 'ERROR');
            if (row) row.search_index = !liveIndex.has(entry.id) ? 'ADD' : sameEntry(liveIndex.get(entry.id), entry) ? 'SAME' : 'UPDATE';
        }
        return entries.some((entry) => !sameEntry(liveIndex.get(entry.id), entry));
    };
    if (entries.length > 0) {
        try {
            if (!options.write) {
                decide(indexSnap.exists ? (indexSnap.data() || {}) : null);
            } else {
                const result = await rebuildSearchIndexWithRetry(indexRef, (current) => {
                    if (!decide(current)) return null;
                    const merged = mergeSearchIndexDocument(current, {
                        schema_version: SEARCH_INDEX_SCHEMA_VERSION, updated_at: nowIso, count: entries.length, entries
                    }, nowIso);
                    const valid = validators.masterSearchIndex(merged);
                    if (!valid.ok) throw new Error('meta/search_index no valida: ' + valid.errors.map((e) => e.message).join('; '));
                    return merged as unknown as Record<string, unknown>;
                });
                summary.search_index_written = result.written;
                summary.search_index_attempts = result.attempts;
            }
        } catch (e: any) {
            indexOkForWrite = false;
            summary.errors.push({ asset_id: SEARCH_INDEX_PATH, error: String(e?.message || e) });
        }
    }

    if (options.write) {
        // Una reparación solo de índice queda escrita cuando el índice se escribió (o ya estaba bien).
        for (const row of plan) {
            if (row.action === 'REPAIR' && !row.written && row.repairs?.includes('search_index') && indexOkForWrite) row.written = true;
        }
        let indexAfter: Map<string, unknown> | null = null;
        if (entries.length > 0) {
            try {
                const snap = await indexRef.get();
                indexAfter = entriesOf(snap.exists ? (snap.data() || {}) : null);
            } catch {
                indexAfter = null;
            }
        }
        for (const row of plan) {
            if (!row.written) continue;
            const repairOnly = row.action === 'REPAIR';
            let rootOk = false;
            let metricsOk = false;
            try {
                const after: any = (await db.doc(`assets/${row.asset_id}`).get()).data() || {};
                rootOk = after.asset_type === 'STOCK' && (repairOnly || FUND_ONLY_FIELDS.every((k) => !(k in after)));
                if (repairOnly && !row.repairs?.includes('metrics_latest')) {
                    metricsOk = true; // no se tocó
                } else {
                    const metrics: any = (await db.doc(`assets/${row.asset_id}/metrics/latest`).get()).data() || {};
                    metricsOk = metrics.population === 'stock' && metrics.source === RECLASSIFIED_METRICS_SOURCE;
                }
            } catch {
                // lectura fallida: cuenta como postverify fallido
            }
            const checksIndex = !repairOnly || row.repairs?.includes('search_index');
            const entry = indexAfter?.get(row.asset_id) as { type?: string } | undefined;
            const indexOk = checksIndex ? entry?.type === 'STOCK' : true;
            row.postverify = { root: rootOk, metrics: metricsOk, search_index: indexOk, ok: rootOk && metricsOk && indexOk };
            if (repairOnly && row.postverify.ok) summary.repaired++;
            if (row.postverify.ok) summary.postverify_ok++;
            else {
                summary.postverify_failed++;
                summary.errors.push({ asset_id: row.asset_id, error: `postverify: raíz ${rootOk ? 'ok' : 'MAL'}, metrics/latest ${metricsOk ? 'ok' : 'MAL'}, índice ${indexOk ? 'ok' : 'MAL'}` });
            }
        }
    }
    return { summary, plan };
}

// ------------------------------------------------------------------- CLI
function getFlag(a: string[], n: string): string | undefined { const i = a.indexOf(n); return i >= 0 && i + 1 < a.length ? a[i + 1] : undefined; }
function hasFlag(a: string[], n: string): boolean { return a.includes(n); }

function getDb(): admin.firestore.Firestore {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente.');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) throw new Error(`Project id fuera de allowlist: ${projectId}`);
    if (!admin.apps.length) admin.initializeApp({ projectId });
    return admin.firestore();
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const write = hasFlag(argv, '--write');
    const inputDir = getFlag(argv, '--input') || process.env.FONDOSDB_INPUT_DIR || '';
    if (!inputDir) throw new Error('Falta --input <dir fondosdb>.');
    const onlyIds = getFlag(argv, '--ids');
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(getFlag(argv, '--out') || path.join(process.cwd(), 'runs'), `reclassify_${runId}`);
    assertReclassifyWriteGate(write);
    fs.mkdirSync(outDir, { recursive: true });

    const stockRows = stockRowsForReclassification(inputDir);
    const db = getDb();
    const targets = onlyIds
        ? [...new Set(onlyIds.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
        : [...stockRows.keys()];

    const { summary, plan } = await reclassifyStocks(db as unknown as ReclassifyDb, stockRows, targets, {
        write, runId, includeReview: hasFlag(argv, '--include-review'), repairMetrics: hasFlag(argv, '--repair-metrics')
    });

    if (write && (summary.written > 0 || summary.repaired > 0)) {
        try { await writeIngestionRun(db, { run_id: runId, kind: 'reclassify', summary: summary as unknown as Record<string, unknown> }); }
        catch (e: any) { console.warn('[reclassify] aviso: no pude escribir ingestion_runs:', e?.message || e); }
    }
    fs.writeFileSync(path.join(outDir, 'reclassify_plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'reclassify_summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
    console.log(`[reclassify] write=${write} a_reclasificar=${summary.to_reclassify} a_reparar=${summary.to_repair} skipped=${summary.skipped} errores=${summary.errors.length}`);
    for (const r of plan) {
        if (r.action === 'RECLASSIFY') console.log(`   ${r.asset_id} ${r.from}->STOCK dropea=${(r.dropped || []).join(',') || '(ninguno)'} metrics=${r.metrics_latest} indice=${r.search_index ?? '-'}`);
        else if (r.action === 'REPAIR') console.log(`   ${r.asset_id} REPAIR ${(r.repairs || []).join(',')}`);
        else console.log(`   ${r.asset_id} ${r.action} ${r.reason || r.error || ''}${r.blockers?.length ? ` (${r.blockers.join(',')})` : ''}`);
    }
    for (const h of summary.holdings_left) console.warn(`[reclassify] aviso: ${h.asset_id} conserva cartera de fondo: ${h.paths.join(', ')} (no se borra)`);
    if (summary.metrics_fund_left.length > 0) {
        console.warn(`[reclassify] aviso: ${summary.metrics_fund_left.length} accion(es) con metrics/latest de fondo: ${summary.metrics_fund_left.join(', ')} (--repair-metrics para invalidarlo)`);
    }
    if (write) {
        console.log(`[reclassify] escritos=${summary.written} reparados=${summary.repaired} indice=${summary.search_index_written ? 'escrito' : 'sin cambios'} (${summary.search_index_attempts} intento/s) postverify ${summary.postverify_ok}/${summary.postverify_ok + summary.postverify_failed} errores=${summary.errors.length}`);
        if (summary.errors.length > 0 || summary.postverify_failed > 0) process.exitCode = 1;
    } else {
        console.log('[reclassify] DRY-RUN: 0 escrituras.');
    }
    console.log(`[reclassify] artefactos en ${outDir}`);
}

if (require.main === module) {
    main().catch((e) => { console.error('[reclassify] ERROR:', e?.message || e); process.exit(1); });
}
