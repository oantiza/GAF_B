import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readStockRows } from '../src/ingestion/fondosdbStockAssets';
import { CanonicalPackage } from '../src/loader/packageReader';
import { buildPlan, StockRowLite } from '../src/loader/planner';
import { LoaderArgs } from '../src/loader/types';
import { annotatePlanDocuments } from '../src/loader/writer';

/**
 * ALTA-12: la alta desde Sistema > Operaciones pide `--targets root,holdings,metrics` para crear el
 * metrics/latest puente. La pasada en seco tiene que decir que documentos crea cada activo y validarlos
 * todos, no solo la raiz: si no, un metrics/latest invalido tumbaria en la escritura un activo que la
 * pasada en seco dio por CREATE.
 */
const ISIN = 'ES0105046009';

const EMPTY_PKG: CanonicalPackage = {
    rawFunds: [], rawByIsin: new Map(), universalByIsin: new Map(), holdingsByFundIsin: new Map(),
    problematicByIsin: new Map(), qualityByIsin: new Map(), duplicateIsins: new Set(), canonicalValidationIssues: []
};

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Raiz de accion valida, construida por buildStockRow desde un canonico minimo del extractor. */
function validStockRoot(): Record<string, any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-docs-'));
    dirs.push(dir);
    for (const sub of ['export', 'export_bdb', path.join('data', 'funds')]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const universal = {
        meta: { isin: ISIN },
        identificacion: { isin: ISIN, nombre: 'Aena SME SA', ticker: 'AENA', mercado: 'MC', divisa_base: 'EUR', simbolo_eodhd: 'AENA.MC' },
        riesgo: { historial_precios: { source_history: 'eodhd', source_listing_id: 'EODHD:AENA.MC', observations_count: 1950, history_quality_status: 'COMPLETE' } },
        calidad: { bucket: 'COMPLETO' }
    };
    const bdb = { isin: ISIN, name: 'Aena SME SA', currency: 'EUR', classification_v2: { asset_type: 'stock' },
        ms: { stock: { ticker: 'AENA', exchange: 'MC', fundamentals: { market_cap: 1 } } }, validation: { ok: true } };
    fs.writeFileSync(path.join(dir, 'export', 'fondos.ndjson'), JSON.stringify(universal) + '\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'export_bdb', `${ISIN}.json`), JSON.stringify(bdb), 'utf-8');
    fs.writeFileSync(path.join(dir, 'data', 'funds', `${ISIN}.json`), JSON.stringify(universal), 'utf-8');
    return readStockRows(dir)[0].root;
}

function stockRow(volatility: number): StockRowLite {
    return {
        status: 'READY',
        root: validStockRoot(),
        metrics: {
            source: 'FONDOSDB_EODHD_DAILY_HISTORY', updated_at: '2026-10-13',
            windows: { '1y': { annualized_return: 0.1, annualized_volatility: volatility, method: 'GEOMETRIC_CAGR', frequency: 'DAILY' } }
        }
    };
}

function args(targets: LoaderArgs['targets']): LoaderArgs {
    return {
        exportBdbDir: '', fondosNdjsonPath: '', posicionesNdjsonPath: '',
        selection: { mode: 'list', ids: [ISIN] }, targets, includeReview: false, write: false, outputDir: '', limit: undefined
    };
}

function plan(targets: LoaderArgs['targets'], row: StockRowLite, existing: Set<string> | null = new Set()) {
    const rows = new Map([[ISIN, row]]);
    return annotatePlanDocuments(EMPTY_PKG, buildPlan(args(targets), EMPTY_PKG, existing, 'run', rows), targets, rows);
}

describe('pasada en seco del cargador: documentos por activo', () => {
    it('con metrics en los targets, el CREATE lista la raiz y metrics/latest', () => {
        const p = plan({ root: true, holdings: true, metrics: true }, stockRow(0.2));
        expect(p.items[0].action).toBe('CREATE');
        expect(p.items[0].documents).toEqual([`assets/${ISIN}`, `assets/${ISIN}/metrics/latest`]);
        expect(p.counts.CREATE).toBe(1);
    });

    it('sin metrics en los targets, metrics/latest no aparece', () => {
        const p = plan({ root: true, holdings: true }, stockRow(0.2));
        expect(p.items[0].documents).toEqual([`assets/${ISIN}`]);
    });

    it('un metrics/latest que no valida deja el activo en INVALID_CONTRACT ya en seco', () => {
        const p = plan({ root: true, holdings: true, metrics: true }, stockRow(-0.2));
        expect(p.items[0].action).toBe('INVALID_CONTRACT');
        expect(p.items[0].contract_errors.join(' ')).toMatch(/metrics\/latest: .*annualized_volatility/);
        expect(p.counts).toMatchObject({ CREATE: 0, INVALID_CONTRACT: 1 });
    });

    it('los que ya existen solo listan lo que la escritura completaria si faltase', () => {
        const p = plan({ root: true, holdings: true, metrics: true }, stockRow(-0.2), new Set([ISIN]));
        expect(p.items[0].action).toBe('SKIP_EXISTS');
        expect(p.items[0].documents).toEqual([`assets/${ISIN}`, `assets/${ISIN}/metrics/latest`]);
    });
});
