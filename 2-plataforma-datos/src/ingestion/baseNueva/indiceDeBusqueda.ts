/**
 * El índice de búsqueda: `search_shards/{nnn}`.
 *
 * Es lo que convierte «buscar por nombre» en tres lecturas en vez de 1.076. Medido el
 * 02-11-2026 sobre la pantalla recién hecha: el buscador nuevo de la app lee **las 1.076
 * tarjetas enteras** en cada consulta, porque `name_folded` -el campo que la búsqueda por
 * subcadena necesita- vive en la raíz y no en la tarjeta. Con mil instrumentos se aguanta;
 * es el camino que no escala.
 *
 * Por qué fragmentos y no un documento por activo, que es la forma «natural»: la búsqueda de
 * la app es por SUBCADENA en memoria, así que un documento por activo convierte una lectura
 * en 1.076. Y por qué no un solo documento: reventaría con el universo. El contrato lo tiene
 * dicho desde el diseño y aquí solo se cumple.
 *
 * **El orden es por `instrument_id`, y no es un detalle de estilo.** Es lo único que no
 * cambia nunca: un instrumento se renombra, se recalcula y cambia de tipo, pero su ISIN es
 * suyo. Ordenar por nombre haría que renombrar un fondo reescribiese todos los fragmentos
 * desde el suyo hasta el final, y una pasada que no cambia nada tiene que no escribir nada.
 */
import { plegar, type DocumentoMapeado } from './mapper';
import type { InstrumentoLeido } from './calidadYTarjeta';

/**
 * El tope que fija el contrato (`maxItems: 500`). Va aquí como constante y no como número
 * suelto porque el contrato explica con él su propia aritmética: hoy 3 lecturas, a 5.000
 * activos 10, y ningún documento que crezca con el universo.
 */
export const ENTRADAS_POR_FRAGMENTO = 500;

const TIPO = 'search-shard.v2.schema.json';

/** Una entrada del índice: lo justo para buscar y para pintar la fila del resultado. */
interface EntradaDeIndice {
    instrument_id: string;
    name_folded: string;
    instrument_type: string;
    name?: string;
    ticker?: string;
}

export interface ResultadoDelIndice {
    documentos: DocumentoMapeado[];
    /** Las rutas que esta pasada produce. El guion las une con las que ya existen. */
    rutas: string[];
    entradas: number;
    /**
     * Los instrumentos que NO entran porque no tienen nombre con el que buscarlos. Van
     * nombrados, no contados: un activo que no se puede encontrar es un defecto del dato, y
     * callarlo lo convierte en un activo que no existe. Medido el 02-11-2026: ninguno.
     */
    sinNombre: string[];
    /**
     * Los que traían nombre pero no `name_folded`, y se plegó aquí. Medido el 02-11-2026:
     * ninguno, las 1.076 raíces lo traen. Si algún día deja de ser cero, el plegado de la
     * raíz se ha roto y el índice lo está tapando.
     */
    plegadosAlVuelo: number;
}

function textoDe(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    const limpio = valor.trim();
    return limpio === '' ? undefined : limpio;
}

function entradaDe(instrumento: InstrumentoLeido): { entrada?: EntradaDeIndice; plegado: boolean } {
    const identidad = (instrumento.raiz['identity'] ?? {}) as Record<string, unknown>;
    const identificadores = (instrumento.raiz['identifiers'] ?? {}) as Record<string, unknown>;

    const nombre = textoDe(identidad['name']);
    const guardado = textoDe(identidad['name_folded']);
    const plegado = guardado === undefined && nombre !== undefined;
    const buscable = guardado ?? (nombre === undefined ? undefined : plegar(nombre));
    if (buscable === undefined) return { plegado: false };

    const entrada: EntradaDeIndice = {
        instrument_id: instrumento.instrument_id,
        name_folded: buscable,
        instrument_type: String(instrumento.raiz['instrument_type'] ?? 'OTHER')
    };
    if (nombre !== undefined) entrada.name = nombre;
    const ticker = textoDe(identificadores['ticker']);
    if (ticker !== undefined) entrada.ticker = ticker;
    return { entrada, plegado };
}

/** La ruta del fragmento número `n`, contando desde 0. */
export function rutaDeFragmento(n: number): string {
    return `search_shards/${String(n).padStart(3, '0')}`;
}

export function componerIndice(
    instrumentos: readonly InstrumentoLeido[],
    ahora: string
): ResultadoDelIndice {
    const entradas: EntradaDeIndice[] = [];
    const sinNombre: string[] = [];
    let plegadosAlVuelo = 0;

    for (const instrumento of instrumentos) {
        const { entrada, plegado } = entradaDe(instrumento);
        if (entrada === undefined) {
            sinNombre.push(instrumento.instrument_id);
            continue;
        }
        if (plegado) plegadosAlVuelo += 1;
        entradas.push(entrada);
    }

    /* Comparación de cadenas a pelo, no `localeCompare`: un ISIN es A-Z y 0-9, y el orden
       local mete reglas -dígitos junto a letras, mayúsculas junto a minúsculas- que cambian
       con el idioma de la máquina. Un índice que se reordena según dónde corra no es un
       índice. */
    entradas.sort((a, b) => (a.instrument_id < b.instrument_id ? -1 : a.instrument_id > b.instrument_id ? 1 : 0));

    const documentos: DocumentoMapeado[] = [];
    const rutas: string[] = [];
    for (let i = 0; i * ENTRADAS_POR_FRAGMENTO < entradas.length; i += 1) {
        const trozo = entradas.slice(i * ENTRADAS_POR_FRAGMENTO, (i + 1) * ENTRADAS_POR_FRAGMENTO);
        const ruta = rutaDeFragmento(i);
        rutas.push(ruta);
        documentos.push({
            ruta,
            tipo: TIPO,
            documento: {
                shard_id: String(i).padStart(3, '0'),
                computed_at: ahora,
                entries: trozo
            }
        });
    }

    return { documentos, rutas, entradas: entradas.length, sinNombre, plegadosAlVuelo };
}
