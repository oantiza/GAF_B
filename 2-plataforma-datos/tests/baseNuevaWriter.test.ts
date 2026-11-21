import { describe, it, expect } from 'vitest';

import {
    PUERTA_DE_ENTORNO,
    PUERTA_DE_ENTORNO_VALOR,
    canonico,
    escribir,
    escrituraAutorizada,
    motivosParaNoEscribir,
    planificar,
    verificar
} from '../src/loader/baseNuevaWriter';
import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';

/**
 * Las cinco barreras del escritor, probadas sin emulador.
 *
 * El emulador no hace falta aquí: lo que estas pruebas comprueban es qué DECIDE el escritor,
 * y eso se prueba con una base de mentira. Lo que sí necesita emulador es que Firestore
 * guarde de verdad lo que se le manda, y eso lo comprueba el postverify de la escritura
 * real, no una prueba.
 */

const ISIN = 'IE00BYR8H148';
const AHORA = '2026-11-01T10:00:00.000Z';

/**
 * Un entorno sin conflictos: la puerta de entorno abierta y el destino puesto al de la base
 * nueva. Desde el 01-11-2026 el destino NO sale del entorno —lo pone el escritor, de la
 * constante—, asi que ponerlo aqui no abre nada: solo deja claro que coincide.
 */
function entornoBueno(): NodeJS.ProcessEnv {
    return {
        [PUERTA_DE_ENTORNO]: PUERTA_DE_ENTORNO_VALOR,
        FIREBASE_PROJECT_ID: PROYECTO_BASE_NUEVA,
        FIRESTORE_EMULATOR_HOST: HOST_EMULADOR_BASE_NUEVA
    } as NodeJS.ProcessEnv;
}

/**
 * Una base de mentira con lo justo que usa el escritor: `doc`, `getAll`, `batch`.
 * Guarda en un mapa, así que el postverify se puede probar de verdad.
 */
function baseDeMentira(inicial: Record<string, Record<string, unknown>> = {}) {
    const guardado = new Map<string, Record<string, unknown>>(Object.entries(inicial));
    const comprometidos: string[] = [];
    const db = {
        doc(ruta: string) {
            return { __ruta: ruta };
        },
        async getAll(...refs: { __ruta: string }[]) {
            return refs.map((ref) => ({
                exists: guardado.has(ref.__ruta),
                data: () => guardado.get(ref.__ruta)
            }));
        },
        batch() {
            const pendientes: [string, Record<string, unknown>][] = [];
            return {
                set(ref: { __ruta: string }, documento: Record<string, unknown>) {
                    pendientes.push([ref.__ruta, documento]);
                },
                async commit() {
                    for (const [ruta, documento] of pendientes) {
                        /* Firestore no promete devolver el mapa en el orden en que se
                           escribió, así que la mentira lo desordena a propósito: si el
                           postverify comparara textos sin ordenar, esta prueba lo cazaría. */
                        const desordenado: Record<string, unknown> = {};
                        for (const clave of Object.keys(documento).sort().reverse()) {
                            desordenado[clave] = documento[clave];
                        }
                        guardado.set(ruta, desordenado);
                        comprometidos.push(ruta);
                    }
                }
            };
        }
    };
    return { db: db as never, guardado, comprometidos };
}

const RAIZ: DocumentoMapeado = {
    ruta: `instruments/${ISIN}`,
    tipo: 'instrument.v2.schema.json',
    documento: {
        instrument_id: ISIN,
        instrument_type: 'FUND',
        schema_version: 'base-nueva.instrument.v2',
        updated_at: AHORA,
        identity: { name: 'Un fondo', name_folded: 'un fondo', currency: 'EUR' },
        classification: { category: 'RV Global', asset_class: 'EQUITY' }
    }
};

const COSTES: DocumentoMapeado = {
    ruta: `instruments/${ISIN}/declared/costs`,
    tipo: 'instrument-declared-costs.v2.schema.json',
    documento: { source: 'canonical:fondosdb', as_of: '2026-09-30', ongoing_charge: 0.0053 }
};

describe('las barreras de entorno y de destino', () => {
    it('la puerta de entorno pide su valor exacto', () => {
        expect(escrituraAutorizada(entornoBueno())).toBe(true);
        expect(escrituraAutorizada({ [PUERTA_DE_ENTORNO]: 'si' } as NodeJS.ProcessEnv)).toBe(false);
        expect(escrituraAutorizada({} as NodeJS.ProcessEnv)).toBe(false);
    });

    it('con las tres abiertas no hay motivos para no escribir', () => {
        expect(motivosParaNoEscribir(entornoBueno())).toEqual([]);
    });

    it('un proyecto distinto del de la base nueva para la escritura, BDB incluido', () => {
        for (const otro of ['bbdd-activos-financieros', 'gestor-activos-local', 'otro-proyecto']) {
            const motivos = motivosParaNoEscribir({
                ...entornoBueno(),
                FIREBASE_PROJECT_ID: otro
            } as NodeJS.ProcessEnv);
            expect(motivos.some((motivo) => motivo.includes('FIREBASE_PROJECT_ID'))).toBe(true);
        }
    });

    it('el proyecto de la base VIEJA tambien se rechaza, y esa es la parte nueva', () => {
        // La forma facil de hacerle sitio a la base nueva era meter su id en la misma
        // allowlist y seguir. Con las dos dentro, un FIREBASE_PROJECT_ID equivocado escribe
        // los documentos de la base nueva en el proyecto de la vieja, la comprobacion lo
        // autoriza, y cada documento es perfectamente valido salvo en que esta en la base
        // que no es. Ninguna auditoria puede verlo.
        const motivos = motivosParaNoEscribir({
            ...entornoBueno(),
            FIREBASE_PROJECT_ID: 'gestor-activos-local'
        } as NodeJS.ProcessEnv);
        expect(motivos.some((motivo) => motivo.includes('bdb-gestor-de-activos'))).toBe(true);
    });

    it('el puerto de la base vieja tambien para la escritura, con el proyecto bueno', () => {
        // El destino son las dos cosas: un project id correcto contra el puerto de la base
        // vieja escribiria en la base equivocada igual de bien.
        const motivos = motivosParaNoEscribir({
            ...entornoBueno(),
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082'
        } as NodeJS.ProcessEnv);
        expect(motivos.some((motivo) => motivo.includes('FIRESTORE_EMULATOR_HOST'))).toBe(true);
    });

    it('sin variables de entorno de destino NO falta nada: el destino no viene del entorno', () => {
        // Antes, un FIRESTORE_EMULATOR_HOST ausente era un motivo para no escribir, porque el
        // SDK habria ido a Firestore de verdad. Ahora lo pone `obtenerDb` de la constante, asi
        // que lo que queda por comprobar es solo el conflicto: que nadie haya pedido otro
        // sitio. Con la puerta de entorno abierta y sin destino en el entorno, no hay motivos.
        const soloLaPuerta = { [PUERTA_DE_ENTORNO]: PUERTA_DE_ENTORNO_VALOR } as NodeJS.ProcessEnv;
        expect(motivosParaNoEscribir(soloLaPuerta)).toEqual([]);
    });

    it('escribir aborta si alguna barrera esta cerrada, aunque el plan sea bueno', async () => {
        const { db } = baseDeMentira();
        const plan = await planificar(db, [RAIZ], 'platform');
        await expect(escribir(db, plan, {} as NodeJS.ProcessEnv)).rejects.toThrow(/escritura bloqueada/);
    });
});

describe('el plan: que se escribe y que no', () => {
    it('lo que no existe se crea; lo que existe y es suyo se reemplaza', async () => {
        const { db } = baseDeMentira({ [`instruments/${ISIN}`]: { ...(RAIZ.documento as object) } });
        const plan = await planificar(db, [RAIZ, COSTES], 'platform');
        expect(plan.bloqueados).toEqual([]);
        const porRuta = new Map(plan.operaciones.map((operacion) => [operacion.ruta, operacion.accion]));
        expect(porRuta.get(`instruments/${ISIN}`)).toBe('reemplazar');
        expect(porRuta.get(`instruments/${ISIN}/declared/costs`)).toBe('crear');
    });

    it('CONSERVA las claves que no son del escritor: una retrocesion no se borra', async () => {
        const decision = {
            ongoing_charge: {
                value: 0.0057,
                decided_by: 'alguien',
                decided_at: AHORA,
                reason: 'retrocesion acordada'
            }
        };
        const { db } = baseDeMentira({
            [`instruments/${ISIN}/declared/costs`]: {
                source: 'viejo',
                as_of: '2026-06-30',
                ongoing_charge: 0.0061,
                _overrides: decision
            }
        });
        const plan = await planificar(db, [COSTES], 'platform');
        expect(plan.bloqueados).toEqual([]);
        const operacion = plan.operaciones[0]!;
        expect(operacion.conservadas).toEqual(['_overrides']);
        // El coste de la plataforma se reemplaza...
        expect((operacion.documento as Record<string, unknown>)['ongoing_charge']).toBeCloseTo(0.0053, 10);
        // ...y la decision humana sigue ahi, intacta.
        expect((operacion.documento as Record<string, unknown>)['_overrides']).toEqual(decision);
    });

    it('una clave guardada que el contrato NO declara bloquea el documento, no se borra', async () => {
        const { db } = baseDeMentira({
            [`instruments/${ISIN}/declared/costs`]: {
                source: 'viejo',
                as_of: '2026-06-30',
                ongoing_charge: 0.0061,
                ter_pct_heredado: 0.61
            }
        });
        const plan = await planificar(db, [COSTES], 'platform');
        expect(plan.operaciones).toEqual([]);
        expect(plan.bloqueados).toHaveLength(1);
        expect(plan.bloqueados[0]!.motivos[0]).toContain('ter_pct_heredado');
    });

    it('nombra los SOBRANTES de una pasada anterior, y no los borra', async () => {
        // Un bloque que antes se escribia y esta pasada ya no produce se queda en la base.
        // El escritor no borra nada, asi que lo unico correcto es nombrarlo: un bloque que
        // se queda atras parece vigente y no lo es.
        const { db, guardado } = baseDeMentira({
            [`instruments/${ISIN}/declared/exposure`]: { source: 'viejo', as_of: '2026-06-30' }
        });
        const posibles = [
            `instruments/${ISIN}`,
            `instruments/${ISIN}/declared/costs`,
            `instruments/${ISIN}/declared/exposure`
        ];
        const plan = await planificar(db, [RAIZ, COSTES], 'platform', posibles);
        expect(plan.sobrantes).toEqual([`instruments/${ISIN}/declared/exposure`]);
        await escribir(db, plan, entornoBueno());
        // Sigue ahi: no se ha borrado.
        expect(guardado.has(`instruments/${ISIN}/declared/exposure`)).toBe(true);
    });

    it('una clave RETIRADA a proposito si se borra, porque el contrato la nombra', async () => {
        // Es la unica puerta de salida de la regla anterior, y tiene que existir: el 01-11 se
        // retiro coverage_status de quality/latest y el escritor se nego a tocar los 769
        // documentos ya escritos, con razon. Nombrar la clave en x-obsolete-root-keys es la
        // forma de decir "esto sobra" en vez de "no se que es esto".
        const CALIDAD = `instruments/${ISIN}/quality/latest`;
        const nueva = {
            computed_at: AHORA,
            fitness: {
                COMPARAR_COSTE: { apt: true },
                RADIOGRAFIA_DE_CARTERA: { apt: true },
                COMPARAR_RENTABILIDAD: { apt: false },
                MOSTRAR_ALPHA: { apt: false },
                METRICAS_PROPIAS: { apt: false },
                COMPARAR_CON_SU_GRUPO: { apt: true }
            },
            coverage: 0.6,
            absences: []
        };
        const { db, guardado } = baseDeMentira({
            [CALIDAD]: { computed_at: '2026-10-31T00:00:00.000Z', coverage_status: 'PARTIAL', coverage: 0.5, absences: [] }
        });
        const plan = await planificar(
            db,
            [{ ruta: CALIDAD, tipo: 'instrument-quality.v2.schema.json', documento: nueva }],
            'batch'
        );
        expect(plan.bloqueados).toEqual([]);
        expect(plan.operaciones).toHaveLength(1);
        await escribir(db, plan, entornoBueno());
        // El campo retirado ya no esta, y el nuevo si.
        const escrito = guardado.get(CALIDAD)!;
        expect(escrito['coverage_status']).toBeUndefined();
        expect(escrito['fitness']).toBeDefined();
    });

    it('un documento que no pasa la forma no entra en el plan', async () => {
        const { db } = baseDeMentira();
        const roto: DocumentoMapeado = {
            ...COSTES,
            documento: { ...(COSTES.documento as object), volatilidad_3a: 0.12 }
        };
        const plan = await planificar(db, [roto], 'platform');
        expect(plan.operaciones).toEqual([]);
        expect(plan.bloqueados).toHaveLength(1);
    });

    it('un documento que no es del escritor no entra en el plan', async () => {
        const { db } = baseDeMentira();
        const delLote: DocumentoMapeado = {
            ruta: `instruments/${ISIN}/computed/metrics`,
            tipo: 'instrument-computed-metrics.v2.schema.json',
            documento: {
                computed_at: AHORA,
                method: 'GEOMETRIC_CAGR',
                frequency: 'DAILY',
                return_basis: 'TOTAL_RETURN',
                inputs: { series_id: 's1', currency: 'EUR', risk_free_source: 'ESTR' }
            }
        };
        const plan = await planificar(db, [delLote], 'platform');
        expect(plan.operaciones).toEqual([]);
        expect(plan.bloqueados[0]!.motivos.join(' ')).toContain('platform');
    });
});

describe('escribir y volver a leer', () => {
    it('escribe en lotes y el postverify no encuentra diferencias', async () => {
        const { db, guardado, comprometidos } = baseDeMentira();
        const plan = await planificar(db, [RAIZ, COSTES], 'platform');
        const resumen = await escribir(db, plan, entornoBueno());
        expect(resumen.creados).toBe(2);
        expect(resumen.reemplazados).toBe(0);
        expect(resumen.lotes).toBe(1);
        expect(comprometidos).toHaveLength(2);
        expect(guardado.size).toBe(2);

        const resultado = await verificar(db, plan, 'platform');
        expect(resultado.comprobados).toBe(2);
        expect(resultado.ausentes).toEqual([]);
        expect(resultado.distintos).toEqual([]);
        expect(resultado.invalidos).toEqual([]);
    });

    it('el postverify CAZA lo que no se guardo', async () => {
        const { db, guardado } = baseDeMentira();
        const plan = await planificar(db, [RAIZ, COSTES], 'platform');
        await escribir(db, plan, entornoBueno());
        guardado.delete(`instruments/${ISIN}/declared/costs`);
        const resultado = await verificar(db, plan, 'platform');
        expect(resultado.ausentes).toEqual([`instruments/${ISIN}/declared/costs`]);
    });

    it('el postverify CAZA lo que se guardo distinto', async () => {
        const { db, guardado } = baseDeMentira();
        const plan = await planificar(db, [COSTES], 'platform');
        await escribir(db, plan, entornoBueno());
        guardado.set(`instruments/${ISIN}/declared/costs`, {
            source: 'canonical:fondosdb',
            as_of: '2026-09-30',
            ongoing_charge: 0.0099
        });
        const resultado = await verificar(db, plan, 'platform');
        expect(resultado.distintos).toEqual([`instruments/${ISIN}/declared/costs`]);
    });

    it('la comparacion ordena las claves: un mapa reordenado NO es una diferencia', () => {
        expect(canonico({ b: 1, a: { d: 2, c: 3 } })).toBe(canonico({ a: { c: 3, d: 2 }, b: 1 }));
        expect(canonico({ a: [1, 2] })).not.toBe(canonico({ a: [2, 1] }));
    });
});

describe('el dueno del dato llega hasta la verificacion', () => {
    /**
     * `computed/metrics` lo calcula un lote dentro del extractor, asi que viaja con
     * `comoDueno: 'batch'` aunque lo transporte la plataforma. Eso hay que respetarlo en
     * TRES sitios: el plan, la escritura y la verificacion.
     *
     * El 01-11-2026 arregle los dos primeros y me deje el tercero. La escritura salio
     * perfecta —10.036 documentos, 0 ausentes, 0 distintos— y la verificacion declaro 642
     * "invalidos", todos los `computed/metrics`, con el motivo "es de batch y escribe
     * platform". Era ella aplicando el dueno de la pasada.
     *
     * Una verificacion que grita en falso es peor que ninguna, porque la siguiente vez
     * nadie la lee. Esta prueba existe para que no vuelva.
     */
    const METRICAS: DocumentoMapeado = {
        ruta: `instruments/${ISIN}/computed/metrics`,
        tipo: 'instrument-computed-metrics.v2.schema.json',
        comoDueno: 'batch',
        documento: {
            computed_at: '2026-10-29',
            method: 'EXTRACTOR_MONTHLY_V2',
            frequency: 'MONTHLY',
            return_basis: 'TOTAL_RETURN',
            inputs: {
                series_id: 'EODHD:X.EUFUND',
                currency: 'EUR',
                distribution_policy_resolution: 'PROVIDER_NO_RECORDS'
            },
            volatility: { '3y': 0.1143 }
        }
    };

    it('el plan lleva el dueno del documento hasta la operacion', async () => {
        const { db } = baseDeMentira();
        const plan = await planificar(db, [METRICAS], 'platform');
        expect(plan.bloqueados).toEqual([]);
        expect(plan.operaciones).toHaveLength(1);
        expect(plan.operaciones[0]!.comoDueno).toBe('batch');
    });

    it('la verificacion lo da por bueno, aunque la pasada sea de platform', async () => {
        const { db } = baseDeMentira();
        const plan = await planificar(db, [METRICAS], 'platform');
        await escribir(db, plan, entornoBueno());
        const v = await verificar(db, plan, 'platform');
        expect(v.ausentes).toEqual([]);
        expect(v.distintos).toEqual([]);
        expect(v.invalidos).toEqual([]);
    });

    it('un documento SIN dueno propio sigue verificandose con el de la pasada', async () => {
        // La regla general no cambia: solo los que declaran dueno lo usan.
        const { db } = baseDeMentira();
        const plan = await planificar(db, [COSTES], 'platform');
        expect(plan.operaciones[0]!.comoDueno).toBeUndefined();
        await escribir(db, plan, entornoBueno());
        expect((await verificar(db, plan, 'platform')).invalidos).toEqual([]);
        // Y con el dueno equivocado SI tiene que quejarse, o no estaria comprobando nada.
        expect((await verificar(db, plan, 'app')).invalidos.length).toBe(1);
    });
});
