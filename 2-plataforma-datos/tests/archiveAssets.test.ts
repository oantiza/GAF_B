import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARCHIVED_COLLECTION, archiveAssets, removeFromSearchIndex, type ArchiveDb, type ArchiveDocRef } from '../src/loader/archiveAssets';

/** Firestore en memoria: documentos por ruta, subcolecciones deducidas de las rutas. */
function fakeDb(initial: Record<string, Record<string, unknown>>) {
    const docs = new Map<string, Record<string, unknown>>(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
    // updateTime por documento: cada escritura sube la version
    const versions = new Map<string, number>();
    const bump = (p: string) => versions.set(p, (versions.get(p) || 0) + 1);
    const updateTime = (p: string) => admin.firestore.Timestamp.fromMillis((versions.get(p) || 0) * 1000 + 1000);
    const hooks: { beforeIndexWrite: (() => void) | null; afterCommit: (() => void) | null } = { beforeIndexWrite: null, afterCommit: null };
    const stats = { indexRejected: 0 };

    function docRef(docPath: string): ArchiveDocRef {
        const id = docPath.split('/').at(-1) as string;
        return {
            id,
            path: docPath,
            get: async () => ({ exists: docs.has(docPath), id, ref: docRef(docPath), updateTime: docs.has(docPath) ? updateTime(docPath) : undefined, data: () => (docs.has(docPath) ? structuredClone(docs.get(docPath)) : undefined) }),
            update: async (data, precondition) => {
                hooks.beforeIndexWrite?.();
                if (!docs.has(docPath)) throw Object.assign(new Error('5 NOT_FOUND'), { code: 5 });
                if (!precondition?.lastUpdateTime?.isEqual(updateTime(docPath))) {
                    stats.indexRejected++;
                    throw Object.assign(new Error('9 FAILED_PRECONDITION'), { code: 9 });
                }
                const next: Record<string, unknown> = { ...docs.get(docPath) };
                for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
                    if (value instanceof admin.firestore.FieldValue) delete next[key];
                    else next[key] = structuredClone(value);
                }
                docs.set(docPath, next);
                bump(docPath);
            },
            create: async (data) => {
                hooks.beforeIndexWrite?.();
                if (docs.has(docPath)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
                docs.set(docPath, structuredClone(data));
                bump(docPath);
            },
            listCollections: async () => {
                const names = new Set<string>();
                for (const p of docs.keys()) {
                    if (p.startsWith(docPath + '/')) names.add(p.slice(docPath.length + 1).split('/')[0]);
                }
                return [...names].sort().map((name) => ({
                    id: name,
                    // como el SDK: tambien los documentos ausentes con subcolecciones debajo
                    listDocuments: async () => {
                        const prefix = `${docPath}/${name}/`;
                        const ids = new Set<string>();
                        for (const p of docs.keys()) if (p.startsWith(prefix)) ids.add(p.slice(prefix.length).split('/')[0]);
                        return [...ids].sort().map((id) => docRef(`${prefix}${id}`));
                    }
                }));
            },
            collection: (name: string) => ({ doc: (childId: string) => docRef(`${docPath}/${name}/${childId}`) })
        };
    }

    const db: ArchiveDb = {
        collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
        doc: (p: string) => docRef(p),
        batch: () => {
            const pending: Array<() => void> = [];
            return {
                set: (ref, data) => pending.push(() => { docs.set(ref.path, structuredClone(data)); bump(ref.path); }),
                delete: (ref) => pending.push(() => { docs.delete(ref.path); bump(ref.path); }),
                commit: async () => { pending.forEach((fn) => fn()); hooks.afterCommit?.(); }
            };
        }
    };
    /** Escritura de otro proceso sobre un documento (sube su updateTime). */
    const external = (p: string, data: Record<string, unknown>) => { docs.set(p, structuredClone(data)); bump(p); };
    return { db, docs, hooks, stats, external };
}

const GATE_ON = { BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' } as NodeJS.ProcessEnv;
const GATE_OFF = {} as NodeJS.ProcessEnv;

function seed() {
    return {
        'assets/LU0000000001': { asset_type: 'FUND', identity: { name: 'Fondo Uno' }, quality: { status: 'OK', score: 80 } },
        'assets/LU0000000001/metrics/latest': { sharpe: 1.1 },
        'assets/LU0000000001/price_series/2024': { points: 250 },
        'assets/LU0000000001/holdings/chunks/parts/0001': { rows: 3 },
        'assets/IE0000000002': { asset_type: 'ETF', identity: { name: 'ETF Dos' } },
        'meta/search_index': { schema_version: 'master.search-index.v1', count: 2, updated_at: '2026-09-01T00:00:00Z', entries: [
            { id: 'LU0000000001', name: 'Fondo Uno', name_folded: 'fondo uno', type: 'FUND' },
            { id: 'IE0000000002', name: 'ETF Dos', name_folded: 'etf dos', type: 'ETF' }
        ] }
    };
}

describe('archive:assets', () => {
    let outDir: string;
    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
    });
    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('la pasada en seco cuenta subdocumentos e indice y no toca nada', async () => {
        const { db, docs } = fakeDb(seed());
        const before = new Map(docs);
        const { summary, plan } = await archiveAssets(db, ['LU0000000001', 'XX0000000009', 'LU0000000001'], { write: false, outDir, env: GATE_OFF, runId: 'r1' });
        expect(plan.map((r) => [r.asset_id, r.action, r.subdocs, r.in_search_index])).toEqual([
            ['LU0000000001', 'ARCHIVE', 3, true],
            ['XX0000000009', 'MISSING', 0, false]
        ]);
        expect(plan[0].name).toBe('Fondo Uno');
        expect(summary).toMatchObject({ requested: 2, found: 1, to_archive: 1, subdocs_total: 3, in_search_index: 1, archived: 0, missing: ['XX0000000009'], backups: [] });
        expect([...docs.entries()]).toEqual([...before.entries()]);
        expect(fs.existsSync(path.join(outDir, 'archive_summary.json'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(outDir, 'archive_plan.json'), 'utf-8'))).toHaveLength(2);
    });

    it('sin gate no se puede escribir', async () => {
        const { db } = fakeDb(seed());
        await expect(archiveAssets(db, ['LU0000000001'], { write: true, outDir, env: GATE_OFF })).rejects.toThrow('SECURITY FAULT');
    });

    it('con gate: copia local, copia a _archived_assets, retira el original y su entrada del indice, y postverifica', async () => {
        const { db, docs } = fakeDb(seed());
        const { summary, plan } = await archiveAssets(db, ['LU0000000001'], {
            write: true, outDir, env: GATE_ON, runId: 'r2', reason: 'alta erronea', now: () => '2026-09-05T12:00:00Z'
        });

        // copia local restaurable, con raiz y subdocumentos
        const backup = JSON.parse(fs.readFileSync(path.join(outDir, 'backup_LU0000000001.json'), 'utf-8'));
        expect(backup.root.identity.name).toBe('Fondo Uno');
        // «holdings/chunks» es un documento ausente con subcoleccion: no se copia como doc, pero lo de debajo si
        expect(backup.subdocs.map((s: { rel: string }) => s.rel).sort()).toEqual(['holdings/chunks/parts/0001', 'metrics/latest', 'price_series/2024']);
        expect(backup.reason).toBe('alta erronea');

        // copia en la maestra, con estado y metadatos de archivo
        const copia = docs.get(`${ARCHIVED_COLLECTION}/LU0000000001`) as Record<string, any>;
        expect(copia.quality).toEqual({ status: 'ARCHIVED_LEGACY', score: 80 });
        expect(copia.archived).toEqual({ at: '2026-09-05T12:00:00Z', from: 'assets/LU0000000001', reason: 'alta erronea', run_id: 'r2' });
        expect(docs.get(`${ARCHIVED_COLLECTION}/LU0000000001/metrics/latest`)).toEqual({ sharpe: 1.1 });
        expect(docs.get(`${ARCHIVED_COLLECTION}/LU0000000001/holdings/chunks/parts/0001`)).toEqual({ rows: 3 });

        // el original ya no esta, ni sus subdocumentos
        expect([...docs.keys()].filter((p) => p.startsWith('assets/LU0000000001'))).toEqual([]);
        // el otro activo sigue intacto
        expect(docs.get('assets/IE0000000002')).toEqual({ asset_type: 'ETF', identity: { name: 'ETF Dos' } });

        // indice sin la entrada
        const index = docs.get('meta/search_index') as Record<string, any>;
        expect(index.entries.map((e: { id: string }) => e.id)).toEqual(['IE0000000002']);
        expect(index.count).toBe(1);
        expect(index.updated_at).toBe('2026-09-05T12:00:00Z');

        expect(summary).toMatchObject({ archived: 1, subdocs_copied: 3, docs_deleted: 4, search_index_removed: 1, postverify_ok: 1, postverify_failed: 0, errors: [] });
        expect(plan[0].postverify).toEqual({ archived_root: true, archived_subdocs: 3, original_gone: true, index_entry_gone: true, ok: true });
        expect(summary.backups).toEqual([path.join(outDir, 'backup_LU0000000001.json')]);
    });

    it('archivar un id que no existe no escribe ni falla; el indice solo se toca si cambia', async () => {
        const { db, docs } = fakeDb(seed());
        const { summary } = await archiveAssets(db, ['XX0000000009'], { write: true, outDir, env: GATE_ON, runId: 'r3' });
        expect(summary).toMatchObject({ found: 0, archived: 0, search_index_removed: 0, postverify_ok: 0, errors: [] });
        expect((docs.get('meta/search_index') as Record<string, any>).updated_at).toBe('2026-09-01T00:00:00Z');
        expect(removeFromSearchIndex({ entries: [{ id: 'A' }] }, new Set(['B']), 'x')).toBeNull();
        expect(removeFromSearchIndex({ entries: [{ id: 'A' }, { id: 'B' }], count: 2 }, new Set(['B']), 'x')).toEqual({ entries: [{ id: 'A' }], count: 1, updated_at: 'x' });
    });

    it('C2: no pisa una entrada que la app anade al indice mientras se copia y se borra', async () => {
        const { db, docs, hooks, external } = fakeDb(seed());
        let added = false;
        hooks.afterCommit = () => {
            if (added) return;
            added = true;
            // alta de la app entre la lectura del plan y la retirada del indice
            const index = docs.get('meta/search_index') as Record<string, any>;
            const entries = [...index.entries, { id: 'FR0000000003', name: 'Alta de la app', name_folded: 'alta de la app', type: 'FUND' }];
            external('meta/search_index', { ...index, entries, count: entries.length });
        };
        const { summary } = await archiveAssets(db, ['LU0000000001'], { write: true, outDir, env: GATE_ON, runId: 'r4', now: () => '2026-09-05T12:00:00Z' });

        const index = docs.get('meta/search_index') as Record<string, any>;
        expect(index.entries.map((e: { id: string }) => e.id)).toEqual(['IE0000000002', 'FR0000000003']);
        expect(index.count).toBe(2);
        expect(summary).toMatchObject({ archived: 1, search_index_removed: 1, postverify_ok: 1, errors: [] });
    });

    it('C2: si el indice cambia entre su lectura y la escritura, vuelve a leer y reintenta', async () => {
        const { db, docs, hooks, stats, external } = fakeDb(seed());
        let concurrent = true;
        hooks.beforeIndexWrite = () => {
            if (!concurrent) return;
            concurrent = false;
            const index = docs.get('meta/search_index') as Record<string, any>;
            external('meta/search_index', { ...index, entries: [...index.entries, { id: 'FR0000000004', name: 'Otra', name_folded: 'otra', type: 'FUND' }], count: 3 });
        };
        const { summary } = await archiveAssets(db, ['LU0000000001'], { write: true, outDir, env: GATE_ON, runId: 'r5', now: () => '2026-09-05T12:00:00Z' });

        expect(stats.indexRejected).toBe(1);
        expect((docs.get('meta/search_index') as Record<string, any>).entries.map((e: { id: string }) => e.id)).toEqual(['IE0000000002', 'FR0000000004']);
        expect(summary).toMatchObject({ search_index_removed: 1, postverify_ok: 1, errors: [] });
    });
});
