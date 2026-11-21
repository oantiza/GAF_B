import { describe, it, expect } from 'vitest';

import { mapearInstrumento, identidadFirds, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { validarEscritura } from '../src/config/baseNueva/validadores';

/**
 * CFI, LEI del emisor y centros de negociación, de FIRDS a la raíz del instrumento.
 *
 * Encargo «identidad» del 07-11-2026 (paso 3 de DECISIONES_DATOS_2026-11-07). Los tres casos
 * son ISIN reales, con lo que el índice FIRDS del 31-10 (deltas hasta el 06-11) dice de ellos:
 *
 * - `ES0105046017` Aena: acción en 46 centros; aquí van cuatro, uno con baja.
 * - `ES0110407006`: un fondo español que no cotiza. FIRDS no lo tiene; su CFI lo da la CNMV,
 *   y por eso el canónico no le trae bloque de FIRDS.
 * - `IE00B4ND3602` iShares Physical Gold: el ETC, `EYAYFT` en FIRDS, que se queda `OTHER`.
 *
 * La regla de la revisión del 06-11 manda sobre todo esto: se añade; lo que la app lee no se
 * renombra, ni se mueve, ni cambia de valores.
 */

const AHORA = '2026-11-07T12:00:00.000Z';

const FIRDS_AENA = {
    cfi: 'ESVUFB',
    cfi_tipo: 'ACCION',
    lei_emisor: '959800R7QMXKF0NFMT29',
    autoridad_competente: 'ES',
    mercados: [
        { mic: 'XMAD', admision: '2025-06-19', primera_negociacion: '2025-06-19' },
        { mic: 'AQEU', primera_negociacion: '2025-06-20' },
        { mic: 'XETB', admision: '2025-06-23', primera_negociacion: '2025-06-23', baja: '2026-12-31' },
        { mic: 'DUSB', primera_negociacion: '2025-06-20' }
    ],
    visto: '2026-10-31'
};

const FIRDS_ETC = {
    cfi: 'EYAYFT',
    cfi_tipo: 'ESTRUCTURADO',
    lei_emisor: '549300T2ISPWHQ8IPF83',
    autoridad_competente: 'DE',
    mercados: [{ mic: 'XETA', admision: '2011-04-18' }, { mic: 'AQEA', primera_negociacion: '2026-07-30' }],
    visto: '2026-10-31'
};

function accion(firds?: Record<string, unknown>): [FichaCanonica, RegistroUniversal] {
    const isin = 'ES0105046017';
    return [
        {
            isin,
            name: 'Aena SA',
            currency: 'EUR',
            report_date: '2026-11-06',
            generated_at: '2026-11-07T10:00:00+00:00',
            ms: {},
            classification_v2: { asset_type: 'stock', asset_subtype: 'common_stock' },
            provenance: { version: 1, fields: {} },
            ...(firds ? { identidad_firds: firds } : {})
        },
        {
            _id: isin,
            identificacion: { nombre: 'Aena SA', tipo: 'accion', tipo_producto: 'accion', isin, ticker: 'AENA', mercado: 'MC', pais: 'Spain', divisa_base: 'EUR' },
            meta: { isin, actualizado: '2026-11-07T10:00:00+00:00' }
        }
    ];
}

function instrumento(isin: string, tipoProducto: string, firds?: Record<string, unknown>): [FichaCanonica, RegistroUniversal] {
    return [
        {
            isin,
            name: 'Un instrumento',
            currency: 'EUR',
            report_date: '2026-09-30',
            generated_at: '2026-11-07T10:00:00+00:00',
            regulatory: { domicile: isin.startsWith('ES') ? 'ESP' : 'IRL' },
            ms: { report_date: '2026-09-30', costs: { ter: 0.12 }, fixed_income: {} },
            classification_v2: { asset_type: tipoProducto === 'etc' ? 'other' : 'equity' },
            portfolio_exposure_v2: {},
            provenance: { version: 'paquete', fields: {} },
            ...(firds ? { identidad_firds: firds } : {})
        },
        {
            _id: isin,
            identificacion: { tipo_producto: tipoProducto, clase_activo: tipoProducto === 'etc' ? 'Real Assets' : 'Equity', divisa_base: 'EUR', domicilio: isin.startsWith('ES') ? 'ESP' : 'IRL', nombre: 'Un instrumento' }
        }
    ];
}

const raizDe = (resultado: ReturnType<typeof mapearInstrumento>) =>
    resultado.documentos.find((documento) => /^instruments\/[A-Z0-9]+$/.test(documento.ruta))!;

describe('identidad de FIRDS en la raiz', () => {
    it('una accion con varios mercados lleva CFI, LEI, sus centros ordenados por MIC y la fecha del indice', () => {
        const raiz = raizDe(mapearInstrumento(...accion(FIRDS_AENA), AHORA));
        const doc = raiz.documento;
        expect(doc['instrument_type']).toBe('STOCK');
        expect(doc['identifiers']).toEqual({ ticker: 'AENA', cfi: 'ESVUFB', lei: '959800R7QMXKF0NFMT29' });
        expect(doc['listings']).toEqual([
            { mic: 'AQEU', first_trade_date: '2025-06-20' },
            { mic: 'DUSB', first_trade_date: '2025-06-20' },
            { mic: 'XETB', admission_date: '2025-06-23', first_trade_date: '2025-06-23', termination_date: '2026-12-31' },
            { mic: 'XMAD', admission_date: '2025-06-19', first_trade_date: '2025-06-19' }
        ]);
        expect(doc['listings_as_of']).toBe('2026-10-31');
        expect(validarEscritura(raiz.tipo, doc, 'platform').ok).toBe(true);
    });

    it('una baja en un centro no toca la disponibilidad: eso lo dice quien da el precio', () => {
        const doc = raizDe(mapearInstrumento(...accion(FIRDS_AENA), AHORA)).documento;
        expect(doc['availability']).toBeUndefined();
    });

    it('un fondo que no cotiza no lleva nada de FIRDS, ni campos vacios', () => {
        const raiz = raizDe(mapearInstrumento(...instrumento('ES0110407006', 'fondo'), AHORA));
        expect(raiz.documento['instrument_type']).toBe('FUND');
        expect(raiz.documento['identifiers']).toBeUndefined();
        expect(raiz.documento['listings']).toBeUndefined();
        expect(raiz.documento['listings_as_of']).toBeUndefined();
        expect(validarEscritura(raiz.tipo, raiz.documento, 'platform').ok).toBe(true);
    });

    it('el ETC lleva su CFI de estructurado y se queda OTHER', () => {
        const raiz = raizDe(mapearInstrumento(...instrumento('IE00B4ND3602', 'etc', FIRDS_ETC), AHORA));
        const doc = raiz.documento;
        expect(doc['instrument_type']).toBe('OTHER');
        expect(doc['identifiers']).toEqual({ cfi: 'EYAYFT', lei: '549300T2ISPWHQ8IPF83' });
        expect(doc['listings']).toEqual([{ mic: 'AQEA', first_trade_date: '2026-07-30' }, { mic: 'XETA', admission_date: '2011-04-18' }]);
        expect(validarEscritura(raiz.tipo, doc, 'platform').ok).toBe(true);
    });

    it('lo que la app ya lee no cambia: mismo ticker y misma raiz salvo los campos nuevos', () => {
        const sin = raizDe(mapearInstrumento(...accion(), AHORA)).documento;
        const con = raizDe(mapearInstrumento(...accion(FIRDS_AENA), AHORA)).documento;
        const { listings: _l, listings_as_of: _f, identifiers, ...resto } = con;
        const { identifiers: identificadoresSin, ...restoSin } = sin;
        expect(resto).toEqual(restoSin);
        expect((identifiers as Record<string, unknown>)['ticker']).toBe((identificadoresSin as Record<string, unknown>)['ticker']);
    });
});

describe('lo que no se escribe', () => {
    it('sin fecha del indice no se escribe nada de FIRDS, y se avisa', () => {
        const avisos: string[] = [];
        expect(identidadFirds({ identidad_firds: { ...FIRDS_AENA, visto: undefined } }, avisos)).toEqual({});
        expect(avisos).toHaveLength(1);
    });

    it('un CFI, un LEI o un MIC que no encajan se saltan con aviso, y no se arreglan', () => {
        const avisos: string[] = [];
        const salida = identidadFirds(
            { identidad_firds: { cfi: 'ESV', lei_emisor: 'NO-ES-UN-LEI', mercados: [{ mic: 'MADRID' }, { mic: 'XMAD' }], visto: '2026-10-31' } },
            avisos
        );
        expect(salida).toEqual({ listings: [{ mic: 'XMAD' }], listings_as_of: '2026-10-31' });
        expect(avisos).toHaveLength(3);
    });

    it('el tipo que el extractor deduce del CFI no se guarda: es el CFI otra vez', () => {
        const salida = identidadFirds({ identidad_firds: FIRDS_ETC }, []);
        expect(Object.keys(salida).sort()).toEqual(['cfi', 'lei', 'listings', 'listings_as_of']);
    });

    it('mas centros que el tope no se escriben: una lista recortada diria que no cotiza donde si', () => {
        const mercados = Array.from({ length: 121 }, (_, i) => ({ mic: `X${String(i).padStart(3, '0')}` }));
        const avisos: string[] = [];
        const salida = identidadFirds({ identidad_firds: { cfi: 'ESVUFB', mercados, visto: '2026-10-31' } }, avisos);
        expect(salida).toEqual({ cfi: 'ESVUFB', listings_as_of: '2026-10-31' });
        expect(avisos[0]).toMatch(/121 centros/);
    });
});
