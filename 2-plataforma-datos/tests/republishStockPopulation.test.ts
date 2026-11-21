import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadStockPopulation, runRepublish } from '../src/loader/republish';
import { entryFromRoot, SEARCH_INDEX_SCHEMA_VERSION } from '../src/loader/searchIndex';
import { FakeMasterDb } from './helpers/fakeMasterDb';
import {
    liveRoot,
    liveRootWithDrift,
    NOT_READY_ISIN,
    NOT_READY_STOCK,
    READY_ISIN,
    READY_STOCK,
    StockSpec,
    tempOutDir as outDir,
    WARNING_ISIN,
    WARNING_STOCK,
    writeStockPackage
} from './helpers/stockPackage';

const WRITE_ENV = { BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' };
// En el paquete pero no en la maestra.
const NOT_LIVE_ISIN = 'ES0148396007';

function readArtifact(summary: Record<string, any>, base: string, file: string): any {
    const runDir = path.join(base, `republish_${summary.run_id}`);
    return JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf-8'));
}

/** Una maestra que cuenta cualquier acceso: para comprobar que se aborta sin tocarla. */
function untouchableDb(): { db: any; touched: () => number } {
    let touched = 0;
    const db = new Proxy({}, { get: () => { touched++; throw new Error('la maestra no se debia tocar'); } });
    return { db, touched: () => touched };
}

describe('loadStockPopulation (CRIT-09)', () => {
    it('con --write y sin --input lanza antes de tocar nada', () => {
        expect(() => loadStockPopulation('', true)).toThrow(/STOCK_POPULATION_UNAVAILABLE.*falta --input/);
    });

    it('con --write y una poblacion ilegible lanza', () => {
        expect(() => loadStockPopulation(path.join(os.tmpdir(), 'no-existe-republish-1016'), true)).toThrow(/STOCK_POPULATION_UNAVAILABLE/);
    });

    it('en seco avisa y sigue sin acciones', () => {
        const warn = vi.fn();
        expect(loadStockPopulation('', false, warn).size).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/no como fondo/);
    });

    it('mete en el mapa todas las filas, tambien las NOT_READY, con su status', () => {
        const dir = writeStockPackage([READY_STOCK, NOT_READY_STOCK]);
        const population = loadStockPopulation(dir, true);

        expect([...population.keys()].sort()).toEqual([NOT_READY_ISIN, READY_ISIN]);
        expect(population.get(READY_ISIN)!.status).toBe('READY');
        expect(population.get(NOT_READY_ISIN)!.status).toBe('NOT_READY');
        expect(population.get(NOT_READY_ISIN)!.status_reasons).toContain('FONDOSDB_BLOCKED');
    });
});

describe('republish y poblacion de acciones (CRIT-09)', () => {
    it('--export-bdb sin --input con --write aborta sin ninguna llamada a la maestra', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const { db, touched } = untouchableDb();

        await expect(runRepublish(
            ['--export-bdb', path.join(dir, 'export_bdb'), '--ids', 'all', '--write', '--out', outDir()],
            { db, env: WRITE_ENV }
        )).rejects.toThrow(/REPUBLISH_INPUT_REQUIRED/);
        expect(touched()).toBe(0);
    });

    it('--only-search-index --write tambien exige --input', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const { db, touched } = untouchableDb();

        await expect(runRepublish(
            ['--export-bdb', path.join(dir, 'export_bdb'), '--only-search-index', '--write', '--out', outDir()],
            { db, env: WRITE_ENV }
        )).rejects.toThrow(/REPUBLISH_INPUT_REQUIRED/);
        expect(touched()).toBe(0);
    });

    it('una accion sin fila stock es un error y no se trata como fondo', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        const out = outDir();

        // En seco con solo --export-bdb: no hay poblacion stock.
        const { summary } = await runRepublish(['--export-bdb', path.join(dir, 'export_bdb'), '--ids', 'all', '--out', out], { db: db as any, env: {} });

        expect(summary.stock_population).toBe(0);
        expect(summary.stock_population_unavailable).toBe(true);
        expect(summary.stock_without_row).toBe(1);
        expect(summary.errors).toEqual([expect.objectContaining({ asset_id: READY_ISIN, error: expect.stringMatching(/^REPUBLISH_STOCK_WITHOUT_ROW/) })]);
        expect(summary.by_population).toEqual({ fund: 0, stock: 0 });
        expect(summary.to_republish).toBe(0);
        const plan = readArtifact(summary, out, 'republish_plan.json');
        expect(plan.filter((row: any) => row.asset_id === READY_ISIN)).toEqual([]);
        expect(db.writes).toEqual([]);
    });

    it('una accion NOT_READY con deriva no se escribe y sale en el resumen; la READY si', async () => {
        const dir = writeStockPackage([READY_STOCK, NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        const notReadyLive = liveRootWithDrift(dir, NOT_READY_ISIN);
        db.put(`assets/${NOT_READY_ISIN}`, notReadyLive);
        const out = outDir();

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', out], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(0);
        expect(summary.stock_population).toBe(2);
        expect(summary.stock_not_ready).toBe(1);
        expect(summary.republished).toBe(1);
        expect(summary.by_population).toEqual({ fund: 0, stock: 1 });
        expect(db.writes.filter((write) => write.path.startsWith('assets/'))).toEqual([{ kind: 'update', path: `assets/${READY_ISIN}` }]);
        expect(db.data(`assets/${NOT_READY_ISIN}`)).toEqual(notReadyLive);
        expect(db.data(`assets/${READY_ISIN}`)!.identity.name).toBe('Banco Santander SA');
        expect(summary.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ asset_id: NOT_READY_ISIN, warning: expect.stringMatching(/^REPUBLISH_STOCK_NOT_READY: accion NOT_READY \(FONDOSDB_BLOCKED/) })
        ]));

        const held = readArtifact(summary, out, 'stock_held.json');
        expect(held).toEqual([{ asset_id: NOT_READY_ISIN, status: 'NOT_READY', reasons: ['FONDOSDB_BLOCKED'], drift: ['identity.name'] }]);
        const plan = readArtifact(summary, out, 'republish_plan.json');
        const heldRow = plan.find((row: any) => row.asset_id === NOT_READY_ISIN);
        // Sigue enrutada como accion: no cae por la ruta de fondos.
        expect(heldRow).toMatchObject({ population: 'stock', operations: ['hold:stock_not_ready'], root_drift_paths: ['identity.name'] });
    });

    it('una accion NOT_READY sin deriva cuenta como coincidente', async () => {
        const dir = writeStockPackage([NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${NOT_READY_ISIN}`, liveRoot(dir, NOT_READY_ISIN));

        const { summary } = await runRepublish(['--input', dir, '--ids', 'all', '--out', outDir()], { db: db as any, env: {} });

        expect(summary.matched).toBe(1);
        expect(summary.stock_not_ready).toBe(0);
        expect(db.writes).toEqual([]);
    });

    it('una accion NOT_READY que la maestra tiene como fondo sale en reclassified.json, no como retenida (H4)', async () => {
        const dir = writeStockPackage([NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${NOT_READY_ISIN}`, { ...liveRoot(dir, NOT_READY_ISIN), asset_type: 'FUND' });
        const out = outDir();

        const { summary } = await runRepublish(['--input', dir, '--ids', 'all', '--out', out], { db: db as any, env: {} });

        expect(summary.reclassified).toBe(1);
        expect(summary.stock_not_ready).toBe(0);
        expect(readArtifact(summary, out, 'reclassified.json')).toEqual([{ asset_id: NOT_READY_ISIN, from: 'FUND', to: 'STOCK' }]);
        expect(readArtifact(summary, out, 'stock_held.json')).toEqual([]);
    });

    it('decision: una accion READY_WITH_WARNING se republica (el republish no tiene --include-review)', async () => {
        const dir = writeStockPackage([WARNING_STOCK]);
        expect(loadStockPopulation(dir, true).get(WARNING_ISIN)!.status).toBe('READY_WITH_WARNING');
        const db = new FakeMasterDb();
        db.put(`assets/${WARNING_ISIN}`, liveRootWithDrift(dir, WARNING_ISIN));

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(0);
        expect(summary.stock_not_ready).toBe(0);
        expect(summary.republished).toBe(1);
        expect(db.data(`assets/${WARNING_ISIN}`)!.identity.name).toBe('Ferrovial SE');
    });
});

describe('puerta de escritura del republish (H8)', () => {
    it('--write sin la variable de la puerta aborta sin tocar la maestra', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const { db, touched } = untouchableDb();

        await expect(runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { db, env: {} }))
            .rejects.toThrow(/^SECURITY FAULT: BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES/);
        expect(touched()).toBe(0);
    });

    it('sin maestra inyectada, el proyecto fuera de la allowlist o ausente aborta', async () => {
        const dir = writeStockPackage([READY_STOCK]);

        await expect(runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { env: { ...WRITE_ENV, FIREBASE_PROJECT_ID: 'otro-proyecto' } }))
            .rejects.toThrow('Project id fuera de allowlist: otro-proyecto');
        await expect(runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { env: WRITE_ENV }))
            .rejects.toThrow('FIREBASE_PROJECT_ID ausente.');
    });
});

describe('codigo de salida del republish (H5)', () => {
    it('una escritura fallida da codigo 1, sin tocar process.exitCode', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        db.failUpdates.set(`assets/${READY_ISIN}`, 'error');
        const before = process.exitCode;

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(1);
        expect(summary.exit_code).toBe(1);
        expect(summary.write_errors).toBe(1);
        expect(summary.errors).toEqual(expect.arrayContaining([{ asset_id: READY_ISIN, error: `14 UNAVAILABLE: assets/${READY_ISIN}` }]));
        expect(process.exitCode).toBe(before);
    });

    it('un postverify fallido da codigo 1', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        db.failUpdates.set(`assets/${READY_ISIN}`, 'silent');

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(1);
        expect(summary.write_errors).toBe(0);
        expect(summary.postverify_failed).toBe(1);
    });

    it('con --write, los conflictos de dueno, los REVIEW y las retenidas salen con 0; una escritura fallida, con 1 (R2)', async () => {
        const REVIEW_ISIN = 'LU0123456789';
        const prepare = () => {
            const dir = writeStockPackage([READY_STOCK, NOT_READY_STOCK, WARNING_STOCK]);
            // Canonico en REVIEW: no valida su contrato (name debe ser texto).
            fs.writeFileSync(path.join(dir, 'export_bdb', `${REVIEW_ISIN}.json`), JSON.stringify({ isin: REVIEW_ISIN, name: 123 }) + '\n', 'utf-8');
            const db = new FakeMasterDb();
            db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
            db.put(`assets/${NOT_READY_ISIN}`, liveRootWithDrift(dir, NOT_READY_ISIN));
            // La maestra tiene fundamentales y el canonico los vaciaria: desde el 31-10-2026 el republish
            // conserva el valor vivo y reescribe, en vez de abortar la raiz entera (preserved_withdrawn.json).
            db.put(`assets/${WARNING_ISIN}`, { ...liveRoot(dir, WARNING_ISIN), fundamentals: { market_cap: 5 } });
            return { dir, db };
        };

        const clean = prepare();
        const ok = await runRepublish(['--input', clean.dir, '--ids', 'all', '--write', '--out', outDir()], { db: clean.db as any, env: WRITE_ENV });
        expect(ok.summary.ownership_conflicts_by_code).toEqual({});
        // Conservar el valor vivo deja el documento igual a lo que ya habia, asi que no hay nada que
        // reescribir: ni conflicto, ni escritura, ni perdida. Antes era un conflicto y un error.
        expect(ok.summary.root_unchanged_after_merge).toBe(1);
        expect(ok.summary.canonical_invalid).toBe(1);
        expect(ok.summary.stock_not_ready).toBe(1);
        expect(ok.summary.republished).toBe(1);
        expect(ok.summary.errors.map((e: any) => e.asset_id)).toEqual([REVIEW_ISIN]);
        expect(ok.summary.write_errors).toBe(0);
        expect(ok.exitCode).toBe(0);

        const failing = prepare();
        failing.db.failUpdates.set(`assets/${READY_ISIN}`, 'error');
        const ko = await runRepublish(['--input', failing.dir, '--ids', 'all', '--write', '--out', outDir()], { db: failing.db as any, env: WRITE_ENV });
        expect(ko.summary.write_errors).toBe(1);
        expect(ko.exitCode).toBe(1);
    });

    it('con --write, una accion sin fila stock (--export-bdb ajeno a --input) da codigo 1; en seco, 0 (R3)', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        // Otro export_bdb con una accion mas, que no esta en la poblacion stock de --input.
        const other = writeStockPackage([READY_STOCK, NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRoot(dir, READY_ISIN));
        db.put(`assets/${NOT_READY_ISIN}`, liveRoot(other, NOT_READY_ISIN));
        const argv = ['--input', dir, '--export-bdb', path.join(other, 'export_bdb'), '--ids', 'all', '--out', outDir()];

        const dry = await runRepublish(argv, { db: db as any, env: {} });
        expect(dry.summary.stock_without_row).toBe(1);
        expect(dry.exitCode).toBe(0);

        const written = await runRepublish([...argv, '--write'], { db: db as any, env: WRITE_ENV });
        expect(written.summary.stock_without_row).toBe(1);
        expect(written.exitCode).toBe(1);
        expect(db.writes.filter((write) => write.path === `assets/${NOT_READY_ISIN}`)).toEqual([]);
    });
});

describe('indice de busqueda del republish (ALTA-18)', () => {
    const NOT_LIVE_STOCK: StockSpec = { isin: NOT_LIVE_ISIN, ticker: 'ITX', name: 'Industria de Diseno Textil SA' };
    const entryIds = (payload: Record<string, unknown>) => ((payload.entries as Array<{ id: string }>) || []).map((entry) => entry.id);
    const searchIndexRows = (summary: Record<string, any>, out: string) =>
        readArtifact(summary, out, 'republish_plan.json').filter((row: any) => row.asset_id === 'meta/search_index');
    /** El indice vivo que la reconciliacion daria para estas raices: sin nada que escribir. */
    const indexFor = (roots: Array<[string, Record<string, any>]>) => {
        const entries = roots.map(([id, root]) => entryFromRoot(id, root)!);
        return { schema_version: SEARCH_INDEX_SCHEMA_VERSION, updated_at: '2026-10-15T00:00:00.000Z', count: entries.length, entries };
    };

    it('solo escribe la reconciliacion: un id del paquete que no existe en la maestra nunca llega a meta/search_index', async () => {
        const dir = writeStockPackage([READY_STOCK, NOT_LIVE_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        const out = outDir();

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', out], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(0);
        expect(summary.live_missing).toBe(1);
        expect(summary.search_index_set).toBe(1);
        expect(summary.search_index_reconcile_failed).toBe(false);
        // Una sola escritura (la de la reconciliacion) y sin el id que no esta vivo, tampoco en un estado intermedio.
        expect(db.searchIndex.writes).toHaveLength(1);
        for (const write of db.searchIndex.writes) expect(entryIds(write.payload)).not.toContain(NOT_LIVE_ISIN);
        expect(entryIds(db.searchIndex.stored!)).toEqual([READY_ISIN]);
        // El plan lo anuncia porque se escribio de verdad.
        expect(searchIndexRows(summary, out)).toHaveLength(1);
    });

    it('si la reconciliacion falla, no queda un indice sin filtrar y el republish sale con codigo 1', async () => {
        const dir = writeStockPackage([READY_STOCK, NOT_LIVE_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        db.failCollectionGet = 'assets no disponible';
        const before = process.exitCode;

        const { summary, exitCode } = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', outDir()], { db: db as any, env: WRITE_ENV });

        expect(exitCode).toBe(1);
        expect(process.exitCode).toBe(before);
        expect(summary.search_index_reconcile_failed).toBe(true);
        expect(summary.search_index_set).toBe(0);
        expect(summary.errors).toEqual(expect.arrayContaining([
            { asset_id: 'meta/search_index', error: 'reconciliation: assets no disponible' }
        ]));
        expect(db.searchIndex.writes).toEqual([]);
    });

    it('el plan solo anuncia search_index:set si hay deriva en seco o si la reconciliacion escribe (H7)', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const root = liveRoot(dir, READY_ISIN);

        // En seco, con el indice vivo al dia: nada que anunciar.
        const synced = new FakeMasterDb(indexFor([[READY_ISIN, root]]));
        synced.put(`assets/${READY_ISIN}`, root);
        let out = outDir();
        let result = await runRepublish(['--input', dir, '--ids', 'all', '--out', out], { db: synced as any, env: {} });
        expect(result.summary.search_index_to_set).toBe(0);
        expect(searchIndexRows(result.summary, out)).toEqual([]);

        // En seco, sin indice vivo: hay deriva y se anuncia.
        const empty = new FakeMasterDb();
        empty.put(`assets/${READY_ISIN}`, root);
        out = outDir();
        result = await runRepublish(['--input', dir, '--ids', 'all', '--out', out], { db: empty as any, env: {} });
        expect(result.summary.search_index_to_set).toBe(1);
        expect(searchIndexRows(result.summary, out)).toEqual([expect.objectContaining({ operations: ['search_index:set'], drift_fields: ['search_index'] })]);

        // Con --write y la reconciliacion sin nada que escribir: ni escritura ni anuncio.
        out = outDir();
        result = await runRepublish(['--input', dir, '--ids', 'all', '--write', '--out', out], { db: synced as any, env: WRITE_ENV });
        expect(result.exitCode).toBe(0);
        expect(synced.searchIndex.writes).toEqual([]);
        expect(result.summary.search_index_set).toBe(0);
        expect(result.summary.search_index_to_set).toBe(0);
        expect(searchIndexRows(result.summary, out)).toEqual([]);
    });
});
