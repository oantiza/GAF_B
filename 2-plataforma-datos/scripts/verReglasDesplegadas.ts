/**
 * scripts/verReglasDesplegadas.ts — qué reglas hay DESPLEGADAS en el proyecto de la nube.
 *
 *   npm run nube:reglas
 *
 * SOLO LEE. No despliega nada: `firebase deploy` está denegado en este repositorio a
 * propósito y el despliegue es de Óscar.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * El 03-11-2026 se desplegaron las reglas y el despliegue dijo, con estas palabras, «rules
 * file firestore.rules compiled successfully» y «uploading rules firestore.rules». Parecía
 * hecho. Después falló el paso de los índices, y **la publicación no llegó a ocurrir**: la
 * release activa seguía siendo la del día que se creó el proyecto.
 *
 * O sea: un despliegue que sube las reglas, falla por otra cosa y deja las de antes. Leyendo
 * la salida se diría que están puestas. Por eso esto pregunta por la release ACTIVA, que es
 * lo único que gobierna de verdad, y compara su contenido con el fichero local.
 * ───────────────────────────────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';
import path from 'node:path';

import * as admin from 'firebase-admin';

import { PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';

const PROYECTO_DE_BDB = 'bbdd-activos-financieros';
const CLAVE_POR_DEFECTO =
    'C:\\Users\\oanti\\Documents\\firebase-keys\\bdb-gestor-de-activos-firebase-adminsdk.json';
const REGLAS_LOCALES = path.resolve(__dirname, '..', '..', '4-base-nueva', 'firestore.rules');

/** Lo que las reglas locales prometen, para comprobarlo sobre lo desplegado. */
const PROMESAS: [string, RegExp][] = [
    ['cierra por defecto', /match \/\{documento=\*\*\} \{\s*allow read, write: if false;/],
    ['exige sesion', /function esAsesor\(\)/],
    /* Hallazgo 5 (16-11-2026): la sesion sola no basta, hace falta el correo verificado. Hasta que
       Oscar despliegue, lo desplegado contesta «no» aqui, y es verdad. */
    ['exige correo verificado', /function esAsesor\(\) \{\s*return request\.auth != null && request\.auth\.token\.email_verified == true;/],
    ['grupo de tarjetas (el buscador)', /match \/\{ruta=\*\*\}\/read\/\{tarjeta\}/],
    ['grupo de calidad (la salud)', /match \/\{ruta=\*\*\}\/quality\/\{calidad\}/],
    ['una cartera, solo su asesor', /resource\.data\.advisor_id == request\.auth\.uid/],
    /* Los objetivos se conceden por `advisor_id` -de quien es la cartera- desde el 03-11-2026.
       Esta linea pedia `set_by` -quien puso el peso-, que es el agujero E-3, asi que con la
       regla arreglada esta herramienta habria contestado «no» y se habria leido como una
       regresion: una comprobacion que miente justo despues del arreglo. */
    ['los objetivos, por advisor_id', /match \/\{ruta=\*\*\}\/targets\/\{instrumento\} \{\s*allow read: if esAsesor\(\) && resource\.data\.advisor_id == request\.auth\.uid;/],
    /* Y la de al lado, que es la que importa cuando alguien revierte: si lo desplegado vuelve
       a conceder por `set_by`, esto lo dice en vez de callarse. */
    ['los objetivos NO por set_by', /^(?![\s\S]*resource\.data\.set_by == request\.auth\.uid)[\s\S]*$/]
];

function valor(nombre: string): string | undefined {
    const i = process.argv.indexOf(`--${nombre}`);
    return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
    const rutaDeLaClave = valor('clave') ?? CLAVE_POR_DEFECTO;
    if (!fs.existsSync(rutaDeLaClave)) throw new Error(`no existe la clave: ${rutaDeLaClave}`);
    const clave = JSON.parse(fs.readFileSync(rutaDeLaClave, 'utf-8')) as { project_id?: string };
    if (clave.project_id === PROYECTO_DE_BDB) throw new Error('esa clave es la de BDB.');
    if (clave.project_id !== PROYECTO_BASE_NUEVA) {
        throw new Error(`la clave es de '${clave.project_id}' y se esperaba '${PROYECTO_BASE_NUEVA}'.`);
    }

    delete process.env['FIRESTORE_EMULATOR_HOST'];
    const app = admin.initializeApp(
        { credential: admin.credential.cert(rutaDeLaClave), projectId: PROYECTO_BASE_NUEVA },
        'reglas'
    );
    const credencial = app.options.credential;
    if (credencial === undefined) throw new Error('la app no trae credencial: no se puede pedir un token.');
    const { access_token: token } = await credencial.getAccessToken();

    const pide = async (ruta: string): Promise<Record<string, unknown>> => {
        const res = await fetch(`https://firebaserules.googleapis.com/v1/${ruta}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`${ruta} contesto ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
    };

    console.log('');
    console.log('=== reglas desplegadas en la nube ===');
    console.log(`proyecto: ${PROYECTO_BASE_NUEVA}`);

    const releases = ((await pide(`projects/${PROYECTO_BASE_NUEVA}/releases`))['releases'] ??
        []) as { name: string; rulesetName: string; updateTime: string }[];
    const deFirestore = releases.find((r) => r.name.endsWith('cloud.firestore'));
    if (deFirestore === undefined) {
        console.log('');
        console.log('NO hay reglas publicadas para Firestore.');
        process.exitCode = 1;
        return;
    }
    console.log(`publicada: ${deFirestore.updateTime}`);

    const ruleset = (await pide(deFirestore.rulesetName)) as {
        source?: { files?: { content?: string }[] };
    };
    const desplegadas = (ruleset.source?.files ?? []).map((f) => f.content ?? '').join('\n');
    const locales = fs.readFileSync(REGLAS_LOCALES, 'utf-8');
    const limpia = (t: string): string => t.replace(/\r\n/g, '\n').trim();

    console.log(`tamano   : ${desplegadas.length} bytes desplegados, ${locales.length} en el fichero local`);
    console.log(`iguales  : ${limpia(desplegadas) === limpia(locales) ? 'SI' : 'NO'}`);
    console.log('');
    console.log('lo que lo desplegado cumple:');
    let faltan = 0;
    for (const [que, patron] of PROMESAS) {
        const cumple = patron.test(desplegadas);
        if (!cumple) faltan += 1;
        console.log(`   ${cumple ? 'si ' : 'NO '} ${que}`);
    }

    console.log('');
    if (faltan === 0 && limpia(desplegadas) === limpia(locales)) {
        console.log('La nube tiene las reglas de este repositorio.');
        return;
    }
    console.log('La nube NO tiene estas reglas. Desplegar con:');
    console.log('  firebase deploy --only firestore --project ' + PROYECTO_BASE_NUEVA);
    process.exitCode = 1;
}

void main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
        console.error('');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
