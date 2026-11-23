import { describe, it, expect } from 'vitest';

import { calcularCalidad, camposPresentesDondeNoAplica, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import {
    mapearInstrumento,
    pesoDeRentaFijaDeSusMapas,
    PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA,
    UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS,
    type FichaCanonica,
    type RegistroUniversal
} from '../src/ingestion/baseNueva/mapper';
import { aplicaAlInstrumento, rasgosDeLoEscrito, type RasgosDelInstrumento } from '../src/ingestion/baseNueva/aplicabilidad';
import { cargarEsquemas, rutasDe } from '../src/config/baseNueva/esquemas';
import { validarEscritura } from '../src/config/baseNueva/validadores';

/**
 * Tipos de bono, duración y calidad crediticia, solo donde hay renta fija (Óscar, 21-11-2026; decisión C-17).
 *
 * El caso que lo motiva, medido el 21-11-2026 sobre la base nueva: 224 fondos y ETF con `fixed_income` 0 llevaban
 * `bond_types`, y 148 de ellos `{cash: 1}` —el 100 % de nada asignado al efectivo—. Las cifras esperadas son las de la
 * regla, escritas a mano: el campo está si y solo si el reparto cierra y su renta fija, con los convertibles, pesa al
 * menos un 0,5 % (umbral y convertibles decididos por Óscar el mismo día).
 */

const AHORA = '2026-11-21T10:00:00.000Z';
const ISIN = 'IE0007987708';

const MAPAS_DE_RENTA_FIJA = {
    bond_types: { cash: 1 },
    duration: { short: 0.6, long: 0.4 },
    credit: { aaa: 0.5, bbb: 0.5 }
};

function ficha(asset_mix: Record<string, number>, extra: Record<string, unknown> = MAPAS_DE_RENTA_FIJA, categoria?: string): FichaCanonica {
    return {
        isin: ISIN,
        name: 'Un Fondo',
        currency: 'EUR',
        report_date: '2026-09-30',
        generated_at: '2026-10-31T13:32:32+00:00',
        regulatory: { domicile: 'IRL' },
        ms: {
            report_date: '2026-09-30',
            portfolio: { as_of: '2026-09-30' },
            costs: { ter: 0.5 },
            fixed_income: {},
            ...(categoria ? { category_morningstar: categoria } : {})
        },
        classification_v2: { asset_type: 'equity' },
        portfolio_exposure_v2: { asset_mix, sectors: { technology: 1 }, exposure_confidence: 0.9, ...extra },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

function universal(cartera?: Record<string, unknown>): RegistroUniversal {
    return {
        ...(cartera ? { cartera } : {}),
        _id: ISIN,
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'IRL', nombre: 'Un Fondo' },
        riesgo: { fecha_dato: '2026-09-30' },
        rentabilidad: { fecha_dato: '2026-09-30' },
        costes: { ter_pct: 0.5 },
        valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'EUR' }
    };
}

const exposicion = (
    asset_mix: Record<string, number>,
    extra?: Record<string, unknown>,
    opciones: { categoria?: string; cartera?: Record<string, unknown> } = {}
) => {
    const resultado = mapearInstrumento(ficha(asset_mix, extra, opciones.categoria), universal(opciones.cartera), AHORA);
    const bloque = resultado.documentos.find((documento) => documento.ruta.endsWith('/declared/exposure'));
    return { resultado, bloque };
};

const noAplica = (resultado: ReturnType<typeof mapearInstrumento>) =>
    resultado.ausencias.filter((a) => a.razon === 'NOT_APPLICABLE' && a.ruta.startsWith('declared/exposure.')).map((a) => a.ruta);

describe('Tipos de bono solo donde hay renta fija (21-11-2026)', () => {
    it('un fondo de bolsa sin renta fija: ni tipos de bono, ni duración, ni calidad, y consta que no aplican', () => {
        /* Como IE0007987708: 99,7 % de bolsa, 0 de renta fija, y el proveedor le da `corporate` o `cash` al 100 %. */
        const { resultado, bloque } = exposicion({ equity: 0.997, bond: 0, cash: 0.003, other: 0 });
        expect(bloque).toBeDefined();
        expect(bloque!.documento).not.toHaveProperty('bond_types');
        expect(bloque!.documento).not.toHaveProperty('duration_buckets');
        expect(bloque!.documento).not.toHaveProperty('credit_buckets');
        /* Lo demás del bloque sigue: el reparto y los sectores. */
        expect(bloque!.documento['asset_mix']).toEqual({ equity: 0.997, fixed_income: 0, cash: 0.003, other: 0 });
        expect(bloque!.documento['sectors']).toEqual({ technology: 1 });
        expect(noAplica(resultado).sort()).toEqual([
            'declared/exposure.bond_types',
            'declared/exposure.credit_buckets',
            'declared/exposure.duration_buckets'
        ]);
        expect(validarEscritura(bloque!.tipo, bloque!.documento, 'platform').ok).toBe(true);
    });

    it('y la base ya no tiene un campo presente donde no aplica (C-17), que antes sí', () => {
        const { bloque } = exposicion({ equity: 1, bond: 0, cash: 0, other: 0 });
        const material = (documento: Record<string, unknown>): InstrumentoLeido => ({
            instrument_id: ISIN,
            raiz: { instrument_type: 'FUND' },
            bloques: { 'declared/exposure': documento }
        });
        expect(camposPresentesDondeNoAplica(material(bloque!.documento))).toEqual([]);
        /* El documento de antes del cambio, a mano: el mismo con los tres mapas. Es lo que la auditoría contaba. */
        const antes = { ...bloque!.documento, bond_types: { cash: 1 }, duration_buckets: { short: 0.6, long: 0.4 }, credit_buckets: { aaa: 0.5, bbb: 0.5 } };
        expect(camposPresentesDondeNoAplica(material(antes)).map((c) => c.ruta).sort()).toEqual(['bond_types', 'credit_buckets', 'duration_buckets']);
    });

    it('con renta fija, los tres se escriben como llegan', () => {
        const { resultado, bloque } = exposicion({ equity: 0.6, bond: 0.35, cash: 0.05, other: 0 });
        expect(bloque!.documento['bond_types']).toEqual({ cash: 1 });
        expect(bloque!.documento['duration_buckets']).toEqual({ short: 0.6, long: 0.4 });
        expect(bloque!.documento['credit_buckets']).toEqual({ aaa: 0.5, bbb: 0.5 });
        expect(noAplica(resultado)).toEqual([]);
    });

    it('el umbral del 0,5 % (Óscar, 21-11-2026): con un 0,4 % no se escriben, con un 0,5 % sí', () => {
        /* 0,004 < 0,005: residual. 0,005 = 0,005: el borde cuenta. */
        const con04 = exposicion({ equity: 0.946, bond: 0.004, cash: 0.05, other: 0 });
        expect(con04.bloque!.documento).not.toHaveProperty('bond_types');
        expect(con04.bloque!.documento['asset_mix']).toMatchObject({ fixed_income: 0.004 });
        expect(noAplica(con04.resultado)).toHaveLength(3);
        const con05 = exposicion({ equity: 0.945, bond: 0.005, cash: 0.05, other: 0 });
        expect(con05.bloque!.documento['bond_types']).toEqual({ cash: 1 });
        expect(noAplica(con05.resultado)).toEqual([]);
        /* Un 0,0001 %, que antes del umbral bastaba, ya no basta. */
        expect(exposicion({ equity: 0.999999, bond: 0.000001, cash: 0, other: 0 }).bloque!.documento).not.toHaveProperty('bond_types');
    });

    it('Lazard Global Convertibles: renta fija 0, otros 95,3 % y categoría de convertibles; conserva sus mapas', () => {
        const lazard = exposicion(
            { equity: 0.027538, bond: 0, cash: 0.019933, other: 0.952528 },
            { bond_types: { corporate: 0.979502, cash: 0.020498 } },
            { categoria: 'EAA Fund Convertible Bond - Global, EUR Hedged' }
        );
        expect(lazard.bloque!.documento['bond_types']).toEqual({ corporate: 0.979502, cash: 0.020498 });
        /* El reparto por clase no cambia: los convertibles siguen en «otros». */
        expect(lazard.bloque!.documento['asset_mix']).toEqual({ equity: 0.027538, fixed_income: 0, cash: 0.019933, other: 0.952528 });
        expect(noAplica(lazard.resultado)).toEqual([]);
        /* El mismo reparto sin la categoría es un fondo sin renta fija. */
        expect(exposicion({ equity: 0.027538, bond: 0, cash: 0.019933, other: 0.952528 }).bloque!.documento).not.toHaveProperty('bond_types');
    });

    it('el peso propio de los convertibles, cuando el extractor lo trae, se suma a la renta fija: 0,3 + 0,3 = 0,6 %', () => {
        const cartera = { asignacion_activos: { convertibles: { neto: 0.3 } } };
        const { bloque } = exposicion({ equity: 0.947, bond: 0.003, cash: 0.05, other: 0 }, undefined, { cartera });
        expect(bloque!.documento['bond_types']).toEqual({ cash: 1 });
        /* Y 0,1 + 0,3 = 0,4 %: no llega. */
        const corto = exposicion({ equity: 0.946, bond: 0.001, cash: 0.05, other: 0.003 }, undefined, { cartera });
        expect(corto.bloque!.documento).not.toHaveProperty('bond_types');
    });

    it('si el peso propio de los convertibles decide, el mapper avisa: la base no lo guarda y dirá lo contrario', () => {
        /* 0,3 + 0,3 = 0,6 %: se escriben. Leído de la base, sin el peso propio, es un 0,3 %: no aplicarían. */
        const cartera = { asignacion_activos: { convertibles: { neto: 0.3 } } };
        const decide = exposicion({ equity: 0.947, bond: 0.003, cash: 0.05, other: 0 }, undefined, { cartera });
        expect(decide.resultado.avisos.filter((a) => a.startsWith('mapas de renta fija'))).toHaveLength(1);
        /* 0,1 + 0,3 = 0,4 %: no se escriben, y sin el peso propio tampoco. Nada que avisar. */
        const noDecide = exposicion({ equity: 0.946, bond: 0.001, cash: 0.05, other: 0.003 }, undefined, { cartera });
        expect(noDecide.resultado.avisos.filter((a) => a.startsWith('mapas de renta fija'))).toEqual([]);
        /* Sin peso propio no hay nada que la base no pueda reproducir. */
        expect(exposicion({ equity: 0.945, bond: 0.005, cash: 0.05, other: 0 }).resultado.avisos.filter((a) => a.startsWith('mapas de renta fija'))).toEqual([]);
    });

    it('la cuenta, a mano', () => {
        expect(pesoDeRentaFijaDeSusMapas({ fixed_income: 0.004, other: 0.2 }, {}, 'EAA Fund Global Bond')).toBeCloseTo(0.004, 9);
        expect(pesoDeRentaFijaDeSusMapas({ fixed_income: 0.1, other: 0.8 }, {}, 'EAA Fund Convertible Bond - Europe')).toBeCloseTo(0.9, 9);
        /* Con el peso propio, manda el propio aunque la categoría sea de convertibles. */
        expect(pesoDeRentaFijaDeSusMapas({ fixed_income: 0.1, other: 0.8 }, { convertibles: { neto: 5 } }, 'Convertible Bond')).toBeCloseTo(0.15, 9);
        expect(pesoDeRentaFijaDeSusMapas(undefined, {}, 'Convertible Bond')).toBe(0);
        expect(UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS).toBe(0.005);
    });

    it('una renta fija neta negativa no es renta fija: como FR0013219243, −0,85 %', () => {
        const { resultado, bloque } = exposicion({ equity: 0.9885, bond: -0.0085, cash: 0.02, other: 0 });
        expect(bloque!.documento['asset_mix']).toMatchObject({ fixed_income: -0.0085 });
        expect(bloque!.documento).not.toHaveProperty('bond_types');
        expect(noAplica(resultado)).toHaveLength(3);
    });

    it('sin reparto que cierre no se sabe si hay renta fija: no se escriben y tampoco se afirma que no aplican', () => {
        /* Suma 0,8: no hay reparto, y el bloque sale por los sectores (decisión 109). */
        const { resultado, bloque } = exposicion({ equity: 0.8, bond: 0, cash: 0, other: 0 });
        expect(bloque!.documento).not.toHaveProperty('asset_mix');
        expect(bloque!.documento).not.toHaveProperty('bond_types');
        expect(noAplica(resultado)).toEqual([]);
        expect(resultado.ausencias.map((a) => a.ruta)).toContain('declared/exposure.asset_mix');
    });
});

/**
 * El contrato y el mapper dicen lo mismo (21-11-2026). El mapper escribe los tres mapas con la regla del 0,5 % y los
 * convertibles; el contrato declaraba `CON_RENTA_FIJA` (> 0, sin convertibles), y con eso la calidad contaba como «falta»
 * lo que el mapper dejó por residual, y la auditoría llamaba «presente donde no aplica» al `bond_types` de Lazard.
 */
describe('el contrato de los tres mapas de la renta fija y el mapper no se separan', () => {
    const RUTAS = ['bond_types', 'duration_buckets', 'credit_buckets'];
    const esquema = cargarEsquemas().find((e) => e.fichero === 'instrument-declared-exposure.v2.schema.json')!;

    it('los tres declaran el predicado con el que decide el mapper, y `declared/fixed_income` sigue en `CON_RENTA_FIJA`', () => {
        const delContrato = rutasDe(esquema).filter((r) => RUTAS.includes(r.ruta)).map((r) => r.aplicaCuando);
        expect(delContrato).toEqual([PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA, PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA, PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA]);
        expect(PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA).toBe('CON_RENTA_FIJA_NO_RESIDUAL');
        const rentaFija = cargarEsquemas().find((e) => e.fichero === 'instrument-declared-fixed-income.v2.schema.json')!;
        expect(rentaFija.json['x-applies-when']).toBe('CON_RENTA_FIJA');
    });

    /*
     * Cada caso: lo que escribe el mapper, leído como lo lee la base —su raíz y su `declared/exposure`—, contra el
     * predicado que declara el contrato. Escrito ⇔ aplica; no escrito ⇔ no aplica; y ni la comprobación C-17 ni la
     * calidad encuentran nada que decir de los tres.
     */
    const CASOS: { nombre: string; reparto: Record<string, number>; categoria?: string; aplica: boolean }[] = [
        { nombre: 'sin renta fija', reparto: { equity: 0.997, bond: 0, cash: 0.003, other: 0 }, aplica: false },
        { nombre: 'residual, 0,4 %', reparto: { equity: 0.946, bond: 0.004, cash: 0.05, other: 0 }, aplica: false },
        { nombre: 'en el borde, 0,5 %', reparto: { equity: 0.945, bond: 0.005, cash: 0.05, other: 0 }, aplica: true },
        { nombre: 'mixto', reparto: { equity: 0.6, bond: 0.35, cash: 0.05, other: 0 }, aplica: true },
        { nombre: 'negativa', reparto: { equity: 0.9885, bond: -0.0085, cash: 0.02, other: 0 }, aplica: false },
        {
            nombre: 'Lazard, por su categoría',
            reparto: { equity: 0.027538, bond: 0, cash: 0.019933, other: 0.952528 },
            categoria: 'EAA Fund Convertible Bond - Global, EUR Hedged',
            aplica: true
        },
        { nombre: 'el mismo reparto sin la categoría', reparto: { equity: 0.027538, bond: 0, cash: 0.019933, other: 0.952528 }, aplica: false }
    ];
    for (const caso of CASOS) {
        it(`${caso.nombre}: ${caso.aplica ? 'se escriben y aplican' : 'ni se escriben ni aplican'}`, () => {
            const { resultado, bloque } = exposicion(caso.reparto, undefined, { categoria: caso.categoria });
            const raiz = resultado.documentos.find((d) => d.ruta === `instruments/${ISIN}`)!.documento;
            const rasgos = rasgosDeLoEscrito(raiz, bloque!.documento);
            expect(aplicaAlInstrumento(PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA, rasgos)).toBe(caso.aplica);
            for (const ruta of RUTAS) expect(bloque!.documento[ruta] !== undefined).toBe(caso.aplica);

            const leido: InstrumentoLeido = { instrument_id: ISIN, raiz, bloques: { 'declared/exposure': bloque!.documento } };
            expect(camposPresentesDondeNoAplica(leido).filter((c) => c.bloque === 'declared/exposure')).toEqual([]);
            const ausentes = (calcularCalidad(leido, AHORA).documento['absences'] as { path: string }[]).map((a) => a.path);
            for (const ruta of RUTAS) expect(ausentes).not.toContain(`declared/exposure.${ruta}`);
        });
    }

    it('el predicado, a mano: el borde, la categoría, el peso propio y sin reparto', () => {
        const fondo = (asset_mix: Record<string, number> | undefined, extra: Partial<RasgosDelInstrumento> = {}) =>
            aplicaAlInstrumento('CON_RENTA_FIJA_NO_RESIDUAL', { instrument_type: 'FUND', asset_mix, ...extra });
        expect(fondo({ equity: 0.995, fixed_income: 0.005, cash: 0, other: 0 })).toBe(true);
        expect(fondo({ equity: 0.996, fixed_income: 0.004, cash: 0, other: 0 })).toBe(false);
        expect(fondo({ equity: 0.2, fixed_income: 0, cash: 0, other: 0.8 }, { category: 'Convertible Bond' })).toBe(true);
        expect(fondo({ equity: 0.2, fixed_income: 0, cash: 0, other: 0.8 }, { category: 'RV Global' })).toBe(false);
        /* Con el peso propio, manda el propio aunque la categoría sea de convertibles: 0,1 % + 0,3 % no llega. */
        expect(fondo({ equity: 0.2, fixed_income: 0.001, cash: 0, other: 0.799 }, { category: 'Convertible Bond', convertibles: 0.003 })).toBe(false);
        expect(fondo({ equity: 0.996, fixed_income: 0.003, cash: 0, other: 0.001 }, { convertibles: 0.003 })).toBe(true);
        expect(fondo(undefined, { category: 'Convertible Bond' })).toBeUndefined();
        /* Y `CON_RENTA_FIJA` no cambia: > 0, sin convertibles. */
        expect(aplicaAlInstrumento('CON_RENTA_FIJA', { instrument_type: 'FUND', asset_mix: { equity: 0.999, fixed_income: 0.001, cash: 0, other: 0 } })).toBe(true);
    });
});
