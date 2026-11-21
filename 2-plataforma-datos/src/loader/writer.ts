/**
 * src/loader/writer.ts — writer gated, create-only, con postverify. SOLO se ejecuta con --write.
 *
 * Reglas (plan reconciliado, seccion 6):
 *  - Gate PROPIO de plataforma (distinto del de la app): BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES.
 *  - Allowlist de project id.
 *  - Create-only (doc.create() falla si ya existe -> idempotente, sin sobrescribir).
 *  - Sin deletes.
 *  - Valida cada documento contra master/* (ajv) ANTES de escribir (acciones -> master/asset-stock.v1).
 *  - Postverify: re-lee lo creado.
 */
import * as admin from 'firebase-admin';
import { mapFondosDbFund } from '../ingestion/fondosdb/fondosDbMapper';
import { FondosDbHoldingRecord, FondosDbPosition } from '../ingestion/fondosdb/fondosDbTypes';
import { validators } from '../../contracts/validators';
import { CanonicalPackage } from './packageReader';
import { buildHoldingsSummary, StockRowLite } from './planner';
import { writeIngestionRun } from './ingestionRun';
import { LoaderPlan, LoaderTargets, PlanItem, WriteOperation, WriteSummary } from './types';
import { buildFundMetricsLatest, buildStockMetricsLatest } from './metricsLatest';
import { SEARCH_INDEX_PATH } from './searchIndex';
import { buildHoldingsChunkDocumentPath, formatChunkId } from '../ingestion/firestorePathContract';
import { HOLDINGS_DOCUMENT_MAX_BYTES, HOLDINGS_STORAGE_MODE } from '../holdings/holdingsStorage';
import { mapFondosDbHoldings, RawHoldingInput } from '../mappers/fondosHoldingsMapper';
import { reconcileSearchIndexLive } from '../../scripts/reconcileSearchIndexLive';
import { FUND_ROOT_SCHEMA_VERSION, STOCK_ROOT_SCHEMA_VERSION, validateCurrentRoot } from './ownership';
import { holdingsProvenanceFromRecords, MASTER_HOLDINGS_V12_SCHEMA_VERSION, validateHoldingsPayload } from './holdingsProvenance';
import { ALLOWED_PROJECT_IDS } from '../config/projectAllowlist';

const PLATFORM_WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const PLATFORM_WRITE_GATE_VALUE = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';
const MASTER_ASSET_SCHEMA_VERSION = 'master.asset.v1';
const MASTER_ASSET_V11_SCHEMA_VERSION = FUND_ROOT_SCHEMA_VERSION;
const MASTER_ASSET_STOCK_SCHEMA_VERSION = STOCK_ROOT_SCHEMA_VERSION;
// Las carteras se escriben en v1.2 (v1.1 + `provenance` opcional): ver holdingsProvenance.ts.
const MASTER_HOLDINGS_SCHEMA_VERSION = MASTER_HOLDINGS_V12_SCHEMA_VERSION;

export function isPlatformWriteAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[PLATFORM_WRITE_GATE] === PLATFORM_WRITE_GATE_VALUE;
}

export function getDb(env: NodeJS.ProcessEnv = process.env): admin.firestore.Firestore {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente.');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) {
        throw new Error(`Project id fuera de la allowlist de plataforma: ${projectId}`);
    }
    if (!admin.apps.length) admin.initializeApp({ projectId });
    return admin.firestore();
}

/** Lee que ISIN ya existen como root en la maestra (para CREATE vs SKIP y para 'missing'). Solo lectura. */
export async function getExistingAssetIds(
    db: admin.firestore.Firestore,
    ids: string[]
): Promise<Set<string>> {
    const found = new Set<string>();
    const chunkSize = 250;
    for (let i = 0; i < ids.length; i += chunkSize) {
        const refs = ids.slice(i, i + chunkSize).map((id) => db.doc(`assets/${id}`));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) if (snap.exists) found.add(snap.id);
    }
    return found;
}

/** Construye las operaciones de escritura de un activo (root + holdings/latest), re-mapeando el canonico. */
export function buildOperations(
    pkg: CanonicalPackage,
    item: PlanItem,
    targets: LoaderTargets,
    nowIso: string,
    stockRowByIsin: Map<string, StockRowLite> = new Map()
): WriteOperation[] {
    const isin = item.asset_id;

    // --- ACCION: root ya construido por la tuberia stock (buildStockRow). Solo root (sin holdings). ---
    const stockRow = stockRowByIsin.get(isin);
    if (stockRow) {
        const ops: WriteOperation[] = [];
        const rootPayload = {
            ...(stockRow.root as Record<string, unknown>),
            schema_version: MASTER_ASSET_STOCK_SCHEMA_VERSION,
            updated_at: nowIso
        };
        if (targets.root) ops.push({ path: `assets/${isin}`, kind: 'root', asset_id: isin, payload: rootPayload });
        if (targets.metrics && stockRow.metrics) {
            ops.push({
                path: `assets/${isin}/metrics/latest`,
                kind: 'metrics',
                asset_id: isin,
                payload: buildStockMetricsLatest(stockRow.metrics, isin, nowIso) as unknown as Record<string, unknown>
            });
        }
        return ops;
    }

    // --- FONDO: re-mapea el canonico con el mapper V1. ---
    const entry = pkg.rawByIsin.get(isin);
    if (!entry) return [];
    const universal = pkg.universalByIsin.get(isin);
    const mapped = mapFondosDbFund(entry.file, entry.data, universal, {
        duplicateIsin: pkg.duplicateIsins.has(isin),
        problematicFlags: pkg.problematicByIsin.get(isin)?.flags,
        qualityFlags: pkg.qualityByIsin.get(isin)?.flags
    });
    if (!mapped.asset) return [];

    const ops: WriteOperation[] = [];

    if (targets.root) {
        const rootPayload = {
            ...(mapped.asset as unknown as Record<string, unknown>),
            schema_version: MASTER_ASSET_V11_SCHEMA_VERSION,
            updated_at: nowIso
        };
        ops.push({ path: `assets/${isin}`, kind: 'root', asset_id: isin, payload: rootPayload });
    }

    if (targets.holdings) {
        const records = pkg.holdingsByFundIsin.get(isin) || [];
        if (records.length > 0) {
            ops.push(...buildHoldingsOperations(isin, records, nowIso));
        }
    }

    if (targets.metrics) {
        const metricsPayload = buildFundMetricsLatest(mapped.asset, nowIso) as unknown as Record<string, unknown>;
        ops.push({ path: `assets/${isin}/metrics/latest`, kind: 'metrics', asset_id: isin, payload: metricsPayload });
    }

    return ops;
}

/**
 * Firestore (SDK real) rechaza `undefined` como valor; los mocks de los tests
 * lo toleran, por lo que el fallo solo aflora contra la BD real (505 errores
 * "Cannot use undefined as a Firestore value" en el republish 2026-07-11).
 * El JSON round-trip elimina las propiedades undefined de los objetos; los
 * holdings son objetos dentro de arrays, nunca elementos undefined sueltos,
 * así que no se introducen nulls espurios.
 */
function stripUndefinedDeep<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

export function buildHoldingsOperations(
    isin: string,
    records: FondosDbHoldingRecord[],
    nowIso: string
): WriteOperation[] {
    const summary = buildHoldingsSummary(records);
    const mapped = mapFondosDbHoldings(
        isin,
        isin,
        summary.as_of_date ?? undefined,
        records.map(toRawHoldingInput),
        { master_writer: true }
    );
    const holdings = stripUndefinedDeep(mapped.holdings || []);
    const provenance = holdingsProvenanceFromRecords(records);
    const singlePayload: Record<string, unknown> = {
        storage_mode: HOLDINGS_STORAGE_MODE.SINGLE_DOCUMENT,
        holdings_count: mapped.holdings_count,
        top10_weight: mapped.top10_weight,
        as_of_date: mapped.as_of_date ?? null,
        holdings,
        ...(provenance ? { provenance } : {}),
        schema_version: MASTER_HOLDINGS_SCHEMA_VERSION,
        updated_at: nowIso
    };

    if (Buffer.byteLength(JSON.stringify(mapped), 'utf8') <= HOLDINGS_DOCUMENT_MAX_BYTES) {
        return [{ path: `assets/${isin}/holdings/latest`, kind: 'holdings', asset_id: isin, payload: stripUndefinedDeep(singlePayload) }];
    }

    const chunks = splitHoldingsIntoChunks(isin, holdings, nowIso);
    const manifest: Record<string, unknown> = {
        storage_mode: HOLDINGS_STORAGE_MODE.CHUNKED,
        chunk_count: chunks.length,
        holdings_count: mapped.holdings_count,
        top10_weight: mapped.top10_weight,
        as_of_date: mapped.as_of_date ?? null,
        ...(provenance ? { provenance } : {}),
        schema_version: MASTER_HOLDINGS_SCHEMA_VERSION,
        updated_at: nowIso
    };
    return [
        { path: `assets/${isin}/holdings/manifest`, kind: 'holdings', asset_id: isin, payload: stripUndefinedDeep(manifest) },
        ...chunks.map((payload, index) => ({
            path: buildHoldingsChunkDocumentPath(isin, formatChunkId(index)),
            kind: 'holdings' as const,
            asset_id: isin,
            payload: stripUndefinedDeep(payload)
        }))
    ];
}

function toRawHoldingInput(record: FondosDbHoldingRecord): RawHoldingInput {
    const raw = record.raw_source_position;
    if (raw) {
        return {
            name: raw.nombre || undefined,
            weight: raw.peso_pct ?? undefined,
            isin: raw.isin || undefined,
            ticker: raw.ticker || undefined,
            assetClass: mapFondosDbPositionType(raw),
            country: raw.pais || undefined,
            currency: raw.divisa || undefined,
            sector: raw.sector || undefined
        };
    }

    return {
        name: record.name || undefined,
        weight: record.weight_pct ?? undefined,
        isin: record.identifiers?.isin || undefined,
        ticker: record.identifiers?.ticker || undefined,
        assetClass: record.holding_type || undefined,
        country: record.country || undefined,
        currency: record.currency || undefined,
        sector: record.sector || undefined
    };
}

function mapFondosDbPositionType(position: FondosDbPosition): string | undefined {
    if (position.tipo === 'rv') return 'Equity';
    if (position.tipo === 'rf') return 'Bond';
    if (position.tipo === 'otro') return 'Other';
    return position.tipo || undefined;
}

export function splitHoldingsIntoChunks(isin: string, records: unknown[], nowIso: string): Record<string, unknown>[] {
    const chunks: Record<string, unknown>[] = [];
    let current: unknown[] = [];
    let currentRecordsBytes = 0;
    let index = 0;

    const buildChunk = (chunkIndex: number, holdings: unknown[]): Record<string, unknown> => ({
        storage_mode: HOLDINGS_STORAGE_MODE.CHUNK,
        chunk_index: chunkIndex,
        holdings_count: holdings.length,
        holdings,
        schema_version: MASTER_HOLDINGS_SCHEMA_VERSION,
        updated_at: nowIso
    });

    // Serializamos cada posicion una sola vez. El algoritmo anterior reconstruia y
    // serializaba todo el chunk para cada elemento, lo que crecia de forma cuadratica.
    const chunkBytes = (chunkIndex: number, count: number, recordsBytes: number): number => {
        const emptyEnvelopeBytes = Buffer.byteLength(JSON.stringify(buildChunk(chunkIndex, [])), 'utf8');
        return emptyEnvelopeBytes + recordsBytes + Math.max(0, count - 1);
    };

    for (const record of records) {
        const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
        const candidateCount = current.length + 1;
        const candidateRecordsBytes = currentRecordsBytes + recordBytes;
        if (
            current.length > 0 &&
            chunkBytes(index, candidateCount, candidateRecordsBytes) > HOLDINGS_DOCUMENT_MAX_BYTES
        ) {
            chunks.push(buildChunk(index, current));
            index++;
            current = [];
            currentRecordsBytes = 0;
        }
        current.push(record);
        currentRecordsBytes += recordBytes;
        if (chunkBytes(index, current.length, currentRecordsBytes) > HOLDINGS_DOCUMENT_MAX_BYTES) {
            throw new Error(`CHUNK_REQUIRED: holdings de ${isin} contiene una posicion mayor que el umbral de Firestore.`);
        }
    }
    if (current.length > 0) chunks.push(buildChunk(index, current));

    const oversize = chunks.find((chunk) => Buffer.byteLength(JSON.stringify(chunk), 'utf8') > HOLDINGS_DOCUMENT_MAX_BYTES);
    if (oversize) throw new Error(`CHUNK_REQUIRED: holdings de ${isin} contiene una posicion mayor que el umbral de Firestore.`);
    return chunks;
}

export function validateOperation(op: WriteOperation): { ok: boolean; errors: string[] } {
    const res =
        op.kind === 'metrics'
            ? validators.masterMetricsV13(op.payload)
            : op.kind === 'search_index'
                ? validators.masterSearchIndex(op.payload)
            : op.kind !== 'root'
                ? validateHoldingsPayload(op.payload as Record<string, unknown>)
            : validateCurrentRoot(op.payload, (op.payload as { asset_type?: string }).asset_type === 'STOCK');
    return { ok: res.ok, errors: res.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()) };
}

/**
 * Completa el plan con lo que la escritura haria de verdad: los documentos de cada activo (`documents`)
 * y la validacion de TODOS ellos, no solo de la raiz. buildPlan valida la raiz; la cartera y
 * metrics/latest solo se validaban al escribir, y un documento invalido tumbaba el activo entero en la
 * escritura cuando la pasada en seco lo habia dado por CREATE. Un CREATE con algun documento invalido
 * pasa a INVALID_CONTRACT (y sus `contract_errors` dicen cual), igual en seco que con --write.
 */
export function annotatePlanDocuments(
    pkg: CanonicalPackage,
    plan: LoaderPlan,
    targets: LoaderTargets,
    stockRowByIsin: Map<string, StockRowLite> = new Map(),
    nowIso: string = plan.created_at
): LoaderPlan {
    for (const item of plan.items) {
        if (item.action !== 'CREATE' && item.action !== 'SKIP_EXISTS') continue;
        let operations: WriteOperation[];
        const errors: string[] = [];
        try {
            operations = buildOperations(pkg, item, targets, nowIso, stockRowByIsin);
        } catch (e: any) {
            operations = [];
            errors.push(String(e?.message || e)); // p. ej. CHUNK_REQUIRED: la escritura tambien fallaria
        }
        item.documents = operations.map((op) => op.path);
        if (item.action !== 'CREATE') continue;
        for (const op of operations) {
            if (op.kind === 'root') continue; // ya juzgada por buildPlan
            const valid = validateOperation(op);
            if (!valid.ok) errors.push(...valid.errors.map((e) => `${op.path}: ${e}`));
        }
        if (errors.length > 0) {
            plan.counts.CREATE--;
            plan.counts.INVALID_CONTRACT++;
            item.action = 'INVALID_CONTRACT';
            item.contract_errors = [...item.contract_errors, ...errors];
        }
    }
    return plan;
}

export async function createOperationsAtomically(
    db: admin.firestore.Firestore,
    operations: WriteOperation[]
): Promise<{ created: number; existing: number }> {
    if (operations.length === 0) return { created: 0, existing: 0 };
    if (operations.length > 500) throw new Error(`ATOMIC_ASSET_BATCH_TOO_LARGE: ${operations.length}`);
    const refs = operations.map((operation) => db.doc(operation.path));
    const snapshots = await db.getAll(...refs);
    const missing = operations.filter((_operation, index) => !snapshots[index].exists);
    if (missing.length === 0) return { created: 0, existing: operations.length };

    const batch = db.batch();
    for (const operation of missing) batch.create(db.doc(operation.path), operation.payload);
    await batch.commit();
    return { created: missing.length, existing: operations.length - missing.length };
}

/**
 * Ejecuta el plan. En dry-run (plan.write=false) NO toca Firestore y devuelve un resumen vacio.
 * En --write exige el gate de plataforma y escribe create-only con postverify.
 */
export async function executePlan(
    pkg: CanonicalPackage,
    plan: LoaderPlan,
    targets: LoaderTargets,
    env: NodeJS.ProcessEnv = process.env,
    stockRowByIsin: Map<string, StockRowLite> = new Map(),
    dbOverride?: admin.firestore.Firestore
): Promise<WriteSummary> {
    const summary: WriteSummary = {
        run_id: plan.run_id,
        executed_at: new Date().toISOString(),
        project_id: env.FIREBASE_PROJECT_ID || '',
        gate_ok: isPlatformWriteAuthorized(env),
        dry_run: !plan.write,
        planned_creates: plan.counts.CREATE,
        skipped_existing: 0,
        writes_executed: 0,
        deletes_executed: 0,
        postverify_ok: 0,
        postverify_failed: 0,
        errors: []
    };

    if (!plan.write) return summary; // dry-run: nada que escribir

    if (!isPlatformWriteAuthorized(env)) {
        throw new Error(
            `SECURITY FAULT: ${PLATFORM_WRITE_GATE} debe valer '${PLATFORM_WRITE_GATE_VALUE}' para escribir en la maestra.`
        );
    }

    const db = dbOverride || getDb(env);
    const nowIso = summary.executed_at;
    // Los SKIP_EXISTS tambien se inspeccionan: asi una ejecucion antigua que dejara
    // root sin holdings/metrics puede completar solo los documentos ausentes.
    const candidates = plan.items.filter((i) => i.action === 'CREATE' || i.action === 'SKIP_EXISTS');

    for (const item of candidates) {
        const operations = buildOperations(pkg, item, targets, nowIso, stockRowByIsin);
        let validAsset = true;
        for (const op of operations) {
            const valid = validateOperation(op);
            if (!valid.ok) {
                summary.errors.push({ path: op.path, error: `contract: ${valid.errors.join('; ')}` });
                validAsset = false;
            }
        }
        if (!validAsset) continue;
        try {
            const result = await createOperationsAtomically(db, operations);
            summary.writes_executed += result.created;
            summary.skipped_existing += result.existing;
        } catch (e: any) {
            const firstPath = operations[0]?.path || item.root_path;
            if (e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message))) {
                summary.skipped_existing += operations.length;
            } else {
                summary.errors.push({ path: firstPath, error: String(e?.message || e) });
            }
        }
    }

    // Postverify: re-leer cada path creado.
    for (const item of candidates) {
        for (const op of buildOperations(pkg, item, targets, nowIso, stockRowByIsin)) {
            try {
                const snap = await db.doc(op.path).get();
                if (snap.exists && Object.keys(snap.data() || {}).length > 0) summary.postverify_ok++;
                else summary.postverify_failed++;
            } catch {
                summary.postverify_failed++;
            }
        }
    }
    // `meta/search_index` lo escribe solo la reconciliacion, desde las raices vivas tras las escrituras
    // (ALTA-18, auditoria del 16-10-2026). Antes se escribia primero el indice del paquete sin filtrar: con
    // los REVIEW_HOLD, las acciones NOT_READY y lo que no existe en la maestra, y solo la reconciliacion lo
    // corregia despues; si esta fallaba, el indice contaminado se quedaba. Un fallo aqui va a errors y el
    // cargador sale con codigo 1 (cli.ts).
    let searchIndexWritten = false;
    try {
        searchIndexWritten = await reconcileSearchIndexLive(db, true, env);
        if (searchIndexWritten) summary.writes_executed++;
    } catch (e: any) {
        summary.errors.push({ path: SEARCH_INDEX_PATH, error: `reconciliation: ${String(e?.message || e)}` });
    }
    if (searchIndexWritten) {
        try {
            const snap = await db.doc(SEARCH_INDEX_PATH).get();
            if (snap.exists && Object.keys(snap.data() || {}).length > 0) summary.postverify_ok++;
            else summary.postverify_failed++;
        } catch {
            summary.postverify_failed++;
        }
    }

    if (plan.write) {
        try { await writeIngestionRun(db, { run_id: plan.run_id, kind: 'load', summary: summary as unknown as Record<string, unknown> }); }
        catch (e: any) { summary.errors.push({ path: `ingestion_runs/${plan.run_id}`, error: String(e?.message || e) }); }
    }

    return summary;
}
