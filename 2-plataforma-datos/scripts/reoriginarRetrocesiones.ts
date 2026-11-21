/**
 * scripts/reoriginarRetrocesiones.ts — saca de la base VIEJA las retrocesiones y sus recibos y
 * los deja en un fichero. SOLO LECTURA, en las dos bases.
 *
 *   npm run retro:reoriginar                    # mira y cuenta
 *   npm run retro:reoriginar -- --escribe-fichero
 *
 * El fichero queda en `data/reoriginacion/`, que no va al repositorio: son márgenes comerciales.
 * Es lo que `retro:write -- --fuente <fichero>` lee, y deja por escrito qué se trajo.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ALLOWED_PROJECT_ID, HOST_EMULADOR_BASE_DE_SIEMPRE } from '../src/config/projectAllowlist';
import {
    CLAVE_MARCA,
    COLECCION_IMPORTACIONES,
    COLECCION_RETROCESIONES,
    type FilaDeRetrocesion
} from '../src/ingestion/baseNueva/retrocesiones';

const BASE = `http://${HOST_EMULADOR_BASE_DE_SIEMPRE}/v1/projects/${ALLOWED_PROJECT_ID}/databases/(default)/documents`;
const CARPETA = path.resolve(__dirname, '..', 'data', 'reoriginacion');

type Crudo = Record<string, unknown>;

/** Desenvuelve un valor de la REST de Firestore, sin perder que una marca de tiempo lo es. */
function val(crudo: Crudo): unknown {
    if ('stringValue' in crudo) return crudo['stringValue'];
    if ('booleanValue' in crudo) return crudo['booleanValue'];
    if ('integerValue' in crudo) return Number(crudo['integerValue']);
    if ('doubleValue' in crudo) return crudo['doubleValue'];
    if ('timestampValue' in crudo) return { [CLAVE_MARCA]: crudo['timestampValue'] };
    if ('nullValue' in crudo) return null;
    if ('mapValue' in crudo) {
        const campos = (crudo['mapValue'] as { fields?: Record<string, Crudo> }).fields ?? {};
        return Object.fromEntries(Object.entries(campos).map(([clave, dentro]) => [clave, val(dentro)]));
    }
    if ('arrayValue' in crudo) {
        return ((crudo['arrayValue'] as { values?: Crudo[] }).values ?? []).map(val);
    }
    throw new Error(`valor de Firestore sin traducir: ${Object.keys(crudo).join(',')}`);
}

/** Toda la colección, de página en página. Con una sola página se quedaría corta sin avisar. */
async function leer(coleccion: string): Promise<FilaDeRetrocesion[]> {
    const filas: FilaDeRetrocesion[] = [];
    let pagina: string | undefined;
    do {
        const consulta = `pageSize=300${pagina === undefined ? '' : `&pageToken=${encodeURIComponent(pagina)}`}`;
        const res = await fetch(`${BASE}/${coleccion}?${consulta}`, { headers: { Authorization: 'Bearer owner' } });
        if (!res.ok) throw new Error(`la base vieja contesto ${res.status} al leer ${coleccion}`);
        const cuerpo = (await res.json()) as {
            documents?: { name: string; fields?: Record<string, Crudo> }[];
            nextPageToken?: string;
        };
        for (const documento of cuerpo.documents ?? []) {
            const datos = Object.fromEntries(
                Object.entries(documento.fields ?? {}).map(([clave, crudo]) => [clave, val(crudo)])
            );
            filas.push({ coleccion, id: documento.name.split('/').pop() ?? '', datos });
        }
        pagina = cuerpo.nextPageToken;
    } while (pagina !== undefined);
    return filas;
}

async function main(): Promise<void> {
    const retrocesiones = await leer(COLECCION_RETROCESIONES);
    const importaciones = await leer(COLECCION_IMPORTACIONES);
    console.log(`retrocesiones : ${retrocesiones.length}`);
    console.log(`importaciones : ${importaciones.length}`);
    if (retrocesiones.length === 0) throw new Error('la base vieja no devuelve retrocesiones: no se escribe un fichero vacio.');

    if (!process.argv.includes('--escribe-fichero')) {
        console.log('\nNADA escrito. Pasa --escribe-fichero para dejarlo en data/reoriginacion/.');
        return;
    }
    fs.mkdirSync(CARPETA, { recursive: true });
    const fecha = new Date().toISOString().slice(0, 10);
    const fichero = path.join(CARPETA, `retrocesiones-${fecha}.ndjson`);
    const lineas = [...retrocesiones, ...importaciones].map((fila) => JSON.stringify(fila));
    fs.writeFileSync(fichero, `${lineas.join('\n')}\n`, 'utf-8');
    console.log(`fichero       : ${fichero}`);
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
