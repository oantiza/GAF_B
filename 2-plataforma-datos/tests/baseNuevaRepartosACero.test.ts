import { describe, it, expect } from 'vitest';

import {
    avisosDe,
    calcularCalidad,
    componerTarjeta,
    esMateriaPrimaSinReparto,
    type InstrumentoLeido
} from '../src/ingestion/baseNueva/calidadYTarjeta';
import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { validarForma } from '../src/config/baseNueva/validadores';

/**
 * Los repartos con las cuatro clases a cero (Óscar, 21-11-2026). Medido sobre el canónico del 17-11: son tres.
 *  - ES0132526031 (Oportunidad Bursátil SICAV) y LU1814994353 (Azvalor Lux Altum Faith Consistent Equity R): el reparto
 *    no se conoce. No se escriben ceros: `asset_mix` falta, NOT_PROVIDED, y la ficha dice «Falta el dato».
 *  - IE00B4ND3602 (iShares Physical Gold ETC): oro físico. Su reparto es 100 % en «otros», deducido del tipo, en la tarjeta.
 */

const AHORA = '2026-11-21T10:00:00.000Z';

function ficha(isin: string, asset_mix: Record<string, number>): FichaCanonica {
    return {
        isin,
        name: 'Un Fondo',
        currency: 'EUR',
        report_date: '2026-09-30',
        generated_at: '2026-10-31T13:32:32+00:00',
        regulatory: { domicile: 'LUX' },
        ms: { report_date: '2026-09-30', portfolio: { as_of: '2026-09-30' }, costs: { ter: 0.5 }, fixed_income: {} },
        classification_v2: { asset_type: 'equity' },
        portfolio_exposure_v2: { asset_mix, exposure_confidence: 0.9 },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

function universal(isin: string): RegistroUniversal {
    return {
        _id: isin,
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'LUX', nombre: 'Un Fondo' },
        riesgo: { fecha_dato: '2026-09-30' },
        rentabilidad: { fecha_dato: '2026-09-30' },
        costes: { ter_pct: 0.5 },
        valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'EUR' }
    };
}

describe('un reparto con las cuatro clases a cero es un reparto que falta', () => {
    it('no se escribe ningún cero: sin asset_mix, con la ausencia NOT_PROVIDED que dice por qué', () => {
        const isin = 'LU1814994353';
        const resultado = mapearInstrumento(ficha(isin, { equity: 0, bond: 0, cash: 0, other: 0 }), universal(isin), AHORA);
        const exposicion = resultado.documentos.find((d) => d.ruta.endsWith('/declared/exposure'));
        /* Sin reparto ni nada de la renta variable, no hay bloque (decisión 109). */
        expect(exposicion).toBeUndefined();
        const ausencia = resultado.ausencias.find((a) => a.ruta === 'declared/exposure.asset_mix');
        expect(ausencia?.razon).toBe('NOT_PROVIDED');
        expect(ausencia?.detalle).toContain('las cuatro clases llegan a 0');
        expect(resultado.avisos).toContain('asset_mix con las cuatro clases a 0: el proveedor no da el reparto');
    });

    it('en la calidad es NOT_PROVIDED, que la ficha escribe «Falta el dato», y el aviso de que no hay reparto sigue', () => {
        const instrumento: InstrumentoLeido = { instrument_id: 'ES0132526031', raiz: { instrument_type: 'FUND' }, bloques: {} };
        const calidad = calcularCalidad(instrumento, AHORA);
        /* La calidad las anota hoja a hoja; la ficha pregunta por `declared/exposure.asset_mix` y, sin otra razón, dice que falta. */
        expect(calidad.documento['absences']).toContainEqual({ path: 'declared/exposure.asset_mix.equity', reason: 'NOT_PROVIDED' });
        expect(calidad.documento['absences']).toContainEqual({ path: 'declared/exposure.asset_mix.other', reason: 'NOT_PROVIDED' });
        expect(avisosDe(instrumento).map((a) => a.code)).toContain('SIN_REPARTO_DE_ACTIVOS');
        expect(componerTarjeta(instrumento, calidad, AHORA)?.['exposure']).toBeUndefined();
    });

    it('una sola clase a cero no es esto: el reparto que suma 1 se escribe', () => {
        const isin = 'LU1814994353';
        const resultado = mapearInstrumento(ficha(isin, { equity: 1, bond: 0, cash: 0, other: 0 }), universal(isin), AHORA);
        const exposicion = resultado.documentos.find((d) => d.ruta.endsWith('/declared/exposure'));
        expect(exposicion?.documento['asset_mix']).toEqual({ equity: 1, fixed_income: 0, cash: 0, other: 0 });
    });
});

describe('el ETC de oro físico: 100 % en «otros», deducido del tipo', () => {
    const oro = (bloques: InstrumentoLeido['bloques'] = {}, raiz: Record<string, unknown> = {}): InstrumentoLeido => ({
        instrument_id: 'IE00B4ND3602',
        raiz: {
            instrument_type: 'OTHER',
            identity: { name: 'iShares Physical Gold ETC', currency: 'USD' },
            classification: { category: 'Materias Primas - Metales Preciosos', asset_class: 'REAL_ASSETS' },
            ...raiz
        },
        bloques
    });

    it('la tarjeta lo lleva marcado BY_INSTRUMENT_TYPE, pasa su contrato, y no avisa de que falta el reparto', () => {
        const instrumento = oro();
        expect(esMateriaPrimaSinReparto(instrumento)).toBe(true);
        const calidad = calcularCalidad(instrumento, AHORA);
        const tarjeta = componerTarjeta(instrumento, calidad, AHORA);
        expect(tarjeta?.['exposure']).toEqual({
            asset_mix: { equity: 0, fixed_income: 0, cash: 0, other: 1 },
            confidence: 1,
            derivation: 'BY_INSTRUMENT_TYPE'
        });
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta!).ok, JSON.stringify(tarjeta)).toBe(true);
        expect(avisosDe(instrumento).map((a) => a.code)).not.toContain('SIN_REPARTO_DE_ACTIVOS');
        /* Y entra en una radiografía, como una acción: su composición se conoce. */
        const aptitudes = (tarjeta?.['quality'] as Record<string, Record<string, { apt: boolean }>>)['fitness'];
        expect(aptitudes['RADIOGRAFIA_DE_CARTERA']?.apt).toBe(true);
        /* El reparto de un OTHER no cuenta en la cobertura: el bloque no le aplica, y esto no lo cambia. */
        expect((calidad.documento['absences'] as { path: string }[]).some((a) => a.path.startsWith('declared/exposure'))).toBe(false);
    });

    it('un fondo de materias primas (FUND, REAL_ASSETS) no: tiene su reparto medido, o le falta', () => {
        expect(esMateriaPrimaSinReparto(oro({}, { instrument_type: 'FUND' }))).toBe(false);
    });

    it('un OTHER que no es de materias primas no', () => {
        expect(esMateriaPrimaSinReparto(oro({}, { classification: { asset_class: 'OTHER' } }))).toBe(false);
    });

    it('si algún día el proveedor da su reparto, manda lo declarado', () => {
        const declarado = { source: 'x', as_of: '2026-09-30', confidence: 0.9, asset_mix: { equity: 0, fixed_income: 0, cash: 0.02, other: 0.98 }, asset_mix_completion: 'REPORTED' };
        const instrumento = oro({ 'declared/exposure': declarado });
        expect(esMateriaPrimaSinReparto(instrumento)).toBe(false);
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA);
        expect((tarjeta?.['exposure'] as Record<string, unknown>)['derivation']).toBe('DECLARED');
    });
});
