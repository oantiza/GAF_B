/**
 * src/loader/baseNuevaWriter.ts — el escritor de la base nueva. El que SÍ escribe.
 *
 * Cinco barreras en fila, y todas tienen que abrirse. Las tres primeras son las que ya usa
 * la plataforma de hoy; las dos últimas son del contrato de la base nueva:
 *
 *  1. **Puerta de entorno.** `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` con su valor exacto.
 *     Sin ella, cualquier `--write` aborta.
 *  2. **Destino fijo, no validado.** Desde el 01-11-2026 la base nueva tiene proyecto propio
 *     (`PROYECTO_BASE_NUEVA`) y emulador propio (`HOST_EMULADOR_BASE_NUEVA`), y este escritor
 *     los toma de la constante, **no del entorno**. Antes leía `FIREBASE_PROJECT_ID` y lo
 *     comprobaba contra una allowlist; ahora no hay variable que equivocar, que es una
 *     barrera más fuerte que comprobar la variable.
 *  3. **Y si el entorno dice otra cosa, se para.** Una variable puesta a otro proyecto o a
 *     otro puerto no se ignora en silencio: quien la puso esperaba que valiera, así que el
 *     escritor aborta nombrando el conflicto. Ignorarla sería escribir en un sitio distinto
 *     del que pidió el que ejecuta.
 *  4. **Forma.** Cada documento valida contra su esquema antes de salir.
 *  5. **Dueño.** El escritor dice quién es, y no toca lo que no es suyo.
 *
 * Y dos reglas de conservación, que son el motivo de que exista la quinta barrera:
 *
 *  - **Las rutas ajenas se conservan.** `declared/costs._overrides` es `human` dentro de un
 *    documento `platform`: ahí viven las retrocesiones acordadas. El escritor lee lo que
 *    hay, se queda con las claves que no son suyas y las vuelve a poner. Una pasada que no
 *    lo hiciera las borraría sin avisar, y son irreproducibles.
 *  - **Una clave no declarada BLOQUEA el documento, no se borra.** Si lo guardado tiene una
 *    clave raíz que el contrato no declara, ese documento no se escribe y se reporta. Es la
 *    diferencia entre «no sé qué es esto» y «esto sobra».
 */
import * as admin from 'firebase-admin';

import { HOST_EMULADOR_BASE_NUEVA, PROYECTO_BASE_NUEVA } from '../config/projectAllowlist';
import { esquemaDe, rutasAjenas, validarEscritura } from '../config/baseNueva/validadores';
import { rutasDe } from '../config/baseNueva/esquemas';
import type { DocumentoMapeado } from '../ingestion/baseNueva/mapper';
import type { Dueno } from '../config/baseNueva/vocabulario';

export const PUERTA_DE_ENTORNO = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
export const PUERTA_DE_ENTORNO_VALOR = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';

/** Cuántas operaciones por lote. Firestore admite 500; 400 deja margen. */
export const OPERACIONES_POR_LOTE = 400;

/** Primera barrera: la puerta de entorno. */
export function escrituraAutorizada(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[PUERTA_DE_ENTORNO] === PUERTA_DE_ENTORNO_VALOR;
}

/**
 * Por qué no se puede ni CONECTAR: porque el entorno pide otro destino del que la base nueva
 * tiene. Vale también para leer, porque leer el proyecto equivocado tampoco vale.
 *
 * Que la lista salga vacía con el entorno limpio no es un agujero: el destino no se toma del
 * entorno, se toma de la constante. Lo que esta función comprueba es lo único que puede
 * fallar —que alguien haya pedido ir a otro sitio—, y en ese caso se para.
 *
 * La puerta de entorno NO está aquí a propósito: planificar solo lee, y exigir la puerta de
 * escritura para poder ver el plan es al revés —obligaría a armar el gatillo antes de saber
 * qué se va a escribir—.
 */
export function motivosParaNoConectar(env: NodeJS.ProcessEnv = process.env): string[] {
    const motivos: string[] = [];
    const projectId = env['FIREBASE_PROJECT_ID'];
    if (projectId !== undefined && projectId !== '' && projectId !== PROYECTO_BASE_NUEVA) {
        motivos.push(
            `FIREBASE_PROJECT_ID pide '${projectId}', y la base nueva vive en '${PROYECTO_BASE_NUEVA}'. ` +
                'Quita la variable o ponla al proyecto de la base nueva; este escritor no escribe en otra base.'
        );
    }
    const emulador = env['FIRESTORE_EMULATOR_HOST'];
    if (emulador !== undefined && emulador !== '' && emulador !== HOST_EMULADOR_BASE_NUEVA) {
        motivos.push(
            `FIRESTORE_EMULATOR_HOST pide '${emulador}', y el emulador de la base nueva es ` +
                `'${HOST_EMULADOR_BASE_NUEVA}'. Un proyecto correcto contra el puerto de la base vieja ` +
                'escribiria en la base equivocada igual de bien.'
        );
    }
    return motivos;
}

/** Por qué no se puede ESCRIBIR: las dos de conectar, más la puerta de entorno. */
export function motivosParaNoEscribir(env: NodeJS.ProcessEnv = process.env): string[] {
    const motivos = motivosParaNoConectar(env);
    if (!escrituraAutorizada(env)) {
        motivos.push(`falta la puerta de entorno: ${PUERTA_DE_ENTORNO}=${PUERTA_DE_ENTORNO_VALOR}`);
    }
    return motivos;
}

/** El nombre de la app de firebase-admin de la base nueva. */
const APP_BASE_NUEVA = 'base-nueva';

/**
 * Abre la conexión con la base nueva, y solo con ella.
 *
 * Dos detalles que no son cosméticos:
 *
 * - **La app va con nombre.** Con la app por defecto, un proceso que ya hubiera inicializado
 *   firebase-admin apuntando a la base vieja devolvería aquí esa misma conexión, con el
 *   project id de la otra base y sin un solo error. Una app con nombre propio no se puede
 *   heredar por accidente.
 * - **El host del emulador se pone aquí.** El SDK lee `FIRESTORE_EMULATOR_HOST` del entorno
 *   para decidir si habla con el emulador o con la nube; si no estuviera puesto, un
 *   `initializeApp` iría a Firestore de verdad. Lo pone el escritor, no un fichero `.env`
 *   que esta ignorado por Git y que por tanto nadie puede revisar.
 */
export function obtenerDb(env: NodeJS.ProcessEnv = process.env): admin.firestore.Firestore {
    const motivos = motivosParaNoConectar(env);
    if (motivos.length > 0) throw new Error(`conexion bloqueada:\n  - ${motivos.join('\n  - ')}`);
    process.env['FIRESTORE_EMULATOR_HOST'] = HOST_EMULADOR_BASE_NUEVA;
    const existente = admin.apps.find((app) => app?.name === APP_BASE_NUEVA);
    const app = existente ?? admin.initializeApp({ projectId: PROYECTO_BASE_NUEVA }, APP_BASE_NUEVA);
    return app.firestore();
}

/** Las claves raíz que un tipo declara. */
function clavesDeclaradas(tipo: string): Set<string> {
    const esquema = esquemaDe(tipo);
    if (esquema === undefined) return new Set();
    return new Set(
        rutasDe(esquema)
            .filter((ruta) => !ruta.ruta.includes('.') && !ruta.ruta.includes('['))
            .map((ruta) => ruta.ruta)
    );
}

/**
 * Las claves raíz que el contrato declara **retiradas a propósito**, y que por tanto el
 * escritor puede borrar.
 *
 * Es la única puerta de salida de la regla «una clave no declarada bloquea el documento», y
 * tiene que existir, porque si no un campo retirado del contrato deja la base congelada: el
 * 01-11 se retiró `coverage_status` de `quality/latest` y el escritor se negó a tocar los 769
 * documentos ya escritos, con razón. Nombrar la clave aquí es la forma de decir «esto sobra»
 * en vez de «no sé qué es esto», y es el mismo mecanismo que `x-obsolete-root-keys` ya usa en
 * `asset.v1.3` de la maestra de hoy.
 */
function clavesRetiradas(tipo: string): Set<string> {
    const esquema = esquemaDe(tipo);
    const declaradas = esquema?.json['x-obsolete-root-keys'];
    if (!Array.isArray(declaradas)) return new Set();
    return new Set(declaradas.filter((clave): clave is string => typeof clave === 'string'));
}

/** Una operación lista para el lote. */
export interface OperacionDeEscritura {
    ruta: string;
    tipo: string;
    /** Lo que se va a escribir: lo del escritor más las claves ajenas conservadas. */
    documento: Record<string, unknown>;
    /** `crear` si no existía; `reemplazar` si existía y es suyo. */
    accion: 'crear' | 'reemplazar';
    /** Claves que no son del escritor y se conservan tal cual. */
    conservadas: string[];
    /**
     * Como QUIEN se escribio, cuando no es el dueno de la pasada. Viaja hasta aqui para
     * que `verificar` compruebe contra el dueno de VERDAD del dato.
     *
     * Sin esto la verificacion grita en falso: el 01-11-2026 dio 642 documentos
     * "invalidos" —todos los `computed/metrics`— con el motivo "es de batch y escribe
     * platform", cuando estaban escritos exactamente como se planificaron (0 ausentes, 0
     * distintos). Era la verificacion aplicando el dueno de la pasada. Arregle el dueno por
     * documento en el plan y en la escritura y me deje este, que es el tercer sitio. Una
     * verificacion que grita en falso es peor que ninguna, porque la siguiente vez nadie
     * la lee.
     */
    comoDueno?: Dueno;
}

/** Un documento que no se escribe, con el motivo. */
export interface Bloqueado {
    ruta: string;
    tipo: string;
    motivos: string[];
}

export interface PlanDeEscritura {
    operaciones: OperacionDeEscritura[];
    bloqueados: Bloqueado[];
    /**
     * Documentos que están en la base, pertenecen a un instrumento que el escritor sí
     * vuelve a escribir, y **esta pasada ya no los produce**. Son restos de una pasada
     * anterior: un bloque que antes se escribía y ahora no, porque el dato dejó de pasar
     * una comprobación.
     *
     * No se borran. Este escritor no borra nada, igual que el `republish` de hoy, así que
     * lo único correcto es nombrarlos y dejar que alguien decida. Un bloque que se queda
     * atrás es peor que un bloque que falta: parece vigente y no lo es.
     */
    sobrantes: string[];
}

/** Lee lo guardado en bloques, para no hacer una lectura por documento. */
async function leerExistentes(
    db: admin.firestore.Firestore,
    rutas: string[]
): Promise<Map<string, Record<string, unknown> | undefined>> {
    const guardados = new Map<string, Record<string, unknown> | undefined>();
    const tamano = 250;
    for (let i = 0; i < rutas.length; i += tamano) {
        const trozo = rutas.slice(i, i + tamano);
        const refs = trozo.map((ruta) => db.doc(ruta));
        const snaps = await db.getAll(...refs);
        for (let j = 0; j < trozo.length; j += 1) {
            const snap = snaps[j];
            const ruta = trozo[j];
            if (ruta === undefined) continue;
            guardados.set(ruta, snap?.exists === true ? (snap.data() as Record<string, unknown>) : undefined);
        }
    }
    return guardados;
}

/**
 * Decide qué se escribe y qué no, SIN escribir. Es la función que el dry-run y la escritura
 * de verdad comparten, para que lo que se prueba en seco sea lo que luego pasa.
 */
export async function planificar(
    db: admin.firestore.Firestore,
    documentos: readonly DocumentoMapeado[],
    dueno: Dueno,
    /**
     * Todas las rutas que este escritor PODRÍA producir para los instrumentos de esta
     * pasada. Lo que esté en la base y en esta lista pero no en `documentos` es un
     * sobrante. Sin esta lista no se pueden detectar, porque el plan solo sabe de lo que
     * sí se produce.
     */
    rutasPosibles: readonly string[] = []
): Promise<PlanDeEscritura> {
    const operaciones: OperacionDeEscritura[] = [];
    const bloqueados: Bloqueado[] = [];

    const planeadas = new Set(documentos.map((documento) => documento.ruta));
    const aConsultar = [...new Set([...planeadas, ...rutasPosibles])];
    const guardados = await leerExistentes(db, aConsultar);

    const sobrantes = rutasPosibles.filter((ruta) => !planeadas.has(ruta) && guardados.get(ruta) !== undefined);

    for (const documento of documentos) {
        /* El dueno de la PASADA, salvo que el documento diga otro. Lo dicen los que no
           produce la plataforma: `computed/metrics` lo calculo un lote dentro del
           extractor, asi que se escribe como `batch` y la puerta lo comprueba contra el
           dueno de verdad del dato, no contra el del proceso que lo transporta. */
        const duenoDelDoc = documento.comoDueno ?? dueno;
        const veredicto = validarEscritura(documento.tipo, documento.documento, duenoDelDoc);
        if (!veredicto.ok) {
            bloqueados.push({ ruta: documento.ruta, tipo: documento.tipo, motivos: veredicto.motivos });
            continue;
        }

        const guardado = guardados.get(documento.ruta);
        const ajenas = new Set(rutasAjenas(documento.tipo, duenoDelDoc));
        const declaradas = clavesDeclaradas(documento.tipo);
        const retiradas = clavesRetiradas(documento.tipo);

        const conservadas: string[] = [];
        const salida: Record<string, unknown> = { ...documento.documento };
        const noDeclaradas: string[] = [];

        if (guardado !== undefined) {
            for (const clave of Object.keys(guardado)) {
                if (!declaradas.has(clave)) {
                    /* Retirada a proposito: se deja caer con el `set`, sin bloquear. */
                    if (retiradas.has(clave)) continue;
                    noDeclaradas.push(clave);
                    continue;
                }
                if (ajenas.has(clave)) {
                    salida[clave] = guardado[clave];
                    conservadas.push(clave);
                }
            }
        }

        if (noDeclaradas.length > 0) {
            /* No se borra en silencio: se para y se dice. */
            bloqueados.push({
                ruta: documento.ruta,
                tipo: documento.tipo,
                motivos: [`lo guardado tiene claves que el contrato no declara: ${noDeclaradas.join(', ')}`]
            });
            continue;
        }

        operaciones.push({
            ruta: documento.ruta,
            tipo: documento.tipo,
            documento: salida,
            accion: guardado === undefined ? 'crear' : 'reemplazar',
            conservadas,
            /* El dueño del dato acompaña a la operación hasta la verificación: es el
               tercer sitio donde hacía falta y el que se me quedó sin arreglar. */
            ...(documento.comoDueno === undefined ? {} : { comoDueno: documento.comoDueno })
        });
    }

    return { operaciones, bloqueados, sobrantes };
}

export interface ResumenDeEscritura {
    creados: number;
    reemplazados: number;
    lotes: number;
    bloqueados: number;
}

/** Escribe el plan en lotes. `set` sin merge: las claves del escritor se reemplazan enteras. */
export async function escribir(
    db: admin.firestore.Firestore,
    plan: PlanDeEscritura,
    env: NodeJS.ProcessEnv = process.env
): Promise<ResumenDeEscritura> {
    const motivos = motivosParaNoEscribir(env);
    if (motivos.length > 0) throw new Error(`escritura bloqueada:\n  - ${motivos.join('\n  - ')}`);

    let lotes = 0;
    for (let i = 0; i < plan.operaciones.length; i += OPERACIONES_POR_LOTE) {
        const trozo = plan.operaciones.slice(i, i + OPERACIONES_POR_LOTE);
        const lote = db.batch();
        for (const operacion of trozo) lote.set(db.doc(operacion.ruta), operacion.documento);
        await lote.commit();
        lotes += 1;
    }

    return {
        creados: plan.operaciones.filter((operacion) => operacion.accion === 'crear').length,
        reemplazados: plan.operaciones.filter((operacion) => operacion.accion === 'reemplazar').length,
        lotes,
        bloqueados: plan.bloqueados.length
    };
}

export interface ResultadoDeVerificacion {
    comprobados: number;
    ausentes: string[];
    distintos: string[];
    invalidos: string[];
}

/**
 * Serializa con las claves ordenadas, a cualquier profundidad. Hace falta porque Firestore
 * no promete devolver un mapa con el orden en que se escribió, y comparar dos JSON tal cual
 * marcaría como distinto todo lo que solo cambió de orden.
 */
export function canonico(valor: unknown): string {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
    if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
    const entradas = Object.entries(valor as Record<string, unknown>)
        .filter(([, dentro]) => dentro !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([clave, dentro]) => `${JSON.stringify(clave)}:${canonico(dentro)}`);
    return `{${entradas.join(',')}}`;
}

/**
 * Postverify: vuelve a leer lo escrito y lo compara. Sin esto, «escrito» es lo que el
 * cliente de Firestore cree, no lo que hay.
 */
export async function verificar(
    db: admin.firestore.Firestore,
    plan: PlanDeEscritura,
    dueno: Dueno
): Promise<ResultadoDeVerificacion> {
    const ausentes: string[] = [];
    const distintos: string[] = [];
    const invalidos: string[] = [];

    const guardados = await leerExistentes(
        db,
        plan.operaciones.map((operacion) => operacion.ruta)
    );

    for (const operacion of plan.operaciones) {
        const guardado = guardados.get(operacion.ruta);
        if (guardado === undefined) {
            ausentes.push(operacion.ruta);
            continue;
        }
        if (canonico(guardado) !== canonico(operacion.documento)) {
            distintos.push(operacion.ruta);
        }
        const veredicto = validarEscritura(operacion.tipo, guardado, operacion.comoDueno ?? dueno);
        if (!veredicto.ok) invalidos.push(`${operacion.ruta}: ${veredicto.motivos.join('; ')}`);
    }

    return { comprobados: plan.operaciones.length, ausentes, distintos, invalidos };
}
