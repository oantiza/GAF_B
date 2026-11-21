import { describe, it, expect } from 'vitest';

import {
    mapearEmisores,
    rutaDeVinculo,
    TIPO_EMISOR,
    TIPO_VINCULO,
    type SalidaDeEmisores
} from '../src/ingestion/baseNueva/emisores';
import { validarEscritura } from '../src/config/baseNueva/validadores';

/**
 * Emisores por LEI, «un LEI, un emisor» (decision 8 de DECISIONES_DATOS_2026-11-07).
 *
 * Los tres casos del encargo, pasados por las dos puertas de verdad (forma y dueno): ASML y
 * Alphabet comparten emisor entre sus dos ISIN, una accion normal tiene el suyo, y una sin LEI
 * no tiene ninguno. El agrupado por LEI lo hace el extractor (`tests/test_emisores.py`); aqui
 * se comprueba que la traduccion lo conserva y que lo que sale lo acepta el contrato.
 */

const AHORA = '2026-11-07T15:00:00.000Z';
const DECIDIDO_POR = 'Oscar (regla un LEI, un emisor, decision 8 de DECISIONES_DATOS_2026-11-07)';

function vinculo(isin: string, issuerId: string, lei: string, listing: string, divisa: string) {
    return {
        isin,
        issuer_id: issuerId,
        role: 'EQUITY_ISSUER',
        lei,
        valid_from: '2012-11-26',
        reference_listing: listing,
        reference_currency: divisa,
        decided_by: DECIDIDO_POR,
        decided_at: '2026-11-07',
        reason: `Regla un LEI, un emisor: FIRDS da a este ISIN el LEI ${lei}.`
    };
}

const SALIDA: SalidaDeEmisores = {
    schema_version: 'fondosdb.emisores.v1',
    emisores: [
        {
            issuer_id: 'ISS_000001',
            lei: '5493006MHB84DD0ZWV18',
            nombre_legal: 'ALPHABET INC.',
            pais: 'US',
            jurisdiccion: 'US-DE',
            estado_registro: 'ISSUED',
            estado_entidad: 'ACTIVE',
            gleif_actualizado: '2026-09-17',
            consultado: '2026-11-07',
            isins: ['US02079K1079', 'US02079K3059']
        },
        {
            issuer_id: 'ISS_000002',
            lei: '724500Y6DUVHQD6OXN27',
            nombre_legal: 'ASML Holding N.V.',
            pais: 'NL',
            jurisdiccion: 'NL',
            estado_registro: 'ISSUED',
            estado_entidad: 'ACTIVE',
            gleif_actualizado: '2026-05-02',
            consultado: '2026-11-07',
            isins: ['NL0010273215', 'USN070592100']
        },
        {
            issuer_id: 'ISS_000003',
            lei: '959800R7QMXKF0NFMT29',
            nombre_legal: 'AENA S.M.E. SA',
            pais: 'ES',
            jurisdiccion: 'ES',
            estado_registro: 'ISSUED',
            estado_entidad: 'ACTIVE',
            gleif_actualizado: '2026-10-05',
            consultado: '2026-11-07',
            isins: ['ES0105046017']
        }
    ],
    enlaces: [
        vinculo('US02079K1079', 'ISS_000001', '5493006MHB84DD0ZWV18', 'GOOG.US', 'USD'),
        vinculo('US02079K3059', 'ISS_000001', '5493006MHB84DD0ZWV18', 'GOOGL.US', 'USD'),
        vinculo('NL0010273215', 'ISS_000002', '724500Y6DUVHQD6OXN27', 'ASML.AS', 'EUR'),
        vinculo('USN070592100', 'ISS_000002', '724500Y6DUVHQD6OXN27', 'ASML.US', 'USD'),
        vinculo('ES0105046017', 'ISS_000003', '959800R7QMXKF0NFMT29', 'AENA.MC', 'EUR')
    ],
    sin_lei: [{ isin: 'ES0161560018', nombre: 'NH Hoteles', motivo: 'FIRDS no trae LEI en su ficha' }]
};

const INSTRUMENTOS = new Set([
    'US02079K1079',
    'US02079K3059',
    'NL0010273215',
    'USN070592100',
    'ES0105046017',
    'ES0161560018'
]);

describe('emisores por LEI: un LEI, un emisor', () => {
    const r = mapearEmisores(SALIDA, AHORA, INSTRUMENTOS);
    const emisores = r.documentos.filter((d) => d.tipo === TIPO_EMISOR);
    const vinculos = r.documentos.filter((d) => d.tipo === TIPO_VINCULO);
    const emisorDe = (isin: string): unknown =>
        vinculos.find((d) => d.ruta === rutaDeVinculo(isin))?.documento['issuer_id'];

    it('todo lo que sale pasa las dos puertas, con el dueno de cada dato', () => {
        const fallos = r.documentos.flatMap((d) => {
            const veredicto = validarEscritura(d.tipo, d.documento, d.comoDueno ?? 'platform');
            return veredicto.ok ? [] : [`${d.ruta}: ${veredicto.motivos.join('; ')}`];
        });
        expect(fallos).toEqual([]);
        expect(r.avisos).toEqual([]);
    });

    it('ASML y Alphabet comparten emisor entre sus dos ISIN', () => {
        expect(emisorDe('NL0010273215')).toBe('ISS_000002');
        expect(emisorDe('USN070592100')).toBe('ISS_000002');
        expect(emisorDe('US02079K1079')).toBe('ISS_000001');
        expect(emisorDe('US02079K3059')).toBe('ISS_000001');
        expect(emisores.map((d) => d.ruta)).toEqual(['issuers/ISS_000001', 'issuers/ISS_000002', 'issuers/ISS_000003']);
    });

    it('una accion normal tiene su emisor, con nombre legal, pais y estado de GLEIF', () => {
        const aena = emisores.find((d) => d.ruta === 'issuers/ISS_000003')?.documento;
        expect(aena).toEqual({
            issuer_id: 'ISS_000003',
            schema_version: 'base-nueva.issuer.v2',
            updated_at: AHORA,
            identity: {
                legal_name: 'AENA S.M.E. SA',
                legal_name_folded: 'aena s.m.e. sa',
                country: 'ES',
                lei: '959800R7QMXKF0NFMT29',
                jurisdiction: 'ES',
                lei_registration_status: 'ISSUED',
                entity_status: 'ACTIVE',
                registry_updated_at: '2026-10-05',
                checked_at: '2026-11-07'
            },
            roles: ['EQUITY_ISSUER']
        });
        const vinculo = vinculos.find((d) => d.ruta === 'instrument_issuer/ES0105046017_EQUITY_ISSUER');
        expect(vinculo?.comoDueno).toBe('human');
        expect(vinculo?.documento['reference_listing']).toBe('AENA.MC');
        expect(vinculo?.documento['decided_by']).toBe(DECIDIDO_POR);
    });

    it('una accion sin LEI no tiene vinculo, pero su ruta cuenta para ver un sobrante', () => {
        expect(vinculos.some((d) => d.ruta === rutaDeVinculo('ES0161560018'))).toBe(false);
        expect(r.rutasPosibles).toContain(rutaDeVinculo('ES0161560018'));
        expect(r.emisores).toBe(3);
        expect(r.vinculos).toBe(5);
    });

    it('el vinculo no se puede escribir como platform: es la decision de Oscar, no un dato', () => {
        const vinculo = vinculos[0];
        expect(vinculo).toBeDefined();
        if (vinculo === undefined) return;
        expect(validarEscritura(vinculo.tipo, vinculo.documento, 'platform').ok).toBe(false);
    });

    it('un vinculo a un instrumento que no sale en la pasada no se escribe, y su emisor tampoco', () => {
        const sinAena = new Set([...INSTRUMENTOS].filter((isin) => isin !== 'ES0105046017'));
        const parcial = mapearEmisores(SALIDA, AHORA, sinAena);
        expect(parcial.vinculos).toBe(4);
        expect(parcial.emisores).toBe(2);
        expect(parcial.avisos).toHaveLength(2);
        expect(parcial.rutasPosibles).toContain('issuers/ISS_000003');
    });

    it('un estado de GLEIF fuera del contrato se deja fuera y se dice', () => {
        const rara: SalidaDeEmisores = {
            ...SALIDA,
            emisores: SALIDA.emisores.map((e) => (e.issuer_id === 'ISS_000003' ? { ...e, estado_registro: 'RARO' } : e))
        };
        const salida = mapearEmisores(rara, AHORA, INSTRUMENTOS);
        const aena = salida.documentos.find((d) => d.ruta === 'issuers/ISS_000003')?.documento as {
            identity: Record<string, unknown>;
        };
        expect(aena.identity['lei_registration_status']).toBeUndefined();
        expect(salida.avisos).toEqual(['emisores: ISS_000003 estado de registro desconocido (RARO)']);
    });

    it('una salida de otra version no escribe nada', () => {
        const otra = mapearEmisores({ ...SALIDA, schema_version: 'fondosdb.emisores.v2' }, AHORA, INSTRUMENTOS);
        expect(otra.documentos).toEqual([]);
        expect(otra.avisos).toHaveLength(1);
    });
});
