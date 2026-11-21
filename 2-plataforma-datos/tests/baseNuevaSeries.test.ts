import { describe, it, expect } from 'vitest';

import { componerCambios, componerSerie, rutaDelAnio, rutaDelCambio, type SerieExportada } from '../src/ingestion/baseNueva/series';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';

const ISIN = 'BE0943877671';
const TIPO = 'instrument-price-series.v2.schema.json';

function serie(puntos: [string, number][], currency: string | null = 'EUR'): SerieExportada {
    return {
        instrument_id: ISIN,
        series_id: `EODHD:${ISIN}.EUFUND`,
        source: 'eodhd',
        price_class: 'NAV',
        currency,
        points: puntos
    };
}

describe('price_series', () => {
    it('reparte por anio sin perder ni un punto y cada documento valida', () => {
        const puntos: [string, number][] = [
            ['2025-12-30', 76.5],
            ['2025-12-31', 76.6],
            ['2026-01-02', 77]
        ];
        const r = componerSerie(serie(puntos));
        expect(r.error).toBeUndefined();
        expect(r.documentos.map((d) => d.ruta)).toEqual([rutaDelAnio(ISIN, '2025'), rutaDelAnio(ISIN, '2026')]);
        const primero = r.documentos[0]!.documento;
        expect(primero['first_date']).toBe('2025-12-30');
        expect(primero['last_date']).toBe('2025-12-31');
        expect(primero['observations']).toBe(2);
        const reconstruida = r.documentos.flatMap((d) =>
            (d.documento['points'] as { date: string; value: number }[]).map((p) => [p.date, p.value])
        );
        expect(reconstruida).toEqual(puntos);
        for (const d of r.documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, 'platform');
            expect(veredicto.ok, JSON.stringify(veredicto)).toBe(true);
        }
    });

    it('una serie dudosa se rechaza entera: no se repara', () => {
        expect(componerSerie(serie([])).error).toContain('sin puntos');
        expect(componerSerie(serie([['2026-01-02', 1], ['2026-01-02', 2]])).error).toContain('repetida');
        expect(componerSerie(serie([['2026-01-03', 1], ['2026-01-02', 2]])).error).toContain('fuera de orden');
        expect(componerSerie(serie([['2026-01-02', 0]])).error).toContain('no positivo');
        expect(componerSerie(serie([['02/01/2026', 1]])).error).toContain('no valida');
        expect(componerSerie(serie([['2026-01-02', 1], ['2026-01-03', -1]])).documentos).toEqual([]);
    });

    it('sin divisa declarada el campo no se inventa', () => {
        const documento = componerSerie(serie([['2026-01-02', 1]], null)).documentos[0]!.documento;
        expect(documento).not.toHaveProperty('currency');
        expect(validarForma(TIPO, documento).ok).toBe(true);
    });

    it('el contrato rechaza un precio cero y un anio de mas puntos que dias', () => {
        const base = {
            instrument_id: ISIN,
            year: '2026',
            series_id: 'x',
            source: 'eodhd',
            price_class: 'NAV',
            first_date: '2026-01-02',
            last_date: '2026-01-02',
            observations: 1
        };
        expect(validarForma(TIPO, { ...base, points: [{ date: '2026-01-02', value: 0 }] }).ok).toBe(false);
        const demasiados = Array.from({ length: 367 }, () => ({ date: '2026-01-02', value: 1 }));
        expect(validarForma(TIPO, { ...base, points: demasiados }).ok).toBe(false);
    });
});

describe('price_series de una serie compuesta (decision D-9)', () => {
    const SEC = 'F00000MK7K';
    const ID = `EODHD:${ISIN}.EUFUND+MORNINGSTAR:${SEC}`;
    const puntos: [string, number][] = [
        ['2023-12-29', 100],
        ['2024-03-08', 101],
        ['2024-03-11', 102],
        ['2024-03-12', 103],
        ['2025-01-02', 104]
    ];
    const compuesta = (segments: SerieExportada['segments'], pts = puntos): SerieExportada => ({
        instrument_id: ISIN,
        series_id: ID,
        source: 'eodhd+morningstar',
        price_class: 'NAV',
        currency: 'EUR',
        segments,
        points: pts
    });
    const tramos = [
        { source: 'eodhd', series_id: `EODHD:${ISIN}.EUFUND`, first_date: '2023-12-29', last_date: '2024-03-11', observations: 3 },
        { source: 'morningstar', series_id: `MORNINGSTAR:${SEC}`, first_date: '2024-03-12', last_date: '2025-01-02', observations: 2 }
    ];

    it('cada anio dice de quien son sus puntos, y solo el del cambio lleva los tramos', () => {
        const r = componerSerie(compuesta(tramos));
        expect(r.error).toBeUndefined();
        const [d2023, d2024, d2025] = r.documentos.map((d) => d.documento);
        expect(d2023!['source']).toBe('eodhd');
        expect(d2025!['source']).toBe('morningstar');
        expect(d2023).not.toHaveProperty('source_segments');
        expect(d2025).not.toHaveProperty('source_segments');
        expect(d2024!['source']).toBe('eodhd+morningstar');
        expect(d2024!['source_segments']).toEqual([
            { source: 'eodhd', series_id: `EODHD:${ISIN}.EUFUND`, first_date: '2024-03-08', last_date: '2024-03-11', observations: 2 },
            { source: 'morningstar', series_id: `MORNINGSTAR:${SEC}`, first_date: '2024-03-12', last_date: '2024-03-12', observations: 1 }
        ]);
        /* La identidad es la de la serie entera en todos los anios: es lo que la une con sus metricas. */
        expect(r.documentos.every((d) => d.documento['series_id'] === ID)).toBe(true);
        for (const d of r.documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, 'platform');
            expect(veredicto.ok, JSON.stringify(veredicto)).toBe(true);
        }
    });

    it('una sustitucion entera es de una sola fuente y no lleva tramos en ningun anio', () => {
        const solo = [{ source: 'morningstar', series_id: `MORNINGSTAR:${SEC}`, first_date: '2023-12-29', last_date: '2025-01-02', observations: 5 }];
        const r = componerSerie({ ...compuesta(solo), series_id: `MORNINGSTAR:${SEC}`, source: 'morningstar' });
        expect(r.documentos.map((d) => d.documento['source'])).toEqual(['morningstar', 'morningstar', 'morningstar']);
        expect(r.documentos.some((d) => 'source_segments' in d.documento)).toBe(false);
    });

    it('unos tramos que no cubren, se solapan o no cuadran rechazan la serie entera', () => {
        expect(componerSerie(compuesta([tramos[0]!])).error).toContain('ningun tramo');
        expect(componerSerie(compuesta([tramos[0]!, { ...tramos[1]!, first_date: '2024-03-11', observations: 3 }])).error).toContain('solapado');
        expect(componerSerie(compuesta([{ ...tramos[0]!, observations: 4 }, tramos[1]!])).error).toContain('dice 4 puntos');
        expect(componerSerie(compuesta([])).error).toContain('segments vacio');
    });

    it('el contrato no admite tramos en un anio de una sola fuente', () => {
        const documento = {
            instrument_id: ISIN,
            year: '2025',
            series_id: ID,
            source: 'morningstar',
            price_class: 'NAV',
            first_date: '2025-01-02',
            last_date: '2025-01-02',
            observations: 1,
            points: [{ date: '2025-01-02', value: 104 }]
        };
        expect(validarForma(TIPO, documento).ok).toBe(true);
        const unTramo = { ...documento, source_segments: [{ source: 'morningstar', series_id: 'x', first_date: '2025-01-02', last_date: '2025-01-02', observations: 1 }] };
        expect(validarForma(TIPO, unTramo).ok).toBe(false);
    });
});

describe('fx_rates', () => {
    const cambios = (puntos: [string, number][]) => ({
        currency: 'USD',
        series_key: 'EXR/D.USD.EUR.SP00.A',
        source: 'ECB',
        points: puntos
    });

    it('reparte por anio y cada documento valida', () => {
        const r = componerCambios(cambios([['2025-12-31', 1.04], ['2026-01-02', 1.03]]));
        expect(r.documentos.map((d) => d.ruta)).toEqual([rutaDelCambio('USD', '2025'), rutaDelCambio('USD', '2026')]);
        for (const d of r.documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, 'platform');
            expect(veredicto.ok, JSON.stringify(veredicto)).toBe(true);
        }
    });

    it('un cambio dudoso se rechaza entero', () => {
        expect(componerCambios(cambios([])).error).toContain('sin cambios');
        expect(componerCambios(cambios([['2026-01-02', 0]])).error).toContain('no positivo');
        expect(componerCambios(cambios([['2026-01-03', 1], ['2026-01-02', 1]])).error).toContain('fuera de orden');
    });
});
