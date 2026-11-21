/**
 * src/ingestion/baseNueva/carteraDelEmisor.ts — la cartera completa que publica el emisor de un ETF (decisión B-79 de Óscar,
 * 11-11-2026), en la base nueva.
 *
 * Dos documentos, y ninguno toca `declared/holdings` ni `holdings_chunks`:
 *
 * - `declared/issuer_holdings`: de dónde sale, de qué fecha es, si sirve para medir y por qué no.
 * - `issuer_holdings_chunks/{nnn}`: las posiciones, 500 por trozo, de mayor a menor peso. Solo si sirve para medir.
 *
 * **Uso interno, solo para el asesor** (B-53, B-79). Ningún camino de cliente lo lee, y el dato lo lleva escrito
 * (`audience: ADVISOR_ONLY`). Viene de `1-extractor/export/posiciones_emisor.ndjson`, que el extractor solo rellena para
 * los ETF de `config/cartera_emisor.json`. Las funciones son puras salvo `leerCarteraDelEmisor`, que lee ese fichero.
 */
import * as fs from 'fs';
import * as path from 'path';

import { num, obj, txt, type DocumentoMapeado } from './mapper';
import { pesoCreible, POSICIONES_POR_TROZO } from './posiciones';
import { MOTIVO_PARA_NO_MEDIR, TIPO_DE_POSICION_DEL_EMISOR } from './traducciones';

export const TIPO_RESUMEN = 'instrument-declared-issuer-holdings.v2.schema.json';
export const TIPO_TROZO = 'instrument-issuer-holdings-chunk.v2.schema.json';
export const COLECCION_DE_TROZOS = 'issuer_holdings_chunks';
export const FICHERO_DEL_EXTRACTOR = path.join('export', 'posiciones_emisor.ndjson');

/**
 * Los contratos que `nube:subir` deja fuera mientras no se pida `--con-cartera-del-emisor`. La subida lee del emulador todo lo
 * que declaran los contratos, así que sin esto la primera subida del catálogo llevaría a la nube la cartera del emisor sin que
 * nadie lo hubiera decidido, y antes de que la aplicación sepa leerla solo fuera del Modo cliente. Subirla es una aprobación
 * de Óscar aparte (B-79).
 */
export const CONTRATOS_FUERA_DE_LA_SUBIDA: ReadonlySet<string> = new Set([TIPO_RESUMEN, TIPO_TROZO]);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const SEDOL = /^[0-9A-Z]{7}$/;
const DIVISA = /^[A-Z]{3}$/;

/** Una línea de `posiciones_emisor.ndjson`: la cabecera de la cartera y una parte de sus posiciones. */
export type LineaDelExtractor = Record<string, unknown>;

export interface ResultadoDeLaCartera {
    documentos: DocumentoMapeado[];
    avisos: string[];
}

/** ¿Es esta ruta de la cartera del emisor? Es lo que limita `--solo-cartera-del-emisor`. */
export function esDeLaCarteraDelEmisor(ruta: string): boolean {
    const partes = ruta.split('/');
    return (
        partes[0] === 'instruments' &&
        ((partes[2] === 'declared' && partes[3] === 'issuer_holdings' && partes.length === 4) ||
            (partes[2] === COLECCION_DE_TROZOS && partes.length === 4))
    );
}

export function rutaDelTrozoDelEmisor(isin: string, n: number): string {
    return `instruments/${isin}/${COLECCION_DE_TROZOS}/${String(n).padStart(3, '0')}`;
}

/** Cuántos decimales lleva un número tal como se escribió en el fichero del emisor. */
function decimales(n: number): number {
    const texto = String(n);
    if (texto.includes('e')) return 10;
    const punto = texto.indexOf('.');
    return punto === -1 ? 0 : texto.length - punto - 1;
}

/** Mapea la cartera del emisor de un instrumento. Sin líneas no devuelve nada: casi ninguno la tiene. */
export function mapearCarteraDelEmisor(isin: string, lineas: readonly LineaDelExtractor[]): ResultadoDeLaCartera {
    const documentos: DocumentoMapeado[] = [];
    const avisos: string[] = [];
    if (lineas.length === 0) return { documentos, avisos };

    const partes = [...lineas].sort((a, b) => Number(a['parte']) - Number(b['parte']));
    const total = Number(partes[0]!['total_partes']);
    const enOrden = partes.every((p, i) => Number(p['parte']) === i + 1 && Number(p['total_partes']) === total);
    if (!enOrden || partes.length !== total) {
        avisos.push(`${isin}: cartera del emisor con partes que no cuadran (${partes.length} de ${String(total)}), fuera entera`);
        return { documentos, avisos };
    }
    const cabecera = partes[0]!;
    const fuente = txt(cabecera['fuente']);
    const fecha = txt(cabecera['fecha']);
    if (fuente === undefined || fecha === undefined || !FECHA.test(fecha)) {
        avisos.push(`${isin}: cartera del emisor sin fuente o sin fecha de cartera, fuera`);
        return { documentos, avisos };
    }
    const sirve = cabecera['uso'] === 'medir';
    const motivo = sirve ? undefined : MOTIVO_PARA_NO_MEDIR[String(cabecera['motivo_no_medir'])];
    if (!sirve && motivo === undefined) {
        avisos.push(`${isin}: cartera del emisor que no se mide sin motivo conocido (${JSON.stringify(cabecera['motivo_no_medir'])}), fuera`);
        return { documentos, avisos };
    }
    const naturaleza =
        cabecera['naturaleza'] === 'cesta_de_sustitucion' || cabecera['replica'] === 'sintetica'
            ? 'SUBSTITUTE_BASKET'
            : cabecera['replica'] === 'fisica'
              ? 'PORTFOLIO'
              : undefined;

    /* Las líneas, en el orden del extractor (de mayor a menor peso). */
    const escritas: Record<string, unknown>[] = [];
    const conValor: { valor: number; divisa: string | undefined }[] = [];
    let descartadas = 0;
    let sinTipo = 0;
    let maxDecimales = 0;
    const imposibles: string[] = [];
    for (const parte of partes) {
        for (const cruda of Array.isArray(parte['posiciones']) ? (parte['posiciones'] as unknown[]) : []) {
            const p = obj(cruda);
            const nombre = txt(p['nombre']);
            const pesoPct = num(p['peso_pct']);
            if (nombre === undefined || pesoPct === undefined) {
                descartadas += 1;
                continue;
            }
            const peso = pesoPct / 100;
            if (!pesoCreible(peso)) {
                descartadas += 1;
                imposibles.push(nombre);
                continue;
            }
            maxDecimales = Math.max(maxDecimales, decimales(pesoPct));
            const linea: Record<string, unknown> = { name: nombre, weight: peso };
            const isinDeLinea = txt(p['isin']);
            if (isinDeLinea !== undefined && ISIN.test(isinDeLinea)) linea['isin'] = isinDeLinea;
            const ticker = txt(p['ticker']);
            if (ticker !== undefined) linea['ticker'] = ticker;
            const sedol = txt(p['sedol']);
            if (sedol !== undefined && SEDOL.test(sedol)) linea['sedol'] = sedol;
            const tipo = TIPO_DE_POSICION_DEL_EMISOR[String(p['tipo'])];
            if (tipo !== undefined) linea['position_type'] = tipo;
            else sinTipo += 1;
            const clase = txt(p['clase_activo']);
            if (clase !== undefined) linea['issuer_asset_class'] = clase;
            const sector = txt(p['sector']);
            if (sector !== undefined) linea['issuer_sector'] = sector;
            const pais = txt(p['pais']);
            if (pais !== undefined) linea['issuer_country'] = pais;
            const divisa = txt(p['divisa']);
            if (divisa !== undefined && DIVISA.test(divisa)) linea['currency'] = divisa;
            const valor = num(p['valor_mercado']);
            if (valor !== undefined) conValor.push({ valor, divisa: txt(p['divisa_valor_mercado']) });
            linea['__valor'] = valor;
            escritas.push(linea);
        }
    }
    if (imposibles.length > 0) {
        avisos.push(`${isin}: ${imposibles.length} lineas del emisor con un peso imposible, no escritas: ${imposibles.join('; ')}`);
    }

    /* El valor de mercado, solo si lo traen todas las líneas y en una sola divisa: si no, no se suma nada. */
    const divisas = new Set(conValor.map((c) => c.divisa));
    const divisaDelValor = conValor.length === escritas.length && divisas.size === 1 ? [...divisas][0] : undefined;
    const conValorDeMercado = divisaDelValor !== undefined && DIVISA.test(divisaDelValor);
    if (conValor.length > 0 && !conValorDeMercado) {
        avisos.push(`${isin}: valor de mercado del emisor en ${conValor.length} de ${escritas.length} lineas o en varias divisas, fuera`);
    }
    for (const linea of escritas) {
        const valor = linea['__valor'];
        delete linea['__valor'];
        if (conValorDeMercado && typeof valor === 'number') linea['market_value'] = valor;
    }

    const trozos = sirve ? Math.ceil(escritas.length / POSICIONES_POR_TROZO) : 0;
    /* Una suma fuera de ±5 no es una cartera: se deja fuera con aviso en vez de bloquear el resumen entero. */
    const sumaDePesos = escritas.reduce((suma, linea) => suma + Number(linea['weight']), 0);
    const sumaCreible = Math.abs(sumaDePesos) <= 5;
    if (!sumaCreible) avisos.push(`${isin}: los pesos del emisor suman ${sumaDePesos.toFixed(4)}, sin suma en el resumen`);
    const obtenido = txt(cabecera['obtenido']);
    const declarado = num(cabecera['num_posiciones_declarado']);
    const resumen: Record<string, unknown> = {
        source: `issuer:${fuente}`,
        as_of: fecha,
        ...(obtenido !== undefined && FECHA.test(obtenido.slice(0, 10)) ? { retrieved_on: obtenido.slice(0, 10) } : {}),
        ...(txt(cabecera['url']) !== undefined ? { source_url: txt(cabecera['url']) } : {}),
        audience: 'ADVISOR_ONLY',
        ...(naturaleza !== undefined ? { nature: naturaleza } : {}),
        usable_for_measurement: sirve,
        ...(motivo !== undefined ? { not_usable_reason: motivo } : {}),
        positions_count: escritas.length,
        ...(declarado !== undefined && Number.isInteger(declarado) && declarado >= 0 ? { declared_positions_count: declarado } : {}),
        discarded_lines: descartadas,
        untyped_lines: sinTipo,
        chunk_count: trozos,
        ...(sumaCreible ? { weights_sum: sumaDePesos } : {}),
        ...(escritas.length > 0 ? { weight_step: Math.min(0.01, 10 ** -maxDecimales / 100) } : {}),
        ...(conValorDeMercado
            ? { market_value_total: conValor.reduce((suma, c) => suma + c.valor, 0), market_value_currency: divisaDelValor }
            : {})
    };
    documentos.push({ ruta: `instruments/${isin}/declared/issuer_holdings`, tipo: TIPO_RESUMEN, documento: resumen });

    for (let i = 0; i < trozos; i += 1) {
        documentos.push({
            ruta: rutaDelTrozoDelEmisor(isin, i),
            tipo: TIPO_TROZO,
            documento: {
                chunk_id: String(i).padStart(3, '0'),
                source: `issuer:${fuente}`,
                as_of: fecha,
                ...(conValorDeMercado ? { market_value_currency: divisaDelValor } : {}),
                positions: escritas.slice(i * POSICIONES_POR_TROZO, (i + 1) * POSICIONES_POR_TROZO)
            }
        });
    }
    return { documentos, avisos };
}

/** Lee `export/posiciones_emisor.ndjson`: ISIN -> sus partes. Sin fichero, ninguno. */
export function leerCarteraDelEmisor(raizDelExtractor: string): Map<string, LineaDelExtractor[]> {
    const salida = new Map<string, LineaDelExtractor[]>();
    const ruta = path.join(raizDelExtractor, FICHERO_DEL_EXTRACTOR);
    if (!fs.existsSync(ruta)) return salida;
    for (const linea of fs.readFileSync(ruta, 'utf-8').split('\n')) {
        if (linea.trim() === '') continue;
        const fila = JSON.parse(linea) as LineaDelExtractor;
        const isin = typeof fila['isin'] === 'string' ? fila['isin'] : undefined;
        if (isin === undefined) continue;
        salida.set(isin, [...(salida.get(isin) ?? []), fila]);
    }
    return salida;
}
