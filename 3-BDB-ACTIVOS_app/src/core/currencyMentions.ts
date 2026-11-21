/**
 * Regla global de divisa (octava pasada de la auditoría del 16-10-2026,
 * revisión 7: B2, B3 y B4).
 *
 * Las reglas por fila no ven un «USD» que está en el título, en una nota al
 * pie, en el `<caption>`, en el nombre de la hoja, en la cabecera del precio o
 * en el formato de una celda. Por eso se escanea TODO el fichero en busca de
 * menciones de una divisa que no sea el euro:
 * - códigos ISO en mayúsculas («USD», «CLP», «GBX») o, los habituales, en
 *   minúsculas («usd»), y «GBp» (peniques);
 * - símbolos («$», «£», «¥», «kr», «zł», «R$»…, y «¤», la marca que pone el
 *   lector de libros para una divisa que no reconoce);
 * - nombres en palabras y abreviaturas («dólares», «dól.», «dls.», «libras
 *   esterlinas», «peniques», «coronas suecas», «yenes»…; «libra» en singular,
 *   solo en un título, una nota o una cabecera, porque en un nombre puede ser
 *   un fondo: «Fondo Libra Patrimonio»);
 * - y, en títulos y notas, frases que dicen que los importes están en la
 *   divisa de cada valor («en la divisa de cotización de cada valor»).
 * El lector añade las suyas: los valores de una columna de divisa (también los
 * códigos numéricos ISO 4217, «840») y un tipo de cambio distinto de 1.
 *
 * Novena pasada (revisión 8, I5): cada mención tiene un ALCANCE, que decide el
 * lector: la del nombre de una posición vale para esa fila, la de un título de
 * bloque para su bloque y solo las del fichero (título del extracto, notas,
 * columna o formato de divisa, nombres de hoja, lo oculto y los metadatos)
 * para todo él. Un texto que dice EUR («EUR Hedged», «(EUR)», «Clase EUR»)
 * no menciona otra divisa (`saysEuro`).
 */

/** Una mención de otra divisa: cuál, en qué texto y dónde. */
export interface CurrencyMention {
  /** Código ISO, símbolo, o «otra divisa» si la frase no nombra ninguna. */
  currency: string;
  /** El texto donde aparece, recortado alrededor de la mención. */
  text: string;
  /** Dónde: «el título», «la cabecera», «la hoja «…»», «una nota», «una celda», «la columna «Divisa»». */
  where: string;
}

/** Qué clase de texto se escanea: las frases sueltas solo cuentan en títulos y notas. */
export type MentionSource = "title" | "header" | "cell" | "note";

/** Códigos ISO 4217 distintos del euro que se reconocen en mayúsculas como palabra suelta. */
const FOREIGN_ISO_UPPER = [
  "USD", "GBP", "GBX", "CHF", "JPY", "SEK", "NOK", "DKK", "CAD", "AUD", "NZD", "HKD", "SGD", "CNY", "CNH", "MXN", "BRL", "PLN",
  "CZK", "HUF", "ZAR", "INR", "TRY", "ILS", "KRW", "TWD", "THB", "IDR", "MYR", "PHP", "CLP", "COP", "ARS", "RUB", "SAR", "AED",
  "QAR", "KWD", "ISK", "RON", "BGN", "HRK", "UYU", "VND", "EGP", "NGN", "KES", "UAH", "KZT"
];
/** En minúsculas, solo los habituales que no son palabras corrientes («try», «ron», «pen» quedan fuera). */
const FOREIGN_ISO_LOWER = [
  "usd", "gbp", "gbx", "chf", "jpy", "sek", "nok", "dkk", "cad", "aud", "nzd", "hkd", "sgd", "cny", "cnh", "mxn", "brl", "pln",
  "czk", "huf", "zar", "inr", "krw", "twd", "thb", "clp", "cop", "ars", "rub", "aed", "isk", "bgn"
];
const UPPER_CODE_RE = new RegExp(`(?<![A-Za-z])(${FOREIGN_ISO_UPPER.join("|")}|GBp)(?![A-Za-z])`, "g");
const LOWER_CODE_RE = new RegExp(`(?<![A-Za-z])(${FOREIGN_ISO_LOWER.join("|")})(?![A-Za-z])`, "g");
/** Símbolos: «$» con sus prefijos, «£», «¥», «₹»…, «zł», «kr», «Kč» y «¤». */
const SYMBOL_RE = /(US\$|C\$|CA\$|A\$|AU\$|HK\$|S\$|R\$|\$|£|¥|₹|₩|₺|₽|₪|฿|₱|₫|₦|₴|zł|¤)|(?<![A-Za-z])(kr|Kč)\.?(?![A-Za-z])/g;
const SYMBOL_CODES: Record<string, string> = {
  US$: "USD", $: "USD", C$: "CAD", CA$: "CAD", A$: "AUD", AU$: "AUD", HK$: "HKD", S$: "SGD", R$: "BRL", "£": "GBP", "¥": "JPY",
  "₹": "INR", "₩": "KRW", "₺": "TRY", "₽": "RUB", "₪": "ILS", "฿": "THB", "₱": "PHP", "₫": "VND", "₦": "NGN", "₴": "UAH",
  zł: "PLN", kr: "kr", Kč: "CZK", "¤": "otra divisa"
};
/** Divisas en palabras (sobre el texto en minúsculas y sin acentos). Las ambiguas solo con su adjetivo. */
const WORDS: Array<[RegExp, string]> = [
  [/\bdolar(?:es)?\b|\bdollars?\b|\bdol\.(?=\s|$)|\bdls\b\.?|\bdlrs\b\.?/, "USD"],
  [/\blibras? esterlinas?\b|\blibras\b|\bpounds? sterling\b|\bsterling\b|\bpeniques?\b|\bpence\b/, "GBP"],
  [/\bfrancos? suizos?\b|\bswiss francs?\b/, "CHF"],
  [/\byen(?:es)?\b/, "JPY"],
  [/\bcoronas? (?:suecas?|noruegas?|danesas?|checas?|islandesas?)\b|\bcoronas\b|\bkronor\b|\bkroner\b|\bkrona\b|\bkrone\b|\bkronur\b/, "coronas"],
  [/\byuan(?:es)?\b|\brenminbi\b/, "CNY"],
  [/\breales? brasilen[oa]s?\b|\breal brasileno\b/, "BRL"],
  [/\brupias?\b|\brupees?\b/, "INR"],
  [/\bpesos? (?:mexicanos?|chilenos?|argentinos?|colombianos?|filipinos?|uruguayos?)\b/, "peso"],
  [/\bzloty(?:s)?\b|\beslotis?\b/, "PLN"],
  [/\bflorin(?:es)? (?:hungaros?)?\b|\bforint(?:s)?\b/, "HUF"],
  [/\brand(?:es)? sudafricanos?\b|\brands\b/, "ZAR"],
  [/\bliras? turcas?\b/, "TRY"],
  [/\brublos?\b/, "RUB"],
  [/\bshekel(?:s)?\b|\bsequel(?:es)?\b/, "ILS"],
  [/\bwon coreanos?\b/, "KRW"],
  [/\bdirham(?:s)?\b|\briyal(?:es)?\b|\bringgit\b|\bbahts?\b/, "otra divisa"]
];
/** Solo en un título, una nota o una cabecera: en el nombre de una posición son ambiguas («Fondo Libra Patrimonio»). */
const HEADING_WORDS: Array<[RegExp, string]> = [[/\blibra\b/, "GBP"]];
/** Frases que dicen que los importes están en la divisa de cada valor, sin nombrarla (W26). */
const LOCAL_CURRENCY_PHRASE =
  /\b(?:divisa|moneda) (?:de )?(?:cotizacion|local|original|del (?:valor|activo|instrumento)|de cada valor|de emision)\b|\blocal currency\b|\btrading currency\b|\bquot(?:e|ation) currency\b|\bdevise (?:locale|de cotation)\b|\ben su divisa\b|\ben la divisa de (?!referencia)/;
/** El texto dice EUR («EUR Hedged», «(EUR)», «Clase EUR Acc», «€»). */
const SAYS_EURO_RE = /(?<![A-Za-z])eur(?![A-Za-z])|€/i;

/** Minúsculas y sin acentos, con la misma longitud que el texto (para situar una mención). */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** ¿Dice el texto EUR? Un nombre así no menciona otra divisa (I5 de la revisión 8). */
export function saysEuro(text: string): boolean {
  return SAYS_EURO_RE.test(text);
}

interface Found {
  currency: string;
  at: number;
  length: number;
}

function find(text: string, source: MentionSource): Found[] {
  if (!text) return [];
  const found: Found[] = [];
  for (const match of text.matchAll(UPPER_CODE_RE)) found.push({ currency: match[1] === "GBp" || match[1] === "GBX" ? "GBP" : match[1], at: match.index, length: match[0].length });
  for (const match of text.matchAll(LOWER_CODE_RE)) found.push({ currency: match[1] === "gbx" ? "GBP" : match[1].toUpperCase(), at: match.index, length: match[0].length });
  for (const match of text.matchAll(SYMBOL_RE)) found.push({ currency: SYMBOL_CODES[match[1] ?? match[2]] ?? "otra divisa", at: match.index, length: match[0].length });
  const folded = fold(text).replace(/\s/g, " ");
  const words = source === "cell" ? WORDS : [...WORDS, ...HEADING_WORDS];
  for (const [re, code] of words) {
    const match = re.exec(folded);
    if (match) found.push({ currency: code, at: match.index, length: match[0].length });
  }
  if (source === "title" || source === "note") {
    const match = LOCAL_CURRENCY_PHRASE.exec(folded.replace(/ {2,}/g, " "));
    if (match) found.push({ currency: "otra divisa", at: Math.min(match.index, text.length - 1), length: match[0].length });
  }
  return found.sort((a, b) => a.at - b.at);
}

/** M3 (revisión 8): el trozo del texto donde está la mención, no el principio del texto. */
function clipAround(text: string, at: number, length: number): string {
  const flat = text.replace(/\s/g, " ");
  if (flat.trim().length <= 70) return flat.replace(/\s+/g, " ").trim();
  const start = Math.max(0, at - 30);
  const end = Math.min(flat.length, at + length + 30);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).replace(/\s+/g, " ").trim()}${end < flat.length ? "…" : ""}`;
}

/** Divisas distintas del euro que menciona un texto. */
export function foreignCurrenciesIn(text: string, source: MentionSource): string[] {
  return [...new Set(find(text, source).map((item) => item.currency))];
}

/** Menciones de otra divisa en un texto, con dónde están. */
export function mentionsIn(text: string, source: MentionSource, where: string): CurrencyMention[] {
  const seen = new Set<string>();
  const mentions: CurrencyMention[] = [];
  for (const item of find(text, source)) {
    if (seen.has(item.currency)) continue;
    seen.add(item.currency);
    mentions.push({ currency: item.currency, text: clipAround(text, item.at, item.length), where });
  }
  return mentions;
}

/** Las menciones de una celda o una fila salen al final: lo que dice el fichero entero va primero (M3 de la revisión 8). */
const rowPlace = (where: string) => /^(?:una fila|la lista|el nombre)/.test(where);

/**
 * Una línea para el resumen: «USD en la columna «Divisa» («USD», 4 veces); USD
 * en la hoja «Cuenta USD» («Cuenta USD»)». La misma divisa en el mismo sitio va
 * una vez, con cuántas.
 */
export function describeMentions(mentions: readonly CurrencyMention[], limit = 4): string {
  const groups = new Map<string, { mention: CurrencyMention; count: number }>();
  for (const mention of mentions) {
    const key = `${mention.currency}|${mention.where}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { mention, count: 1 });
  }
  const ordered = [...groups.values()].sort((a, b) => Number(rowPlace(a.mention.where)) - Number(rowPlace(b.mention.where)));
  const items = ordered.map(({ mention, count }) => {
    const label = mention.currency === "otra divisa" ? "otra divisa" : mention.currency;
    return `${label} en ${mention.where} («${mention.text}»${count > 1 ? `, ${count} veces` : ""})`;
  });
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return shown.join("; ") + (rest > 0 ? `; y ${rest === 1 ? "otra mención" : `${rest} menciones más`}` : "");
}
