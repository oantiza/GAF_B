/**
 * scripts/reoriginarCarteras.ts — el paso C: saca de la base VIEJA el trabajo del asesor y lo
 * deja en un fichero. SOLO LECTURA, en las dos bases.
 *
 *   npm run carteras:reoriginar            # mira y cuenta
 *   npm run carteras:reoriginar -- --escribe-fichero
 *
 * No toca Firestore para escribir y no necesita la puerta de entorno. Lo que produce es un
 * NDJSON que `carteras:write -- --fuente <fichero>` lee, y un informe al lado que dice, cartera
 * por cartera, si entra y por qué. Que el paso intermedio sea un FICHERO no es una comodidad:
 * es lo que deja por escrito qué se trajo exactamente de la base vieja, que es la pregunta que
 * la tarea F3.4 hace sobre todo lo que hay en la base nueva.
 *
 * Por qué existe, y qué corrige. `PLAN_INDEPENDENCIA_2026-11-01.md` tenía decidido que las 23
 * carteras «nacen de cero: son "Prueba 30" y similares, una de ellas con los pesos al
 * 181,25 %». Medido el 02-11-2026, eso es cierto de 4 y falso de las otras 19: `AAXPE TOTAL`
 * tiene 27 posiciones y 512.661 €, `markel` 1.130.987 €, y hay carteras de cliente con nombre y
 * apellido actualizadas entre el 7 de septiembre y el 21 de octubre. 22 de las 23 tienen los
 * pesos cuadrados al 100 %. Óscar decidió traerlas ese día, con la lista delante.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ALLOWED_PROJECT_ID, HOST_EMULADOR_BASE_DE_SIEMPRE } from '../src/config/projectAllowlist';
import { motivoParaNoReoriginar } from '../src/ingestion/baseNueva/carteras';

/** La colección donde la aplicación guarda el trabajo del asesor, en la base vieja. */
const COLECCION_DEL_ASESOR = 'bdb_activos';

const RAIZ = path.resolve(__dirname, '..');
const CARPETA = path.join(RAIZ, 'data', 'reoriginacion');

const BASE = `http://${HOST_EMULADOR_BASE_DE_SIEMPRE}/v1/projects/${ALLOWED_PROJECT_ID}/databases/(default)/documents`;

interface Posicion {
    asset_id?: string;
    label?: string;
    weight_percent?: number;
}

interface Cartera {
    portfolio_id?: string;
    owner_uid?: string;
    name?: string;
    base_currency?: string;
    source_kind?: string;
    created_at?: string;
    updated_at?: string;
    total_capital?: number;
    positions?: Posicion[];
}

/** Desenvuelve un valor de la REST de Firestore. */
function val(crudo: Record<string, unknown>): unknown {
    if ('stringValue' in crudo) return crudo['stringValue'];
    if ('booleanValue' in crudo) return crudo['booleanValue'];
    if ('integerValue' in crudo) return Number(crudo['integerValue']);
    if ('doubleValue' in crudo) return crudo['doubleValue'];
    if ('timestampValue' in crudo) return crudo['timestampValue'];
    if ('nullValue' in crudo) return undefined;
    if ('mapValue' in crudo) {
        const campos = (crudo['mapValue'] as { fields?: Record<string, Record<string, unknown>> }).fields ?? {};
        const salida: Record<string, unknown> = {};
        for (const [clave, valor] of Object.entries(campos)) salida[clave] = val(valor);
        return salida;
    }
    if ('arrayValue' in crudo) {
        const valores = (crudo['arrayValue'] as { values?: Record<string, unknown>[] }).values ?? [];
        return valores.map(val);
    }
    return undefined;
}

function documentoA(doc: { name: string; fields?: Record<string, Record<string, unknown>> }): Record<string, unknown> {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(doc.fields ?? {})) salida[clave] = val(valor);
    salida['__id'] = doc.name.split('/').pop();
    return salida;
}

async function leer(ruta: string): Promise<{ name: string; fields?: Record<string, Record<string, unknown>> }[]> {
    const res = await fetch(`${BASE}/${ruta}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
    if (!res.ok) throw new Error(`la base vieja contesto ${res.status} a /${ruta}`);
    const cuerpo = (await res.json()) as { documents?: { name: string; fields?: Record<string, Record<string, unknown>> }[] };
    return cuerpo.documents ?? [];
}

async function main(): Promise<void> {
    const escribirFichero = process.argv.includes('--escribe-fichero');

    console.log('');
    console.log('=== paso C: re-originar las carteras del asesor ===');
    console.log(`modo    : ${escribirFichero ? 'ESCRIBE EL FICHERO' : 'solo mira y cuenta'}`);
    console.log(`fuente  : ${ALLOWED_PROJECT_ID} en ${HOST_EMULADOR_BASE_DE_SIEMPRE} (la base de siempre, de solo lectura)`);

    const usuarios = await leer(COLECCION_DEL_ASESOR);
    if (usuarios.length === 0) {
        throw new Error(
            `la coleccion '${COLECCION_DEL_ASESOR}' esta vacia en ${HOST_EMULADOR_BASE_DE_SIEMPRE}.\n` +
                '  Levanta el emulador de la base de siempre y siembralo: /arrancar-entorno.'
        );
    }

    const entran: Cartera[] = [];
    const fuera: { nombre: string; motivo: string; capital: unknown }[] = [];
    let leidas = 0;

    for (const usuario of usuarios) {
        const uid = usuario.name.split('/').pop() ?? '';
        for (const doc of await leer(`${COLECCION_DEL_ASESOR}/${uid}/portfolios`)) {
            leidas += 1;
            const crudo = documentoA(doc);
            const cartera: Cartera = {
                portfolio_id: (crudo['portfolio_id'] as string | undefined) ?? (crudo['__id'] as string),
                owner_uid: (crudo['owner_uid'] as string | undefined) ?? uid,
                name: crudo['name'] as string | undefined,
                base_currency: crudo['base_currency'] as string | undefined,
                source_kind: crudo['source_kind'] as string | undefined,
                created_at: crudo['created_at'] as string | undefined,
                updated_at: crudo['updated_at'] as string | undefined,
                total_capital: crudo['total_capital'] as number | undefined,
                positions: (crudo['positions'] as Posicion[] | undefined) ?? []
            };
            const motivo = motivoParaNoReoriginar(cartera);
            if (motivo === undefined) entran.push(cartera);
            else fuera.push({ nombre: cartera.name ?? '(sin nombre)', motivo, capital: cartera.total_capital });
        }
    }

    console.log('');
    console.log(`carteras leidas : ${leidas}`);
    console.log(`entran          : ${entran.length}`);
    console.log(`se quedan fuera : ${fuera.length}`);
    for (const f of fuera) {
        console.log(`  ${String(f.nombre).padEnd(26)} ${f.motivo}${f.capital === undefined ? '' : ` (capital ${String(f.capital)})`}`);
    }

    console.log('');
    console.log('--- las que entran ---');
    console.log(`${'nombre'.padEnd(26)} ${'pos'.padStart(4)} ${'capital'.padStart(13)}  actualizada`);
    for (const c of [...entran].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        console.log(
            `${String(c.name).padEnd(26)} ${String((c.positions ?? []).length).padStart(4)} ` +
                `${String(c.total_capital ?? '-').padStart(13)}  ${String(c.updated_at ?? '-').slice(0, 10)}`
        );
    }

    const isines = new Set<string>();
    for (const c of entran) for (const p of c.positions ?? []) if (p.asset_id) isines.add(p.asset_id);
    console.log('');
    console.log(`activos distintos referenciados: ${isines.size}`);

    if (!escribirFichero) {
        console.log('');
        console.log('NADA escrito. Pasa --escribe-fichero para dejar el NDJSON y su informe.');
        return;
    }

    fs.mkdirSync(CARPETA, { recursive: true });
    const sello = new Date().toISOString().slice(0, 10);
    const ndjson = path.join(CARPETA, `carteras-${sello}.ndjson`);
    const informe = path.join(CARPETA, `carteras-${sello}.informe.json`);
    fs.writeFileSync(ndjson, `${entran.map((c) => JSON.stringify(c)).join('\n')}\n`, 'utf-8');
    fs.writeFileSync(
        informe,
        `${JSON.stringify(
            {
                reoriginado_el: new Date().toISOString(),
                origen: {
                    base: 'la de siempre, sembrada de una copia verificada de la maestra de BDB',
                    proyecto: ALLOWED_PROJECT_ID,
                    emulador: HOST_EMULADOR_BASE_DE_SIEMPRE,
                    coleccion: COLECCION_DEL_ASESOR
                },
                leidas,
                entran: entran.length,
                fuera,
                activos_referenciados: [...isines].sort(),
                nota: 'Las carteras las creo la aplicacion (source_kind BDB_APP_OWNED): son el trabajo del asesor, no dato de proveedor.'
            },
            null,
            2
        )}\n`,
        'utf-8'
    );
    console.log('');
    console.log(`escrito: ${ndjson}`);
    console.log(`informe: ${informe}`);
}

void main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error('');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
