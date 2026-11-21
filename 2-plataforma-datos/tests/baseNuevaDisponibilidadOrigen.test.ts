import { describe, it, expect } from 'vitest';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';

/**
 * En qué se apoya la disponibilidad: `availability.basis` y `availability.decision`.
 *
 * Decisión 10 de DECISIONES_DATOS_2026-11-07: un asesor tiene que poder ver que «dejó de
 * cotizar» es una decisión nuestra y no un dato del proveedor. Los tres casos son ISIN reales,
 * con la marca tal como la escribe hoy el extractor en `export_bdb/`:
 *
 * - `ES0114400007` la CAM: baja DECIDIDA (decisión 7), con `origen` y `decision`.
 * - `ES0105046009` Aena, el ISIN viejo: `dejo_de_cotizar` por EVIDENCIA, ISIN sustituido.
 * - `ES0105046017` Aena, el vigente: una acción viva, `cotiza`.
 *
 * Solo se añade: `state`, `since` y `reason` salen igual que antes del 07-11.
 */

const AHORA = '2026-11-07T12:00:00.000Z';

const MOTIVO_CAM =
    'Absorbida por Banco Sabadell en 2012; sin negociación desde 2011: la CNMV suspendió la negociación de sus ' +
    'cuotas participativas el 09-12-2011, antes de la apertura (Público, 10-12-2011). FIRDS la sigue dando admitida ' +
    'en XMAD desde el 23-07-2008 y sin baja reportada; ninguna fuente de precio la tiene';

const CAM = {
    estado: 'dejo_de_cotizar',
    desde: '2011-12-09',
    visto: '2026-11-07',
    detalle: `${MOTIVO_CAM}. Baja decidida, no medida: Óscar, decisión 7 del 07-11-2026.`,
    origen: 'decision',
    decision: {
        desde: '2011-12-09',
        motivo: MOTIVO_CAM,
        autor: 'Óscar, decisión 7 del 07-11-2026',
        fecha_decision: '2026-11-07'
    }
};

const AENA_VIEJO = {
    estado: 'dejo_de_cotizar',
    desde: '2026-11-07',
    visto: '2026-11-07',
    detalle:
        'ISIN sustituido por ES0105046017: el listado que se le conocía es hoy de ese ISIN según EODHD, y FIRDS conoce ese y no este'
};

const AENA_VIVO = { estado: 'cotiza', desde: '2026-11-02', visto: '2026-11-07' };

function accion(isin: string, nombre: string, disponibilidad: Record<string, unknown>): [FichaCanonica, RegistroUniversal] {
    return [
        {
            isin,
            name: nombre,
            currency: 'EUR',
            report_date: '2026-11-06',
            generated_at: '2026-11-07T10:00:00+00:00',
            ms: {},
            classification_v2: { asset_type: 'stock', asset_subtype: 'common_stock' },
            provenance: { version: 1, fields: {} },
            disponibilidad
        },
        {
            _id: isin,
            identificacion: { nombre, tipo: 'accion', tipo_producto: 'accion', isin, mercado: 'MC', pais: 'Spain', divisa_base: 'EUR' },
            meta: { isin, actualizado: '2026-11-07T10:00:00+00:00' }
        }
    ];
}

function mapear(isin: string, disponibilidad: Record<string, unknown>) {
    const resultado = mapearInstrumento(...accion(isin, 'Una acción', disponibilidad), AHORA);
    const raiz = resultado.documentos.find((documento) => /^instruments\/[A-Z0-9]+$/.test(documento.ruta))!;
    return { resultado, raiz, availability: raiz.documento['availability'] as Record<string, unknown> | undefined };
}

describe('availability dice si el estado es dato de la fuente o decision nuestra', () => {
    it('la CAM: una baja decidida es DECISION, con autor, fecha de decision y motivo, y valida', () => {
        const { raiz, availability } = mapear('ES0114400007', CAM);
        expect(availability).toEqual({
            state: 'DELISTED',
            since: '2011-12-09',
            last_checked: '2026-11-07',
            reason: CAM.detalle,
            basis: 'DECISION',
            decision: {
                decided_by: 'Óscar, decisión 7 del 07-11-2026',
                decided_at: '2026-11-07',
                reason: MOTIVO_CAM
            }
        });
        expect(validarEscritura(raiz.tipo, raiz.documento, 'platform')).toEqual({ ok: true, motivos: [] });
    });

    it('Aena 009: el ISIN sustituido es DELISTED por evidencia, sin bloque de decision', () => {
        const { raiz, availability } = mapear('ES0105046009', AENA_VIEJO);
        expect(availability).toEqual({
            state: 'DELISTED',
            since: '2026-11-07',
            last_checked: '2026-11-07',
            reason: AENA_VIEJO.detalle,
            basis: 'SOURCE_EVIDENCE'
        });
        expect(validarEscritura(raiz.tipo, raiz.documento, 'platform').ok).toBe(true);
    });

    it('Aena 017: una accion viva es TRADING por evidencia', () => {
        const { raiz, availability } = mapear('ES0105046017', AENA_VIVO);
        expect(availability).toEqual({
            state: 'TRADING',
            since: '2026-11-02',
            last_checked: '2026-11-07',
            basis: 'SOURCE_EVIDENCE'
        });
        expect(validarEscritura(raiz.tipo, raiz.documento, 'platform').ok).toBe(true);
    });

    it('lo que ya se escribia no cambia: state, since y reason salen igual que sin el campo nuevo', () => {
        for (const [isin, marca] of [['ES0114400007', CAM], ['ES0105046009', AENA_VIEJO], ['ES0105046017', AENA_VIVO]] as const) {
            const { availability } = mapear(isin, marca);
            expect(availability?.['state']).toBe(marca.estado === 'cotiza' ? 'TRADING' : 'DELISTED');
            expect(availability?.['since']).toBe(marca.desde);
            expect(availability?.['last_checked']).toBe(marca.visto);
            expect(availability?.['reason']).toBe('detalle' in marca ? marca.detalle : undefined);
        }
    });

    it('una decision a la que le falta el autor no se escribe a medias ni se rebaja a evidencia', () => {
        const sinAutor = { ...CAM, decision: { ...CAM.decision, autor: '' } };
        const { resultado, availability } = mapear('ES0114400007', sinAutor);
        expect(availability).toBeUndefined();
        expect(resultado.avisos).toContain('disponibilidad dejo_de_cotizar decidida sin decided_by: no se escribe');
    });

    it('un origen que no se sabe traducir es una parada, no una evidencia por defecto', () => {
        const { resultado, availability } = mapear('ES0114400007', { ...CAM, origen: 'lote' });
        expect(availability).toBeUndefined();
        expect(resultado.avisos.some((aviso) => aviso.includes('disponibilidad.origen'))).toBe(true);
    });
});

describe('el contrato ata basis y decision', () => {
    const { raiz } = mapear('ES0114400007', CAM);
    const conAvailability = (availability: Record<string, unknown>) => ({ ...raiz.documento, availability });
    const base = { state: 'DELISTED', since: '2011-12-09', last_checked: '2026-11-07' };
    const decision = { decided_by: 'Óscar, decisión 7 del 07-11-2026', decided_at: '2026-11-07', reason: MOTIVO_CAM };

    it('DECISION sin decision no valida: una decision sin autor ni fecha no se distingue de un dato inventado', () => {
        expect(validarForma(raiz.tipo, conAvailability({ ...base, basis: 'DECISION' })).ok).toBe(false);
    });

    it('decision con SOURCE_EVIDENCE, o sin basis, no valida', () => {
        expect(validarForma(raiz.tipo, conAvailability({ ...base, basis: 'SOURCE_EVIDENCE', decision })).ok).toBe(false);
        expect(validarForma(raiz.tipo, conAvailability({ ...base, decision })).ok).toBe(false);
    });

    it('un documento escrito antes del campo, sin basis, sigue validando', () => {
        expect(validarForma(raiz.tipo, conAvailability(base)).ok).toBe(true);
    });
});
