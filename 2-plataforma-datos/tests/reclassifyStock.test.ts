import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as admin from 'firebase-admin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validators } from '../contracts/validators';
import { readStockRows } from '../src/ingestion/fondosdbStockAssets';
import { validateCurrentRoot } from '../src/loader/ownership';
import {
    buildReclassifiedMetricsMarker,
    reclassifyStocks,
    RECLASSIFIED_METRICS_SOURCE,
    stockRowsForReclassification,
    type ReclassifyBatch,
    type ReclassifyDb,
    type ReclassifyRef,
    type ReclassifyStockRow
} from '../src/loader/reclassifyStock';

// Registra qué documento se valida contra el contrato de acción (el que se escribe, no el del canónico).
const { validated } = vi.hoisted(() => ({ validated: [] as Array<Record<string, any>> }));
vi.mock('../src/loader/ownership', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../src/loader/ownership')>();
    return {
        ...mod,
        validateCurrentRoot: (doc: Record<string, any>, isStock: boolean) => { validated.push(doc); return mod.validateCurrentRoot(doc, isStock); }
    };
});

const ISIN = 'ES0105046009';
const GATE_ON = { BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' } as NodeJS.ProcessEnv;
const DELETE = admin.firestore.FieldValue.delete();

/** Firestore en memoria con updateTime por documento, precondiciones y FieldValue.delete(). */
function fakeDb(initial: Record<string, Record<string, unknown>>) {
    const docs = new Map<string, Record<string, unknown>>(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
    const versions = new Map<string, number>([...docs.keys()].map((k) => [k, 1]));
    const writes: string[] = [];
    /** Hook para simular a otro escritor justo antes de un commit. */
    let beforeCommit: (() => void) | null = null;

    const stamp = (p: string) => {
        const v = versions.get(p) || 0;
        return { seconds: v, nanoseconds: 0, isEqual: (o: any) => o?.seconds === v } as unknown as admin.firestore.Timestamp;
    };
    const touch = (p: string) => versions.set(p, (versions.get(p) || 0) + 1);
    const applyUpdate = (p: string, data: Record<string, unknown>) => {
        const doc = structuredClone(docs.get(p) || {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && typeof (v as any).isEqual === 'function' && (v as any).isEqual(DELETE)) delete doc[k];
            else doc[k] = structuredClone(v);
        }
        docs.set(p, doc);
        touch(p);
        writes.push(p);
    };
    const checkPrecondition = (p: string, pre: admin.firestore.Precondition) => {
        if (!docs.has(p)) throw Object.assign(new Error('5 NOT_FOUND'), { code: 5 });
        if (pre.lastUpdateTime && (pre.lastUpdateTime as any).seconds !== versions.get(p)) {
            throw Object.assign(new Error('9 FAILED_PRECONDITION'), { code: 9 });
        }
    };

    function ref(p: string): ReclassifyRef {
        return {
            path: p,
            get: async () => ({ exists: docs.has(p), updateTime: docs.has(p) ? stamp(p) : undefined, data: () => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) }),
            update: async (data, pre) => { checkPrecondition(p, pre); applyUpdate(p, data as Record<string, unknown>); },
            create: async (data) => {
                if (docs.has(p)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
                docs.set(p, structuredClone(data)); touch(p); writes.push(p);
            }
        };
    }
    const db: ReclassifyDb = {
        doc: (p: string) => ref(p),
        batch: (): ReclassifyBatch => {
            const ops: Array<{ check: () => void; apply: () => void }> = [];
            return {
                update: (r, data, pre) => { ops.push({ check: () => checkPrecondition(r.path, pre), apply: () => applyUpdate(r.path, data as Record<string, unknown>) }); },
                create: (r, data) => {
                    ops.push({
                        check: () => { if (docs.has(r.path)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 }); },
                        apply: () => { docs.set(r.path, structuredClone(data)); touch(r.path); writes.push(r.path); }
                    });
                },
                commit: async () => {
                    if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; hook(); }
                    for (const op of ops) op.check();   // atómico: o todo o nada
                    for (const op of ops) op.apply();
                }
            };
        }
    };
    return { db, docs, writes, setBeforeCommit: (fn: () => void) => { beforeCommit = fn; }, touch };
}

let tmp: string[] = [];
afterEach(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); tmp = []; });

/** Canónico de acción (como el que deja el extractor tras reclasificar en fondos.csv). */
function stockDir(opts: { bloqueado?: boolean } = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reclassify-'));
    tmp.push(dir);
    for (const sub of ['export', 'export_bdb', path.join('data', 'funds')]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const universal = {
        meta: { isin: ISIN },
        identificacion: { isin: ISIN, nombre: 'Aena SME SA', ticker: 'AENA', mercado: 'MC', divisa_base: 'EUR', simbolo_eodhd: 'AENA.MC' },
        rentabilidad: { trailing_pct: { '1a': { fondo: 10 }, '3a_anualizada': { fondo: 12 }, '5a_anualizada': { fondo: 9 } } },
        riesgo: {
            volatilidad_pct: { '1a': { fondo: 18 }, '3a': { fondo: 20 }, '5a': { fondo: 22 } },
            sharpe: { '1a': { fondo: 0.4 }, '3a': { fondo: 0.5 }, '5a': { fondo: 0.3 } },
            historial_precios: { source_history: 'eodhd', source_listing_id: 'EODHD:AENA.MC', first_date: '2019-01-02', last_date: '2026-10-13', observations_count: 1950, history_quality_status: 'COMPLETE' }
        },
        valoracion: { vl_fecha: '2026-10-13' },
        calidad: { bucket: 'COMPLETO' }
    };
    const bdb = {
        isin: ISIN, name: 'Aena SME SA', currency: 'EUR', classification_v2: { asset_type: 'stock' },
        ms: { stock: { ticker: 'AENA', exchange: 'MC', fundamentals: { market_cap: 1 } } },
        validation: { diagnostics: { calidad_fondosdb: opts.bloqueado ? 'BLOQUEADO' : 'COMPLETO' }, ok: true }
    };
    fs.writeFileSync(path.join(dir, 'export', 'fondos.ndjson'), `${JSON.stringify(universal)}\n`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'export_bdb', `${ISIN}.json`), JSON.stringify(bdb), 'utf-8');
    fs.writeFileSync(path.join(dir, 'data', 'funds', `${ISIN}.json`), JSON.stringify(universal), 'utf-8');
    return dir;
}

function stockRoot(): Record<string, any> {
    return readStockRows(stockDir())[0].root;
}

/** Población stock como la deja evaluateStockRows, con todo READY salvo que se diga otra cosa. */
function rowsOf(root: Record<string, any>, extra: Array<[string, Record<string, any>]> = []): Map<string, ReclassifyStockRow> {
    const all: Array<[string, Record<string, any>]> = [[ISIN, root], ...extra];
    return new Map<string, ReclassifyStockRow>(all.map(([id, r]) => [id, { root: r, status: 'READY', status_reasons: [] }]));
}

function seed(extra: Record<string, Record<string, unknown>> = {}) {
    return {
        [`assets/${ISIN}`]: {
            asset_id: ISIN, asset_type: 'FUND', identity: { name: 'Aena (como fondo)' },
            costs: { ter: 0.01 }, fixed_income_profile: { duration: 1 },
            performance: { valuation: { price: 180.5, date: '2026-10-14', currency: 'EUR' } }
        },
        [`assets/${ISIN}/metrics/latest`]: {
            asset_id: ISIN, population: 'fund', source: 'FONDOSDB_ROOT_ES', updated_at: '2026-10-01', risk_score_source: 'SRRI', srri: 4,
            windows: { '1y': { annualized_return: 0.1, method: 'TRAILING_PROVIDER', frequency: 'PROVIDER' } },
            max_drawdown_hist: { value: -0.3 }, last_date: '2026-09-30'
        },
        'meta/search_index': {
            schema_version: 'master.search-index.v1', updated_at: '2026-10-01T00:00:00Z', count: 2, entries: [
                { id: ISIN, name: 'Aena (como fondo)', name_folded: 'aena (como fondo)', type: 'FUND' },
                { id: 'LU0000000001', name: 'Fondo Uno', name_folded: 'fondo uno', type: 'FUND' }
            ]
        },
        ...extra
    };
}

describe('reclassify:stock', () => {
    it('el canónico de prueba es una raíz de acción válida y el marcador de métricas valida metrics.v1.3', () => {
        expect(validateCurrentRoot(stockRoot(), true).ok).toBe(true);
        expect(validators.masterMetricsV13(buildReclassifiedMetricsMarker(ISIN, '2026-10-14T00:00:00Z')).ok).toBe(true);
    });

    it('la pasada en seco no escribe y dice qué haría con la raíz, las métricas y el índice', async () => {
        const { db, docs, writes } = fakeDb(seed());
        const before = JSON.stringify([...docs]);
        const { summary, plan } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN, 'LU0000000001', 'IE0000000002'],
            { write: false, runId: 'seco' });
        expect(writes).toEqual([]);
        expect(JSON.stringify([...docs])).toBe(before);
        expect(summary.to_reclassify).toBe(1);
        expect(summary.skipped_items).toEqual([
            { asset_id: 'LU0000000001', reason: 'NO_STOCK_CANONICAL' },
            { asset_id: 'IE0000000002', reason: 'NO_STOCK_CANONICAL' }
        ]);
        const row = plan.find((r) => r.asset_id === ISIN)!;
        expect(row).toMatchObject({ action: 'RECLASSIFY', from: 'FUND', to: 'STOCK', metrics_latest: 'MARK', search_index: 'UPDATE' });
        expect(row.dropped).toEqual(expect.arrayContaining(['costs', 'fixed_income_profile']));
    });

    it('sin gate no escribe', async () => {
        const { db } = fakeDb(seed());
        await expect(reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'x', env: {} as NodeJS.ProcessEnv }))
            .rejects.toThrow(/SECURITY FAULT/);
    });

    it('escribe la raíz de acción, invalida metrics/latest como acción y pasa la entrada del índice a STOCK', async () => {
        const { db, docs } = fakeDb(seed());
        const { summary, plan } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN],
            { write: true, runId: 'w', env: GATE_ON, nowIso: '2026-10-14T10:00:00.000Z' });
        expect(summary.errors).toEqual([]);
        expect(summary.written).toBe(1);
        expect(summary.postverify_ok).toBe(1);
        expect(plan[0].postverify).toEqual({ root: true, metrics: true, search_index: true, ok: true });

        const root = docs.get(`assets/${ISIN}`)!;
        expect(root.asset_type).toBe('STOCK');
        expect(root).not.toHaveProperty('costs');
        expect(root).not.toHaveProperty('fixed_income_profile');
        expect((root.performance as any).valuation).toEqual({ price: 180.5, date: '2026-10-14', currency: 'EUR' });
        expect(validateCurrentRoot(root, true).ok).toBe(true);

        // metrics/latest: firma de cálculo propio, población stock, sin ventanas del fondo ni SRRI ni last_date
        expect(docs.get(`assets/${ISIN}/metrics/latest`)).toEqual(buildReclassifiedMetricsMarker(ISIN, '2026-10-14T10:00:00.000Z'));
        expect(docs.get(`assets/${ISIN}/metrics/latest`)!.source).toBe(RECLASSIFIED_METRICS_SOURCE);

        const index = docs.get('meta/search_index') as any;
        expect(index.entries.find((e: any) => e.id === ISIN)).toMatchObject({ type: 'STOCK', name: 'Aena SME SA' });
        expect(index.entries.find((e: any) => e.id === 'LU0000000001')).toMatchObject({ type: 'FUND' });
        expect(validators.masterSearchIndex(index).ok).toBe(true);
    });

    it('sin metrics/latest crea el marcador para que el refresco de la app lo calcule', async () => {
        const s = seed();
        delete (s as Record<string, unknown>)[`assets/${ISIN}/metrics/latest`];
        const { db, docs } = fakeDb(s);
        const { plan, summary } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(plan[0].metrics_latest).toBe('CREATE_MARKER');
        expect(summary.postverify_ok).toBe(1);
        expect(docs.get(`assets/${ISIN}/metrics/latest`)!.population).toBe('stock');
    });

    it('valida el documento que se escribe (con la valuation viva y su schema_version), no el del canónico', async () => {
        const { db } = fakeDb(seed());
        const expected = stockRoot();
        validated.length = 0;
        await reclassifyStocks(db, rowsOf(expected), [ISIN], { write: false, runId: 's', nowIso: '2026-10-14T10:00:00.000Z' });
        expect(validated).toHaveLength(1);
        expect(validated[0]).not.toBe(expected);
        expect(validated[0].performance.valuation).toEqual({ price: 180.5, date: '2026-10-14', currency: 'EUR' });
        expect(validated[0].schema_version).toBe('master.asset-stock.v1.1');
        expect(validated[0].updated_at).toBe('2026-10-14T10:00:00.000Z');
    });

    it('un documento que no valida el contrato de acción no se escribe', async () => {
        const { db, writes } = fakeDb(seed());
        const roto = { ...stockRoot(), identity: {} };
        const { summary, plan } = await reclassifyStocks(db, rowsOf(roto), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(plan[0].action).toBe('ERROR');
        expect(plan[0].error).toMatch(/no valida master\.asset-stock\.v1\.1/);
        expect(summary.written).toBe(0);
        expect(summary.to_reclassify).toBe(0);
        expect(writes).toEqual([]);
    });

    it('si la raíz cambia entre la lectura y la escritura no escribe nada (ni métricas)', async () => {
        const { db, docs, writes, setBeforeCommit, touch } = fakeDb(seed());
        setBeforeCommit(() => touch(`assets/${ISIN}`));   // p. ej. el refresco de precios
        const { summary, plan } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(plan[0].action).toBe('ERROR');
        expect(plan[0].error).toMatch(/RECLASSIFY_CONCURRENT_MODIFICATION/);
        expect(summary.written).toBe(0);
        expect(writes).toEqual([]);
        expect(docs.get(`assets/${ISIN}`)!.asset_type).toBe('FUND');
        expect(docs.get(`assets/${ISIN}/metrics/latest`)!.population).toBe('fund');
    });

    it('omite lo que ya es acción o no está en la maestra', async () => {
        const s = seed({ 'assets/US0378331005': { asset_id: 'US0378331005', asset_type: 'STOCK', identity: { name: 'Apple Inc' } } });
        (s['meta/search_index'] as any).entries.push({ id: 'US0378331005', name: 'Apple Inc', name_folded: 'apple inc', type: 'STOCK' });
        const { db } = fakeDb(s);
        const roots = rowsOf(stockRoot(), [['US0378331005', stockRoot()], ['ES0000000000', stockRoot()]]);
        const { summary } = await reclassifyStocks(db, roots, ['US0378331005', 'ES0000000000'], { write: false, runId: 's' });
        expect(summary.skipped_items).toEqual([
            { asset_id: 'US0378331005', reason: 'ALREADY_STOCK' },
            { asset_id: 'ES0000000000', reason: 'NOT_IN_MASTER' }
        ]);
        expect(summary.to_reclassify).toBe(0);
    });

    it('el índice se reescribe con precondición y reintenta si otro escritor lo cambió', async () => {
        const { db, docs } = fakeDb(seed());
        let reads = 0;
        const original = db.doc.bind(db);
        db.doc = (p: string) => {
            const r = original(p);
            if (p !== 'meta/search_index') return r;
            return {
                ...r,
                get: async () => {
                    const snap = await r.get();
                    // 1.ª lectura: la de la pasada; 2.ª: la del primer intento de escritura del índice.
                    if (++reads === 2) {
                        // otro escritor (la app) añade una entrada entre la lectura y la escritura
                        const idx = docs.get('meta/search_index') as any;
                        idx.entries.push({ id: 'FR0000000003', name: 'Alta de la app', name_folded: 'alta de la app', type: 'FUND' });
                        idx.count = idx.entries.length;
                        await r.update({ entries: idx.entries, count: idx.count }, { lastUpdateTime: snap.updateTime });
                    }
                    return snap;
                }
            };
        };
        const { summary } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(summary.errors).toEqual([]);
        expect(summary.search_index_attempts).toBe(2);
        const ids = (docs.get('meta/search_index') as any).entries.map((e: any) => e.id);
        expect(ids).toEqual(['ES0105046009', 'FR0000000003', 'LU0000000001']);
    });

    // ---------------------------------------------------- bloqueos de la alta
    it('aplica los bloqueos de evaluateStockRows: una acción NOT_READY no se reclasifica y dice por qué', async () => {
        const { db, writes } = fakeDb(seed());
        const rows = stockRowsForReclassification(stockDir({ bloqueado: true }));
        expect(rows.get(ISIN)?.status).toBe('NOT_READY');
        const { summary, plan } = await reclassifyStocks(db, rows, [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(plan[0]).toMatchObject({ action: 'SKIP', reason: 'NOT_READY' });
        expect(plan[0].blockers).toEqual(expect.arrayContaining(['FONDOSDB_BLOCKED']));
        expect(summary.skipped_items[0]).toMatchObject({ asset_id: ISIN, reason: 'NOT_READY' });
        expect(summary.to_reclassify).toBe(0);
        expect(writes).toEqual([]);
    });

    it('una acción lista según evaluateStockRows sí se reclasifica', async () => {
        const rows = stockRowsForReclassification(stockDir());
        expect(rows.get(ISIN)?.status).toMatch(/^READY/);
        const { db } = fakeDb(seed());
        const { plan } = await reclassifyStocks(db, rows, [ISIN], { write: false, runId: 's', includeReview: true });
        expect(plan[0].action).toBe('RECLASSIFY');
    });

    it('READY_WITH_WARNING queda retenida como en la alta, salvo includeReview', async () => {
        const rows = new Map<string, ReclassifyStockRow>([[ISIN, { root: stockRoot(), status: 'READY_WITH_WARNING', status_reasons: ['MISSING_FUNDAMENTALS'] }]]);
        const { db } = fakeDb(seed());
        const retenida = await reclassifyStocks(db, rows, [ISIN], { write: false, runId: 's' });
        expect(retenida.plan[0]).toMatchObject({ action: 'SKIP', reason: 'REVIEW_HOLD', blockers: ['MISSING_FUNDAMENTALS'] });
        const revisada = await reclassifyStocks(db, rows, [ISIN], { write: false, runId: 's', includeReview: true });
        expect(revisada.plan[0].action).toBe('RECLASSIFY');
    });

    // ----------------------------------------------------------- reparaciones
    function yaReclasificada(metricsFund: boolean) {
        const s = seed();
        s[`assets/${ISIN}`] = { ...stockRoot(), schema_version: 'master.asset-stock.v1.1' } as any;
        if (!metricsFund) delete (s as Record<string, unknown>)[`assets/${ISIN}/metrics/latest`];
        return s; // el índice sigue diciendo FUND: el lote se confirmó y el índice falló
    }

    it('lo que ya es STOCK con la entrada del índice como fondo se repara en el índice', async () => {
        const { db, docs } = fakeDb(yaReclasificada(false));
        const seco = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: false, runId: 's' });
        expect(seco.plan[0]).toMatchObject({ action: 'REPAIR', reason: 'ALREADY_STOCK', repairs: ['search_index'], search_index: 'UPDATE' });
        expect(seco.summary.to_repair).toBe(1);
        expect((docs.get('meta/search_index') as any).entries.find((e: any) => e.id === ISIN).type).toBe('FUND');

        const { summary, plan } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(summary.errors).toEqual([]);
        expect(summary.repaired).toBe(1);
        expect(plan[0].postverify).toEqual({ root: true, metrics: true, search_index: true, ok: true });
        expect((docs.get('meta/search_index') as any).entries.find((e: any) => e.id === ISIN).type).toBe('STOCK');
        // y la siguiente pasada ya no tiene nada que hacer
        const otra = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: false, runId: 's2' });
        expect(otra.plan[0]).toMatchObject({ action: 'SKIP', reason: 'ALREADY_STOCK' });
    });

    it('el metrics/latest de fondo de una acción ya reclasificada se avisa y solo se invalida con repairMetrics', async () => {
        const s = yaReclasificada(true);
        (s['meta/search_index'] as any).entries[0].type = 'STOCK';
        const { db, docs, writes } = fakeDb(s);
        const aviso = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(aviso.plan[0]).toMatchObject({ action: 'SKIP', reason: 'ALREADY_STOCK', warnings: ['METRICS_LATEST_FUND'] });
        expect(aviso.summary.metrics_fund_left).toEqual([ISIN]);
        expect(writes).toEqual([]);

        const seco = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: false, runId: 's', repairMetrics: true });
        expect(seco.plan[0]).toMatchObject({ action: 'REPAIR', repairs: ['metrics_latest'], metrics_latest: 'MARK' });
        expect(writes).toEqual([]);

        const { summary } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN],
            { write: true, runId: 'w2', env: GATE_ON, repairMetrics: true, nowIso: '2026-10-15T08:00:00.000Z' });
        expect(summary.errors).toEqual([]);
        expect(summary.repaired).toBe(1);
        expect(docs.get(`assets/${ISIN}/metrics/latest`)).toEqual(buildReclassifiedMetricsMarker(ISIN, '2026-10-15T08:00:00.000Z'));
        expect(writes).toEqual([`assets/${ISIN}/metrics/latest`]);
    });

    it('una cartera de fondo que cuelga de la acción se lista y no se borra', async () => {
        const s = seed({ [`assets/${ISIN}/holdings/latest`]: { holdings_count: 40, schema_version: 'master.holdings.v1.1' } });
        const { db, docs } = fakeDb(s);
        const { summary, plan } = await reclassifyStocks(db, rowsOf(stockRoot()), [ISIN], { write: true, runId: 'w', env: GATE_ON });
        expect(plan[0].warnings).toEqual(['HOLDINGS_LEFT']);
        expect(plan[0].holdings_left).toEqual([`assets/${ISIN}/holdings/latest`]);
        expect(summary.holdings_left).toEqual([{ asset_id: ISIN, paths: [`assets/${ISIN}/holdings/latest`] }]);
        expect(docs.has(`assets/${ISIN}/holdings/latest`)).toBe(true);
        expect(summary.postverify_ok).toBe(1);
    });
});
