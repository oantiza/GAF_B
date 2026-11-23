import { describe, it, expect } from 'vitest';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { rangoDe, validarEscritura } from '../src/config/baseNueva/validadores';

/**
 * Los mapas de la renta fija, netos como los da el proveedor (decisión C-31 de Óscar, 21-11-2026): la regla del reparto
 * por clase de la C-29 llevada a `bond_types`, `duration_buckets` y `credit_buckets`.
 *
 * Un mapa con una parte fuera de 0-1 se escribe tal cual, con su signo, si sus partes caben en los topes del contrato (de -5
 * a 6) y suman 1 con un punto de tolerancia. Si no, la regla de antes: se saltan las partes fuera de 0-1. Los mapas son los
 * del canónico del 17-11-2026, y lo esperado se escribe a mano desde la regla, no desde la salida del mapper.
 */

const AHORA = '2026-11-21T10:00:00.000Z';
const ISIN = 'ES0126547035';
const TIPO = 'instrument-declared-exposure.v2.schema.json';

/** Un fondo de renta fija con el reparto cerrado, para que los tres mapas apliquen (C-27). */
const REPARTO = { equity: 0, bond: 0.9, cash: 0.1, other: 0 };

function ficha(mapas: Record<string, unknown>): FichaCanonica {
    return {
        isin: ISIN,
        name: 'Un Fondo de Renta Fija',
        currency: 'EUR',
        report_date: '2026-09-30',
        generated_at: '2026-10-31T13:32:32+00:00',
        regulatory: { domicile: 'ESP' },
        ms: { report_date: '2026-09-30', portfolio: { as_of: '2026-09-30' }, costs: { ter: 0.5 }, fixed_income: {} },
        classification_v2: { asset_type: 'fixed_income' },
        portfolio_exposure_v2: { asset_mix: REPARTO, exposure_confidence: 0.9, ...mapas },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

function universal(): RegistroUniversal {
    return {
        _id: ISIN,
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Fixed Income', divisa_base: 'EUR', domicilio: 'ESP', nombre: 'Un Fondo de Renta Fija' },
        riesgo: { fecha_dato: '2026-09-30' },
        rentabilidad: { fecha_dato: '2026-09-30' },
        costes: { ter_pct: 0.5 },
        valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'EUR' }
    };
}

function exposicion(mapas: Record<string, unknown>) {
    const resultado = mapearInstrumento(ficha(mapas), universal(), AHORA);
    const bloque = resultado.documentos.find((documento) => documento.ruta.endsWith('/declared/exposure'));
    if (bloque === undefined) throw new Error('sin declared/exposure');
    return { documento: bloque.documento as Record<string, unknown>, bloque, avisos: resultado.avisos };
}

describe('Los mapas de la renta fija, netos (C-31, 21-11-2026)', () => {
    it('los topes los dice el contrato, y son los del reparto por clase: de -5 a 6', () => {
        for (const campo of ['bond_types', 'duration_buckets', 'credit_buckets']) {
            expect(rangoDe(TIPO, `${campo}.*`)).toEqual({ minimum: -5, maximum: 6 });
        }
        expect(rangoDe(TIPO, 'asset_mix.equity')).toEqual({ minimum: -5, maximum: 6 });
        /* Los mapas de la renta variable no cambian: siguen siendo pesos de 0 a 1. */
        expect(rangoDe(TIPO, 'sectors.*')).toEqual({ minimum: 0, maximum: 1 });
    });

    it('UBS Duración 0-2: la liquidez negativa se escribe con su signo, y el mapa suma 1 y no 1,049', () => {
        const neto = { government: 0.095618, corporate: 0.90365, securitized: 0.049477, cash: -0.048737 };
        const { documento, bloque } = exposicion({ bond_types: neto });
        expect(documento['bond_types']).toEqual(neto);
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('FON Fineco Inversión: una parte por encima de 1 compensa las negativas, y entra entera', () => {
        const neto = { government: -0.049955, corporate: -0.000007, securitized: -0.000002, cash: 1.049964 };
        const { documento, bloque } = exposicion({ bond_types: neto });
        /* Con la regla de antes no quedaba ningún peso y el fondo se quedaba sin el mapa. */
        expect(documento['bond_types']).toEqual(neto);
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('la calidad crediticia también: Man Global Investment Grade Opportunities, sin calificar a -11,3 %', () => {
        const neto = { aaa: 0.141808, aa: 0.194057, a: 0.067733, bbb: 0.596755, bb: 0.033122, b: 0.079906, below_b: 0, not_rated: -0.11338 };
        const { documento } = exposicion({ credit: neto });
        expect(documento['credit_buckets']).toEqual(neto);
    });

    it('un mapa neto que no suma 1 sigue con la regla de antes: se saltan las partes fuera de 0-1, y se avisa', () => {
        /* ES0141991002 como llegaba hasta la C-33: gobierno 36,7 %, corporativa 6,0 % y liquidez -134,0 %, que suman -91,3 %,
           porque le faltaban los derivados. Con ellos, abajo. */
        const { documento, avisos } = exposicion({ bond_types: { government: 0.367105, corporate: 0.060236, cash: -1.340189 } });
        expect(documento['bond_types']).toEqual({ government: 0.367105, corporate: 0.060236 });
        expect(avisos.some((aviso) => aviso.startsWith('bond_types neto que no se escribe tal cual (suma -0.91285)'))).toBe(true);
    });

    it('una parte fuera de los topes deja la regla de antes aunque el mapa sume 1', () => {
        /* Allianz Strategy 75 CT EUR: gobierno -414 % y liquidez 850 %, que suman 1. */
        const { documento, avisos } = exposicion({
            bond_types: { government: -4.142687, corporate: -2.876204, securitized: -0.47855, cash: 8.497442 }
        });
        expect(documento).not.toHaveProperty('bond_types');
        expect(avisos.some((aviso) => aviso.includes('cash 8.497442 fuera de los topes'))).toBe(true);
    });

    it('un mapa sin partes fuera de 0-1 no cambia, sume lo que sume', () => {
        const { documento, avisos } = exposicion({ duration: { short: 0.6, long: 0.3 } });
        expect(documento['duration_buckets']).toEqual({ short: 0.6, long: 0.3 });
        expect(avisos.some((aviso) => aviso.includes('neto que no se escribe tal cual'))).toBe(false);
    });

    it('una parte por encima de 1 en un mapa que no suma 1 se salta, como antes', () => {
        const { documento } = exposicion({ duration: { '1_3': 0.4, '3_5': 2.146787 } });
        expect(documento['duration_buckets']).toEqual({ '1_3': 0.4 });
    });

    it('el contrato rechaza una parte fuera de los topes', () => {
        const { bloque } = exposicion({ bond_types: { government: 0.5, cash: 0.5 } });
        const conTope = { ...bloque.documento, bond_types: { government: 7, cash: -6 } };
        expect(validarEscritura(bloque.tipo, conTope, 'platform').ok).toBe(false);
    });
});

/**
 * Los derivados y el municipal del tipo de emisor (decisión C-33 de Óscar, 21-11-2026). Desde ese día el canónico trae las
 * seis partes del proveedor, `municipal` y `derivative` incluidas, y un mapa con la liquidez en negativo suma 1 y se guarda
 * neto con la regla de la C-31. Los mapas son los del canónico que sale de las fichas del 17-11 con el adaptador nuevo; las
 * sumas, a mano en los comentarios.
 */
describe('El tipo de emisor con los derivados y el municipal (C-33, 21-11-2026)', () => {
    it('Gestión Talento: con los derivados la liquidez de -134 % cuadra, y el mapa entra neto', () => {
        /* 0,367105 + 0,060236 - 1,340189 + 1,912847 = 0,999999. */
        const neto = { government: 0.367105, corporate: 0.060236, cash: -1.340189, derivative: 1.912847 };
        const { documento, bloque, avisos } = exposicion({ bond_types: neto });
        expect(documento['bond_types']).toEqual(neto);
        expect(avisos.some((aviso) => aviso.startsWith('bond_types neto'))).toBe(false);
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('Abante Selección: las seis partes, el municipal y los derivados con su nombre', () => {
        /* 0,420698 + 0,000013 + 0,478256 + 0,196899 - 0,091183 - 0,004682 = 1,000001. */
        const neto = { government: 0.420698, municipal: 0.000013, corporate: 0.478256, securitized: 0.196899, cash: -0.091183, derivative: -0.004682 };
        const { documento, bloque } = exposicion({ bond_types: neto });
        expect(documento['bond_types']).toEqual(neto);
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('Nordea 1 Stable Return: suma 1 con los derivados, pero la liquidez a -558 % se sale de los topes y sigue la regla de antes', () => {
        /* 1,187581 + 0,000012 - 5,578048 + 5,390454 = 0,999999; de lo que queda entre 0 y 1, solo la corporativa. */
        const { documento, avisos } = exposicion({
            bond_types: { government: 1.187581, corporate: 0.000012, cash: -5.578048, derivative: 5.390454 }
        });
        expect(documento['bond_types']).toEqual({ corporate: 0.000012 });
        expect(avisos.some((aviso) => aviso.includes('cash -5.578048 fuera de los topes'))).toBe(true);
    });
});
