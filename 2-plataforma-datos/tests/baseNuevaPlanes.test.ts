import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
    COLECCION_PLANES,
    TIPO_PLAN,
    TIPO_SERIE_DEL_PLAN,
    fraccion,
    mapearPlan,
    mapearPlanes,
    rutaDeLaSerie,
    rutaDelPlan,
    type FicheroDePlanes,
    type PlanDelExtractor
} from '../src/ingestion/baseNueva/planes';
import { coleccionesRaizDeclaradas, raicesDelDueno, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';
import { entraEnLaParte, PARTES_QUE_NO_PISAN } from '../src/ingestion/baseNueva/partesDeLaSubida';
import { validarEscritura } from '../src/config/baseNueva/validadores';

/**
 * El catalogo de planes de pensiones y EPSV (decision D-11, Oscar, 13-11-2026).
 *
 * Lo que tiene que ser verdad aqui: cada producto dice si es plan o EPSV y sin eso no se escribe;
 * las cifras son las del proveedor con la escala de la base (3,03 -> 0,0303) y nada mas; lo que el
 * proveedor no da no aparece; y lo que sale lo aceptan las dos puertas, forma y dueno. La decision
 * de que es cada producto la toma el extractor (`1-extractor/tests/test_planes.py`).
 *
 * Las cifras del plan de ejemplo son las de March Moderado EPSV el 13-11-2026, tal como las dio el
 * buscador, para que la conversion se compruebe contra un caso real y no contra uno comodo.
 */

const CONSULTADO = '2026-11-13T08:15:05+00:00';

const EPSV: PlanDelExtractor = {
    id: 'F00000Q2PL',
    nombre: 'March Moderado EPSV',
    nombre_legal: 'March Moderado EPSV',
    tipo: 'EPSV',
    gestora: 'March Gestión de Pensiones EGFP',
    categoria: 'Mixtos Euros Defensivos PP',
    estrellas: 3,
    estrellas_fecha: '2026-10-31',
    divisa: 'EUR',
    fecha_inicio: '2013-06-10',
    patrimonio: 14480813,
    inversion_minima: 0,
    valor_participacion: { valor: 12.81215, fecha: '2026-11-10' },
    rentabilidad: { m1: -0.09, m6: 1.77, ytd: 2.99, a1: 3.03, a3: 4.04, a5: 1.48, a10: 1.54 },
    rentabilidad_fecha: '2026-11-10',
    volatilidad: { a1: 3.1562, a3: 2.92779 },
    ratios: { sharpe_a3: 0.48996, alfa_a3: -0.36, beta_a3: 0.62, r2_a3: 77.77, informacion_a3: -0.7 },
    comisiones: { gestion: 1.5 },
    serie_mensual: [
        ['2026-09-30', 12.75],
        ['2026-10-30', 12.82],
        ['2026-11-10', 12.812]
    ],
    serie: { desde: '2013-06-19', hasta: '2026-11-10', puntos_diarios: 3429 }
};

const PLAN: PlanDelExtractor = {
    id: 'F0GBR052AF',
    nombre: 'Mundiplan Audaz Global PP',
    tipo: 'PLAN_DE_PENSIONES',
    codigo_dgsfp: 'N1981',
    gestora: 'AXA Pensiones EGFP',
    divisa: 'EUR',
    rentabilidad: { a1: 11.4 }
};

function fichero(planes: PlanDelExtractor[]): FicheroDePlanes {
    return { schema_version: 'fondosdb.planes.v1', generado: '2026-11-13', fuente: { nombre: 'Morningstar', consultado: CONSULTADO }, planes };
}

describe('planes de pensiones y EPSV: del fichero del extractor a la base', () => {
    it('la escala es la unica conversion: tanto por ciento a fraccion, sin ruido', () => {
        expect(fraccion(3.03)).toBe(0.0303);
        expect(fraccion(-0.09)).toBe(-0.0009);
        expect(fraccion(2.92779)).toBe(0.0292779);
        expect(fraccion(0)).toBe(0);
        expect(fraccion(100)).toBe(1);
    });

    it('una EPSV sale con su ficha y su serie, y las dos pasan las puertas', () => {
        const { documentos, error, apartadas } = mapearPlan(EPSV, CONSULTADO);
        expect(error).toBeUndefined();
        expect(apartadas).toEqual([]);
        expect(documentos.map((d) => d.ruta)).toEqual([rutaDelPlan('F00000Q2PL'), rutaDeLaSerie('F00000Q2PL')]);
        for (const d of documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, 'platform');
            expect(veredicto.motivos, d.ruta).toEqual([]);
        }

        const ficha = documentos[0]!.documento;
        expect(ficha).toEqual({
            plan_id: 'F00000Q2PL',
            schema_version: 'base-nueva.pension-plan.v2',
            updated_at: CONSULTADO,
            source: 'MORNINGSTAR',
            checked_at: '2026-11-13',
            product_type: 'EPSV',
            identity: {
                name: 'March Moderado EPSV',
                legal_name: 'March Moderado EPSV',
                manager_name: 'March Gestión de Pensiones EGFP',
                currency: 'EUR'
            },
            return_basis: 'TOTAL_RETURN',
            provider_category: 'Mixtos Euros Defensivos PP',
            star_rating: 3,
            star_rating_as_of: '2026-10-31',
            inception_date: '2013-06-10',
            aum: 14480813,
            minimum_investment: 0,
            nav: { value: 12.81215, date: '2026-11-10' },
            trailing_return: { '1m': -0.0009, '6m': 0.0177, '1y': 0.0303, '3y': 0.0404, '5y': 0.0148, '10y': 0.0154 },
            ytd_return: 0.0299,
            returns_as_of: '2026-11-10',
            volatility: { '1y': 0.031562, '3y': 0.0292779 },
            sharpe: { '3y': 0.48996 },
            provider_alpha: { '3y': -0.0036 },
            beta: { '3y': 0.62 },
            r2: { '3y': 0.7777 },
            information_ratio: { '3y': -0.7 },
            management_fee: 0.015,
            series: { first_date: '2026-09-30', last_date: '2026-11-10', daily_observations: 3429, monthly_points: 3 }
        });

        const serie = documentos[1]!.documento;
        expect(documentos[1]!.tipo).toBe(TIPO_SERIE_DEL_PLAN);
        expect(serie['points']).toEqual([
            { date: '2026-09-30', value: 12.75 },
            { date: '2026-10-30', value: 12.82 },
            { date: '2026-11-10', value: 12.812 }
        ]);
        expect(serie['observations']).toBe(3);
        expect(serie['frequency']).toBe('MONTH_END');
    });

    it('un plan de pensiones lleva su codigo de la DGSFP, y lo que el proveedor no da no aparece', () => {
        const { documentos, error } = mapearPlan(PLAN, CONSULTADO);
        expect(error).toBeUndefined();
        expect(documentos).toHaveLength(1);
        const ficha = documentos[0]!.documento;
        expect(documentos[0]!.tipo).toBe(TIPO_PLAN);
        expect(ficha['product_type']).toBe('PENSION_PLAN');
        expect(ficha['dgsfp_code']).toBe('N1981');
        expect(ficha['trailing_return']).toEqual({ '1y': 0.114 });
        for (const ausente of ['star_rating', 'nav', 'volatility', 'sharpe', 'management_fee', 'series', 'ytd_return', 'modality', 'returns_as_of']) {
            expect(ficha, ausente).not.toHaveProperty(ausente);
        }
        expect(JSON.stringify(ficha)).not.toContain('null');
        expect(validarEscritura(TIPO_PLAN, ficha, 'platform').motivos).toEqual([]);
    });

    it('un plan de empleo simplificado sigue siendo un plan de pensiones, y lo dice', () => {
        const { documentos } = mapearPlan({ ...PLAN, nombre: 'Renta 4 Autónomos RV PPES', empleo_simplificado: true }, CONSULTADO);
        expect(documentos[0]!.documento['product_type']).toBe('PENSION_PLAN');
        expect(documentos[0]!.documento['modality']).toBe('SIMPLIFIED_EMPLOYMENT');
    });

    it('sin saber si es plan o EPSV no se escribe', () => {
        expect(mapearPlan({ ...PLAN, tipo: 'OTRO' }, CONSULTADO).error).toContain('tipo desconocido');
        expect(mapearPlan({ ...PLAN, codigo_dgsfp: undefined }, CONSULTADO).error).toContain('sin codigo de la DGSFP');
        expect(mapearPlan({ ...EPSV, codigo_dgsfp: 'N1234' }, CONSULTADO).error).toContain('EPSV con codigo');
        expect(mapearPlan({ ...PLAN, id: 'corto' }, CONSULTADO).error).toContain('identificador');
        expect(mapearPlan({ ...PLAN, tipo: 'OTRO' }, CONSULTADO).documentos).toEqual([]);
    });

    it('una cifra que el contrato rechaza no se emite y se cuenta, sin tumbar el producto', () => {
        /* 950 es un 950 %: casi seguro un error de escala del proveedor. */
        const { documentos, apartadas, error } = mapearPlan(
            { ...EPSV, rentabilidad: { a1: 950, a3: 4.04 }, comisiones: { gestion: 150 } },
            CONSULTADO
        );
        expect(error).toBeUndefined();
        expect(apartadas.map((a) => a.ruta).sort()).toEqual(['management_fee', 'trailing_return.1y']);
        const ficha = documentos[0]!.documento;
        expect(ficha['trailing_return']).toEqual({ '3y': 0.0404 });
        expect(ficha).not.toHaveProperty('management_fee');
        expect(validarEscritura(TIPO_PLAN, ficha, 'platform').motivos).toEqual([]);
    });

    it('un cero del proveedor es un cero, no una ausencia', () => {
        const { documentos } = mapearPlan({ ...PLAN, rentabilidad: { m1: 0, ytd: 0 }, inversion_minima: 0 }, CONSULTADO);
        const ficha = documentos[0]!.documento;
        expect(ficha['trailing_return']).toEqual({ '1m': 0 });
        expect(ficha['ytd_return']).toBe(0);
        expect(ficha['minimum_investment']).toBe(0);
    });

    it('la fecha de las rentabilidades solo va si hay rentabilidades, y la de las estrellas, si hay estrellas', () => {
        const sinCifras = mapearPlan({ ...EPSV, rentabilidad: undefined, estrellas: undefined }, CONSULTADO).documentos[0]!.documento;
        expect(sinCifras).not.toHaveProperty('returns_as_of');
        expect(sinCifras).not.toHaveProperty('star_rating_as_of');
    });

    it('el fichero entero: cuentas, rutas posibles y errores nombrados', () => {
        const salida = mapearPlanes(fichero([EPSV, PLAN, { ...PLAN, id: 'F0GBR0XXXX', tipo: 'OTRO' }, EPSV]));
        expect(salida.cuentas).toEqual({ planes: 2, planes_de_pensiones: 1, epsv: 1, con_serie: 1 });
        expect(salida.documentos).toHaveLength(3);
        expect(salida.errores).toHaveLength(2);
        expect(salida.errores.join(' ')).toContain('repetido');
        expect(salida.rutasPosibles).toEqual([
            'pension_plans/F00000Q2PL',
            'pension_plans/F00000Q2PL/series/monthly',
            'pension_plans/F0GBR052AF',
            'pension_plans/F0GBR052AF/series/monthly'
        ]);
    });

    it('un fichero de otro esquema no se interpreta', () => {
        expect(() => mapearPlanes({ ...fichero([EPSV]), schema_version: 'fondosdb.planes.v2' })).toThrow(/se esperaba/);
        expect(() => mapearPlanes({ schema_version: 'fondosdb.planes.v1', planes: [EPSV] })).toThrow(/cuando se consulto/);
    });
});

describe('planes de pensiones y EPSV: un catalogo aparte', () => {
    it('es una coleccion raiz propia, con su serie colgando, y no cuelga de instruments', () => {
        expect(coleccionesRaizDeclaradas().get(COLECCION_PLANES)).toBe(TIPO_PLAN);
        expect(subcoleccionesDeclaradas().get('pension_plans/*/series/monthly')).toBe(TIPO_SERIE_DEL_PLAN);
        expect(rutaDelPlan('F00000Q2PL').startsWith('instruments')).toBe(false);
    });

    it('en la subida a la nube es una parte propia: el catalogo de instrumentos no lo arrastra', () => {
        /* Un refresco de instrumentos (`--parte catalogo`) no debe llevarse los planes, que son de otro
           origen y se refrescan por su propia decision; y `--parte planes` no pisa nada de la aplicacion. */
        /* Desde el 16-11-2026 (PLA-4) la regla vive en `partesDeLaSubida.ts` y se prueba ejecutándola, no leyendo el fuente. */
        const deLaApp = raicesDelDueno('app');
        expect(entraEnLaParte('planes', COLECCION_PLANES, deLaApp)).toBe(true);
        expect(entraEnLaParte('catalogo', COLECCION_PLANES, deLaApp)).toBe(false);
        expect(entraEnLaParte('planes', 'instruments', deLaApp)).toBe(false);
        expect(PARTES_QUE_NO_PISAN).toEqual(['catalogo', 'planes']);
        /* Y el guion usa esa regla, no una suya. */
        const subida = readFileSync(join(__dirname, '..', 'scripts', 'subirALaNube.ts'), 'utf-8');
        expect(subida).toContain('entraEnLaParte(parte, raiz, RAICES_DE_LA_APP)');
    });

    it('solo lo escribe la plataforma', () => {
        const { documentos } = mapearPlan(EPSV, CONSULTADO);
        for (const d of documentos) {
            expect(validarEscritura(d.tipo, d.documento, 'app').ok, d.ruta).toBe(false);
            expect(validarEscritura(d.tipo, d.documento, 'batch').ok, d.ruta).toBe(false);
        }
    });

    it('una clave que el contrato no declara no entra: ni gastos corrientes ni percentil', () => {
        const ficha = mapearPlan(EPSV, CONSULTADO).documentos[0]!.documento;
        expect(validarEscritura(TIPO_PLAN, { ...ficha, ongoing_charge: 0.015 }, 'platform').ok).toBe(false);
        expect(validarEscritura(TIPO_PLAN, { ...ficha, category_rank: 12 }, 'platform').ok).toBe(false);
    });
});
