import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadStockPopulation } from '../../src/loader/republish';
import { STOCK_ROOT_SCHEMA_VERSION } from '../../src/loader/ownership';

/** Accion de un paquete del extractor de prueba. */
export interface StockSpec { isin: string; ticker: string; name: string; bucket?: string; withoutFundamentals?: boolean }

export const READY_ISIN = 'ES0113900J37';
export const NOT_READY_ISIN = 'ES0105394003';
export const SECOND_NOT_READY_ISIN = 'ES0105630315';
export const WARNING_ISIN = 'ES0167050915';

export const READY_STOCK: StockSpec = { isin: READY_ISIN, ticker: 'SAN', name: 'Banco Santander SA' };
// FONDOSDB_BLOCKED y nada mas: NOT_READY en evaluateStockRows, como TSK en el canonico del 16-10.
export const NOT_READY_STOCK: StockSpec = { isin: NOT_READY_ISIN, ticker: 'TSK', name: 'Tubacex SA', bucket: 'BLOQUEADO' };
export const SECOND_NOT_READY_STOCK: StockSpec = { isin: SECOND_NOT_READY_ISIN, ticker: 'CIE', name: 'CIE Automotive SA', bucket: 'BLOQUEADO' };
// Sin fundamentales: READY_WITH_WARNING (MISSING_FUNDAMENTALS).
export const WARNING_STOCK: StockSpec = { isin: WARNING_ISIN, ticker: 'FER', name: 'Ferrovial SE', withoutFundamentals: true };

/** Paquete del extractor minimo (export_bdb, fondos.ndjson y manifiesto) con acciones. */
export function writeStockPackage(stocks: StockSpec[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'republish-stocks-'));
    fs.mkdirSync(path.join(dir, 'export'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'export_bdb'), { recursive: true });
    const universalLines: string[] = [];
    for (const stock of stocks) {
        const bucket = stock.bucket || 'COMPLETO';
        universalLines.push(JSON.stringify({
            meta: { isin: stock.isin },
            identificacion: { isin: stock.isin, nombre: stock.name, ticker: stock.ticker, mercado: 'MC', divisa_base: 'EUR', simbolo_eodhd: `${stock.ticker}.MC` },
            rentabilidad: { trailing_pct: { '1a': { fondo: 10 }, '3a_anualizada': { fondo: 12 }, '5a_anualizada': { fondo: 8 } } },
            riesgo: {
                volatilidad_pct: { '1a': { fondo: 20 }, '3a': { fondo: 22 }, '5a': { fondo: 24 } },
                sharpe: { '1a': { fondo: 0.4 }, '3a': { fondo: 0.5 }, '5a': { fondo: 0.3 } },
                historial_precios: {
                    source_history: 'eodhd', source_listing_id: `EODHD:${stock.ticker}.MC`,
                    first_date: '2016-01-04', last_date: '2026-10-13', observations_count: 2700, history_quality_status: 'COMPLETE'
                }
            },
            calidad: { bucket }
        }));
        fs.writeFileSync(path.join(dir, 'export_bdb', `${stock.isin}.json`), JSON.stringify({
            isin: stock.isin,
            name: stock.name,
            currency: 'EUR',
            generated_at: '2026-10-14T08:00:00Z',
            report_date: '2026-10-13',
            classification_v2: { asset_type: 'stock' },
            ms: { stock: { ticker: stock.ticker, exchange: 'MC', ...(stock.withoutFundamentals ? {} : { fundamentals: { market_cap: 1 } }) } },
            validation: { ok: true, diagnostics: { calidad_fondosdb: bucket } }
        }, null, 2) + '\n', 'utf-8');
    }
    fs.writeFileSync(path.join(dir, 'export', 'fondos.ndjson'), universalLines.join('\n') + '\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'export', 'manifest.json'), JSON.stringify({ esquema_version: '2', n_fondos: stocks.length }) + '\n', 'utf-8');
    return dir;
}

/** La raiz que dejo la alta en la maestra, tal cual. */
export function liveRoot(dir: string, isin: string): Record<string, any> {
    const row = loadStockPopulation(dir, true).get(isin)!;
    return { ...row.root, schema_version: STOCK_ROOT_SCHEMA_VERSION, updated_at: '2026-10-01T00:00:00.000Z' };
}

/** La maestra con la raiz que dejo la alta, pero con otro nombre: hay deriva en un bloque de la plataforma. */
export function liveRootWithDrift(dir: string, isin: string): Record<string, any> {
    const root = liveRoot(dir, isin);
    return { ...root, identity: { ...root.identity, name: `${root.identity.name} (nombre viejo)` } };
}

export function tempOutDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'republish-out-'));
}
