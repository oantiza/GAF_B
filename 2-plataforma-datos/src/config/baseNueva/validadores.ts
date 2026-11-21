/**
 * src/config/baseNueva/validadores.ts — la puerta de escritura de la base nueva.
 *
 * Dos puertas, no una, y las dos tienen que abrirse:
 *
 * 1. **Forma.** El documento valida contra su esquema de `contracts/base-nueva/`. Si no
 *    valida, no se escribe. Esto es lo que hace que la primera comprobación —cobertura— no
 *    sea una promesa: con `additionalProperties: false` en todos los objetos, una ruta que
 *    el contrato no declara hace fallar la validación aquí, antes de tocar Firestore.
 *
 * 2. **Dueño.** El escritor dice quién es, y el contrato dice quién puede escribir ese
 *    documento y qué rutas de dentro son de otro. Hoy el `republish` lleva esa lógica en
 *    `src/loader/ownership.ts` leyendo `x-owner` de `asset.v1.3`; esto es lo mismo
 *    extendido, no un mecanismo nuevo.
 *
 * Nada de este módulo escribe en ninguna parte: decide si se puede.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import { cargarEsquemas, rutasDe, type EsquemaCargado } from './esquemas';
import type { Dueno } from './vocabulario';

/** El veredicto de una puerta. */
export interface Veredicto {
    ok: boolean;
    /** Por qué no, en palabras, una por motivo. */
    motivos: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const ESQUEMAS: readonly EsquemaCargado[] = cargarEsquemas();
const COMPILADOS = new Map<string, ValidateFunction>();
for (const esquema of ESQUEMAS) {
    COMPILADOS.set(esquema.fichero, ajv.compile(esquema.json));
}

/** Los nombres de los esquemas, que es como se nombra un tipo de documento. */
export const TIPOS_DE_DOCUMENTO: readonly string[] = ESQUEMAS.map((esquema) => esquema.fichero);

/** El esquema de un tipo, o `undefined` si ese tipo no existe. */
export function esquemaDe(tipo: string): EsquemaCargado | undefined {
    return ESQUEMAS.find((esquema) => esquema.fichero === tipo);
}

/** Traduce un error de ajv a una línea legible. */
function enPalabras(error: ErrorObject): string {
    const donde = error.instancePath === '' ? '<raiz>' : error.instancePath;
    const extra = error.params !== undefined ? ` ${JSON.stringify(error.params)}` : '';
    return `${donde}: ${error.message ?? 'no valida'}${extra}`;
}

/** Primera puerta: la forma. */
export function validarForma(tipo: string, documento: unknown): Veredicto {
    const valida = COMPILADOS.get(tipo);
    if (valida === undefined) {
        return { ok: false, motivos: [`no hay contrato para el tipo ${tipo}`] };
    }
    const ok = valida(documento) as boolean;
    if (ok) return { ok: true, motivos: [] };
    return { ok: false, motivos: (valida.errors ?? []).map(enPalabras) };
}

/**
 * Las rutas de primer nivel de un tipo que NO son del dueño que pregunta. Son las que un
 * escritor tiene que conservar tal cual: si las reescribe, borra la decisión de otro.
 *
 * El caso que lo justifica: `declared/costs._overrides` es `x-owner: human` dentro de un
 * documento `x-owner: platform`. Ahí viven las retrocesiones acordadas, que hoy están en
 * `1-extractor/config/correcciones.json`, fuera de la base y sin autor ni fecha. Una pasada
 * del `republish` que no sepa esto las borra en silencio.
 */
export function rutasAjenas(tipo: string, dueno: Dueno): string[] {
    const esquema = esquemaDe(tipo);
    if (esquema === undefined) return [];
    return rutasDe(esquema)
        .filter((ruta) => !ruta.ruta.includes('.') && !ruta.ruta.includes('['))
        .filter((ruta) => ruta.dueno !== undefined && ruta.dueno !== dueno)
        .map((ruta) => ruta.ruta);
}

/** El rango que el contrato declara para una ruta. */
export interface Rango {
    minimum?: number;
    maximum?: number;
}

const RANGOS = new Map<string, Map<string, Rango>>();
for (const esquema of ESQUEMAS) {
    const porRuta = new Map<string, Rango>();
    for (const ruta of rutasDe(esquema)) {
        const minimo = ruta.nodo['minimum'];
        const maximo = ruta.nodo['maximum'];
        if (typeof minimo === 'number' || typeof maximo === 'number') {
            porRuta.set(ruta.ruta, {
                ...(typeof minimo === 'number' ? { minimum: minimo } : {}),
                ...(typeof maximo === 'number' ? { maximum: maximo } : {})
            });
        }
    }
    RANGOS.set(esquema.fichero, porRuta);
}

/**
 * El rango declarado para una ruta de un tipo, leído del contrato.
 *
 * Existe para que el mapper no tenga que repetirlo. La regla que habilita: **un mapper no
 * emite nunca un valor que el contrato rechaza**; si el canónico trae uno, lo deja fuera y
 * lo cuenta. Si el rango estuviera escrito en los dos sitios, el día que cambiara uno el
 * otro se quedaría atrás y volveríamos a tener dos verdades.
 */
export function rangoDe(tipo: string, ruta: string): Rango | undefined {
    return RANGOS.get(tipo)?.get(ruta);
}

/** `true` si el valor cabe en el rango que el contrato declara para esa ruta. */
export function enRango(tipo: string, ruta: string, valor: number): boolean {
    const rango = rangoDe(tipo, ruta);
    if (rango === undefined) return true;
    if (rango.minimum !== undefined && valor < rango.minimum) return false;
    if (rango.maximum !== undefined && valor > rango.maximum) return false;
    return true;
}

/** El campo donde un contrato anota las cifras que aparta por su rango (decisión B-73). */
export const CAMPO_FUERA_DE_RANGO = 'out_of_range';

/** Una cifra que el contrato rechaza por su rango, con su ruta en tramos y el límite que rebasa. */
export interface CifraFueraDeRango {
    /** La ruta dentro del documento, por ejemplo `['annualized_return', '1y']`. */
    tramos: string[];
    valor: number;
    /** El techo si el valor es mayor; el suelo si es menor. */
    limite: number;
}

/**
 * Las rutas que cada contrato sabe apartar: las que declara bajo `out_of_range` con un `value`.
 * Se leen del contrato para que el mapper no lleve otra lista: una cifra que el contrato no
 * sabe anotar no se aparta, y sigue bloqueando el documento como antes.
 */
const APARTABLES = new Map<string, Set<string>>();
for (const esquema of ESQUEMAS) {
    const prefijo = `${CAMPO_FUERA_DE_RANGO}.`;
    const rutas = rutasDe(esquema)
        .map((ruta) => ruta.ruta)
        .filter((ruta) => ruta.startsWith(prefijo) && ruta.endsWith('.value'))
        .map((ruta) => ruta.slice(prefijo.length, -'.value'.length));
    if (rutas.length > 0) APARTABLES.set(esquema.fichero, new Set(rutas));
}

/** Las rutas que un tipo sabe apartar por rango, con puntos (`annualized_return.1y`). */
export function rutasApartables(tipo: string): ReadonlySet<string> {
    return APARTABLES.get(tipo) ?? new Set();
}

const PALABRAS_DE_RANGO = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']);

function leerTramos(raiz: unknown, tramos: readonly string[]): unknown {
    let actual: unknown = raiz;
    for (const tramo of tramos) {
        if (actual === null || typeof actual !== 'object') return undefined;
        actual = (actual as Record<string, unknown>)[tramo];
    }
    return actual;
}

/**
 * Las cifras de un documento que su contrato rechaza POR RANGO, según el propio validador del
 * contrato. No hay un límite escrito aquí: lo pone ajv al aplicar el esquema, condicionales
 * incluidos, así que el límite de una acción y el de un fondo salen del `allOf` del contrato y
 * no de una copia. Si dos ramas rechazan la misma cifra, vale la más estrecha.
 */
export function cifrasFueraDeRango(tipo: string, documento: unknown): CifraFueraDeRango[] {
    const valida = COMPILADOS.get(tipo);
    if (valida === undefined || (valida(documento) as boolean)) return [];
    const porRuta = new Map<string, CifraFueraDeRango>();
    for (const error of valida.errors ?? []) {
        if (!PALABRAS_DE_RANGO.has(error.keyword)) continue;
        const limite = (error.params as { limit?: unknown }).limit;
        if (typeof limite !== 'number') continue;
        const tramos = error.instancePath
            .split('/')
            .slice(1)
            .map((tramo) => tramo.replace(/~1/g, '/').replace(/~0/g, '~'));
        const valor = leerTramos(documento, tramos);
        if (typeof valor !== 'number') continue;
        const clave = tramos.join('.');
        const previa = porRuta.get(clave);
        const masEstrecho = previa === undefined || (valor > limite ? limite < previa.limite : limite > previa.limite);
        if (masEstrecho) porRuta.set(clave, { tramos, valor, limite });
    }
    return [...porRuta.values()];
}

/** Lo que queda de un documento tras apartar sus cifras fuera de rango, y lo apartado. */
export interface DocumentoApartado {
    documento: Record<string, unknown>;
    apartadas: CifraFueraDeRango[];
}

/**
 * Decisión B-73 (Óscar, 09-11-2026): una cifra fuera de rango bloquea solo su ventana, no el
 * documento. Quita del documento cada cifra que el contrato rechaza por rango y sabe anotar, y
 * la anota en `out_of_range` con la misma ruta, su valor y su límite. Lo demás no se toca: si el
 * documento falla por otra cosa, sigue fallando en la puerta de forma.
 *
 * No recorta nada al límite: recortar sería publicar una cifra que no calculamos.
 */
export function apartarFueraDeRango(tipo: string, documento: Record<string, unknown>): DocumentoApartado {
    const apartables = rutasApartables(tipo);
    if (apartables.size === 0) return { documento, apartadas: [] };
    const apartadas = cifrasFueraDeRango(tipo, documento).filter((cifra) => apartables.has(cifra.tramos.join('.')));
    if (apartadas.length === 0) return { documento, apartadas: [] };

    const copia = JSON.parse(JSON.stringify(documento)) as Record<string, unknown>;
    const anotadas = (copia[CAMPO_FUERA_DE_RANGO] ?? {}) as Record<string, unknown>;
    for (const { tramos, valor, limite } of apartadas) {
        /* Fuera del documento, y los objetos que se queden vacíos con ella. */
        const padres: Record<string, unknown>[] = [copia];
        for (const tramo of tramos.slice(0, -1)) padres.push(padres[padres.length - 1]![tramo] as Record<string, unknown>);
        delete padres[padres.length - 1]![tramos[tramos.length - 1]!];
        for (let i = padres.length - 1; i > 0; i -= 1) {
            if (Object.keys(padres[i]!).length > 0) break;
            delete padres[i - 1]![tramos[i - 1]!];
        }
        /* Y a su sitio en la anotación, con la misma forma. */
        let destino = anotadas;
        for (const tramo of tramos.slice(0, -1)) {
            destino[tramo] ??= {};
            destino = destino[tramo] as Record<string, unknown>;
        }
        destino[tramos[tramos.length - 1]!] = { value: valor, limit: limite };
    }
    copia[CAMPO_FUERA_DE_RANGO] = anotadas;
    return { documento: copia, apartadas };
}

/** `true` si ese dueño es el del documento entero. */
export function puedeEscribir(tipo: string, dueno: Dueno): boolean {
    const esquema = esquemaDe(tipo);
    if (esquema === undefined) return false;
    return esquema.json['x-owner'] === dueno;
}

/**
 * Segunda puerta: el dueño. Falla si el escritor no es el dueño del documento, o si el
 * documento que trae incluye una ruta de primer nivel que pertenece a otro.
 */
export function validarDueno(tipo: string, documento: unknown, dueno: Dueno): Veredicto {
    const esquema = esquemaDe(tipo);
    if (esquema === undefined) return { ok: false, motivos: [`no hay contrato para el tipo ${tipo}`] };

    const motivos: string[] = [];
    if (esquema.json['x-owner'] !== dueno) {
        motivos.push(`${tipo} es de ${String(esquema.json['x-owner'])} y escribe ${dueno}`);
    }
    if (documento !== null && typeof documento === 'object') {
        const presentes = Object.keys(documento as Record<string, unknown>);
        for (const ajena of rutasAjenas(tipo, dueno)) {
            if (presentes.includes(ajena)) motivos.push(`${tipo}.${ajena} no es de ${dueno}`);
        }
    }
    return { ok: motivos.length === 0, motivos };
}

/** Las dos puertas, en orden. Es la única función que debería llamar un escritor. */
export function validarEscritura(tipo: string, documento: unknown, dueno: Dueno): Veredicto {
    const forma = validarForma(tipo, documento);
    const propiedad = validarDueno(tipo, documento, dueno);
    return { ok: forma.ok && propiedad.ok, motivos: [...forma.motivos, ...propiedad.motivos] };
}
