/**
 * scripts/runCarterasWrite.ts — escribe el trabajo guardado del asesor en la base nueva.
 *
 *   npm run carteras:plan              # planifica, cuenta y para
 *   npm run carteras:write -- --write  # escribe, con las cinco barreras delante
 *
 * Sin `--write` no escribe nada. Con `--write` hacen falta además la puerta de entorno y el
 * emulador, igual que en `baseNueva:write`: este script no tiene barreras propias, usa las
 * del escritor, que es justo lo que hay que hacer para que no existan dos juegos de
 * barreras que se puedan desincronizar.
 *
 * LOS SOBRANTES, que es la parte que importa aquí. Una cartera se guarda SUSTITUYENDO: el
 * asesor quita una posición y la cartera se graba otra vez sin ella. Si el plan solo mirara
 * lo que la fuente trae hoy, el objetivo de la posición retirada se quedaría en la base para
 * siempre, y la cartera leída tendría una posición que el asesor ya borró. Así que las rutas
 * posibles se construyen con la UNIÓN de lo que trae la fuente y lo que ya hay en la base,
 * leyendo la subcolección de cada cartera. Sin esa lectura la detección de sobrantes es
 * decorativa.
 */

// Nada de `.env.local`: ese fichero es el destino de la base VIEJA (proyecto y puerto de
// siempre), y desde el 01-11-2026 la base nueva vive en su propio proyecto y su propio
// emulador. El destino lo pone el escritor, de la constante, y si el entorno pide otro se
// para en vez de ignorarlo. Ver `src/config/projectAllowlist.ts`.

import fs from 'node:fs';

import {
    mapearCartera,
    rutasPosiblesDeCartera,
    type CarteraDelAsesor
} from '../src/ingestion/baseNueva/carteras';
import {
    escribir,
    motivosParaNoEscribir,
    obtenerDb,
    planificar,
    verificar,
    type PlanDeEscritura
} from '../src/loader/baseNuevaWriter';
import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import type { DocumentoMapeado } from '../src/ingestion/baseNueva/mapper';

/** La colección donde la aplicación guarda el trabajo del asesor. */
const COLECCION_DEL_ASESOR = 'bdb_activos';

function bandera(nombre: string): boolean {
    return process.argv.includes(`--${nombre}`);
}

function valor(nombre: string): string | undefined {
    const indice = process.argv.indexOf(`--${nombre}`);
    if (indice === -1 || indice + 1 >= process.argv.length) return undefined;
    return process.argv[indice + 1];
}

async function main(): Promise<void> {
    const escribirDeVerdad = bandera('write');
    const limite = Number(valor('limit') ?? '0');

    console.log('\n=== carteras del asesor: escritura en el emulador del clon ===');
    console.log(`modo       : ${escribirDeVerdad ? 'ESCRIBE' : 'solo plan, no escribe'}`);
    console.log(`proyecto   : ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador   : ${HOST_EMULADOR_BASE_NUEVA}`);

    const motivos = motivosParaNoEscribir();
    if (motivos.length > 0) {
        console.log('\nbarreras que hoy NO se abririan (y por eso --write abortaria):');
        for (const m of motivos) console.log(`  - ${m}`);
        if (escribirDeVerdad) throw new Error('escritura bloqueada por las barreras de arriba');
    }

    const db = obtenerDb();

    const documentos: DocumentoMapeado[] = [];
    const rutasPosibles = new Set<string>();
    const avisos = new Map<string, number>();
    const perdidas = new Map<string, number>();
    const errores: string[] = [];
    let carteras = 0;

    /*
     * De donde sale el trabajo del asesor. Hay dos fuentes y no es una comodidad.
     *
     * `--fuente <fichero>` es el paso C hecho: el NDJSON que dejaba `carteras:reoriginar` (borrado el 20-11-2026 por
     * decisión de Óscar, ya usado; sigue en la historia de Git), leido de la base vieja y con su
     * informe al lado diciendo qué entró, qué no y por qué. Que el
     * paso intermedio sea un fichero es lo que deja por escrito qué se trajo exactamente, que
     * es la pregunta que la tarea F3.4 hace sobre todo lo que hay en la base nueva.
     *
     * Sin `--fuente` se lee `bdb_activos` de la base nueva, que es donde la aplicación la
     * escribirá cuando lea de aquí. Hoy está vacía, y eso tiene que gritar y no seguir: sin la
     * parada, el script leería cero usuarios, planificaría cero carteras y terminaría diciendo
     * que todo fue bien. Es el defecto de los cinco del 01-11, una pasada perfectamente válida
     * que afirma algo que no es.
     */
    const fuente = valor('fuente');
    const crudas: { id: string; cartera: CarteraDelAsesor }[] = [];
    if (fuente !== undefined) {
        const texto = fs.readFileSync(fuente, 'utf-8');
        for (const linea of texto.split('\n')) {
            if (linea.trim() === '') continue;
            const cartera = JSON.parse(linea) as CarteraDelAsesor;
            crudas.push({ id: String(cartera.portfolio_id ?? ''), cartera });
        }
        console.log(`fuente     : ${fuente} (${crudas.length} carteras re-originadas)`);
    } else {
        const usuarios = await db.collection(COLECCION_DEL_ASESOR).get();
        if (usuarios.empty) {
            throw new Error(
                `la coleccion fuente '${COLECCION_DEL_ASESOR}' esta vacia en ${PROYECTO_BASE_NUEVA}.\n` +
                    '  Vive en la base vieja (la copia restaurada de la maestra de BDB), no aqui.\n' +
                    '  Se trajo una vez con `carteras:reoriginar` (borrado el 20-11-2026; en la historia de Git):\n' +
                    '  este mismo script con `--fuente data/reoriginacion/<fichero>.ndjson` vuelve a leer ese fichero.\n' +
                    '  Este script no puede dar una pasada en vacio por buena.'
            );
        }
        for (const u of usuarios.docs) {
            for (const c of (await u.ref.collection('portfolios').get()).docs) {
                crudas.push({ id: c.id, cartera: c.data() as CarteraDelAsesor });
            }
        }
    }

    {
        for (const { id: idDelDoc, cartera: cruda } of crudas) {
            if (limite > 0 && carteras >= limite) break;
            carteras += 1;
            const c = { id: idDelDoc };
            const r = mapearCartera(cruda);
            for (const e of r.errores) errores.push(`${c.id}: ${e}`);
            for (const a of r.avisos) avisos.set(a, (avisos.get(a) ?? 0) + 1);
            for (const p of r.perdidas) perdidas.set(p, (perdidas.get(p) ?? 0) + 1);
            documentos.push(...r.documentos);

            /* Las rutas posibles son la unión de lo que trae la fuente y lo que YA está en la
               base, que es lo que permite ver un objetivo huérfano de una posición que el
               asesor retiró. La unión la hace `rutasPosiblesDeCartera`, donde se puede probar. */
            const id = String(cruda.portfolio_id ?? c.id);
            const deLaFuente = r.documentos
                .map((d) => d.ruta.split('/targets/')[1])
                .filter((x): x is string => x !== undefined);
            const guardados = await db.collection(`portfolios/${id}/targets`).get();
            for (const ruta of rutasPosiblesDeCartera(id, deLaFuente, guardados.docs.map((g) => g.id))) {
                rutasPosibles.add(ruta);
            }
        }
    }

    console.log(`\ncarteras leidas       : ${carteras}`);
    console.log(`documentos a planificar: ${documentos.length}`);
    if (errores.length > 0) {
        console.log(`\n--- carteras que NO se escriben (${errores.length}) ---`);
        for (const e of errores.slice(0, 10)) console.log(`  ${e}`);
    }

    const plan: PlanDeEscritura = await planificar(db, documentos, 'app', [...rutasPosibles]);

    console.log('\n--- plan ---');
    console.log(`crear                     : ${plan.operaciones.filter((o) => o.accion === 'crear').length}`);
    console.log(`reemplazar                : ${plan.operaciones.filter((o) => o.accion === 'reemplazar').length}`);
    console.log(`bloqueados                : ${plan.bloqueados.length}`);
    console.log(`SOBRANTES de una pasada anterior: ${plan.sobrantes.length}`);
    for (const s of plan.sobrantes.slice(0, 10)) console.log(`  sobra: ${s}`);
    for (const b of plan.bloqueados.slice(0, 10)) console.log(`  bloqueado ${b.ruta}: ${b.motivos.join('; ')}`);

    for (const [titulo, mapa] of [['avisos', avisos], ['datos sin sitio', perdidas]] as const) {
        if (mapa.size === 0) continue;
        console.log(`\n--- ${titulo} ---`);
        for (const [k, n] of [...mapa].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
            console.log(`${String(n).padStart(5)}  ${k}`);
        }
    }

    if (!escribirDeVerdad) {
        console.log('\nNADA escrito. Pasa --write para escribir.');
        return;
    }

    const resumen = await escribir(db, plan);
    console.log(
        `\nescrito: ${resumen.creados} creados, ${resumen.reemplazados} reemplazados, ` +
            `${resumen.lotes} lotes, ${resumen.bloqueados} bloqueados`
    );

    if (bandera('verify')) {
        const v = await verificar(db, plan, 'app');
        console.log(
            `verificacion: ${v.comprobados} comprobados, ${v.ausentes.length} ausentes, ` +
                `${v.distintos.length} distintos, ${v.invalidos.length} invalidos`
        );
        for (const d of [...v.ausentes, ...v.distintos, ...v.invalidos].slice(0, 10)) {
            console.log(`  revisar: ${d}`);
        }
    }
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
