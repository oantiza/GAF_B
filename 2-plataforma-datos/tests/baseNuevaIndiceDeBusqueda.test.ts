import { describe, it, expect } from 'vitest';

import {
    ENTRADAS_POR_FRAGMENTO,
    componerIndice,
    rutaDeFragmento
} from '../src/ingestion/baseNueva/indiceDeBusqueda';
import type { InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import { validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas } from '../src/config/baseNueva/esquemas';

/**
 * El índice de búsqueda.
 *
 * Lo que se comprueba aquí no es que salgan fragmentos: es que el índice dé **lo mismo** que
 * leer todas las raíces, que no se reordene cuando no debe, y que no se invente un nombre
 * para un activo que no lo tiene. Un índice que miente es peor que no tener índice: la
 * pantalla deja de encontrar un activo y nadie se enfada con el índice.
 */

const AHORA = '2026-11-02T18:00:00.000Z';

function instrumento(isin: string, nombre: string | undefined, cambios: Record<string, unknown> = {}): InstrumentoLeido {
    const identidad: Record<string, unknown> = { currency: 'EUR' };
    if (nombre !== undefined) {
        identidad['name'] = nombre;
        identidad['name_folded'] = nombre.toLowerCase();
    }
    return {
        instrument_id: isin,
        raiz: { instrument_id: isin, instrument_type: 'FUND', identity: identidad, ...cambios },
        bloques: {}
    };
}

/** Los ISIN de un fragmento, en el orden en que los guarda. */
function isines(documento: Record<string, unknown>): string[] {
    return (documento['entries'] as { instrument_id: string }[]).map((e) => e.instrument_id);
}

describe('search_shards', () => {
    it('el tope de 500 es el del contrato, no un numero elegido aqui', () => {
        /* El contrato dice `maxItems: 500` y explica con ese numero su propia aritmetica. Si
           alguien lo cambia en un sitio y no en el otro, el escritor produce documentos que
           el contrato rechaza, y eso se descubre en la pasada y no aqui. */
        const esquema = cargarEsquemas().find((c) => c.fichero === 'search-shard.v2.schema.json');
        expect(esquema).toBeDefined();
        const entries = (esquema!.json['properties'] as Record<string, Record<string, unknown>>)['entries'];
        expect(entries!['maxItems']).toBe(ENTRADAS_POR_FRAGMENTO);
    });

    it('fragmenta de 500 en 500 y numera con tres digitos', () => {
        const muchos = Array.from({ length: ENTRADAS_POR_FRAGMENTO * 2 + 1 }, (_, i) =>
            instrumento(`ES${String(i).padStart(9, '0')}1`, `Fondo ${i}`)
        );
        const indice = componerIndice(muchos, AHORA);

        expect(indice.entradas).toBe(ENTRADAS_POR_FRAGMENTO * 2 + 1);
        expect(indice.documentos).toHaveLength(3);
        expect(indice.rutas).toEqual(['search_shards/000', 'search_shards/001', 'search_shards/002']);
        expect(isines(indice.documentos[0]!.documento)).toHaveLength(ENTRADAS_POR_FRAGMENTO);
        expect(isines(indice.documentos[2]!.documento)).toHaveLength(1);
        expect(indice.documentos[2]!.documento['shard_id']).toBe('002');

        for (const documento of indice.documentos) {
            expect(validarForma('search-shard.v2.schema.json', documento.documento).ok).toBe(true);
        }
    });

    it('ordena por ISIN, asi que renombrar un fondo no reordena el indice', () => {
        /* El ISIN es lo unico que no cambia nunca. Si el orden fuera por nombre, renombrar un
           fondo reescribiria todos los fragmentos desde el suyo hasta el final, y una pasada
           que no cambia ningun dato tiene que no escribir nada. */
        const antes = componerIndice(
            [
                instrumento('ES0000000001', 'Zeta'),
                instrumento('ES0000000002', 'Alfa'),
                instrumento('ES0000000003', 'Mu')
            ],
            AHORA
        );
        const despues = componerIndice(
            [
                instrumento('ES0000000001', 'Omega'), // renombrado
                instrumento('ES0000000002', 'Alfa'),
                instrumento('ES0000000003', 'Mu')
            ],
            AHORA
        );

        expect(isines(antes.documentos[0]!.documento)).toEqual([
            'ES0000000001',
            'ES0000000002',
            'ES0000000003'
        ]);
        expect(isines(despues.documentos[0]!.documento)).toEqual(isines(antes.documentos[0]!.documento));
    });

    it('el orden no depende del idioma de la maquina', () => {
        /* Con `localeCompare` el orden de digitos frente a letras cambia con la configuracion
           regional, y un indice que se reordena segun donde corra no es un indice. */
        const mezcla = ['ES0000000001', 'US0000000002', 'DE0000000003', 'FR0000000004'];
        const indice = componerIndice(
            mezcla.map((isin) => instrumento(isin, `Nombre ${isin}`)),
            AHORA
        );
        expect(isines(indice.documentos[0]!.documento)).toEqual([...mezcla].sort());
    });

    it('un activo sin nombre no entra, y se dice cual', () => {
        const indice = componerIndice(
            [instrumento('ES0000000001', 'Con nombre'), instrumento('ES0000000002', undefined)],
            AHORA
        );
        expect(indice.entradas).toBe(1);
        expect(indice.sinNombre).toEqual(['ES0000000002']);
        expect(isines(indice.documentos[0]!.documento)).toEqual(['ES0000000001']);
    });

    it('respeta el `name_folded` de la raiz y cuenta los que tiene que plegar', () => {
        const conPlegado = instrumento('ES0000000001', 'Santander Acciones Españolas');
        const sinPlegado = instrumento('ES0000000002', 'Bestinver Internacional');
        delete (sinPlegado.raiz['identity'] as Record<string, unknown>)['name_folded'];

        const indice = componerIndice([conPlegado, sinPlegado], AHORA);
        const entradas = indice.documentos[0]!.documento['entries'] as Record<string, string>[];

        expect(indice.plegadosAlVuelo).toBe(1);
        expect(entradas[0]!['name_folded']).toBe('santander acciones españolas');
        expect(entradas[1]!['name_folded']).toBe('bestinver internacional');
        /* El nombre se guarda tal cual lo escribio la fuente, no plegado: el plegado es para
           buscar y el nombre es para leerlo. */
        expect(entradas[0]!['name']).toBe('Santander Acciones Españolas');
    });

    it('el ticker va si existe y no se inventa si no', () => {
        const accion = instrumento('ES0105836003', 'Una accion', {
            instrument_type: 'STOCK',
            identifiers: { ticker: 'ACC.MC' }
        });
        const fondo = instrumento('ES0000000002', 'Un fondo');
        const entradas = componerIndice([accion, fondo], AHORA).documentos[0]!.documento['entries'] as Record<
            string,
            string
        >[];
        const porIsin = new Map(entradas.map((e) => [e['instrument_id'], e]));

        expect(porIsin.get('ES0105836003')!['ticker']).toBe('ACC.MC');
        expect(porIsin.get('ES0000000002')).not.toHaveProperty('ticker');
        expect(porIsin.get('ES0105836003')!['instrument_type']).toBe('STOCK');
    });

    it('sin instrumentos no escribe un fragmento vacio', () => {
        /* Un fragmento con cero entradas pasaria el contrato y seria una mentira comoda: la
           pantalla leeria un indice que existe y esta vacio en vez de no encontrar indice. */
        const indice = componerIndice([], AHORA);
        expect(indice.documentos).toHaveLength(0);
        expect(indice.rutas).toHaveLength(0);
    });

    it('la ruta de un fragmento se construye en un solo sitio', () => {
        expect(rutaDeFragmento(0)).toBe('search_shards/000');
        expect(rutaDeFragmento(12)).toBe('search_shards/012');
    });
});
