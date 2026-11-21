/**
 * A11 (2026-07-11): ownership de metrics/latest entre escritores.
 * El loader posee windows/ytd/srri/max_drawdown_5y...; el refresh de la app
 * (metrics_refresh.py) posee max_drawdown_hist, last_date y updated_at.
 * El republish debe ignorarlos en el diff y preservarlos al escribir.
 */
import { describe, expect, it } from 'vitest';

import {
    APP_COMPUTED_METRICS_SOURCES,
    mergeMetricsPreservingRefreshOwned,
    metricsOwnedDiff,
    ownsMetrics,
} from '../src/loader/republish';

const expected = {
    asset_id: 'IE00B28YJQ65',
    population: 'fund',
    source: 'FONDOSDB_ROOT_ES',
    updated_at: '2026-07-11T00:00:00.000Z',
    windows: { '3y': { annualized_return: 0.0915 } },
    ytd_return: 0.0115,
    risk_score_source: 'SRRI',
};

const liveConRefresh = {
    ...expected,
    // Campos escritos por metrics_refresh.py (merge) — más frescos que el canónico:
    updated_at: '2026-07-11T06:30:00.000Z',
    last_date: '2026-07-10',
    max_drawdown_hist: { value: -0.4133, date: '2020-03-23' },
};

describe('metricsOwnedDiff', () => {
    it('no marca drift cuando solo difieren los campos refresh-owned', () => {
        expect(metricsOwnedDiff(expected, liveConRefresh)).toEqual([]);
    });

    it('marca drift cuando difiere un campo owned del loader', () => {
        const live = { ...liveConRefresh, windows: { '3y': { annualized_return: 0.2235 } } };
        expect(metricsOwnedDiff(expected, live).length).toBeGreaterThan(0);
    });

    it('marca drift total cuando el doc vivo no existe', () => {
        expect(metricsOwnedDiff(expected, null)).toEqual(['']);
    });
});

describe('mergeMetricsPreservingRefreshOwned', () => {
    it('preserva max_drawdown_hist, last_date y updated_at del doc vivo', () => {
        const payload = mergeMetricsPreservingRefreshOwned(expected, liveConRefresh);
        expect(payload.max_drawdown_hist).toEqual({ value: -0.4133, date: '2020-03-23' });
        expect(payload.last_date).toBe('2026-07-10');
        expect(payload.updated_at).toBe('2026-07-11T06:30:00.000Z');
        // Los campos owned del loader vienen del expected:
        expect(payload.windows['3y'].annualized_return).toBe(0.0915);
    });

    it('usa los valores del expected cuando el doc vivo no existe (create)', () => {
        const payload = mergeMetricsPreservingRefreshOwned(expected, null);
        expect(payload.updated_at).toBe('2026-07-11T00:00:00.000Z');
        expect(payload.max_drawdown_hist).toBeUndefined();
        expect(payload.last_date).toBeUndefined();
    });
});

/**
 * Ola 1 (B, 04-09): quien es dueno de metrics/latest.
 *
 * La pasada en seco del republish del 04-09 iba a reescribir las metricas de 74
 * acciones desde el canonico del extractor, y 73 de ellas acababan de
 * recalcularse con la formula correcta. Habria revertido la correccion. Las
 * metricas de accion son de la ingesta de la app; esta tuberia solo posee las
 * de fondo (auditoria 03-09, hallazgo 03).
 */
describe('propiedad de metrics/latest por poblacion', () => {
    it('los fondos sin documento son de esta tuberia (puente del alta)', () => {
        expect(ownsMetrics(false, false)).toBe(true);
        expect(ownsMetrics(false, false, null)).toBe(true);
    });

    it('las acciones no', () => {
        expect(ownsMetrics(true, false)).toBe(false);
    });

    it('--root-only no toca metricas de nadie', () => {
        expect(ownsMetrics(false, true)).toBe(false);
        expect(ownsMetrics(true, true)).toBe(false);
    });
});

/**
 * 13-10-2026: dueno unico de las metricas de fondo. Desde la migracion del
 * 10-09 la app calcula las de los fondos con serie propia y el refresco diario
 * las mantiene; la pasada en seco sobre la copia del 13-10 habria devuelto 714
 * de 752 fondos al trailing de Morningstar. Esta tuberia solo es puente.
 */
describe('metricas de fondo: la tuberia solo es puente', () => {
    it.each(['FONDOSDB_EODHD_DAILY_HISTORY', 'FONDOSDB_FUND_NAV_EUR', 'FUND_QUALITY_REVIEW_V1'])(
        'no toca un fondo cuyo metrics/latest ya calcula la app (%s)', (source) => {
            expect(APP_COMPUTED_METRICS_SOURCES.has(source)).toBe(true);
            expect(ownsMetrics(false, false, { source })).toBe(false);
        });

    it('sigue refrescando el trailing del proveedor mientras no haya calculo propio', () => {
        expect(ownsMetrics(false, false, { source: 'FONDOSDB_ROOT_ES' })).toBe(true);
        expect(ownsMetrics(false, false, {})).toBe(true);
    });

    it('acciones y --root-only siguen fuera aunque el documento sea del proveedor', () => {
        expect(ownsMetrics(true, false, { source: 'FONDOSDB_ROOT_ES' })).toBe(false);
        expect(ownsMetrics(false, true, { source: 'FONDOSDB_ROOT_ES' })).toBe(false);
    });
});
