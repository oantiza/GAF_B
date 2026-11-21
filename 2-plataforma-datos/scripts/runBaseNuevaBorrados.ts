/**
 * scripts/runBaseNuevaBorrados.ts — borra del emulador lo que Óscar ha aprobado borrar, y nada más.
 *
 *   npm run baseNueva:borrar               # dice qué borraría y NO borra
 *   npm run baseNueva:borrar -- --write    # borra, con las barreras del escritor delante
 *
 * La lista está en `src/ingestion/baseNueva/borradosAprobados.ts`, ruta a ruta. Este script no acepta
 * rutas por argumento a propósito: lo que no esté escrito ahí no se borra.
 *
 * El destino lo pone `obtenerDb`, de la constante, y aborta si el entorno pide otro. Para saber si un
 * documento sigue sobrando se vuelve a mapear el canónico de hoy: si ya produce esa ruta, hay un dato que
 * cuadra y se escribe en vez de borrarse.
 *
 * Después de borrar hay que recomponer la calidad y la tarjeta: `baseNueva:batch -- --write`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import {
    BORRADOS_APROBADOS,
    describirPlan,
    ejecutarBorrados,
    planDeBorrados,
    type BaseDeBorrados
} from '../src/ingestion/baseNueva/borradosAprobados';
import { leerSalidaDeEmisores, mapearEmisores } from '../src/ingestion/baseNueva/emisores';
import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { motivosParaNoEscribir, obtenerDb } from '../src/loader/baseNuevaWriter';

const RAIZ_EXTRACTOR = process.env['EXTRACTOR_DIR'] ?? path.resolve(__dirname, '..', '..', '1-extractor');
const CARPETA_FICHAS = path.join(RAIZ_EXTRACTOR, 'export_bdb');
const NDJSON = path.join(RAIZ_EXTRACTOR, 'export', 'fondos.ndjson');

/**
 * Lo que el canónico de hoy produce: las rutas de los instrumentos de la lista, la raíz de todos los demás (para saber
 * que es un catálogo entero, que es lo que exige retirar un instrumento) y los emisores y vínculos de la salida del
 * extractor, porque un emisor retirado se borra solo si el extractor ya no lo trae.
 */
function loQueProduceElCanonico(): Set<string> {
    const instrumentos = new Set(BORRADOS_APROBADOS.map((aprobado) => aprobado.ruta.split('/')[1]));
    const rutas = new Set<string>();
    const conFicha = new Set<string>();
    for (const linea of fs.readFileSync(NDJSON, 'utf-8').split('\n')) {
        if (linea.trim() === '') continue;
        const universal = JSON.parse(linea) as RegistroUniversal;
        const id = String(universal['_id'] ?? '');
        const fichero = path.join(CARPETA_FICHAS, `${id}.json`);
        if (!fs.existsSync(fichero)) continue;
        conFicha.add(id);
        if (!instrumentos.has(id)) {
            rutas.add(`instruments/${id}`);
            continue;
        }
        const ficha = JSON.parse(fs.readFileSync(fichero, 'utf-8')) as FichaCanonica;
        const resultado = mapearInstrumento(ficha, universal, new Date().toISOString());
        for (const documento of resultado.documentos) rutas.add(documento.ruta);
    }
    const salidaEmisores = leerSalidaDeEmisores(RAIZ_EXTRACTOR);
    if (salidaEmisores !== undefined) {
        const emisores = mapearEmisores(salidaEmisores, new Date().toISOString(), conFicha);
        for (const documento of emisores.documentos) rutas.add(documento.ruta);
    }
    return rutas;
}

async function main(): Promise<void> {
    const escribirDeVerdad = process.argv.includes('--write');

    console.log('');
    console.log('=== base nueva: borrados aprobados, en el emulador ===');
    console.log(`modo     : ${escribirDeVerdad ? 'BORRA' : 'solo dice que borraria, no borra'}`);
    console.log(`proyecto : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador : ${HOST_EMULADOR_BASE_NUEVA}`);

    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) {
        console.error('');
        console.error('BORRADO BLOQUEADO. Las barreras que no se abren:');
        for (const motivo of motivos) console.error(`  - ${motivo}`);
        process.exitCode = 1;
        return;
    }

    const db = obtenerDb();
    /* El SDK no dice a dónde ha conectado, así que se comprueba lo que él mismo lee. */
    if (process.env['FIRESTORE_EMULATOR_HOST'] !== HOST_EMULADOR_BASE_NUEVA) {
        throw new Error(`destino inesperado: FIRESTORE_EMULATOR_HOST=${String(process.env['FIRESTORE_EMULATOR_HOST'])}`);
    }

    const base = db as unknown as BaseDeBorrados;
    const plan = await planDeBorrados(base, loQueProduceElCanonico());
    console.log('');
    console.log('--- plan ---');
    for (const linea of describirPlan(plan)) console.log(linea);

    if (!escribirDeVerdad) {
        console.log('');
        console.log('NADA borrado. Pasa --write para borrar.');
        return;
    }

    /* Lo que se va a borrar queda en la salida entero: un borrado no se puede deshacer de otra manera. */
    for (const decision of plan.filter((candidata) => candidata.destino === 'SE_BORRA')) {
        const antes = await db.doc(decision.ruta).get();
        console.log('');
        console.log(`--- contenido de ${decision.ruta}, antes de borrarlo ---`);
        console.log(JSON.stringify(antes.data()));
    }

    const { borrados, siguen } = await ejecutarBorrados(base, plan, true);
    console.log('');
    console.log('--- postverify ---');
    console.log(`borrados: ${borrados.length}`);
    console.log(`siguen  : ${siguen.length}`);
    for (const ruta of borrados) console.log(`  borrado: ${ruta}`);
    for (const ruta of siguen) console.log(`  SIGUE AHI: ${ruta}`);
    console.log('');
    console.log('Falta recomponer la calidad y la tarjeta: npm run baseNueva:batch -- --write');
    if (siguen.length > 0) process.exitCode = 1;
}

void main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
        console.error('');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
