/**
 * scripts/runBaseNuevaAudit.ts — lee la base nueva del emulador y la audita. SOLO LECTURA.
 *
 *   npm run audit:base-nueva
 *
 * Es la comprobación por fuera: no pregunta al escritor qué cree que escribió, va a la base
 * y lo cuenta. Y revalida contra el contrato lo que encuentra, que es la única forma de
 * saber que lo guardado sigue siendo válido después del viaje de ida y vuelta por Firestore.
 *
 * No escribe nada y no necesita la puerta de entorno.
 */

// Nada de `.env.local`: ese fichero es el destino de la base VIEJA (proyecto y puerto de
// siempre), y desde el 01-11-2026 la base nueva vive en su propio proyecto y su propio
// emulador. El destino lo pone el escritor, de la constante, y si el entorno pide otro se
// para en vez de ignorarlo. Ver `src/config/projectAllowlist.ts`.

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { obtenerDb } from '../src/loader/baseNuevaWriter';
import { validarForma } from '../src/config/baseNueva/validadores';
import { coleccionesRaizDeclaradas, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';
import { CENTINELAS_PROHIBIDOS, TOLERANCIA_DEL_REPARTO } from '../src/config/baseNueva/vocabulario';
import { BLOQUES_DE_INSTRUMENTO } from '../src/ingestion/baseNueva/mapper';

/** Los subdocumentos de un instrumento, con su esquema. La lista vive en el mapper. */
const BLOQUES = BLOQUES_DE_INSTRUMENTO;

async function main(): Promise<void> {
    const db = obtenerDb();

    console.log('');
    console.log('=== auditoria de la base nueva, leida del emulador ===');
    console.log(`proyecto: ${PROYECTO_BASE_NUEVA}`);
    console.log(`emulador: ${HOST_EMULADOR_BASE_NUEVA}`);

    const raices = await db.collection('instruments').get();
    console.log('');
    console.log(`raices en instruments : ${raices.size}`);

    let invalidas = 0;
    const porTipo: Record<string, number> = {};
    const sinUnidadDeclarada: string[] = [];
    for (const doc of raices.docs) {
        const datos = doc.data();
        if (!validarForma('instrument.v2.schema.json', datos).ok) {
            invalidas += 1;
            if (invalidas <= 5) console.log(`  raiz invalida: ${doc.id}`);
        }
        const tipo = String(datos['instrument_type'] ?? '<sin tipo>');
        porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
        const divisa = (datos['identity'] as Record<string, unknown> | undefined)?.['currency'];
        if (typeof divisa !== 'string') sinUnidadDeclarada.push(doc.id);
    }
    console.log(`raices que NO validan : ${invalidas}`);
    console.log(`por instrument_type   : ${JSON.stringify(porTipo)}`);
    console.log(`raices sin divisa     : ${sinUnidadDeclarada.length}`);

    console.log('');
    console.log('--- subdocumentos, contados y revalidados ---');
    let totalSub = 0;
    let totalInvalidos = 0;
    for (const [sufijo, tipo] of Object.entries(BLOQUES)) {
        let presentes = 0;
        let invalidos = 0;
        const refs = raices.docs.map((doc) => db.doc(`instruments/${doc.id}/${sufijo}`));
        for (let i = 0; i < refs.length; i += 250) {
            const snaps = await db.getAll(...refs.slice(i, i + 250));
            for (const snap of snaps) {
                if (!snap.exists) continue;
                presentes += 1;
                if (!validarForma(tipo, snap.data()).ok) invalidos += 1;
            }
        }
        totalSub += presentes;
        totalInvalidos += invalidos;
        console.log(
            `${String(presentes).padStart(5)}  ${sufijo.padEnd(26)} ${invalidos === 0 ? 'todos validan' : `${invalidos} NO validan`}`
        );
    }
    /* Lo que escribe el LOTE, contado aparte: es de otro dueno y se deriva de lo de arriba. */
    console.log('');
    /*
     * Las subcolecciones de un instrumento que NO son un documento con nombre fijo.
     *
     * Las de arriba se cuentan por su nombre -`declared/costs`, `quality/latest`-, una lista
     * explicita que hay que mantener. `holdings_chunks` no cabe en esa forma: son 883
     * documentos con nombre variable colgando de 740 instrumentos. El 02-11-2026 se
     * escribieron y la auditoria siguio diciendo 15.014 documentos, que es la TERCERA vez el
     * mismo dia que esta comprobacion no ve algo recien escrito -primero una coleccion raiz,
     * luego una subcoleccion de una raiz, ahora una subcoleccion de un instrumento-.
     *
     * Asi que estas se deducen del contrato y se cuentan con UNA consulta de grupo de
     * colecciones, no con un listado por instrumento, que serian 1.077 idas y venidas.
     */
    console.log('');
    console.log('--- subcolecciones de instrumento con documentos variables ---');
    let totalVariables = 0;
    let invalidosVariables = 0;
    for (const [clave, fichero] of subcoleccionesDeclaradas()) {
        const partes = clave.split('/');
        if (partes[0] !== 'instruments' || partes[3] !== '*') continue;
        const sub = partes[2] as string;
        const snap = await db.collectionGroup(sub).get();
        let malos = 0;
        for (const doc of snap.docs) if (!validarForma(fichero, doc.data()).ok) malos += 1;
        totalVariables += snap.size;
        invalidosVariables += malos;
        const padres = new Set(snap.docs.map((doc) => doc.ref.path.split('/')[1]));
        console.log(
            `${String(snap.size).padStart(5)}  instruments/*/${sub.padEnd(18)} ` +
                `en ${padres.size} instrumentos, ${malos === 0 ? 'todos validan' : `${malos} NO validan`}`
        );
    }
    if (totalVariables === 0) console.log('    (ninguna escrita todavia)');

    console.log('');
    console.log('--- lo del lote (x-owner: batch) ---');
    const DEL_LOTE: Record<string, string> = {
        'quality/latest': 'instrument-quality.v2.schema.json',
        'read/card': 'instrument-read-card.v2.schema.json'
    };
    let totalLote = 0;
    let invalidosLote = 0;
    const coberturas: number[] = [];
    const aptos: Record<string, number> = {};
    for (const [sufijo, tipo] of Object.entries(DEL_LOTE)) {
        let presentes = 0;
        let invalidos = 0;
        const refs = raices.docs.map((doc) => db.doc(`instruments/${doc.id}/${sufijo}`));
        for (let i = 0; i < refs.length; i += 250) {
            for (const snap of await db.getAll(...refs.slice(i, i + 250))) {
                if (!snap.exists) continue;
                presentes += 1;
                const datos = snap.data() as Record<string, unknown>;
                if (!validarForma(tipo, datos).ok) invalidos += 1;
                if (sufijo === 'quality/latest') {
                    const cobertura = datos['coverage'];
                    if (typeof cobertura === 'number') coberturas.push(cobertura);
                    for (const [aptitud, veredicto] of Object.entries(
                        (datos['fitness'] ?? {}) as Record<string, { apt?: boolean }>
                    )) {
                        if (veredicto.apt === true) aptos[aptitud] = (aptos[aptitud] ?? 0) + 1;
                    }
                }
            }
        }
        totalLote += presentes;
        invalidosLote += invalidos;
        console.log(
            `${String(presentes).padStart(5)}  ${sufijo.padEnd(26)} ${invalidos === 0 ? 'todos validan' : `${invalidos} NO validan`}`
        );
    }
    if (coberturas.length > 0) {
        const ordenadas = [...coberturas].sort((a, b) => a - b);
        const mediana = ordenadas[Math.floor(ordenadas.length / 2)] ?? 0;
        console.log(`cobertura mediana     : ${(mediana * 100).toFixed(1)} % (mide lo declarado, no ordena)`);
        console.log('para que sirven, leido de la base:');
        for (const [aptitud, cuantos] of Object.entries(aptos).sort((a, b) => b[1] - a[1])) {
            console.log(`${String(cuantos).padStart(5)}  ${aptitud}`);
        }
    }

    /*
     * Las colecciones RAIZ, que hasta el 02-11-2026 no se miraban.
     *
     * La auditoria contaba andando desde `instruments`, asi que una coleccion raiz le era
     * invisible: el dia que se escribio el indice de busqueda, la auditoria siguio diciendo
     * 14.751 documentos con 14.754 en la base, y no valido ni uno de los tres fragmentos.
     *
     * Cuales son no se escribe aqui: se deduce de los contratos. Un `x-collection` de dos
     * tramos -`search_shards/{shard_id}`- es una coleccion raiz; uno de cuatro
     * -`instruments/{isin}/declared/profile`- no. Asi, un contrato nuevo entra en la
     * auditoria el dia que se escribe, sin tocar este guion.
     */
    console.log('');
    console.log('--- colecciones raiz, aparte de instruments ---');
    const contratoDeRaiz = coleccionesRaizDeclaradas();
    const subcolecciones = subcoleccionesDeclaradas();
    const sumaDeSubs = new Map<string, { cuantos: number; malos: number }>();
    let totalRaiz = 0;
    let invalidosRaiz = 0;
    const sinContrato: string[] = [];
    const conDocumentos = new Set<string>();
    for (const coleccion of await db.listCollections()) {
        if (coleccion.id === 'instruments') continue;
        conDocumentos.add(coleccion.id);
        const snap = await coleccion.get();
        const tipo = contratoDeRaiz.get(coleccion.id);
        if (tipo === undefined) {
            /* `assets` es la maestra de hoy y se cuenta aparte, al final: su contrato vive en
               `contracts/master/` y no es de esta base. Cualquier otra sin contrato es una
               coleccion que nadie declaro, y eso hay que decirlo. */
            if (coleccion.id !== 'assets') sinContrato.push(`${coleccion.id} (${snap.size})`);
            continue;
        }
        let invalidos = 0;
        for (const doc of snap.docs) if (!validarForma(tipo, doc.data()).ok) invalidos += 1;
        totalRaiz += snap.size;
        invalidosRaiz += invalidos;
        console.log(
            `${String(snap.size).padStart(5)}  ${coleccion.id.padEnd(26)} ${invalidos === 0 ? 'todos validan' : `${invalidos} NO validan`}`
        );

        /* Y lo que cuelga de cada documento, que es la misma ceguera una planta mas abajo: el
           02-11-2026 se escribieron 18 carteras con 220 objetivos y esto contaba 18. Se recorre
           documento a documento porque Firestore no sabe decir «todas las subcolecciones de
           esta coleccion»; con 18 carteras son 18 listados, y si algun dia una raiz tiene
           miles, esta parte hay que acotarla. `instruments` no pasa por aqui: sus bloques se
           cuentan arriba, uno por uno y por su contrato. */
        for (const padre of snap.docs) {
            for (const sub of await padre.ref.listCollections()) {
                const hijos = await sub.get();
                /* Dos formas de subcoleccion, y las dos existen: `targets/{instrument_id}` es
                   una coleccion de muchos documentos iguales, y `declared/costs` es un
                   documento con nombre propio y contrato propio. Asi que se busca primero la
                   generica y, si no, la del documento concreto. */
                const generica = `${coleccion.id}/*/${sub.id}/*`;
                for (const hijo of hijos.docs) {
                    const clave = subcolecciones.has(generica)
                        ? generica
                        : `${coleccion.id}/*/${sub.id}/${hijo.id}`;
                    const tipoSub = subcolecciones.get(clave);
                    if (tipoSub === undefined) {
                        sinContrato.push(`${clave} (1)`);
                        continue;
                    }
                    const malo = validarForma(tipoSub, hijo.data()).ok ? 0 : 1;
                    totalRaiz += 1;
                    invalidosRaiz += malo;
                    const antes = sumaDeSubs.get(clave) ?? { cuantos: 0, malos: 0 };
                    sumaDeSubs.set(clave, { cuantos: antes.cuantos + 1, malos: antes.malos + malo });
                }
            }
        }
    }
    for (const [ruta, { cuantos, malos }] of sumaDeSubs) {
        console.log(`${String(cuantos).padStart(5)}  ${ruta.padEnd(26)} ${malos === 0 ? 'todos validan' : `${malos} NO validan`}`);
    }
    const declaradasYVacias = [...contratoDeRaiz.keys()]
        .filter((id) => id !== 'instruments' && !conDocumentos.has(id))
        .sort();
    console.log(`declaradas y aun vacias   : ${declaradasYVacias.length} (${declaradasYVacias.join(', ')})`);
    if (sinContrato.length > 0) {
        console.log(`SIN CONTRATO que las declare: ${sinContrato.join(', ')}`);
    }

    /*
     * Los huerfanos: subdocumentos que cuelgan de una raiz que NO existe.
     *
     * En Firestore un documento puede tener subcolecciones sin existir el, y `get()` no lo
     * devuelve: solo `listDocuments()`, que lista referencias. La diferencia entre las dos
     * son exactamente los huerfanos, y por eso hasta hoy no los veia nadie.
     *
     * Medido el 02-11-2026: `LU2504555777`, cuya raiz el contrato bloqueo por no traer
     * `classification.category`, tiene **13** colgando -doce `declared/*` y un
     * `computed/metrics`-. La cifra que circulaba, doce, estaba contada a mano.
     */
    console.log('');
    console.log('--- huerfanos: lo que cuelga de una raiz que no existe ---');
    const idsQueExisten = new Set(raices.docs.map((doc) => doc.id));
    const huerfanos: { padre: string; rutas: string[] }[] = [];
    for (const ref of await db.collection('instruments').listDocuments()) {
        if (idsQueExisten.has(ref.id)) continue;
        const rutas: string[] = [];
        for (const sub of await ref.listCollections()) {
            for (const doc of (await sub.get()).docs) rutas.push(`${sub.id}/${doc.id}`);
        }
        huerfanos.push({ padre: ref.id, rutas });
    }
    const documentosHuerfanos = huerfanos.reduce((total, h) => total + h.rutas.length, 0);
    console.log(`raices que no existen     : ${huerfanos.length}`);
    console.log(`documentos colgando       : ${documentosHuerfanos} (tiene que ser 0)`);
    for (const huerfano of huerfanos) {
        console.log(`  ${huerfano.padre}: ${huerfano.rutas.length} -> ${huerfano.rutas.join(', ')}`);
    }
    if (huerfanos.length > 0) {
        console.log('  Ni valen ni dejan de valer: NADIE los mira. O se completa la raiz que el');
        console.log('  contrato bloqueo, o se retira el subarbol. Esta auditoria no borra nada.');
    }

    console.log('');
    console.log(`documentos en total   : ${raices.size + totalSub + totalLote + totalRaiz + totalVariables + documentosHuerfanos}`);
    console.log(`que NO validan        : ${invalidas + totalInvalidos + invalidosLote + invalidosRaiz + invalidosVariables}`);

    /* Dos comprobaciones de contenido que valen la pena, por los defectos que ya conocemos. */
    console.log('');
    console.log('--- comprobaciones de contenido ---');
    let centinelas = 0;
    let conIndice = 0;
    /* La lista de centinelas es la del vocabulario, no una propia de la auditoria: si
       estuviera repetida aqui, el dia que creciera una la otra se quedaria corta. */
    const prohibidos = new Set<string>(CENTINELAS_PROHIBIDOS as readonly string[]);
    for (const doc of raices.docs) {
        const clasificacion = doc.data()['classification'] as Record<string, unknown> | undefined;
        const indice = clasificacion?.['official_benchmark'] as Record<string, unknown> | undefined;
        const nombre = indice?.['name'];
        if (typeof nombre === 'string') {
            conIndice += 1;
            if (prohibidos.has(nombre.trim())) centinelas += 1;
        }
    }
    console.log(`raices con nombre de indice            : ${conIndice} de ${raices.size}`);
    console.log(`centinelas en el campo del indice      : ${centinelas} (tiene que ser 0)`);

    let repartosQueNoSuman = 0;
    let porCompletado: Record<string, number> = {};
    const refsExposicion = raices.docs.map((doc) => db.doc(`instruments/${doc.id}/declared/exposure`));
    for (let i = 0; i < refsExposicion.length; i += 250) {
        const snaps = await db.getAll(...refsExposicion.slice(i, i + 250));
        for (const snap of snaps) {
            if (!snap.exists) continue;
            const datos = snap.data() as Record<string, unknown>;
            const completado = String(datos['asset_mix_completion'] ?? '<ausente>');
            porCompletado[completado] = (porCompletado[completado] ?? 0) + 1;
            const mezcla = datos['asset_mix'] as Record<string, number> | undefined;
            if (mezcla === undefined) continue;
            const suma = Object.values(mezcla).reduce((total, valor) => total + valor, 0);
            if (Math.abs(suma - 1) > TOLERANCIA_DEL_REPARTO) repartosQueNoSuman += 1;
        }
    }
    console.log(`repartos por asset_mix_completion      : ${JSON.stringify(porCompletado)}`);
    console.log(`repartos escritos que NO suman 1       : ${repartosQueNoSuman} (tiene que ser 0)`);
    if (repartosQueNoSuman > 0) {
        console.log('  El escritor de hoy no puede producir uno de estos, asi que son restos de una');
        console.log('  pasada anterior. `npm run baseNueva:plan` los nombra uno por uno como SOBRANTES.');
        console.log('  Este escritor no borra nada: decide alguien.');
    }

    /* Y la tercera, que existe por E-3: el objetivo lleva copiado el `advisor_id` de su
       cartera, porque es lo unico que una regla de grupo de Firestore puede comprobar sin un
       `get()` por documento. Una regla que depende de un campo copiado vale lo que valga la
       copia, asi que la copia se comprueba aqui y no se supone. Si deja de cuadrar, un asesor
       pierde de vista sus propios objetivos o ve los de otro, y las reglas no se enteran. */
    const carteras = await db.collection('portfolios').get();
    const duenoDeLaCartera = new Map<string, unknown>();
    for (const doc of carteras.docs) duenoDeLaCartera.set(doc.id, doc.data()['advisor_id']);
    const objetivos = await db.collectionGroup('targets').get();
    let objetivosSinDueno = 0;
    let objetivosConOtroDueno = 0;
    let objetivosSinCartera = 0;
    for (const doc of objetivos.docs) {
        const cartera = doc.ref.parent.parent?.id;
        if (cartera === undefined || !duenoDeLaCartera.has(cartera)) {
            objetivosSinCartera += 1;
            continue;
        }
        const declarado = doc.data()['advisor_id'];
        if (typeof declarado !== 'string' || declarado.length === 0) {
            objetivosSinDueno += 1;
            continue;
        }
        if (declarado !== duenoDeLaCartera.get(cartera)) objetivosConOtroDueno += 1;
    }
    console.log(`objetivos de cartera                   : ${objetivos.size} en ${carteras.size} carteras`);
    console.log(`objetivos sin advisor_id               : ${objetivosSinDueno} (tiene que ser 0)`);
    console.log(`objetivos con dueno distinto del padre : ${objetivosConOtroDueno} (tiene que ser 0)`);
    console.log(`objetivos sin cartera padre            : ${objetivosSinCartera} (tiene que ser 0)`);
    if (objetivosSinDueno > 0) {
        console.log('  Sin ese campo la regla de Firestore no concede: el asesor no ve sus objetivos.');
        console.log('  Los escribe `carteras:write`; una base anterior al 03-11-2026 no los tiene.');
    }

    /* Y que la maestra de hoy sigue donde estaba: la base nueva vive al lado, no encima. */
    const assets = await db.collection('assets').get();
    console.log('');
    console.log(`assets (la maestra de hoy, sin tocar)  : ${assets.size}`);

    /* Los huerfanos y una coleccion sin contrato cuentan como problema, y es el cambio que
       importa: la frase «valida entera» la decia una auditoria que no miraba entera. Un
       documento que nadie mira parece vigente y no lo es, y eso es peor que si faltara. */
    const todoBien =
        invalidas + totalInvalidos + invalidosLote + invalidosRaiz + invalidosVariables === 0 &&
        centinelas === 0 &&
        repartosQueNoSuman === 0 &&
        objetivosSinDueno === 0 &&
        objetivosConOtroDueno === 0 &&
        objetivosSinCartera === 0 &&
        huerfanos.length === 0 &&
        sinContrato.length === 0;
    console.log('');
    console.log(todoBien ? 'La base nueva valida entera contra su contrato.' : 'HAY PROBLEMAS: ver arriba.');
    if (!todoBien) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
