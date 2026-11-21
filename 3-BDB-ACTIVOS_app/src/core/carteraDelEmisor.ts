/**
 * La cartera completa que publica el emisor de un ETF, en el idioma de la aplicación (decisión B-79 de Óscar, 11-11-2026).
 *
 * **La cartera, solo para el asesor; la cifra de solapamiento, para todos.** Los datos del emisor son de uso interno (B-53). Su cartera
 * mide el solapamiento en todas partes —Análisis, también en Modo cliente, el informe de cliente y el interno— desde la decisión de Óscar
 * del 14-11-2026 («con respecto a los ETF, no los dejes fuera»); por dentro solo se enseña en la 4.1 del informe interno. Este módulo es
 * puro: no lee nada. Quien lee es `adapters/carteraDelEmisor`, que llaman las pantallas, y una prueba
 * (`tests/barreraCarteraDelEmisor.test.ts`) falla si un papel de cliente alcanza cualquiera de los dos.
 *
 * Lo que hace:
 *
 * - **El peso.** Con valor de mercado en todas las líneas, el de cada una sobre la suma de la lista: es lo que publica iShares, pero
 *   redondeado a dos decimales en por ciento, y con 20.000 líneas el Global Aggregate suma así un 75,7 %. Sin él, el peso declarado.
 * - **El cruce por ticker.** Las carteras del proveedor van por ISIN, y la de iShares y la de Vanguard, por ticker. Un ticker no es único
 *   entre bolsas («SAN» es Santander en Madrid y Sanofi en París; «NDA», Nordea en Helsinki y Aurubis en Xetra), así que se pasa a ISIN
 *   solo con tres cosas a la vez: el mismo ticker, la misma divisa de cotización (o, si el emisor no la da, el país del ISIN) y una
 *   palabra del nombre en común, y siempre que quede un solo ISIN. Lo que no se resuelve sigue por su nombre, como hasta ahora.
 * - **La clase de cada línea**, con el prefijo `EMISOR:` que entiende `core/lineaDeCartera`: los derivados y la liquidez no cuentan
 *   en el solapamiento.
 */
import type { BdbAssetHoldings, BdbHoldingPosition, BdbIssuerPortfolioOrigin } from "../types/bdbAssets";
import * as formato from "./formato";
import { PREFIJO_DEL_EMISOR } from "./lineaDeCartera";

type Crudo = Record<string, unknown>;

export const TIPOS_DE_LINEA_DEL_EMISOR = ["EQUITY", "FIXED_INCOME", "DERIVATIVE", "CASH", "FUND", "OTHER"] as const;
export type TipoDeLineaDelEmisor = (typeof TIPOS_DE_LINEA_DEL_EMISOR)[number];

/** Una línea de `issuer_holdings_chunks/{nnn}.positions`, con el peso en fracción como en el contrato. */
export interface LineaDelEmisor {
  name: string;
  weight: number;
  isin?: string;
  ticker?: string;
  sedol?: string;
  market_value?: number;
  position_type?: TipoDeLineaDelEmisor;
  currency?: string;
  issuer_country?: string;
}

/** `declared/issuer_holdings`: lo que hace falta para decidir si la cartera se usa y cómo. */
export interface ResumenDelEmisor {
  /** Sin el prefijo `issuer:`. */
  source: string;
  as_of: string;
  usable_for_measurement: boolean;
  not_usable_reason?: string;
  positions_count: number;
  chunk_count: number;
  weights_sum?: number;
  market_value_total?: number;
  market_value_currency?: string;
}

export interface CarteraDelEmisor {
  asset_id: string;
  resumen: ResumenDelEmisor;
  /** Vacía si no sirve para medir, o si lo leído no cuadra con el resumen (`incompleta`). */
  lineas: LineaDelEmisor[];
  /** Los trozos leídos no cuadran con el resumen: otra pasada a medias, o una lectura cortada. No se usa. */
  incompleta?: true;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor.trim() : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/**
 * El resumen, o `null` si no es un resumen de la cartera del emisor que se pueda leer. Un documento que no diga `ADVISOR_ONLY` no se lee:
 * el contrato solo admite ese valor, y lo que no lo lleve no es lo que se cree.
 */
export function leerResumenDelEmisor(documento: Crudo | undefined): ResumenDelEmisor | null {
  if (!documento || documento["audience"] !== "ADVISOR_ONLY") return null;
  const fuente = texto(documento["source"]);
  const fecha = texto(documento["as_of"]);
  const usable = documento["usable_for_measurement"];
  const posiciones = numero(documento["positions_count"]);
  const trozos = numero(documento["chunk_count"]);
  if (!fuente || !fecha || !FECHA.test(fecha) || typeof usable !== "boolean" || posiciones === undefined || trozos === undefined) return null;
  return {
    source: fuente.replace(/^issuer:/, ""),
    as_of: fecha,
    usable_for_measurement: usable,
    ...(texto(documento["not_usable_reason"]) ? { not_usable_reason: texto(documento["not_usable_reason"]) } : {}),
    positions_count: posiciones,
    chunk_count: trozos,
    ...(numero(documento["weights_sum"]) !== undefined ? { weights_sum: numero(documento["weights_sum"]) } : {}),
    ...(numero(documento["market_value_total"]) !== undefined ? { market_value_total: numero(documento["market_value_total"]) } : {}),
    ...(texto(documento["market_value_currency"]) ? { market_value_currency: texto(documento["market_value_currency"]) } : {})
  };
}

function leerLinea(cruda: unknown): LineaDelEmisor | null {
  if (!cruda || typeof cruda !== "object") return null;
  const p = cruda as Crudo;
  const name = texto(p["name"]);
  const weight = numero(p["weight"]);
  if (!name || weight === undefined) return null;
  const isin = texto(p["isin"])?.toUpperCase();
  const tipo = texto(p["position_type"]);
  return {
    name,
    weight,
    ...(isin && ISIN.test(isin) ? { isin } : {}),
    ...(texto(p["ticker"]) ? { ticker: texto(p["ticker"]) } : {}),
    ...(texto(p["sedol"]) ? { sedol: texto(p["sedol"]) } : {}),
    ...(numero(p["market_value"]) !== undefined ? { market_value: numero(p["market_value"]) } : {}),
    ...(tipo && (TIPOS_DE_LINEA_DEL_EMISOR as readonly string[]).includes(tipo) ? { position_type: tipo as TipoDeLineaDelEmisor } : {}),
    ...(texto(p["currency"]) ? { currency: texto(p["currency"])!.toUpperCase() } : {}),
    ...(texto(p["issuer_country"]) ? { issuer_country: texto(p["issuer_country"]) } : {})
  };
}

/**
 * Las líneas de los trozos, en su orden, o `null` si no cuadran con el resumen: un trozo de otra fecha es de otra pasada, y menos trozos
 * o menos líneas de las declaradas es una cartera que no está entera. Una cartera a medias no es la completa, y no se usa.
 */
export function lineasDeLosTrozos(resumen: ResumenDelEmisor, trozos: readonly Crudo[]): LineaDelEmisor[] | null {
  if (trozos.length !== resumen.chunk_count) return null;
  const enOrden = [...trozos].sort((a, b) => String(a["chunk_id"] ?? "").localeCompare(String(b["chunk_id"] ?? "")));
  const lineas: LineaDelEmisor[] = [];
  for (const trozo of enOrden) {
    if (trozo["as_of"] !== resumen.as_of) return null;
    const posiciones = Array.isArray(trozo["positions"]) ? (trozo["positions"] as unknown[]) : [];
    for (const cruda of posiciones) {
      const linea = leerLinea(cruda);
      if (!linea) return null;
      lineas.push(linea);
    }
  }
  return lineas.length === resumen.positions_count ? lineas : null;
}

/** Si esta cartera del emisor sustituye a la del proveedor: la marca el emisor como medible, y ha llegado entera. */
export function sirveParaMedir(cartera: CarteraDelEmisor | null | undefined): cartera is CarteraDelEmisor {
  return Boolean(cartera && cartera.resumen.usable_for_measurement && !cartera.incompleta && cartera.lineas.length > 0);
}

/* ─────────────────────────────── El cruce por ticker ─────────────────────────────── */

/** Una pareja ticker–ISIN que la aplicación ya conoce: una línea del proveedor que trae los dos, o una acción del catálogo. */
export interface ParDeIdentificadores {
  ticker: string;
  isin: string;
  /** La divisa de cotización. */
  currency?: string;
  name: string;
}

/** «ASML NA» y «asml» son el mismo ticker sin bolsa: la primera palabra, en mayúsculas. */
export function raizDelTicker(ticker: string): string {
  return ticker.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

/** Las palabras que no dicen de quién es un título: forma jurídica, clase, artículos. */
const PALABRAS_QUE_NO_IDENTIFICAN = new Set(
  ("the inc corp corporation co company group holding holdings sa ag nv plc ltd limited se spa asa ab oyj class adr reg cl de of " +
    "and sab cv bhd tbk pcl kgaa gmbh ord shs").split(" ")
);

function palabrasDelNombre(nombre: string): Set<string> {
  const plano = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es-ES");
  return new Set(plano.split(/[^\p{L}\p{N}]+/u).filter((palabra) => palabra.length >= 3 && !PALABRAS_QUE_NO_IDENTIFICAN.has(palabra)));
}

/** Las parejas de las carteras del proveedor que traen ticker e ISIN. Las del emisor no cuentan: se resolverían consigo mismas. */
export function paresDeLasCarteras(carteras: Iterable<BdbAssetHoldings | null | undefined>): ParDeIdentificadores[] {
  const pares: ParDeIdentificadores[] = [];
  for (const cartera of carteras) {
    if (!cartera || cartera.issuer_portfolio) continue;
    for (const linea of cartera.holdings) {
      const isin = linea.isin?.trim().toUpperCase();
      const ticker = linea.ticker?.trim();
      if (!isin || !ticker || !ISIN.test(isin)) continue;
      pares.push({ ticker, isin, name: linea.name, ...(linea.currency?.trim() ? { currency: linea.currency.trim().toUpperCase() } : {}) });
    }
  }
  return pares;
}

/** Las parejas de las acciones del catálogo, de sus tarjetas de lectura (`instrument_id`, `identity.ticker`, `identity.currency`). */
export function paresDelCatalogo(tarjetas: readonly Crudo[]): ParDeIdentificadores[] {
  return tarjetas.flatMap((tarjeta) => {
    if (tarjeta["instrument_type"] !== "STOCK") return [];
    const identidad = (tarjeta["identity"] ?? {}) as Crudo;
    const isin = texto(tarjeta["instrument_id"])?.toUpperCase();
    const ticker = texto(identidad["ticker"]);
    const name = texto(identidad["name"]);
    if (!isin || !ISIN.test(isin) || !ticker || !name) return [];
    const currency = texto(identidad["currency"])?.toUpperCase();
    return [{ ticker, isin, name, ...(currency ? { currency } : {}) }];
  });
}

export type IndiceDeTickers = ReadonlyMap<string, readonly ParDeIdentificadores[]>;

export function indiceDeTickers(pares: Iterable<ParDeIdentificadores>): IndiceDeTickers {
  const indice = new Map<string, ParDeIdentificadores[]>();
  for (const par of pares) {
    const raiz = raizDelTicker(par.ticker);
    if (!raiz) continue;
    indice.set(raiz, [...(indice.get(raiz) ?? []), par]);
  }
  return indice;
}

/**
 * El ISIN de una línea del emisor que solo trae ticker, o `undefined` si no se puede afirmar. Medido el 11-11-2026 contra la cartera de
 * Amundi Stoxx Europe 600, que trae ticker e ISIN, con las carteras del proveedor de toda la base: 507 aciertos y un desacuerdo, UPM, que
 * el proveedor tiene con su ISIN anterior; contra las acciones del catálogo, 149 y ninguno. Solo con el ticker habrían sido 2 errores en
 * Amundi, y en las carteras de Asia, China e India, otros como «1211» (BYD en Hong Kong, una minera saudí en el proveedor) o «HAL».
 */
export function isinPorTicker(linea: Pick<LineaDelEmisor, "ticker" | "name" | "currency" | "issuer_country">, indice: IndiceDeTickers): string | undefined {
  if (!linea.ticker) return undefined;
  let candidatos = indice.get(raizDelTicker(linea.ticker)) ?? [];
  const divisa = linea.currency?.toUpperCase();
  const pais = linea.issuer_country?.trim().toUpperCase();
  if (divisa) candidatos = candidatos.filter((par) => par.currency === divisa);
  else if (pais && /^[A-Z]{2}$/.test(pais)) candidatos = candidatos.filter((par) => par.isin.slice(0, 2) === pais);
  else return undefined;
  const palabras = palabrasDelNombre(linea.name);
  candidatos = candidatos.filter((par) => [...palabrasDelNombre(par.name)].some((palabra) => palabras.has(palabra)));
  const isins = new Set(candidatos.map((par) => par.isin));
  return isins.size === 1 ? [...isins][0] : undefined;
}

/* ─────────────────────────────── La cartera de la aplicación ─────────────────────────────── */

/** Si los pesos salen del valor de mercado: todas las líneas lo traen y su suma no es cero. */
function pesaPorValorDeMercado(lineas: readonly LineaDelEmisor[]): number | null {
  if (lineas.length === 0 || lineas.some((linea) => linea.market_value === undefined)) return null;
  const suma = lineas.reduce((total, linea) => total + (linea.market_value ?? 0), 0);
  return Number.isFinite(suma) && suma !== 0 ? suma : null;
}

/**
 * La cartera del emisor como una cartera de la aplicación, con `issuer_portfolio` para que todo el que la pinte diga de dónde sale. Las
 * líneas sin ISIN pasan por `isinPorTicker`; las que no se resuelven siguen por su nombre (`holdingKey`).
 */
export function aCarteraDeLaApp(cartera: CarteraDelEmisor, indice: IndiceDeTickers = new Map()): BdbAssetHoldings {
  const sumaDelValor = pesaPorValorDeMercado(cartera.lineas);
  const holdings: BdbHoldingPosition[] = [];
  for (const linea of cartera.lineas) {
    const weight_pct = sumaDelValor !== null ? ((linea.market_value ?? 0) / sumaDelValor) * 100 : linea.weight * 100;
    if (!Number.isFinite(weight_pct) || weight_pct === 0) continue;
    const isin = linea.isin ?? isinPorTicker(linea, indice);
    holdings.push({
      name: linea.name,
      weight_pct,
      ...(isin ? { isin } : {}),
      ...(linea.ticker ? { ticker: linea.ticker } : {}),
      ...(linea.position_type ? { holding_type_code: `${PREFIJO_DEL_EMISOR}${linea.position_type}` } : {}),
      ...(linea.currency ? { currency: linea.currency } : {}),
      ...(linea.issuer_country ? { country: linea.issuer_country } : {})
    });
  }
  const origen: BdbIssuerPortfolioOrigin = {
    source: cartera.resumen.source,
    as_of: cartera.resumen.as_of,
    weighting: sumaDelValor !== null ? "MARKET_VALUE" : "DECLARED_WEIGHT"
  };
  return {
    asset_id: cartera.asset_id,
    storage_mode: "CHUNKED",
    holdings_count: holdings.length,
    as_of_date: cartera.resumen.as_of,
    holdings,
    issuer_portfolio: origen
  };
}

/** Cuántas acciones del emisor llegan solo con ticker y cuántas se pasan a ISIN, con su peso en puntos. Para medir el cruce. */
export function cruceDeTickers(cartera: CarteraDelEmisor, indice: IndiceDeTickers): { soloTicker: number; cruzan: number; pesoQueCruzaPct: number } {
  const soloTicker = cartera.lineas.filter((linea) => !linea.isin && linea.ticker && linea.position_type === "EQUITY");
  const cruzan = soloTicker.filter((linea) => isinPorTicker(linea, indice) !== undefined);
  return { soloTicker: soloTicker.length, cruzan: cruzan.length, pesoQueCruzaPct: cruzan.reduce((suma, linea) => suma + linea.weight * 100, 0) };
}

/** «cartera del emisor, a 06/11/2026»: la procedencia, en pantalla y en el informe interno. La fecha es la de la cartera. */
export function procedenciaDeLaCarteraDelEmisor(origen: Pick<BdbIssuerPortfolioOrigin, "as_of">): string {
  return `cartera del emisor, a ${formato.oFalta(formato.fecha(origen.as_of))}`;
}

/**
 * Lo mismo para lo que ve un cliente: «cartera completa, a 06/11/2026». Dice que es la cartera entera y de cuándo es —puede ser más
 * antigua que la del proveedor—, y no de quién: de dónde viene un dato no se enseña en Modo cliente (`fuenteDeDatos`).
 */
export function procedenciaDeLaCartera(origen: Pick<BdbIssuerPortfolioOrigin, "as_of">, nombrarAlEmisor: boolean): string {
  return nombrarAlEmisor ? procedenciaDeLaCarteraDelEmisor(origen) : `cartera completa, a ${formato.oFalta(formato.fecha(origen.as_of))}`;
}

/**
 * La frase del informe interno que dice qué carteras son del emisor: «Cartera completa del emisor, no la del proveedor: iShares Core MSCI
 * World, a 06/11/2026; Vanguard S&P 500, a 30/09/2026.». Sin ninguna, `null`.
 */
export function fraseDeLasCarterasDelEmisor(fondos: ReadonlyArray<{ nombre: string; origen?: Pick<BdbIssuerPortfolioOrigin, "as_of"> }>): string | null {
  const conEmisor = fondos.filter((fondo): fondo is { nombre: string; origen: Pick<BdbIssuerPortfolioOrigin, "as_of"> } => Boolean(fondo.origen));
  if (conEmisor.length === 0) return null;
  return `Cartera completa del emisor, no la del proveedor: ${conEmisor.map(({ nombre, origen }) => `${nombre}, a ${formato.oFalta(formato.fecha(origen.as_of))}`).join("; ")}.`;
}
