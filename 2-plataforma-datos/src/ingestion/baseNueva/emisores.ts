/**
 * src/ingestion/baseNueva/emisores.ts — los emisores de las acciones, por LEI.
 *
 * Decisión 8 de `DECISIONES_DATOS_2026-11-07.md`: «un LEI, un emisor», aprobada por Óscar el
 * 07-11-2026 para que la apliquen los lotes. El extractor hace la parte que necesita red y
 * memoria —pregunta a GLEIF por cada LEI que FIRDS da a una acción y guarda el id estable de
 * cada LEI en `config/emisores_lei.csv`— y deja el resultado en
 * `export_entidades/emisores.json`. Aquí solo se traduce a dos colecciones:
 *
 * - `issuers/{issuer_id}`: la entidad, una sola vez, con su nombre legal, su país y su estado en
 *   GLEIF. Dueño `platform`, como todo lo declarado por un tercero.
 * - `instrument_issuer/{isin}_EQUITY_ISSUER`: el vínculo. Dueño `human`, y se escribe como
 *   `human` a propósito: es la decisión de Óscar —la regla— aplicada a un ISIN, con su nombre en
 *   `decided_by` y el día que la aprobó en `decided_at`. Lo mismo que hace `computed/metrics`
 *   viajando como `batch`: el dueño es el del dato, no el del proceso que lo transporta.
 *
 * Un vínculo solo sale si su instrumento sale en la misma pasada: un `instrument_issuer` cuyo
 * ISIN no está en `instruments/` sería un huérfano. Y una entidad solo sale si le queda algún
 * vínculo. Lo que se quede fuera se cuenta en `avisos`, nunca en silencio.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { DocumentoMapeado } from './mapper';
import { plegar } from './mapper';

export const TIPO_EMISOR = 'issuer.v2.schema.json';
export const TIPO_VINCULO = 'instrument-issuer.v2.schema.json';
export const ROL_EMISOR_DE_ACCIONES = 'EQUITY_ISSUER';

/** Lo que el contrato admite en `identity.lei_registration_status` y `identity.entity_status`. */
const ESTADOS_DE_REGISTRO = new Set([
    'ISSUED',
    'LAPSED',
    'MERGED',
    'RETIRED',
    'ANNULLED',
    'DUPLICATE',
    'TRANSFERRED',
    'PENDING_TRANSFER',
    'PENDING_ARCHIVAL',
    'PENDING_VALIDATION',
    'CANCELLED'
]);
/** GLEIF escribe `NULL` cuando no sabe el estado: es un centinela y aqui se queda ausente, sin aviso. */
const ESTADOS_DE_ENTIDAD = new Set(['ACTIVE', 'INACTIVE']);

/** Un emisor tal como lo deja el extractor (`fondosdb.emisores.v1`). */
export interface EmisorDelExtractor {
    issuer_id: string;
    lei: string;
    nombre_legal: string;
    pais: string;
    jurisdiccion?: string | null;
    estado_registro?: string | null;
    estado_entidad?: string | null;
    gleif_actualizado?: string | null;
    consultado?: string | null;
    isins: string[];
}

/** Un vínculo tal como lo deja el extractor. */
export interface VinculoDelExtractor {
    isin: string;
    issuer_id: string;
    role: string;
    lei: string;
    valid_from: string;
    reference_listing?: string | null;
    reference_currency?: string | null;
    decided_by: string;
    decided_at: string;
    reason: string;
}

/** `export_entidades/emisores.json`. */
export interface SalidaDeEmisores {
    schema_version: string;
    emisores: EmisorDelExtractor[];
    enlaces: VinculoDelExtractor[];
    sin_lei?: { isin: string; nombre?: string | null; motivo: string }[];
    lei_sin_gleif?: { isin: string; lei: string; nombre?: string | null; motivo: string }[];
    sin_fecha?: { isin: string; lei: string; nombre?: string | null; motivo: string }[];
    cuentas?: Record<string, number>;
}

export interface ResultadoEmisores {
    documentos: DocumentoMapeado[];
    /** Las rutas que esta pasada podría producir: lo que esté en la base y no salga es un sobrante. */
    rutasPosibles: string[];
    avisos: string[];
    emisores: number;
    vinculos: number;
}

const FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const JURISDICCION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

function texto(valor: unknown): string | undefined {
    return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

export function rutaDeEmisor(issuerId: string): string {
    return `issuers/${issuerId}`;
}

export function rutaDeVinculo(isin: string, rol: string = ROL_EMISOR_DE_ACCIONES): string {
    return `instrument_issuer/${isin}_${rol}`;
}

/**
 * Traduce la salida del extractor a documentos de la base nueva.
 *
 * `instrumentos` son los ISIN que esta misma pasada escribe en `instruments/`; un vínculo a otro
 * ISIN no sale. Las rutas posibles de vínculo son las de todos esos instrumentos, para que un
 * vínculo que una pasada deja de producir aparezca como sobrante.
 */
export function mapearEmisores(
    salida: SalidaDeEmisores,
    ahora: string,
    instrumentos: ReadonlySet<string>
): ResultadoEmisores {
    const avisos: string[] = [];
    const documentos: DocumentoMapeado[] = [];

    if (salida.schema_version !== 'fondosdb.emisores.v1') {
        avisos.push(`emisores: version ${String(salida.schema_version)} desconocida; no se escribe nada`);
        return { documentos, rutasPosibles: [], avisos, emisores: 0, vinculos: 0 };
    }

    const conVinculo = new Set<string>();
    const vinculos: DocumentoMapeado[] = [];
    for (const v of salida.enlaces) {
        if (!instrumentos.has(v.isin)) {
            avisos.push(`emisores: ${v.isin} tiene emisor pero no instrumento en esta pasada; sin vinculo`);
            continue;
        }
        const documento: Record<string, unknown> = {
            isin: v.isin,
            issuer_id: v.issuer_id,
            role: v.role,
            valid_from: v.valid_from,
            decided_by: v.decided_by,
            decided_at: v.decided_at,
            reason: v.reason
        };
        const listing = texto(v.reference_listing);
        if (listing !== undefined) documento['reference_listing'] = listing;
        const divisa = texto(v.reference_currency);
        if (divisa !== undefined && /^[A-Z]{3}$/.test(divisa)) documento['reference_currency'] = divisa;
        vinculos.push({ ruta: rutaDeVinculo(v.isin, v.role), tipo: TIPO_VINCULO, documento, comoDueno: 'human' });
        conVinculo.add(v.issuer_id);
    }

    let emisores = 0;
    const rutasDeEmisor: string[] = [];
    for (const e of salida.emisores) {
        rutasDeEmisor.push(rutaDeEmisor(e.issuer_id));
        if (!conVinculo.has(e.issuer_id)) {
            avisos.push(`emisores: ${e.issuer_id} (${e.lei}) sin ningun vinculo en esta pasada; no se escribe`);
            continue;
        }
        const identidad: Record<string, unknown> = {
            legal_name: e.nombre_legal,
            legal_name_folded: plegar(e.nombre_legal),
            country: e.pais,
            lei: e.lei
        };
        const jurisdiccion = texto(e.jurisdiccion);
        if (jurisdiccion !== undefined) {
            if (JURISDICCION.test(jurisdiccion)) identidad['jurisdiction'] = jurisdiccion;
            else avisos.push(`emisores: ${e.issuer_id} jurisdiccion fuera de forma (${jurisdiccion})`);
        }
        const registro = texto(e.estado_registro);
        if (registro !== undefined) {
            if (ESTADOS_DE_REGISTRO.has(registro)) identidad['lei_registration_status'] = registro;
            else avisos.push(`emisores: ${e.issuer_id} estado de registro desconocido (${registro})`);
        }
        const entidad = texto(e.estado_entidad);
        if (entidad !== undefined && entidad !== 'NULL') {
            if (ESTADOS_DE_ENTIDAD.has(entidad)) identidad['entity_status'] = entidad;
            else avisos.push(`emisores: ${e.issuer_id} estado de entidad desconocido (${entidad})`);
        }
        const actualizado = texto(e.gleif_actualizado);
        if (actualizado !== undefined && FECHA.test(actualizado)) identidad['registry_updated_at'] = actualizado;
        const consultado = texto(e.consultado);
        if (consultado !== undefined && FECHA.test(consultado)) identidad['checked_at'] = consultado;

        documentos.push({
            ruta: rutaDeEmisor(e.issuer_id),
            tipo: TIPO_EMISOR,
            documento: {
                issuer_id: e.issuer_id,
                schema_version: 'base-nueva.issuer.v2',
                updated_at: ahora,
                identity: identidad,
                roles: [ROL_EMISOR_DE_ACCIONES]
            }
        });
        emisores += 1;
    }
    documentos.push(...vinculos);

    const rutasPosibles = [...rutasDeEmisor, ...[...instrumentos].map((isin) => rutaDeVinculo(isin))];
    return { documentos, rutasPosibles, avisos, emisores, vinculos: vinculos.length };
}

/** Dónde deja el extractor la salida, relativo a su carpeta. */
export const SALIDA_DEL_EXTRACTOR = path.join('export_entidades', 'emisores.json');

/**
 * Lee `export_entidades/emisores.json`. `undefined` si no existe: sin `python main.py emisores`
 * no hay emisores, y eso se dice en el informe en vez de escribirse nada.
 */
export function leerSalidaDeEmisores(raizExtractor: string): SalidaDeEmisores | undefined {
    const ruta = path.join(raizExtractor, SALIDA_DEL_EXTRACTOR);
    if (!fs.existsSync(ruta)) return undefined;
    return JSON.parse(fs.readFileSync(ruta, 'utf-8')) as SalidaDeEmisores;
}
