import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { HoldingsCoverage, validateHoldingsPayload } from './holdingsProvenance';
import { FondosDbHoldingRecord } from '../ingestion/fondosdb/fondosDbTypes';
import {
    isAllowedHoldingsDeletePath,
    isAllowedHoldingsSetPath
} from '../ingestion/firestorePathContract';
import { buildHoldingsOperations } from './writer';
import { WriteOperation } from './types';

export type HoldingsTreeMode = 'NONE' | 'SINGLE_DOCUMENT' | 'CHUNKED' | 'MIXED';

interface HoldingsTreeDocument {
    path: string;
    payload: Record<string, any>;
}

/** De donde sale la cobertura de una cartera. */
export type HoldingsCoverageSource = 'provenance' | 'holdings_review' | 'none';

export interface HoldingsTreeState {
    mode: HoldingsTreeMode;
    as_of_date: string | null;
    content_hash: string;
    holdings_count: number;
    chunk_count: number;
    /** Cobertura declarada: `provenance.coverage` del documento principal (latest o manifest), o UNKNOWN. */
    coverage: HoldingsCoverage;
    coverage_source: HoldingsCoverageSource;
    /** `provenance.declared_holdings_count`: cuantas posiciones dice tener el proveedor. */
    declared_holdings_count: number | null;
    document_paths: string[];
    documents: HoldingsTreeDocument[];
}

const COVERAGES: ReadonlySet<string> = new Set(['COMPLETE', 'TOP_N', 'PARTIAL', 'UNKNOWN']);

/**
 * Que se hace con la cartera viva cuando difiere del canonico (decision de la sesion principal,
 * 14-10-2026, que sustituye a las dos variantes anteriores de D3).
 *
 * - Sin fecha en alguna de las dos: se conserva la viva y se avisa (KEEP_UNDATED).
 * - Misma fecha: con el mismo contenido solo se repara la forma; si una declara COMPLETE y la otra
 *   TOP_N o PARTIAL, gana la COMPLETE; si no, la que tiene mas posiciones.
 * - Fechas distintas: N es la mas reciente y O la mas antigua. Por defecto gana N. O solo gana si se
 *   cumple todo:
 *     1. N le saca como mucho HOLDINGS_COVERAGE_MAX_AGE_DAYS (183) dias naturales a O;
 *     2. N no declara COMPLETE;
 *     3. O no declara TOP_N ni PARTIAL;
 *     4. N es parcial: o lo declara (TOP_N o PARTIAL) y O tiene mas de 10 posiciones y mas que N, o no
 *        declara nada (UNKNOWN) y tiene menos del 80 % de las posiciones de O. Si N declara PARTIAL
 *        (canonico o viva), ademas tiene que tener menos del 80 % de las posiciones que declara
 *        (`declared_holdings_count`) o, si no las declara, de las de O.
 *   El recuento (segunda via de 4) solo sirve para CONSERVAR la viva frente a un canonico mas nuevo,
 *   nunca para retroceder: si O es el canonico, N (la viva) tiene que estar declarada parcial, por su
 *   `provenance` o, en las vivas anteriores a la procedencia, por fund_profile/latest.holdings_review
 *   (coverageFromHoldingsReview).
 *   Resultado: KEEP_COMPLETE_OLDER_LIVE (O es la viva) o REPLACE_COMPLETE_OLDER (O es el canonico).
 *
 * Motivos: la pasada «calidad de fondos fase 2» del 28-09 escribio carteras mas recientes que las del
 * extractor (445 el 14-10, mediana 2 meses), asi que por defecto manda la fecha; pero una respuesta
 * top 10 mas nueva no debe pisar una cartera completa, y una viva parcial de informe semestral
 * (carteras-prioritarias del 28-09) no debe ganar a un canonico completo de un mes antes. Contar
 * posiciones no basta para retroceder: tres vivas completas de fase 2 con pocas posiciones
 * (ES0116419005, LU2278574715, LU2337806421) habrian vuelto a una cartera mas antigua.
 */
export type HoldingsDecision =
    /** Viva y canonico coinciden: nada que escribir. */
    | 'UNCHANGED'
    /** No hay cartera viva. */
    | 'CREATE'
    /** El canonico es de fecha posterior y la viva no cumple las condiciones para conservarse. */
    | 'REPLACE_NEWER'
    /** Misma fecha y el canonico tiene mas posiciones. */
    | 'REPLACE_MORE_COMPLETE'
    /** La viva es mas reciente pero declarada parcial, y el canonico, mas completo, cumple 1-4. */
    | 'REPLACE_COMPLETE_OLDER'
    /** Misma fecha y mismo contenido: solo cambia como se guarda (latest/chunks, recuento declarado). */
    | 'REPAIR_LAYOUT'
    /** La viva es de fecha posterior: se conserva. */
    | 'KEEP_NEWER_LIVE'
    /** El canonico es mas reciente pero parcial, y la viva, mas completa, cumple 1-4: se conserva. */
    | 'KEEP_COMPLETE_OLDER_LIVE'
    /** Misma fecha y la viva tiene mas posiciones: se conserva. */
    | 'KEEP_MORE_COMPLETE'
    /** Misma fecha, mismas posiciones y contenido distinto: no hay criterio para elegir, se conserva. */
    | 'KEEP_SAME_DATE_TIE'
    /** Falta la fecha en la viva o en el canonico: no se puede comparar, se conserva y se avisa. */
    | 'KEEP_UNDATED';

const WRITING_DECISIONS: ReadonlySet<HoldingsDecision> = new Set<HoldingsDecision>([
    'CREATE',
    'REPLACE_NEWER',
    'REPLACE_MORE_COMPLETE',
    'REPLACE_COMPLETE_OLDER',
    'REPAIR_LAYOUT'
]);

/** Una cartera sin cobertura declarada es corta si tiene menos de este porcentaje de las posiciones de la otra. */
export const HOLDINGS_SHORT_COVERAGE_PCT = 80;
/** La mas antigua solo puede ganar si la mas reciente le saca como mucho estos dias naturales. */
export const HOLDINGS_COVERAGE_MAX_AGE_DAYS = 183;
/** Una cartera declarada parcial solo cede ante otra de mas de estas posiciones (y mas que ella). */
export const HOLDINGS_DECLARED_PARTIAL_MIN_OTHER = 10;

/** `count` tiene menos del 80 % de las posiciones de `other` (aritmetica entera: el 80 % exacto no es corto). */
export function isShortHoldings(count: number, other: number): boolean {
    return count * 100 < other * HOLDINGS_SHORT_COVERAGE_PCT;
}

/** Dias naturales de `from` a `to`, ambas 'YYYY-MM-DD'. */
export function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function decisionWrites(decision: HoldingsDecision): boolean {
    return WRITING_DECISIONS.has(decision);
}

/** 'YYYY-MM-DD' (admite un sufijo de hora); cualquier otra cosa cuenta como sin fecha. */
export function normalizeHoldingsDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
    if (!match) return null;
    return Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? null : match[1];
}

type ComparableTree = Pick<HoldingsTreeState, 'mode' | 'as_of_date' | 'content_hash' | 'holdings_count' | 'coverage'>
    & Partial<Pick<HoldingsTreeState, 'declared_holdings_count'>>;

const isDeclaredPartial = (coverage: HoldingsCoverage) => coverage === 'TOP_N' || coverage === 'PARTIAL';

/**
 * Cobertura de una viva sin `provenance`, segun la revision de la pasada de calidad del 28-09
 * (fund_profile/latest.holdings_review). Solo es fiable si describe esta misma cartera: la misma fecha
 * y `available_positions` igual al recuento de la viva. Entonces:
 *   - `full_holdings_loaded` true -> COMPLETE (fase 2: todas las posiciones que declara el proveedor);
 *   - `review_flags` con CARTERA_PUBLICADA_PARCIAL -> PARTIAL (informes semestrales en PDF sin
 *     efectivo ni derivados, top 5 oficiales);
 *   - `full_holdings_loaded` false y el proveedor declara al menos un 25 % mas de posiciones de las
 *     cargadas (`available_positions` < 80 % de `reported_positions`) -> PARTIAL (top 10 de la fase 2),
 *     salvo que el recuento declarado sea de otra fecha: con FECHAS_CARTERA_DISCREPANTES o con
 *     `summary_date` distinta de `detail_date` no se usa `reported_positions`;
 *   - cualquier otra cosa -> UNKNOWN. En particular, `full_holdings_loaded` false con
 *     RECUENTO_POSICIONES_PENDIENTE pero mas filas que las declaradas (tablet-carteras del 28-09, que
 *     suman el 100 % del peso) no prueba que la cartera sea parcial.
 * Comprobado contra la copia 2026-10-14T11-18-43-024Z: 571 revisiones, todas las de las vivas en juego
 * describen su cartera (fecha y recuento iguales).
 */
export function coverageFromHoldingsReview(
    review: unknown,
    live: Pick<HoldingsTreeState, 'as_of_date' | 'holdings_count'>
): HoldingsCoverage {
    if (!review || typeof review !== 'object') return 'UNKNOWN';
    const row = review as Record<string, unknown>;
    const reviewDate = normalizeHoldingsDate(row.as_of_date);
    if (!reviewDate || reviewDate !== normalizeHoldingsDate(live.as_of_date)) return 'UNKNOWN';
    const available = row.available_positions;
    if (typeof available !== 'number' || available !== live.holdings_count) return 'UNKNOWN';
    if (row.full_holdings_loaded === true) return 'COMPLETE';
    if (Array.isArray(row.review_flags) && row.review_flags.includes('CARTERA_PUBLICADA_PARCIAL')) return 'PARTIAL';
    // reported_positions sale del resumen del proveedor: solo vale si es de la misma fecha que el detalle
    // cargado (LU1254412460: 59 del resumen del 31-08 frente a 37 filas del 31-07 que suman el 100 %).
    const flags = Array.isArray(row.review_flags) ? row.review_flags : [];
    const sameDates = !flags.includes('FECHAS_CARTERA_DISCREPANTES')
        && normalizeHoldingsDate(row.summary_date) === normalizeHoldingsDate(row.detail_date);
    const reported = row.reported_positions;
    if (row.full_holdings_loaded === false && sameDates && typeof reported === 'number' && isShortHoldings(available, reported)) return 'PARTIAL';
    return 'UNKNOWN';
}

export interface HoldingsDecisionResult {
    decision: HoldingsDecision;
    warning: string | null;
    /** Por que, en una linea: fechas, posiciones, cobertura y la condicion que decide. */
    motive: string;
}

/**
 * Si la cartera mas antigua gana a la mas reciente (condiciones 1-4). `countMayKeep`: el recuento sin
 * cobertura declarada puede hacerla ganar; solo cuando la mas antigua es la viva.
 */
function olderWins(
    newer: ComparableTree,
    older: ComparableTree,
    days: number,
    countMayKeep: boolean
): { wins: boolean; why: string } {
    const maxAge = HOLDINGS_COVERAGE_MAX_AGE_DAYS;
    if (days > maxAge) return { wins: false, why: `le saca ${days} dias (> ${maxAge})` };
    if (newer.coverage === 'COMPLETE') return { wins: false, why: 'la mas reciente declara COMPLETE' };
    if (isDeclaredPartial(older.coverage)) return { wins: false, why: `la mas antigua declara ${older.coverage}` };
    if (isDeclaredPartial(newer.coverage)) {
        const enough = older.holdings_count > HOLDINGS_DECLARED_PARTIAL_MIN_OTHER && older.holdings_count > newer.holdings_count;
        // Una cartera PARTIAL mas reciente, sea el canonico o la viva, solo cede si ademas tiene menos del
        // 80 % de las posiciones que declara (declared_holdings_count) o, si no las declara, de las de la
        // otra. IE00BYX5NX33: 1.269 de 1.270 declaradas no cede; LU0208853944: 121 de 123 declaradas no cede
        // aunque la viva tenga 152. TOP_N, como estaba.
        if (enough && newer.coverage === 'PARTIAL') {
            const declared = newer.declared_holdings_count;
            const reference = typeof declared === 'number' ? declared : older.holdings_count;
            if (!isShortHoldings(newer.holdings_count, reference)) {
                const against = typeof declared === 'number' ? `de las ${declared} que declara` : 'de la otra';
                return { wins: false, why: `la mas reciente declara PARTIAL pero tiene al menos el ${HOLDINGS_SHORT_COVERAGE_PCT} % de las posiciones ${against}` };
            }
        }
        return enough
            ? { wins: true, why: `la mas reciente declara ${newer.coverage} y la mas antigua tiene mas posiciones; ${days} dias (<= ${maxAge})` }
            : { wins: false, why: `la mas reciente declara ${newer.coverage} pero la mas antigua no tiene mas de ${HOLDINGS_DECLARED_PARTIAL_MIN_OTHER} posiciones y mas que ella` };
    }
    if (!countMayKeep) return { wins: false, why: 'no esta declarada parcial: el recuento no basta para retroceder' };
    return isShortHoldings(newer.holdings_count, older.holdings_count)
        ? { wins: true, why: `la mas reciente no declara cobertura y tiene menos del ${HOLDINGS_SHORT_COVERAGE_PCT} % de las posiciones; ${days} dias (<= ${maxAge})` }
        : { wins: false, why: `la mas reciente tiene al menos el ${HOLDINGS_SHORT_COVERAGE_PCT} % de las posiciones` };
}

export function decideHoldingsRepublish(
    expected: ComparableTree,
    live: ComparableTree,
    stale: boolean
): HoldingsDecisionResult {
    const result = (decision: HoldingsDecision, motive: string, warning: string | null = null) => ({ decision, warning, motive });
    if (!stale) return result('UNCHANGED', 'viva y canonico coinciden');
    if (live.mode === 'NONE') return result('CREATE', 'no hay cartera viva');
    const expectedDate = normalizeHoldingsDate(expected.as_of_date);
    const liveDate = normalizeHoldingsDate(live.as_of_date);
    if (!expectedDate || !liveDate) {
        const missing = [!liveDate ? 'viva' : null, !expectedDate ? 'canonico' : null].filter(Boolean).join(' y ');
        return result(
            'KEEP_UNDATED',
            `sin fecha valida en ${missing}: no se compara`,
            `HOLDINGS_UNDATED: sin fecha valida en ${missing} (viva ${JSON.stringify(live.as_of_date)}, canonico ${JSON.stringify(expected.as_of_date)}); se conserva la viva.`
        );
    }
    const counts = `canonico ${expected.holdings_count} posiciones a ${expectedDate} (${expected.coverage}), viva ${live.holdings_count} a ${liveDate} (${live.coverage})`;
    if (expectedDate > liveDate) {
        const verdict = olderWins(expected, live, daysBetween(liveDate, expectedDate), true);
        return verdict.wins
            ? result('KEEP_COMPLETE_OLDER_LIVE', `se conserva la viva: ${verdict.why}; ${counts}`)
            : result('REPLACE_NEWER', `gana el canonico, mas reciente: ${verdict.why}; ${counts}`);
    }
    if (expectedDate < liveDate) {
        const verdict = olderWins(live, expected, daysBetween(expectedDate, liveDate), false);
        return verdict.wins
            ? result('REPLACE_COMPLETE_OLDER', `gana el canonico, mas completo: ${verdict.why}; ${counts}`)
            : result('KEEP_NEWER_LIVE', `se conserva la viva, mas reciente: ${verdict.why}; ${counts}`);
    }
    if (expected.content_hash === live.content_hash) return result('REPAIR_LAYOUT', `misma fecha y mismo contenido: solo cambia la forma; ${counts}`);
    if (expected.coverage === 'COMPLETE' && isDeclaredPartial(live.coverage)) return result('REPLACE_MORE_COMPLETE', `misma fecha: el canonico declara COMPLETE y la viva ${live.coverage}; ${counts}`);
    if (live.coverage === 'COMPLETE' && isDeclaredPartial(expected.coverage)) return result('KEEP_MORE_COMPLETE', `misma fecha: la viva declara COMPLETE y el canonico ${expected.coverage}; ${counts}`);
    if (expected.holdings_count > live.holdings_count) return result('REPLACE_MORE_COMPLETE', `misma fecha y el canonico tiene mas posiciones; ${counts}`);
    if (expected.holdings_count < live.holdings_count) return result('KEEP_MORE_COMPLETE', `misma fecha y la viva tiene mas posiciones; ${counts}`);
    return result('KEEP_SAME_DATE_TIE', `misma fecha y mismas posiciones con contenido distinto; ${counts}`);
}

export interface HoldingsRepublishPlan {
    asset_id: string;
    /** La viva difiere del canonico (fecha, contenido o forma). No implica que se vaya a escribir. */
    stale: boolean;
    reasons: string[];
    decision: HoldingsDecision;
    /** Se escribe la cartera del canonico. Solo si `decision` lo permite (ver decideHoldingsRepublish). */
    replace: boolean;
    warning: string | null;
    /** Motivo de la decision (ver decideHoldingsRepublish). */
    motive: string;
    expected_coverage: HoldingsCoverage;
    live_coverage: HoldingsCoverage;
    live_coverage_source: HoldingsCoverageSource;
    expected_mode: HoldingsTreeMode;
    live_mode: HoldingsTreeMode;
    expected_as_of_date: string | null;
    live_as_of_date: string | null;
    expected_hash: string;
    live_hash: string;
    expected_count: number;
    live_count: number;
    expected_chunk_count: number;
    live_chunk_count: number;
    set_operations: WriteOperation[];
    delete_paths: string[];
    expected_document_paths: string[];
    live_document_paths: string[];
}

export interface HoldingsRepublishResult {
    sets_executed: number;
    deletes_executed: number;
    postverify_ok: boolean;
}

function stableValue(value: any): any {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort()
            .map((key) => [key, stableValue(value[key])])
    );
}

function holdingsHash(holdings: any[], top10Weight: unknown): string {
    const normalized = holdings.map((holding) => JSON.stringify(stableValue(holding))).sort();
    return crypto.createHash('sha256').update(JSON.stringify({
        holdings: normalized,
        top10_weight: top10Weight === undefined ? null : top10Weight
    })).digest('hex');
}

function getHoldings(payload: Record<string, any> | undefined): any[] {
    return Array.isArray(payload?.holdings) ? payload!.holdings : [];
}

function stateFromDocuments(documents: HoldingsTreeDocument[]): HoldingsTreeState {
    const sortedDocuments = [...documents].sort((left, right) => left.path.localeCompare(right.path));
    const latest = sortedDocuments.find((doc) => doc.path.endsWith('/holdings/latest'));
    const manifest = sortedDocuments.find((doc) => doc.path.endsWith('/holdings/manifest'));
    const chunks = sortedDocuments
        .filter((doc) => /\/holdings\/manifest\/chunks\/chunk_\d{4}$/.test(doc.path))
        .sort((left, right) => Number(left.payload.chunk_index ?? 0) - Number(right.payload.chunk_index ?? 0));

    let mode: HoldingsTreeMode = 'NONE';
    if (latest && (manifest || chunks.length > 0)) mode = 'MIXED';
    else if (latest) mode = 'SINGLE_DOCUMENT';
    else if (manifest || chunks.length > 0) mode = 'CHUNKED';

    const primary = mode === 'SINGLE_DOCUMENT' ? latest : manifest;
    const holdings = mode === 'SINGLE_DOCUMENT'
        ? getHoldings(latest?.payload)
        : chunks.flatMap((chunk) => getHoldings(chunk.payload));
    const declaredCount = primary?.payload.holdings_count;
    const declaredChunkCount = manifest?.payload.chunk_count;
    const declaredCoverage = String(primary?.payload.provenance?.coverage ?? '');
    const coverage: HoldingsCoverage = COVERAGES.has(declaredCoverage) ? declaredCoverage as HoldingsCoverage : 'UNKNOWN';
    const declaredHoldings = primary?.payload.provenance?.declared_holdings_count;

    return {
        mode,
        as_of_date: typeof primary?.payload.as_of_date === 'string' ? primary.payload.as_of_date : null,
        content_hash: holdingsHash(holdings, primary?.payload.top10_weight),
        holdings_count: declaredCount === null || declaredCount === undefined
            ? holdings.length
            : Number(declaredCount),
        chunk_count: mode === 'CHUNKED' || mode === 'MIXED'
            ? (declaredChunkCount === null || declaredChunkCount === undefined
                ? chunks.length
                : Number(declaredChunkCount))
            : 0,
        coverage,
        coverage_source: coverage === 'UNKNOWN' ? 'none' : 'provenance',
        declared_holdings_count: Number.isInteger(declaredHoldings) && declaredHoldings >= 0 ? declaredHoldings : null,
        document_paths: sortedDocuments.map((doc) => doc.path),
        documents: sortedDocuments
    };
}

function stateFromOperations(operations: WriteOperation[]): HoldingsTreeState {
    return stateFromDocuments(operations.map((operation) => ({
        path: operation.path,
        payload: operation.payload
    })));
}

function samePaths(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function readPersistedHoldingsTree(
    db: admin.firestore.Firestore,
    assetId: string
): Promise<HoldingsTreeState> {
    const latestPath = `assets/${assetId}/holdings/latest`;
    const manifestPath = `assets/${assetId}/holdings/manifest`;
    const chunksPath = `assets/${assetId}/holdings/manifest/chunks`;
    const [latestSnap, manifestSnap, chunksSnap] = await Promise.all([
        db.doc(latestPath).get(),
        db.doc(manifestPath).get(),
        db.collection(chunksPath).get()
    ]);

    const documents: HoldingsTreeDocument[] = [];
    if (latestSnap.exists) documents.push({ path: latestPath, payload: (latestSnap.data() || {}) as Record<string, any> });
    if (manifestSnap.exists) documents.push({ path: manifestPath, payload: (manifestSnap.data() || {}) as Record<string, any> });
    for (const chunk of chunksSnap.docs) {
        documents.push({
            path: chunk.ref?.path || `${chunksPath}/${chunk.id}`,
            payload: (chunk.data() || {}) as Record<string, any>
        });
    }
    return stateFromDocuments(documents);
}

/**
 * La viva con su cobertura: la de su `provenance` y, si no la declara, la de
 * fund_profile/latest.holdings_review cuando describe esta misma cartera (coverageFromHoldingsReview).
 */
export async function readLiveHoldingsTree(
    db: admin.firestore.Firestore,
    assetId: string
): Promise<HoldingsTreeState> {
    const live = await readPersistedHoldingsTree(db, assetId);
    if (live.mode === 'NONE' || live.coverage !== 'UNKNOWN') return live;
    const profile = await db.doc(`assets/${assetId}/fund_profile/latest`).get();
    const reviewed = coverageFromHoldingsReview(profile.exists ? profile.data()?.holdings_review : null, live);
    return reviewed === 'UNKNOWN' ? live : { ...live, coverage: reviewed, coverage_source: 'holdings_review' };
}

export async function planHoldingsRepublish(
    db: admin.firestore.Firestore,
    assetId: string,
    records: FondosDbHoldingRecord[],
    nowIso: string
): Promise<HoldingsRepublishPlan> {
    const operations = buildHoldingsOperations(assetId, records, nowIso);
    for (const operation of operations) validateHoldingsOperation(operation);
    const expected = stateFromOperations(operations);
    const live = await readLiveHoldingsTree(db, assetId);
    const reasons: string[] = [];
    if (live.mode === 'NONE') reasons.push('missing');
    if (expected.mode !== live.mode) reasons.push('storage_mode');
    if (expected.as_of_date !== live.as_of_date) reasons.push('as_of_date');
    if (expected.content_hash !== live.content_hash) reasons.push('content_hash');
    if (expected.holdings_count !== live.holdings_count) reasons.push('holdings_count');
    if (expected.chunk_count !== live.chunk_count) reasons.push('chunk_count');
    if (!samePaths(expected.document_paths, live.document_paths)) reasons.push('document_layout');

    const expectedPaths = new Set(expected.document_paths);
    const stale = reasons.length > 0;
    const { decision, warning, motive } = decideHoldingsRepublish(expected, live, stale);
    const replace = decisionWrites(decision);
    return {
        asset_id: assetId,
        stale,
        reasons,
        decision,
        replace,
        warning,
        motive,
        expected_coverage: expected.coverage,
        live_coverage: live.coverage,
        live_coverage_source: live.coverage_source,
        expected_mode: expected.mode,
        live_mode: live.mode,
        expected_as_of_date: expected.as_of_date,
        live_as_of_date: live.as_of_date,
        expected_hash: expected.content_hash,
        live_hash: live.content_hash,
        expected_count: expected.holdings_count,
        live_count: live.holdings_count,
        expected_chunk_count: expected.chunk_count,
        live_chunk_count: live.chunk_count,
        set_operations: replace ? operations : [],
        delete_paths: replace
            ? live.document_paths.filter((documentPath) => !expectedPaths.has(documentPath))
            : [],
        expected_document_paths: expected.document_paths,
        live_document_paths: live.document_paths
    };
}

function validateHoldingsOperation(operation: WriteOperation): void {
    if (!isAllowedHoldingsSetPath(operation.path)) {
        throw new Error(`HOLDINGS_SET_PATH_FORBIDDEN: ${operation.path}`);
    }
    const result = validateHoldingsPayload(operation.payload);
    if (!result.ok) {
        const errors = result.errors.map((error) => `${error.instancePath || '/'} ${error.message || ''}`.trim());
        throw new Error(`${operation.path}: holdings no valida contrato: ${errors.join('; ')}`);
    }
}

function orderedSets(plan: HoldingsRepublishPlan): WriteOperation[] {
    if (plan.expected_mode !== 'CHUNKED') return plan.set_operations;
    return [...plan.set_operations].sort((left, right) => {
        const leftManifest = left.path.endsWith('/holdings/manifest') ? 1 : 0;
        const rightManifest = right.path.endsWith('/holdings/manifest') ? 1 : 0;
        return leftManifest - rightManifest || left.path.localeCompare(right.path);
    });
}

function orderedDeletes(paths: string[]): string[] {
    return [...paths].sort((left, right) => {
        const leftManifest = left.endsWith('/holdings/manifest') ? 1 : 0;
        const rightManifest = right.endsWith('/holdings/manifest') ? 1 : 0;
        return leftManifest - rightManifest || left.localeCompare(right);
    });
}

export async function executeHoldingsRepublish(
    db: admin.firestore.Firestore,
    plan: HoldingsRepublishPlan
): Promise<HoldingsRepublishResult> {
    if (!plan.replace) return { sets_executed: 0, deletes_executed: 0, postverify_ok: true };
    if (!decisionWrites(plan.decision)) {
        throw new Error(`HOLDINGS_REGRESSION_BLOCKED: ${plan.asset_id} (${plan.decision})`);
    }

    // La decision se tomo sobre la cartera viva que leyo el plan. Si alguien la ha cambiado
    // despues, se para: escribir ahora podria hacer retroceder una cartera mas reciente.
    const current = await readPersistedHoldingsTree(db, plan.asset_id);
    const unchangedSincePlan = current.mode === plan.live_mode
        && current.as_of_date === plan.live_as_of_date
        && current.content_hash === plan.live_hash
        && samePaths(current.document_paths, plan.live_document_paths);
    if (!unchangedSincePlan) {
        throw new Error(`HOLDINGS_CONCURRENT_MODIFICATION: ${plan.asset_id} cambio entre el plan y la escritura.`);
    }

    for (const operation of plan.set_operations) validateHoldingsOperation(operation);
    for (const deletePath of plan.delete_paths) {
        if (!isAllowedHoldingsDeletePath(deletePath)) {
            throw new Error(`HOLDINGS_DELETE_PATH_FORBIDDEN: ${deletePath}`);
        }
    }

    const setOperations = orderedSets(plan);
    const deletePaths = orderedDeletes(plan.delete_paths);
    if (setOperations.length + deletePaths.length > 500) {
        throw new Error(`HOLDINGS_ATOMIC_BATCH_TOO_LARGE: ${plan.asset_id}`);
    }
    // El arbol de holdings cambia como una sola unidad: el manifest nunca queda
    // apuntando a una mezcla de chunks antiguos y nuevos si una escritura falla.
    const batch = db.batch();
    for (const operation of setOperations) batch.set(db.doc(operation.path), operation.payload);
    for (const deletePath of deletePaths) batch.delete(db.doc(deletePath));
    await batch.commit();
    const setsExecuted = setOperations.length;
    const deletesExecuted = deletePaths.length;

    const after = await readPersistedHoldingsTree(db, plan.asset_id);
    const postverifyOk = after.mode === plan.expected_mode
        && after.as_of_date === plan.expected_as_of_date
        && after.content_hash === plan.expected_hash
        && after.holdings_count === plan.expected_count
        && after.chunk_count === plan.expected_chunk_count
        && samePaths(after.document_paths, plan.expected_document_paths);
    if (!postverifyOk) throw new Error(`HOLDINGS_POSTVERIFY_FAILED: ${plan.asset_id}`);

    return { sets_executed: setsExecuted, deletes_executed: deletesExecuted, postverify_ok: true };
}
