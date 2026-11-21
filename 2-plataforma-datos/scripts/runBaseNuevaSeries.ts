/**
 * scripts/runBaseNuevaSeries.ts — carga las series de precios en el emulador de la base nueva.
 *
 *   npm run baseNueva:series                        # planifica y para
 *   npm run baseNueva:series -- --write             # escribe y verifica, con las barreras delante
 *   npm run baseNueva:series -- --ids A,B --write   # solo las series de esos instrumentos
 *
 * Con `--ids` (`soloEstos.ts`) no se cargan los cambios del BCE ni el €STR, que no son de un
 * instrumento, y los sobrantes y el recuento final se miran solo en esos instrumentos.
 *
 * Entrada: `1-extractor/export_series/`, que deja `python main.py series`. Solo entran los
 * instrumentos cuya raíz existe: una serie sin raíz sería un huérfano que la auditoría señala.
 * Tampoco cuadrar el número de años sirve de prueba, así que al final se comparan los puntos
 * leídos de la base con los de la fuente.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
    escribir,
    motivosParaNoEscribir,
    obtenerDb,
    planificar,
    verificar
} from '../src/loader/baseNuevaWriter';
import {
    componerCambios, componerTipoDeReferencia, type TipoExportado,
    componerSerie,
    type CambiosExportados,
    type SerieExportada
} from '../src/ingestion/baseNueva/series';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';
import { describirIds, esDeEstos, idsDeLaOrden } from '../src/ingestion/baseNueva/soloEstos';

const CARPETA = path.join(__dirname, '..', '..', '1-extractor', 'export_series');
const CARPETA_CAMBIOS = path.join(__dirname, '..', '..', '1-extractor', 'export_fx');
const CARPETA_TIPOS = path.join(__dirname, '..', '..', '1-extractor', 'export_rf');

async function main(): Promise<void> {
    const escribirDeVerdad = process.argv.includes('--write');
    const ids = idsDeLaOrden(process.argv);
    console.log(`instrumentos        : ${describirIds(ids)}`);
    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) {
        throw new Error(`escritura bloqueada:\n  - ${motivos.join('\n  - ')}`);
    }
    if (!fs.existsSync(CARPETA)) throw new Error(`no existe ${CARPETA}: ejecuta antes python main.py series`);
    const ficheros = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.json'));
    if (ficheros.length === 0) throw new Error(`${CARPETA} esta vacia`);

    const db = obtenerDb();
    const raices = new Set((await db.collection('instruments').select().get()).docs.map((d) => d.id));

    const documentos: DocumentoMapeado[] = [];
    const puntosDeLaFuente = new Map<string, number>();
    const errores: string[] = [];
    const sinRaiz: string[] = [];
    for (const fichero of ficheros) {
        const serie = JSON.parse(fs.readFileSync(path.join(CARPETA, fichero), 'utf-8')) as SerieExportada;
        if (ids !== undefined && !ids.has(serie.instrument_id)) continue;
        if (!raices.has(serie.instrument_id)) {
            sinRaiz.push(serie.instrument_id);
            continue;
        }
        const r = componerSerie(serie);
        if (r.error !== undefined) {
            errores.push(r.error);
            continue;
        }
        documentos.push(...r.documentos);
        puntosDeLaFuente.set(serie.instrument_id, serie.points.length);
    }

    if (ids !== undefined) {
        const sinFichero = [...ids].filter((id) => !puntosDeLaFuente.has(id) && !sinRaiz.includes(id));
        if (sinFichero.length > 0) errores.push(`sin serie exportada: ${sinFichero.join(', ')}`);
    }
    const monedas: string[] = [];
    if (ids !== undefined) {
        console.log('cambios y ESTR      : no se cargan en una pasada con --ids');
    } else if (fs.existsSync(CARPETA_CAMBIOS)) {
        for (const fichero of fs.readdirSync(CARPETA_CAMBIOS).filter((f) => f.endsWith('.json'))) {
            const cambios = JSON.parse(fs.readFileSync(path.join(CARPETA_CAMBIOS, fichero), 'utf-8')) as CambiosExportados;
            const r = componerCambios(cambios);
            if (r.error !== undefined) errores.push(r.error);
            else {
                documentos.push(...r.documentos);
                monedas.push(`${cambios.currency} ${cambios.points.length}`);
            }
        }
    }
    console.log(`cambios del BCE     : ${monedas.join(', ') || 'ninguno'}`);

    const ficheroEstr = path.join(CARPETA_TIPOS, 'ESTR.json');
    if (ids !== undefined) {
        /* dicho arriba: en una pasada con --ids no entran */
    } else if (fs.existsSync(ficheroEstr)) {
        const tipo = JSON.parse(fs.readFileSync(ficheroEstr, 'utf-8')) as TipoExportado;
        const r = componerTipoDeReferencia(tipo);
        if (r.error !== undefined) errores.push(r.error);
        else documentos.push(...r.documentos);
        console.log(`ESTR del BCE        : ${tipo.points.length} observaciones`);
    } else {
        console.log('ESTR del BCE        : no hay export_rf/ESTR.json; se lanza `python main.py cambios`');
    }

    const guardadas = await db.collectionGroup('price_series').select().get();
    const guardados = ids === undefined ? (await db.collection('fx_rates').select().get()).docs : [];
    const tiposGuardados = ids === undefined ? (await db.collection('reference_rates').select().get()).docs : [];
    const rutasPosibles = new Set([
        ...documentos.map((d) => d.ruta),
        ...guardadas.docs.map((d) => d.ref.path).filter((ruta) => esDeEstos(ruta, ids)),
        ...guardados.map((d) => d.ref.path),
        ...tiposGuardados.map((d) => d.ref.path)
    ]);
    const plan = await planificar(db, documentos, 'platform', [...rutasPosibles]);

    const total = [...puntosDeLaFuente.values()].reduce((a, b) => a + b, 0);
    console.log(`series              : ${puntosDeLaFuente.size} de ${ficheros.length} ficheros`);
    console.log(`observaciones       : ${total}`);
    console.log(`documentos          : ${documentos.length}`);
    console.log(`sin raiz en la base : ${sinRaiz.length} ${sinRaiz.slice(0, 20).join(' ')}`);
    console.log(`rechazadas          : ${errores.length}`);
    for (const e of errores.slice(0, 20)) console.log(`  ${e}`);
    console.log(`plan                : ${plan.operaciones.length} operaciones, ${plan.bloqueados.length} bloqueados, ${plan.sobrantes.length} sobrantes`);
    for (const b of plan.bloqueados.slice(0, 10)) console.log(`  bloqueado ${b.ruta}: ${b.motivos.join('; ')}`);
    for (const s of plan.sobrantes.slice(0, 10)) console.log(`  sobra ${s}`);

    if (!escribirDeVerdad) {
        console.log('\nNADA escrito. Pasa --write para escribir.');
        return;
    }
    if (plan.bloqueados.length > 0 || errores.length > 0) throw new Error('no se escribe con bloqueados o rechazadas');

    const resumen = await escribir(db, plan);
    console.log(`escrito             : ${resumen.creados} creados, ${resumen.reemplazados} reemplazados`);
    const v = await verificar(db, plan, 'platform');
    console.log(`verificacion        : ${v.comprobados} comprobados, ${v.ausentes.length} ausentes, ${v.distintos.length} distintos, ${v.invalidos.length} invalidos`);

    const leidos = new Map<string, number>();
    const releer =
        ids === undefined
            ? (await db.collectionGroup('price_series').get()).docs
            : (
                  await Promise.all(
                      [...puntosDeLaFuente.keys()].map((id) => db.collection(`instruments/${id}/price_series`).get())
                  )
              ).flatMap((q) => q.docs);
    for (const doc of releer) {
        const id = doc.get('instrument_id') as string;
        leidos.set(id, (leidos.get(id) ?? 0) + (doc.get('points') as unknown[]).length);
    }
    const descuadres = [...puntosDeLaFuente].filter(([id, n]) => leidos.get(id) !== n);
    console.log(`puntos releidos     : ${[...leidos.values()].reduce((a, b) => a + b, 0)}, ${descuadres.length} series que no cuadran`);
    const correcto =
        v.ausentes.length + v.distintos.length + v.invalidos.length + descuadres.length === 0;
    console.log(correcto ? 'Las series estan escritas y cuadran con la fuente.' : 'HAY PROBLEMAS: ver arriba.');
    if (!correcto) process.exitCode = 1;
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e: Error) => {
        console.error(`ERROR: ${e.message}`);
        process.exit(1);
    });
