import { describe, expect, it } from 'vitest';
import { camposPresentesDondeNoAplica, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';

/**
 * Decision C-17 (03-11-2026): un campo PRESENTE donde el contrato dice que no aplica es un error. Aqui se prueba la
 * funcion que lo detecta, con casos construidos a mano y no con la base: lo que tiene que dar cada uno se sabe de antemano.
 */
function instrumento(tipo: string, bloques: InstrumentoLeido['bloques'], assetMix?: Record<string, number>): InstrumentoLeido {
    return {
        instrument_id: 'XX0000000000',
        raiz: { instrument_type: tipo },
        bloques: assetMix === undefined ? bloques : { ...bloques, 'declared/exposure': { asset_mix: assetMix } }
    };
}

describe('campos presentes donde el contrato dice que no aplica', () => {
    it('el coste corriente en una ACCION es un error: `declared/costs` es de FONDO_O_ETF', () => {
        const accion = instrumento('STOCK', { 'declared/costs': { ongoing_charge: { value: 0.01 } } });
        const hallazgos = camposPresentesDondeNoAplica(accion);
        expect(hallazgos.some((h) => h.bloque === 'declared/costs' && h.ruta.startsWith('ongoing_charge'))).toBe(true);
        expect(hallazgos.every((h) => h.predicado === 'FONDO_O_ETF')).toBe(true);
    });

    it('el mismo coste en un fondo no lo es', () => {
        const fondo = instrumento('FUND', { 'declared/costs': { ongoing_charge: { value: 0.01 } } });
        expect(camposPresentesDondeNoAplica(fondo)).toEqual([]);
    });

    it('el campo AUSENTE donde no aplica no es nada: es lo correcto', () => {
        expect(camposPresentesDondeNoAplica(instrumento('STOCK', {}))).toEqual([]);
    });

    it('un predicado que depende del reparto y no se puede evaluar no se denuncia', () => {
        /* Sin `asset_mix` no se sabe si hay renta fija: es indecidible, y eso se cuenta aparte. */
        const sinReparto = instrumento('FUND', { 'declared/fixed_income': { avg_credit_quality: { value: 'A' } } });
        expect(camposPresentesDondeNoAplica(sinReparto)).toEqual([]);
    });

    it('con reparto sin renta fija, un dato de renta fija si se denuncia', () => {
        const fondo = instrumento(
            'FUND',
            { 'declared/fixed_income': { avg_credit_quality: { value: 'A' } } },
            { equity: 1, fixed_income: 0 }
        );
        const hallazgos = camposPresentesDondeNoAplica(fondo);
        expect(hallazgos.map((h) => `${h.bloque}.${h.ruta}`)).toContain('declared/fixed_income.avg_credit_quality');
        expect(hallazgos.every((h) => h.predicado === 'CON_RENTA_FIJA')).toBe(true);
    });
});
