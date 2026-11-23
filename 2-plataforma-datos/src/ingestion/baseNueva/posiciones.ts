/**
 * La cartera completa de un fondo, troceada: `instruments/{isin}/holdings_chunks/{nnn}`.
 *
 * `declared/holdings` es el resumen -las 25 primeras y cuánto cubren- y su propia descripción
 * manda la lista entera «al analítico», un almacén que no existe. Lo que costaba, medido el
 * 02-11-2026: de 760 fondos con lista, solo 50 llegaban a explicar el 90 % de su cartera con
 * las 25 guardadas. Con la lista entera llegan 554.
 *
 * Y la lista entera ya se adquiría: 156.665 posiciones en 766 fondos, 204 de media. No era un
 * problema de fuente ni de licencia, era que se quedaba en el disco del extractor.
 *
 * Por qué troceada: el Vanguard Global Bond Index declara 16.974 posiciones y la fuente da
 * 10.000, que a 117 bytes por línea son 1,1 MB, por encima del límite de 1 MiB de un documento
 * de Firestore. 28 fondos pasan de mil posiciones. Un documento que crece con el PRODUCTO es
 * el cuarto techo de la maestra de hoy, y esto existe para no repetirlo.
 */
import { type DocumentoMapeado } from './mapper';

/**
 * Posiciones por trozo. Es el `maxItems` del contrato y el mismo número que el fragmento del
 * índice de búsqueda, por la misma razón: con 500, el fondo más grande son 20 lecturas y el
 * trozo mayor 57 KB; con 200 serían 50 lecturas y 1.300 documentos en vez de 909.
 */
export const POSICIONES_POR_TROZO = 500;

const TIPO = 'instrument-holdings-chunk.v2.schema.json';

/**
 * Por encima de este peso, en fracción y en valor absoluto, una línea no es una fracción del
 * patrimonio de nadie: es un error de escala del proveedor, y no se escribe. Medido el
 * 05-11-2026 sobre 158.721 líneas, lo cumplen dos, las de un forward de yenes con el valor en
 * yenes y su contrapartida (CaixaBank Gestión Tendencias, 3.662 % y −3.663 %). El siguiente es
 * un `Cash Offset` del −480 %, y eso sí es un nocional. Es el tope del contrato: un mapper no
 * emite lo que el contrato rechaza, y dejar pasar la línea tiraría la cartera entera.
 */
export const PESO_MAXIMO_DE_UNA_LINEA = 10;

/** Si el peso de una línea, ya en fracción, se puede escribir. */
export function pesoCreible(peso: number): boolean {
    return Math.abs(peso) <= PESO_MAXIMO_DE_UNA_LINEA;
}

/** Una línea de la cartera tal como la trae el canónico, en porcentaje. */
export interface PosicionCanonica {
    name?: unknown;
    isin?: unknown;
    weight?: unknown;
    sector?: unknown;
    asset_type?: unknown;
    holding_type_code?: unknown;
}

export interface ResultadoDeTrozos {
    documentos: DocumentoMapeado[];
    /** Las rutas que esta pasada produce. El guion las une con las que ya hay en la base. */
    rutas: string[];
    posiciones: number;
    /** Las líneas que no entran por no tener nombre o peso utilizable, contadas. */
    descartadas: number;
    /** Las que no entran por un peso imposible, con su nombre: son un error del proveedor, y se dice cuál. */
    pesosImposibles: string[];
}

function texto(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    const limpio = valor.trim();
    return limpio === '' ? undefined : limpio;
}

/**
 * El peso en fracción, solo de un número o de un texto que diga un número. `Number(null)`,
 * `Number('')`, `Number('  ')` y `Number([])` valen 0, y `Number(true)` vale 1: sin esta
 * criba una línea sin peso entraba con peso 0 —o del 1 %— en vez de contarse como descartada.
 */
function fraccion(valor: unknown): number | undefined {
    let n: number;
    if (typeof valor === 'number') n = valor;
    else if (typeof valor === 'string' && valor.trim() !== '') n = Number(valor);
    else return undefined;
    return Number.isFinite(n) ? n / 100 : undefined;
}

/** La ruta del trozo número `n` de un instrumento, contando desde 0. */
export function rutaDelTrozo(isin: string, n: number): string {
    return `instruments/${isin}/holdings_chunks/${String(n).padStart(3, '0')}`;
}

export function componerTrozos(
    isin: string,
    completa: readonly PosicionCanonica[],
    fuente: string,
    fechaCartera: string
): ResultadoDeTrozos {
    const lineas: Record<string, unknown>[] = [];
    const pesosImposibles: string[] = [];
    let descartadas = 0;
    for (const cruda of completa) {
        const nombre = texto(cruda.name);
        const peso = fraccion(cruda.weight);
        if (nombre === undefined || peso === undefined) {
            /* Sin nombre o sin peso no es una posición: es una fila que no se puede ni
               nombrar ni sumar. Se cuenta, no se escribe con un hueco dentro. */
            descartadas += 1;
            continue;
        }
        if (!pesoCreible(peso)) {
            pesosImposibles.push(nombre);
            continue;
        }
        const linea: Record<string, unknown> = { name: nombre, weight: peso };
        const isinLinea = texto(cruda.isin);
        if (isinLinea !== undefined) linea['isin'] = isinLinea;
        const sector = texto(cruda.sector);
        if (sector !== undefined) linea['sector'] = sector;
        const clase = texto(cruda.asset_type);
        if (clase !== undefined) linea['asset_type'] = clase;
        const codigo = texto(cruda.holding_type_code);
        if (codigo !== undefined) linea['holding_type_code'] = codigo;
        lineas.push(linea);
    }

    const documentos: DocumentoMapeado[] = [];
    const rutas: string[] = [];
    for (let i = 0; i * POSICIONES_POR_TROZO < lineas.length; i += 1) {
        const trozo = lineas.slice(i * POSICIONES_POR_TROZO, (i + 1) * POSICIONES_POR_TROZO);
        const ruta = rutaDelTrozo(isin, i);
        rutas.push(ruta);
        documentos.push({
            ruta,
            tipo: TIPO,
            documento: {
                chunk_id: String(i).padStart(3, '0'),
                source: fuente,
                as_of: fechaCartera,
                positions: trozo
            }
        });
    }

    return { documentos, rutas, posiciones: lineas.length, descartadas, pesosImposibles };
}
