/**
 * src/ingestion/baseNueva/indice.ts — lee la divisa y la variante del NOMBRE del índice.
 *
 * Lo primero que hay que justificar es por qué esto no es lo mismo que deducir la política de
 * distribución del nombre de un fondo, que está prohibido en este diseño. La diferencia es
 * real:
 *
 * - En un fondo, un «Acc» en el nombre es una **pista** sobre una propiedad que el nombre no
 *   codifica formalmente, y de hecho 540 de 844 clases no dicen nada. Deducirlo es adivinar.
 * - En un índice, `MSCI Europe NR EUR` **es el nombre del índice**, y `NR` y `EUR` son los
 *   sufijos oficiales que lo distinguen de `MSCI Europe GR USD`. Son índices distintos con
 *   nombres distintos, y leerlos es analizar un identificador, no inferir una propiedad
 *   oculta.
 *
 * Aun así, no se da por declarado lo que se ha leído: lo que sale de aquí viaja con
 * `resolution: DERIVED_FROM_NAME`, para que un informe pueda decir de dónde salió y para que
 * una persona pueda corregirlo.
 *
 * Medido el 01-11 sobre los 651 instrumentos con nombre de índice (290 nombres distintos):
 * **528 traen divisa y variante**, 32 solo divisa, 28 solo variante y 63 ninguna de las dos.
 * Y esos 63 **no son índices**: son tipos de interés —«Euro short-term rate», «ESTR»,
 * «Euribor a 3 meses», «Letras del Tesoro a 6 meses»—. Que el análisis falle en ellos es el
 * resultado correcto: contra un tipo del mercado monetario no se calcula un alpha de la misma
 * manera, y quedarse sin divisa ni variante los deja fuera por el camino honesto.
 */
import { BASES_RENTABILIDAD } from '../../config/baseNueva/vocabulario';

/**
 * Las divisas que se admiten en un nombre de índice. Es una lista CORTA a propósito, no la
 * ISO 4217 completa: con la lista completa, un «All» de «MSCI All Country World» se leería
 * como `ALL`, el lek albanés. Las seis primeras son las que aparecen de verdad (EUR 282,
 * USD 263, JPY 9, GBP 3, CHF 2, SEK 1); las otras están por si llegan, y una que no esté
 * deja la divisa ausente en vez de inventarla.
 */
export const DIVISAS_DE_INDICE: readonly string[] = [
    'EUR',
    'USD',
    'JPY',
    'GBP',
    'CHF',
    'SEK',
    'NOK',
    'DKK',
    'CAD',
    'AUD'
];

/**
 * Las variantes, con sus formas de escribirlas. Medido: NR 366, TR 182, PR 4, GR 4.
 *
 * Qué significan, porque de aquí sale la base de rentabilidad: `PR` es *price return*, solo
 * precio; `NR` es *net return*, con los dividendos reinvertidos netos de retención; `GR` es
 * *gross return*, reinvertidos brutos; `TR` es *total return*. Las tres últimas son
 * comparables con una rentabilidad total; la primera, no.
 */
export const VARIANTES_DE_INDICE: Readonly<Record<string, 'NR' | 'GR' | 'PR' | 'TR'>> = {
    NR: 'NR',
    NTR: 'NR',
    NET: 'NR',
    GR: 'GR',
    GROSS: 'GR',
    PR: 'PR',
    PRICE: 'PR',
    TR: 'TR',
    TOTAL: 'TR'
};

/** De la variante del índice a la base de rentabilidad que le corresponde. */
export const BASE_POR_VARIANTE: Readonly<Record<'NR' | 'GR' | 'PR' | 'TR', (typeof BASES_RENTABILIDAD)[number]>> = {
    PR: 'PRICE_RETURN',
    NR: 'TOTAL_RETURN',
    GR: 'TOTAL_RETURN',
    TR: 'TOTAL_RETURN'
};

/** Lo que se ha podido leer del nombre. Lo que no se lee, no sale. */
export interface IndiceLeido {
    name: string;
    currency?: string;
    variant?: 'NR' | 'GR' | 'PR' | 'TR';
    return_basis?: (typeof BASES_RENTABILIDAD)[number];
    /** Cómo se obtuvieron la divisa y la variante. Solo se pone si se ha leído alguna. */
    resolution?: 'DERIVED_FROM_NAME';
}

/**
 * Analiza el nombre de un índice. Se busca el ÚLTIMO token que encaje, porque la divisa y la
 * variante van como sufijo: en `MSCI World NR EUR Hdg` la divisa es `EUR`, y el `Hdg` de
 * después no estorba.
 */
export function leerIndice(nombre: string): IndiceLeido {
    const limpio = nombre.trim();
    const fichas = limpio
        .replace(/[()]/g, ' ')
        .split(/\s+/)
        .map((ficha) => ficha.trim().toUpperCase())
        .filter((ficha) => ficha !== '');

    let divisa: string | undefined;
    let variante: 'NR' | 'GR' | 'PR' | 'TR' | undefined;
    for (let i = fichas.length - 1; i >= 0; i -= 1) {
        const ficha = fichas[i]!;
        if (divisa === undefined && DIVISAS_DE_INDICE.includes(ficha)) divisa = ficha;
        if (variante === undefined && VARIANTES_DE_INDICE[ficha] !== undefined) variante = VARIANTES_DE_INDICE[ficha];
    }

    const salida: IndiceLeido = { name: limpio };
    if (divisa !== undefined) salida.currency = divisa;
    if (variante !== undefined) {
        salida.variant = variante;
        salida.return_basis = BASE_POR_VARIANTE[variante];
    }
    if (divisa !== undefined || variante !== undefined) salida.resolution = 'DERIVED_FROM_NAME';
    return salida;
}
