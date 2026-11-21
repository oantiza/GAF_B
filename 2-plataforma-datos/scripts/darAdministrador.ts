/**
 * scripts/darAdministrador.ts — el claim `admin` de Óscar en el Auth de la nube.
 *
 *   npm run nube:administrador             # dice cómo está. No cambia nada.
 *   npm run nube:administrador -- --escribe
 *
 * Sin ese claim no hay error: las retrocesiones salen sin dato y Sistema queda fuera. Solo actúa sobre
 * el asesor de la base nueva, y conserva los claims que ya tuviera. Con `--escribe` hace falta la
 * misma puerta que la subida a la nube. El claim llega a la sesión al volver a entrar.
 */
import fs from 'node:fs';

import * as admin from 'firebase-admin';

import { ASESOR_DE_LA_BASE_NUEVA } from '../src/config/baseNueva/asesores';
import { PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';

const PUERTA = 'BDB_SUBIDA_A_LA_NUBE';
const FRASE = 'SI_ENTIENDO_QUE_ESCRIBE_EN_LA_NUBE';

async function main(): Promise<void> {
    const ruta = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    if (ruta === undefined || !fs.existsSync(ruta)) throw new Error('falta GOOGLE_APPLICATION_CREDENTIALS con la clave del proyecto.');
    const clave = JSON.parse(fs.readFileSync(ruta, 'utf-8')) as { project_id?: string };
    if (clave.project_id !== PROYECTO_BASE_NUEVA) throw new Error(`la clave es de '${clave.project_id}', no de ${PROYECTO_BASE_NUEVA}.`);
    delete process.env['FIREBASE_AUTH_EMULATOR_HOST'];

    const app = admin.initializeApp({ credential: admin.credential.cert(ruta) }, 'administrador');
    const auth = admin.auth(app);
    const usuario = await auth.getUser(ASESOR_DE_LA_BASE_NUEVA);
    console.log(`proyecto         : ${PROYECTO_BASE_NUEVA}`);
    console.log(`claims           : ${JSON.stringify(usuario.customClaims ?? {})}`);
    console.log(`correo verificado: ${usuario.emailVerified}`);

    if (!process.argv.includes('--escribe')) {
        console.log('\nNADA cambiado. Pasa --escribe, con la puerta, para dar el claim.');
        return;
    }
    if (process.env[PUERTA] !== FRASE) throw new Error(`falta la puerta: ${PUERTA}`);
    await auth.setCustomUserClaims(ASESOR_DE_LA_BASE_NUEVA, { ...(usuario.customClaims ?? {}), admin: true });
    const despues = await auth.getUser(ASESOR_DE_LA_BASE_NUEVA);
    console.log(`\nahora            : ${JSON.stringify(despues.customClaims ?? {})}`);
    console.log('Hay que salir y volver a entrar para que la sesión lo lleve.');
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
