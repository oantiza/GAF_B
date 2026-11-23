import { describe, it, expect } from 'vitest';

import { mapearInstrumento, pagadoQueNoSeContradice, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { calcularCalidad, componerTarjeta, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';

/**
 * «Pagado en 12 meses»: el cero falso no se escribe (Óscar, 21-11-2026).
 *
 * Medido el 21-11-2026 sobre las 508 acciones con bloque de dividendos: 144 traen el importe a 0, y en 49 el mismo
 * proveedor da a la vez rentabilidad o dividendo previsto positivos (Roche CH0030170408: 2,2 % y 12,9 previstos); en 2
 * más hay una ex-dividendo de los últimos doce meses. Sin ninguna señal, el cero es de una empresa que no paga y se
 * escribe. Las cifras esperadas son las de la regla, escritas a mano.
 */

const AHORA = '2026-11-21T10:00:00.000Z';
const ISIN = 'CH0030170408';
/** La fecha de la ficha, que es la referencia de los doce meses. */
const FECHA = '2026-11-16';

function universal(dividendos: Record<string, unknown>, pagado: number | undefined): RegistroUniversal {
    return {
        _id: ISIN,
        identificacion: {
            nombre: 'Roche Holding AG',
            tipo: 'accion',
            tipo_producto: 'accion',
            isin: ISIN,
            ticker: 'ROG',
            mercado: 'SW',
            pais: 'Switzerland',
            divisa_base: 'CHF',
            sector: 'Healthcare',
            industria: 'Drug Manufacturers - General',
            fecha_dato: FECHA
        },
        valoracion: { vl: 250, vl_fecha: FECHA, vl_divisa: 'CHF' },
        rentabilidad: { fecha_dato: FECHA },
        riesgo: { fecha_dato: FECHA },
        fundamentales: {
            currency: 'CHF',
            dividends: dividendos,
            per_share: pagado === undefined ? {} : { dividend: pagado }
        },
        meta: { isin: ISIN, actualizado: '2026-11-16T16:47:11+00:00' }
    };
}

const ficha = () => ({
    isin: ISIN,
    name: 'Roche Holding AG',
    currency: 'CHF',
    report_date: FECHA,
    generated_at: '2026-11-16T18:39:44+00:00',
    ms: {},
    classification_v2: { asset_type: 'stock', asset_subtype: 'common_stock' },
    provenance: { version: 1, fields: {} }
});

const mapear = (dividendos: Record<string, unknown>, pagado: number | undefined) =>
    mapearInstrumento(ficha(), universal(dividendos, pagado), AHORA);

const bloqueDe = (resultado: ReturnType<typeof mapearInstrumento>) =>
    resultado.documentos.find((documento) => documento.ruta.endsWith('/declared/dividends'));

const ausenciaDelPagado = (resultado: ReturnType<typeof mapearInstrumento>) =>
    resultado.ausencias.find((a) => a.ruta === 'declared/dividends.trailing_amount_per_share');

describe('«Pagado en 12 meses»: el cero que el proveedor desmiente no se escribe', () => {
    it('cero con rentabilidad y previsto positivos (Roche): no se escribe, consta NOT_PROVIDED, y lo demás sigue', () => {
        const resultado = mapear({ yield_ratio: 0.022, forward_annual_rate: 12.9, ex_dividend_date: '2026-03-12' }, 0);
        const bloque = bloqueDe(resultado)!;
        expect(bloque.documento).not.toHaveProperty('trailing_amount_per_share');
        expect(bloque.documento['yield_12m']).toBe(0.022);
        expect(bloque.documento['forward_amount_per_share']).toBe(12.9);
        expect(bloque.documento['ex_dividend_date']).toBe('2026-03-12');
        /* El previsto es un importe, así que la divisa se queda. */
        expect(bloque.documento['currency']).toBe('CHF');
        expect(ausenciaDelPagado(resultado)?.razon).toBe('NOT_PROVIDED');
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('cero con solo la rentabilidad positiva: tampoco, y sin importe no lleva divisa', () => {
        const resultado = mapear({ yield_ratio: 0.17 }, 0);
        const bloque = bloqueDe(resultado)!;
        expect(bloque.documento).not.toHaveProperty('trailing_amount_per_share');
        expect(bloque.documento).not.toHaveProperty('currency');
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('cero, rentabilidad 0, sin previsto y ex-dividendo de hace 200 días (NL0015000LU4): no se escribe', () => {
        const resultado = mapear({ yield_ratio: 0, ex_dividend_date: '2026-04-30' }, 0);
        expect(bloqueDe(resultado)!.documento).not.toHaveProperty('trailing_amount_per_share');
        expect(ausenciaDelPagado(resultado)?.detalle).toContain('ex-dividendo el 2026-04-30');
    });

    it('cero sin ninguna señal: es una empresa que no paga, y el cero se escribe', () => {
        const resultado = mapear({ yield_ratio: 0, forward_annual_rate: 0 }, 0);
        expect(bloqueDe(resultado)!.documento['trailing_amount_per_share']).toBe(0);
        expect(ausenciaDelPagado(resultado)).toBeUndefined();
    });

    it('cero con una ex-dividendo vieja (dejó de pagar en 2024): el cero se escribe', () => {
        const resultado = mapear({ yield_ratio: 0, ex_dividend_date: '2024-06-03' }, 0);
        expect(bloqueDe(resultado)!.documento['trailing_amount_per_share']).toBe(0);
    });

    it('un importe positivo no se toca, diga lo que diga el resto', () => {
        const resultado = mapear({ yield_ratio: 0, forward_annual_rate: 0 }, 9.7);
        expect(bloqueDe(resultado)!.documento['trailing_amount_per_share']).toBe(9.7);
        expect(ausenciaDelPagado(resultado)).toBeUndefined();
    });
});

describe('la regla, punto por punto', () => {
    it.each([
        /* pagado, rendimiento, previsto, ex-dividendo, se escribe */
        [0, 0.022, 12.9, undefined, undefined],
        [0, 0.022, undefined, undefined, undefined],
        [0, undefined, 1.5, undefined, undefined],
        [0, 0, 0, '2025-11-17', undefined], // 364 días antes de la ficha: dentro
        [0, 0, 0, '2025-11-16', undefined], // 365 días: dentro, el borde cuenta
        [0, 0, 0, '2025-11-15', 0], //         366 días: fuera
        [0, 0, 0, '2026-12-01', 0], //         posterior a la ficha: es un anuncio, no un pago
        [0, undefined, undefined, undefined, 0],
        [1.2, 0.03, 1.3, '2026-05-01', 1.2],
        [undefined, 0.03, 1.3, undefined, undefined]
    ])('pagado %s, rentabilidad %s, previsto %s, ex-dividendo %s → %s', (pagado, rendimiento, previsto, ex, esperado) => {
        expect(pagadoQueNoSeContradice(pagado, rendimiento, previsto, ex, FECHA).valor).toBe(esperado);
    });
});

describe('lo que llega a la calidad y a la tarjeta', () => {
    it('la ausencia es NOT_PROVIDED en quality/latest, que es lo que la ficha escribe como «Falta el dato»', () => {
        const resultado = mapear({ yield_ratio: 0.022, forward_annual_rate: 12.9 }, 0);
        const porRuta = Object.fromEntries(
            resultado.documentos.map((d) => [d.ruta.replace(`instruments/${ISIN}`, '').replace(/^\//, '') || '<raiz>', d.documento])
        );
        const instrumento: InstrumentoLeido = {
            instrument_id: ISIN,
            raiz: porRuta['<raiz>'] as Record<string, unknown>,
            bloques: { 'declared/dividends': porRuta['declared/dividends'] }
        };
        const calidad = calcularCalidad(instrumento, AHORA);
        const ausencias = calidad.documento['absences'] as { path: string; reason: string }[];
        expect(ausencias).toContainEqual({ path: 'declared/dividends.trailing_amount_per_share', reason: 'NOT_PROVIDED' });
        const tarjeta = componerTarjeta(instrumento, calidad, AHORA);
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok, JSON.stringify(tarjeta)).toBe(true);
        expect((tarjeta?.['dividends'] as Record<string, unknown>)['trailing_amount_per_share']).toBeUndefined();
    });
});
