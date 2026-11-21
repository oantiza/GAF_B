import { describe, it, expect } from 'vitest';

import { describirIds, esDeEstos, idsDeLaOrden, recomponeElIndice } from '../src/ingestion/baseNueva/soloEstos';
import { componerIndice } from '../src/ingestion/baseNueva/indiceDeBusqueda';

describe('--ids: una pasada limitada a unos instrumentos', () => {
    it('sin --ids es todo el catalogo', () => {
        expect(idsDeLaOrden(['node', 'x', '--write'])).toBeUndefined();
        expect(esDeEstos('search_shards/000', undefined)).toBe(true);
        expect(describirIds(undefined)).toBe('todos');
    });

    it('lee la lista, en mayusculas y sin huecos', () => {
        const ids = idsDeLaOrden(['--ids', 'lu0592699093, FR0010312660,', '--write']);
        expect([...(ids ?? [])]).toEqual(['LU0592699093', 'FR0010312660']);
    });

    it('solo deja pasar lo que cuelga de esos instrumentos', () => {
        const ids = new Set(['LU0592699093']);
        expect(esDeEstos('instruments/LU0592699093', ids)).toBe(true);
        expect(esDeEstos('instruments/LU0592699093/price_series/2024', ids)).toBe(true);
        expect(esDeEstos('instruments/LU0592699094/price_series/2024', ids)).toBe(false);
        expect(esDeEstos('instruments/LU05926990/price_series/2024', ids)).toBe(false);
        expect(esDeEstos('search_shards/000', ids)).toBe(false);
        expect(esDeEstos('fx_rates/USD_2026', ids)).toBe(false);
    });

    it('un --ids vacio o raro aborta en vez de escribir todo', () => {
        expect(() => idsDeLaOrden(['--ids'])).toThrow('sin lista');
        expect(() => idsDeLaOrden(['--ids', '--write'])).toThrow('sin lista');
        expect(() => idsDeLaOrden(['--ids', ' , '])).toThrow('vacio');
        expect(() => idsDeLaOrden(['--ids', 'LU0592699093,../x'])).toThrow('no lo parecen');
    });

    it('el indice: siempre sin --ids; con --ids, solo si se pide --con-indice', () => {
        const ids = new Set(['US01609W1027']);
        expect(recomponeElIndice(['--write'], undefined)).toBe(true);
        expect(recomponeElIndice(['--ids', 'US01609W1027', '--write'], ids)).toBe(false);
        expect(recomponeElIndice(['--ids', 'US01609W1027', '--con-indice', '--write'], ids)).toBe(true);
        expect(() => recomponeElIndice(['--con-indice', '--write'], undefined)).toThrow('es para una pasada con --ids');
    });

    it('un alta con --con-indice entra en el indice compuesto solo de las raices, sin bloques', () => {
        const raiz = (id: string, nombre: string) => ({
            instrument_id: id,
            raiz: { instrument_type: 'STOCK', identity: { name: nombre, name_folded: nombre.toLowerCase() }, identifiers: { ticker: 'X' } },
            bloques: {}
        });
        const indice = componerIndice([raiz('US4234031049', 'Hello Group'), raiz('US01609W1027', 'Alibaba')], '2026-11-12T00:00:00Z');
        expect(indice.entradas).toBe(2);
        expect(indice.sinNombre).toEqual([]);
        const entradas = indice.documentos[0]!.documento['entries'] as Array<{ instrument_id: string }>;
        expect(entradas.map((e) => e.instrument_id)).toEqual(['US01609W1027', 'US4234031049']);
    });
});
