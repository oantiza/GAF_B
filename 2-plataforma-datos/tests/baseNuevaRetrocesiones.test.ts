import * as admin from 'firebase-admin';
import { describe, expect, it } from 'vitest';

import { validarForma } from '../src/config/baseNueva/validadores';
import { CLAVE_MARCA, mapearFila, marcaDeTiempo } from '../src/ingestion/baseNueva/retrocesiones';
import { componerTipoDeReferencia } from '../src/ingestion/baseNueva/series';

const RETRO = {
    isin: 'BE0946564383',
    retro_pct: 0.7881,
    as_of_date: '2026-05-14',
    source: 'FILE_IMPORT',
    note: null,
    updated_by: 'asesor@example.test',
    updated_at: { [CLAVE_MARCA]: '2026-09-07T11:40:35.887123Z' }
};

const RECIBO = {
    import_id: 'prueba',
    created_at: { [CLAVE_MARCA]: '2026-09-07T11:40:33.975Z' },
    created_by: 'asesor@example.test',
    as_of_date: '2026-05-14',
    file_name: null,
    scale: 'porcentaje',
    replace_all: false,
    counts: { CREATE: 1, UPDATE: 1 },
    previous: { BE0946564383: null, LU0554840230: { retro_pct: 0.5, source: 'MANUAL', as_of_date: '2026-01-01' } },
    applied: { BE0946564383: { retro_pct: 0.7881, source: 'FILE_IMPORT', as_of_date: '2026-05-14' }, LU0554840230: 'DELETE' },
    schema_version: 2,
    applied_isins: ['BE0946564383'],
    undone_isins: [],
    applied_versions: { BE0946564383: { [CLAVE_MARCA]: '2026-09-07T11:40:35.887Z' } },
    status: 'applied'
};

describe('retrocesiones en la base nueva', () => {
    it('conserva los nanosegundos, que es lo que compara el deshacer', () => {
        const marca = marcaDeTiempo('2026-09-07T11:40:35.887123Z');
        expect(marca.nanoseconds).toBe(887123000);
        expect(marca.toDate().toISOString()).toBe('2026-09-07T11:40:35.887Z');
        expect(marcaDeTiempo('2026-09-07T11:40:35Z').nanoseconds).toBe(0);
        expect(() => marcaDeTiempo('ayer')).toThrow();
    });

    it('la retrocesion valida, sin el null y con su fecha como marca de tiempo', () => {
        const { documento } = mapearFila({ coleccion: 'commercial_retro', id: RETRO.isin, datos: RETRO });
        expect(documento?.ruta).toBe('commercial_retro/BE0946564383');
        expect(documento?.documento).not.toHaveProperty('note');
        expect(documento?.documento['updated_at']).toBeInstanceOf(admin.firestore.Timestamp);
        expect(validarForma(documento!.tipo, documento!.documento).ok).toBe(true);
    });

    it('el recibo valida y conserva el null de lo que no existia', () => {
        const { documento } = mapearFila({ coleccion: 'commercial_retro_imports', id: 'prueba', datos: RECIBO });
        expect(documento?.documento).not.toHaveProperty('file_name');
        expect((documento?.documento['previous'] as Record<string, unknown>)['BE0946564383']).toBeNull();
        expect((documento?.documento['applied_versions'] as Record<string, unknown>)['BE0946564383']).toBeInstanceOf(admin.firestore.Timestamp);
        expect(validarForma(documento!.tipo, documento!.documento).ok).toBe(true);
    });

    it.each([
        ['un margen en otra escala', { retro_pct: 150 }],
        ['un margen negativo', { retro_pct: -1 }],
        ['un estado inventado', { status: 'QUIZA' }],
        ['una clave no declarada', { margen: 1 }]
    ])('rechaza %s', (_nombre, cambio) => {
        const { documento } = mapearFila({ coleccion: 'commercial_retro', id: RETRO.isin, datos: { ...RETRO, ...cambio } });
        expect(validarForma(documento!.tipo, documento!.documento).ok).toBe(false);
    });

    it('una fecha que no es marca de tiempo para la carga, no se escribe como texto', () => {
        const { error } = mapearFila({ coleccion: 'commercial_retro', id: RETRO.isin, datos: { ...RETRO, updated_at: '2026-09-07' } });
        expect(error).toContain('updated_at');
    });
});

describe('la ESTR guardada', () => {
    const tipo = {
        rate: 'ESTR',
        series_key: 'EST/B.EU000A2X2A25.WT',
        source: 'ECB',
        points: [['2021-12-30', -0.0058], ['2026-01-02', 0.0193], ['2026-01-05', 0.0192]] as [string, number][]
    };

    it('se parte por anios, admite negativos y valida contra su contrato', () => {
        const { documentos, error } = componerTipoDeReferencia(tipo);
        expect(error).toBeUndefined();
        expect(documentos.map((d) => d.ruta)).toEqual(['reference_rates/ESTR_2021', 'reference_rates/ESTR_2026']);
        for (const d of documentos) expect(validarForma(d.tipo, d.documento).ok).toBe(true);
    });

    it('rechaza una serie desordenada', () => {
        const { error } = componerTipoDeReferencia({ ...tipo, points: [['2026-01-05', 0.02], ['2026-01-02', 0.02]] });
        expect(error).toContain('fuera de orden');
    });

    it('un por ciento colado en lugar de una fraccion no valida', () => {
        const { documentos } = componerTipoDeReferencia({ ...tipo, points: [['2026-01-02', 1.93]] });
        expect(validarForma(documentos[0]!.tipo, documentos[0]!.documento).ok).toBe(false);
    });
});
