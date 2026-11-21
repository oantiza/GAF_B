/**
 * La serie de precios de un instrumento, un documento por año:
 * `instruments/{isin}/price_series/{anio}`.
 *
 * La entrada es lo que deja `python main.py series` en `export_series/`. Una serie con una
 * fecha repetida, desordenada o con un precio no positivo se rechaza entera: arreglarla aquí
 * haría que ya no fuera la serie con la que se calcularon las métricas.
 *
 * Una serie compuesta (decisión D-9: la de EODHD se paró y sigue la de Morningstar) llega con
 * `segments`, que dice qué fechas son de cada fuente. Cada año dice entonces de quién son SUS
 * puntos: `source` es la fuente del año, y en el año en que cambia de una a otra lleva las dos y
 * `source_segments` con sus fechas. El `series_id` es el de la serie entera en todos los años,
 * porque es lo que la une con sus métricas. Unos tramos que no cubren los puntos, se solapan o
 * no cuadran en número rechazan la serie entera, igual que una fecha repetida.
 */
import type { DocumentoMapeado } from './mapper';

const TIPO = 'instrument-price-series.v2.schema.json';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Un tramo de una serie compuesta: de qué listado salen los puntos entre esas dos fechas. */
export interface TramoExportado {
    source: string;
    series_id: string;
    first_date: string;
    last_date: string;
    observations: number;
}

export interface SerieExportada {
    instrument_id: string;
    series_id: string;
    source: string;
    price_class: string;
    currency?: string | null;
    segments?: TramoExportado[];
    points: [string, number][];
}

/** Los tramos, si están: en orden, sin solaparse, cubriendo cada punto y con su número de puntos. */
function comprobarTramos(isin: string, tramos: TramoExportado[], puntos: [string, number][]): string | undefined {
    if (tramos.length === 0) return `${isin}: segments vacio`;
    let finAnterior = '';
    for (const tramo of tramos) {
        if (!FECHA.test(tramo.first_date) || !FECHA.test(tramo.last_date) || tramo.first_date > tramo.last_date) {
            return `${isin}: tramo ${tramo.series_id} con fechas no validas`;
        }
        if (tramo.first_date <= finAnterior) return `${isin}: tramo ${tramo.series_id} solapado con el anterior`;
        if (typeof tramo.source !== 'string' || tramo.source === '' || typeof tramo.series_id !== 'string' || tramo.series_id === '') {
            return `${isin}: tramo sin fuente o sin serie`;
        }
        const dentro = puntos.filter(([fecha]) => fecha >= tramo.first_date && fecha <= tramo.last_date).length;
        if (dentro !== tramo.observations) {
            return `${isin}: tramo ${tramo.series_id} dice ${tramo.observations} puntos y tiene ${dentro}`;
        }
        finAnterior = tramo.last_date;
    }
    const fuera = puntos.find(([fecha]) => !tramos.some((t) => fecha >= t.first_date && fecha <= t.last_date));
    return fuera === undefined ? undefined : `${isin}: el punto ${fuera[0]} no cae en ningun tramo`;
}

/** La fuente de un año y, si en él cambia de fuente, sus tramos recortados al año. */
function fuenteDelAnio(
    serie: SerieExportada,
    lista: { date: string; value: number }[]
): { source: string; source_segments?: TramoExportado[] } {
    if (serie.segments === undefined) return { source: serie.source };
    const primera = lista[0]!.date;
    const ultima = lista[lista.length - 1]!.date;
    const delAnio = serie.segments
        .filter((t) => t.last_date >= primera && t.first_date <= ultima)
        .map((t) => {
            const suyos = lista.filter((p) => p.date >= t.first_date && p.date <= t.last_date);
            return {
                source: t.source,
                series_id: t.series_id,
                first_date: suyos[0]!.date,
                last_date: suyos[suyos.length - 1]!.date,
                observations: suyos.length
            };
        })
        .filter((t) => t.observations > 0);
    if (delAnio.length === 1) return { source: delAnio[0]!.source };
    return { source: delAnio.map((t) => t.source).join('+'), source_segments: delAnio };
}

export interface ResultadoDeSerie {
    documentos: DocumentoMapeado[];
    error?: string;
}

export function rutaDelAnio(isin: string, anio: string): string {
    return `instruments/${isin}/price_series/${anio}`;
}

export function componerSerie(serie: SerieExportada): ResultadoDeSerie {
    const { instrument_id: isin, points: puntos } = serie;
    if (puntos.length === 0) return { documentos: [], error: `${isin}: serie sin puntos` };
    if (serie.segments !== undefined) {
        const malTramo = comprobarTramos(isin, serie.segments, puntos);
        if (malTramo !== undefined) return { documentos: [], error: malTramo };
    }

    const porAnio = new Map<string, { date: string; value: number }[]>();
    let anterior = '';
    for (const [fecha, valor] of puntos) {
        if (!FECHA.test(fecha)) return { documentos: [], error: `${isin}: fecha no valida ${fecha}` };
        if (fecha <= anterior) return { documentos: [], error: `${isin}: fecha fuera de orden o repetida ${fecha}` };
        if (!Number.isFinite(valor) || valor <= 0) {
            return { documentos: [], error: `${isin}: precio no positivo en ${fecha}` };
        }
        anterior = fecha;
        const anio = fecha.slice(0, 4);
        const lista = porAnio.get(anio) ?? [];
        lista.push({ date: fecha, value: valor });
        porAnio.set(anio, lista);
    }

    const documentos: DocumentoMapeado[] = [...porAnio].map(([anio, lista]) => ({
        ruta: rutaDelAnio(isin, anio),
        tipo: TIPO,
        documento: {
            instrument_id: isin,
            year: anio,
            series_id: serie.series_id,
            ...fuenteDelAnio(serie, lista),
            price_class: serie.price_class,
            ...(serie.currency ? { currency: serie.currency } : {}),
            first_date: lista[0]!.date,
            last_date: lista[lista.length - 1]!.date,
            observations: lista.length,
            points: lista
        }
    }));
    return { documentos };
}

/** Lo que deja `python main.py cambios` en `export_fx/`: unidades de la moneda por 1 EUR. */
export interface CambiosExportados {
    currency: string;
    series_key: string;
    source: string;
    points: [string, number][];
}

/** Lo que deja `python main.py cambios` en `export_rf/`: la ESTR, ya en fracción. */
export interface TipoExportado {
    rate: string;
    series_key: string;
    source: string;
    points: [string, number][];
}

export function componerTipoDeReferencia(tipo: TipoExportado): ResultadoDeSerie {
    if (tipo.points.length === 0) return { documentos: [], error: `${tipo.rate}: sin observaciones` };
    const porAnio = new Map<string, { date: string; value: number }[]>();
    let anterior = '';
    for (const [fecha, valor] of tipo.points) {
        if (!FECHA.test(fecha) || fecha <= anterior) {
            return { documentos: [], error: `${tipo.rate}: fecha no valida o fuera de orden ${fecha}` };
        }
        if (!Number.isFinite(valor)) return { documentos: [], error: `${tipo.rate}: valor no numerico en ${fecha}` };
        anterior = fecha;
        const anio = fecha.slice(0, 4);
        const lista = porAnio.get(anio) ?? [];
        lista.push({ date: fecha, value: valor });
        porAnio.set(anio, lista);
    }
    return {
        documentos: [...porAnio].map(([anio, lista]) => ({
            ruta: `reference_rates/${tipo.rate}_${anio}`,
            tipo: 'reference-rate.v2.schema.json',
            documento: {
                rate: tipo.rate,
                year: anio,
                series_key: tipo.series_key,
                source: tipo.source,
                first_date: lista[0]!.date,
                last_date: lista[lista.length - 1]!.date,
                observations: lista.length,
                points: lista
            }
        }))
    };
}

export function rutaDelCambio(moneda: string, anio: string): string {
    return `fx_rates/${moneda}_${anio}`;
}

export function componerCambios(cambios: CambiosExportados): ResultadoDeSerie {
    const { currency: moneda, points: puntos } = cambios;
    if (puntos.length === 0) return { documentos: [], error: `${moneda}: sin cambios` };
    const porAnio = new Map<string, { date: string; value: number }[]>();
    let anterior = '';
    for (const [fecha, valor] of puntos) {
        if (!FECHA.test(fecha) || fecha <= anterior) {
            return { documentos: [], error: `${moneda}: fecha no valida o fuera de orden ${fecha}` };
        }
        if (!Number.isFinite(valor) || valor <= 0) {
            return { documentos: [], error: `${moneda}: cambio no positivo en ${fecha}` };
        }
        anterior = fecha;
        const anio = fecha.slice(0, 4);
        const lista = porAnio.get(anio) ?? [];
        lista.push({ date: fecha, value: valor });
        porAnio.set(anio, lista);
    }
    return {
        documentos: [...porAnio].map(([anio, lista]) => ({
            ruta: rutaDelCambio(moneda, anio),
            tipo: 'fx-reference-rates.v2.schema.json',
            documento: {
                currency: moneda,
                year: anio,
                series_key: cambios.series_key,
                source: cambios.source,
                first_date: lista[0]!.date,
                last_date: lista[lista.length - 1]!.date,
                observations: lista.length,
                points: lista
            }
        }))
    };
}
