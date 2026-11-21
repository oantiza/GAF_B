/**
 * Analizador ÚNICO de importes en EUR para las importaciones de posiciones
 * (quinta pasada de la auditoría del 16-10-2026). Lo usan el lector de
 * extractos (y con él el Constructor) y la lista de Posiciones globales.
 * `parseEuropeanNumber` sigue siendo el parser permisivo de pesos,
 * retrocesiones y campos de importe tecleados.
 *
 * Estrategia en positivo: una celda solo es un importe en EUR si es una cifra
 * limpia, sin otra divisa ni porcentaje, y su formato numérico (español o
 * inglés) está decidido.
 * - Una cifra con una marca de divisa distinta del euro («8.736,00 USD»,
 *   «$8,736.00») no es un importe en EUR; con «%», tampoco; con cualquier otra
 *   letra, no es una cifra.
 * - El formato se decide por el CONJUNTO de valores de la propia columna de
 *   importe (sexta pasada, B3: nunca por un precio o unas participaciones de
 *   otra columna, ni por otra tabla u otro fichero): «80,000» es 80.000 en
 *   una columna donde otra celda dice «7,512.09», y 80 en una donde otra dice
 *   «12,500» con más decimales.
 * - Una cifra ambigua que la columna resolvería con TRES decimales cuando las
 *   cifras que la deciden tienen dos o menos («80.000» junto a «7,512.09») es
 *   casi siempre un error de origen: sigue siendo ambigua (I3).
 * - Si nada lo decide, una cifra con un solo separador y tres dígitos detrás
 *   («80,000», «80.000») solo se lee como miles cuando ese separador es el de
 *   miles del idioma de la cabecera (inglés: coma; español: punto). Si no, es
 *   ambigua: aviso y fuera, nunca 80 € por 80.000 €.
 */

export type NumberStyle = "es" | "en";

/** Divisa escrita con palabras o símbolo. */
const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/^(?:€|eur|euros?)$/i, "EUR"],
  [/^(?:\$|us\$|usd|d[oó]lar(?:es)?(?: (?:usa?|ee\.? ?uu\.?|estadounidenses?|americanos?))?|dollars?|us dollars?)$/i, "USD"],
  [/^(?:£|gbp|gbx|libras?(?: esterlinas?)?|pounds?(?: sterling)?|peniques?|pence)$/i, "GBP"],
  [/^(?:chf|francos? suizos?|swiss francs?)$/i, "CHF"],
  [/^(?:¥|jpy|yen(?:es)?(?: japoneses?)?)$/i, "JPY"],
  // Símbolos de otras divisas (sexta pasada, B7): una cifra con cualquiera de
  // ellos no es un importe en EUR. «kr» puede ser SEK, NOK, DKK o ISK.
  [/^(?:kr\.?|skr|nkr|dkr|kronor|kroner|coronas?)$/i, "kr"],
  [/^(?:zł|zl)$/i, "PLN"],
  [/^r\$$/i, "BRL"],
  [/^₹$/, "INR"],
  [/^(?:fr\.|sfr\.?|chf\.)$/i, "CHF"],
  [/^(?:c\$|ca\$|can\$)$/i, "CAD"],
  [/^(?:a\$|au\$)$/i, "AUD"],
  [/^hk\$$/i, "HKD"],
  [/^s\$$/i, "SGD"],
  [/^(?:₩|₺|₽|₪|฿|₱|₫|₦|₴|kč|ft)$/i, "otra divisa"],
  // «¤»: la marca que pone el lector de libros cuando el formato de la celda
  // trae una divisa que no reconoce («[$лв-402]»).
  [/^¤$/, "otra divisa"]
];
const ISO_CURRENCY_CODES = new Set([
  "EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK", "DKK", "CAD", "AUD", "NZD", "HKD", "SGD", "CNY", "CNH", "MXN",
  "BRL", "PLN", "CZK", "HUF", "ZAR", "INR", "TRY", "ILS", "KRW", "TWD", "THB", "IDR", "MYR", "PHP", "CLP", "COP",
  "PEN", "ARS", "RUB", "SAR", "AED", "QAR", "KWD", "ISK", "RON", "BGN", "HRK"
]);

/** Divisa de un texto que es SOLO una divisa («EUR», «€», «Euro», «Dólar», «usd»). `null` si no lo es. */
export function currencyOf(text: string | undefined): string | null {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return null;
  for (const [re, code] of CURRENCY_WORDS) if (re.test(value)) return code;
  const upper = value.toUpperCase();
  return /^[A-Z]{3}$/.test(upper) && ISO_CURRENCY_CODES.has(upper) ? upper : null;
}

/** Códigos numéricos ISO 4217 de las divisas más habituales (978 = EUR, 840 = USD…). */
const ISO_NUMERIC_CODES: Record<string, string> = {
  "978": "EUR", "840": "USD", "826": "GBP", "756": "CHF", "392": "JPY", "752": "SEK", "578": "NOK", "208": "DKK",
  "124": "CAD", "036": "AUD", "554": "NZD", "344": "HKD", "702": "SGD", "156": "CNY", "484": "MXN", "986": "BRL",
  "985": "PLN", "203": "CZK", "348": "HUF", "710": "ZAR", "356": "INR", "949": "TRY", "376": "ILS", "410": "KRW",
  "643": "RUB", "946": "RON", "975": "BGN"
};

/**
 * Divisa de una celda de una COLUMNA DE DIVISA: además de los códigos y los
 * símbolos, los códigos numéricos ISO 4217 (B7: «978», «840»). Fuera de una
 * columna de divisa, «840» es una cifra.
 */
export function currencyOfColumnValue(text: string | undefined): string | null {
  const value = (text ?? "").trim();
  return currencyOf(value) ?? ISO_NUMERIC_CODES[value.padStart(3, "0")] ?? null;
}

const LEADING_MARK = /^([A-Za-z]{1,3}\$|[A-Za-z]{1,3}\.?|zł|kč|[€$£¥₹₩₺₽₪฿₱₫₦₴¤])\s*/i;
const TRAILING_MARK = /\s*([A-Za-z]{1,3}\$|euros?|kronor|kroner|coronas?|[A-Za-z]{1,3}\.?|zł|kč|[€$£¥₹₩₺₽₪฿₱₫₦₴¤])$/i;

export type AmountCell =
  | { kind: "empty" }
  | { kind: "number"; digits: string; sign: 1 | -1; currency: string | null; raw: string }
  | { kind: "foreign"; currency: string; raw: string }
  | { kind: "percent"; raw: string }
  | { kind: "invalid"; raw: string };

/**
 * Primera lectura de una celda, sin decidir aún el formato numérico: quita la
 * divisa (y la anota), el signo y los separadores de miles inequívocos
 * (espacios, apóstrofo ASCII o tipográfico).
 */
export function readAmountCell(input: string | undefined): AmountCell {
  const raw = (input ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { kind: "empty" };
  if (raw.includes("%")) return /\d/.test(raw) ? { kind: "percent", raw } : { kind: "invalid", raw };

  let text = raw;
  let currency: string | null = null;
  let clash = false;
  const takeMark = (mark: string): boolean => {
    const code = currencyOf(mark);
    if (!code) return false;
    if (currency && currency !== code) clash = true;
    currency = code;
    return true;
  };
  const leading = LEADING_MARK.exec(text);
  if (leading && /^[\d(+\-−]/.test(text.slice(leading[0].length))) {
    if (!takeMark(leading[1])) return { kind: "invalid", raw };
    text = text.slice(leading[0].length);
  }
  const trailing = TRAILING_MARK.exec(text);
  if (trailing && /[\d)\-−]$/.test(text.slice(0, trailing.index))) {
    if (!takeMark(trailing[1])) return { kind: "invalid", raw };
    text = text.slice(0, trailing.index);
  }
  if (clash) return { kind: "invalid", raw };
  if (currency && currency !== "EUR") return { kind: "foreign", currency, raw };

  let sign: 1 | -1 = 1;
  text = text.trim();
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1).trim();
  }
  if (/^[-−]/.test(text)) {
    sign = -1;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }
  if (/[-−]$/.test(text)) {
    sign = -1;
    text = text.slice(0, -1).trim();
  }
  // Separadores de miles inequívocos: espacio y apóstrofo (ASCII o tipográfico).
  if (/^\d{1,3}(?:[ '’]\d{3})+(?:[.,]\d+)?$/.test(text)) text = text.replace(/[ '’]/g, "");
  if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) return { kind: "invalid", raw };
  return { kind: "number", digits: text, sign, currency, raw };
}

/** Lo que dice una cifra de su propio formato. */
export type DigitsStyle =
  | { kind: "plain" }
  | { kind: "decided"; style: NumberStyle }
  /** Un solo separador con tres dígitos detrás: «80,000», «1.250». */
  | { kind: "ambiguous"; separator: "," | "." }
  | { kind: "invalid" };

export function styleOfDigits(digits: string): DigitsStyle {
  const commas = (digits.match(/,/g) ?? []).length;
  const dots = (digits.match(/\./g) ?? []).length;
  if (commas === 0 && dots === 0) return { kind: "plain" };
  if (commas > 0 && dots > 0) {
    const decimal = digits.lastIndexOf(",") > digits.lastIndexOf(".") ? "," : ".";
    const parts = digits.split(decimal);
    if (parts.length !== 2) return { kind: "invalid" };
    const style: NumberStyle = decimal === "," ? "es" : "en";
    const groupRe = style === "es" ? /^[1-9]\d{0,2}(?:\.\d{3})+$/ : /^[1-9]\d{0,2}(?:,\d{3})+$/;
    return groupRe.test(parts[0]) && /^\d+$/.test(parts[1]) ? { kind: "decided", style } : { kind: "invalid" };
  }
  const separator = commas > 0 ? "," : ".";
  const thousandsRe = separator === "," ? /^[1-9]\d{0,2}(?:,\d{3})+$/ : /^[1-9]\d{0,2}(?:\.\d{3})+$/;
  if (commas + dots > 1) {
    // Varios separadores iguales solo pueden ser de miles.
    return thousandsRe.test(digits) ? { kind: "decided", style: separator === "," ? "en" : "es" } : { kind: "invalid" };
  }
  if (thousandsRe.test(digits)) return { kind: "ambiguous", separator };
  // Un solo separador que no forma un grupo de miles: es el decimal.
  return { kind: "decided", style: separator === "," ? "es" : "en" };
}

/** Valor de una cifra con un formato ya decidido. */
export function digitsValue(digits: string, style: NumberStyle): number {
  const thousands = style === "es" ? "." : ",";
  const decimal = style === "es" ? "," : ".";
  const plain = digits.split(thousands).join("").replace(decimal, ".");
  return /^\d+(?:\.\d+)?$/.test(plain) ? Number(plain) : Number.NaN;
}

/** Formato que decide un conjunto de celdas (una columna de importe, una lista). */
export interface ColumnStyle {
  /** El formato de las cifras inequívocas; `null` si ninguna lo decide o se contradicen. */
  style: NumberStyle | null;
  /** Las cifras inequívocas se contradicen (español e inglés en la misma columna). */
  conflict: boolean;
  /** Máximo de decimales entre las cifras que deciden el formato (I3). */
  maxDecimals: number;
}

function decimalsOf(digits: string, style: NumberStyle): number {
  const decimal = style === "es" ? "," : ".";
  const index = digits.lastIndexOf(decimal);
  return index < 0 ? 0 : digits.length - index - 1;
}

/** Formato de un conjunto de celdas: el que impongan las cifras inequívocas. */
export function decideColumnStyle(cells: Iterable<AmountCell>): ColumnStyle {
  let found: NumberStyle | null = null;
  let maxDecimals = 0;
  for (const cell of cells) {
    if (cell.kind !== "number") continue;
    const own = styleOfDigits(cell.digits);
    if (own.kind !== "decided") continue;
    if (found && found !== own.style) return { style: null, conflict: true, maxDecimals: 0 };
    found = own.style;
    maxDecimals = Math.max(maxDecimals, decimalsOf(cell.digits, own.style));
  }
  return { style: found, conflict: false, maxDecimals };
}

/** Formato de un conjunto de celdas: el decidido, `"conflict"` o `null`. */
export function decideStyle(cells: Iterable<AmountCell>): NumberStyle | null | "conflict" {
  const decided = decideColumnStyle(cells);
  return decided.conflict ? "conflict" : decided.style;
}

export interface StyleContext {
  /** Formato decidido por el conjunto de valores de la propia columna (o de la lista). */
  style: NumberStyle | null;
  /** Idioma de la cabecera del importe (o de la pantalla, en una lista). */
  language: NumberStyle | null;
  /** Máximo de decimales de las cifras que decidieron `style` (I3). Sin dato, no se limita. */
  maxDecimals?: number;
}

export type EurAmount =
  | { ok: true; value: number; explicitEur: boolean }
  | {
      ok: false;
      reason: "empty" | "foreign" | "percent" | "invalid" | "ambiguous" | "negative";
      currency?: string;
      raw?: string;
    };

/** Importe en EUR de una celda, con el formato que decide su contexto. */
export function eurAmountOf(cell: AmountCell, context: StyleContext): EurAmount {
  if (cell.kind === "empty") return { ok: false, reason: "empty" };
  if (cell.kind === "foreign") return { ok: false, reason: "foreign", currency: cell.currency, raw: cell.raw };
  if (cell.kind === "percent") return { ok: false, reason: "percent", raw: cell.raw };
  if (cell.kind === "invalid") return { ok: false, reason: "invalid", raw: cell.raw };
  const own = styleOfDigits(cell.digits);
  let style: NumberStyle;
  if (own.kind === "invalid") return { ok: false, reason: "invalid", raw: cell.raw };
  if (own.kind === "plain") style = "es";
  else if (own.kind === "decided") style = own.style;
  else if (context.style) {
    // I3: leída como decimal, la cifra tendría tres decimales; si las cifras
    // que deciden la columna no tienen tantos, no hay certeza.
    const asDecimal = own.separator === (context.style === "es" ? "," : ".");
    if (asDecimal && (context.maxDecimals ?? 3) < 3) return { ok: false, reason: "ambiguous", raw: cell.raw };
    style = context.style;
  } else if (context.language && own.separator === (context.language === "es" ? "." : ",")) style = context.language;
  else return { ok: false, reason: "ambiguous", raw: cell.raw };
  const value = digitsValue(cell.digits, style);
  if (!Number.isFinite(value)) return { ok: false, reason: "invalid", raw: cell.raw };
  if (cell.sign < 0 || value <= 0) return { ok: false, reason: "negative", raw: cell.raw };
  return { ok: true, value, explicitEur: cell.currency === "EUR" };
}

/**
 * Importe con el formato que la lista de posiciones lee sin ambigüedad: coma
 * decimal, sin miles, y un cero de más cuando una cifra menor que mil tendría
 * justo tres decimales («125,125» se escribe «125,1250»).
 */
export function formatPlainEurAmount(amount: number): string {
  const text = String(amount).replace(".", ",");
  return /^[1-9]\d{0,2},\d{3}$/.test(text) ? `${text}0` : text;
}
