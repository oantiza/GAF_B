import { describe, it, expect } from 'vitest';
import { buildFundMetricsLatest, buildStockMetricsLatest } from '../src/loader/metricsLatest';
import { validators } from '../contracts/validators';

/**
 * Ola 1 (1.3): metrics.v1.2 declara, por ventana, `method` y `frequency`.
 *
 * Sin ellos el comparador ponia en la misma columna el Sharpe trailing de
 * Morningstar de un fondo y el calculado en casa sobre serie diaria de una
 * accion, sin que nadie aguas abajo pudiera saber que no son comparables
 * (auditoria 03-09, hallazgo 02).
 */

const rootFondo = {
    asset_id: 'LU0690375182',
    source_metadata: { generated_at: '2026-09-01T10:00:00Z' },
    performance: {
        returns: {
            trailing_pct: {
                '1a': { fondo: 12.5 },
                '3a_anualizada': { fondo: 9.1 },
                '5a_anualizada': { fondo: 8.4 },
                '10a_anualizada': { fondo: 7.2 },
                ytd: { fondo: 4.3 }
            }
        }
    },
    risk: {
        volatilidad_pct: { '1a': { fondo: 14.2 }, '3a': { fondo: 13.1 }, '5a': { fondo: 12.7 } },
        sharpe: { '1a': { fondo: 0.72 }, '3a': { fondo: 0.61 }, '5a': { fondo: 0.55 } },
        rf_pct: { '1a': { fondo: 2.1 }, '3a': { fondo: 1.8 }, '5a': { fondo: 1.2 } },
        srri_1a7: 4
    }
};

describe('metrics.v1.2 · declaracion de metodologia', () => {
    it('las ventanas de fondo se declaran como cifra del proveedor', () => {
        const metrics = buildFundMetricsLatest(rootFondo);

        for (const label of ['1y', '3y', '5y', '10y']) {
            expect(metrics.windows[label].method).toBe('TRAILING_PROVIDER');
            expect(metrics.windows[label].frequency).toBe('PROVIDER');
        }
    });

    it('el documento de fondo cumple el contrato v1.2', () => {
        const result = validators.masterMetricsV12(buildFundMetricsLatest(rootFondo));
        expect(result.errors ?? []).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('un documento sin method ni frequency sigue siendo valido', () => {
        // v1.2 los anade como opcionales: lo escrito antes de la migracion no
        // deja de valer, simplemente no declara con que se midio.
        const metrics = buildFundMetricsLatest(rootFondo);
        for (const label of Object.keys(metrics.windows)) {
            delete metrics.windows[label].method;
            delete metrics.windows[label].frequency;
        }
        expect(validators.masterMetricsV12(metrics).ok).toBe(true);
    });

    it('las ventanas de accion arrastran lo que declare su origen, sin inventarlo', () => {
        const conEtiqueta = buildStockMetricsLatest({
            source: 'FONDOSDB_EODHD_DAILY_HISTORY',
            updated_at: '2026-09-01T10:00:00Z',
            windows: {
                '1y': {
                    annualized_return: 0.11,
                    annualized_volatility: 0.28,
                    sharpe_ratio: 0.32,
                    method: 'GEOMETRIC_CAGR',
                    frequency: 'DAILY'
                }
            }
        }, 'US0378331005');

        expect(conEtiqueta.windows['1y'].method).toBe('GEOMETRIC_CAGR');
        expect(conEtiqueta.windows['1y'].frequency).toBe('DAILY');
        expect(validators.masterMetricsV12(conEtiqueta).ok).toBe(true);

        const sinEtiqueta = buildStockMetricsLatest({
            source: 'FONDOSDB_EODHD_DAILY_HISTORY',
            updated_at: '2026-09-01T10:00:00Z',
            windows: { '1y': { annualized_return: 0.11, annualized_volatility: 0.28 } }
        }, 'US0378331005');

        expect(sinEtiqueta.windows['1y'].method).toBeUndefined();
        expect(sinEtiqueta.windows['1y'].frequency).toBeUndefined();
    });

    it('una etiqueta fuera del enum no se escribe', () => {
        const metrics = buildStockMetricsLatest({
            source: 'X',
            updated_at: '2026-09-01T10:00:00Z',
            windows: { '1y': { annualized_volatility: 0.28, method: 'INVENTADO', frequency: 'HORARIA' } }
        }, 'US0378331005');

        expect(metrics.windows['1y'].method).toBeUndefined();
        expect(metrics.windows['1y'].frequency).toBeUndefined();
        expect(validators.masterMetricsV12(metrics).ok).toBe(true);
    });
});
