/**
 * src/loader/archiveAssets.ts — archivar activos de la maestra, con la disciplina del writer.
 *
 *   npm run archive:assets -- --ids LU0000000001,IE0000000002 --out <dir> --dry-run
 *   npm run archive:assets -- --ids LU0000000001 --out <dir> --write --reason "alta erronea"
 *
 * Que hace por cada id (solo con --write y el gate de plataforma):
 *  1. Copia restaurable en local: <out>/backup_<id>.json con la raiz y TODAS sus subcolecciones.
 *  2. Copia a `_archived_assets/{id}` (raiz + subcolecciones) con `archived` (cuando, desde donde,
 *     por que, run) y `quality.status = ARCHIVED_LEGACY` (poblacion no activa, DATA_GOVERNANCE).
 *  3. Retira el original de `assets` (subcolecciones y raiz): sin solapamiento assets ∩ _archived_assets,
 *     que el integrity_check de la app marca como anomalia.
 *  4. Quita su entrada de `meta/search_index`, sobre el indice que lee justo antes de escribir, con
 *     precondicion lastUpdateTime y reintento (searchIndexWrite.ts): no pisa una entrada que otro
 *     escritor haya anadido mientras se copiaba y borraba.
 *  5. Postverify: copia completa, original ausente, indice sin la entrada.
 *
 * Sin --write no toca nada: solo dice que hay (existe, subdocumentos, en el indice, ya archivado).
 * Nunca borra sin copia: no existe un modo de borrado fisico en este script.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import { getDb, isPlatformWriteAuthorized } from './writer';
import { SEARCH_INDEX_PATH } from './searchIndex';
import { rebuildSearchIndexWithRetry } from './searchIndexWrite';

const PLATFORM_WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const PLATFORM_WRITE_GATE_VALUE = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';
export const ARCHIVED_COLLECTION = '_archived_assets';
export const ARCHIVED_STATUS = 'ARCHIVED_LEGACY';
const BATCH_LIMIT = 450;

// --- Firestore minimo (lo que usa el script), para poder probarlo con un doble en memoria.
export interface ArchiveDocSnapshot {
    exists: boolean;
    id: string;
    ref: ArchiveDocRef;
    /** Para la precondicion al escribir meta/search_index. */
    updateTime?: admin.firestore.Timestamp;
    data(): Record<string, unknown> | undefined;
}
export interface ArchiveCollectionRef {
    id: string;
    /** Todas las referencias, tambien las de documentos «ausentes» que solo existen
     *  por tener subcolecciones: un `get()` no las devolveria y se perderia lo de debajo. */
    listDocuments(): Promise<ArchiveDocRef[]>;
}
export interface ArchiveDocRef {
    id: string;
    path: string;
    get(): Promise<ArchiveDocSnapshot>;
    listCollections(): Promise<ArchiveCollectionRef[]>;
    collection(name: string): { doc(id: string): ArchiveDocRef };
    /** Solo para meta/search_index (searchIndexWrite.ts). */
    update(data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition): Promise<unknown>;
    create(data: Record<string, unknown>): Promise<unknown>;
}
export interface ArchiveBatch {
    set(ref: ArchiveDocRef, data: Record<string, unknown>): unknown;
    delete(ref: ArchiveDocRef): unknown;
    commit(): Promise<unknown>;
}
export interface ArchiveDb {
    collection(name: string): { doc(id: string): ArchiveDocRef };
    doc(path: string): ArchiveDocRef;
    batch(): ArchiveBatch;
}

export interface ArchivedSubdoc {
    rel: string; // "metrics/latest", "price_series/2024"
    data: Record<string, unknown>;
}

export interface ArchivePlanRow {
    asset_id: string;
    action: 'ARCHIVE' | 'MISSING';
    exists: boolean;
    name: string | null;
    type: string | null;
    subdocs: number;
    in_search_index: boolean;
    archived_copy_exists: boolean;
    backup_file?: string;
    postverify?: {
        archived_root: boolean;
        archived_subdocs: number;
        original_gone: boolean;
        index_entry_gone: boolean;
        ok: boolean;
    };
}

export interface ArchiveSummary {
    run_id: string;
    write: boolean;
    reason: string;
    requested: number;
    found: number;
    missing: string[];
    to_archive: number;
    subdocs_total: number;
    in_search_index: number;
    archived: number;
    subdocs_copied: number;
    docs_deleted: number;
    search_index_removed: number;
    postverify_ok: number;
    postverify_failed: number;
    backups: string[];
    errors: Array<{ asset_id: string; error: string }>;
    note: string;
}

export interface ArchiveOptions {
    write: boolean;
    outDir: string;
    reason?: string;
    runId?: string;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
}

export function assertArchiveWriteGate(write: boolean, env: NodeJS.ProcessEnv = process.env): void {
    if (write && !isPlatformWriteAuthorized(env)) {
        throw new Error(`SECURITY FAULT: ${PLATFORM_WRITE_GATE} debe valer '${PLATFORM_WRITE_GATE_VALUE}' para archivar en la maestra.`);
    }
}

async function listSubdocs(ref: ArchiveDocRef): Promise<Array<{ rel: string; ref: ArchiveDocRef; data: Record<string, unknown> }>> {
    const out: Array<{ rel: string; ref: ArchiveDocRef; data: Record<string, unknown> }> = [];
    async function walk(current: ArchiveDocRef, prefix: string): Promise<void> {
        for (const col of await current.listCollections()) {
            for (const child of await col.listDocuments()) {
                const rel = prefix ? `${prefix}/${col.id}/${child.id}` : `${col.id}/${child.id}`;
                const snap = await child.get();
                if (snap.exists) out.push({ rel, ref: child, data: snap.data() || {} });
                await walk(child, rel);
            }
        }
    }
    await walk(ref, '');
    return out;
}

function refUnder(root: ArchiveDocRef, rel: string): ArchiveDocRef {
    const parts = rel.split('/');
    let ref = root.collection(parts[0]).doc(parts[1]);
    for (let i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
    return ref;
}

async function commitInChunks(db: ArchiveDb, ops: Array<(batch: ArchiveBatch) => void>): Promise<void> {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
        await batch.commit();
    }
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/** Entradas del indice sin los ids dados; null si no habia que tocar nada. */
export function removeFromSearchIndex(existing: unknown, ids: Set<string>, updatedAt: string): Record<string, unknown> | null {
    const doc = (existing && typeof existing === 'object' ? existing : {}) as Record<string, unknown>;
    const entries = Array.isArray(doc.entries) ? doc.entries : [];
    const kept = entries.filter((e) => !(e && typeof e === 'object' && ids.has(String((e as Record<string, unknown>).id))));
    if (kept.length === entries.length) return null;
    return { ...doc, entries: kept, count: kept.length, updated_at: updatedAt };
}

function indexHas(existing: unknown, id: string): boolean {
    const entries = (existing as { entries?: unknown } | null)?.entries;
    return Array.isArray(entries) && entries.some((e) => e && typeof e === 'object' && (e as Record<string, unknown>).id === id);
}

export async function archiveAssets(db: ArchiveDb, ids: string[], options: ArchiveOptions): Promise<{ summary: ArchiveSummary; plan: ArchivePlanRow[] }> {
    const env = options.env ?? process.env;
    assertArchiveWriteGate(options.write, env);
    const now = options.now ?? (() => new Date().toISOString());
    const runId = options.runId ?? now().replace(/[:.]/g, '-');
    const reason = (options.reason || '').trim();
    const uniqueIds = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
    fs.mkdirSync(options.outDir, { recursive: true });

    const indexRef = db.doc(SEARCH_INDEX_PATH);
    const indexSnap = await indexRef.get();
    const indexDoc = indexSnap.exists ? indexSnap.data() : undefined;

    const plan: ArchivePlanRow[] = [];
    const errors: Array<{ asset_id: string; error: string }> = [];
    const backups: string[] = [];
    let subdocsCopied = 0;
    let docsDeleted = 0;
    let archived = 0;

    for (const id of uniqueIds) {
        try {
            const ref = db.collection('assets').doc(id);
            const snap = await ref.get();
            const archivedRoot = db.collection(ARCHIVED_COLLECTION).doc(id);
            const archivedSnap = await archivedRoot.get();
            if (!snap.exists) {
                plan.push({
                    asset_id: id, action: 'MISSING', exists: false, name: null, type: null, subdocs: 0,
                    in_search_index: indexHas(indexDoc, id), archived_copy_exists: archivedSnap.exists
                });
                continue;
            }
            const data = snap.data() || {};
            const identity = (data.identity && typeof data.identity === 'object' ? data.identity : {}) as Record<string, unknown>;
            const subdocs = await listSubdocs(ref);
            const row: ArchivePlanRow = {
                asset_id: id, action: 'ARCHIVE', exists: true,
                name: firstString(identity.name, data.name),
                type: firstString(data.asset_type, data.type),
                subdocs: subdocs.length,
                in_search_index: indexHas(indexDoc, id),
                archived_copy_exists: archivedSnap.exists
            };
            plan.push(row);
            if (!options.write) continue;

            // 1. copia restaurable en local, ANTES de tocar Firestore
            const backupPath = path.join(options.outDir, `backup_${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
            fs.writeFileSync(backupPath, JSON.stringify({
                asset_id: id, archived_at: now(), run_id: runId, reason,
                root: data, subdocs: subdocs.map((s): ArchivedSubdoc => ({ rel: s.rel, data: s.data }))
            }, null, 2) + '\n', 'utf-8');
            row.backup_file = backupPath;
            backups.push(backupPath);

            // 2. copia a _archived_assets
            const quality = (data.quality && typeof data.quality === 'object' ? data.quality : {}) as Record<string, unknown>;
            const copyOps: Array<(batch: ArchiveBatch) => void> = [
                (batch) => batch.set(archivedRoot, {
                    ...data,
                    quality: { ...quality, status: ARCHIVED_STATUS },
                    archived: { at: now(), from: ref.path, reason: reason || null, run_id: runId }
                })
            ];
            for (const doc of subdocs) copyOps.push((batch) => batch.set(refUnder(archivedRoot, doc.rel), doc.data));
            await commitInChunks(db, copyOps);
            subdocsCopied += subdocs.length;

            // 3. retirar el original (hojas primero, raiz al final)
            const deleteOps: Array<(batch: ArchiveBatch) => void> = [...subdocs].reverse().map((doc) => (batch: ArchiveBatch) => batch.delete(doc.ref));
            deleteOps.push((batch) => batch.delete(ref));
            await commitInChunks(db, deleteOps);
            docsDeleted += deleteOps.length;
            archived++;
        } catch (e: any) {
            errors.push({ asset_id: id, error: String(e?.message || e) });
        }
    }

    // 4. indice de busqueda
    let searchIndexRemoved = 0;
    const archivedIds = new Set(plan.filter((r) => r.action === 'ARCHIVE' && r.backup_file).map((r) => r.asset_id));
    if (options.write && archivedIds.size > 0) {
        // La lectura del principio solo sirve para el plan: se retira sobre el indice actual (C2).
        try {
            let entriesBefore = 0;
            const written = await rebuildSearchIndexWithRetry(indexRef, (current) => {
                entriesBefore = Array.isArray(current?.entries) ? current.entries.length : 0;
                return removeFromSearchIndex(current, archivedIds, now());
            });
            if (written.written && written.payload) searchIndexRemoved = entriesBefore - (written.payload.entries as unknown[]).length;
        } catch (e: any) {
            errors.push({ asset_id: SEARCH_INDEX_PATH, error: String(e?.message || e) });
        }
    }

    // 5. postverify
    let postverifyOk = 0;
    let postverifyFailed = 0;
    if (options.write) {
        const indexAfter = (await indexRef.get()).data();
        for (const row of plan) {
            if (row.action !== 'ARCHIVE' || !row.backup_file) continue;
            const archivedRoot = db.collection(ARCHIVED_COLLECTION).doc(row.asset_id);
            const original = db.collection('assets').doc(row.asset_id);
            const archivedRootSnap = await archivedRoot.get();
            const originalSnap = await original.get();
            const originalSubdocs = await listSubdocs(original);
            const verify = {
                archived_root: archivedRootSnap.exists,
                archived_subdocs: (await listSubdocs(archivedRoot)).length,
                original_gone: !originalSnap.exists && originalSubdocs.length === 0,
                index_entry_gone: !indexHas(indexAfter, row.asset_id),
                ok: false
            };
            verify.ok = verify.archived_root && verify.archived_subdocs === row.subdocs && verify.original_gone && verify.index_entry_gone;
            row.postverify = verify;
            if (verify.ok) postverifyOk++;
            else {
                postverifyFailed++;
                errors.push({ asset_id: row.asset_id, error: `postverify failed: ${JSON.stringify(verify)}` });
            }
        }
    }

    const found = plan.filter((r) => r.exists);
    const summary: ArchiveSummary = {
        run_id: runId,
        write: options.write,
        reason,
        requested: uniqueIds.length,
        found: found.length,
        missing: plan.filter((r) => !r.exists).map((r) => r.asset_id),
        to_archive: found.length,
        subdocs_total: found.reduce((acc, r) => acc + r.subdocs, 0),
        in_search_index: plan.filter((r) => r.in_search_index).length,
        archived,
        subdocs_copied: subdocsCopied,
        docs_deleted: docsDeleted,
        search_index_removed: searchIndexRemoved,
        postverify_ok: postverifyOk,
        postverify_failed: postverifyFailed,
        backups,
        errors,
        note: `Copia local restaurable + copia a ${ARCHIVED_COLLECTION}/{id} (quality.status=${ARCHIVED_STATUS}) + retirada de assets/{id} y de ${SEARCH_INDEX_PATH}. Sin borrado fisico sin copia.`
    };
    fs.writeFileSync(path.join(options.outDir, 'archive_summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(options.outDir, 'archive_plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
    return { summary, plan };
}

// ------------------------------------------------------------------ CLI
function getFlag(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function readIds(raw: string | undefined): string[] {
    if (!raw) throw new Error('Falta --ids <isin,isin|fichero>.');
    if (fs.existsSync(raw)) {
        return fs.readFileSync(raw, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
    dotenv.config({ path: path.join(process.cwd(), '.env.local') });
    const argv = process.argv.slice(2);
    const write = argv.includes('--write');
    if (!write && !argv.includes('--dry-run')) {
        console.log('[archive] sin --write: pasada en seco (usa --dry-run para silenciar este aviso).');
    }
    assertArchiveWriteGate(write);
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.FIREBASE_SERVICE_ACCOUNT_PATH.replace(/^["']|["']$/g, '');
    }
    const ids = readIds(getFlag(argv, '--ids'));
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(getFlag(argv, '--out') || path.join(process.cwd(), 'runs'), `archive_${runId}`);
    const db = getDb() as unknown as ArchiveDb;
    const { summary } = await archiveAssets(db, ids, { write, outDir, reason: getFlag(argv, '--reason'), runId });
    console.log(`[archive] write=${write} requested=${summary.requested} found=${summary.found} missing=${summary.missing.length} subdocs=${summary.subdocs_total} in_index=${summary.in_search_index}`);
    if (write) console.log(`[archive] archivados=${summary.archived} subdocs_copiados=${summary.subdocs_copied} borrados=${summary.docs_deleted} indice=${summary.search_index_removed} postverify ${summary.postverify_ok}/${summary.postverify_ok + summary.postverify_failed} errores=${summary.errors.length}`);
    else console.log(`[archive] DRY-RUN: 0 escrituras. ${summary.to_archive} activo(s) se archivarian. Revisa archive_plan.json.`);
    console.log(`[archive] artefactos en ${outDir}`);
    if (summary.errors.length) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((e) => {
        console.error('[archive] ERROR:', e?.message || e);
        process.exit(1);
    });
}
