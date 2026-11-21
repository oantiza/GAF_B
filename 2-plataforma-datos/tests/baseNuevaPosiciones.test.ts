import { describe, it, expect } from 'vitest';

import {
    PESO_MAXIMO_DE_UNA_LINEA,
    POSICIONES_POR_TROZO,
    componerTrozos,
    pesoCreible,
    rutaDelTrozo
} from '../src/ingestion/baseNueva/posiciones';
import { validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas } from '../src/config/baseNueva/esquemas';

/**
 * La cartera completa, troceada.
 *
 * Lo que se comprueba no es que salgan documentos: es que la lista entera quepa sin que
 * ningún documento crezca con el producto, que el orden se conserve -el trozo 000 lleva las
 * posiciones mayores, y de eso depende que leer el primero valga para pintar las diez
 * primeras- y que una línea que no se puede ni nombrar ni sumar no se escriba con un hueco
 * dentro.
 */

const ISIN = 'IE00B18GC888';
const FECHA = '2026-09-30';

function posiciones(cuantas: number, pesoPct = 0.5): { name: string; weight: number; isin?: string }[] {
    return Array.from({ length: cuantas }, (_, i) => ({
        name: `Posicion ${i + 1}`,
        weight: pesoPct,
        isin: 'DE000BU22148'
    }));
}

describe('holdings_chunks', () => {
    it('el tope de 500 es el del contrato, no un numero elegido aqui', () => {
        const esquema = cargarEsquemas().find((c) => c.fichero === 'instrument-holdings-chunk.v2.schema.json');
        expect(esquema).toBeDefined();
        const lista = (esquema!.json['properties'] as Record<string, Record<string, unknown>>)['positions'];
        expect(lista!['maxItems']).toBe(POSICIONES_POR_TROZO);
    });

    it('trocea de 500 en 500 y numera con tres digitos', () => {
        /* 1.200 posiciones es un fondo de renta fija de los normales; el mayor medido el
           02-11-2026 tiene 10.000, que son 20 trozos. */
        const r = componerTrozos(ISIN, posiciones(1200), 'canonical:fondosdb', FECHA);
        expect(r.posiciones).toBe(1200);
        expect(r.documentos).toHaveLength(3);
        expect(r.rutas).toEqual([
            `instruments/${ISIN}/holdings_chunks/000`,
            `instruments/${ISIN}/holdings_chunks/001`,
            `instruments/${ISIN}/holdings_chunks/002`
        ]);
        expect((r.documentos[2]!.documento['positions'] as unknown[])).toHaveLength(200);
        expect(r.documentos[2]!.documento['chunk_id']).toBe('002');
        for (const documento of r.documentos) {
            expect(validarForma('instrument-holdings-chunk.v2.schema.json', documento.documento).ok).toBe(true);
        }
    });

    it('el orden se conserva: el trozo 000 lleva las mayores', () => {
        /* El canonico las manda ordenadas por peso de mayor a menor, y el troceado NO
           reordena. De eso depende que un lector que solo quiera las diez primeras lea un
           documento en vez de los veinte. */
        const mezcla = [
            { name: 'La mayor', weight: 9 },
            { name: 'La mediana', weight: 5 },
            ...posiciones(600, 0.1),
            { name: 'La ultima', weight: 0.01 }
        ];
        const r = componerTrozos(ISIN, mezcla, 'canonical:fondosdb', FECHA);
        const primero = r.documentos[0]!.documento['positions'] as Record<string, unknown>[];
        const ultimo = r.documentos[1]!.documento['positions'] as Record<string, unknown>[];
        expect(primero[0]!['name']).toBe('La mayor');
        expect(primero[1]!['name']).toBe('La mediana');
        expect(ultimo[ultimo.length - 1]!['name']).toBe('La ultima');
    });

    it('el peso entra en FRACCION, y un nocional de derivado cabe', () => {
        /* Si el rango fuera [0, 1] se tiraria el documento entero, que es lo que pasaba en la
           primera version. El -480 % es el mayor nocional medido: un `Cash Offset` de Nordea. */
        const r = componerTrozos(
            ISIN,
            [
                { name: 'E-mini S&P 500 Future', weight: 109.74 },
                { name: 'Cash Offset', weight: -480.34 },
                { name: 'Una accion normal', weight: 2.5 }
            ],
            'canonical:fondosdb',
            FECHA
        );
        const lineas = r.documentos[0]!.documento['positions'] as Record<string, number>[];
        expect(lineas[0]!['weight']).toBeCloseTo(1.0974, 5);
        expect(lineas[1]!['weight']).toBeCloseTo(-4.8034, 5);
        expect(lineas[2]!['weight']).toBeCloseTo(0.025, 5);
        expect(r.pesosImposibles).toEqual([]);
        expect(validarForma('instrument-holdings-chunk.v2.schema.json', r.documentos[0]!.documento).ok).toBe(true);
    });

    it('un peso imposible no se escribe, y se dice cual', () => {
        /* CaixaBank Gestion Tendencias: 10.154 millones de yenes tomados por euros sobre 277,3 M
           de patrimonio, y su contrapartida. En euros el forward seria un 20,6 %. Quitar las dos
           lineas deja la cartera sumando 100,11 en vez de 100,00: se cancelaban. */
        const r = componerTrozos(
            ISIN,
            [
                { name: 'JPY/EUR - Currency Forward Purchased', weight: 3662.436, holding_type_code: 'CU' },
                { name: 'Una accion', weight: 100.11, holding_type_code: 'E' },
                { name: 'Cash Offset', weight: -3662.551, holding_type_code: 'CQ' }
            ],
            'canonical:fondosdb',
            FECHA
        );
        expect(r.pesosImposibles).toEqual(['JPY/EUR - Currency Forward Purchased', 'Cash Offset']);
        expect(r.posiciones).toBe(1);
        expect(r.descartadas).toBe(0);
        expect(validarForma('instrument-holdings-chunk.v2.schema.json', r.documentos[0]!.documento).ok).toBe(true);
    });

    it('el tope es el del contrato, justo en el borde', () => {
        const esquema = cargarEsquemas().find((c) => c.fichero === 'instrument-holdings-chunk.v2.schema.json');
        const lista = (esquema!.json['properties'] as Record<string, Record<string, any>>)['positions'];
        const peso = lista!['items']['properties']['weight'];
        expect(peso['maximum']).toBe(PESO_MAXIMO_DE_UNA_LINEA);
        expect(peso['minimum']).toBe(-PESO_MAXIMO_DE_UNA_LINEA);
        expect(pesoCreible(10)).toBe(true);
        expect(pesoCreible(-10)).toBe(true);
        expect(pesoCreible(10.0001)).toBe(false);
    });

    it('la linea lleva su codigo fino, y sin el no lo inventa', () => {
        const r = componerTrozos(
            ISIN,
            [
                { name: 'NVIDIA Corp', weight: 5, asset_type: 'EQUITY', holding_type_code: 'E' },
                { name: 'FX FORW EUR/USD Purchased', weight: 3, asset_type: 'OTHER', holding_type_code: 'CU' },
                { name: 'Una linea de justETF', weight: 1 }
            ],
            'canonical:fondosdb',
            FECHA
        );
        const lineas = r.documentos[0]!.documento['positions'] as Record<string, unknown>[];
        expect(lineas[0]!['holding_type_code']).toBe('E');
        expect(lineas[1]!['holding_type_code']).toBe('CU');
        expect(lineas[2]).not.toHaveProperty('holding_type_code');
        expect(validarForma('instrument-holdings-chunk.v2.schema.json', r.documentos[0]!.documento).ok).toBe(true);
    });

    it('una linea sin nombre o sin peso no se escribe, y se cuenta', () => {
        const r = componerTrozos(
            ISIN,
            [
                { name: 'Buena', weight: 1 },
                { name: '   ', weight: 1 },
                { name: 'Sin peso', weight: undefined },
                { name: 'Peso que no es numero', weight: 'mucho' }
            ],
            'canonical:fondosdb',
            FECHA
        );
        expect(r.posiciones).toBe(1);
        expect(r.descartadas).toBe(3);
        expect((r.documentos[0]!.documento['positions'] as unknown[])).toHaveLength(1);
    });

    it('lo que la linea no trae no se inventa', () => {
        const r = componerTrozos(
            ISIN,
            [{ name: 'Sin ISIN ni sector ni clase', weight: 1 }],
            'canonical:fondosdb',
            FECHA
        );
        const linea = (r.documentos[0]!.documento['positions'] as Record<string, unknown>[])[0]!;
        expect(linea).toEqual({ name: 'Sin ISIN ni sector ni clase', weight: 0.01 });
    });

    it('sin posiciones no escribe un trozo vacio', () => {
        const r = componerTrozos(ISIN, [], 'canonical:fondosdb', FECHA);
        expect(r.documentos).toHaveLength(0);
        expect(r.rutas).toHaveLength(0);
    });

    it('la ruta de un trozo se construye en un solo sitio', () => {
        expect(rutaDelTrozo(ISIN, 0)).toBe(`instruments/${ISIN}/holdings_chunks/000`);
        expect(rutaDelTrozo(ISIN, 19)).toBe(`instruments/${ISIN}/holdings_chunks/019`);
    });
});
