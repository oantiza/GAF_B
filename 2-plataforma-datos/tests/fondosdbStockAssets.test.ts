import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    evaluateStockRows,
    readStockRows,
    writeStockDryRunArtifacts,
    type StockIngestRow,
} from '../src/ingestion/fondosdbStockAssets';
import { validateCurrentRoot } from '../src/loader/ownership';

function stockRow(params: { isin?: string; ticker?: string; exchange?: string; fundamentals?: any; completeMetrics?: boolean } = {}): StockIngestRow {
    const assetId = params.isin || 'ES0113900J37';
    const ticker = params.ticker || 'SAN';
    const exchange = params.exchange || 'MCE';
    const listingId = `EODHD:${ticker}.${exchange}`;
    const root = {
        asset_id: assetId,
        asset_type: 'STOCK',
        identity: { name: 'Banco Santander SA', currency: 'EUR' },
        identifiers: { isin: assetId, ticker, eodhd_code: `${ticker}.${exchange}`, aliases: [assetId, ticker, `${ticker}.${exchange}`, listingId] },
        listings: [{ listing_id: listingId, ticker, exchange, source_listing_id: listingId }],
        performance: { returns: { trailing_pct: { '1a': { fondo: 12 }, '3a_anualizada': { fondo: 33 }, '5a_anualizada': { fondo: 14 } } } },
        risk: {
            volatilidad_pct: { '1a': { fondo: 22 }, '3a': { fondo: 24 }, '5a': { fondo: 26 } },
            sharpe: { '1a': { fondo: 0.3 }, '3a': { fondo: 1.2345 }, '5a': { fondo: 0.5 } },
            rf_pct: { '1a': { fondo: 2.1 }, '3a': { fondo: 2.4 }, '5a': { fondo: 1.7 } },
        },
        fundamentals: params.fundamentals === undefined ? { market_cap: 1_000_000 } : params.fundamentals,
        quality: { fondosdb_bucket: 'COMPLETO', history_trace: { source_history: 'eodhd', source_listing_id: listingId } },
        source_metadata: { source: 'FondosDB' },
    };
    return {
        asset_id: assetId,
        root_path: `assets/${assetId}`,
        metrics_path: `assets/${assetId}/metrics/latest`,
        listing_id: listingId,
        status: 'READY',
        status_reasons: [],
        warnings: [],
        root,
        metrics: {
            asset_id: assetId,
            population: 'stock',
            source: 'FONDOSDB_EODHD_DAILY_HISTORY',
            updated_at: '2026-06-19',
            risk_score_source: 'VOL_BUCKET',
            windows: { '3y': { sharpe_ratio: 1.2345 } },
        },
        has_complete_target_metrics: params.completeMetrics !== false,
    };
}

function writeLocalFondosDbFixture(opts: { yahoo?: boolean; exchange?: string; eodhdSymbol?: string; withoutYahooListing?: boolean } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-fondosdb-'));
    fs.mkdirSync(path.join(dir, 'export'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'export_bdb'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data', 'funds'), { recursive: true });

    const isin = opts.yahoo ? 'ES0105046009' : 'US0378331005';
    const ticker = opts.yahoo ? 'AENA' : 'AAPL';
    const exchange = opts.exchange || (opts.yahoo ? 'MCE' : 'US');
    const eodhdSymbol = opts.eodhdSymbol ?? (opts.yahoo ? undefined : `${ticker}.${exchange}`);
    const history = opts.yahoo
        ? { source_history: 'yahoo', source_listing_id: 'YAHOO:AENA.MC', first_date: '2019-01-02', last_date: '2026-06-19', observations_count: 1880, history_quality_status: 'COMPLETE' }
        : { source_history: 'eodhd', source_listing_id: 'EODHD:AAPL.US', first_date: '2019-01-02', last_date: '2026-06-19', observations_count: 1880, history_quality_status: 'COMPLETE' };
    if (opts.withoutYahooListing) delete (history as { source_listing_id?: string }).source_listing_id;
    const universal = {
        meta: { isin },
        identificacion: {
            isin,
            nombre: opts.yahoo ? 'Aena SME SA' : 'Apple Inc',
            ticker,
            mercado: exchange,
            divisa_base: opts.yahoo ? 'EUR' : 'USD',
            simbolo_eodhd: eodhdSymbol,
            simbolo_yahoo: opts.yahoo && !opts.withoutYahooListing ? 'AENA.MC' : undefined,
        },
        rentabilidad: { trailing_pct: { '1a': { fondo: 10 }, '3a_anualizada': { fondo: 50 }, '5a_anualizada': { fondo: 15 } } },
        riesgo: {
            volatilidad_pct: { '1a': { fondo: 9 }, '3a': { fondo: 10 }, '5a': { fondo: 11 } },
            sharpe: { '1a': { fondo: 0.1 }, '3a': { fondo: 1.2345 }, '5a': { fondo: 0.3 } },
            rf_pct: { '1a': { fondo: 2 }, '3a': { fondo: 2.5 }, '5a': { fondo: 1.8 } },
            historial_precios: history,
        },
        valoracion: { vl_fecha: '2026-06-19' },
        calidad: { bucket: 'COMPLETO' },
    };
    const bdb = {
        isin,
        name: universal.identificacion.nombre,
        currency: universal.identificacion.divisa_base,
        classification_v2: { asset_type: 'stock' },
        ms: { stock: { ticker, exchange, fundamentals: { market_cap: 1 } } },
        validation: { diagnostics: { calidad_fondosdb: 'COMPLETO' }, ok: true },
    };

    fs.writeFileSync(path.join(dir, 'export', 'fondos.ndjson'), `${JSON.stringify(universal)}\n`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'export_bdb', `${isin}.json`), `${JSON.stringify(bdb, null, 2)}\n`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'data', 'funds', `${isin}.json`), `${JSON.stringify(universal, null, 2)}\n`, 'utf-8');
    return { dir, isin };
}

describe('FondosDB stock assets dry-run guards', () => {
    it('no permite que métricas parciales pasen como PASS', () => {
        const result = evaluateStockRows([stockRow({ completeMetrics: false })], {});

        expect(result.summary.global_status).toBe('NOT_READY');
        expect(result.summary.NOT_READY).toBe(1);
        expect(result.candidates).toHaveLength(0);
        expect(result.excluded[0].status_reasons).toContain('PARTIAL_TARGET_METRICS');
    });

    it('no incluye el ISIN excluido en candidatos', () => {
        const result = evaluateStockRows([stockRow({ isin: 'ES0105394003', ticker: 'TSK' })], { exclude: ['ES0105394003'] });

        expect(result.summary.EXCLUDED).toBe(1);
        expect(result.candidates.map(row => row.asset_id)).not.toContain('ES0105394003');
        expect(result.excluded[0].status).toBe('EXCLUDED');
    });

    it('marca fundamentales ausentes como READY_WITH_WARNING', () => {
        const result = evaluateStockRows([stockRow({ isin: 'IT0003128367', ticker: 'ENEL', exchange: 'MIL', fundamentals: null })], {});

        expect(result.summary.global_status).toBe('READY_WITH_WARNING');
        expect(result.candidates[0].status).toBe('READY_WITH_WARNING');
        expect(result.candidates[0].status_reasons).toContain('MISSING_FUNDAMENTALS');
    });

    it('usa el ISIN como asset_id y EODHD:ticker.exchange como listing_id', () => {
        const row = stockRow({ isin: 'US0378331005', ticker: 'AAPL', exchange: 'US' });
        const result = evaluateStockRows([row], {});

        expect(result.candidates[0].root_path).toBe('assets/US0378331005');
        expect(result.candidates[0].metrics_path).toBe('assets/US0378331005/metrics/latest');
        expect(result.candidates[0].listing_id).toBe('EODHD:AAPL.US');
    });

    it('el dry-run declara cero escrituras y solo cuatro artefactos', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-dryrun-artifacts-'));
        const result = evaluateStockRows([stockRow()], {});

        writeStockDryRunArtifacts(result, outputDir);

        const summary = JSON.parse(fs.readFileSync(path.join(outputDir, 'stock_ingest_summary.json'), 'utf-8'));
        expect(summary.firestore_writes_executed).toBe(0);
        expect(summary.firestore_deletes_executed).toBe(0);
        expect(fs.readdirSync(outputDir).sort()).toEqual([
            'stock_ingest_candidates.ndjson',
            'stock_ingest_excluded.ndjson',
            'stock_ingest_summary.json',
            'stock_ingest_warnings.json',
        ]);
    });
});

describe('FondosDB stock assets local reader', () => {
    it('copia el Sharpe de fondosdb sin recalcularlo', () => {
        const { dir } = writeLocalFondosDbFixture();
        const [row] = readStockRows(dir);

        expect(row.metrics.windows['3y'].sharpe_ratio).toBe(1.2345);
        expect(row.metrics.windows['3y'].annualized_return).toBe(0.5);
        expect(row.metrics.windows['3y'].annualized_volatility).toBe(0.1);
    });

    it('preserva la traza Yahoo y la cobertura histórica local', () => {
        const { dir } = writeLocalFondosDbFixture({ yahoo: true });
        const [row] = readStockRows(dir);

        expect(row.root.quality.history_trace.source_history).toBe('yahoo');
        expect(row.root.quality.history_trace.source_listing_id).toBe('YAHOO:AENA.MC');
        expect(row.metrics.first_date).toBe('2019-01-02');
        expect(row.metrics.last_date).toBe('2026-06-19');
        expect(row.metrics.observations_count).toBe(1880);
        expect(row.metrics.population).toBe('stock');
        expect(row.metrics.risk_score_source).toBe('VOL_BUCKET');
    });

    it('con historico de Yahoo no fabrica un codigo EODHD con la bolsa de Yahoo (CRIT-10)', () => {
        const { dir } = writeLocalFondosDbFixture({ yahoo: true });
        const [row] = readStockRows(dir);

        // Antes: eodhd_code AENA.MCE y listing_id EODHD:AENA.MCE, un codigo que EODHD no conoce.
        expect(row.root.identifiers.eodhd_code).toBeNull();
        expect(row.listing_id).toBe('YAHOO:AENA.MC');
        expect(row.root.listings[0].listing_id).toBe('YAHOO:AENA.MC');
        expect(row.root.listings[0].eodhd_code).toBeNull();
        expect(row.root.listings[0].source_listing_id).toBe('YAHOO:AENA.MC');
        expect(row.root.listings[0].exchange).toBe('MCE');
        expect(row.root.identifiers.aliases).toEqual(['ES0105046009', 'AENA', 'YAHOO:AENA.MC']);
        expect(row.root.identifiers.aliases.some((alias: string) => alias.startsWith('EODHD:'))).toBe(false);
        expect(row.root.product.has_listing).toBe(true);

        // La alta y el contrato lo aceptan: sigue siendo READY y valida asset-stock.v1.1.
        const evaluated = evaluateStockRows([row], {});
        expect(evaluated.candidates.map((candidate) => candidate.status)).toEqual(['READY']);
        expect(validateCurrentRoot(row.root, true).ok).toBe(true);
    });

    it('con historico de Yahoo sin listing de origen no inventa EODHD:ticker.exchange: queda NOT_READY', () => {
        const { dir } = writeLocalFondosDbFixture({ yahoo: true, withoutYahooListing: true });
        const [row] = readStockRows(dir);

        expect(row.root.quality.history_trace.source_listing_id).toBeNull();
        expect(row.listing_id).toBeNull();
        expect(row.root.identifiers.eodhd_code).toBeNull();
        const evaluated = evaluateStockRows([row], {});
        expect(evaluated.excluded[0].status).toBe('NOT_READY');
        expect(evaluated.excluded[0].status_reasons).toEqual(expect.arrayContaining(['MISSING_LISTING_ID', 'MISSING_SOURCE_LISTING_ID']));
    });

    it('simbolo_eodhd del canonico gana sobre ticker.exchange', () => {
        // Bolsa en formato Yahoo (NMS) con el simbolo EODHD declarado: manda el simbolo.
        const { dir } = writeLocalFondosDbFixture({ exchange: 'NMS', eodhdSymbol: 'AAPL.US' });
        const [row] = readStockRows(dir);

        expect(row.root.identifiers.eodhd_code).toBe('AAPL.US');
        expect(row.listing_id).toBe('EODHD:AAPL.US');
        expect(row.root.listings[0].eodhd_code).toBe('AAPL.US');
        expect(row.root.identifiers.aliases).toEqual(['US0378331005', 'AAPL', 'AAPL.US', 'EODHD:AAPL.US']);
        expect(evaluateStockRows([row], {}).candidates).toHaveLength(1);
        expect(validateCurrentRoot(row.root, true).ok).toBe(true);
    });

    it('sin simbolo_eodhd ni historico de Yahoo, ticker.exchange como hasta ahora', () => {
        const { dir } = writeLocalFondosDbFixture({ eodhdSymbol: '' });
        const [row] = readStockRows(dir);

        expect(row.root.identifiers.eodhd_code).toBe('AAPL.US');
        expect(row.listing_id).toBe('EODHD:AAPL.US');
    });
});
