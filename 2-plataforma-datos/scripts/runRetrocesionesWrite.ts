/**
 * scripts/runRetrocesionesWrite.ts — escribe las retrocesiones en el emulador de la base nueva.
 *
 *   npm run retro:plan -- --fuente data/reoriginacion/<fichero>.ndjson
 *   npm run retro:write -- --fuente data/reoriginacion/<fichero>.ndjson --write --verify
 *
 * Usa las barreras del escritor, igual que `carteras:write`: sin `--write` no escribe, y con él
 * hacen falta la puerta de entorno y el emulador.
 *
 * Se ejecuta UNA vez, al traerlas. Después el dueño del dato es la aplicación, y volver a pasar
 * este script pisaría lo que el administrador haya editado.
 */
import fs from 'node:fs';

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { COLECCION_RETROCESIONES, mapearFila, type FilaDeRetrocesion } from '../src/ingestion/baseNueva/retrocesiones';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';
import { escribir, motivosParaNoEscribir, obtenerDb, planificar, verificar } from '../src/loader/baseNuevaWriter';

function valor(nombre: string): string | undefined {
    const indice = process.argv.indexOf(`--${nombre}`);
    return indice === -1 || indice + 1 >= process.argv.length ? undefined : process.argv[indice + 1];
}

async function main(): Promise<void> {
    const escribirDeVerdad = process.argv.includes('--write');
    const fuente = valor('fuente');
    if (fuente === undefined) throw new Error('falta --fuente: sale de `npm run retro:reoriginar -- --escribe-fichero`.');

    console.log(`proyecto : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador : ${HOST_EMULADOR_BASE_NUEVA}`);
    console.log(`modo     : ${escribirDeVerdad ? 'ESCRIBE' : 'solo plan, no escribe'}`);
    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) throw new Error(`escritura bloqueada: ${motivos.join(' | ')}`);

    const filas = fs
        .readFileSync(fuente, 'utf-8')
        .split('\n')
        .filter((linea) => linea.trim() !== '')
        .map((linea) => JSON.parse(linea) as FilaDeRetrocesion);

    const documentos: DocumentoMapeado[] = [];
    const errores: string[] = [];
    for (const fila of filas) {
        const { documento, error } = mapearFila(fila);
        if (error !== undefined) errores.push(error);
        if (documento !== undefined) documentos.push(documento);
    }
    if (errores.length > 0) throw new Error(`no se escribe nada:\n  ${errores.join('\n  ')}`);

    const db = obtenerDb();
    const universo = new Set((await db.collection('instruments').select().get()).docs.map((d) => d.id));
    const fuera = filas.filter((f) => f.coleccion === COLECCION_RETROCESIONES && !universo.has(f.id)).map((f) => f.id);
    console.log(`\nfilas leidas              : ${filas.length}`);
    console.log(`retrocesiones sin instrumento en la base: ${fuera.length} (se conservan)`);
    if (fuera.length > 0) console.log(`  ${fuera.join(' ')}`);

    const plan = await planificar(db, documentos, 'app', []);
    console.log('\n--- plan ---');
    console.log(`crear      : ${plan.operaciones.filter((o) => o.accion === 'crear').length}`);
    console.log(`reemplazar : ${plan.operaciones.filter((o) => o.accion === 'reemplazar').length}`);
    console.log(`bloqueados : ${plan.bloqueados.length}`);
    for (const b of plan.bloqueados.slice(0, 10)) console.log(`  bloqueado ${b.ruta}: ${b.motivos.join('; ')}`);
    if (plan.bloqueados.length > 0) throw new Error('hay documentos que no validan: no se escribe ninguno.');

    if (!escribirDeVerdad) {
        console.log('\nNADA escrito. Pasa --write para escribir.');
        return;
    }
    const resumen = await escribir(db, plan);
    console.log(`\nescrito: ${resumen.creados} creados, ${resumen.reemplazados} reemplazados, ${resumen.lotes} lotes`);

    if (process.argv.includes('--verify')) {
        const v = await verificar(db, plan, 'app');
        console.log(
            `verificacion: ${v.comprobados} comprobados, ${v.ausentes.length} ausentes, ` +
                `${v.distintos.length} distintos, ${v.invalidos.length} invalidos`
        );
        for (const d of [...v.ausentes, ...v.distintos, ...v.invalidos].slice(0, 10)) console.log(`  revisar: ${d}`);
    }
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
