import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapFondosDbFund } from '../src/ingestion/fondosdb/fondosDbMapper';
import { CanonicalPackage, readCanonicalPackage } from '../src/loader/packageReader';
import { buildPlan, STOCK_WITHOUT_ROW_REASON } from '../src/loader/planner';
import { LoaderArgs } from '../src/loader/types';
import { loadStockPopulation } from '../src/loader/republish';
import { READY_ISIN, READY_STOCK, writeStockPackage } from './helpers/stockPackage';

// Espia sobre el mapper real: el test comprueba que la accion no llega a mapFondosDbFund.
vi.mock('../src/ingestion/fondosdb/fondosDbMapper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/ingestion/fondosdb/fondosDbMapper')>();
    return { ...actual, mapFondosDbFund: vi.fn(actual.mapFondosDbFund) };
});

const STOCK_ISIN = 'ES0105046009';

function pkgWithStockCanonical(): CanonicalPackage {
    const data = {
        isin: STOCK_ISIN, name: 'Aena SME SA', currency: 'EUR',
        classification_v2: { asset_type: 'stock' },
        ms: { stock: { ticker: 'AENA', exchange: 'MC' } },
        validation: { ok: true }
    } as any;
    return {
        rawFunds: [{ file: `${STOCK_ISIN}.json`, data, isin: STOCK_ISIN }],
        rawByIsin: new Map([[STOCK_ISIN, { file: `${STOCK_ISIN}.json`, data }]]),
        universalByIsin: new Map(), holdingsByFundIsin: new Map(), problematicByIsin: new Map(),
        qualityByIsin: new Map(), duplicateIsins: new Set(), canonicalValidationIssues: []
    };
}

function args(): LoaderArgs {
    return {
        exportBdbDir: '', fondosNdjsonPath: '', posicionesNdjsonPath: '',
        selection: { mode: 'all' }, targets: { root: true, holdings: false }, includeReview: true,
        write: false, outputDir: '', limit: undefined
    };
}

describe('cargador: una accion sin fila stock nunca pasa por el mapper de fondos (H6)', () => {
    it('queda BLOCKED_REJECTED con su motivo y sin llamar a mapFondosDbFund', () => {
        vi.mocked(mapFondosDbFund).mockClear();

        // Poblacion stock vacia: p. ej. --export-bdb distinto de <input>/export_bdb.
        const plan = buildPlan(args(), pkgWithStockCanonical(), new Set(), 'run', new Map());

        expect(plan.items).toEqual([expect.objectContaining({
            asset_id: STOCK_ISIN,
            action: 'BLOCKED_REJECTED',
            mapper_status: 'REJECTED',
            reject_reasons: [STOCK_WITHOUT_ROW_REASON]
        })]);
        expect(plan.counts.BLOCKED_REJECTED).toBe(1);
        expect(plan.counts.CREATE).toBe(0);
        expect(mapFondosDbFund).not.toHaveBeenCalled();
    });

    it('una accion READY con su fila stock llega a CREATE, o a SKIP_EXISTS si ya esta en la maestra (R4)', () => {
        const dir = writeStockPackage([READY_STOCK]);
        const pkg = readCanonicalPackage({
            exportBdbDir: path.join(dir, 'export_bdb'),
            fondosNdjsonPath: path.join(dir, 'export', 'fondos.ndjson'),
            posicionesNdjsonPath: '',
            manifestPath: path.join(dir, 'export', 'manifest.json')
        });
        const population = loadStockPopulation(dir, true);
        expect(population.get(READY_ISIN)!.status).toBe('READY');
        vi.mocked(mapFondosDbFund).mockClear();

        const created = buildPlan(args(), pkg, new Set(), 'run', population);
        expect(created.items).toEqual([expect.objectContaining({ asset_id: READY_ISIN, action: 'CREATE', mapper_status: 'ACCEPTED', reject_reasons: [], contract_errors: [] })]);

        const existing = buildPlan(args(), pkg, new Set([READY_ISIN]), 'run', population);
        expect(existing.items).toEqual([expect.objectContaining({ asset_id: READY_ISIN, action: 'SKIP_EXISTS' })]);
        expect(mapFondosDbFund).not.toHaveBeenCalled();
    });
});
