/**
 * scripts/runBaseNuevaWrite.ts — escribe la base nueva en el emulador del clon.
 *
 *   npm run baseNueva:plan             # planifica contra lo guardado y NO escribe
 *   npm run baseNueva:write -- --write # escribe de verdad, con las cinco barreras delante
 *
 * Sin `--write` no escribe nada: planifica, cuenta y para. Con `--write` hacen falta además
 * la puerta de entorno, la allowlist de proyecto y el emulador, y si falta cualquiera de las
 * tres el script aborta diciendo cuál.
 *
 * Opciones: `--limit N` corta en N instrumentos (útil para un piloto), `--verify` vuelve a
 * leer lo escrito y lo compara, y `--ids A,B` limita la pasada a esos instrumentos, en lo que
 * escribe y en lo que busca como sobrante (`soloEstos.ts`). Con `--ids` no se planifican los
 * emisores, que no son de un instrumento.
 *
 * `--solo-cartera-del-emisor` (decisión B-79) limita además lo que se escribe y lo que se busca como sobrante a la cartera
 * completa del emisor: `declared/issuer_holdings` y `issuer_holdings_chunks/*`. Es para traerla sin reescribir nada más de
 * esos instrumentos. Ver `src/ingestion/baseNueva/carteraDelEmisor.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

// Nada de `.env.local`: ese fichero es el destino de la base VIEJA (proyecto y puerto de
// siempre), y desde el 01-11-2026 la base nueva vive en su propio proyecto y su propio
// emulador. El destino lo pone el escritor, de la constante, y si el entorno pide otro se
// para en vez de ignorarlo. Ver `src/config/projectAllowlist.ts`.

import {
    mapearInstrumento,
    rutasPosiblesDe,
    type FichaCanonica,
    type RegistroUniversal
} from '../src/ingestion/baseNueva/mapper';
import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import {
    leerSalidaDeEmisores,
    mapearEmisores,
    SALIDA_DEL_EXTRACTOR,
    TIPO_EMISOR,
    TIPO_VINCULO
} from '../src/ingestion/baseNueva/emisores';

import { entradasDe, leerFicherosDelEmisor, mapearDelEmisor } from '../src/ingestion/baseNueva/emisorDeEtf';
import {
    COLECCION_DE_TROZOS,
    esDeLaCarteraDelEmisor,
    leerCarteraDelEmisor,
    mapearCarteraDelEmisor
} from '../src/ingestion/baseNueva/carteraDelEmisor';
import { mapearMercadoObjetivo } from '../src/ingestion/baseNueva/mercadoObjetivo';
import { escribir, motivosParaNoEscribir, obtenerDb, planificar, verificar } from '../src/loader/baseNuevaWriter';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';
import { describirIds, esDeEstos, idsDeLaOrden } from '../src/ingestion/baseNueva/soloEstos';

const RAIZ_EXTRACTOR = process.env['EXTRACTOR_DIR'] ?? path.resolve(__dirname, '..', '..', '1-extractor');
const CARPETA_FICHAS = path.join(RAIZ_EXTRACTOR, 'export_bdb');
const NDJSON = path.join(RAIZ_EXTRACTOR, 'export', 'fondos.ndjson');

function argumento(nombre: string): string | undefined {
    const indice = process.argv.indexOf(`--${nombre}`);
    if (indice === -1) return undefined;
    return process.argv[indice + 1];
}

function bandera(nombre: string): boolean {
    return process.argv.includes(`--${nombre}`);
}

async function main(): Promise<void> {
    const escribirDeVerdad = bandera('write');
    const verificarDespues = bandera('verify') || escribirDeVerdad;
    const limiteBruto = argumento('limit');
    const limite = limiteBruto === undefined ? Infinity : Number(limiteBruto);
    const ids = idsDeLaOrden(process.argv);
    const soloCarteraDelEmisor = bandera('solo-cartera-del-emisor');
    const ahora = new Date().toISOString();

    console.log('');
    console.log('=== base nueva: escritura en el emulador del clon ===');
    console.log(`modo       : ${escribirDeVerdad ? 'ESCRIBE' : 'solo plan, no escribe'}`);
    console.log(`proyecto   : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador   : ${HOST_EMULADOR_BASE_NUEVA}`);
    if (Number.isFinite(limite)) console.log(`limite     : ${limite} instrumentos`);
    console.log(`instrumentos: ${describirIds(ids)}`);
    if (soloCarteraDelEmisor) console.log('bloques   : solo la cartera del emisor (declared/issuer_holdings y issuer_holdings_chunks)');

    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) {
        console.error('');
        console.error('ESCRITURA BLOQUEADA. Las barreras que no se abren:');
        for (const motivo of motivos) console.error(`  - ${motivo}`);
        process.exitCode = 1;
        return;
    }
    if (!escribirDeVerdad && motivos.length > 0) {
        console.log('');
        console.log('barreras que hoy NO se abririan (y por eso --write abortaria):');
        for (const motivo of motivos) console.log(`  - ${motivo}`);
    }

    /* El canónico son dos salidas y las dos hacen falta. */
    const fichas = new Map<string, FichaCanonica>();
    for (const nombre of fs.readdirSync(CARPETA_FICHAS)) {
        if (!nombre.endsWith('.json')) continue;
        fichas.set(
            nombre.replace(/\.json$/, ''),
            JSON.parse(fs.readFileSync(path.join(CARPETA_FICHAS, nombre), 'utf-8')) as FichaCanonica
        );
    }

    const documentos: DocumentoMapeado[] = [];
    const rutasPosibles: string[] = [];
    /* Lo del emisor (decisiones 51 y 52): la serie va en `export/series.ndjson` y la prima necesita el cierre y el BCE. */
    const ficherosDelEmisor = leerFicherosDelEmisor(RAIZ_EXTRACTOR);
    const delEmisor = { conBloque: 0, conPrima: 0, sinPrima: new Map<string, number>(), avisos: [] as string[] };
    /* El mercado objetivo del EMT (decision 58): viaja en el mismo registro del canonico, en `mercado_objetivo`. */
    const delMercadoObjetivo = { conBloque: 0, conDocumento: 0, avisos: [] as string[] };
    /* La cartera completa del emisor (decisión B-79): uso interno, solo para el asesor, y aparte de `declared/holdings`. */
    const carterasDelEmisor = leerCarteraDelEmisor(RAIZ_EXTRACTOR);
    const delaCartera = { conCartera: 0, queSeMiden: 0, trozos: 0, avisos: [] as string[] };
    let instrumentos = 0;
    let parados = 0;
    const isinsMapeados = new Set<string>();
    const paradosConMotivo: string[] = [];
    for (const linea of fs.readFileSync(NDJSON, 'utf-8').split('\n')) {
        if (linea.trim() === '') continue;
        if (instrumentos >= limite) break;
        const universal = JSON.parse(linea) as RegistroUniversal;
        /*
         * Las ACCIONES entran desde el 01-11-2026. Aquí había un `continue` que las dejaba
         * fuera, y era la única puerta: el mapper ya sabía que `accion` es `STOCK` desde el
         * primer día. Lo que faltaba era el contrato que las aceptara, y es lo que trae F1.
         */
        if (ids !== undefined && !ids.has(String(universal['_id'] ?? '').toUpperCase())) continue;
        const ficha = fichas.get(String(universal['_id'] ?? ''));
        if (ficha === undefined) continue;
        const resultado = mapearInstrumento(ficha, universal, ahora);
        if (resultado.errores.length > 0) {
            parados += 1;
            /* Con su nombre y su motivo. «parados por error: 1» sin decir cual es la clase de
               silencio que esta base persigue: obliga a volver a mapear a mano para saber a
               quien se ha dejado fuera. */
            paradosConMotivo.push(`${String(universal['_id'] ?? '<sin id>')}: ${resultado.errores.join('; ')}`);
            continue;
        }
        instrumentos += 1;
        isinsMapeados.add(resultado.instrument_id);
        documentos.push(...resultado.documentos);
        rutasPosibles.push(...rutasPosiblesDe(resultado.instrument_id));
        if (universal['emisor'] !== undefined) {
            const delBloque = mapearDelEmisor(universal, entradasDe(resultado.instrument_id, ficherosDelEmisor), ahora);
            documentos.push(...delBloque.documentos);
            delEmisor.conBloque += 1;
            delEmisor.avisos.push(...delBloque.avisos);
            for (const d of delBloque.documentos) {
                if (!d.ruta.endsWith('/computed/premium_discount')) continue;
                if (d.documento['status'] === 'PUBLISHED') delEmisor.conPrima += 1;
                else {
                    const motivo = String(d.documento['absence_reason']);
                    delEmisor.sinPrima.set(motivo, (delEmisor.sinPrima.get(motivo) ?? 0) + 1);
                }
            }
        }
        const cartera = mapearCarteraDelEmisor(resultado.instrument_id, carterasDelEmisor.get(resultado.instrument_id) ?? []);
        if (cartera.documentos.length > 0) {
            documentos.push(...cartera.documentos);
            delaCartera.conCartera += 1;
            const resumen = cartera.documentos[0]!.documento;
            if (resumen['usable_for_measurement'] === true) delaCartera.queSeMiden += 1;
            delaCartera.trozos += Number(resumen['chunk_count'] ?? 0);
        }
        delaCartera.avisos.push(...cartera.avisos);
        if (universal['mercado_objetivo'] !== undefined) {
            const mercado = mapearMercadoObjetivo(universal);
            delMercadoObjetivo.conBloque += 1;
            delMercadoObjetivo.avisos.push(...mercado.avisos);
            if (mercado.documento !== null) {
                documentos.push(mercado.documento);
                delMercadoObjetivo.conDocumento += 1;
            }
        }
    }

    console.log('');
    console.log(`instrumentos mapeados : ${instrumentos}`);
    console.log(`parados por error     : ${parados}`);
    for (const parado of paradosConMotivo.slice(0, 20)) console.log(`  ${parado}`);
    console.log(`con bloque del emisor : ${delEmisor.conBloque}; prima publicada en ${delEmisor.conPrima}, sin prima: ${JSON.stringify([...delEmisor.sinPrima])}`);
    for (const aviso of delEmisor.avisos.slice(0, 20)) console.log(`  ${aviso}`);
    console.log(`con mercado objetivo  : ${delMercadoObjetivo.conBloque}; declared/target_market en ${delMercadoObjetivo.conDocumento}`);
    for (const aviso of delMercadoObjetivo.avisos.slice(0, 20)) console.log(`  ${aviso}`);
    console.log(
        `cartera del emisor    : ${delaCartera.conCartera} (B-79, solo asesor); se miden ${delaCartera.queSeMiden}, ${delaCartera.trozos} trozos`
    );
    for (const aviso of delaCartera.avisos.slice(0, 20)) console.log(`  ${aviso}`);

    /* Los emisores de las acciones por LEI (decision 8): una entidad por LEI en `issuers` y el
       vinculo en `instrument_issuer`, este escrito como `human` porque es la regla de Oscar
       aplicada a cada ISIN. Solo los de instrumentos que esta pasada escribe. */
    const salidaEmisores = ids === undefined ? leerSalidaDeEmisores(RAIZ_EXTRACTOR) : undefined;
    if (ids !== undefined) {
        console.log('emisores              : no se planifican en una pasada con --ids');
    } else if (salidaEmisores === undefined) {
        console.log(`emisores              : sin ${SALIDA_DEL_EXTRACTOR}; no se planifica ninguno`);
    } else {
        const emisores = mapearEmisores(salidaEmisores, ahora, isinsMapeados);
        documentos.push(...emisores.documentos);
        rutasPosibles.push(...emisores.rutasPosibles);
        console.log(`emisores (issuers)    : ${emisores.emisores}`);
        console.log(`vinculos EQUITY_ISSUER: ${emisores.vinculos}`);
        for (const aviso of emisores.avisos.slice(0, 10)) console.log(`  ${aviso}`);
    }
    console.log(`documentos a planificar: ${documentos.length}`);

    const db = obtenerDb();

    /*
     * Los trozos de cartera que YA estan en la base. Hacen falta para que un trozo sobrante se
     * vea: si un fondo pasa de 1.200 posiciones a 900, el trozo 002 de la pasada anterior se
     * queda sin que nadie lo produzca, y `rutasPosiblesDe` no lo puede saber porque el numero
     * de trozos depende del fondo y no del contrato.
     *
     * Una sola consulta de grupo de colecciones en vez de un listado por instrumento, que
     * serian 1.078 idas y venidas.
     */
    const trozosGuardados = await db.collectionGroup('holdings_chunks').get();
    for (const trozo of trozosGuardados.docs) if (esDeEstos(trozo.ref.path, ids)) rutasPosibles.push(trozo.ref.path);
    /* Lo mismo con los años del VL del emisor: una serie que empieza mas tarde dejaria un anio sobrante. */
    for (const anio of (await db.collectionGroup('issuer_nav').select().get()).docs) {
        if (esDeEstos(anio.ref.path, ids)) rutasPosibles.push(anio.ref.path);
    }
    /* Y los trozos de la cartera del emisor: una cartera que encoge, o un ETF que pasa a sintético, deja trozos atrás. */
    for (const trozo of (await db.collectionGroup(COLECCION_DE_TROZOS).select().get()).docs) {
        if (esDeEstos(trozo.ref.path, ids)) rutasPosibles.push(trozo.ref.path);
    }
    const aPlanificar = soloCarteraDelEmisor ? documentos.filter((d) => esDeLaCarteraDelEmisor(d.ruta)) : documentos;
    const posibles = soloCarteraDelEmisor ? rutasPosibles.filter(esDeLaCarteraDelEmisor) : rutasPosibles;
    if (soloCarteraDelEmisor) console.log(`documentos de la cartera del emisor: ${aPlanificar.length}`);
    const plan = await planificar(db, aPlanificar, 'platform', posibles);

    const crear = plan.operaciones.filter((operacion) => operacion.accion === 'crear').length;
    const reemplazar = plan.operaciones.length - crear;
    const conConservadas = plan.operaciones.filter((operacion) => operacion.conservadas.length > 0);

    console.log('');
    console.log('--- plan ---');
    console.log(`crear                     : ${crear}`);
    console.log(`reemplazar                : ${reemplazar}`);
    console.log(`con claves ajenas conservadas: ${conConservadas.length}`);
    for (const tipo of [TIPO_EMISOR, TIPO_VINCULO]) {
        const delTipo = plan.operaciones.filter((operacion) => operacion.tipo === tipo);
        const creados = delTipo.filter((operacion) => operacion.accion === 'crear').length;
        console.log(`  ${tipo.replace('.v2.schema.json', '').padEnd(18)}: crear ${creados}, reemplazar ${delTipo.length - creados}`);
    }
    console.log(`bloqueados                : ${plan.bloqueados.length}`);
    for (const bloqueado of plan.bloqueados.slice(0, 20)) {
        console.log(`  ${bloqueado.ruta}: ${bloqueado.motivos.join('; ')}`);
    }
    console.log(`SOBRANTES de una pasada anterior: ${plan.sobrantes.length}`);
    if (plan.sobrantes.length > 0) {
        console.log('  Estan en la base, su instrumento se vuelve a escribir y esta pasada ya NO los produce.');
        console.log('  Este escritor no borra nada: los nombra y decide alguien. Un bloque que se queda');
        console.log('  atras parece vigente y no lo es. Lo que Oscar aprueba borrar va en npm run baseNueva:borrar.');
        for (const ruta of plan.sobrantes.slice(0, 15)) console.log(`  sobrante: ${ruta}`);
        if (plan.sobrantes.length > 15) console.log(`  ... y ${plan.sobrantes.length - 15} mas`);
    }

    if (!escribirDeVerdad) {
        console.log('');
        console.log('NADA escrito. Pasa --write para escribir.');
        if (verificarDespues) {
            const resultado = await verificar(db, plan, 'platform');
            console.log('');
            console.log('--- verificacion de lo que YA habia ---');
            console.log(`comprobados: ${resultado.comprobados}`);
            console.log(`ausentes   : ${resultado.ausentes.length}`);
            console.log(`distintos  : ${resultado.distintos.length}`);
            console.log(`invalidos  : ${resultado.invalidos.length}`);
        }
        return;
    }

    const resumen = await escribir(db, plan);
    console.log('');
    console.log('--- escrito ---');
    console.log(`creados      : ${resumen.creados}`);
    console.log(`reemplazados : ${resumen.reemplazados}`);
    console.log(`lotes        : ${resumen.lotes}`);

    const resultado = await verificar(db, plan, 'platform');
    console.log('');
    console.log('--- postverify: vuelto a leer de la base ---');
    console.log(`comprobados: ${resultado.comprobados}`);
    console.log(`ausentes   : ${resultado.ausentes.length}`);
    console.log(`distintos  : ${resultado.distintos.length}`);
    console.log(`invalidos  : ${resultado.invalidos.length}`);
    for (const ruta of resultado.ausentes.slice(0, 10)) console.log(`  ausente : ${ruta}`);
    for (const ruta of resultado.distintos.slice(0, 10)) console.log(`  distinto: ${ruta}`);
    for (const motivo of resultado.invalidos.slice(0, 10)) console.log(`  invalido: ${motivo}`);

    const todoBien =
        resultado.ausentes.length === 0 && resultado.distintos.length === 0 && resultado.invalidos.length === 0;
    console.log('');
    console.log(todoBien ? 'La base nueva esta escrita y verificada en el emulador.' : 'HAY DIFERENCIAS: ver arriba.');
    if (!todoBien) process.exitCode = 1;
}

void main().catch((error: unknown) => {
    console.error('');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
