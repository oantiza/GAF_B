/**
 * Qué parte de la base es cada colección cuando se sube a la nube, y la comparación de lo subido.
 *
 * Vive aparte del guion `subirALaNube.ts` para poder probarse: el guion habla con la nube y no se
 * ejecuta en una prueba.
 *
 * **Las partes** (auditoría del 16-11-2026, PLA-4). La parte `catalogo` era «todo lo que no sea
 * carteras, retrocesiones ni planes», por nombre. Una colección nueva caía en ella sin que nadie lo
 * decidiera, y `catalogo` es la única parte que se sube sin `--piso-lo-de-la-app`, también en la subida
 * automática del refresco. `clients` es de la aplicación (`x-owner: app`) y hoy no tiene escritor: el
 * día que la aplicación la edite en la nube, un refresco la habría pisado con la copia local.
 *
 * Ahora lo decide el dueño que declara el contrato de la colección: **lo que es de la aplicación nunca
 * es catálogo**. Lo que es de la aplicación y no tiene parte propia solo sube con `--parte todo`, que ya
 * pide el piso. Las colecciones de `human` siguen en el catálogo: su dato se cura en ficheros del
 * repositorio y lo escribe la plataforma (los alias de un ISIN retirado, la política del emisor).
 *
 * **La comparación** (PLA-5). Después de subir se releía uno de cada siete documentos y se comparaba
 * con `JSON.stringify`, que depende del orden de las claves. Una muestra no puede decir que falte algo
 * ni que un documento concreto haya quedado distinto. Ahora se releen todos, por tandas, y se comparan
 * con la misma forma canónica que usa el escritor.
 */
import { canonico } from '../../loader/baseNuevaWriter';
import { COLECCION_PLANES } from './planes';
import { COLECCION_IMPORTACIONES, COLECCION_RETROCESIONES } from './retrocesiones';

export type Parte = 'catalogo' | 'planes' | 'carteras' | 'retrocesiones' | 'todo';
export const PARTES: readonly Parte[] = ['catalogo', 'planes', 'carteras', 'retrocesiones', 'todo'];
/** Las partes que la aplicación no edita en la nube: subirlas no pisa nada de nadie. */
export const PARTES_QUE_NO_PISAN: readonly Parte[] = ['catalogo', 'planes'];
export const COLECCION_DE_LAS_CARTERAS = 'portfolios';

/** De quién es una colección raíz a efectos de la subida. `de-la-app` es de la aplicación y sin parte propia. */
export type ClaseDeColeccion = 'carteras' | 'retrocesiones' | 'planes' | 'catalogo' | 'de-la-app';

export function claseDeLaColeccion(raiz: string | undefined, raicesDeLaApp: ReadonlySet<string>): ClaseDeColeccion {
    if (raiz === COLECCION_RETROCESIONES || raiz === COLECCION_IMPORTACIONES) return 'retrocesiones';
    if (raiz === COLECCION_DE_LAS_CARTERAS) return 'carteras';
    if (raiz === COLECCION_PLANES) return 'planes';
    if (raiz !== undefined && raicesDeLaApp.has(raiz)) return 'de-la-app';
    return 'catalogo';
}

/** Si los documentos de esa colección raíz entran en la parte pedida. */
export function entraEnLaParte(parte: Parte, raiz: string | undefined, raicesDeLaApp: ReadonlySet<string>): boolean {
    return parte === 'todo' || claseDeLaColeccion(raiz, raicesDeLaApp) === parte;
}

/** Lo mínimo de la base que hace falta para releer documentos por tandas. */
export interface BaseQueRelee<Referencia> {
    doc(ruta: string): Referencia;
    getAll(...referencias: Referencia[]): Promise<ReadonlyArray<{ exists: boolean; data(): unknown }>>;
}

export interface ComparacionConLaNube {
    comprobados: number;
    /** Rutas subidas que al releer no están. */
    ausentes: string[];
    /** Rutas que están con otro contenido. */
    distintos: string[];
}

/** Cuántos documentos se releen en cada petición. */
export const TAMANO_DE_LA_RELECTURA = 300;

/**
 * Relee de la nube TODOS los documentos subidos y los compara con lo que se subió, por su forma
 * canónica: el orden de las claves no cuenta, el contenido sí.
 */
export async function compararConLaNube<Referencia>(
    base: BaseQueRelee<Referencia>,
    subidos: ReadonlyArray<{ ruta: string; datos: unknown }>,
    tamano: number = TAMANO_DE_LA_RELECTURA
): Promise<ComparacionConLaNube> {
    const ausentes: string[] = [];
    const distintos: string[] = [];
    for (let desde = 0; desde < subidos.length; desde += tamano) {
        const tanda = subidos.slice(desde, desde + tamano);
        const leidos = await base.getAll(...tanda.map((documento) => base.doc(documento.ruta)));
        if (leidos.length !== tanda.length) {
            throw new Error(`la relectura devolvio ${leidos.length} documentos de ${tanda.length} pedidos.`);
        }
        tanda.forEach((documento, i) => {
            const leido = leidos[i];
            if (leido === undefined || !leido.exists) ausentes.push(documento.ruta);
            else if (canonico(leido.data()) !== canonico(documento.datos)) distintos.push(documento.ruta);
        });
    }
    return { comprobados: subidos.length, ausentes, distintos };
}
