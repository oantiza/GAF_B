/**
 * scripts/subirALaNube.ts — lo ÚNICO de este repositorio que habla con Firestore de verdad.
 *
 *   npm run nube:plan                        # cuenta las dos partes y para. No escribe.
 *   BDB_SUBIDA_A_LA_NUBE=SI_ENTIENDO_QUE_ESCRIBE_EN_LA_NUBE \
 *     npm run nube:subir -- --escribe        # escribe
 *
 * `--parte catalogo` sube solo lo que no es de nadie y `--parte carteras` solo lo que sí.
 * Existe porque las dos mitades **no están listas a la vez**: el catálogo se lee con tener
 * sesión, y una cartera solo la lee su dueño, que tiene que existir antes.
 *
 * Desde que la aplicación está publicada (03-11-2026), carteras y retrocesiones se editan en la
 * NUBE y la copia local no se entera. Subirlas pisaría lo editado, así que escribir cualquier
 * parte que no sea `catalogo` exige además `--piso-lo-de-la-app`, que no se pone por costumbre.
 *
 * `--parte planes` sube solo el catálogo de planes de pensiones y EPSV (`pension_plans`, decisión
 * D-11). Es una parte propia y NO va dentro de `catalogo`: es un catálogo aparte, con datos de
 * otro origen, y un refresco de instrumentos no debe arrastrarlo ni al revés. La aplicación no lo
 * edita, así que no pide `--piso-lo-de-la-app`.
 *
 * La cartera completa del emisor de los ETF (`declared/issuer_holdings` e `issuer_holdings_chunks`, decisión B-79) NO sube
 * salvo con `--con-cartera-del-emisor`: es de uso interno, solo para el asesor, y subirla la aprueba Óscar aparte.
 *
 * Esta subida solo borra lo que nombra `BORRADOS_APROBADOS`, ruta a ruta, con los mismos tres cierres
 * que escribir, y lo enseña antes en el plan. El resto de lo que sobre en la nube se cuenta y se queda.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE FICHERO NO REUTILIZA LAS BARRERAS DE LA PLATAFORMA
 *
 * `obtenerDb` impone el emulador en código y `ALLOWED_PROJECT_IDS` deja fuera a propósito el
 * id del proyecto real. Esas dos barreras existen justo para impedir lo que este script hace,
 * así que reutilizarlas obligaría a debilitarlas, y entonces dejarían de proteger al resto.
 *
 * Lo correcto es lo contrario: que todo lo demás siga sin poder salir del emulador, y que
 * salir sea un fichero aparte, con nombre, con sus propios cierres y fácil de auditar. Si
 * algún día alguien se pregunta «¿qué puede escribir en la nube?», la respuesta es este
 * fichero y ninguno más.
 *
 * LOS TRES CIERRES, y hacen falta los tres a la vez:
 *
 *   1. `--escribe`. Sin él solo cuenta.
 *   2. `BDB_SUBIDA_A_LA_NUBE` con su frase entera. Una variable propia y no la del emulador:
 *      la del emulador se pone muchas veces al día y acabaría puesta por costumbre.
 *   3. La clave de servicio tiene que ser del proyecto nuevo. En
 *      `C:\Users\oanti\Documents\firebase-keys\` hay DOS claves y la otra abre la base de
 *      PRODUCCIÓN de BDB; el 02-11-2026 ya llegó por error la configuración web de BDB
 *      cuando se pidió la del proyecto nuevo. Así que el id del proyecto se comprueba
 *      contra el que se espera y se niega explícitamente el de BDB.
 *
 * Y una asimetría a propósito: la fuente se lee por REST contra el emulador y el destino se
 * escribe con el Admin SDK. La mitad que lee no sabe escribir, y la que escribe no sabe nada
 * de emuladores.
 * ───────────────────────────────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';

import * as admin from 'firebase-admin';

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';
import { planDeCorreccion, type Disponibilidad } from '../src/ingestion/baseNueva/correccionDeBajas';
import { validarForma } from '../src/config/baseNueva/validadores';
import { CONTRATOS_FUERA_DE_LA_SUBIDA } from '../src/ingestion/baseNueva/carteraDelEmisor';
import { coleccionesRaizDeclaradas, raicesDelDueno, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';
import { marcaDeTiempo } from '../src/ingestion/baseNueva/retrocesiones';
import {
    claseDeLaColeccion,
    compararConLaNube,
    entraEnLaParte,
    PARTES,
    PARTES_QUE_NO_PISAN,
    type Parte
} from '../src/ingestion/baseNueva/partesDeLaSubida';
import {
    describirPlan,
    ejecutarBorrados,
    planDeBorrados,
    type BaseDeBorrados,
    type DecisionDeBorrado
} from '../src/ingestion/baseNueva/borradosAprobados';

/** El proyecto de BDB. Está aquí para NEGARLO. */
const PROYECTO_DE_BDB = 'bbdd-activos-financieros';

/** La frase que abre la puerta. Entera, y solo para esto. */
const PUERTA = 'BDB_SUBIDA_A_LA_NUBE';
const FRASE = 'SI_ENTIENDO_QUE_ESCRIBE_EN_LA_NUBE';

/** Dónde vive la clave de servicio. Fuera de los repositorios, a propósito. */
const CLAVE_POR_DEFECTO = 'C:\\Users\\oanti\\Documents\\firebase-keys\\bdb-gestor-de-activos-firebase-adminsdk.json';

const RAIZ_EMULADOR = `http://${HOST_EMULADOR_BASE_NUEVA}/v1/projects/${PROYECTO_BASE_NUEVA}/databases/(default)/documents`;

function bandera(nombre: string): boolean {
    return process.argv.includes(`--${nombre}`);
}

function valor(nombre: string): string | undefined {
    const i = process.argv.indexOf(`--${nombre}`);
    return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}

/** Desenvuelve un valor de la REST de Firestore. */
function val(crudo: Record<string, unknown>): unknown {
    if ('stringValue' in crudo) return crudo['stringValue'];
    if ('booleanValue' in crudo) return crudo['booleanValue'];
    if ('integerValue' in crudo) return Number(crudo['integerValue']);
    if ('doubleValue' in crudo) return crudo['doubleValue'];
    if ('timestampValue' in crudo) return marcaDeTiempo(String(crudo['timestampValue']));
    if ('nullValue' in crudo) return null;
    if ('mapValue' in crudo) {
        const campos = (crudo['mapValue'] as { fields?: Record<string, Record<string, unknown>> }).fields ?? {};
        const salida: Record<string, unknown> = {};
        for (const [clave, valorCrudo] of Object.entries(campos)) salida[clave] = val(valorCrudo);
        return salida;
    }
    if ('arrayValue' in crudo) {
        const valores = (crudo['arrayValue'] as { values?: Record<string, unknown>[] }).values ?? [];
        return valores.map(val);
    }
    return undefined;
}

interface DocumentoLeido {
    ruta: string;
    tipo: string | undefined;
    datos: Record<string, unknown>;
    /**
     * Lo que ocupa en la forma que VIAJA, no en la decodificada.
     *
     * El límite del commit es sobre la petición, y lo que la petición lleva son valores
     * tipados: cada escalar va envuelto en su `{"stringValue": ...}`. Medido el 03-11-2026
     * sobre los 16.118 documentos, lo tipado es **1,77 veces** lo decodificado de media y hasta
     * 2,42 veces en el peor documento. O sea que presupuestar sobre el valor decodificado se
     * equivoca por un factor que además cambia con los datos: una tanda de 5 MiB decodificados
     * son 12,1 MiB en el cable, por encima de los 10 que admite.
     *
     * Así que se mide lo tipado, que es lo que el emulador ya devolvió. Y se mide en JSON, que
     * es MÁS de lo que ocupa en protobuf: el error cae del lado seguro.
     */
    bytes: number;
}

/*
 * Las partes de la base, y la línea que las separa es de quién es el dato. La regla vive en
 * `partesDeLaSubida.ts`: lo que el contrato declara de la aplicación (`x-owner: app`) nunca es catálogo.
 */
const RAICES_DE_LA_APP: ReadonlySet<string> = raicesDelDueno('app');
const claseDe = (documento: DocumentoLeido) => claseDeLaColeccion(documento.ruta.split('/')[0], RAICES_DE_LA_APP);

/** Márgenes comerciales: ni catálogo ni de un asesor, y se suben por su propia decisión. */
function esRetrocesion(documento: DocumentoLeido): boolean {
    return claseDe(documento) === 'retrocesiones';
}

function esDeUnAsesor(documento: DocumentoLeido): boolean {
    return claseDe(documento) === 'carteras';
}

/** Planes de pensiones y EPSV: catálogo aparte del de instrumentos, con su propia parte (D-11). */
function esPlanDePensiones(documento: DocumentoLeido): boolean {
    return claseDe(documento) === 'planes';
}

/**
 * Cuántos documentos hay de cada grupo de colección.
 *
 * Por GRUPO y no por colección raíz, y la diferencia no es de estilo: `count()` de una raíz no
 * cuenta sus subcolecciones, así que `instruments` da 1.091 —los activos— mientras que de
 * `instruments/...` hay 15.877 documentos. Agrupar por el nombre de la colección de cada
 * documento es lo que hace comparables las dos cifras, porque es lo que mide
 * `collectionGroup(nombre).count()` al otro lado.
 */
function porGrupo(documentos: DocumentoLeido[]): Map<string, number> {
    const cuenta = new Map<string, number>();
    for (const documento of documentos) {
        const partes = documento.ruta.split('/');
        const grupo = partes[partes.length - 2] ?? '?';
        cuenta.set(grupo, (cuenta.get(grupo) ?? 0) + 1);
    }
    return cuenta;
}

/**
 * Una consulta de grupo contra el emulador, por REST y de 500 en 500. Solo lee.
 *
 * Por páginas porque de una vez no cabe: con las series de precios, la respuesta supera el
 * tamaño máximo de una cadena en Node y el plan moría con «Cannot create a string longer than
 * 0x1fffffe8». Medido el 03-11-2026 al planificar las retrocesiones.
 */
async function grupo(coleccion: string): Promise<{ name: string; fields?: Record<string, Record<string, unknown>> }[]> {
    const salida: { name: string; fields?: Record<string, Record<string, unknown>> }[] = [];
    const TAMANO = 500;
    let ultimo: string | undefined;
    for (;;) {
        const res = await fetch(`${RAIZ_EMULADOR}:runQuery`, {
            method: 'POST',
            headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: coleccion, allDescendants: true }],
                    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
                    limit: TAMANO,
                    ...(ultimo === undefined ? {} : { startAt: { values: [{ referenceValue: ultimo }], before: false } })
                }
            })
        });
        if (!res.ok) throw new Error(`el emulador contesto ${res.status} al leer '${coleccion}'`);
        const filas = (await res.json()) as { document?: { name: string; fields?: Record<string, Record<string, unknown>> } }[];
        const pagina = filas.flatMap((fila) => (fila.document === undefined ? [] : [fila.document]));
        salida.push(...pagina);
        if (pagina.length < TAMANO) return salida;
        ultimo = pagina[pagina.length - 1]?.name;
    }
}

/**
 * Todo lo que hay en el emulador, con el contrato de cada documento.
 *
 * Qué se lee no es una lista escrita a mano: son las colecciones raíz y las subcolecciones
 * que DECLARAN los contratos. Así, un contrato nuevo entra en la subida el día que se
 * escribe su primer documento, que es la misma regla que sigue la auditoría.
 */
async function leerElEmulador(parte: Parte, conCarteraDelEmisor: boolean): Promise<DocumentoLeido[]> {
    const entra = (raiz: string | undefined): boolean => entraEnLaParte(parte, raiz, RAICES_DE_LA_APP);
    const raices = coleccionesRaizDeclaradas();
    const subs = subcoleccionesDeclaradas();
    const vistos = new Set<string>();
    const salida: DocumentoLeido[] = [];

    const anota = (documento: { name: string; fields?: Record<string, Record<string, unknown>> }, tipo: string | undefined) => {
        const ruta = documento.name.split('/documents/')[1];
        if (ruta === undefined || vistos.has(ruta)) return;
        vistos.add(ruta);
        const crudos = documento.fields ?? {};
        const datos: Record<string, unknown> = {};
        for (const [clave, crudo] of Object.entries(crudos)) datos[clave] = val(crudo);
        salida.push({ ruta, tipo, datos, bytes: Buffer.byteLength(JSON.stringify(crudos), 'utf8') });
    };

    for (const [coleccion, fichero] of raices) {
        if (!entra(coleccion)) continue;
        for (const documento of await grupo(coleccion)) {
            /* Una consulta de grupo trae también los descendientes homónimos; el tipo se
               decide por la forma de la ruta, no por el nombre de la colección. */
            const ruta = documento.name.split('/documents/')[1] ?? '';
            if (ruta.split('/').length === 2) anota(documento, fichero);
        }
    }
    for (const [clave, fichero] of subs) {
        const sub = clave.split('/')[2];
        if (sub === undefined || !entra(clave.split('/')[0])) continue;
        if (!conCarteraDelEmisor && CONTRATOS_FUERA_DE_LA_SUBIDA.has(fichero)) continue;
        for (const documento of await grupo(sub)) {
            const ruta = documento.name.split('/documents/')[1] ?? '';
            const partes = ruta.split('/');
            if (partes.length !== 4) continue;
            const patron = `${partes[0]}/*/${partes[2]}/${clave.endsWith('/*') ? '*' : partes[3]}`;
            if (patron === clave) anota(documento, fichero);
        }
    }
    return salida;
}

/**
 * Los dueños que nombran las carteras y que NO existen en el Auth del destino.
 *
 * Las reglas conceden una cartera comparando su `advisor_id` con el uid de la sesión, y un
 * `targets` con su `set_by`. Si el uid escrito no existe en el proyecto de destino, los
 * documentos se escriben y **nadie puede leerlos**: el asesor entra y ve «ninguna cartera
 * guardada», que es un fallo silencioso con cara de base vacía.
 *
 * No es una hipótesis: pasó el 11-07-2026 en BDB, cuando una rotación de credenciales recreó
 * la cuenta de Óscar con uid nuevo, y `migrate_portfolios_uid.py` existe por eso. Las 238
 * carteras de aquí siguen llevando aquel uid, que es del proyecto de BDB.
 *
 * Por eso esto se comprueba contra el Auth de verdad y no se escribe si falla. Un uid que no
 * existe no es un detalle de configuración: es dato que nace ilegible.
 */
async function duenosQueNoExisten(documentos: DocumentoLeido[], auth: admin.auth.Auth): Promise<string[]> {
    const uids = new Set<string>();
    for (const documento of documentos) {
        for (const campo of ['advisor_id', 'set_by']) {
            const quien = documento.datos[campo];
            if (typeof quien === 'string' && quien !== '') uids.add(quien);
        }
    }
    const faltan: string[] = [];
    for (const uid of [...uids].sort()) {
        try {
            await auth.getUser(uid);
        } catch (error: unknown) {
            const codigo = (error as { errorInfo?: { code?: string } }).errorInfo?.code ?? '';
            if (codigo === 'auth/user-not-found') {
                faltan.push(uid);
                continue;
            }
            /* Cualquier otra cosa no es «ese usuario no está»: es que no se pudo preguntar
               —el Auth del proyecto sin habilitar, por ejemplo—, y eso no se puede confundir
               con un uid ausente. */
            throw new Error(
                `no se pudo preguntar al Auth de ${PROYECTO_BASE_NUEVA} por el uid ${uid}: ` +
                    `${codigo || String(error)}`
            );
        }
    }
    return faltan;
}

/** El cliente de la NUBE. Aquí no hay emulador que valga. */
function clienteDeLaNube(rutaDeLaClave: string): { nube: admin.firestore.Firestore; auth: admin.auth.Auth } {
    if (!fs.existsSync(rutaDeLaClave)) {
        throw new Error(`no existe la clave de servicio: ${rutaDeLaClave}`);
    }
    const clave = JSON.parse(fs.readFileSync(rutaDeLaClave, 'utf-8')) as { project_id?: string; type?: string };

    if (clave.project_id === PROYECTO_DE_BDB) {
        throw new Error(
            `ESA CLAVE ES DE BDB (${PROYECTO_DE_BDB}). Es la base de datos de produccion de BDB,\n` +
                '  que este proyecto no toca nunca. En la misma carpeta hay dos claves; la buena es\n' +
                `  la de ${PROYECTO_BASE_NUEVA}.`
        );
    }
    if (clave.project_id !== PROYECTO_BASE_NUEVA) {
        throw new Error(
            `la clave es del proyecto '${clave.project_id}' y se esperaba '${PROYECTO_BASE_NUEVA}'.`
        );
    }

    /* `FIRESTORE_EMULATOR_HOST` en el entorno redirigiria ESTE cliente al emulador y la
       subida escribiria en local diciendo que subio. Se quita para este proceso. */
    delete process.env['FIRESTORE_EMULATOR_HOST'];

    const app = admin.initializeApp(
        { credential: admin.credential.cert(rutaDeLaClave), projectId: PROYECTO_BASE_NUEVA },
        'nube'
    );
    return { nube: app.firestore(), auth: app.auth() };
}

/**
 * Deshace bajas falsas: `--deshaz-bajas <fichero.json>`, con `{ isin: { state, since, last_checked } }`.
 *
 * Toca un solo campo, `availability`, de la raíz de cada instrumento nombrado, y solo si en la nube
 * consta como baja. No lee el emulador ni sube nada más. Mismos tres cierres que el resto: sin
 * `--escribe` y la puerta, solo enseña qué haría. Y después de escribir vuelve a leer, porque lo que
 * se afirma es lo que hay allí, no lo que se mandó.
 */
async function deshacerBajas(fichero: string, escribir: boolean, rutaDeLaClave: string): Promise<void> {
    const deseado = JSON.parse(fs.readFileSync(fichero, 'utf-8')) as Record<string, Disponibilidad>;
    if (escribir && process.env[PUERTA] !== FRASE) {
        throw new Error(`falta la puerta: ${PUERTA}=${FRASE}`);
    }
    const { nube } = clienteDeLaNube(rutaDeLaClave);
    const lee = async (id: string): Promise<unknown> => {
        const documento = await nube.doc(`instruments/${id}`).get();
        return documento.exists ? (documento.get('availability') ?? null) : undefined;
    };

    const enLaNube: Record<string, unknown> = {};
    for (const id of Object.keys(deseado)) {
        const actual = await lee(id);
        if (actual !== undefined) enLaNube[id] = actual;
    }
    const plan = planDeCorreccion(deseado, enLaNube);

    console.log('');
    console.log('=== deshacer bajas falsas en la NUBE ===');
    console.log(`modo    : ${escribir ? 'ESCRIBE EN LA NUBE' : 'solo enseña, no escribe'}`);
    console.log(`destino : ${PROYECTO_BASE_NUEVA}, campo availability de la raiz y nada mas`);
    for (const paso of plan) {
        console.log(`${paso.id}  ${paso.accion.toUpperCase()}  (${paso.motivo})`);
        console.log(`  antes  : ${JSON.stringify(paso.antes)}`);
        console.log(`  despues: ${JSON.stringify(paso.despues)}`);
    }
    const aEscribir = plan.filter((paso) => paso.accion === 'escribir');
    if (!escribir) {
        console.log('');
        console.log(`NADA escrito en la nube. Se escribirian ${aEscribir.length}. Hacen falta --escribe y la puerta.`);
        return;
    }

    const lote = nube.batch();
    for (const paso of aEscribir) lote.update(nube.doc(`instruments/${paso.id}`), { availability: paso.despues });
    await lote.commit();

    console.log('');
    console.log('--- leido de la nube despues de escribir ---');
    for (const paso of aEscribir) {
        const leido = await lee(paso.id);
        if (JSON.stringify(leido, Object.keys(paso.despues).sort()) !== JSON.stringify(paso.despues, Object.keys(paso.despues).sort())) {
            throw new Error(`${paso.id}: lo leido no es lo escrito: ${JSON.stringify(leido)}`);
        }
        console.log(`${paso.id}  ${JSON.stringify(leido)}`);
    }
}

async function main(): Promise<void> {
    const escribir = bandera('escribe');
    const rutaDeLaClave = valor('clave') ?? CLAVE_POR_DEFECTO;
    const ordenDeBajas = valor('deshaz-bajas');
    if (ordenDeBajas !== undefined) {
        await deshacerBajas(ordenDeBajas, escribir, rutaDeLaClave);
        return;
    }
    const parte = (valor('parte') ?? 'todo') as Parte;
    if (!PARTES.includes(parte)) {
        throw new Error(`--parte admite ${PARTES.join(', ')}, y se recibio '${parte}'.`);
    }

    console.log('');
    console.log('=== subir la base nueva a la NUBE ===');
    console.log(`modo      : ${escribir ? 'ESCRIBE EN LA NUBE' : 'solo cuenta, no escribe'}`);
    console.log(`parte     : ${parte}`);
    console.log(`origen    : emulador ${HOST_EMULADOR_BASE_NUEVA} (lectura por REST)`);
    console.log(`destino   : ${PROYECTO_BASE_NUEVA} en Firestore de verdad`);
    console.log(`clave     : ${rutaDeLaClave}`);

    if (escribir && !PARTES_QUE_NO_PISAN.includes(parte) && !bandera('piso-lo-de-la-app')) {
        throw new Error(
            `--parte ${parte} pisaria las carteras y retrocesiones editadas en la nube con la copia local.\n` +
                '  Para refrescar datos: --parte catalogo (o --parte planes). Si de verdad es lo que quieres, --piso-lo-de-la-app.'
        );
    }

    if (escribir && process.env[PUERTA] !== FRASE) {
        throw new Error(
            `falta la puerta: ${PUERTA}=${FRASE}\n` +
                '  Es una variable propia y no la del emulador, que se pone muchas veces al dia.'
        );
    }

    /* Los datos del emisor (`issuer_data`, `issuer_nav`, `premium_discount`) estuvieron fuera hasta que Oscar leyera las condiciones de
       uso de cada web, y desde la decision 53 (08-11-2026: uso interno para el desarrollo) suben con el resto del catalogo. El mercado
       objetivo del EMT (`declared/target_market`, decision 58) sube igual: lo que se lee sale de las subcolecciones que declaran los
       contratos, y una prueba de `baseNuevaMercadoObjetivo.test.ts` comprueba que esta en esa lista y en el catalogo. */
    const conCarteraDelEmisor = bandera('con-cartera-del-emisor');
    console.log(
        `cartera del emisor: ${conCarteraDelEmisor ? 'SUBE (--con-cartera-del-emisor)' : 'no sube (B-79: uso interno, se aprueba aparte)'}`
    );
    const locales = await leerElEmulador(parte, conCarteraDelEmisor);
    const sinContrato = locales.filter((d) => d.tipo === undefined);
    const invalidos = locales.filter((d) => d.tipo !== undefined && !validarForma(d.tipo, d.datos).ok);

    console.log('');
    console.log(`documentos en el emulador : ${locales.length}`);
    console.log(`sin contrato que los valide: ${sinContrato.length}`);
    console.log(`que NO validan             : ${invalidos.length}`);
    for (const malo of invalidos.slice(0, 5)) console.log(`  invalido: ${malo.ruta}`);
    if (invalidos.length > 0 || sinContrato.length > 0) {
        throw new Error('no se sube nada que no valide contra su contrato.');
    }

    const { nube, auth } = clienteDeLaNube(rutaDeLaClave);

    const carteras = locales.filter(esDeUnAsesor);
    const retrocesiones = locales.filter(esRetrocesion);
    const planes = locales.filter(esPlanDePensiones);
    const catalogo = locales.filter((documento) => claseDe(documento) === 'catalogo');
    /* PLA-4: de la aplicación y sin parte propia (hoy, `clients`). No es catálogo: solo sube con `--parte todo`. */
    const deLaAppSinParte = locales.filter((documento) => claseDe(documento) === 'de-la-app');
    const aSubir =
        parte === 'catalogo'
            ? catalogo
            : parte === 'planes'
              ? planes
              : parte === 'carteras'
                ? carteras
                : parte === 'retrocesiones'
                  ? retrocesiones
                  : locales;

    console.log('');
    console.log(`catalogo (de nadie)  : ${catalogo.length}`);
    console.log(`planes y EPSV        : ${planes.length}`);
    console.log(`carteras (de alguien): ${carteras.length}`);
    console.log(`retrocesiones        : ${retrocesiones.length}`);
    if (deLaAppSinParte.length > 0) console.log(`de la app, sin parte : ${deLaAppSinParte.length} (solo suben con --parte todo)`);
    console.log(`se subiria           : ${aSubir.length}`);

    /* Qué hay ya ahí. Es una lectura, y sirve para no afirmar «subidos 15.897» cuando lo
       que ha pasado es que ya estaban. */
    const grupos = porGrupo(aSubir);
    console.log('');
    console.log('--- por grupo de coleccion ---');
    for (const [grupo, cuantos] of [...grupos].sort()) {
        const enLaNube = (await nube.collectionGroup(grupo).count().get()).data().count;
        /* Lo que está allí y no aquí no se toca, pero se dice: un bloque que sobra parece vigente. */
        const deMas = enLaNube > cuantos ? `   ${enLaNube - cuantos} de mas en la nube` : '';
        console.log(`${String(cuantos).padStart(6)}  ${grupo.padEnd(20)} en la nube: ${enLaNube}${deMas}`);
    }

    /*
     * Lo que se borra, si en esta parte hay catálogo. Solo entonces: con `--parte carteras` lo leído del
     * emulador no trae los instrumentos, y no valdría para decir que un documento sobra.
     */
    const borrados: DecisionDeBorrado[] =
        parte === 'catalogo' || parte === 'todo'
            ? await planDeBorrados(nube as unknown as BaseDeBorrados, new Set(aSubir.map((documento) => documento.ruta)))
            : [];
    if (borrados.length > 0) {
        console.log('');
        console.log('--- borrados aprobados: en la nube, y solo estos ---');
        for (const linea of describirPlan(borrados)) console.log(linea);
    }

    /* Los dueños, si en lo que se va a subir hay algo de alguien. Se comprueba también en
       seco: saberlo antes de abrir la puerta es justo para lo que sirve el ensayo. */
    const deAlguien = aSubir.filter(esDeUnAsesor);
    if (deAlguien.length > 0) {
        const huerfanos = await duenosQueNoExisten(deAlguien, auth);
        console.log('');
        console.log('--- duenos de las carteras, en el Auth del destino ---');
        if (huerfanos.length === 0) {
            console.log('todos los uid que nombran las carteras existen en el destino.');
        } else {
            for (const uid of huerfanos) console.log(`  NO existe: ${uid}`);
            console.log('');
            console.log('Esos documentos se escribirian y NADIE podria leerlos: las reglas');
            console.log('conceden una cartera a quien coincide con su advisor_id. Antes de');
            console.log('subirlas hay que sellarlas con el uid real del asesor en este proyecto.');
            if (escribir) throw new Error('no se suben carteras que su dueno no pueda leer.');
        }
    }

    console.log('');
    console.log('--- tandas ---');

    /*
     * Las tandas se cierran por BYTES, no solo por número de documentos.
     *
     * El 03-11-2026 la primera subida real murió a los 12.000 con `Transaction too big`. Un
     * commit admite 500 operaciones **y** unos 10 MiB, y aquí la tanda estaba puesta a 400
     * documentos sin mirar el tamaño. Los documentos de esta base son desiguales a propósito:
     * una tarjeta de lectura son 5 KB y un trozo de posiciones hasta 120 KB, 34 KB de media. 400
     * trozos son 13 MB y no entran.
     *
     * O sea: contar documentos no mide lo que el límite mide. Los dos topes van juntos porque
     * los dos existen, y el que llegue antes cierra la tanda. El tamaño sale de
     * `documento.bytes`, que está medido sobre la forma que viaja y no sobre la decodificada.
     *
     * **Y 8 MiB tampoco bastaban** (06-11-2026): la subida del catálogo murió en la tanda 34 de 106,
     * a los 13.200 documentos, con el mismo `Transaction too big`, en una tanda de 251 documentos
     * de 8 MiB que empezaba en `instruments/LU1902444584/declared/sustainability`. Lo que cuenta
     * el límite no es solo lo que viaja: cada campo escribe además sus entradas de índice, y los
     * bloques con muchos campos multiplican el tamaño de la transacción. Por eso el tope de bytes
     * va muy por debajo de los 10 MiB, y sigue mandando el que llegue antes.
     */
    const LIMITE_OPERACIONES = 400;
    const LIMITE_BYTES = 2 * 1024 * 1024;

    const tandas: DocumentoLeido[][] = [];
    let enCurso: DocumentoLeido[] = [];
    let bytesEnCurso = 0;
    for (const documento of aSubir) {
        const suyos = documento.bytes;
        const llena = enCurso.length >= LIMITE_OPERACIONES || bytesEnCurso + suyos > LIMITE_BYTES;
        if (enCurso.length > 0 && llena) {
            tandas.push(enCurso);
            enCurso = [];
            bytesEnCurso = 0;
        }
        enCurso.push(documento);
        bytesEnCurso += suyos;
    }
    if (enCurso.length > 0) tandas.push(enCurso);
    console.log(
        `${tandas.length} tandas, de ${LIMITE_OPERACIONES} documentos o ` +
            `${LIMITE_BYTES / 1024 / 1024} MiB, la que llegue antes`
    );

    /* El troceo se enseña ANTES de escribir, y en seco también: la vez que falló, el tamaño de
       la tanda era justo el dato que nadie había mirado. */
    const masGorda = tandas.reduce((peor, tanda) => {
        const suya = tanda.reduce((suma, documento) => suma + documento.bytes, 0);
        return suya > peor ? suya : peor;
    }, 0);
    console.log(`la mas gorda ocupa ${(masGorda / 1024 / 1024).toFixed(2)} MiB, y el commit admite 10`);

    if (!escribir) {
        console.log('');
        console.log('NADA escrito ni borrado en la nube. Para eso hacen falta --escribe y la puerta.');
        return;
    }

    console.log('');
    console.log('--- escribiendo ---');
    let escritos = 0;
    for (const [i, tanda] of tandas.entries()) {
        const lote = nube.batch();
        for (const documento of tanda) lote.set(nube.doc(documento.ruta), documento.datos);
        try {
            await lote.commit();
        } catch (error: unknown) {
            /* Dónde se paró y con qué dentro: sin esto, un fallo a media subida deja la nube en
               un estado que hay que ir a medir a mano, que es lo que pasó el 03-11-2026. */
            console.log('');
            console.log(`FALLO en la tanda ${i + 1} de ${tandas.length}: ${escritos} documentos ya escritos.`);
            console.log(`  documentos en la tanda: ${tanda.length}`);
            console.log(`  primera ruta          : ${tanda[0]?.ruta ?? '(vacia)'}`);
            throw error;
        }
        escritos += tanda.length;
        if (i % 5 === 4 || escritos === aSubir.length) console.log(`  ${escritos} de ${aSubir.length}`);
    }

    /* Después de escribir: si una tanda falla no se ha borrado nada. */
    const { borrados: yaBorrados, siguen } = await ejecutarBorrados(
        nube as unknown as BaseDeBorrados,
        borrados,
        escribir && process.env[PUERTA] === FRASE
    );
    if (yaBorrados.length > 0) {
        console.log('');
        console.log(`borrados en la nube: ${yaBorrados.join(', ')}`);
    }
    for (const ruta of siguen) console.log(`SIGUE EN LA NUBE: ${ruta}`);
    if (siguen.length > 0) process.exitCode = 1;

    console.log('');
    console.log('--- postverify: vuelto a leer de la NUBE ---');

    /*
     * Primero el RECUENTO por grupo de colección, porque es lo único que ve un hueco.
     *
     * La muestra de más abajo compara contenido, y una muestra no puede decir que falte algo:
     * el 03-11-2026 la subida se quedó en 12.800 de 16.118, y si no hubiera fallado en voz alta
     * una muestra de uno de cada siete habría dado la pasada por buena. Un recuento igualado es
     * lo que dice que no falta ningún documento.
     */
    let faltan = 0;
    console.log('');
    for (const [grupo, cuantos] of [...grupos].sort()) {
        const enLaNube = (await nube.collectionGroup(grupo).count().get()).data().count;
        const hueco = cuantos - enLaNube;
        if (hueco > 0) faltan += hueco;
        console.log(
            `${String(cuantos).padStart(6)} local  ${String(enLaNube).padStart(6)} nube   ` +
                `${grupo}${hueco > 0 ? `   FALTAN ${hueco}` : ''}`
        );
    }

    /*
     * Y después TODOS los documentos subidos, releídos por tandas y comparados por su forma canónica
     * (auditoría del 16-11-2026, PLA-5). Antes era uno de cada siete y con `JSON.stringify`, que depende
     * del orden de las claves: una muestra no dice que falte uno, ni cuál ha quedado distinto.
     */
    console.log('');
    const comparacion = await compararConLaNube(nube, aSubir);
    const ausentes = comparacion.ausentes.length;
    const distintos = comparacion.distintos.length;
    console.log(`comprobados: ${comparacion.comprobados} de ${aSubir.length} (todos)`);
    console.log(`ausentes   : ${ausentes}`);
    for (const ruta of comparacion.ausentes.slice(0, 20)) console.log(`  ausente : ${ruta}`);
    console.log(`distintos  : ${distintos}`);
    for (const ruta of comparacion.distintos.slice(0, 20)) console.log(`  distinto: ${ruta}`);
    console.log(`que faltan : ${faltan}`);
    console.log('');
    console.log(
        ausentes + distintos + faltan === 0
            ? 'La base nueva esta en la nube.'
            : 'HAY DIFERENCIAS: ver arriba.'
    );
    if (ausentes + distintos + faltan > 0) process.exitCode = 1;
}

void main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
        console.error('');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
