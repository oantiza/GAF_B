/**
 * src/config/baseNueva/esquemas.ts — carga los esquemas de la base nueva y los recorre
 * ruta por ruta.
 *
 * Es la mitad mecánica de las siete comprobaciones: las pruebas de
 * `tests/baseNuevaContratos.test.ts` no saben leer JSON Schema, preguntan aquí. Y es
 * deliberadamente tonto: resuelve `$ref` locales, baja por `properties`, `items` y
 * `additionalProperties`, y devuelve una lista plana de rutas con sus anotaciones. Nada
 * de reglas: las reglas están en las pruebas y el vocabulario en `vocabulario.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { CARPETA_CONTRATOS } from './vocabulario';

/** Un nodo de esquema, sin tipar de más: lo que interesa son sus anotaciones. */
export type NodoEsquema = Record<string, unknown>;

/** Un esquema entero, con el nombre de su fichero. */
export interface EsquemaCargado {
    /** Nombre del fichero, por ejemplo `instrument.v2.schema.json`. */
    fichero: string;
    /** El JSON tal cual. */
    json: NodoEsquema;
    /** La ruta de Firestore que declara (`x-collection`). */
    coleccion: string;
}

/** Una ruta declarada por un esquema. */
export interface RutaDeclarada {
    /** El fichero que la declara. */
    fichero: string;
    /**
     * La ruta con puntos. `*` es una clave libre de un mapa; `[]` es un elemento de lista.
     * Por ejemplo `volatility.3y.fund`, `sectors.*`, `top[].weight`.
     */
    ruta: string;
    /** El nodo, con el `$ref` ya resuelto y las claves hermanas aplicadas encima. */
    nodo: NodoEsquema;
    /** `true` si no tiene hijos: es donde vive un valor. */
    esHoja: boolean;
    tipo: string | undefined;
    unidad: string | undefined;
    capa: string | undefined;
    dueno: string | undefined;
    /** Las claves `required` del objeto que la contiene, para saber si es obligatoria. */
    requeridaPorElPadre: boolean;
    /**
     * `true` si algún antepasado está marcado `x-reference: true`, es decir si la ruta
     * vive dentro de un subárbol que IDENTIFICA A OTRA ENTIDAD (el índice de referencia,
     * por ejemplo). Esos campos no son datos de este documento, son una referencia, y por
     * eso la quinta prueba —un dato, un sitio— no los cuenta.
     */
    bajoReferencia: boolean;
    /**
     * El predicado `x-applies-when` que gobierna esta ruta: el suyo si lo declara, y si no el
     * del antepasado más cercano que lo declare.
     *
     * **Se hereda**, y eso entra el 01-11-2026 con las acciones. Antes cada ruta miraba solo
     * su propio nodo, así que un subárbol marcado en su raíz no gobernaba a sus hijos: el
     * índice de referencia declaraba que es cosa de fondos y sus seis campos de dentro
     * —nombre, divisa, variante, base, resolución, ISIN del proxy— seguían contando como
     * aplicables a una acción, que no tiene folleto donde declarar un índice. Un predicado
     * puesto en un subárbol que no manda en el subárbol no sirve de nada, y la alternativa era
     * repetirlo campo a campo, que es la duplicación que este diseño evita en todo lo demás.
     *
     * Para los fondos no cambia nada: donde hay predicado heredado hoy —`product` y el índice
     * de referencia— el predicado es `FONDO_O_ETF`, que en un fondo es cierto.
     */
    aplicaCuando: string | undefined;
    /**
     * `x-counts-when`, heredado igual: cuándo cuenta en la cobertura una ruta que puede aplicar a
     * más población. Lo lleva `relative`, que desde el 04-11-2026 se rellena también en una
     * acción: sin esto, añadirla movía su cobertura, y eso no se hace sin decirlo (decisiones
     * 15 y 16). Sin declarar, cuenta cuando aplica.
     */
    cuentaCuando: string | undefined;
}

/** La carpeta de los esquemas, absoluta. */
export function carpetaDeEsquemas(): string {
    return path.resolve(__dirname, '..', '..', '..', CARPETA_CONTRATOS);
}

/** Todos los esquemas de la base nueva, ordenados por nombre de fichero. */
export function cargarEsquemas(): EsquemaCargado[] {
    const carpeta = carpetaDeEsquemas();
    return fs
        .readdirSync(carpeta)
        .filter((nombre) => nombre.endsWith('.schema.json'))
        .sort()
        .map((fichero) => {
            const json = JSON.parse(fs.readFileSync(path.join(carpeta, fichero), 'utf-8')) as NodoEsquema;
            return { fichero, json, coleccion: String(json['x-collection'] ?? '') };
        });
}

/**
 * Las colecciones **raíz** que los contratos declaran, con el fichero que las declara.
 *
 * La regla está en el propio `x-collection` y se lee por tramos: `search_shards/{shard_id}`
 * son dos, así que es una colección raíz; `instruments/{isin}/declared/profile` son cuatro,
 * así que no. Nada de listas escritas a mano: un contrato nuevo entra el día que se escribe.
 *
 * Existe porque la auditoría contaba andando desde `instruments` y una colección raíz le era
 * invisible. El 02-11-2026, con el índice de búsqueda recién escrito, seguía diciendo 14.751
 * documentos habiendo 14.754, y no validaba ninguno de sus tres fragmentos.
 */
/**
 * Las colecciones raíz cuyo contrato declara ese dueño (`x-owner`). Con ellas la subida a la nube sabe
 * qué es de la aplicación sin una lista de nombres escrita a mano (auditoría del 16-11-2026, PLA-4).
 */
export function raicesDelDueno(dueno: string): Set<string> {
    const salida = new Set<string>();
    for (const esquema of cargarEsquemas()) {
        const partes = esquema.coleccion.split('/');
        const raiz = partes[0];
        if (partes.length === 2 && raiz !== undefined && raiz !== '' && esquema.json['x-owner'] === dueno) salida.add(raiz);
    }
    return salida;
}

export function coleccionesRaizDeclaradas(): Map<string, string> {
    const salida = new Map<string, string>();
    for (const esquema of cargarEsquemas()) {
        const partes = esquema.coleccion.split('/');
        const raiz = partes[0];
        if (partes.length === 2 && raiz !== undefined && raiz !== '') salida.set(raiz, esquema.fichero);
    }
    return salida;
}

/**
 * Las **subcolecciones** que los contratos declaran, con el fichero que las declara. La clave
 * es la ruta entera con los identificadores puestos a `*`, por ejemplo
 * `portfolios/*‍/targets/*` o `instruments/*‍/declared/costs`.
 *
 * La clave es la ruta COMPLETA y no `raiz/subcoleccion` porque eso colapsaba doce contratos en
 * uno: `instruments/{id}/declared/costs` y `instruments/{id}/declared/profile` comparten la
 * subcolección `declared` y son dos contratos distintos, con un documento fijo cada uno. Y los
 * dos casos conviven: `targets/{instrument_id}` es una colección de muchos documentos iguales,
 * `declared/costs` es un documento con nombre propio.
 *
 * Existe por el mismo defecto una planta más abajo que la ceguera de las colecciones raíz: el
 * 02-11-2026 se escribieron 18 carteras con 220 objetivos y la auditoría contó 18, porque
 * miraba los documentos de la colección raíz y no lo que cuelga de cada uno.
 */
export function subcoleccionesDeclaradas(): Map<string, string> {
    const salida = new Map<string, string>();
    for (const esquema of cargarEsquemas()) {
        const partes = esquema.coleccion.split('/');
        if (partes.length !== 4) continue;
        const clave = partes.map((tramo) => (tramo.startsWith('{') ? '*' : tramo)).join('/');
        salida.set(clave, esquema.fichero);
    }
    return salida;
}

/**
 * Resuelve un `$ref` local (`#/$defs/algo`) contra la raíz del esquema. Las claves
 * hermanas del `$ref` ganan sobre el destino, que es lo que permite reutilizar una
 * definición y afinarle la descripción o el `x-applies-to` en un sitio concreto.
 */
function resolver(nodo: NodoEsquema, raiz: NodoEsquema): NodoEsquema {
    const ref = nodo['$ref'];
    if (typeof ref !== 'string') return nodo;
    if (!ref.startsWith('#/')) return nodo;

    let destino: unknown = raiz;
    for (const tramo of ref.slice(2).split('/')) {
        if (destino === null || typeof destino !== 'object') return nodo;
        destino = (destino as Record<string, unknown>)[tramo];
    }
    if (destino === null || typeof destino !== 'object') return nodo;

    const { $ref: _descartado, ...hermanas } = nodo;
    return { ...(destino as NodoEsquema), ...hermanas };
}

function textoOUndefined(valor: unknown): string | undefined {
    return typeof valor === 'string' ? valor : undefined;
}

/**
 * Recorre un esquema y devuelve todas sus rutas. Lleva una pila de `$ref` ya visitados en
 * la rama actual para no caer en un ciclo si algún día alguien escribe uno.
 */
export function rutasDe(esquema: EsquemaCargado): RutaDeclarada[] {
    const salida: RutaDeclarada[] = [];
    const raiz = esquema.json;

    const bajar = (
        nodoCrudo: NodoEsquema,
        ruta: string,
        requerida: boolean,
        refsEnRama: readonly string[],
        bajoReferenciaHeredado: boolean,
        aplicaCuandoHeredado: string | undefined,
        cuentaCuandoHeredado: string | undefined
    ): void => {
        const ref = textoOUndefined(nodoCrudo['$ref']);
        if (ref && refsEnRama.includes(ref)) return;
        const rama = ref ? [...refsEnRama, ref] : refsEnRama;
        const nodo = resolver(nodoCrudo, raiz);
        const bajoReferencia = bajoReferenciaHeredado || nodo['x-reference'] === true;
        const aplicaCuando = textoOUndefined(nodo['x-applies-when']) ?? aplicaCuandoHeredado;
        const cuentaCuando = textoOUndefined(nodo['x-counts-when']) ?? cuentaCuandoHeredado;

        const propiedades = nodo['properties'];
        const elementos = nodo['items'];
        const libres = nodo['additionalProperties'];
        const hijosLibres = libres !== null && typeof libres === 'object' ? (libres as NodoEsquema) : undefined;
        const requeridas = Array.isArray(nodo['required']) ? (nodo['required'] as string[]) : [];

        const tieneHijos =
            (propiedades !== null && typeof propiedades === 'object') ||
            (elementos !== null && typeof elementos === 'object') ||
            hijosLibres !== undefined;

        if (ruta !== '') {
            salida.push({
                fichero: esquema.fichero,
                ruta,
                nodo,
                esHoja: !tieneHijos,
                tipo: textoOUndefined(nodo['type']),
                unidad: textoOUndefined(nodo['x-unit']),
                capa: textoOUndefined(nodo['x-layer']),
                dueno: textoOUndefined(nodo['x-owner']),
                requeridaPorElPadre: requerida,
                bajoReferencia,
                aplicaCuando,
                cuentaCuando
            });
        }

        if (propiedades !== null && typeof propiedades === 'object') {
            for (const [clave, hijo] of Object.entries(propiedades as Record<string, unknown>)) {
                if (hijo === null || typeof hijo !== 'object') continue;
                const siguiente = ruta === '' ? clave : `${ruta}.${clave}`;
                bajar(
                    hijo as NodoEsquema,
                    siguiente,
                    requeridas.includes(clave),
                    rama,
                    bajoReferencia,
                    aplicaCuando,
                    cuentaCuando
                );
            }
        }
        if (hijosLibres !== undefined) {
            bajar(hijosLibres, ruta === '' ? '*' : `${ruta}.*`, false, rama, bajoReferencia, aplicaCuando, cuentaCuando);
        }
        if (elementos !== null && typeof elementos === 'object') {
            bajar(elementos as NodoEsquema, `${ruta}[]`, false, rama, bajoReferencia, aplicaCuando, cuentaCuando);
        }
    };

    /* La raíz del esquema puede declarar el predicado de todo el documento, y entonces lo
       heredan todas sus rutas: es lo que hace que `declared/costs` no cuente en una acción. */
    bajar(raiz, '', false, [], false, textoOUndefined(raiz['x-applies-when']), undefined);
    return salida;
}

/** Todas las rutas de todos los esquemas. */
export function todasLasRutas(): RutaDeclarada[] {
    return cargarEsquemas().flatMap((esquema) => rutasDe(esquema));
}

/** Todos los nodos de objeto de un esquema, para las reglas de cierre y de tope. */
export function nodosDe(esquema: EsquemaCargado): { ruta: string; nodo: NodoEsquema }[] {
    return rutasDe(esquema).map(({ ruta, nodo }) => ({ ruta, nodo }));
}

/** El último tramo de una ruta, sin `[]` ni `*`. */
export function hojaDe(ruta: string): string {
    const tramos = ruta.split('.');
    const ultimo = tramos[tramos.length - 1] ?? '';
    return ultimo.replace(/\[\]$/, '');
}
