/**
 * src/ingestion/baseNueva/emisorDeEtf.ts — el bloque `emisor.*` del extractor en la base nueva
 * (decisiones 51 y 52 de Óscar, 08-11-2026).
 *
 * Tres documentos, y ninguno sustituye a nada:
 *
 * - `declared/issuer_data`: lo que declara el emisor (TER, swap, réplica, índice, patrimonio, cartera, repartos).
 * - `issuer_nav/{año}`: su serie de VL, aparte de `price_series` para que nunca entre en las métricas (método, §11).
 * - `computed/premium_discount`: la prima o el descuento frente a esa serie, o por qué no se publica.
 *
 * El VL del emisor es dato declarado y las métricas de un ETF siguen sobre precio de mercado. Las funciones son puras salvo
 * `leerEntradasDelEmisor`, que lee los ficheros de la pasada.
 */
import * as fs from 'fs';
import * as path from 'path';

import { enRango } from '../../config/baseNueva/validadores';
import type { Ausencia } from '../../config/baseNueva/vocabulario';
import { FUENTE_FX } from '../../config/baseNueva/vocabulario';
import { en, fecha, frac, limpiar, num, obj, txt, type DocumentoMapeado, type RegistroUniversal } from './mapper';
import type { SerieExportada, CambiosExportados } from './series';
import {
    CLASE_DE_SERIE_DEL_EMISOR,
    MOTIVO_SIN_ANCLAJE,
    NATURALEZA_DE_LA_CARTERA,
    ORIGEN_DE_LA_DIVISA_DEL_REPARTO,
    POLITICA_DEL_EMISOR,
    REPLICA_DEL_EMISOR,
    TIPO_PRODUCTO,
    type ClaseDeSerieDelEmisor
} from './traducciones';

const TIPO_DATOS = 'instrument-declared-issuer-data.v2.schema.json';
const TIPO_VL = 'instrument-issuer-nav.v2.schema.json';
const TIPO_PRIMA = 'instrument-computed-premium-discount.v2.schema.json';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIVISA = /^[A-Z]{3}$/;

/** Menos observaciones comunes que esto en doce meses no es un año de prima (unas 252 sesiones). */
export const MINIMO_DE_OBSERVACIONES = 200;
/** Una prima de más del 20 % no es una prima: es una línea, un desdoblamiento o una divisa que no cuadran. */
export const PRIMA_MAXIMA_CREIBLE = 0.2;

export type MotivoSinPrima =
    | 'ISSUER_SERIES_IS_CUMULATIVE_RETURN'
    | 'DERIVED_WITHOUT_ANCHOR'
    | 'NO_MARKET_SERIES'
    | 'NO_NAV_POINTS'
    | 'DISTRIBUTIONS_UNAVAILABLE'
    | 'DISTRIBUTION_CURRENCY_MISMATCH'
    | 'NO_FX_RATE'
    | 'INSUFFICIENT_OVERLAP'
    | 'SCALE_MISMATCH';

export type TablaDeCambios = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Un punto de `series.vl_emisor`: `{fecha, vl}` o, en la rentabilidad acumulada, `{fecha, crecimiento}`. */
export interface PuntoVlEmisor {
    fecha?: unknown;
    vl?: unknown;
    crecimiento?: unknown;
}

/** Lo que se lee de la pasada para un instrumento y no viaja en el documento ligero. */
export interface EntradasDelEmisor {
    puntosDeVl?: PuntoVlEmisor[] | undefined;
    serieDeMercado?: SerieExportada | undefined;
    cambios: TablaDeCambios;
}

export interface ResultadoDelEmisor {
    documentos: DocumentoMapeado[];
    ausencias: { ruta: string; razon: Ausencia; detalle?: string }[];
    avisos: string[];
    /** Datos del bloque que el contrato no sabe guardar. Se cuentan, no se tiran callados. */
    perdidas: string[];
}

/** Una traducción que no se conoce deja fuera ese dato, con aviso: no para el instrumento. */
function traduceONada<T>(tabla: Readonly<Record<string, T>>, valor: unknown, nombre: string, avisos: string[]): T | undefined {
    if (valor === undefined || valor === null) return undefined;
    const traducido = typeof valor === 'string' ? tabla[valor] : undefined;
    if (traducido === undefined) avisos.push(`${nombre}: no se sabe traducir ${JSON.stringify(valor)}, fuera`);
    return traducido;
}

/** La divisa si tiene forma de divisa. */
function divisa(valor: unknown): string | undefined {
    const t = txt(valor);
    return t !== undefined && DIVISA.test(t) ? t : undefined;
}

function importeConFecha(valor: unknown): Record<string, unknown> | undefined {
    const dato = obj(valor);
    const aum = num(dato['valor']);
    const moneda = divisa(dato['divisa']);
    const dia = fecha(dato['fecha']);
    if (aum === undefined || aum < 0 || moneda === undefined || dia === undefined) return undefined;
    return { aum, currency: moneda, as_of: dia };
}

/** Un número que cabe en el rango del contrato, o nada, con aviso. */
function enElContrato(ruta: string, valor: number | undefined, avisos: string[]): number | undefined {
    if (valor === undefined) return undefined;
    if (enRango(TIPO_DATOS, ruta, valor)) return valor;
    avisos.push(`declared/issuer_data.${ruta} fuera del rango del contrato: ${valor}`);
    return undefined;
}

/** El pago tal como lo usa la prima. */
interface Pago {
    ex: string;
    importe: number;
}

function pagosDe(distribuciones: Record<string, unknown>, avisos: string[]): { filas: Record<string, unknown>[]; pagos: Pago[] } {
    const crudos = Array.isArray(distribuciones['historial']) ? (distribuciones['historial'] as unknown[]) : [];
    const filas: Record<string, unknown>[] = [];
    const pagos: Pago[] = [];
    let incompletos = 0;
    for (const crudo of crudos) {
        const p = obj(crudo);
        const ex = fecha(p['fecha_ex']);
        const importe = num(p['importe']);
        if (ex === undefined || importe === undefined || importe < 0) {
            incompletos += 1;
            continue;
        }
        pagos.push({ ex, importe });
        const fila = limpiar({ ex_date: ex, payment_date: fecha(p['fecha_pago']), record_date: fecha(p['fecha_registro']), amount: importe });
        if (fila !== undefined) filas.push(fila);
    }
    if (incompletos > 0) avisos.push(`${incompletos} repartos del emisor sin fecha ex o sin importe, fuera`);
    return { filas, pagos };
}

/** Los puntos validados: ascendentes, sin repetir y positivos. Una serie dudosa se rechaza entera. */
function puntosValidados(puntos: PuntoVlEmisor[], campo: 'vl' | 'crecimiento'): [string, number][] | string {
    const salida: [string, number][] = [];
    let anterior = '';
    for (const punto of puntos) {
        const dia = typeof punto.fecha === 'string' ? punto.fecha : '';
        const valor = num(punto[campo]);
        if (!FECHA.test(dia)) return `fecha no valida ${JSON.stringify(punto.fecha)}`;
        if (dia <= anterior) return `fecha fuera de orden o repetida ${dia}`;
        if (valor === undefined || valor <= 0) return `valor no positivo en ${dia}`;
        anterior = dia;
        salida.push([dia, valor]);
    }
    return salida.length > 0 ? salida : 'sin puntos';
}

export interface ArgumentosDeLaPrima {
    clase: ClaseDeSerieDelEmisor;
    /** El VL deducido solo vale con ancla. */
    conAncla: boolean;
    puntosDeVl: [string, number][] | undefined;
    divisaDelVl: string | undefined;
    serieDeMercado: SerieExportada | undefined;
    politica: 'ACCUMULATING' | 'DISTRIBUTING' | undefined;
    pagos: Pago[];
    divisaDeLosPagos: string | undefined;
    historialConsultado: boolean;
    cambios: TablaDeCambios;
    seriesIdDelVl: string;
}

export type PrimaCalculada =
    | { publicada: false; motivo: MotivoSinPrima }
    | {
          publicada: true;
          as_of: string;
          window_start: string;
          observations: number;
          mean: number;
          latest: number;
          market_series_id: string;
          market_currency: string;
          nav_series_id: string;
          nav_series_class: 'ISSUER_NAV' | 'ISSUER_NAV_DERIVED';
          nav_currency: string;
          nav_adjustment: 'NONE' | 'DISTRIBUTIONS_BACK_ADJUSTED';
          distributions_in_window: number;
          fx_source?: string;
      };

/** Doce meses naturales hacia atrás. */
function inicioDeLaVentana(fin: string): string {
    const anio = String(Number(fin.slice(0, 4)) - 1);
    const resto = fin.slice(5) === '02-29' ? '02-28' : fin.slice(5);
    return `${anio}-${resto}`;
}

/**
 * La prima o el descuento a 12 meses: cierre ajustado / VL − 1. Ver el contrato `instrument-computed-premium-discount.v2`.
 *
 * El VL se ajusta hacia atrás por los repartos porque el cierre ajustado de EODHD ya los descuenta: sin esto, una clase que
 * reparte da un descuento que no existe (−0,49 % sin ajustar y −0,03 % ajustado, medido en `IE00B0M62Q58`). Solo cuentan los pagos
 * que el cierre ajustado ya conoce, es decir de fecha ex no posterior a su último punto.
 */
export function calcularPrimaDescuento(a: ArgumentosDeLaPrima): PrimaCalculada {
    if (a.clase === 'ISSUER_CUMULATIVE_RETURN') return { publicada: false, motivo: 'ISSUER_SERIES_IS_CUMULATIVE_RETURN' };
    if (a.clase === 'ISSUER_NAV_DERIVED' && !a.conAncla) return { publicada: false, motivo: 'DERIVED_WITHOUT_ANCHOR' };
    if (a.puntosDeVl === undefined || a.puntosDeVl.length === 0 || a.divisaDelVl === undefined) {
        return { publicada: false, motivo: 'NO_NAV_POINTS' };
    }
    const mercado = a.serieDeMercado;
    if (mercado === undefined || mercado.price_class !== 'MARKET_PRICE' || !divisa(mercado.currency) || mercado.points.length === 0) {
        return { publicada: false, motivo: 'NO_MARKET_SERIES' };
    }
    const divisaDeMercado = mercado.currency as string;
    const divisaDelVl = a.divisaDelVl;

    const hacenFaltaPagos = a.politica !== 'ACCUMULATING';
    if (hacenFaltaPagos && (!a.historialConsultado || a.pagos.length === 0)) return { publicada: false, motivo: 'DISTRIBUTIONS_UNAVAILABLE' };
    if (a.pagos.length > 0 && a.divisaDeLosPagos !== divisaDelVl) return { publicada: false, motivo: 'DISTRIBUTION_CURRENCY_MISMATCH' };

    const hayConversion = divisaDelVl !== divisaDeMercado;
    const cambioEn = (moneda: string, dia: string): number | undefined =>
        moneda === 'EUR' ? 1 : a.cambios.get(moneda)?.get(dia);
    if (hayConversion && ((divisaDelVl !== 'EUR' && !a.cambios.has(divisaDelVl)) || (divisaDeMercado !== 'EUR' && !a.cambios.has(divisaDeMercado)))) {
        return { publicada: false, motivo: 'NO_FX_RATE' };
    }

    const vlPorDia = new Map(a.puntosDeVl);
    const diasDelVl = a.puntosDeVl.map(([dia]) => dia);
    const ultimoCierre = mercado.points[mercado.points.length - 1]![0];

    /* Días con cierre, VL y, si hace falta, cambio. */
    const comunes: { dia: string; cierre: number; vl: number; cambio: number }[] = [];
    for (const [dia, cierre] of mercado.points) {
        const vl = vlPorDia.get(dia);
        if (vl === undefined) continue;
        let cambio = 1;
        if (hayConversion) {
            const delVl = cambioEn(divisaDelVl, dia);
            const deMercado = cambioEn(divisaDeMercado, dia);
            if (delVl === undefined || deMercado === undefined) continue;
            cambio = deMercado / delVl;
        }
        comunes.push({ dia, cierre, vl, cambio });
    }
    if (comunes.length === 0) return { publicada: false, motivo: hayConversion ? 'NO_FX_RATE' : 'INSUFFICIENT_OVERLAP' };

    const asOf = comunes[comunes.length - 1]!.dia;
    const inicio = inicioDeLaVentana(asOf);
    const enVentana = comunes.filter(({ dia }) => dia >= inicio);
    if (enVentana.length < MINIMO_DE_OBSERVACIONES) return { publicada: false, motivo: 'INSUFFICIENT_OVERLAP' };

    /* Solo los pagos que afectan a alguna fecha de la ventana y que el cierre ajustado ya conoce. */
    const pagosQueAjustan = a.pagos.filter(({ ex }) => ex > inicio && ex <= ultimoCierre);
    const factores: { ex: string; factor: number }[] = [];
    for (const { ex, importe } of pagosQueAjustan) {
        let i = diasDelVl.findIndex((dia) => dia >= ex);
        if (i === -1) i = diasDelVl.length;
        const anterior = i > 0 ? vlPorDia.get(diasDelVl[i - 1]!) : undefined;
        if (anterior === undefined || importe >= anterior) return { publicada: false, motivo: 'DISTRIBUTIONS_UNAVAILABLE' };
        factores.push({ ex, factor: 1 - importe / anterior });
    }

    const primas = enVentana.map(({ dia, cierre, vl, cambio }) => {
        let ajuste = 1;
        for (const { ex, factor } of factores) if (ex > dia) ajuste *= factor;
        return cierre / (vl * ajuste * cambio) - 1;
    });
    if (primas.some((prima) => Math.abs(prima) > PRIMA_MAXIMA_CREIBLE)) return { publicada: false, motivo: 'SCALE_MISMATCH' };

    return {
        publicada: true,
        as_of: asOf,
        window_start: inicio,
        observations: primas.length,
        mean: primas.reduce((suma, prima) => suma + prima, 0) / primas.length,
        latest: primas[primas.length - 1]!,
        market_series_id: mercado.series_id,
        market_currency: divisaDeMercado,
        nav_series_id: a.seriesIdDelVl,
        nav_series_class: a.clase,
        nav_currency: divisaDelVl,
        nav_adjustment: factores.length > 0 ? 'DISTRIBUTIONS_BACK_ADJUSTED' : 'NONE',
        distributions_in_window: factores.length,
        ...(hayConversion ? { fx_source: FUENTE_FX } : {})
    };
}

/** Parte la serie por años, como `price_series`. */
function documentosDelVl(
    isin: string,
    seriesId: string,
    fuente: string,
    clase: ClaseDeSerieDelEmisor,
    moneda: string | undefined,
    puntos: [string, number][]
): DocumentoMapeado[] {
    const porAnio = new Map<string, { date: string; value: number }[]>();
    for (const [dia, valor] of puntos) {
        const anio = dia.slice(0, 4);
        const lista = porAnio.get(anio) ?? [];
        lista.push({ date: dia, value: valor });
        porAnio.set(anio, lista);
    }
    return [...porAnio].map(([anio, lista]) => ({
        ruta: `instruments/${isin}/issuer_nav/${anio}`,
        tipo: TIPO_VL,
        documento: {
            instrument_id: isin,
            year: anio,
            series_id: seriesId,
            source: fuente,
            series_class: clase,
            value_kind: clase === 'ISSUER_CUMULATIVE_RETURN' ? 'GROWTH' : 'NAV',
            ...(moneda !== undefined ? { currency: moneda } : {}),
            first_date: lista[0]!.date,
            last_date: lista[lista.length - 1]!.date,
            observations: lista.length,
            points: lista
        }
    }));
}

/** Mapea el bloque del emisor de un instrumento. Sin `emisor` en el registro no devuelve nada: la mayoría no lo tiene. */
export function mapearDelEmisor(
    universal: RegistroUniversal,
    entradas: EntradasDelEmisor,
    ahora: string
): ResultadoDelEmisor {
    const documentos: DocumentoMapeado[] = [];
    const avisos: string[] = [];
    const perdidas: string[] = [];
    const ausencias: ResultadoDelEmisor['ausencias'] = [];
    const resultado: ResultadoDelEmisor = { documentos, ausencias, avisos, perdidas };

    const emisor = obj(universal['emisor']);
    if (Object.keys(emisor).length === 0) return resultado;

    const isin = txt(universal['_id']) ?? '';
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        avisos.push(`bloque del emisor sin ISIN valido: ${JSON.stringify(isin)}`);
        return resultado;
    }
    const tipo = TIPO_PRODUCTO[String(obj(universal['identificacion'])['tipo_producto'])];
    if (tipo !== 'ETF' && tipo !== 'FUND') {
        avisos.push(`${isin}: bloque del emisor en un tipo sin contrato (${String(tipo)}), fuera`);
        return resultado;
    }

    const adaptador = txt(emisor['fuente']);
    const asOf = fecha(emisor['fecha_descarga']);
    const idDelEmisor = txt(emisor['id_emisor']);
    const nombre = txt(emisor['nombre']);
    if (adaptador === undefined || asOf === undefined || idDelEmisor === undefined || nombre === undefined) {
        avisos.push(`${isin}: bloque del emisor sin fuente, fecha, id o nombre, fuera`);
        ausencias.push({ ruta: 'declared/issuer_data', razon: 'NOT_PROVIDED', detalle: 'bloque del emisor incompleto' });
        return resultado;
    }

    /* ---- la serie ---- */
    const vl = obj(emisor['vl']);
    const clase = traduceONada(CLASE_DE_SERIE_DEL_EMISOR, vl['clase_de_serie'], `${isin} emisor.vl.clase_de_serie`, avisos);
    const fuenteDelVl = txt(vl['fuente']);
    const monedaDelVl = divisa(vl['divisa']);
    const seriesId = `ISSUER:${adaptador}:${isin}`;
    const anclaCruda = obj(vl['anclaje']);
    const ancla = limpiar({ value: num(anclaCruda['vl']), date: fecha(anclaCruda['fecha']), growth: num(anclaCruda['crecimiento']) });
    const conAncla = ancla !== undefined && Object.keys(ancla).length === 3;

    let puntos: [string, number][] | undefined;
    if (clase !== undefined && Array.isArray(entradas.puntosDeVl) && entradas.puntosDeVl.length > 0) {
        const validados = puntosValidados(entradas.puntosDeVl, clase === 'ISSUER_CUMULATIVE_RETURN' ? 'crecimiento' : 'vl');
        if (typeof validados === 'string') avisos.push(`${isin}: serie del emisor rechazada entera: ${validados}`);
        else puntos = validados;
    }

    let bloqueVl: Record<string, unknown> | undefined;
    if (clase !== undefined && puntos !== undefined && fuenteDelVl !== undefined) {
        documentos.push(...documentosDelVl(isin, seriesId, fuenteDelVl, clase, monedaDelVl, puntos));
        bloqueVl = limpiar({
            series_class: clase,
            currency: monedaDelVl,
            source: fuenteDelVl,
            first_date: puntos[0]![0],
            last_date: puntos[puntos.length - 1]![0],
            observations: puntos.length,
            last_value: clase === 'ISSUER_CUMULATIVE_RETURN' ? undefined : puntos[puntos.length - 1]![1],
            derived: vl['derivado'] === true ? true : undefined,
            method: txt(vl['metodo']),
            base: num(vl['base']),
            anchor: conAncla ? ancla : undefined,
            rounding_bound: num(vl['cota_relativa_redondeo']),
            no_anchor_reason: traduceONada(MOTIVO_SIN_ANCLAJE, vl['motivo_sin_anclaje'], `${isin} emisor.vl.motivo_sin_anclaje`, avisos),
            last_declared_value: num(vl['ultimo_declarado'])
        });
    } else {
        ausencias.push({ ruta: 'issuer_nav', razon: 'NOT_PROVIDED', detalle: 'serie del emisor ausente o rechazada' });
    }

    /* ---- declared/issuer_data ---- */
    const politica = obj(emisor['politica']);
    const replica = obj(emisor['replica']);
    const indice = obj(emisor['indice']);
    const patrimonio = obj(emisor['patrimonio']);
    const cartera = obj(emisor['cartera']);
    const distribuciones = obj(emisor['distribuciones']);
    const { filas: filasDePagos, pagos } = pagosDe(distribuciones, avisos);
    const politicaDelEmisor = traduceONada(POLITICA_DEL_EMISOR, politica['valor'], `${isin} emisor.politica.valor`, avisos);
    const divisaDeLosPagos = divisa(distribuciones['divisa']);
    const historialConsultado = distribuciones['historial_consultado'] === true;

    if (Object.keys(obj(cartera['exposicion'])).length > 0) {
        perdidas.push('emisor.cartera.exposicion: mapas de claves libres en ingles, sin sitio en el contrato');
    }
    if (Object.keys(obj(distribuciones['ultima'])).length > 0) {
        perdidas.push('emisor.distribuciones.ultima: el campo del emisor no se puede cerrar sin historico (nota de Invesco)');
    }

    const contrapartes = (Array.isArray(cartera['contrapartes']) ? (cartera['contrapartes'] as unknown[]) : []).flatMap((crudo) => {
        const c = obj(crudo);
        const nombreDeLaContraparte = txt(c['nombre']);
        return nombreDeLaContraparte === undefined
            ? []
            : [limpiar({ name: nombreDeLaContraparte, gross_exposure: enElContrato('holdings.counterparties[].gross_exposure', frac(c['exposicion_bruta_pct']), avisos) })!];
    });

    const region = (Array.isArray(emisor['region']) ? (emisor['region'] as unknown[]) : []).flatMap((r) => {
        const t = txt(r);
        return t === undefined ? [] : [t];
    });

    const datos = limpiar({
        source: `issuer:${adaptador}`,
        as_of: asOf,
        issuer_product_id: idDelEmisor,
        name: nombre,
        issuer_asset_class: txt(emisor['clase_activo']),
        management_style: txt(emisor['estilo_gestion']),
        region,
        share_class_currency: divisa(emisor['divisa_clase']),
        inception_date: fecha(emisor['fecha_lanzamiento']),
        costs: {
            ongoing_charge: enElContrato('costs.ongoing_charge', frac(emisor['ter_pct']), avisos),
            swap_fee: enElContrato('costs.swap_fee', frac(emisor['comision_swap_pct']), avisos)
        },
        distribution_policy: { value: politicaDelEmisor, text: txt(politica['texto']), frequency: txt(politica['frecuencia']) },
        replication: {
            type: traduceONada(REPLICA_DEL_EMISOR, replica['tipo'], `${isin} emisor.replica.tipo`, avisos),
            structure: txt(replica['estructura']),
            method: txt(replica['metodo']),
            sampling: typeof replica['muestreo'] === 'boolean' ? replica['muestreo'] : undefined
        },
        index: { name: txt(indice['nombre']), ticker: txt(indice['ticker']) },
        size: { share_class: importeConFecha(patrimonio['clase']), fund: importeConFecha(patrimonio['fondo']) },
        nav: bloqueVl,
        holdings: {
            as_of: fecha(cartera['fecha']),
            positions_count: enElContrato('holdings.positions_count', num(cartera['num_posiciones']), avisos),
            declared_positions_count: enElContrato('holdings.declared_positions_count', num(cartera['num_posiciones_declarado']), avisos),
            top10_weight: enElContrato('holdings.top10_weight', frac(cartera['peso_top10_pct']), avisos),
            nature: traduceONada(NATURALEZA_DE_LA_CARTERA, cartera['naturaleza'], `${isin} emisor.cartera.naturaleza`, avisos),
            counterparties: contrapartes
        },
        distributions:
            en(emisor, 'distribuciones', 'historial_consultado') === undefined
                ? undefined
                : {
                      records_checked: historialConsultado,
                      currency: divisaDeLosPagos,
                      currency_origin: traduceONada(ORIGEN_DE_LA_DIVISA_DEL_REPARTO, distribuciones['divisa_origen'], `${isin} emisor.distribuciones.divisa_origen`, avisos),
                      payments: filasDePagos.slice(0, 500)
                  },
        warnings: (Array.isArray(emisor['avisos']) ? (emisor['avisos'] as unknown[]) : []).flatMap((crudo) => {
            const codigo = txt(obj(crudo)['codigo']);
            return codigo === undefined ? [] : [{ code: codigo }];
        })
    });
    if (datos !== undefined) {
        documentos.push({ ruta: `instruments/${isin}/declared/issuer_data`, tipo: TIPO_DATOS, documento: datos });
    }

    /* ---- computed/premium_discount ---- */
    /* La regla es el precio de mercado, no el tipo: un fondo que cotiza lleva prima aunque entre en la base como FUND, y el fondo
       índice de Vanguard no tiene cotización ninguna. El caso que la abrió fue `LU0290358497` (Xtrackers monetario por swap), que
       entraba como FUND y cotizaba en XETRA; desde la decisión B-70 (09-11-2026) está retirado del catálogo. La regla se queda: cambiarla sin caso que medir sería tocar de rebote. Un ETF sin serie de mercado sí lleva documento,
       que lo dice. */
    if (tipo !== 'ETF' && entradas.serieDeMercado?.price_class !== 'MARKET_PRICE') {
        ausencias.push({ ruta: 'computed/premium_discount', razon: 'NOT_APPLICABLE', detalle: 'sin precio de mercado no hay prima' });
        return resultado;
    }
    if (clase === undefined) {
        avisos.push(`${isin}: clase de serie del emisor desconocida, sin prima`);
        return resultado;
    }
    const prima = calcularPrimaDescuento({
        clase,
        conAncla,
        puntosDeVl: clase === 'ISSUER_CUMULATIVE_RETURN' ? undefined : puntos,
        divisaDelVl: monedaDelVl,
        serieDeMercado: entradas.serieDeMercado,
        politica: politicaDelEmisor,
        pagos,
        divisaDeLosPagos,
        historialConsultado,
        cambios: entradas.cambios,
        seriesIdDelVl: seriesId
    });
    const { publicada, ...cifras } = prima;
    documentos.push({
        ruta: `instruments/${isin}/computed/premium_discount`,
        tipo: TIPO_PRIMA,
        documento: {
            computed_at: ahora,
            method: 'PREMIUM_DISCOUNT_V1',
            window: '1y',
            status: publicada ? 'PUBLISHED' : 'NOT_PUBLISHED',
            ...(prima.publicada ? cifras : { absence_reason: prima.motivo })
        },
        /* La calcula un lote de la plataforma, no un tercero: como `computed/metrics`, se escribe como quien calcula. */
        comoDueno: 'batch'
    });
    return resultado;
}

/** Lo que la pasada deja en disco y este módulo necesita, leído una vez. */
export interface FicherosDelEmisor {
    vlPorIsin: ReadonlyMap<string, PuntoVlEmisor[]>;
    carpetaDeSeries: string;
    cambios: TablaDeCambios;
}

/** Lee la serie del emisor de `export/series.ndjson` y los cambios del BCE de `export_fx/`. */
export function leerFicherosDelEmisor(raizDelExtractor: string): FicherosDelEmisor {
    const vlPorIsin = new Map<string, PuntoVlEmisor[]>();
    const rutaDeSeries = path.join(raizDelExtractor, 'export', 'series.ndjson');
    if (fs.existsSync(rutaDeSeries)) {
        for (const linea of fs.readFileSync(rutaDeSeries, 'utf-8').split('\n')) {
            if (linea.trim() === '') continue;
            const fila = JSON.parse(linea) as { isin?: unknown; serie?: unknown; puntos?: unknown };
            if (fila.serie === 'vl_emisor' && typeof fila.isin === 'string' && Array.isArray(fila.puntos)) {
                vlPorIsin.set(fila.isin, fila.puntos as PuntoVlEmisor[]);
            }
        }
    }
    const cambios = new Map<string, Map<string, number>>();
    const carpetaDeCambios = path.join(raizDelExtractor, 'export_fx');
    if (fs.existsSync(carpetaDeCambios)) {
        for (const nombre of fs.readdirSync(carpetaDeCambios).filter((f) => f.endsWith('.json'))) {
            const datos = JSON.parse(fs.readFileSync(path.join(carpetaDeCambios, nombre), 'utf-8')) as CambiosExportados;
            cambios.set(datos.currency, new Map(datos.points));
        }
    }
    return { vlPorIsin, carpetaDeSeries: path.join(raizDelExtractor, 'export_series'), cambios };
}

/** Las entradas de un instrumento concreto. Solo abre su serie de mercado si tiene bloque del emisor. */
export function entradasDe(isin: string, ficheros: FicherosDelEmisor): EntradasDelEmisor {
    const ruta = path.join(ficheros.carpetaDeSeries, `${isin}.json`);
    return {
        puntosDeVl: ficheros.vlPorIsin.get(isin),
        serieDeMercado: fs.existsSync(ruta) ? (JSON.parse(fs.readFileSync(ruta, 'utf-8')) as SerieExportada) : undefined,
        cambios: ficheros.cambios
    };
}
