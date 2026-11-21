/**
 * scripts/runPlanesWrite.ts — escribe el catálogo de planes de pensiones y EPSV en el emulador de
 * la base nueva (decisión D-11).
 *
 *   npm run planes:plan
 *   npm run planes:write -- --write --verify
 *
 * Lee `1-extractor/export_planes/planes.json`, que deja `python main.py planes` (otra ruta, con
 * `--fuente`). Usa las barreras del escritor, igual que el resto: sin `--write` no escribe, y con
 * él hacen falta la puerta de entorno y el emulador. No toca `instruments` ni nada que no sea
 * `pension_plans`.
 *
 * No borra. Un plan que el banco retire de su buscador se queda en la base con su fecha de
 * consulta vieja, y este script lo nombra en cada pasada para que alguien decida.
 */
import fs from 'node:fs';
import path from 'node:path';

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { COLECCION_PLANES, mapearPlanes, type FicheroDePlanes } from '../src/ingestion/baseNueva/planes';
import { escribir, motivosParaNoEscribir, obtenerDb, planificar, verificar } from '../src/loader/baseNuevaWriter';

const RAIZ_EXTRACTOR = process.env['EXTRACTOR_DIR'] ?? path.resolve(__dirname, '..', '..', '1-extractor');
const FUENTE_POR_DEFECTO = path.join(RAIZ_EXTRACTOR, 'export_planes', 'planes.json');

function valor(nombre: string): string | undefined {
    const indice = process.argv.indexOf(`--${nombre}`);
    return indice === -1 || indice + 1 >= process.argv.length ? undefined : process.argv[indice + 1];
}

async function main(): Promise<void> {
    const escribirDeVerdad = process.argv.includes('--write');
    const fuente = valor('fuente') ?? FUENTE_POR_DEFECTO;

    console.log(`proyecto : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador : ${HOST_EMULADOR_BASE_NUEVA}`);
    console.log(`fuente   : ${fuente}`);
    console.log(`modo     : ${escribirDeVerdad ? 'ESCRIBE' : 'solo plan, no escribe'}`);
    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) throw new Error(`escritura bloqueada: ${motivos.join(' | ')}`);
    if (!fs.existsSync(fuente)) throw new Error(`no existe ${fuente}: sale de \`python main.py planes\`, en 1-extractor.`);

    const fichero = JSON.parse(fs.readFileSync(fuente, 'utf-8')) as FicheroDePlanes;
    const mapeado = mapearPlanes(fichero);
    console.log(`\nconsultado en la fuente : ${fichero.fuente?.consultado ?? '(no lo dice)'}`);
    console.log(`productos en el fichero : ${fichero.planes.length}`);
    console.log(
        `entran                  : ${mapeado.cuentas.planes} ` +
            `(${mapeado.cuentas.planes_de_pensiones} planes de pensiones, ${mapeado.cuentas.epsv} EPSV; ` +
            `${mapeado.cuentas.con_serie} con serie)`
    );
    console.log(`cifras apartadas        : ${mapeado.apartadas.length} (el contrato las rechaza por su rango; no se escriben)`);
    for (const a of mapeado.apartadas.slice(0, 20)) console.log(`  apartada ${a.plan} ${a.nombre}: ${a.ruta} = ${a.valor}`);
    if (mapeado.errores.length > 0) {
        throw new Error(`no se escribe nada, hay productos que no se pueden mapear:\n  ${mapeado.errores.join('\n  ')}`);
    }

    const db = obtenerDb();
    const enLaBase = (await db.collection(COLECCION_PLANES).select().get()).docs.map((d) => d.id);
    const deEstaPasada = new Set(fichero.planes.map((plan) => plan.id));
    const yaNoEstan = enLaBase.filter((id) => !deEstaPasada.has(id));
    console.log(`\nen la base hoy          : ${enLaBase.length}`);
    console.log(`en la base y ya no en la fuente: ${yaNoEstan.length} (no se borran)`);
    if (yaNoEstan.length > 0) console.log(`  ${yaNoEstan.join(' ')}`);

    const plan = await planificar(db, mapeado.documentos, 'platform', mapeado.rutasPosibles);
    console.log('\n--- plan ---');
    console.log(`crear      : ${plan.operaciones.filter((o) => o.accion === 'crear').length}`);
    console.log(`reemplazar : ${plan.operaciones.filter((o) => o.accion === 'reemplazar').length}`);
    console.log(`bloqueados : ${plan.bloqueados.length}`);
    console.log(`sobrantes  : ${plan.sobrantes.length} (estan en la base y esta pasada ya no los produce; no se borran)`);
    for (const b of plan.bloqueados.slice(0, 10)) console.log(`  bloqueado ${b.ruta}: ${b.motivos.join('; ')}`);
    for (const s of plan.sobrantes.slice(0, 10)) console.log(`  sobrante  ${s}`);
    if (plan.bloqueados.length > 0) throw new Error('hay documentos que no validan: no se escribe ninguno.');

    if (!escribirDeVerdad) {
        console.log('\nNADA escrito. Pasa --write para escribir.');
        return;
    }
    const resumen = await escribir(db, plan);
    console.log(`\nescrito: ${resumen.creados} creados, ${resumen.reemplazados} reemplazados, ${resumen.lotes} lotes`);

    if (process.argv.includes('--verify')) {
        const v = await verificar(db, plan, 'platform');
        console.log(
            `verificacion: ${v.comprobados} comprobados, ${v.ausentes.length} ausentes, ` +
                `${v.distintos.length} distintos, ${v.invalidos.length} invalidos`
        );
        for (const d of [...v.ausentes, ...v.distintos, ...v.invalidos].slice(0, 10)) console.log(`  revisar: ${d}`);
        if (v.ausentes.length + v.distintos.length + v.invalidos.length > 0) process.exitCode = 1;
    }
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
