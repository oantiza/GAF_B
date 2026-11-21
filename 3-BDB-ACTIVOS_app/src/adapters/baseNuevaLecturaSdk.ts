/**
 * El camino de PRODUCCIÓN a la base nueva: el SDK de Firestore contra el proyecto real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY DOS CAMINOS Y NO UNO
 *
 * En desarrollo, `baseNuevaLectura` habla REST con el emulador de la base nueva (8092) con
 * `Bearer owner`, un token que **solo el emulador acepta** y que salta las reglas. Eso no
 * sirve en la nube, y no por capricho: ahí no existe ese token, y las reglas —escritas y
 * probadas el 02-11-2026— exigen sesión.
 *
 * Y el emulador del proyecto que usa el resto de la aplicación es OTRO (8082), así que en
 * desarrollo el SDK de la aplicación apunta a una base distinta de la que queremos leer. Por
 * eso el reparto es por entorno y no por configuración: desarrollo siempre REST, producción
 * siempre SDK. Lo que hace imposible equivocarse es que el camino REST no existe fuera de
 * `import.meta.env.DEV` y este solo se carga cuando la aplicación está configurada contra
 * `bdb-gestor-de-activos`.
 *
 * ESTE MÓDULO SE CARGA PEREZOSO. El presupuesto del paquete principal está en 126,9 KiB de
 * 130, así que las funciones de consulta del SDK entran en su propio trozo y solo cuando una
 * pantalla las pide de verdad.
 * ────────────────────────────────────────────────────────────────────────────
 */
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    type Firestore
} from "firebase/firestore";

import { firestore } from "../firebase";
import type { Documento } from "./baseNuevaLectura";

/** El tope de cada consulta. Son los mismos números que el camino de desarrollo. */
const TOPE_TARJETAS = 5000;
const TOPE_CALIDADES = 5000;

/** Lo que lee el asesor cuando la aplicación no puede abrir la base de datos. */
export const MENSAJE_SIN_CONEXION =
    "No se puede abrir la base de datos de la aplicación. Recarga la página y, si sigue igual, avisa al administrador.";

function base(): Firestore {
    if (firestore === null) {
        /* Lo técnico, a la consola del desarrollador; el asesor lee solo lo que puede hacer (FMT-22). */
        console.error(
            "La base nueva no tiene conexión: la aplicación no está configurada contra " +
                "bdb-gestor-de-activos. Revisa VITE_FIREBASE_PROJECT_ID."
        );
        throw new Error(MENSAJE_SIN_CONEXION);
    }
    return firestore;
}

/** Un documento, o `undefined` si no existe. Que no exista es información, no un error. */
export async function leerDocumento(ruta: string): Promise<Documento | undefined> {
    const instantanea = await getDoc(doc(base(), ruta));
    return instantanea.exists() ? (instantanea.data() as Documento) : undefined;
}

/** El documento de un año de la serie, por id, o `undefined` si ese año no existe. El SDK no tiene máscara de campos: viaja el año entero. */
export async function leerAnioDeLaSerie(isin: string, anio: number): Promise<Documento | undefined> {
    return leerDocumento(`instruments/${isin}/price_series/${anio}`);
}

/** Los documentos de una colección, en el orden de su id. Vacía si no existe. */
export async function listarColeccion(ruta: string): Promise<Array<{ id: string; documento: Documento }>> {
    const instantanea = await getDocs(collection(base(), ruta));
    return instantanea.docs
        .map((d) => ({ id: d.id, documento: d.data() as Documento }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Las tarjetas de lectura, de una consulta de grupo.
 *
 * Una diferencia con el camino de desarrollo que conviene saber: el SDK **no tiene máscara de
 * campos**, así que aquí viaja la tarjeta entera y allí solo las columnas de la lista. Medido
 * el 02-11-2026, las 1.091 tarjetas completas son 2,6 MB. En la nube eso son además 1.091
 * lecturas facturadas por visita, y el arreglo ya está escrito en la base: `search_shards`
 * son 3 documentos con las mismas entradas. Esta función es el camino honesto mientras el
 * buscador no lo use.
 */
export async function listarTarjetas(): Promise<Documento[]> {
    const consulta = query(collectionGroup(base(), "read"), limit(TOPE_TARJETAS));
    const instantanea = await getDocs(consulta);
    return instantanea.docs.map((d) => d.data() as Documento);
}

/** Las calidades, de una consulta de grupo. Es la lectura más pesada de la aplicación. */
export async function listarCalidades(): Promise<Documento[]> {
    const consulta = query(collectionGroup(base(), "quality"), limit(TOPE_CALIDADES));
    const instantanea = await getDocs(consulta);
    return instantanea.docs.map((d) => d.data() as Documento);
}
