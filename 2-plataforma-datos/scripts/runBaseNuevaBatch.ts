/**
 * scripts/runBaseNuevaBatch.ts — el LOTE: calcula `quality/latest` y `read/card` de lo que ya
 * está escrito, y los escribe como `batch`.
 *
 *   npm run baseNueva:batch                  # calcula y NO escribe
 *   npm run baseNueva:batch -- --write       # escribe, con las cinco barreras delante
 *
 * Lee la base, no el canónico: estos dos documentos se derivan de lo que la plataforma ya
 * dejó escrito, y por eso son del lote y no del escritor de plataforma. La puerta de dueño
 * lo sostiene: con `platform` estos dos documentos no pasan.
 *
 * `--ids A,B` lo limita a esos instrumentos (`soloEstos.ts`). Entonces NO se recompone el índice
 * de búsqueda: se compone del catálogo entero, y con una parte saldría un índice de esa parte.
 * Sus entradas salen de la identidad de la raíz, así que una pasada que solo cambia series y
 * métricas no lo deja atrás. Para dar de ALTA unos pocos, `--ids A,B --con-indice` recompone además el
 * índice, de todas las raíces de la base: un instrumento nuevo no se encuentra hasta que entra en él.
 */

// Nada de `.env.local`: ese fichero es el destino de la base VIEJA (proyecto y puerto de
// siempre), y desde el 01-11-2026 la base nueva vive en su propio proyecto y su propio
// emulador. El destino lo pone el escritor, de la constante, y si el entorno pide otro se
// para en vez de ignorarlo. Ver `src/config/projectAllowlist.ts`.

import * as fs from 'fs';
import * as path from 'path';

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { BLOQUES_DE_INSTRUMENTO } from '../src/ingestion/baseNueva/mapper';
import { calcularCalidad, componerTarjeta, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import { ENTRADAS_POR_FRAGMENTO, componerIndice } from '../src/ingestion/baseNueva/indiceDeBusqueda';
import { escribir, motivosParaNoEscribir, obtenerDb, planificar, verificar } from '../src/loader/baseNuevaWriter';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';
import { describirIds, idsDeLaOrden, recomponeElIndice } from '../src/ingestion/baseNueva/soloEstos';

const RUTA_DE_LAS_POLITICAS = path.resolve(__dirname, '..', '..', '3-BDB-ACTIVOS_app', 'functions_python', 'fund_history_policies.json');

function bandera(nombre: string): boolean {
    return process.argv.includes(`--${nombre}`);
}

function sumar(contador: Record<string, number>, clave: string): void {
    contador[clave] = (contador[clave] ?? 0) + 1;
}

function ordenado(contador: Record<string, number>): [string, number][] {
    return Object.entries(contador).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    return ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))] ?? 0;
}

async function main(): Promise<void> {
    const escribirDeVerdad = bandera('write');
    const ids = idsDeLaOrden(process.argv);
    const conIndice = recomponeElIndice(process.argv, ids);
    const ahora = new Date().toISOString();

    console.log('');
    console.log('=== base nueva: el lote (quality/latest, read/card y search_shards) ===');
    console.log(`modo     : ${escribirDeVerdad ? 'ESCRIBE' : 'solo calcula, no escribe'}`);
    console.log(`proyecto : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador : ${HOST_EMULADOR_BASE_NUEVA}`);
    console.log(`instrumentos: ${describirIds(ids)}`);

    const motivos = motivosParaNoEscribir();
    if (escribirDeVerdad && motivos.length > 0) {
        console.error('');
        console.error('ESCRITURA BLOQUEADA:');
        for (const motivo of motivos) console.error(`  - ${motivo}`);
        process.exitCode = 1;
        return;
    }

    const db = obtenerDb();
    const todas = await db.collection('instruments').get();
    const delaPasada = todas.docs.filter((raiz) => ids === undefined || ids.has(raiz.id));
    const raices = { docs: delaPasada, size: delaPasada.length };
    console.log('');
    console.log(`instrumentos en la base: ${todas.size}; en esta pasada: ${raices.size}`);
    const faltan = ids === undefined ? [] : [...ids].filter((id) => !todas.docs.some((raiz) => raiz.id === id));
    if (faltan.length > 0) throw new Error(`--ids con instrumentos que no estan en la base: ${faltan.join(', ')}`);
    if (raices.size === 0) {
        console.log('La base nueva esta vacia: pasa primero `npm run baseNueva:write -- --write`.');
        return;
    }

    /* Lee los once bloques de cada instrumento en tandas, para no hacer una lectura por
       documento: son 769 x 11, y de uno en uno serian 8.459 lecturas. */
    /* `computed/metrics` decide dos cosas: la aptitud METRICAS_PROPIAS y, desde el 01-11-2026,
       de quien es la cifra del titular de la tarjeta. Existe para 642 de los 772. */
    const sufijos = [...Object.keys(BLOQUES_DE_INSTRUMENTO), 'computed/metrics'];
    /* Desde cuándo vale la serie de cada fondo (decisión 112). La lista es de Functions, que la aplica a la lectura del activo: una sola
       lista para que digan lo mismo. Si no está, se para: sin ella, la tarjeta volvería a enseñar lo que el interno no enseña. */
    const politicas = (
        JSON.parse(fs.readFileSync(RUTA_DE_LAS_POLITICAS, 'utf-8')) as { assets: Record<string, { usable_from?: string }> }
    ).assets;
    const instrumentos: InstrumentoLeido[] = [];
    const TANDA = 20;
    for (let i = 0; i < raices.docs.length; i += TANDA) {
        const trozo = raices.docs.slice(i, i + TANDA);
        const refs = trozo.flatMap((raiz) => sufijos.map((sufijo) => db.doc(`instruments/${raiz.id}/${sufijo}`)));
        const snaps = await db.getAll(...refs);
        for (let j = 0; j < trozo.length; j += 1) {
            const raiz = trozo[j]!;
            const bloques: Partial<Record<string, Record<string, unknown> | undefined>> = {};
            let calculadas: Record<string, unknown> | undefined;
            for (let k = 0; k < sufijos.length; k += 1) {
                const snap = snaps[j * sufijos.length + k];
                const sufijo = sufijos[k]!;
                const datos = snap?.exists === true ? (snap.data() as Record<string, unknown>) : undefined;
                if (sufijo === 'computed/metrics') calculadas = datos;
                else bloques[sufijo] = datos;
            }
            instrumentos.push({
                instrument_id: raiz.id,
                raiz: raiz.data() as Record<string, unknown>,
                bloques,
                calculadas,
                serieValidaDesde: politicas[raiz.id]?.usable_from
            });
        }
    }

    const documentos: DocumentoMapeado[] = [];
    const rutasPosibles: string[] = [];
    const aptos: Record<string, number> = {};
    const porAviso: Record<string, number> = {};
    const coberturas: number[] = [];
    const tamanosDeTarjeta: number[] = [];
    let indecidiblesTotal = 0;
    let sinTarjeta = 0;

    for (const instrumento of instrumentos) {
        const calidad = calcularCalidad(instrumento, ahora);
        coberturas.push(calidad.cobertura);
        indecidiblesTotal += calidad.indecidibles;
        for (const [aptitud, veredicto] of Object.entries(
            calidad.documento['fitness'] as Record<string, { apt: boolean }>
        )) {
            if (veredicto.apt) sumar(aptos, aptitud);
        }
        for (const aviso of (calidad.documento['warnings'] as { code: string }[] | undefined) ?? []) {
            sumar(porAviso, aviso.code);
        }

        documentos.push({
            ruta: `instruments/${instrumento.instrument_id}/quality/latest`,
            tipo: 'instrument-quality.v2.schema.json',
            documento: calidad.documento
        });

        const tarjeta = componerTarjeta(instrumento, calidad, ahora);
        if (tarjeta === undefined) {
            sinTarjeta += 1;
        } else {
            documentos.push({
                ruta: `instruments/${instrumento.instrument_id}/read/card`,
                tipo: 'instrument-read-card.v2.schema.json',
                documento: tarjeta
            });
            tamanosDeTarjeta.push(Buffer.byteLength(JSON.stringify(tarjeta), 'utf-8'));
        }

        rutasPosibles.push(
            `instruments/${instrumento.instrument_id}/quality/latest`,
            `instruments/${instrumento.instrument_id}/read/card`
        );
    }

    console.log('');
    console.log('--- PARA QUE SIRVE cada instrumento, uso por uso ---');
    console.log(`de ${instrumentos.length} instrumentos, aptos para:`);
    for (const aptitud of ['COMPARAR_COSTE', 'RADIOGRAFIA_DE_CARTERA', 'COMPARAR_RENTABILIDAD', 'MOSTRAR_ALPHA', 'METRICAS_PROPIAS']) {
        const cuantos = aptos[aptitud] ?? 0;
        const porcentaje = instrumentos.length === 0 ? 0 : (cuantos / instrumentos.length) * 100;
        console.log(`${String(cuantos).padStart(5)}  ${aptitud.padEnd(24)} ${porcentaje.toFixed(1)} %`);
    }

    console.log('');
    console.log('--- cobertura: cuanto de lo DECLARADO tenemos (no sirve para ordenar) ---');
    console.log(
        `mediana ${(percentil(coberturas, 50) * 100).toFixed(1)} %` +
            `  p10 ${(percentil(coberturas, 10) * 100).toFixed(1)} %` +
            `  p90 ${(percentil(coberturas, 90) * 100).toFixed(1)} %`
    );
    console.log(`rutas que no se pudieron decidir (falta el dato del predicado): ${indecidiblesTotal}`);

    console.log('');
    console.log('--- avisos, por codigo ---');
    for (const [codigo, cuantos] of ordenado(porAviso)) console.log(`${String(cuantos).padStart(5)}  ${codigo}`);

    console.log('');
    console.log('--- la tarjeta de lectura ---');
    console.log(`tarjetas compuestas : ${tamanosDeTarjeta.length}`);
    console.log(`sin tarjeta         : ${sinTarjeta}`);
    console.log(
        `tamano  mediana ${percentil(tamanosDeTarjeta, 50)} B` +
            `  p90 ${percentil(tamanosDeTarjeta, 90)} B` +
            `  max ${Math.max(0, ...tamanosDeTarjeta)} B`
    );
    const totalMb = tamanosDeTarjeta.reduce((a, b) => a + b, 0) / 1024 / 1024;
    console.log(`total de las tarjetas: ${totalMb.toFixed(2)} MB`);

    /* El índice de búsqueda. Va en esta pasada y no en una propia porque su dueño es `batch`
       y porque se compone de lo que ya está leído: la raíz de cada instrumento. */
    /* Con `--ids --con-indice`, el índice sale de todas las raíces de la base y no de las de la pasada: sus entradas son
       solo de la raíz (`entradaDe`), así que no hacen falta los bloques de los demás. */
    const paraElIndice: InstrumentoLeido[] =
        ids === undefined
            ? instrumentos
            : todas.docs.map((raiz) => ({ instrument_id: raiz.id, raiz: raiz.data() as Record<string, unknown>, bloques: {} }));
    const indice = conIndice
            ? componerIndice(paraElIndice, ahora)
            : { documentos: [] as DocumentoMapeado[], rutas: [] as string[], entradas: 0, plegadosAlVuelo: 0, sinNombre: [] as string[] };
    documentos.push(...indice.documentos);
    /* Para que un fragmento sobrante se vea. Si el universo se encoge -hoy ha pasado: CEVASA
       salió del alcance y la base bajó de 1.077 a 1.076-, el último fragmento de la pasada
       anterior se queda en la base sin que nadie lo produzca. Las rutas posibles son las que
       esta pasada produce MÁS las que ya hay, leídas de la colección; sin las segundas, un
       sobrante no aparece en ningún sitio. */
    const fragmentosGuardados = conIndice ? await db.collection('search_shards').listDocuments() : [];
    rutasPosibles.push(...new Set([...indice.rutas, ...fragmentosGuardados.map((ref) => ref.path)]));
    if (!conIndice) console.log('indice de busqueda   : no se recompone en una pasada con --ids');
    else if (ids !== undefined) console.log(`indice de busqueda   : se recompone con --con-indice, de las ${todas.size} raices`);

    const bytesDelIndice = indice.documentos.reduce(
        (total, documento) => total + Buffer.byteLength(JSON.stringify(documento.documento), 'utf-8'),
        0
    );
    console.log('');
    console.log('--- el indice de busqueda ---');
    console.log(`entradas            : ${indice.entradas} de ${paraElIndice.length} instrumentos`);
    console.log(`fragmentos          : ${indice.documentos.length}, de ${ENTRADAS_POR_FRAGMENTO} entradas como maximo`);
    console.log(`tamano total        : ${(bytesDelIndice / 1024).toFixed(0)} KB`);
    console.log(`plegados al vuelo   : ${indice.plegadosAlVuelo} (tiene que ser 0)`);
    console.log(`sin nombre buscable : ${indice.sinNombre.length} (tiene que ser 0)`);
    for (const huerfano of indice.sinNombre.slice(0, 10)) console.log(`  no se puede buscar: ${huerfano}`);

    const plan = await planificar(db, documentos, 'batch', rutasPosibles);
    const crear = plan.operaciones.filter((operacion) => operacion.accion === 'crear').length;
    console.log('');
    console.log('--- plan ---');
    console.log(`crear      : ${crear}`);
    console.log(`reemplazar : ${plan.operaciones.length - crear}`);
    console.log(`bloqueados : ${plan.bloqueados.length}`);
    for (const bloqueado of plan.bloqueados.slice(0, 15)) {
        console.log(`  ${bloqueado.ruta}: ${bloqueado.motivos.join('; ')}`);
    }
    console.log(`sobrantes  : ${plan.sobrantes.length}`);

    if (!escribirDeVerdad) {
        console.log('');
        console.log('NADA escrito. Pasa --write para escribir.');
        return;
    }

    const resumen = await escribir(db, plan);
    console.log('');
    console.log(`escrito: ${resumen.creados} creados, ${resumen.reemplazados} reemplazados, ${resumen.lotes} lotes`);

    const resultado = await verificar(db, plan, 'batch');
    console.log('');
    console.log('--- postverify ---');
    console.log(`comprobados: ${resultado.comprobados}`);
    console.log(`ausentes   : ${resultado.ausentes.length}`);
    console.log(`distintos  : ${resultado.distintos.length}`);
    console.log(`invalidos  : ${resultado.invalidos.length}`);
    for (const motivo of resultado.invalidos.slice(0, 10)) console.log(`  invalido: ${motivo}`);

    const todoBien =
        resultado.ausentes.length === 0 && resultado.distintos.length === 0 && resultado.invalidos.length === 0;
    console.log('');
    console.log(todoBien ? 'Calidad, tarjetas e indice escritos y verificados.' : 'HAY DIFERENCIAS: ver arriba.');
    if (!todoBien) process.exitCode = 1;
}

void main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
        console.error('');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
