import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { reconcileSearchIndexLive } from '../scripts/reconcileSearchIndexLive';
import { executePlan } from '../src/loader/writer';
import {
    rebuildSearchIndexWithRetry,
    SEARCH_INDEX_WRITE_MAX_ATTEMPTS,
    SearchIndexConcurrentModificationError,
    writeSearchIndexWithPrecondition
} from '../src/loader/searchIndexWrite';
import { FakeSearchIndexRef } from './helpers/fakeSearchIndexRef';

const GATE = { BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' };

function entry(id: string, name: string, type = 'FUND') {
    return { id, name, name_folded: name.toLowerCase(), type };
}

function indexDoc(entries: Array<ReturnType<typeof entry>>, updatedAt = '2026-10-01T00:00:00.000Z') {
    return { schema_version: 'master.search-index.v1', updated_at: updatedAt, count: entries.length, entries };
}

function root(name: string, type = 'FUND') {
    return { asset_type: type, identity: { name } };
}

/** db con `assets` en memoria y `meta/search_index` en FakeSearchIndexRef; registra el orden de lecturas. */
function fakeDb(index: FakeSearchIndexRef, roots: Record<string, Record<string, unknown>>) {
    const reads: string[] = [];
    const db = {
        doc: (path: string) => {
            // ingestion_runs y demas: no interesan aqui
            if (path !== 'meta/search_index') return { set: async () => undefined, create: async () => undefined, get: async () => ({ exists: false }) };
            return {
                get: async () => { reads.push('meta/search_index'); return index.get(); },
                update: index.update.bind(index),
                create: index.create.bind(index),
                set: index.set.bind(index)
            };
        },
        collection: (path: string) => ({
            get: async () => {
                reads.push(path);
                const docs = path === 'assets'
                    ? Object.entries(roots).map(([id, data]) => ({ id, data: () => data }))
                    : [];
                return { docs, size: docs.length };
            }
        })
    };
    return { db: db as any, reads };
}

describe('H06: escritura de meta/search_index con precondicion', () => {
    it('crea el indice si no existe y lo actualiza con lastUpdateTime si existe', async () => {
        const ref = new FakeSearchIndexRef(null);
        const doc = indexDoc([entry('LU0000000001', 'Uno')]);
        await writeSearchIndexWithPrecondition(ref, await ref.get(), doc);
        expect(ref.writes.map((w) => w.kind)).toEqual(['create']);
        const next = indexDoc([entry('LU0000000001', 'Uno'), entry('LU0000000002', 'Dos')]);
        await writeSearchIndexWithPrecondition(ref, await ref.get(), next);
        expect(ref.writes.map((w) => w.kind)).toEqual(['create', 'update']);
        expect(ref.stored).toEqual(next);
    });

    it('tiene la semantica de set(): borra las claves del vivo que el nuevo no trae', async () => {
        const ref = new FakeSearchIndexRef({ ...indexDoc([entry('LU0000000001', 'Uno')]), legacy_note: 'x' });
        const next = indexDoc([entry('LU0000000002', 'Dos')]);
        await writeSearchIndexWithPrecondition(ref, await ref.get(), next);
        expect(ref.stored).toEqual(next);
    });

    it('si el indice cambio desde la lectura no escribe y avisa', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        const snap = await ref.get();
        ref.externalWrite(indexDoc([entry('LU0000000001', 'Uno'), entry('LU0000000009', 'Alta de la app')]));
        await expect(writeSearchIndexWithPrecondition(ref, snap, indexDoc([entry('LU0000000002', 'Dos')])))
            .rejects.toThrow(SearchIndexConcurrentModificationError);
        expect(ref.stored!.entries.map((e: any) => e.id)).toEqual(['LU0000000001', 'LU0000000009']);
    });

    it('si alguien lo borra entre la lectura y update(), reintenta y lo crea', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        let deleted = false;
        ref.beforeWrite = (self) => {
            if (deleted) return;
            deleted = true;
            self.stored = null;
            self.version++;
        };
        const result = await rebuildSearchIndexWithRetry(ref, (current) => indexDoc([...(current?.entries || []), entry('LU0000000002', 'Dos')]));
        expect(result).toMatchObject({ written: true, attempts: 2 });
        expect(ref.writes.map((w) => w.kind)).toEqual(['create']);
        expect(ref.stored!.entries.map((e: any) => e.id)).toEqual(['LU0000000002']);
    });

    it('si otro lo creo entre la lectura y la escritura, tampoco lo pisa', async () => {
        const ref = new FakeSearchIndexRef(null);
        const snap = await ref.get();
        ref.externalWrite(indexDoc([entry('LU0000000009', 'Alta de la app')]));
        await expect(writeSearchIndexWithPrecondition(ref, snap, indexDoc([]))).rejects.toThrow(/SEARCH_INDEX_CONCURRENT_MODIFICATION/);
        expect(ref.stored!.count).toBe(1);
    });

    it('sin updateTime en la lectura no escribe', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([]));
        const snap = { exists: true, updateTime: undefined, data: () => indexDoc([]) };
        await expect(writeSearchIndexWithPrecondition(ref, snap, indexDoc([]))).rejects.toThrow(/SEARCH_INDEX_PRECONDITION_MISSING/);
        expect(ref.writes).toEqual([]);
    });

    it('no borra con update() una clave que se leeria como ruta', async () => {
        const ref = new FakeSearchIndexRef({ ...indexDoc([]), 'a.b': 1 });
        await expect(writeSearchIndexWithPrecondition(ref, await ref.get(), indexDoc([]))).rejects.toThrow(/SEARCH_INDEX_UNSAFE_FIELD/);
        expect(ref.writes).toEqual([]);
    });

    it('reintenta: vuelve a leer y a construir sobre lo que escribio el otro', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        let concurrent = true;
        ref.beforeWrite = (self) => {
            if (!concurrent) return;
            concurrent = false;
            self.externalWrite(indexDoc([entry('LU0000000001', 'Uno'), entry('LU0000000009', 'Alta de la app')]));
        };
        const seen: string[][] = [];
        const result = await rebuildSearchIndexWithRetry(ref, (current) => {
            const entries = [...(current?.entries || []), entry('LU0000000002', 'Dos')];
            seen.push(entries.map((e: any) => e.id));
            return indexDoc(entries);
        });
        expect(result).toMatchObject({ written: true, attempts: 2 });
        expect(seen).toEqual([['LU0000000001', 'LU0000000002'], ['LU0000000001', 'LU0000000009', 'LU0000000002']]);
        expect(ref.stored!.entries.map((e: any) => e.id)).toEqual(['LU0000000001', 'LU0000000009', 'LU0000000002']);
        expect(ref.rejected).toBe(1);
    });

    it('el reintento es acotado: tras SEARCH_INDEX_WRITE_MAX_ATTEMPTS intentos, error y nada escrito', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        ref.beforeWrite = (self) => self.externalWrite(indexDoc([entry('LU0000000001', `Uno ${self.version}`)]));
        let builds = 0;
        await expect(rebuildSearchIndexWithRetry(ref, () => { builds++; return indexDoc([]); }))
            .rejects.toThrow(`(tras ${SEARCH_INDEX_WRITE_MAX_ATTEMPTS} intentos)`);
        expect(builds).toBe(SEARCH_INDEX_WRITE_MAX_ATTEMPTS);
        expect(ref.writes).toEqual([]);
        expect(ref.stored!.count).toBe(1);
    });

    it('un error que no es de concurrencia no se reintenta', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([]));
        ref.update = async () => { throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 }); };
        let builds = 0;
        await expect(rebuildSearchIndexWithRetry(ref, () => { builds++; return indexDoc([]); })).rejects.toThrow('PERMISSION_DENIED');
        expect(builds).toBe(1);
    });

    it('si build devuelve null no escribe', async () => {
        const ref = new FakeSearchIndexRef(indexDoc([]));
        expect(await rebuildSearchIndexWithRetry(ref, () => null)).toEqual({ written: false, attempts: 1, payload: null });
        expect(ref.writes).toEqual([]);
    });
});

describe('H06: reconcileSearchIndexLive', () => {
    it('lee el indice antes que las raices y escribe con precondicion', async () => {
        const index = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno'), entry('LU0000000008', 'Huerfana')]));
        const { db, reads } = fakeDb(index, { LU0000000001: root('Uno'), LU0000000002: root('Dos') });

        expect(await reconcileSearchIndexLive(db, true, GATE)).toBe(true);

        expect(reads).toEqual(['meta/search_index', 'assets']);
        expect(index.writes.map((w) => w.kind)).toEqual(['update']);
        expect(index.stored!.entries.map((e: any) => e.id)).toEqual(['LU0000000001', 'LU0000000002']);
        expect(validators.masterSearchIndex(index.stored).ok).toBe(true);
    });

    it('si la app da de alta un activo mientras reconcilia, vuelve a empezar y no lo pierde', async () => {
        const index = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        const roots: Record<string, Record<string, unknown>> = { LU0000000001: root('Uno'), LU0000000002: root('Dos') };
        const { db, reads } = fakeDb(index, roots);
        let concurrent = true;
        index.beforeWrite = (self) => {
            if (!concurrent) return;
            concurrent = false;
            // La app escribe la raiz y su entrada (upsert_search_index_entry) despues de la lectura.
            roots.LU0000000009 = root('Alta de la app');
            self.externalWrite(indexDoc([entry('LU0000000001', 'Uno'), entry('LU0000000009', 'Alta de la app')]));
        };

        expect(await reconcileSearchIndexLive(db, true, GATE)).toBe(true);

        expect(index.rejected).toBe(1);
        expect(reads).toEqual(['meta/search_index', 'assets', 'meta/search_index', 'assets']);
        expect(index.stored!.entries.map((e: any) => e.id)).toEqual(['LU0000000001', 'LU0000000002', 'LU0000000009']);
    });

    it('con escrituras concurrentes continuas se rinde tras el maximo de intentos sin pisar nada', async () => {
        const index = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        const { db } = fakeDb(index, { LU0000000001: root('Uno'), LU0000000002: root('Dos') });
        index.beforeWrite = (self) => self.externalWrite(indexDoc([entry('LU0000000001', 'Uno')], `2026-10-0${self.version}T00:00:00.000Z`));

        await expect(reconcileSearchIndexLive(db, true, GATE)).rejects.toThrow(/SEARCH_INDEX_CONCURRENT_MODIFICATION/);
        expect(index.rejected).toBe(SEARCH_INDEX_WRITE_MAX_ATTEMPTS);
        expect(index.writes).toEqual([]);
    });

    it('en seco no escribe', async () => {
        const index = new FakeSearchIndexRef(indexDoc([entry('LU0000000001', 'Uno')]));
        const { db } = fakeDb(index, { LU0000000002: root('Dos') });
        expect(await reconcileSearchIndexLive(db, false, {})).toBe(false);
        expect(index.writes).toEqual([]);
    });
});

describe('H06: load --write', () => {
    it('el upsert del cargador no pisa una entrada que la app anade entre su lectura y su escritura', async () => {
        const index = new FakeSearchIndexRef(indexDoc([entry('US0000000002', 'Activo incorporado desde la app')]));
        const roots: Record<string, Record<string, unknown>> = {
            US0000000002: root('Activo incorporado desde la app'),
            ES0000000001: { asset_type: 'STOCK', identity: { name: 'Nueva entrada', currency: 'EUR' } }
        };
        const { db } = fakeDb(index, roots);
        let concurrent = true;
        index.beforeWrite = (self) => {
            if (!concurrent) return;
            concurrent = false;
            roots.LU0000000009 = root('Alta de la app');
            self.externalWrite(indexDoc([
                entry('LU0000000009', 'Alta de la app'),
                entry('US0000000002', 'Activo incorporado desde la app')
            ]));
        };
        const pkg = {
            rawFunds: [], rawByIsin: new Map(), universalByIsin: new Map(), holdingsByFundIsin: new Map(),
            problematicByIsin: new Map(), qualityByIsin: new Map(), duplicateIsins: new Set(), canonicalValidationIssues: []
        } as any;
        const plan = {
            run_id: 'h06', created_at: '2026-10-14T00:00:00.000Z', write: true, selection_mode: 'all',
            package_summary: { canonical_funds: 0, universal_funds: 0, funds_with_holdings: 0, duplicate_isins: 0 },
            selection_count: 0,
            counts: { CREATE: 0, SKIP_EXISTS: 0, REVIEW_HOLD: 0, BLOCKED_REJECTED: 0, REEXPORT_REQUIRED: 0, INVALID_CONTRACT: 0 },
            items: [], safety: { writes_executed: 0, deletes_executed: 0, dry_run: false }
        };
        const incomingRows = new Map([['ES0000000001', {
            status: 'READY',
            root: { asset_type: 'STOCK', identity: { name: 'Nueva entrada', currency: 'EUR' } }
        }]]);

        const result = await executePlan(
            pkg, plan as any, { root: false, holdings: false },
            { FIREBASE_PROJECT_ID: 'gestor-activos-local', ...GATE },
            incomingRows as any, db
        );

        expect(result.errors).toEqual([]);
        expect(index.rejected).toBe(1);
        expect(index.stored!.entries.map((e: any) => e.id)).toEqual(['ES0000000001', 'LU0000000009', 'US0000000002']);
    });
});
