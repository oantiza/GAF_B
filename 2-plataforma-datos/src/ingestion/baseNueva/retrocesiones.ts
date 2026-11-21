/**
 * src/ingestion/baseNueva/retrocesiones.ts — las retrocesiones de la base vieja, en la nueva.
 *
 * Es dato de negocio y no se puede reproducir, así que se conserva entero, también los ISIN que
 * ya no están en el catálogo. Lo único que cambia es el `null` de los campos opcionales, que la
 * base nueva no admite: si falta, falta.
 *
 * Las marcas de tiempo siguen siendo marcas de tiempo, con sus nanosegundos. No es por pulcritud:
 * el deshacer de una importación compara `segundos:nanos` con lo que anotó el recibo, y si se
 * convirtieran en texto, esa comparación diría que todo ha cambiado después.
 */
import * as admin from 'firebase-admin';

import type { DocumentoMapeado } from './mapper';

const TIPO_RETROCESION = 'commercial-retro.v2.schema.json';
const TIPO_IMPORTACION = 'commercial-retro-import.v2.schema.json';

export const COLECCION_RETROCESIONES = 'commercial_retro';
export const COLECCION_IMPORTACIONES = 'commercial_retro_imports';

/** Cómo viaja una marca de tiempo por el fichero intermedio, que es JSON. */
export const CLAVE_MARCA = '__timestamp';

const CAMPOS_DE_FECHA: Record<string, readonly string[]> = {
    [COLECCION_RETROCESIONES]: ['updated_at'],
    [COLECCION_IMPORTACIONES]: ['created_at', 'undone_at']
};

/** La fila del fichero intermedio: de qué colección viene, su id y sus campos. */
export interface FilaDeRetrocesion {
    coleccion: string;
    id: string;
    datos: Record<string, unknown>;
}

export function marcaDeTiempo(iso: string): admin.firestore.Timestamp {
    const encontrado = /^(.*?)(?:\.(\d{1,9}))?Z$/.exec(iso);
    const segundos = encontrado === null ? Number.NaN : Date.parse(`${encontrado[1]}Z`) / 1000;
    if (encontrado === null || !Number.isFinite(segundos)) {
        throw new Error(`marca de tiempo ilegible: ${iso}`);
    }
    const nanos = Number((encontrado[2] ?? '').padEnd(9, '0'));
    return new admin.firestore.Timestamp(segundos, nanos);
}

function fechaDeLaFila(valor: unknown): admin.firestore.Timestamp | undefined {
    if (typeof valor !== 'object' || valor === null) return undefined;
    const iso = (valor as Record<string, unknown>)[CLAVE_MARCA];
    return typeof iso === 'string' ? marcaDeTiempo(iso) : undefined;
}

export function mapearFila(fila: FilaDeRetrocesion): { documento?: DocumentoMapeado; error?: string } {
    const fechas = CAMPOS_DE_FECHA[fila.coleccion];
    if (fechas === undefined) return { error: `${fila.id}: coleccion desconocida ${fila.coleccion}` };

    const documento: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(fila.datos)) {
        if (valor === null || valor === undefined) continue;
        if (!fechas.includes(clave)) {
            documento[clave] = valor;
            continue;
        }
        const fecha = fechaDeLaFila(valor);
        if (fecha === undefined) return { error: `${fila.id}: ${clave} no es una marca de tiempo` };
        documento[clave] = fecha;
    }

    /* Las versiones del recibo son también marcas de tiempo: las que compara el deshacer. */
    const versiones = documento['applied_versions'];
    if (typeof versiones === 'object' && versiones !== null) {
        const salida: Record<string, admin.firestore.Timestamp> = {};
        for (const [isin, valor] of Object.entries(versiones)) {
            const fecha = fechaDeLaFila(valor);
            if (fecha === undefined) return { error: `${fila.id}: la version de ${isin} no es una marca de tiempo` };
            salida[isin] = fecha;
        }
        documento['applied_versions'] = salida;
    }

    return {
        documento: {
            ruta: `${fila.coleccion}/${fila.id}`,
            tipo: fila.coleccion === COLECCION_RETROCESIONES ? TIPO_RETROCESION : TIPO_IMPORTACION,
            documento
        }
    };
}
