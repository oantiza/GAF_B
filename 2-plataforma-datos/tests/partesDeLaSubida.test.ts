import { describe, it, expect } from 'vitest';

import { raicesDelDueno } from '../src/config/baseNueva/esquemas';
import { ejecutarBorrados, type BaseDeBorrados, type BorradoAprobado, type DecisionDeBorrado } from '../src/ingestion/baseNueva/borradosAprobados';
import {
    claseDeLaColeccion,
    compararConLaNube,
    entraEnLaParte,
    PARTES_QUE_NO_PISAN,
    type BaseQueRelee
} from '../src/ingestion/baseNueva/partesDeLaSubida';

/**
 * Tres hallazgos de la auditoría del 16-11-2026 en la subida a la nube: de quién es cada colección (PLA-4),
 * la comparación de lo subido (PLA-5) y el orden de los borrados (PLA-6). Con bases de mentira: lo que la nube
 * hace de verdad lo dice la propia subida al releer.
 */

describe('PLA-4 · lo que es de la aplicación nunca es catálogo', () => {
    const deLaApp = raicesDelDueno('app');

    it('las raíces de la aplicación salen del dueño que declara su contrato', () => {
        expect([...deLaApp].sort()).toEqual(['clients', 'commercial_retro', 'commercial_retro_imports', 'portfolios']);
    });

    it('`clients` no entra en la parte que se sube sin el piso, y solo sube con «todo»', () => {
        expect(claseDeLaColeccion('clients', deLaApp)).toBe('de-la-app');
        for (const parte of PARTES_QUE_NO_PISAN) expect(entraEnLaParte(parte, 'clients', deLaApp)).toBe(false);
        expect(entraEnLaParte('carteras', 'clients', deLaApp)).toBe(false);
        expect(entraEnLaParte('retrocesiones', 'clients', deLaApp)).toBe(false);
        expect(entraEnLaParte('todo', 'clients', deLaApp)).toBe(true);
    });

    it('lo demás queda donde estaba: catálogo, planes, carteras y retrocesiones', () => {
        const clases = Object.fromEntries(
            ['instruments', 'issuers', 'search_shards', 'fx_rates', 'reference_rates', 'quality_rollup', 'instrument_aliases', 'instrument_issuer',
                'custodian_dictionaries', 'pension_plans', 'portfolios', 'commercial_retro', 'commercial_retro_imports']
                .map((raiz) => [raiz, claseDeLaColeccion(raiz, deLaApp)])
        );
        expect(clases).toEqual({
            instruments: 'catalogo', issuers: 'catalogo', search_shards: 'catalogo', fx_rates: 'catalogo', reference_rates: 'catalogo',
            quality_rollup: 'catalogo',
            /* De `human`: se curan en ficheros del repositorio y las escribe la plataforma. Siguen en el catálogo. */
            instrument_aliases: 'catalogo', instrument_issuer: 'catalogo', custodian_dictionaries: 'catalogo',
            pension_plans: 'planes', portfolios: 'carteras', commercial_retro: 'retrocesiones', commercial_retro_imports: 'retrocesiones'
        });
        expect(entraEnLaParte('catalogo', 'instruments', deLaApp)).toBe(true);
        expect(entraEnLaParte('catalogo', 'pension_plans', deLaApp)).toBe(false);
        expect(entraEnLaParte('planes', 'pension_plans', deLaApp)).toBe(true);
    });

    it('una colección de la aplicación que se declare mañana tampoco será catálogo', () => {
        const conUnaNueva = new Set([...deLaApp, 'notas_del_asesor']);
        expect(entraEnLaParte('catalogo', 'notas_del_asesor', conUnaNueva)).toBe(false);
        expect(entraEnLaParte('catalogo', 'una_del_catalogo', conUnaNueva)).toBe(true);
    });
});

describe('PLA-5 · se compara todo lo subido, y por su contenido', () => {
    function nubeDeMentira(guardado: Record<string, unknown>) {
        const tandas: number[] = [];
        const base: BaseQueRelee<string> = {
            doc: (ruta) => ruta,
            getAll: async (...rutas) => {
                tandas.push(rutas.length);
                return rutas.map((ruta) => ({ exists: ruta in guardado, data: () => guardado[ruta] }));
            }
        };
        return { base, tandas };
    }
    const subidos = Array.from({ length: 10 }, (_, i) => ({ ruta: `instruments/X${i}`, datos: { a: 1, b: { c: [1, 2], d: 'x' }, n: i } }));

    it('con todo igual no hay diferencias, aunque las claves vuelvan en otro orden', async () => {
        const guardado = Object.fromEntries(subidos.map((d) => [d.ruta, { n: d.datos.n, b: { d: 'x', c: [1, 2] }, a: 1 }]));
        const { base, tandas } = nubeDeMentira(guardado);
        expect(await compararConLaNube(base, subidos, 4)).toEqual({ comprobados: 10, ausentes: [], distintos: [] });
        expect(tandas).toEqual([4, 4, 2]);              // todos, por tandas
    });

    it('nombra el que falta y el que ha quedado distinto, estén donde estén', async () => {
        const guardado: Record<string, unknown> = Object.fromEntries(subidos.map((d) => [d.ruta, d.datos]));
        /* Ninguno de los dos cae en «uno de cada siete» (posiciones 0 y 7): la muestra de antes no los veía. */
        delete guardado['instruments/X3'];
        guardado['instruments/X5'] = { a: 1, b: { c: [2, 1], d: 'x' }, n: 5 };       // el orden de una lista sí es contenido
        const { base } = nubeDeMentira(guardado);
        expect(await compararConLaNube(base, subidos, 4)).toEqual({ comprobados: 10, ausentes: ['instruments/X3'], distintos: ['instruments/X5'] });
    });

    it('si la relectura devuelve menos documentos de los pedidos, no lo da por bueno', async () => {
        const base: BaseQueRelee<string> = { doc: (ruta) => ruta, getAll: async () => [] };
        await expect(compararConLaNube(base, subidos, 4)).rejects.toThrow('la relectura devolvio 0 documentos de 4 pedidos');
    });
});

describe('PLA-6 · los borrados van de las hojas a la raíz', () => {
    const RAIZ = 'instruments/XX0000000001';
    const rutas = [RAIZ, `${RAIZ}/declared/costs`, `${RAIZ}/read/card`, `${RAIZ}/price_series/2024`, 'issuers/ISS_999999'];
    const aprobados: BorradoAprobado[] = rutas.map((ruta) => ({ ruta, decision: 'de prueba', fecha: '2026-11-16', motivo: 'de prueba' }));
    const plan = rutas.map((ruta) => ({ ruta, destino: 'SE_BORRA' }) as unknown as DecisionDeBorrado);

    function baseDeMentira(falla?: string) {
        const guardado = new Set(rutas);
        const orden: string[] = [];
        const base = {
            doc: (ruta: string) => ({
                delete: async () => {
                    if (ruta === falla) throw new Error('corte a medias');
                    orden.push(ruta);
                    guardado.delete(ruta);
                },
                get: async () => ({ exists: guardado.has(ruta) })
            })
        } as unknown as BaseDeBorrados;
        return { base, orden, guardado };
    }

    it('la raíz del instrumento es lo último que se borra, aunque la lista la ponga la primera', async () => {
        const { base, orden } = baseDeMentira();
        const resultado = await ejecutarBorrados(base, plan, true, aprobados);
        expect(orden).toEqual([`${RAIZ}/declared/costs`, `${RAIZ}/read/card`, `${RAIZ}/price_series/2024`, RAIZ, 'issuers/ISS_999999']);
        expect(resultado.siguen).toEqual([]);
        expect([...resultado.borrados].sort()).toEqual([...rutas].sort());
    });

    it('un corte a medias deja la raíz en pie: no quedan bloques colgando de una raíz que ya no existe', async () => {
        const { base, guardado } = baseDeMentira(`${RAIZ}/price_series/2024`);
        await expect(ejecutarBorrados(base, plan, true, aprobados)).rejects.toThrow('corte a medias');
        expect(guardado.has(RAIZ)).toBe(true);
        expect(guardado.has(`${RAIZ}/price_series/2024`)).toBe(true);
        expect(guardado.has(`${RAIZ}/declared/costs`)).toBe(false);
    });
});
