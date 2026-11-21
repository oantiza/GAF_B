// Convierte extractos de broker al formato canonico "asset_id,weight" calculando
// los pesos por VALOR DE MERCADO. Soporta tres formatos sin dependencias externas:
//   1) CSV/TSV delimitado (p. ej. separado por ";") con columnas ISIN + Valor de mercado.
//   2) ".xls" que en realidad es un HTML con <table> (lo que exportan muchos brokers).
//   3) Libros .xlsx/.xls convertidos a texto por importFileReader, con una
//      línea «## Hoja: …» delante de cada hoja.
//
// PRINCIPIO (cuarta pasada de la auditoría del 16-10-2026, sin excepciones):
// este lector alimenta los pesos de carteras de cliente (incidente del 04-09).
// Un importe solo se importa si sabemos con certeza que es el contravalor en
// EUR de esa posición. Ante cualquier duda —columna no reconocida, divisa
// distinta de EUR sin contravalor, fila sin identificador claro, número
// ilegible, formato que no entendemos— se AVISA y esa fila o columna NO se
// importa. Mejor perder una fila con aviso que meter un importe falso.
//
// QUINTA PASADA: un único analizador de importes en EUR (eurAmount.ts), la
// divisa por cabecera, contenido y rótulos de grupo, una cabecera por tabla,
// subtotales fuera y un resumen visible (importSummary.ts).
// SEXTA PASADA: formato numérico solo por la propia columna, bloques que no se
// leen avisados con sus ISIN, ISIN repetidos con un posible total fuera.
//
// SÉPTIMA PASADA (revisión 6): ninguna «prueba de EUR» automática es de fiar,
// así que la confirmación del asesor es SIEMPRE (importSummary.ts). El lector
// ya no decide qué está probado; hace dos cosas:
// - ELEGIR BIEN LA COLUMNA: nunca un precio, un valor unitario, de garantía,
//   nominal, pignorado o suscrito, aunque lleve «€» (B2); un «Contravalor» a
//   secas no es EUR (B1); una banda de título no es un rótulo de grupo (B5); y
//   una columna en EUR que no cuadra con el valor de mercado en las filas en
//   EUR no se elige en silencio (E3);
// - DEJAR FUERA, con un aviso que la nombra, toda fila con un indicio de otra
//   divisa: la de la cuenta con cualquier rótulo (B4), la divisa en palabras o
//   en minúsculas, una cifra con otra divisa en la fila (un precio en USD), un
//   «Contravalor USD» con la misma cifra, un tipo de cambio relleno, «€» en las
//   demás filas y no en esa, la divisa de referencia del extracto, texto oculto
//   en la celda, o un «Importe €» genérico en una fila en otra divisa (I1, I2).
// Y un extracto de movimientos no se lee como posiciones (I4).
//
// OCTAVA PASADA (revisión 7): dos piezas de estructura, en vez de reglas caso
// a caso.
// - REGLA GLOBAL DE DIVISA (currencyMentions.ts): si el fichero menciona en
//   CUALQUIER sitio una divisa distinta del euro (título, nota, `<caption>`,
//   hoja, cabecera, celda, formato, columna de divisa, tipo de cambio), solo
//   entran las filas con prueba explícita de EUR (la divisa del activo de la
//   fila, la cabecera de su columna de importe o «€» en la celda). Si no
//   menciona ninguna, se queda el residual aceptado: todo entra para confirmar.
// - SELECTOR DE COLUMNA (B1): con dos o más columnas candidatas a importe que
//   no se pueden conciliar en filas comparables, el lector no elige. El
//   resumen enseña las candidatas con su total y el asesor elige una.
// Además: varios titulares no se mezclan (B5, también un selector); ningún
// bloque desaparece sin aviso (B6) y un bloque con «Ticker» se lee; lo oculto
// de un libro se nombra y no se lee (I1); un bloque de resumen que repite las
// posiciones no se suma (I2).
//
// NOVENA PASADA (revisión 8): la regla de divisa tiene ALCANCE (I5). La mención
// del nombre de una posición vale para esa fila (y un nombre que dice EUR, como
// «Dollar Bond EUR Hedged», no menciona otra divisa); la del título o la
// cabecera de un bloque, para su bloque; solo las del fichero —título del
// extracto, notas, nombres de hoja, columna o formato de divisa, tipos de
// cambio, lo oculto y los metadatos del libro— para todo él. Lo que la regla
// deja fuera sin prueba de EUR (y un ISIN de fuera del euro, también XS, sin
// divisa: I8) se lista aparte con su importe y su motivo, y solo entra si el
// asesor marca la segunda casilla (`INCLUDE_UNPROVEN_KEY`).

import { describeMentions, foreignCurrenciesIn, mentionsIn, saysEuro, type CurrencyMention, type MentionSource } from "./currencyMentions";
import { parseDelimitedText, splitSheetBlocks } from "./delimitedText";
import { decodeHtmlEntities } from "./htmlEntities";
import {
  currencyOf,
  currencyOfColumnValue,
  decideColumnStyle,
  eurAmountOf,
  readAmountCell,
  type AmountCell,
  type ColumnStyle,
  type NumberStyle
} from "./eurAmount";
import { importe, numero, oFalta } from "./formato";
import {
  addAmountColumn,
  addCurrencyCriterion,
  addDiscarded,
  DATE_CHOICE_KEY,
  emptyImportSummary,
  HOLDER_CHOICE_KEY,
  INCLUDE_UNPROVEN_KEY,
  INCLUDE_UNPROVEN_YES,
  NO_DATE_CHOICE,
  NO_HOLDER_CHOICE,
  NONE_CHOICE,
  pendingChoices,
  type EuroConfirmation,
  type ImportChoice,
  type ImportChoiceOption,
  type ImportChoiceValues,
  type ImportedPosition,
  type ImportSummary,
  type UnprovenPositions
} from "./importSummary";
import { parseEuropeanNumber } from "./numberFormat";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Texto de cabecera normalizado: minúsculas, sin acentos ni espacios dobles. */
export function normHeader(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parser numérico permisivo (pesos, retrocesiones): delega en
 * `parseEuropeanNumber`. Los importes de los extractos NO pasan por aquí, sino
 * por el analizador único de eurAmount.ts.
 */
export function parseAmount(raw: string): number {
  return parseEuropeanNumber(raw);
}

/** ¿Cumple el código el dígito de control de un ISIN (Luhn sobre letras convertidas a números)? */
export function isinCheckDigitOk(code: string): boolean {
  const isin = code.trim().toUpperCase();
  if (!ISIN_RE.test(isin)) return false;
  const digits = isin
    .slice(0, 11)
    .split("")
    .map((char) => (/\d/.test(char) ? char : String(char.charCodeAt(0) - 55)))
    .join("");
  let sum = 0;
  let double = true;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}

/* ─── Tablas ────────────────────────────────────────────────────────────── */

/** B2 (revisión 8): todas las referencias de caracteres de HTML, con nombre y numéricas. */
function decodeEntities(value: string): string {
  return decodeHtmlEntities(value);
}

const MAX_SPAN = 50;

function spanAttr(attrs: string, name: "colspan" | "rowspan"): number {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  const value = match ? Number(match[1]) : 1;
  return Number.isFinite(value) && value >= 1 ? Math.min(value, MAX_SPAN) : 1;
}

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;

/** Celda que no se ve en pantalla: no ocupa columna (R4-03). */
function isHiddenCell(attrs: string): boolean {
  return HIDDEN_STYLE.test(attrs) || /(?:^|\s)hidden(?:\s|=|$)/i.test(attrs);
}

/** Elementos ocultos DENTRO de una celda («<span style="display:none"> €</span>», M1). */
const HIDDEN_INLINE = /<(\w+)\b[^>]*(?:style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["']|\shidden\b)[^>]*>[\s\S]*?<\/\1>/gi;

/** Texto de una celda HTML: las etiquetas de formato en línea («<b>LU</b>1234…»)
    no parten el texto; las de bloque («<p>», «<br>») son un espacio; lo oculto no cuenta. */
function htmlCellText(cell: string): { text: string; hidden: boolean } {
  let hidden = false;
  const visible = cell.replace(HIDDEN_INLINE, () => {
    hidden = true;
    return "";
  });
  const text = stripInvisible(
    decodeEntities(visible.replace(/<\/?(?:b|i|u|em|strong|span|font|a|o:p|sup|sub|small|mark|abbr)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " "))
  )
    .replace(/\s+/g, " ")
    .trim();
  return { text, hidden };
}

/** Marcas invisibles («&lrm;», «&ZeroWidthSpace;», el guion blando…): no se ven y no forman parte de una cifra ni de un ISIN (P29, P30). */
const INVISIBLE_RE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, "");
}

interface Table {
  rows: string[][];
  /** `continued[r][c]`: la celda viene de un rowspan de una fila anterior. */
  continued: boolean[][];
  /** `group[r][c]`: rótulo del colspan que cubre la celda (vacío si no lo hay). */
  group: string[][];
  /** `hidden[r][c]`: la celda tenía texto oculto dentro. */
  hidden: boolean[][];
  /** Filas ocultas (`<tr style="display:none">`, filas ocultas de una hoja): no se leen; se nombran (I1). */
  hiddenRows: string[][];
  /** Es una hoja oculta del libro: no se lee; se nombra (I1). */
  hiddenSheet: boolean;
  html: boolean;
  /** «hoja «Cuenta 1»» o «tabla 2»; `null` si es una tabla suelta. */
  name: string | null;
  /** Título de la tabla: el nombre de la hoja o el `<caption>`. */
  title: string;
  /** Es una hoja de un libro. */
  sheet: boolean;
  /** Texto cuyas celdas se separaron por comas: el único en que una celda vacía de más puede ser medio importe (IMP-6). */
  commaSeparated?: boolean;
  unclosedQuote: boolean;
  /** HTML: el texto visible entre la tabla anterior y esta («<h3>Titular: …</h3>»), por líneas. */
  lead: string[];
  /** Una hoja vacía o las notas del libro (comentarios, propiedades): no se leen; cuentan para la divisa (I1 de la revisión 8). */
  meta: boolean;
}

/**
 * Filas de una tabla HTML con `colspan` y `rowspan` expandidos (N-02, N-10):
 * cada celda queda en la columna que ocupa en pantalla.
 * - `colspan`: el texto en la primera columna y vacías las demás, que guardan
 *   el rótulo en `group` (en una cabecera, el rótulo de grupo vale para todas
 *   las columnas que abarca: R4-01).
 * - `rowspan`: el texto se repite en las filas que abarca, MARCADO como
 *   continuación (N3-01): una fila de continuación nunca aporta un importe
 *   propio a partir de una celda repetida.
 * - Una celda oculta (`display:none`, `hidden`) no cuenta (R4-03).
 */
function htmlTable(table: string): Pick<Table, "rows" | "continued" | "group" | "hidden" | "hiddenRows"> {
  const rows: string[][] = [];
  const continued: boolean[][] = [];
  const group: string[][] = [];
  const hiddenRows: boolean[][] = [];
  const hiddenTrs: string[][] = [];
  const pending = new Map<number, { text: string; group: string; rows: number }>();
  const trs = table.match(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trs) {
    // Una fila oculta no se ve en pantalla: no se lee, pero se nombra (I1 de la revisión 7).
    if (isHiddenCell(/^<tr([^>]*)>/i.exec(tr)?.[1] ?? "")) {
      hiddenTrs.push((tr.match(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) => htmlCellText(cell).text));
      continue;
    }
    const row: string[] = [];
    const cont: boolean[] = [];
    const grp: string[] = [];
    const hid: boolean[] = [];
    let col = 0;
    const fillPending = () => {
      for (let span = pending.get(col); span; span = pending.get(col)) {
        row[col] = span.text;
        cont[col] = true;
        grp[col] = span.group;
        hid[col] = false;
        span.rows -= 1;
        if (span.rows <= 0) pending.delete(col);
        col += 1;
      }
    };
    const cells = tr.match(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/gi) ?? [];
    for (const cell of cells) {
      const attrs = /^<t[dh]([^>]*)>/i.exec(cell)?.[1] ?? "";
      if (isHiddenCell(attrs)) continue;
      fillPending();
      const { text: value, hidden } = htmlCellText(cell);
      const colspan = spanAttr(attrs, "colspan");
      const rowspan = spanAttr(attrs, "rowspan");
      for (let offset = 0; offset < colspan; offset += 1) {
        const cellText = offset === 0 ? value : "";
        const groupText = offset === 0 ? "" : value;
        row[col + offset] = cellText;
        cont[col + offset] = false;
        grp[col + offset] = groupText;
        hid[col + offset] = offset === 0 && hidden;
        if (rowspan > 1) pending.set(col + offset, { text: cellText, group: groupText, rows: rowspan - 1 });
      }
      col += colspan;
    }
    const lastPending = Math.max(-1, ...[...pending.keys()].filter((key) => key >= col));
    while (col <= lastPending) {
      if (pending.has(col)) {
        fillPending();
      } else {
        row[col] = "";
        cont[col] = false;
        grp[col] = "";
        hid[col] = false;
        col += 1;
      }
    }
    rows.push(Array.from(row, (value) => value ?? ""));
    continued.push(Array.from(cont, (value) => value === true));
    group.push(Array.from(grp, (value) => value ?? ""));
    hiddenRows.push(Array.from(hid, (value) => value === true));
  }
  return { rows, continued, group, hidden: hiddenRows, hiddenRows: hiddenTrs };
}

/** Tablas HTML de dentro afuera: una tabla anidada es una tabla propia (R4-03). */
function htmlTables(text: string): string[] {
  const innermost = /<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/i;
  const tables: string[] = [];
  let rest = text;
  for (let guard = 0; guard < 1000; guard += 1) {
    const match = innermost.exec(rest);
    if (!match) break;
    tables.push(match[0]);
    rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`;
  }
  return tables.length > 0 ? tables : [text];
}

export function isHtmlTable(text: string): boolean {
  return /<t(?:able|r)[\s>]/i.test(text);
}

/** Texto visible de un HTML fuera de sus tablas (títulos, párrafos, notas): también cuenta para la regla de divisa. */
function htmlOutsideText(text: string): string {
  return decodeEntities(
    text
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(HIDDEN_INLINE, " ")
      .replace(/<table\b[\s\S]*?<\/table>/gi, "\n")
      .replace(/<\/?(?:p|div|br|h\d|li|title)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Texto visible que precede a cada tabla de un HTML (desde el final de la anterior), por líneas. */
function htmlLeads(text: string, tables: string[]): string[][] {
  let cursor = 0;
  return tables.map((html) => {
    const at = text.indexOf(html, cursor);
    if (at < 0) return [];
    const lead = htmlOutsideText(text.slice(cursor, at));
    cursor = at + html.length;
    return lead ? lead.split("\n") : [];
  });
}

function readTables(text: string): Table[] {
  if (isHtmlTable(text)) {
    const tables = htmlTables(text);
    const leads = htmlLeads(text, tables);
    return tables.map((html, index) => ({
      ...htmlTable(html),
      hiddenSheet: false,
      html: true,
      name: tables.length > 1 ? `tabla ${index + 1}` : null,
      title: htmlCellText(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(html)?.[1] ?? "").text,
      sheet: false,
      unclosedQuote: false,
      lead: leads[index],
      meta: false
    }));
  }
  const tables: Table[] = [];
  for (const block of splitSheetBlocks(text)) {
    const parsed = parseDelimitedText(stripInvisible(block.text));
    if (block.hidden === "rows") {
      // Las filas ocultas de una hoja van con su hoja: no se leen, se nombran.
      const owner = [...tables].reverse().find((table) => table.sheet && table.title === block.sheet && !table.hiddenSheet);
      if (owner) owner.hiddenRows.push(...parsed.rows);
      else tables.push(hiddenOnlyTable(block.sheet ?? "", parsed.rows, false));
      continue;
    }
    if (block.hidden === "sheet") {
      tables.push(hiddenOnlyTable(block.sheet ?? "", parsed.rows, true));
      continue;
    }
    if (block.hidden === "empty" || block.hidden === "notes") {
      const empty = block.hidden === "empty";
      tables.push({
        rows: empty ? [] : parsed.rows,
        continued: [],
        group: [],
        hidden: [],
        hiddenRows: [],
        hiddenSheet: false,
        html: false,
        name: empty ? `hoja vacía «${block.sheet ?? ""}»` : `las notas del libro (${block.sheet ?? ""})`,
        title: empty ? block.sheet ?? "" : "",
        sheet: false,
        unclosedQuote: false,
        lead: [],
        meta: true
      });
      continue;
    }
    tables.push({
      rows: parsed.rows,
      continued: [],
      group: [],
      hidden: [],
      hiddenRows: [],
      hiddenSheet: false,
      html: false,
      name: block.sheet !== null ? `hoja «${block.sheet}»` : null,
      title: block.sheet ?? "",
      sheet: block.sheet !== null,
      commaSeparated: parsed.separator === ",",
      unclosedQuote: parsed.unclosedQuote,
      lead: [],
      meta: false
    });
  }
  return tables;
}

function hiddenOnlyTable(sheet: string, rows: string[][], hiddenSheet: boolean): Table {
  return {
    rows: hiddenSheet ? rows : [],
    continued: [],
    group: [],
    hidden: [],
    hiddenRows: hiddenSheet ? [] : rows,
    hiddenSheet,
    html: false,
    name: `hoja «${sheet}»`,
    title: sheet,
    sheet: true,
    unclosedQuote: false,
    lead: [],
    meta: false
  };
}

/* ─── Vocabulario de cabeceras ──────────────────────────────────────────── */

/** Cabecera de la columna de identificadores: el texto normalizado ES una de
    estas (N-03); no basta con contener «ISIN». «ISIN/ID» es la de la
    exportación propia de Posiciones globales; «Symbol/ISIN», la de Degiro. */
const ISIN_HEADER_RE = /^(?:(?:cod(?:igo)?\.?|code) )?isin(?: code| ?\/ ?id)?$|^(?:symbol|simbolo) ?\/ ?isin$/;

export function isIsinHeaderCell(cell: string | undefined): boolean {
  return ISIN_HEADER_RE.test(normHeader(cell ?? ""));
}

/** Cabecera de una columna de códigos de bolsa (B6 de la revisión 7: un bloque de acciones con «Ticker»). */
const TICKER_HEADER_RE = /^(?:ticker|tickers|simbolo|symbol|ticker bloomberg|bloomberg ticker|cod\.? bolsa|codigo bolsa)$/;

/** Contravalor, también abreviado («Ctvl. EUR», «C/valor») y en alemán («Gegenwert»). */
const CONTRAVALOR_TERM = /\bcontra ?valor\b|\bcontre[- ]?valeur\b|\bcounter ?value\b|\bctv?a?l\b|\bc\/ ?valor\b|\bgegenwert\b/;
/** Valor de mercado, también abreviado («Vr. mdo.», «Val. mdo.»), en alemán («Kurswert», «Marktwert») y
    el «Efectivo» o «Valor efectivo» de los brókeres españoles (I4 de la revisión 8). */
const MARKET_TERM =
  /\bvalor (?:de )?(?:mercado|mercat)\b|\bmarket value\b|\bvaleur (?:de )?marche\b|\bvaloracion\b|\bvaluation\b|\bvalorizacion\b|\bv(?:r|al)?\.? (?:de )?mdo\b|\bkurswert\b|\bmarktwert\b|\b(?:valor )?efectivo\b/;
/** Importe genérico, también «Imp.» y en alemán «Betrag». */
const GENERIC_TERM = /\b(?:importe|import|amount|betrag)\b|\bimp\.(?=\s|$|€|\()/;
const BALANCE_TERM = /\b(?:saldo|balance)\b/;
/** «Valor», «Value», «Valeur» a secas: solo valen con su divisa al lado («Value in EUR», «Valor local»). */
const BARE_VALUE_TERM = /\b(?:valor|value|valeur|wert)\b/;
const EUR_MARK = /\beur\b|€|\beuros?\b/;
/** Una divisa concreta distinta del euro: esa columna nunca es el contravalor en EUR. */
const FOREIGN_MARK =
  /\b(usd|gbp|chf|jpy|sek|nok|dkk|cad|aud|hkd|sgd|cny|mxn|brl|pln|czk|huf|zar|inr|dolar(?:es)?|dollars?|libras?)\b|(\$|£|¥)/;
/** La divisa de la posición («Contravalor divisa», «Market value (local)»). */
const LOCAL_MARK = /\b(?:divisa|local|moneda|mda|mon|original|currency|ccy|devise|div|wahrung)\b/;
/** Cabecera de una columna de divisa, en cualquier posición (R4-07): «Divisa»,
    «Código divisa», «Cód. divisa», «Mda. cotiz.», «Local currency», «Devise». */
const CURRENCY_HEADER = /\b(?:divisa|moneda|mda|mon|currency|ccy|devise|div|wahrung)\b/;
/** Divisa de la CUENTA, con cualquier rótulo (B4): «Div. cuenta», «Div. cta.», «Acct ccy», «Div. liq.». */
const ACCOUNT_CURRENCY =
  /\b(?:cuenta|cta|ctas|account|acct|acc|liquidacion|liq|settlement|sett|stl|cargo|abono|konto|base|referencia|reference)\b/;
/** Divisa del ACTIVO: la de cotización, la de la posición, la del instrumento. */
const ASSET_CURRENCY =
  /\b(?:activo|asset|instrumento|instrument|posicion|position|security|trading|local|valor|titulo|producto|product|cotizacion|cotiz|cotiza|emision|fondo|fund|quote|quoted)\b/;
/** Palabras que una cabecera de divisa sin calificar puede llevar («Código divisa», «Divisa ISO»). */
const CURRENCY_FILLER = /\b(?:divisa|moneda|mda|mon|currency|ccy|devise|div|wahrung|cod|codigo|code|iso)\b|[.():/-]/g;
/** Códigos de divisa de un par («EUR/USD»): «EUR/tít.» no es un par (I7 de la revisión 8). */
const PAIR_CODES = "eur|usd|gbp|chf|jpy|sek|nok|dkk|cad|aud|nzd|hkd|sgd|cny|cnh|mxn|brl|pln|czk|huf|zar|inr|try|ils|krw";
/** Tipo de cambio: una cifra distinta de 1 en la fila es indicio de otra divisa (I2). «Cambio» a secas no
    basta: en los extractos de bróker españoles es el precio (I7 de la revisión 8). */
const FX_HEADER = new RegExp(
  `\\b(?:tipo de cambio|tipo cambio|tasa de cambio|cambio (?:de )?divisas?|fx(?: rate)?|exchange rate|tc|paridad|parity)\\b|(?:^|\\s)t ?\\/ ?c(?:\\s|$|\\.)|\\b(?:${PAIR_CODES}) ?\\/ ?(?:${PAIR_CODES})\\b`
);
/** «Cambio» a secas: es un tipo de cambio solo si sus cifras tienen forma de tipo (1, o cuatro decimales o más). */
const BARE_FX_HEADER = /^cambio$/;
/** Columna del tipo de operación de un extracto de MOVIMIENTOS (I4). */
const OPERATION_HEADER = /\b(?:operacion|tipo de operacion|movimiento|tipo mov|transaction|transaccion|tipo)\b/;
const OPERATION_VALUE = /^(?:compra|venta|suscripci[oó]n|reembolso|traspaso|buy|sell|purchase|sale|subscription|redemption)\b/i;
/** Conceptos que nunca son la valoración de la posición, aunque lleven «€» o EUR (N-01, N3-06, B2). */
const NEVER_VALUE_HEADER = new RegExp(
  [
    "coste", "costo", "\\bcost\\b", "compra", "purchase", "adquisicion", "invertid", "liquidativo", "\\bnav\\b",
    "cupon", "coupon", "dividend", "comision", "commission", "\\bfees?\\b", "gasto", "expense", "plusval", "minusval",
    "\\bgain", "\\bloss", "rendimiento", "resultado", "\\breturn", "yield", "rentab", "retencion", "withholding",
    "interes", "interest", "accrued", "impuesto", "\\btax", "\\bpeso\\b", "weight", "%", "porcentaje", "percent",
    // Séptima pasada (B2): ni el valor unitario, ni el de garantía, ni el nominal, el pignorado o el suscrito.
    "unitari", "\\bunit\\b", "garantia", "lending", "collateral", "pignorad", "pledged", "nominal", "suscrit",
    "subscribed", "aportad", "disponible", "available", "tipo de cambio", "\\bcambio\\b", "exchange rate", "\\bfx\\b"
  ].join("|")
);
/** Una cabecera que EMPIEZA por un precio, una fecha o un tipo es eso («Precio contravalor EUR», «Tipo saldo»). */
const PRICE_FIRST_HEADER = /^(?:precio|cotizacion|price|valor liquidativo|fecha|date|tipo|type|clase|class)\b/;
/** Precios, unidades y fechas: una columna así no es un importe aunque lleve un rótulo de grupo de valoración. */
const PRICE_OR_UNITS_HEADER =
  /precio|price|cotizacion|participaciones|titulos|unidades|acciones|quantity|units|shares|inversion|nominal|cambio|fecha|date|kurs\b|stuck/;
/** Unidades: una cifra negativa aquí es una posición corta (I4). */
const UNITS_HEADER = /\b(?:titulos|participaciones|acciones|unidades|cantidad|quantity|units|shares|nominal|stuck)\b/;
/** Palabras de cabecera de una lista o de una tabla (aunque vayan en mayúsculas). */
const LIST_HEADER_WORDS =
  /^(?:id|ticker|simbolo|symbol|codigo|code|activo|asset|fondo|fund|nombre|name|producto|product|cliente|cuenta|instrumento|security|titre|descripcion|description|denominacion|emision|emisor|wertpapier|produit|valor|posicion|position)$/;
/** «Value in EUR», «Valor en EUR», «Importe en euros»: el importe está convertido a euros. */
const CONVERTED_PHRASE = /\b(?:en|in) (?:eur|euros?)\b/;
/** Divisa de referencia del extracto, en un título o una nota al pie (B1): «Divisa de referencia: USD», «Base currency: USD». */
const REFERENCE_CURRENCY_RE =
  /\b(?:divisa|moneda) (?:de )?(?:referencia|base|la cartera)\b|\b(?:base|reference|reporting|portfolio) currency\b|\bdevise (?:de )?(?:reference|base)\b/;
/** Un importe de otro momento o de otro concepto («Saldo medio», «Valoración 31/12/2025», «objetivo»,
    «desembolsado»): nunca se elige en silencio frente a otra candidata (B1 de la revisión 7). */
const QUALIFIED_VALUE_RE =
  /\b(?:medio|media|promedio|average|objetivo|target|retenid[oa]|bloquead[oa]|embargad[oa]|desembolsad[oa]|comprometid[oa]|inicial|anterior|previo|previous|prior|apertura|opening)\b|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\b(?:19|20)\d{2}\b/;
/** Prefijos de ISIN de los países del euro (Bulgaria desde el 1-1-2026, y Andorra, Mónaco, San Marino y el
    Vaticano, que lo usan) y de las instituciones de la UE (EU). XS NO: un eurobono puede estar en cualquier
    divisa (I8 de la revisión 8). Otro prefijo sin prueba de EUR no entra solo. */
const EURO_AREA_ISIN = new Set([
  "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
  "AD", "MC", "SM", "VA", "EU"
]);

/** ¿Es un ISIN de fuera del euro (US, GB, CH, JP…, o XS)? Sin prueba de EUR no entra solo (W51, I8). */
export function isNonEuroAreaIsin(id: string): boolean {
  return isIsinCode(id) && !EURO_AREA_ISIN.has(id.trim().toUpperCase().slice(0, 2));
}

/** Por qué un ISIN de fuera del euro sin divisa no entra solo (M2 de la revisión 8: sin «casi nunca cotiza en euros»). */
export function nonEuroIsinReason(id: string): string {
  const prefix = id.trim().toUpperCase().slice(0, 2);
  return prefix === "XS"
    ? "ISIN XS sin divisa: un eurobono puede estar en cualquier divisa"
    : `ISIN de fuera del euro (${prefix}) sin divisa: no consta que esté en euros`;
}

type AmountKind = "eur" | "unknown" | "position";
type AmountTerm = "contravalor" | "market" | "generic" | "balance" | "bare";

interface AmountClass {
  /** 0 importe en EUR · 1 valor de mercado / valoración / contravalor sin divisa · 2 importe genérico · 3 saldo. */
  tier: number;
  /** «eur»: su propio rótulo dice EUR · «unknown»: no dice su divisa · «position»: en la divisa de la posición. */
  kind: AmountKind;
  /** «Saldo»: sin «EUR» en la cabecera exige la divisa EUR explícita en la fila (R4-12). */
  balance: boolean;
  /** El término más fuerte del rótulo. */
  term: AmountTerm;
}

/**
 * ¿Qué importe es esta columna? `parts` son los rótulos de la cabecera de
 * arriba abajo. `null` si no es un importe. El «EUR» solo cuenta en el rótulo
 * PROPIO de la columna (el de abajo, o el de grupo si la columna no tiene otro):
 * una banda «Valoración de la cartera en EUR» no convierte en euros las columnas
 * de debajo (B5). Un «Contravalor» a secas no dice que sea EUR (B1).
 */
function classifyHeaderParts(parts: string[]): AmountClass | null {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.some((part) => NEVER_VALUE_HEADER.test(part))) return null;
  const bottom = clean[clean.length - 1];
  const label = clean.join(" ");
  const contravalor = CONTRAVALOR_TERM.test(label);
  const market = MARKET_TERM.test(label);
  const generic = GENERIC_TERM.test(label);
  const balance = BALANCE_TERM.test(label);
  const bare = BARE_VALUE_TERM.test(label);
  const strongBottom = CONTRAVALOR_TERM.test(bottom) || MARKET_TERM.test(bottom) || GENERIC_TERM.test(bottom) || BALANCE_TERM.test(bottom);
  if (PRICE_FIRST_HEADER.test(bottom)) return null;
  if (PRICE_OR_UNITS_HEADER.test(bottom) && !strongBottom) return null;
  if (!contravalor && !market && !generic && !balance && !bare) return null;

  const eur = EUR_MARK.test(bottom);
  const foreign = FOREIGN_MARK.test(label);
  const local = LOCAL_MARK.test(label);
  if (foreign) return null; // «Contravalor USD», «Valor de mercado USD»
  if (eur && local) return null; // dice dos divisas: no se adivina
  const onlyBare = !contravalor && !market && !generic && !balance;
  if (onlyBare && !eur && !local) return null; // «Valor» a secas es ambiguo
  const term: AmountTerm = contravalor ? "contravalor" : market ? "market" : generic ? "generic" : balance ? "balance" : "bare";
  const tier = contravalor ? 1 : market ? 1 : generic ? 2 : balance ? 3 : 1;
  if (eur) return { tier: term === "balance" ? 3 : 0, kind: "eur", balance: false, term };
  if (local) return { tier, kind: "position", balance: false, term };
  return { tier, kind: "unknown", balance: term === "balance", term };
}

function classifyHeader(norm: string): AmountClass | null {
  return classifyHeaderParts([norm]);
}

/** Divisa concreta distinta del euro que nombra una cabecera de importe («Contravalor USD»). */
function foreignCurrencyOfHeader(parts: string[]): string | null {
  const label = parts.filter(Boolean).join(" ");
  if (!CONTRAVALOR_TERM.test(label) && !MARKET_TERM.test(label) && !GENERIC_TERM.test(label) && !BARE_VALUE_TERM.test(label)) return null;
  if (NEVER_VALUE_HEADER.test(label) || FX_HEADER.test(label) || BARE_FX_HEADER.test(label)) return null;
  const match = FOREIGN_MARK.exec(label);
  if (!match) return null;
  return currencyOf(match[1] ?? match[2] ?? "") ?? (match[1] ?? match[2] ?? "").toUpperCase();
}

/** ¿La cabecera dice que la columna NO es un importe (precio, unidades, coste, peso…)? */
export function isNonAmountHeader(header: string): boolean {
  const h = normHeader(header);
  if (!h) return false;
  if (NEVER_VALUE_HEADER.test(h) || PRICE_FIRST_HEADER.test(h)) return true;
  return classifyHeader(h) === null && PRICE_OR_UNITS_HEADER.test(h);
}

/** ¿La cabecera es una columna de importe reconocida (contravalor, valor de mercado, importe, saldo)? */
export function isAmountHeader(header: string): boolean {
  return classifyHeader(normHeader(header)) !== null;
}

/** ¿Es la cabecera de una columna de divisa («Divisa», «Código divisa», «Local currency»)? */
export function isCurrencyHeader(header: string): boolean {
  const h = normHeader(header);
  return CURRENCY_HEADER.test(h) && classifyHeader(h) === null && !NEVER_VALUE_HEADER.test(h);
}

/** ¿Dice la cabecera que el importe está en euros (EUR o €)? */
export function isEuroAmountHeader(header: string): boolean {
  return classifyHeader(normHeader(header))?.kind === "eur";
}

/** Idioma de una cabecera de importe: decide «80,000» frente a «80.000» cuando nada más lo hace. */
export function headerLanguage(norm: string): NumberStyle | null {
  if (/\b(?:market value|value|amount|balance|counter ?value|valuation)\b/.test(norm)) return "en";
  if (
    /\b(?:contra ?valor|valor|importe|import|saldo|valoracion|mercado|mercat|valeur|contre[- ]?valeur|valorizacion|ctv?a?l|mdo|imp|efectivo|kurswert|marktwert|gegenwert|betrag)\b/.test(
      norm
    )
  ) {
    return "es";
  }
  return null;
}

/** ¿Es la celda un rótulo de cabecera conocido? (para reconocer una fila de cabecera) */
function isKnownHeaderCell(cell: string): boolean {
  const h = normHeader(cell);
  if (!h) return false;
  return (
    isIsinHeaderCell(cell) ||
    classifyHeader(h) !== null ||
    isNonAmountHeader(cell) ||
    CURRENCY_HEADER.test(h) ||
    LIST_HEADER_WORDS.test(h)
  );
}

/* ─── Filas ─────────────────────────────────────────────────────────────── */

export function isIsinCode(value: string | undefined): boolean {
  return ISIN_RE.test((value ?? "").trim().toUpperCase());
}

/** Código que no es ISIN (AAPL, FUND-1, PRIVADO-1): mayúsculas, sin espacios y
    con alguna letra. Un rótulo («Renta variable», «Fondos») no lo es. */
const OTHER_ID_RE = /^(?=[A-Z0-9._\-/]*[A-Z])[A-Z0-9][A-Z0-9._\-/]{1,39}$/;
/** En una lista tecleada también valen las minúsculas («aapl», «fund-1»). */
const LIST_ID_RE = /^(?=[A-Za-z0-9._\-/]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._\-/]{0,39}$/;
const NOT_AN_ID_RE = /^(?:total(?:es)?|sub-?total|suma|eur|usd|gbp|chf|jpy)\b/i;
/** Fila de total o subtotal: el rótulo EMPIEZA por la palabra (R4-11: «PIMCO Total Return» es un fondo). */
export const TOTAL_LABEL_RE = /^(?:total(?:es)?|sub-?total|suma)\b/i;
const BARE_TOTAL_LABEL_RE = /^(?:total(?:es)?|sub-?total|suma)\s*:?$/i;
/** Título de una hoja o una tabla de totales: lo que hay en ella repite las posiciones (B5). */
const SUMMARY_TITLE_RE = /\b(?:resumen|consolidad[oa]s?|totales|total|agregad[oa]s?|summary|consolidated|overview|totals)\b/;
/** Una posición corta o vendida (I4). */
const SHORT_LABEL_RE = /^(?:corta|corto|short|vendida|vendido|posicion corta|short position|venta en corto|sell short)$/;
const SHORT_INLINE_RE = /\((?:corta|corto|short)\)/i;
const ISO_FOREIGN_CODES =
  "USD|GBP|CHF|JPY|SEK|NOK|DKK|CAD|AUD|NZD|HKD|SGD|CNY|CNH|MXN|BRL|PLN|CZK|HUF|ZAR|INR|TRY|ILS|KRW|TWD|RUB";
/** Indicio de otra divisa en un texto (B7, I2): un código ISO como palabra suelta, en mayúsculas o
    en minúsculas («ETF B USD», «(usd)», «Acc USD»), una divisa en palabras («Dólar americano») o un símbolo. */
const CURRENCY_SIGNAL_RE = new RegExp(
  `(?:^|[^A-Za-z])(${ISO_FOREIGN_CODES})(?![A-Za-z])|(d[oó]lar(?:es)?|dollars?|libras? esterlinas?|pounds? sterling|francos? suizos?|swiss francs?|yen(?:es)?\\b)|([$£¥₹₩₺₽₪])`,
  "i"
);

export function currencySignalIn(text: string): string | null {
  const match = CURRENCY_SIGNAL_RE.exec(text);
  if (!match) return null;
  return (match[1] ?? "").toUpperCase() || match[2] || match[3] || null;
}

export type PositionIdKind = "isin" | "code" | "word" | "none";

/**
 * Clase de un identificador de posición (lector y lista, R4-08):
 * - «isin»: un código con forma de ISIN;
 * - «code»: un código de activo (AAPL, SAN.MC, FUND-1, PRIVADO-1): se importa
 *   siempre con aviso;
 * - «word»: una palabra suelta de seis o más letras (PATRIMONIO, CARTERA,
 *   FONDOS, LIQUIDEZ): un rótulo o un total, nunca una posición;
 * - «none»: un texto que no es un identificador (rótulo, total, divisa).
 */
export function classifyPositionId(raw: string | undefined, options: { list?: boolean } = {}): PositionIdKind {
  const value = (raw ?? "").trim();
  if (!value) return "none";
  if (isIsinCode(value)) return "isin";
  if (!(options.list ? LIST_ID_RE : OTHER_ID_RE).test(value) || NOT_AN_ID_RE.test(value) || currencyOf(value)) return "none";
  if (/^[A-Za-z]{6,}$/.test(value)) return "word";
  return "code";
}

function nonEmptyCells(row: string[]): number {
  return row.filter((cell) => cell.trim().length > 0).length;
}

function isNumberLike(cell: string): boolean {
  const kind = readAmountCell(cell).kind;
  return kind === "number" || kind === "foreign" || kind === "percent";
}

/** Fila con aspecto de cabecera: al menos dos celdas con texto, ningún ISIN y
    ninguna cifra (N-02: una sección con «Importe total · 200.000» no lo es). */
function isHeaderLikeRow(row: string[]): boolean {
  return nonEmptyCells(row) >= 2 && !row.some(isIsinCode) && !row.some(isNumberLike);
}

/** Fila que abre una tabla o un bloque: cabecera con la columna de ISIN o con una de importe. */
function isSegmentHeaderRow(row: string[]): boolean {
  return isHeaderLikeRow(row) && row.some((cell) => isIsinHeaderCell(cell) || classifyHeader(normHeader(cell)) !== null);
}

/** ¿Hay en el texto una fila de cabecera reconocible? (Posiciones globales decide con esto, R4-06.) */
export function isRecognizableHeaderRow(row: string[]): boolean {
  return isHeaderLikeRow(row) && row.some(isKnownHeaderCell);
}

/* ─── Cabecera y bloques ────────────────────────────────────────────────── */

interface HeaderColumn {
  index: number;
  /** Rótulos normalizados, de arriba abajo (el de grupo primero). */
  parts: string[];
  /** Texto normalizado (las filas de la cabecera unidas). */
  norm: string;
  /** Texto original, para los avisos y el resumen. */
  label: string;
}

/**
 * Cabecera de varias filas fundida por columna: «Contravalor» + «EUR». El
 * rótulo de un grupo vale para todas las columnas que abarca (R4-01): en HTML,
 * el del `colspan`; en un CSV de dos filas, una celda de grupo seguida de
 * celdas vacías cuyas columnas tienen rótulo en una fila de debajo.
 */
function mergeHeader(table: Table, headerRows: number[]): HeaderColumn[] {
  const block = headerRows.map((index) => table.rows[index]);
  const groups = headerRows.map((index) => table.group[index] ?? []);
  const width = Math.max(0, ...block.map((row) => row.length));
  const labelAt = (r: number, c: number): string => {
    const own = (block[r][c] ?? "").trim();
    if (own) return own;
    const spanned = (groups[r][c] ?? "").trim();
    if (spanned) return spanned;
    if (table.html || r === block.length - 1) return "";
    // CSV: celda de grupo a la izquierda en esta fila y rótulo propio debajo.
    const below = block.slice(r + 1).some((row) => (row[c] ?? "").trim());
    if (!below) return "";
    for (let left = c - 1; left >= 0; left -= 1) {
      const cell = (block[r][left] ?? "").trim();
      if (!cell) continue;
      const leftHasBelow = block.slice(r + 1).some((row) => (row[left] ?? "").trim());
      return leftHasBelow ? cell : "";
    }
    return "";
  };
  return Array.from({ length: width }, (_, index) => {
    const labels: string[] = [];
    for (let r = 0; r < block.length; r += 1) {
      const cell = labelAt(r, index);
      if (!cell || labels[labels.length - 1] === cell) continue;
      labels.push(cell);
    }
    const label = labels.join(" ").replace(/\s+/g, " ");
    return { index, parts: labels.map(normHeader), norm: normHeader(label), label };
  });
}

interface Segment {
  headerRows: number[];
  dataRows: number[];
  /** Título del bloque: la fila de una sola celda (o la banda) que lo precede, o el de la tabla. */
  title: string;
  /** Todas las filas de título que preceden a la cabecera (sin ISIN ni cifras), de arriba abajo:
      «Cliente: Ana Ruiz», «Fondos». Para el titular, la fecha y el alcance de las menciones (revisión 8). */
  titleRun: string[];
  /** Índices de esas filas. */
  titleRows: number[];
  /** Bandas de título de la cabecera. */
  bands: string[];
}

const rowKey = (row: string[]) => row.map(normHeader).join("|").replace(/\|+$/, "");

/**
 * Fila que cierra el bloque en curso (B1 de la revisión 5): con aspecto de
 * cabecera, con al menos dos rótulos de cabecera conocidos y distinta de la
 * cabecera del bloque. Lo que la sigue se planifica con ella, y si no se
 * puede, se avisa.
 */
function isOtherHeaderRow(row: string[], current: Segment, rows: string[][]): boolean {
  if (!isHeaderLikeRow(row)) return false;
  if (row.filter(isKnownHeaderCell).length < 2) return false;
  return rowKey(row) !== rowKey(rows[current.headerRows[0]] ?? []);
}

/**
 * Bloques de una tabla (R4-03, B1): cada fila de cabecera (con la columna de
 * ISIN o una de importe, o cualquier otra cabecera distinta de la del bloque
 * en curso) abre uno, con las filas de subcabecera que la siguen. Una banda
 * de título de una o dos celdas encima de una cabecera de verdad no es un
 * rótulo de grupo: es el título del bloque (B5 de la revisión 6). Las filas
 * anteriores a la primera cabecera forman un bloque propio si tienen algún
 * ISIN, con la fila con aspecto de cabecera más cercana por encima.
 */
function findSegments(table: Table): Segment[] {
  const { rows } = table;
  const segments: Segment[] = [];
  const before: number[] = [];
  let current: Segment | null = null;
  let lastTitle = "";
  let run: Array<{ text: string; index: number }> = [];
  for (let index = 0; index < rows.length; ) {
    const row = rows[index];
    if (isSegmentHeaderRow(row) || (current !== null && isOtherHeaderRow(row, current, rows))) {
      let headerRows = [index];
      index += 1;
      while (index < rows.length && isHeaderLikeRow(rows[index]) && !isSegmentHeaderRowNew(rows, headerRows, index)) {
        headerRows.push(index);
        index += 1;
      }
      // Banda de título: una fila de una o dos celdas sobre una cabecera de tres o más.
      const widest = Math.max(...headerRows.map((r) => nonEmptyCells(rows[r])));
      const bands: string[] = [];
      while (headerRows.length > 1 && nonEmptyCells(rows[headerRows[0]]) <= 2 && widest >= 3) {
        bands.push(rows[headerRows[0]].filter((cell) => cell.trim()).join(" · "));
        headerRows = headerRows.slice(1);
      }
      current = {
        headerRows,
        dataRows: [],
        title: [lastTitle, ...bands].filter(Boolean).join(" · ") || table.title,
        titleRun: run.map((item) => item.text),
        titleRows: run.map((item) => item.index),
        bands
      };
      segments.push(current);
      lastTitle = "";
      run = [];
      continue;
    }
    if (row.some(isIsinCode)) lastTitle = "";
    else if (nonEmptyCells(row) === 1 && !row.some(isNumberLike)) lastTitle = row.find((cell) => cell.trim())?.trim() ?? "";
    if (row.some(isIsinCode) || row.some(isNumberLike)) run = [];
    else if (nonEmptyCells(row) > 0) run.push({ text: row.filter((cell) => cell.trim()).join(" ").replace(/\s+/g, " ").trim(), index });
    if (current) current.dataRows.push(index);
    else before.push(index);
    index += 1;
  }
  const firstIsin = before.findIndex((index) => rows[index].some(isIsinCode));
  if (firstIsin >= 0) {
    let header: number[] = [];
    for (let k = firstIsin - 1; k >= 0; k -= 1) {
      const row = rows[before[k]];
      if (nonEmptyCells(row) <= 1) continue; // vacía, sección o título de una celda
      if (isHeaderLikeRow(row)) header = [before[k]];
      break;
    }
    segments.unshift({ headerRows: header, dataRows: before.slice(firstIsin), title: table.title, titleRun: [], titleRows: [], bands: [] });
  }
  return segments;
}

/** Una fila de cabecera idéntica a la que se está leyendo abre un bloque nuevo, no es una subcabecera. */
function isSegmentHeaderRowNew(rows: string[][], headerRows: number[], index: number): boolean {
  const first = rows[headerRows[0]].map(normHeader).join("|");
  return isSegmentHeaderRow(rows[index]) && rows[index].map(normHeader).join("|") === first;
}

/** Divisa que nombra un texto (un código ISO como palabra suelta, «€», «euro», «dólar»…). */
function currencyNamedIn(text: string): string | null {
  const match = new RegExp(`(?:^|[^A-Za-z])(EUR|${ISO_FOREIGN_CODES})(?![A-Za-z])|(€|euros?\\b)`, "i").exec(text);
  if (match?.[1]) return match[1].toUpperCase();
  if (match?.[2]) return "EUR";
  const signal = currencySignalIn(text);
  return signal ? currencyOf(signal) ?? signal : null;
}

interface ReferenceCurrency {
  code: string;
  /** El texto que lo dice («Divisa de referencia: EUR»), para el resumen (M1 de la revisión 7). */
  text: string;
}

/**
 * Divisa de referencia del extracto (B1): la que dice un título, una banda o
 * una nota al pie («Divisa de referencia: USD», «Base currency: USD», «(1)
 * Contravalor en la divisa de referencia de la cartera (USD)»), también en una
 * fila de varias celdas («Divisa de referencia:;USD;Fecha:;…», W13).
 */
function referenceCurrency(table: Table, extra: string[] = []): ReferenceCurrency | null {
  const texts = [
    ...extra,
    table.title,
    ...table.rows.filter((row) => !row.some(isIsinCode) && nonEmptyCells(row) <= 6).map((row) => row.filter((cell) => cell.trim()).join(" "))
  ];
  for (const text of texts) {
    if (!REFERENCE_CURRENCY_RE.test(normHeader(text))) continue;
    const code = currencyNamedIn(text.replace(/.*?(?:referencia|base|reference|reporting|cartera|portfolio)\b/i, ""));
    if (code) return { code, text: text.replace(/\s+/g, " ").trim() };
  }
  return null;
}

/* ─── Plan de un bloque ─────────────────────────────────────────────────── */

interface CurrencyColumn {
  index: number;
  label: string;
  /** «asset»: la del activo · «neutral»: «Divisa» sin calificar · «account»: la de la cuenta o con un calificativo que no es de activo. */
  role: "asset" | "neutral" | "account";
}

interface AmountColumn extends HeaderColumn, AmountClass {
  /** Columnas de divisa de su mismo rótulo de grupo («Contravalor» sobre «Moneda | Importe»). */
  groupCurrency: CurrencyColumn[];
  /** Un importe de otro momento o de otro concepto («Saldo medio», «Valoración 31/12/2025»): nunca se elige en silencio. */
  qualified: boolean;
  /** EUR por la divisa de referencia del extracto, no por su propio rótulo. */
  viaReference: boolean;
}

interface SegmentPlan {
  /** Clave del bloque para la elección de columna: la tabla y su cabecera (un salto de página es el mismo bloque). */
  key: string;
  idCol: number;
  idFromHeader: boolean;
  header: HeaderColumn[];
  headerWidth: number;
  /** Columnas candidatas a importe, por prioridad. */
  candidates: AmountColumn[];
  primary: AmountColumn | null;
  fallback: AmountColumn | null;
  /** Las candidatas no se pueden conciliar y el asesor no ha elegido: el bloque espera la elección (B1). */
  conflict: boolean;
  /** Por qué no se concilian (también cuando el asesor ya ha elegido), para el texto de la elección. */
  conflictKind: ConflictKind | null;
  /** El asesor ha elegido no importar el bloque. */
  skipped?: boolean;
  /** Otras columnas de valor (no en EUR) del bloque: para ver si una columna en EUR repite su cifra. */
  otherValueCols: AmountColumn[];
  /** Columnas de importe en una divisa concreta distinta del euro («Contravalor USD»). */
  foreignCols: Array<{ index: number; label: string; currency: string }>;
  /** Columnas de divisa del activo (o neutras): las que dicen la divisa de cada fila. */
  rowCurrencyCols: CurrencyColumn[];
  /** Todas las columnas de divisa del bloque: ninguna es el nombre de la posición. */
  allCurrencyCols: CurrencyColumn[];
  /** Columnas de divisa de la cuenta o con un calificativo que no es de activo: una que no sea EUR es indicio de otra divisa. */
  accountCurrencyCols: CurrencyColumn[];
  /** Columnas de tipo de cambio: una cifra distinta de 1 es indicio de otra divisa. */
  fxCols: number[];
  /** Columnas de unidades: una cifra negativa es una posición corta (I4). */
  unitCols: number[];
  /** Columna «Titular» o «Cliente» con el titular de cada fila (−1 si no la hay). */
  holderCol: number;
  /** Divisa de referencia del extracto, si la dice un título o una nota. */
  reference: ReferenceCurrency | null;
  /** El formato «€» de la plantilla está también en las unidades: las marcas «€» de las celdas no dicen nada. */
  marksUnreliable: boolean;
  /** Por qué no se puede leer el bloque (sin cabecera, sin columna de importe o de identificadores, movimientos):
      `reason` para un bloque entre otros, `single` para el aviso cuando es el único. */
  failure: { reason: string; single: string; hint: string } | null;
  /** Filas de posición (con identificador en su columna). */
  positionRows: number[];
}

function quoted(labels: string[]): string {
  const items = labels.map((label) => `«${label}»`);
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] ?? "";
}

/** Todos los identificadores, sin repetir: el juez estricto exige que cada fila que queda fuera se nombre. */
function all(labels: string[]): string {
  return [...new Set(labels)].join(", ");
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("{n}", String(count));
}

function verb(count: number): string {
  return count === 1 ? "importa" : "importan";
}

function columnCells(table: Table, rows: number[], col: number): string[] {
  return rows.map((index) => (table.rows[index][col] ?? "").trim()).filter(Boolean);
}

function currencyRole(norm: string): CurrencyColumn["role"] {
  if (ACCOUNT_CURRENCY.test(norm)) return "account";
  if (ASSET_CURRENCY.test(norm)) return "asset";
  // Una columna de divisa por su contenido cuya cabecera no habla de divisa («Mercado»): neutra.
  if (!CURRENCY_HEADER.test(norm)) return "neutral";
  // «Divisa», «Código divisa», «Currency», «Divisa ISO»: sin calificar. Cualquier
  // otro calificativo («Div. op.», «Moneda pago») no dice la divisa del activo.
  return norm.replace(CURRENCY_FILLER, " ").trim() === "" ? "neutral" : "account";
}

/** Columnas de divisa del bloque: por contenido (códigos o símbolos) o por cabecera (R4-07, B7). */
function findCurrencyColumns(table: Table, header: HeaderColumn[], idCol: number, positionRows: number[]): CurrencyColumn[] {
  const width = Math.max(header.length, ...positionRows.map((index) => table.rows[index].length));
  const found: CurrencyColumn[] = [];
  for (let col = 0; col < width; col += 1) {
    if (col === idCol) continue;
    const column = header[col];
    const cells = columnCells(table, positionRows, col);
    const currencies = cells.filter((cell) => currencyOf(cell) !== null).length;
    const byContent = currencies > 0 && currencies >= cells.length * 0.8;
    // Por la cabecera, siempre: aunque sus celdas sean códigos numéricos (978,
    // 840) o no se entiendan. Una columna de divisa ilegible no es «sin
    // columna de divisa»: sus filas se quedan fuera (B7).
    const byHeader = column !== undefined && isCurrencyHeader(column.label);
    if (!byContent && !byHeader) continue;
    const norm = column?.norm ?? "";
    // El rótulo propio decide el papel; el de grupo («Contravalor» sobre «Moneda») no.
    const ownNorm = column?.parts[column.parts.length - 1] ?? norm;
    found.push({ index: col, label: column?.label || `columna ${col + 1}`, role: currencyRole(ownNorm) });
  }
  return found;
}

/** ¿Las columnas dicen lo mismo en todas las filas donde más de una tiene dato? */
function columnsAgree(table: Table, rows: number[], cols: number[]): boolean {
  return rows.every((index) => {
    const values = cols
      .map((col) => {
        const amount = eurAmountOf(readAmountCell(table.rows[index][col]), { style: null, language: null });
        return amount.ok ? amount.value : Number.NaN;
      })
      .filter((value) => Number.isFinite(value));
    return values.every((value) => Math.abs(value - values[0]) <= Math.max(0.01, Math.abs(values[0]) * 1e-6));
  });
}

function sameAmount(a: string | undefined, b: string | undefined): boolean {
  const x = eurAmountOf(readAmountCell(a), { style: null, language: "es" });
  const y = eurAmountOf(readAmountCell(b), { style: null, language: "es" });
  return x.ok && y.ok && Math.abs(x.value - y.value) <= Math.max(0.01, Math.abs(y.value) * 1e-6);
}

/** Cifra limpia de una celda (sin otra divisa ni porcentaje), para comparar columnas; `null` si no la hay. */
function plainValue(cell: string | undefined): number | null {
  const parsed = readAmountCell(cell);
  if (parsed.kind !== "number") return null;
  const amount = eurAmountOf(parsed, { style: null, language: "es" });
  return amount.ok ? amount.value : null;
}

/**
 * ¿Tiene la celda forma de tipo de cambio? Una cifra positiva; con `strict`
 * (la cabecera es «Cambio» a secas, que suele ser el precio), además 1 o con
 * cuatro decimales o más («1,0850»; «32,42» es un precio).
 */
function isRateValue(cell: string, strict: boolean): boolean {
  const value = parseEuropeanNumber(cell);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (!strict) return true;
  const decimals = /[.,](\d+)\s*$/.exec(cell.trim())?.[1].length ?? 0;
  return Math.abs(value - 1) < 1e-9 || decimals >= 4;
}

/** Rango para elegir el importe: EUR en su propio rótulo con un término fuerte, luego un valor que no dice su divisa, luego «Valor €» a secas y al final el de la divisa de la posición. */
function rankOf(column: AmountColumn): number {
  if (column.kind === "eur") return column.term === "bare" ? 2 : 0;
  return column.kind === "unknown" ? 1 : 3;
}

/** La divisa de la fila según unas columnas de divisa: EUR, otra, o no consta. */
function rowStatus(row: string[], cols: CurrencyColumn[]): "eur" | "other" | "unknown" {
  const codes = cols.map((column) => currencyOfColumnValue(row[column.index])).filter(Boolean);
  if (codes.length === 0) return "unknown";
  return codes.every((code) => code === "EUR") ? "eur" : "other";
}

/** Por qué el lector no elige la columna: no coinciden, una es de otro momento o concepto, o no se pueden comparar. */
type ConflictKind = "differ" | "qualified" | "unverifiable";

/**
 * B1 (revisión 7): ¿se pueden conciliar las candidatas? La primera por
 * prioridad se compara con cada una de las demás en las filas comparables:
 * las dos cifras limpias y la fila en EUR (o sin divisa, si ninguna de las dos
 * es una columna en la divisa de la posición). Si alguna no coincide, no se
 * elige en silencio: el asesor elige.
 * Tampoco se elige en silencio una columna de otro momento o concepto
 * («Saldo medio EUR», «Valoración 31/12/2025») cuando hay otra candidata.
 * Una fila que puede estar en otra divisa (`maybeForeign`: hay una mención que
 * le alcanza) no compara una columna en EUR con otra sin divisa SOLO si la de
 * EUR es un contravalor o un valor de mercado convertido («Contravalor EUR»,
 * «Valor de mercado EUR»): ese es el contravalor de la fila. Un «Importe (€)»,
 * un «Saldo €» o un «Valor €» sí se comparan, y si no hay ninguna fila
 * comparable, eso no es un acuerdo: el asesor elige (B1 de la revisión 8).
 */
function candidatesConflict(
  table: Table,
  positionRows: number[],
  candidates: AmountColumn[],
  rowCurrencyCols: CurrencyColumn[],
  maybeForeign: (rowIndex: number) => boolean
): ConflictKind | null {
  if (candidates.length < 2) return null;
  if (candidates[0].qualified) return "qualified";
  const a = candidates[0];
  const hasValues = (column: AmountColumn) => positionRows.some((index) => plainValue(table.rows[index][column.index]) !== null);
  for (const b of candidates.slice(1)) {
    const cols = [...new Set([...rowCurrencyCols, ...a.groupCurrency, ...b.groupCurrency])];
    const eurSide = a.kind === "eur" && b.kind !== "eur" ? a : b.kind === "eur" && a.kind !== "eur" ? b : null;
    const converted = eurSide !== null && (eurSide.term === "contravalor" || eurSide.term === "market");
    let compared = 0;
    for (const index of positionRows) {
      const row = table.rows[index];
      const x = plainValue(row[a.index]);
      const y = plainValue(row[b.index]);
      if (x === null || y === null) continue;
      const status = rowStatus(row, cols);
      if (status === "other") continue;
      if (status === "unknown" && (a.kind === "position" || b.kind === "position")) continue;
      if (status === "unknown" && converted && maybeForeign(index)) continue;
      compared += 1;
      if (Math.abs(x - y) > Math.max(0.01, Math.abs(x) * 1e-6)) return "differ";
    }
    if (compared === 0 && eurSide !== null && !converted && hasValues(a) && hasValues(b)) return "unverifiable";
  }
  return null;
}

/** El motivo de una elección de columna, en una frase (M5 de la revisión 8: «no coinciden» solo si es verdad). */
function conflictReason(kind: ConflictKind | null, candidates: AmountColumn[]): string {
  const labels = quoted(candidates.map((column) => column.label));
  if (kind === "qualified") {
    return `Las columnas ${labels} podrían ser el importe y «${candidates[0].label}» es de otro momento o de otro concepto.`;
  }
  if (kind === "unverifiable") {
    return `Las columnas ${labels} podrían ser el importe y no se pueden comparar en ninguna fila.`;
  }
  return candidates.length > 2
    ? `Las columnas ${labels} podrían ser el importe y no todas coinciden.`
    : `Las columnas ${labels} podrían ser el importe y no coinciden.`;
}

/**
 * Un precio por título no es un importe aunque su cabecera lo parezca («Valor €»
 * junto a «Títulos» e «Importe», V18): si en todas las filas comparables una
 * candidata por las unidades da otra candidata, la primera es un precio.
 */
function withoutUnitPrices(table: Table, positionRows: number[], candidates: AmountColumn[], unitCols: number[]): AmountColumn[] {
  if (candidates.length < 2 || unitCols.length === 0) return candidates;
  const prices = new Set<number>();
  for (const price of candidates) {
    for (const amount of candidates) {
      if (price === amount || prices.has(amount.index)) continue;
      for (const unitCol of unitCols) {
        let checked = 0;
        const matches = positionRows.every((index) => {
          const row = table.rows[index];
          const p = plainValue(row[price.index]);
          const a = plainValue(row[amount.index]);
          const u = plainValue(row[unitCol]);
          if (p === null || a === null || u === null) return true;
          checked += 1;
          return Math.abs(a - u * p) <= Math.max(0.02, Math.abs(a) * 1e-3);
        });
        if (checked > 0 && matches) prices.add(price.index);
      }
    }
  }
  return candidates.filter((column) => !prices.has(column.index));
}

/** Columna de identificadores: la de cabecera ISIN con algún ISIN debajo; si no, la de más ISIN; si no, la de «Ticker». */
function findIdColumn(table: Table, segment: Segment, header: HeaderColumn[]): { idCol: number; idFromHeader: boolean } {
  const { rows } = table;
  const isinCount = (col: number) => segment.dataRows.filter((index) => isIsinCode(rows[index][col])).length;
  const headerIsin = header.find((column) => column.parts.some((part) => ISIN_HEADER_RE.test(part)));
  if (headerIsin && isinCount(headerIsin.index) > 0) return { idCol: headerIsin.index, idFromHeader: true };
  let idCol = -1;
  const width = Math.max(0, ...segment.dataRows.map((index) => rows[index].length));
  for (let col = 0; col < width; col += 1) {
    const count = isinCount(col);
    if (count > 0 && (idCol < 0 || count > isinCount(idCol))) idCol = col;
  }
  if (idCol >= 0) return { idCol, idFromHeader: false };
  if (headerIsin) return { idCol: headerIsin.index, idFromHeader: true };
  // B6: un bloque de acciones con «Ticker» se lee (los códigos entran siempre con aviso).
  const ticker = header.find((column) => TICKER_HEADER_RE.test(column.parts[column.parts.length - 1] ?? ""));
  return ticker ? { idCol: ticker.index, idFromHeader: true } : { idCol: -1, idFromHeader: false };
}

/**
 * Plan de un bloque (B1, B2): su columna de identificadores, sus columnas de
 * divisa y las candidatas a importe. Nunca la de los identificadores, ni una de
 * divisa, ni una que no se reconozca, ni una cuyas celdas no sean cifras, ni un
 * precio, valor unitario, de garantía, nominal, pignorado o suscrito aunque
 * lleve «€». Con varias candidatas que no se concilian, el bloque espera la
 * elección del asesor (`chosen`: el índice de la columna elegida). Un extracto
 * de movimientos no se lee. Un bloque sin identificadores no se lee, y se
 * avisa con sus filas (B6).
 */
function planSegment(
  table: Table,
  segment: Segment,
  key: string,
  chosen: string | undefined,
  extraTitles: string[],
  maybeForeign: (rowIndex: number) => boolean,
  options: BrokerReadOptions = {}
): SegmentPlan {
  const header = mergeHeader(table, segment.headerRows);
  const { rows } = table;
  const { idCol, idFromHeader } = findIdColumn(table, segment, header);
  const headerWidth = Math.max(0, ...segment.headerRows.map((index) => rows[index].length));
  const reference = referenceCurrency(table, [segment.title, ...extraTitles]);
  const positionRows = idCol < 0 ? [] : segment.dataRows.filter((index) => {
    const kind = classifyPositionId(rows[index][idCol]);
    return kind === "isin" || kind === "code";
  });
  const base: SegmentPlan = {
    key,
    idCol,
    idFromHeader,
    header,
    headerWidth,
    candidates: [],
    primary: null,
    fallback: null,
    conflict: false,
    conflictKind: null,
    otherValueCols: [],
    foreignCols: [],
    rowCurrencyCols: [],
    allCurrencyCols: [],
    accountCurrencyCols: [],
    fxCols: [],
    unitCols: [],
    holderCol: -1,
    reference,
    marksUnreliable: false,
    failure: null,
    positionRows
  };
  if (idCol < 0) {
    return {
      ...base,
      failure: {
        reason: "no tiene columna de ISIN",
        single: "El extracto no tiene ninguna columna de ISIN: no se importa ninguna posición",
        hint: "Añade la columna «ISIN» y vuelve a importar."
      }
    };
  }
  if (header.length === 0) {
    return {
      ...base,
      failure: {
        reason: "no tiene cabecera: no se sabe qué columna es el importe",
        single: "El extracto no tiene cabecera: no se sabe qué columna es el importe y no se importa ninguno",
        hint: "Añade una cabecera («ISIN;Importe») o usa el formato «ISIN o id; nombre opcional; importe €»."
      }
    };
  }

  // I4: un extracto de movimientos (compras, ventas, suscripciones) no es una foto de posiciones.
  const operationCol = header.find(
    (column) =>
      column.index !== idCol &&
      OPERATION_HEADER.test(column.norm) &&
      columnCells(table, positionRows, column.index).some((cell) => OPERATION_VALUE.test(cell.trim()))
  );
  if (operationCol) {
    return {
      ...base,
      failure: {
        reason: `es un extracto de movimientos (columna «${operationCol.label}» con compras y ventas), no de posiciones`,
        single: `El fichero es un extracto de movimientos (columna «${operationCol.label}» con compras y ventas), no de posiciones: no se importa ningún importe`,
        hint: "Importa el extracto de posiciones o de cartera."
      }
    };
  }

  const currencyCols = findCurrencyColumns(table, header, idCol, positionRows);
  const currencyIdx = new Set(currencyCols.map((column) => column.index));
  const fxCols = header
    .filter((column) => column.index !== idCol && !currencyIdx.has(column.index))
    .filter((column) => {
      const cells = columnCells(table, positionRows, column.index);
      if (FX_HEADER.test(column.norm)) return cells.every((cell) => isRateValue(cell, false));
      return BARE_FX_HEADER.test(column.norm) && cells.length > 0 && cells.every((cell) => isRateValue(cell, true));
    })
    .map((column) => column.index);
  const unitCols = header
    .filter((column) => column.index !== idCol && UNITS_HEADER.test(column.norm) && !classifyHeaderParts(column.parts))
    .map((column) => column.index);
  const foreignCols: SegmentPlan["foreignCols"] = [];
  const holderCol =
    header.find((column) => {
      if (column.index === idCol || currencyIdx.has(column.index)) return false;
      const cells = columnCells(table, positionRows, column.index);
      if (!cells.every((cell) => !isNumberLike(cell))) return false;
      if (HOLDER_COLUMN_RE.test(column.norm)) return true;
      // I6 (revisión 9): en el Constructor, una columna «Cliente» con dos personas también es un titular.
      return Boolean(options.oneClient) && CLIENT_COLUMN_RE.test(column.norm) && new Set(cells.filter(looksLikePersonName).map(nameKey)).size >= 2;
    })?.index ?? -1;

  // Columnas de divisa que pertenecen a un grupo de importe («Contravalor» sobre «Moneda | Importe»).
  const groupOf = (column: HeaderColumn) => (column.parts.length >= 2 ? column.parts[0] : null);
  const groupedCurrency = new Map<string, CurrencyColumn[]>();
  for (const currency of currencyCols) {
    const group = groupOf(header[currency.index] ?? { index: -1, parts: [], norm: "", label: "" });
    if (group) groupedCurrency.set(group, [...(groupedCurrency.get(group) ?? []), currency]);
  }

  const found: AmountColumn[] = [];
  for (const column of header) {
    if (column.index === idCol || currencyIdx.has(column.index) || fxCols.includes(column.index)) continue;
    const foreign = foreignCurrencyOfHeader(column.parts);
    if (foreign) {
      foreignCols.push({ index: column.index, label: column.label, currency: foreign });
      continue;
    }
    let cls = classifyHeaderParts(column.parts);
    if (!cls) continue;
    let viaReference = false;
    // B1: un «Contravalor» a secas está en la divisa de referencia del extracto.
    if (cls.term === "contravalor" && cls.kind === "unknown" && reference) {
      if (reference.code === "EUR") {
        cls = { ...cls, tier: 0, kind: "eur" };
        viaReference = true;
      } else {
        foreignCols.push({ index: column.index, label: column.label, currency: reference.code });
        continue;
      }
    }
    const cells = columnCells(table, positionRows, column.index);
    if (cells.length > 0 && cells.filter(isNumberLike).length < cells.length / 2) continue; // no son cifras
    const group = groupOf(column);
    const groupCurrency = group ? groupedCurrency.get(group) ?? [] : [];
    // Una columna cuya divisa de grupo es siempre otra que el euro está en esa divisa (V10).
    if (groupCurrency.length > 0) {
      const codes = positionRows.map((index) => groupCurrency.map((c) => currencyOfColumnValue(rows[index][c.index])).find(Boolean) ?? null);
      const known = codes.filter((code): code is string => Boolean(code));
      if (known.length > 0 && known.every((code) => code !== "EUR")) {
        foreignCols.push({ index: column.index, label: column.label, currency: known[0] });
        continue;
      }
    }
    found.push({ ...column, ...cls, groupCurrency, qualified: QUALIFIED_VALUE_RE.test(column.norm), viaReference });
  }
  // B1: con un «Contravalor EUR», el «Contravalor» a secas no es el importe.
  const hasEurContravalor = found.some((column) => column.term === "contravalor" && column.kind === "eur");
  let candidates = found.filter((column) => !(hasEurContravalor && column.term === "contravalor" && column.kind !== "eur"));
  candidates = withoutUnitPrices(table, positionRows, candidates, unitCols);
  // Por prioridad; a igual rango, la que no es de otro momento o concepto.
  candidates.sort((a, b) => rankOf(a) - rankOf(b) || a.tier - b.tier || Number(a.qualified) - Number(b.qualified) || a.index - b.index);

  const groupedIdx = new Set([...groupedCurrency.values()].flat().map((column) => column.index));
  const ungrouped = currencyCols.filter((column) => !groupedIdx.has(column.index));
  const assetCols = ungrouped.filter((column) => column.role === "asset");
  const rowCurrencyCols = assetCols.length > 0 ? assetCols : ungrouped.filter((column) => column.role === "neutral");
  const accountCurrencyCols = currencyCols.filter((column) => column.role === "account" || (assetCols.length > 0 && column.role === "neutral"));
  // Una plantilla que pone «€» también en las unidades: sus marcas no dicen la divisa.
  const marksUnreliable = unitCols.some((col) => positionRows.some((index) => {
    const cell = readAmountCell(rows[index][col]);
    return cell.kind === "number" && cell.currency === "EUR";
  }));
  const planned: SegmentPlan = {
    ...base,
    candidates,
    foreignCols,
    rowCurrencyCols,
    allCurrencyCols: currencyCols,
    accountCurrencyCols,
    fxCols,
    unitCols,
    holderCol,
    marksUnreliable
  };

  if (candidates.length === 0) {
    const excluded = header.filter((column) => column.index !== idCol && isNonAmountHeader(column.label));
    return {
      ...planned,
      failure: {
        reason: "no se reconoce su columna de importe",
        single: "No se reconoce la columna de importe del extracto: no se importa ningún importe",
        hint:
          "Se esperaba «Contravalor EUR», «Valor de mercado» o «Importe»" +
          (excluded.length ? `; ${quoted(excluded.map((column) => column.label))} ${excluded.length === 1 ? "no es un importe" : "no son importes"}.` : ".")
      }
    };
  }

  if (chosen === NONE_CHOICE && candidates.length > 1) {
    // El asesor ha elegido no importar el bloque.
    return {
      ...planned,
      skipped: true,
      failure: {
        reason: "se ha elegido no importarlo",
        single: "Se ha elegido no importar ninguna columna del extracto: no se importa ningún importe",
        hint: "Elige una columna en el resumen si debe entrar."
      }
    };
  }
  const picked = chosen !== undefined ? candidates.find((column) => String(column.index) === chosen) : undefined;
  const conflictKind = candidatesConflict(table, positionRows, candidates, rowCurrencyCols, (rowIndex) => maybeForeign(rowIndex));
  if (!picked && conflictKind !== null) {
    return { ...planned, conflict: true, conflictKind };
  }
  return { ...withPrimary(planned, picked ?? candidates[0], table), conflictKind };
}

/** El plan con su columna de importe decidida, su respaldo y las demás columnas de valor. */
function withPrimary(plan: SegmentPlan, primary: AmountColumn, table: Table): SegmentPlan {
  const otherValueCols = plan.candidates.filter((column) => column !== primary && column.kind !== "eur");
  // Respaldo por fila para un contravalor en blanco: el valor de la posición,
  // solo si es inequívoco y solo en filas que constan en EUR.
  let fallback: AmountColumn | null = null;
  if (primary.kind === "eur") {
    const others = otherValueCols;
    const next = others.filter((column) => column.kind === others[0]?.kind && column.tier === others[0]?.tier);
    if (next.length === 1 || (next.length > 1 && columnsAgree(table, plan.positionRows, next.map((column) => column.index)))) {
      fallback = next[0];
    }
  }
  return { ...plan, primary, fallback, otherValueCols, conflict: false };
}

/* ─── Lector ────────────────────────────────────────────────────────────── */

export interface BrokerPositionAmount {
  id: string;
  amount: number;
}

/** Lectura completa de un extracto: posiciones, filas descartadas, avisos y resumen. */
export interface BrokerExportRead {
  /** Es una tabla HTML (`.xls` HTML). */
  html: boolean;
  /** Se localizó la columna de identificadores (por cabecera o por contenido). */
  recognized: boolean;
  /** La columna de identificadores se reconoció por su cabecera («ISIN», «Código ISIN», «ISIN/ID», «Ticker»). */
  idFromHeader: boolean;
  /** Alguna columna de importe sale de una cabecera reconocida. */
  amountFromHeader: boolean;
  /** Hay en el texto alguna fila de cabecera reconocible (R4-06). */
  headerFound: boolean;
  /** Columna de identificadores de la primera tabla (−1 si no se localizó). */
  idColumn: number;
  /** Número máximo de columnas de las tablas. */
  maxColumns: number;
  /** Hojas del libro (0 si el texto no viene de un libro). */
  sheets: number;
  /** Quedó una comilla sin cerrar en el CSV: no se lee nada. */
  unclosedQuote: boolean;
  positions: BrokerPositionAmount[];
  /** Filas con identificador cuyo importe no se pudo leer (o no era positivo). */
  unreadableRows: number;
  /** Avisos de todo lo que no se ha importado o se ha importado con reservas. */
  warnings: string[];
  /** Lo que el asesor tiene que confirmar antes de usar nada (siempre que haya posiciones). */
  euroConfirmation: EuroConfirmation | null;
  /** Elecciones del asesor (columna de importe, titular): pendientes o hechas. Sin todas hechas, no se confirma. */
  choices: ImportChoice[];
  /** Menciones de otra divisa en el fichero (regla global de divisa). */
  mentions: CurrencyMention[];
  /** Resumen de lo leído, para enseñarlo siempre tras importar. */
  summary: ImportSummary;
}

export interface RowIssues {
  codesImported: string[];
  notPositions: string[];
  otherCurrency: string[];
  unknownCurrency: string[];
  conflicting: string[];
  noCurrency: Map<string, string[]>;
  /** Regla de divisa: el fichero, su bloque o su nombre mencionan otra divisa y la fila no dice EUR. */
  foreignInFile: string[];
  /** ISIN de fuera del euro (también XS) sin ninguna divisa (I8 de la revisión 8). */
  unprovenIsin: string[];
  /** Filas sin prueba de EUR que el asesor ha incluido a mano (segunda casilla). */
  includedUnproven: string[];
  percent: string[];
  ambiguous: string[];
  negative: string[];
  short: string[];
  blank: string[];
  hiddenText: string[];
  sharedAmount: string[];
  misaligned: string[];
  unreadable: string[];
  subtotals: string[];
  unlabelled: string[];
  noId: string[];
  totals: string[];
  /** IMP-2: filas de total cuyo importe no coincide con lo que suman las filas con importe, ya redactadas. */
  totalMismatch: string[];
}

export function newIssues(): RowIssues {
  return {
    codesImported: [],
    notPositions: [],
    otherCurrency: [],
    unknownCurrency: [],
    conflicting: [],
    noCurrency: new Map(),
    foreignInFile: [],
    unprovenIsin: [],
    includedUnproven: [],
    percent: [],
    ambiguous: [],
    negative: [],
    short: [],
    blank: [],
    hiddenText: [],
    sharedAmount: [],
    misaligned: [],
    unreadable: [],
    subtotals: [],
    unlabelled: [],
    noId: [],
    totals: [],
    totalMismatch: []
  };
}

function mergeIssues(into: RowIssues, from: RowIssues): void {
  for (const key of Object.keys(into) as Array<keyof RowIssues>) {
    if (key === "noCurrency") {
      for (const [label, ids] of from.noCurrency) for (const id of ids) pushMap(into.noCurrency, label, id);
    } else {
      (into[key] as string[]).push(...(from[key] as string[]));
    }
  }
}

interface CurrencyOfRow {
  /** Divisa del activo en la fila (columnas del activo o neutras); `null` si no consta. */
  code: string | null;
  /** Las columnas del activo se contradicen. */
  conflict: boolean;
  /** Valor de la columna de divisa que no se entiende. */
  unknown: string | null;
  /** Divisa de la cuenta, si no es EUR: indicio de otra divisa. */
  accountForeign: string | null;
}

function rowCurrency(row: string[], cols: CurrencyColumn[], accountCols: CurrencyColumn[]): CurrencyOfRow {
  const codes = new Set<string>();
  let unknown: string | null = null;
  for (const column of cols) {
    const raw = (row[column.index] ?? "").trim();
    if (!raw) continue;
    const code = currencyOfColumnValue(raw);
    if (code) codes.add(code);
    else unknown = raw;
  }
  let accountForeign: string | null = null;
  for (const column of accountCols) {
    const raw = (row[column.index] ?? "").trim();
    if (!raw) continue;
    const code = currencyOfColumnValue(raw) ?? currencySignalIn(raw);
    if (code && code !== "EUR") accountForeign = code;
  }
  if (codes.size > 1) return { code: null, conflict: true, unknown, accountForeign };
  return { code: codes.values().next().value ?? null, conflict: false, unknown, accountForeign };
}

/** Una fila aceptada, antes de mirar los identificadores repetidos (B5). */
interface AcceptedRow {
  id: string;
  idKind: PositionIdKind;
  name?: string;
  amount: number;
  table: Table;
  /** Bloque de la fila (clave de la tabla y su cabecera) y su cabecera, para los resúmenes repetidos (I2). */
  blockKey: string;
  headerKey: string;
  /** La fila lleva un rótulo de total («Total Fondo A», «Subtotal»). */
  totalLabel: boolean;
  /** La fila está en una tabla, hoja o bloque de totales («Resumen», «Consolidado»). */
  summaryTable: boolean;
  columnLabel: string;
  criterion: string;
  eurStated: boolean;
  /** Notas para la lista de confirmación («el nombre dice USD»). */
  notes: string[];
  /** Entró con la segunda casilla: por qué no habría entrado sola. */
  unproven?: string;
}

/** Una fila que la regla de divisa deja fuera sin prueba de EUR, con su importe (I5 de la revisión 8). */
interface UnprovenRow {
  id: string;
  name?: string;
  amount: number;
  reason: string;
  /** Bloque de la fila, para las opciones de su elección de columna (I2 de la revisión 9). */
  blockKey: string;
}

/** I2 (revisión 9): lo que una opción deja fuera por no decir EUR, para que no parezca vacía. */
function outsideOf(rows: UnprovenRow[]): ImportChoiceOption["outside"] {
  if (rows.length === 0) return undefined;
  return { positions: rows.length, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}

export interface RepeatedId {
  id: string;
  amounts: number[];
}

/**
 * Identificadores repetidos (B5). Si alguna fila de un identificador repetido
 * puede ser un total o un subtotal —un rótulo «Total…», una tabla u hoja de
 * totales, o un importe que es la suma de las demás filas del mismo
 * identificador (en cualquier orden, con tres filas o más)—, ese identificador
 * NO entra: no se sabe qué filas sumar. Repetido sin indicio de total, se suma.
 */
export function resolveRepeatedIds<T extends { id: string; amount: number; totalLabel: boolean; summaryTable: boolean }>(
  rows: T[]
): { kept: T[]; refused: RepeatedId[]; summed: RepeatedId[] } {
  const byId = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.id.toUpperCase();
    byId.set(key, [...(byId.get(key) ?? []), row]);
  }
  const refused: RepeatedId[] = [];
  const summed: RepeatedId[] = [];
  const refusedKeys = new Set<string>();
  for (const [key, group] of byId) {
    if (group.length < 2) continue;
    const total = group.reduce((sum, row) => sum + row.amount, 0);
    const sumOfOthers = group.length >= 3 && group.some((row) => Math.abs(row.amount - (total - row.amount)) <= Math.max(0.01, row.amount * 1e-9));
    const amounts = group.map((row) => row.amount);
    if (sumOfOthers || group.some((row) => row.totalLabel || row.summaryTable)) {
      refused.push({ id: group[0].id, amounts });
      refusedKeys.add(key);
    } else {
      summed.push({ id: group[0].id, amounts });
    }
  }
  return { kept: rows.filter((row) => !refusedKeys.has(row.id.toUpperCase())), refused, summed };
}

/**
 * I2 (revisión 7): el mismo identificador con el MISMO importe en dos bloques de
 * cabeceras distintas («Posiciones» y «Distribución por gestora») es un
 * resumen que repite la posición, no dos cuentas: se marca como tal y no se
 * suma (resolveRepeatedIds lo deja fuera, con aviso).
 */
function markRepeatedSummaries(rows: AcceptedRow[]): void {
  const byId = new Map<string, AcceptedRow[]>();
  for (const row of rows) byId.set(row.id.toUpperCase(), [...(byId.get(row.id.toUpperCase()) ?? []), row]);
  for (const group of byId.values()) {
    if (new Set(group.map((row) => row.headerKey)).size < 2) continue;
    const repeated = group.some((a) =>
      group.some((b) => a !== b && a.headerKey !== b.headerKey && Math.abs(a.amount - b.amount) <= Math.max(0.01, Math.abs(a.amount) * 1e-9))
    );
    if (repeated) for (const row of group) row.summaryTable = true;
  }
}

function amountList(amounts: number[]): string {
  return amounts.map((amount) => oFalta(importe(amount))).join(" + ");
}

/** Avisos y resumen de los identificadores repetidos (lector y lista). */
export function pushRepeatedWarnings(warnings: string[], summary: ImportSummary, refused: RepeatedId[], summed: RepeatedId[]): void {
  for (const item of refused) {
    warnings.push(
      `${item.id} aparece en ${item.amounts.length} filas (${amountList(item.amounts)}) y alguna puede ser un total, un subtotal o un resumen que repite la posición: ` +
        "no se importa, porque no se sabe qué filas sumar. Comprueba el extracto e impórtalo sin las filas de total."
    );
  }
  addDiscarded(summary, "identificador repetido con un posible total", refused.map((item) => item.id));
  for (const item of summed) {
    warnings.push(`${item.id} aparece en ${item.amounts.length} filas (${amountList(item.amounts)}), sin ningún indicio de total: se suman en una posición.`);
  }
}

/** Agrupa por identificador con TODOS sus nombres (W38); «dice EUR» solo si lo dicen todas sus filas. */
export function groupWithNames(
  rows: Array<{ id: string; amount: number; name?: string; eurStated?: boolean; notes?: string[] }>
): ImportedPosition[] {
  const byId = new Map<string, { id: string; amount: number; names: string[]; eurStated: boolean; notes: string[] }>();
  for (const row of rows) {
    const key = row.id.trim().toUpperCase();
    const current = byId.get(key) ?? { id: key, amount: 0, names: [], eurStated: true, notes: [] };
    current.amount += row.amount;
    if (row.name && !current.names.includes(row.name)) current.names.push(row.name);
    current.eurStated = current.eurStated && row.eurStated === true;
    for (const note of row.notes ?? []) if (!current.notes.includes(note)) current.notes.push(note);
    byId.set(key, current);
  }
  return [...byId.values()].map((group) => ({
    id: group.id,
    amount: group.amount,
    ...(group.names.length > 0 ? { name: group.names.join(" + ") } : {}),
    eurStated: group.eurStated,
    ...(group.notes.length > 0 ? { notes: group.notes } : {})
  }));
}

/** I5: lo que la regla de divisa deja fuera (con su importe y su motivo) o, con la segunda casilla, lo incluido. */
function unprovenSummary(left: UnprovenRow[], kept: AcceptedRow[]): UnprovenPositions | null {
  const included = kept.filter((row) => row.unproven !== undefined);
  if (included.length > 0) return { positions: groupWithNames(included.map((row) => ({ ...row, eurStated: false, notes: [row.unproven!] }))), included: true };
  if (left.length === 0) return null;
  return { positions: groupWithNames(left.map((row) => ({ ...row, eurStated: false, notes: [row.reason] }))), included: false };
}

interface Planned {
  table: Table;
  tableIndex: number;
  segment: Segment;
  plan: SegmentPlan;
  /** Titular del bloque («Cliente: …», «Cartera de …», la hoja «Ana Ruiz»), si lo dice (B5, B3 de la revisión 8). */
  holder: GroupTag | null;
  /** Fecha de la foto del bloque («30-09-2026»), si su título o su hoja la dicen (I3 de la revisión 8). */
  date: GroupTag | null;
  /** Filas que no se leen: las de otro titular de su columna «Titular». */
  skipRows?: Set<number>;
  /** Clave del bloque para el alcance de las menciones (I5): «tabla:bloque». */
  mentionKey: string;
}

/** Un titular o una fecha: la clave para comparar y el texto para enseñar. */
interface GroupTag {
  key: string;
  label: string;
}

/** Titular, cliente, cartera o contrato que nombra un título (B5 de la revisión 7). */
const HOLDER_RE =
  /^(?:(?:cliente|titular(?:es)?|cotitular(?:es)?|client|holder|account holder|nombre del (?:cliente|titular))\s*[:·-]\s*(.+)|(?:titular|cliente)\s+(\S.*)|(?:cartera|contrato|portfolio|account)\s*(?:[:#]|n[ºo°.]\s*)\s*(.+)|(?:cartera|contrato|portfolio)\s+(\d[\w\-/.]*.*))$/i;
/** «Cartera de Luis Gómez», «Posiciones de Ana Ruiz», «Portfolio of …» (B3 de la revisión 8): solo si sigue un nombre. */
const OWNER_OF_RE = /^(?:cartera|carteras|posiciones|patrimonio|inversiones|portfolio|positions|holdings)\s+(?:de|del|of)\s+(.+)$/i;
/** Un salto de página no es el título de otro bloque. */
const PAGE_TITLE_RE = /^(?:p[aá]g(?:ina)?\.?|page)\s*\d+(?:\s*(?:de|of|\/)\s*\d+)?$/i;
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "i", "da", "do", "dos", "das", "van", "von", "der", "den", "di", "du", "le", "el"]);
/** Palabras de los títulos de hoja y de bloque que no son nombres de persona («Renta Fija», «Fondos Europa»). */
const NOT_A_PERSON =
  /\b(?:hoja|sheet|carteras?|posicion(?:es)?|fondos?|accion(?:es)?|renta|fija|variable|resumen|total(?:es)?|liquidez|efectivo|cuentas?|valores|mercad[oa]s?|monetari[oa]s?|deuda|bonos?|etfs?|planes|plan|pensiones|seguros?|depositos?|inversion(?:es)?|global(?:es)?|europa|europe[oa]s?|internacional(?:es)?|nacional(?:es)?|mixt[oa]s?|garantizad[oa]s?|divisas?|derivados|opciones|futuros|warrants?|estructurad[oa]s?|productos?|activos?|clientes?|datos|detalle|notas?|movimientos|operaciones|rentabilidad|evolucion|distribucion|informe|extracto|consolidad[oa]s?|patrimonio|contratos?|portfolio|positions|holdings|summary|funds?|equit(?:y|ies)|bonds?|cash|accounts?|report|statement|banco|bank|bolsa|tesoreria|alternativ[oa]s?|privad[oa]s?|capital|riesgo|emergentes?|americ[ao]n?s?|asia|japon|espana|tecnologia|salud|sectores?|indices?|gestion|gestoras?|sicav|socimi|otros?|varios)\b/;
const COMPANY_RE = /\b(?:s\.?\s?l\.?(?:\s?u\.?)?|s\.?\s?a\.?(?:\s?u\.?)?|sicav|s\.?c\.?r\.?|ltd|gmbh|inc)\s*$/i;
/** Columna con el titular de cada fila (N38 de la revisión 8). «Cliente» no: en el formato del Legacy de Posiciones
    globales es la cartera de cada cliente del asesor, que se acumulan por fondo, y en los extractos del banco suele
    traer las cuentas de un mismo cliente («Cuenta 1», «Cuenta 2»), que se suman. */
const HOLDER_COLUMN_RE = /^(?:titular(?:es)?|nombre (?:del )?titular|titular de la cuenta|account holder|holder)$/;
/** «Cliente» y «Nombre del cliente»: titular solo en el Constructor y con nombres de persona (I6 de la revisión 9). */
const CLIENT_COLUMN_RE = /^(?:cliente|nombre (?:del )?cliente|client|customer)$/;

/** ¿Es el texto un nombre de persona («Ana Ruiz», «GARCÍA LÓPEZ, JUAN»)? Para una hoja o un `<caption>` a secas. */
function looksLikePersonName(text: string): boolean {
  const clean = text.replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || /\d/.test(clean)) return false;
  const words = clean.split(" ");
  if (words.length < 2 || words.length > 6 || NOT_A_PERSON.test(normHeader(clean))) return false;
  let names = 0;
  for (const word of words) {
    if (NAME_PARTICLES.has(word.toLowerCase())) continue;
    if (!/^\p{Lu}[\p{L}'’-]*$/u.test(word)) return false;
    names += 1;
  }
  return names >= 2;
}

/**
 * M6 (revisión 8): el mismo titular escrito de otra forma es el mismo:
 * mayúsculas, tildes, espacios y el orden «APELLIDOS, NOMBRE» no cuentan.
 */
function nameKey(name: string): string {
  const base = normHeader(name);
  const reordered = /^[^,]+,[^,]+$/.test(base) ? base.split(",").reverse().join(" ") : base;
  return reordered
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function personTag(name: string): GroupTag {
  return { key: `persona:${nameKey(name)}`, label: name.replace(/\s+/g, " ").trim() };
}

/** B2 (revisión 9): «Titular/es:», «1er Titular:», «2º Titular», «Interviniente:» delante del nombre. */
const HOLDER_PREFIX_RE =
  /^(?:(?:1er|1º|1o|primer|2º|2o|segundo|3er|3º|tercer)\.?\s+)?(?:titular(?:es)?|titular\/es|titular\(es\)|cotitular(?:es)?|interviniente(?:s)?|cliente)\s*[:·-]?\s+(\S.*)$/i;
/** «Nº de cliente: 123456», «Núm. cliente 123», «Cód. cliente: …». */
const CLIENT_NUMBER_RE = /^(?:n[ºo°]\.?|num\.?|núm\.?|numero|número|cod\.?|cód\.?|codigo|código)\s*(?:de\s+)?cliente\s*[:·-]?\s*(\S.*)$/i;
/** «D. JUAN GARCIA LOPEZ», «Dña. María Pérez», «Sr. …»: un tratamiento y un nombre de persona. */
const COURTESY_RE = /^(?:d\.ª|dª\.?|d\.|dña\.?|don|doña|sr\.|sra\.|srta\.)\s+(\S.*)$/i;

/** Titular de una parte de un título («Titular: …» en mitad de la línea, tras «·»). */
function holderOfPart(text: string): GroupTag | null {
  const match = HOLDER_RE.exec(text);
  if (match) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!value) return null;
    const kind = match[1] !== undefined || match[2] !== undefined ? "persona" : "cuenta";
    return { key: `${kind}:${nameKey(value)}`, label: text };
  }
  const prefixed = HOLDER_PREFIX_RE.exec(text);
  if (prefixed) return { key: `persona:${nameKey(prefixed[1])}`, label: text };
  const client = CLIENT_NUMBER_RE.exec(text);
  if (client) return { key: `cliente:${nameKey(client[1])}`, label: text };
  const courtesy = COURTESY_RE.exec(text);
  if (courtesy && looksLikePersonName(courtesy[1])) return { key: `persona:${nameKey(courtesy[1])}`, label: text };
  const owner = OWNER_OF_RE.exec(text);
  if (owner && (looksLikePersonName(owner[1]) || COMPANY_RE.test(owner[1].trim()))) return { key: `persona:${nameKey(owner[1])}`, label: text };
  return null;
}

/** Titular que nombra un título: «Cliente: …», «Titular X», «Contrato nº …», «Cartera de Luis Gómez», «D. …»,
    «Nº de cliente: …», y también en una parte de la línea («Cuenta de valores … · Titular: …»). */
function holderOf(title: string): GroupTag | null {
  const text = title.replace(/\s+/g, " ").trim();
  const whole = holderOfPart(text);
  if (whole) return whole;
  for (const part of text.split(/\s+[·|;–—]\s+|\s+-\s+/).slice(1)) {
    const tag = holderOfPart(part.trim());
    if (tag) return { key: tag.key, label: text };
  }
  return null;
}

/** Titular de una tabla: su `<caption>` o su hoja, también si es un nombre a secas («Ana Ruiz»), o las líneas que la preceden. */
function tableHolderOf(table: Table): GroupTag | null {
  const own = holderOf(table.title) ?? (looksLikePersonName(table.title) ? { ...personTag(table.title), label: table.title.trim() } : null);
  if (own) return own;
  for (const line of table.lead) {
    const tag = holderOf(line);
    if (tag) return tag;
  }
  return null;
}

const MONTHS: Readonly<Record<string, number>> = {
  enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3, abril: 4, abr: 4,
  april: 4, apr: 4, mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8,
  aug: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, september: 9, octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11, diciembre: 12, dic: 12, december: 12, dec: 12
};

/** Fechas de un texto, en ISO: «30-09-2026», «30/09/2026», «2026-09-30», «30 de septiembre de 2026». */
function datesIn(text: string): string[] {
  const found = new Set<string>();
  const add = (year: number, month: number, day: number) => {
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) found.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  };
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/g)) add(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  // I7 (revisión 9): también «30-sep-2026», «30.sep.2026» y «30/sept/2026».
  for (const m of normHeader(text).matchAll(/(?<!\d)(\d{1,2})(?: (?:de )?|[-/.])([a-z]{3,10})\.?(?: (?:de )?|[-/.])(\d{4})(?!\d)/g)) {
    const month = MONTHS[m[2]];
    if (month) add(Number(m[3]), month, Number(m[1]));
  }
  // Mes y año, sin día («sep-2026», «septiembre de 2026»): el mes entero, como «2026-09».
  if (found.size === 0) {
    for (const m of normHeader(text).matchAll(/(?<![a-z\d])([a-z]{3,10})\.?(?:[-/.]| de | )(\d{4})(?!\d)/g)) {
      const month = MONTHS[m[1]];
      if (month && (m[1].length >= 4 || /[-/.]/.test(m[0]))) found.add(`${m[2]}-${String(month).padStart(2, "0")}`);
    }
  }
  return [...found].sort();
}

/** Fecha de la foto que dicen unos títulos; `null` si no dicen ninguna. */
function dateTagOf(texts: readonly string[]): GroupTag | null {
  const dates = [...new Set(texts.flatMap(datesIn))].sort();
  if (dates.length === 0) return null;
  const shown = dates.map((iso) => iso.split("-").reverse().join("/"));
  return { key: dates.join(","), label: shown.length > 1 ? `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}` : shown[0] };
}

/** Identificadores (o rótulos) de unas filas: para nombrar en un aviso lo que no se lee. */
function rowIds(rows: string[][]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (isRecognizableHeaderRow(row)) continue;
    const isin = row.find(isIsinCode);
    if (isin) {
      ids.push(isin.trim().toUpperCase());
      continue;
    }
    const code = row.find((cell) => classifyPositionId(cell) === "code");
    if (code) ids.push(code.trim());
  }
  return [...new Set(ids)];
}

/** Rótulos de las filas con alguna cifra de un bloque que no se lee (B6): el identificador o, si no, su primer texto. */
function blockRowLabels(table: Table, segment: Segment): string[] {
  const labels: string[] = [];
  for (const index of segment.dataRows) {
    const row = table.rows[index];
    if (!row.some((cell) => isNumberLike(cell))) continue;
    const id = row.find((cell) => isIsinCode(cell) || classifyPositionId(cell) === "code");
    const label = id ?? row.find((cell) => cell.trim() && !isNumberLike(cell)) ?? "";
    if (TOTAL_LABEL_RE.test(label)) continue;
    labels.push(label.trim() || `fila ${index + 1}`);
  }
  return [...new Set(labels)];
}

interface ReadContext {
  tables: Table[];
  styleOf: (table: Table, plan: SegmentPlan, col: number) => ColumnStyle;
  /** La mención de otra divisa que alcanza a un bloque (del fichero, de su tabla o de su bloque), o `null`. */
  mentionFor: (table: Table, blockKey: string) => ScopedMention | null;
  /** La mención de la agrupación de una fila («Fondos en dólares … 18.040»), o `null` (B1 de la revisión 9). */
  groupMentionFor: (table: Table, row: number) => ScopedMention | null;
  /** El fichero menciona otra divisa en algún sitio, con cualquier alcance: el resumen no puede decir que no. */
  anyMention: boolean;
  /** El asesor ha marcado la segunda casilla: las filas sin prueba de EUR entran, marcadas. */
  includeUnproven: boolean;
  /** Filas de posición con «€» en la celda del importe, en todo el fichero (B3). */
  markedRows: number;
}

/** IMP-2: una fila de total con su importe y lo que suman las filas con importe de su alrededor. */
interface TotalRowRead {
  label: string;
  value: number;
  /** Las filas desde la fila de total anterior (o desde el principio del bloque). */
  sinceLast: number;
  /** Las filas hasta la fila de total siguiente (o hasta el final del bloque): un total escrito arriba. */
  untilNext: number;
  /** Las filas del bloque hasta esta. */
  toHere: number;
}

/**
 * IMP-2: la cuenta de la columna del importe de un bloque. `comparable` es falso cuando la suma no dice nada: una
 * cifra que no se lee, una fila en otra divisa o un importe tomado de otra columna.
 */
export interface SegmentTotals {
  comparable: boolean;
  /** Lo que suman las filas con importe que no son de total, entren o no como posición. */
  sum: number;
  /** Lo que suman las filas que entran como posición: un total que dice justo eso está bien. */
  accepted: number;
  totals: TotalRowRead[];
}

interface SegmentRead {
  accepted: AcceptedRow[];
  issues: RowIssues;
  conflictColumns: Set<string>;
  unproven: UnprovenRow[];
  totals: SegmentTotals;
}

/** IMP-2: margen para dar por iguales un total y una suma: un euro, o el 0,05 % del total si es más. */
const TOTAL_TOLERANCE_EUR = 1;
const TOTAL_TOLERANCE_SHARE = 0.0005;

/**
 * IMP-2: las filas de total que no cuadran con ninguna de las sumas que podrían explicarlas. Solo habla cuando la
 * comparación es limpia en todo el fichero (`complete` y todos los bloques comparables): con un bloque sin leer o una
 * columna en varias divisas, un total que no cuadra puede ser de otra cosa, y un aviso falso enseña a no leerlos.
 */
export function totalMismatches(reads: SegmentTotals[], complete: boolean): string[] {
  if (!complete || reads.some((read) => !read.comparable)) return [];
  const fileSum = reads.reduce((sum, read) => sum + read.sum, 0);
  const fileAccepted = reads.reduce((sum, read) => sum + read.accepted, 0);
  const out: string[] = [];
  let before = 0;
  for (const read of reads) {
    for (const total of read.totals) {
      if (total.value === 0) continue;
      // Lo que un total puede querer decir: las filas de encima, las de debajo, las del bloque, las del fichero, o
      // solo las posiciones (un extracto con filas de grupo que repiten su subtotal, o con la liquidez fuera del total).
      const candidates = [total.sinceLast, total.untilNext, total.toHere, read.sum, before + total.toHere, fileSum, read.accepted, fileAccepted];
      const tolerance = Math.max(TOTAL_TOLERANCE_EUR, Math.abs(total.value) * TOTAL_TOLERANCE_SHARE);
      if (candidates.some((sum) => Math.abs(sum - total.value) <= tolerance)) continue;
      // La suma que se enseña es la más cercana al total: la que el total más probablemente quería decir.
      const nearest = candidates.reduce((best, sum) => (Math.abs(sum - total.value) < Math.abs(best - total.value) ? sum : best));
      const decimals = { decimales: 2 };
      out.push(
        `«${total.label}» dice ${oFalta(numero(total.value, decimals))} y las filas con importe suman ${oFalta(numero(nearest, decimals))} ` +
          `(${oFalta(numero(Math.abs(total.value - nearest), decimals))} de diferencia)`
      );
    }
    before += read.sum;
  }
  return out;
}

/** Lee las filas de un bloque con una columna de importe decidida. */
function readSegmentRows(ctx: ReadContext, entry: Planned, plan: SegmentPlan): SegmentRead {
  const { table, segment } = entry;
  const primary = plan.primary!;
  const issues = newIssues();
  const accepted: AcceptedRow[] = [];
  const conflictColumns = new Set<string>();
  const unproven: UnprovenRow[] = [];
  const blockMention = ctx.mentionFor(table, entry.mentionKey);
  const { idCol } = plan;
  const amountCols = new Set([primary.index, plan.fallback?.index ?? -1].filter((col) => col >= 0));
  const currencyIdx = new Set(
    [...plan.allCurrencyCols, ...primary.groupCurrency, ...(plan.fallback?.groupCurrency ?? [])].map((column) => column.index)
  );
  const twoColumnTable = Math.max(0, ...table.rows.map((row) => row.length)) <= 2;
  const summaryTable = SUMMARY_TITLE_RE.test(normHeader(segment.title)) || SUMMARY_TITLE_RE.test(normHeader(table.title));
  const headerKey = plan.header.map((column) => column.norm).join("|");

  // IMP-2: la cuenta de la columna del importe. Cada fila con importe espera en `pending` hasta saber si es una
  // fila de total (entonces se compara) o una fila más (entonces suma), entre o no como posición.
  const totals: SegmentTotals = { comparable: true, sum: 0, accepted: 0, totals: [] };
  const primaryStyle = ctx.styleOf(table, plan, primary.index);
  const signedValue = (cell: AmountCell): number | null => {
    if (cell.kind !== "number") return null;
    const magnitude = eurAmountOf(
      { ...cell, sign: 1 },
      { style: primaryStyle.style, language: primaryStyle.conflict ? null : headerLanguage(primary.norm), maxDecimals: primaryStyle.maxDecimals }
    );
    if (magnitude.ok) return cell.sign * magnitude.value;
    return magnitude.reason === "negative" ? 0 : null; // «0,00» es una cifra; lo demás no se ha podido leer
  };
  let pending: number | null = null;
  let sinceLast = 0;
  const countPending = () => {
    if (pending === null) return;
    totals.sum += pending;
    sinceLast += pending;
    const last = totals.totals[totals.totals.length - 1];
    if (last) last.untilNext += pending;
    pending = null;
  };
  const pendingIsTotal = (label: string) => {
    if (pending === null) return;
    totals.totals.push({ label, value: pending, sinceLast, untilNext: 0, toHere: totals.sum });
    sinceLast = 0;
    pending = null;
  };

  for (const index of segment.dataRows) {
    if (entry.skipRows?.has(index)) continue;
    countPending();
    const row = table.rows[index];
    const cont = table.continued[index] ?? [];
    const idCell = (row[idCol] ?? "").trim();
    const textCells = row
      .map((cell, col) => ({ cell: cell.trim(), col }))
      .filter(({ cell, col }) => cell && col !== idCol && col !== plan.holderCol && !amountCols.has(col) && !currencyIdx.has(col) && cont[col] !== true);
    const labels = textCells.filter(({ cell }) => !isNumberLike(cell)).map(({ cell }) => cell);
    const primaryCell = readAmountCell(row[primary.index]);
    const hasAmount = primaryCell.kind !== "empty" && primaryCell.kind !== "invalid";
    // IMP-2: un importe repetido por rowspan es la misma celda, y no suma dos veces.
    if (primaryCell.kind !== "empty" && cont[primary.index] !== true) {
      pending = table.hidden[index]?.[primary.index] ? null : signedValue(primaryCell);
      if (pending === null) totals.comparable = false;
    }

    // Identificador.
    const idKind = classifyPositionId(idCell);
    let id: string;
    if (idKind === "isin") {
      id = idCell.toUpperCase();
    } else if (idKind === "code") {
      if (textCells.length > 0 || twoColumnTable) {
        id = idCell;
      } else {
        if (hasAmount) issues.notPositions.push(idCell);
        continue;
      }
    } else if (idKind === "word") {
      if (hasAmount) issues.notPositions.push(idCell);
      continue;
    } else {
      if (!hasAmount) continue;
      // M3: con una divisa en la columna del ISIN («EUR»), la fila se nombra por su rótulo («Liquidez»).
      const label = (idCell && !currencyOf(idCell) ? idCell : labels[0] || idCell) || "";
      if (TOTAL_LABEL_RE.test(label) || (!idCell && labels.length === 0)) {
        issues.totals.push(label || `fila ${index + 1}`);
        pendingIsTotal(label || `fila ${index + 1}`);
      } else if (idCell && !currencyOf(idCell)) {
        issues.unlabelled.push(idCell);
      } else {
        issues.noId.push(label);
      }
      continue;
    }
    const name = labels.find((label) => !currencyOf(label) && !TOTAL_LABEL_RE.test(label));

    // Anchura (N3-04, R4-04): una fila con más campos que la cabecera está mal partida.
    // IMP-6 (auditoría del 16-11-2026): un separador al final de la línea deja una celda vacía de más, que no es un
    // campo. Contada, descartaba la fila, y con todas las filas así, el extracto entero. Solo se sigue contando en un
    // texto separado por comas, que es donde una celda vacía al final puede venir de un importe con miles partido en
    // dos («80,000.00» sin comillas y con la última columna vacía, N46): ahí la fila se sigue descartando, con su aviso.
    if (plan.headerWidth > 0) {
      const width = table.html || !table.commaSeparated ? row.reduce((last, cell, col) => (cell.trim() ? col + 1 : last), 0) : row.length;
      if (width > plan.headerWidth) {
        issues.misaligned.push(id);
        continue;
      }
    }

    // I4: una posición corta o vendida no entra como larga.
    const shortUnits = plan.unitCols.some((col) => {
      const cell = readAmountCell(row[col]);
      return cell.kind === "number" && cell.sign < 0;
    });
    if (shortUnits || labels.some((label) => SHORT_LABEL_RE.test(normHeader(label)) || SHORT_INLINE_RE.test(label))) {
      issues.short.push(id);
      continue;
    }

    const totalLabel = labels.find((label) => TOTAL_LABEL_RE.test(label));
    if (idKind === "isin" && totalLabel && BARE_TOTAL_LABEL_RE.test(totalLabel)) {
      // «Subtotal» o «Total» a secas con el ISIN: no es una posición.
      issues.subtotals.push(`${id} («${totalLabel}»)`);
      pendingIsTotal(`${totalLabel} ${id}`);
      continue;
    }

    // Importe y divisa.
    let column: AmountColumn = primary;
    let cell = primaryCell;
    const columnCurrency = (target: AmountColumn) =>
      rowCurrency(row, target.groupCurrency.length > 0 ? target.groupCurrency : plan.rowCurrencyCols, plan.accountCurrencyCols);
    let currency = columnCurrency(primary);
    if (currency.conflict) {
      issues.conflicting.push(id);
      continue;
    }
    if (cell.kind === "empty" && primary.kind === "eur") {
      // Contravalor en blanco: el valor de la posición solo si la fila consta en EUR.
      const fallbackCell = plan.fallback ? readAmountCell(row[plan.fallback.index]) : null;
      const fallbackEur = fallbackCell?.kind === "number" && fallbackCell.currency === "EUR" && !plan.marksUnreliable;
      if (currency.code && currency.code !== "EUR") {
        issues.otherCurrency.push(`${id} (${currency.code})`);
        continue;
      }
      if (!plan.fallback || !fallbackCell || fallbackCell.kind === "empty" || (currency.code !== "EUR" && !fallbackEur)) {
        // M2: sin importe en EUR, no «en otra divisa».
        issues.blank.push(id);
        continue;
      }
      column = plan.fallback;
      cell = fallbackCell;
      currency = columnCurrency(column);
    }
    if (cell.kind === "empty") {
      issues.blank.push(id);
      continue;
    }
    if (cell.kind === "foreign") {
      issues.otherCurrency.push(`${id} (${cell.raw})`);
      continue;
    }
    if (cell.kind === "percent") {
      issues.percent.push(`${id} («${cell.raw}»)`);
      continue;
    }
    if (table.hidden[index]?.[column.index]) {
      // M1: texto oculto en la celda del importe: no se sabe qué dice.
      issues.hiddenText.push(id);
      continue;
    }
    const explicitEur = cell.kind === "number" && cell.currency === "EUR" && !plan.marksUnreliable;
    // Indicios que valen para cualquier columna: la divisa de la cuenta (B4).
    if (currency.accountForeign) {
      issues.otherCurrency.push(`${id} (${currency.accountForeign}, divisa de la cuenta)`);
      continue;
    }
    // Lo que dice el nombre (y las demás celdas de texto) sobre otra divisa: con la divisa del
    // activo EUR explícita no saca la fila (W48, W53), pero se enseña en la lista. Un texto que
    // dice EUR («Dollar Bond EUR Hedged») no menciona otra divisa (I5 de la revisión 8).
    const nameSignals = [
      ...new Set([idCell, ...labels].filter((text) => !isIsinCode(text) && !saysEuro(text)).flatMap((text) => foreignCurrenciesIn(text, "cell")))
    ];
    const notes = nameSignals.length > 0 ? [`el nombre dice ${nameSignals.join(", ")}`] : [];
    // I5 e I8: sin prueba de EUR, la fila no entra sola; con la segunda casilla, sí, marcada.
    let soft: { kind: "mention" | "isin"; reason: string; own: boolean } | null = null;
    if (column.kind === "eur") {
      // Una columna en EUR en una fila en otra divisa: vale si es un contravalor o un valor de
      // mercado convertido; no si repite la cifra en la divisa de la fila (V14) ni si es un
      // «Importe €» genérico, que el banco puede poner en la divisa local (V13, V15).
      if (currency.code && currency.code !== "EUR") {
        // «Value in EUR» o «Valor en EUR» dicen que está convertido; un «Importe €» a secas, no
        // (V13, V15), salvo que la fila traiga otra cifra en su divisa, distinta (Degiro).
        const converted =
          CONVERTED_PHRASE.test(column.norm) ||
          plan.otherValueCols.some((other) => {
            const value = eurAmountOf(readAmountCell(row[other.index]), { style: null, language: "es" });
            return value.ok && !sameAmount(row[column.index], row[other.index]);
          });
        if ((column.term === "generic" || column.term === "bare") && !converted) {
          issues.otherCurrency.push(`${id} (${currency.code}; «${column.label}» no es un contravalor)`);
          continue;
        }
        const repeated = plan.otherValueCols.find((other) => sameAmount(row[column.index], row[other.index]));
        if (repeated) {
          issues.otherCurrency.push(`${id} (${currency.code}; «${column.label}» repite «${repeated.label}», sin convertir)`);
          continue;
        }
      }
    } else {
      // Un importe que no dice ser EUR solo vale con prueba de EUR en la fila, o sin
      // ningún indicio de otra divisa en el fichero (regla global) ni en la fila.
      if (explicitEur && currency.code && currency.code !== "EUR") {
        issues.conflicting.push(id); // «80.000 €» en un valor de mercado de una fila en USD
        continue;
      }
      if (currency.unknown && !currency.code) {
        issues.unknownCurrency.push(`${id} («${currency.unknown}»)`);
        continue;
      }
      if (currency.code && currency.code !== "EUR") {
        issues.otherCurrency.push(`${id} (${currency.code})`);
        continue;
      }
      const foreignCell = textCells.map(({ cell: text }) => readAmountCell(text)).find((other) => other.kind === "foreign");
      if (foreignCell && foreignCell.kind === "foreign") {
        issues.otherCurrency.push(`${id} (${foreignCell.raw} en otra columna)`);
        continue;
      }
      const rate = plan.fxCols.map((col) => parseEuropeanNumber(row[col] ?? "")).find((value) => Number.isFinite(value) && Math.abs(value - 1) > 1e-9);
      if (rate !== undefined) {
        issues.otherCurrency.push(`${id} (tipo de cambio ${String(rate).replace(".", ",")})`);
        continue;
      }
      const sameForeign = plan.foreignCols.find((foreign) => sameAmount(row[column.index], row[foreign.index]));
      if (sameForeign) {
        issues.otherCurrency.push(`${id} (${sameForeign.currency}: la misma cifra que «${sameForeign.label}»)`);
        continue;
      }
      const proof = explicitEur || currency.code === "EUR";
      if (!proof) {
        const currencyColsOfRow = column.groupCurrency.length > 0 ? column.groupCurrency : plan.rowCurrencyCols;
        if (currencyColsOfRow.length > 0) {
          // B4 (W25): con columna de divisa del activo, una celda en blanco no es EUR.
          issues.otherCurrency.push(`${id} (${quoted(currencyColsOfRow.map((c) => c.label))} en blanco)`);
          continue;
        }
        if (plan.accountCurrencyCols.length > 0) {
          // B4: la divisa de la cuenta no es la del activo, y la del activo no consta.
          issues.otherCurrency.push(`${id} (solo consta la divisa de la cuenta, no la del activo)`);
          continue;
        }
        const own = nameSignals[0];
        const reach = blockMention ?? ctx.groupMentionFor(table, index);
        if (own || reach) {
          // Regla de divisa: el nombre de la fila, su agrupación, su bloque o el fichero mencionan otra divisa y la fila no dice EUR.
          const what = reach ? (reach.currency === "otra divisa" ? "otra divisa" : reach.currency) : "";
          soft = {
            kind: "mention",
            own: Boolean(own),
            reason: own
              ? `${own} en la fila`
              : reach!.scope.kind === "file"
                ? `el fichero menciona ${what}`
                : reach!.scope.kind === "rows"
                  ? `su agrupación menciona ${what}`
                  : `su bloque menciona ${what}`
          };
        } else if (ctx.markedRows > 0 && !plan.marksUnreliable) {
          issues.otherCurrency.push(`${id} (las demás filas dicen «€» y esta no)`);
          continue;
        } else if (isNonEuroAreaIsin(id)) {
          soft = { kind: "isin", reason: nonEuroIsinReason(id), own: true };
        } else if (column.kind === "position" || column.balance || column !== primary) {
          pushMap(issues.noCurrency, column.label, id);
          continue;
        }
      } else if (!explicitEur && nameSignals.length > 0) {
        // N47 (revisión 8): la columna de divisa dice EUR y el nombre, otra («A USD Acc»). Se contradicen:
        // la fila no entra sola; con la segunda casilla, sí (un ETF en USD que cotiza en euros).
        const cols = column.groupCurrency.length > 0 ? column.groupCurrency : plan.rowCurrencyCols;
        soft = { kind: "mention", own: true, reason: `${quoted(cols.map((c) => c.label))} dice EUR y el nombre, ${nameSignals.join(", ")}` };
      }
    }
    if (cont[column.index] === true) {
      // N3-01: importe repetido por rowspan. Si el identificador también lo es,
      // es la misma posición; si no, no se sabe de quién es el importe.
      if (cont[idCol] !== true) issues.sharedAmount.push(id);
      continue;
    }
    const columnStyle = ctx.styleOf(table, plan, column.index);
    const amount = eurAmountOf(cell, {
      style: columnStyle.style,
      language: columnStyle.conflict ? null : headerLanguage(column.norm),
      maxDecimals: columnStyle.maxDecimals
    });
    if (!amount.ok) {
      if (amount.reason === "ambiguous" && columnStyle.conflict) conflictColumns.add(column.label);
      if (amount.reason === "ambiguous") issues.ambiguous.push(`${id} («${amount.raw}»)`);
      else if (amount.reason === "negative") issues.negative.push(id);
      else issues.unreadable.push(id);
      continue;
    }

    if (soft) {
      if (!ctx.includeUnproven) {
        // La razón de un aviso del fichero o del bloque ya va en el aviso; la de la propia fila, junto al ISIN.
        (soft.kind === "mention" ? issues.foreignInFile : issues.unprovenIsin).push(soft.own ? `${id} (${soft.reason})` : id);
        unproven.push({ id, ...(name ? { name } : {}), amount: amount.value, reason: soft.reason, blockKey: plan.key });
        continue;
      }
      issues.includedUnproven.push(id);
      notes.push(`incluida a mano: ${soft.reason}`);
    }
    if (idKind === "code") issues.codesImported.push(id);
    const eurStated = column.kind === "eur" || explicitEur || currency.code === "EUR";
    accepted.push({
      id,
      idKind,
      ...(name ? { name } : {}),
      amount: amount.value,
      table,
      blockKey: plan.key,
      headerKey,
      totalLabel: Boolean(totalLabel),
      summaryTable,
      columnLabel: column.label,
      criterion: soft ? "el asesor incluye a mano las que no dicen EUR" : currencyCriterion(plan, column, explicitEur, currency.code, ctx.anyMention),
      eurStated,
      notes,
      ...(soft ? { unproven: soft.reason } : {})
    });
  }
  countPending();
  totals.accepted = accepted.reduce((sum, row) => sum + row.amount, 0);
  // IMP-2: no se compara si alguna posición tomó el importe de otra columna o lleva ella misma un rótulo de total, ni
  // si alguna fila quedó fuera por su divisa: la columna puede mezclar divisas y su suma no dice nada.
  if (
    accepted.some((row) => row.columnLabel !== primary.label || row.totalLabel) ||
    issues.otherCurrency.length + issues.unknownCurrency.length + issues.conflicting.length + issues.foreignInFile.length + issues.unprovenIsin.length > 0 ||
    issues.noCurrency.size > 0
  ) {
    totals.comparable = false;
  }
  return { accepted, issues, conflictColumns, unproven, totals };
}

/** Dónde está un bloque, para los avisos y las elecciones. */
function blockWhere(entry: Planned, planned: Planned[]): string {
  if (planned.length <= 1) return "El extracto";
  const { table, segment, plan } = entry;
  const title = segment.title && segment.title !== table.title ? segment.title : "";
  if (title) return `El bloque «${title}»${table.name ? ` (${table.name})` : ""}`;
  if (table.name && planned.filter((item) => item.table === table).length === 1) return `La ${table.name}`;
  const headerText = plan.header.map((column) => column.label).filter(Boolean).join(";");
  if (!headerText) return `Las filas antes de la primera cabecera${table.name ? ` (${table.name})` : ""}`;
  return `El bloque con la cabecera «${headerText}»${table.name ? ` (${table.name})` : ""}`;
}

/** Alcance de una mención (I5 de la revisión 8): todo el fichero, una tabla (su `<caption>`), un bloque o una fila. */
type MentionScope =
  | { kind: "file" }
  | { kind: "table"; table: Table }
  | { kind: "block"; key: string }
  | { kind: "rows"; table: Table; rows: number[] }
  | { kind: "row"; table: Table; row: number };

/** La llamada de una nota al pie en su celda: «(1)», «1», «1)», «*», «(*)». */
const NOTE_CALL_RE = /^(?:\(\d{1,2}\)|\d{1,2}\)|\(?\*{1,3}\)?)$/;
/** Una fila de suma: «total» o «suma» en cualquier punto del rótulo («Saldo total de la cartera», «Valor efectivo total»). */
const SUM_LABEL_RE = /\b(?:total(?:es)?|suma|sum)\b/;

/** ¿Es la cifra de la fila la suma de las posiciones del bloque (las de antes o todas)? Entonces es una suma. */
function sumsBlockPositions(table: Table, rowIndex: number, dataRows: number[]): boolean {
  const row = table.rows[rowIndex];
  const positions = dataRows.filter((index) => index !== rowIndex && (table.rows[index].some(isIsinCode) || table.rows[index].some((cell) => classifyPositionId(cell) === "code")));
  const before = positions.filter((index) => index < rowIndex);
  for (let col = 0; col < row.length; col += 1) {
    const value = plainValue(row[col]);
    if (value === null) continue;
    for (const set of [before, positions]) {
      const parts = set.map((index) => plainValue(table.rows[index][col])).filter((part): part is number => part !== null);
      if (parts.length < 2) continue;
      const sum = parts.reduce((total, part) => total + part, 0);
      if (Math.abs(sum - value) <= Math.max(0.01, Math.abs(value) * 1e-6)) return true;
    }
  }
  return false;
}

/** Una línea de liquidez («CUENTA CORRIENTE USD», «Saldo efectivo USD»): su divisa es la suya (N16). */
const LIQUIDITY_RE = /\b(?:cuentas? corrientes?|c\/c|cta\.? cte|saldos?|efectivo|liquidez|cash|tesoreria|current account|depositos?)\b/;

/**
 * B1 (revisión 9): una fila sin identificador cuya cifra es la suma de las
 * posiciones que la siguen («Fondos en dólares … 18.040») es una agrupación:
 * devuelve esas filas. Si no suma, `[]`.
 */
function groupedRows(table: Table, rowIndex: number, dataRows: number[]): number[] {
  const row = table.rows[rowIndex];
  const following: number[] = [];
  for (const index of dataRows.filter((r) => r > rowIndex)) {
    const next = table.rows[index];
    const position = next.some(isIsinCode) || next.some((cell) => classifyPositionId(cell) === "code");
    if (!position) {
      if (next.some(isNumberLike)) break; // la agrupación siguiente, o una suma
      continue;
    }
    following.push(index);
  }
  if (following.length === 0) return [];
  for (let col = 0; col < row.length; col += 1) {
    const value = plainValue(row[col]);
    if (value === null) continue;
    const parts = following.map((index) => plainValue(table.rows[index][col])).filter((part): part is number => part !== null);
    if (parts.length === 0) continue;
    const sum = parts.reduce((total, part) => total + part, 0);
    if (Math.abs(sum - value) <= Math.max(0.01, Math.abs(value) * 1e-6)) return following;
  }
  return [];
}

interface ScopedMention extends CurrencyMention {
  scope: MentionScope;
}

/** Una nota, no el título de un bloque: «(1) …», «Nota: …», una frase larga. */
const NOTE_LIKE_RE = /^\s*(?:\(\d+\)|\*|notas?\b|notes?\b|importante\b|aviso\b|fuente\b|source\b)/i;
function isNoteLike(text: string): boolean {
  const words = text.trim().split(/\s+/).length;
  return NOTE_LIKE_RE.test(text) || words > 8 || (words > 4 && /[.;:]$/.test(text.trim()));
}

const FILE_SCOPE: MentionScope = { kind: "file" };

/**
 * Menciones de otra divisa en el TEXTO de todo el fichero, cada una con su
 * alcance (I5 de la revisión 8):
 * - del FICHERO: el texto de un HTML fuera de las tablas, lo que se ve al
 *   pasar el ratón (`title`), el nombre de una hoja, lo oculto, las hojas
 *   vacías y las notas del libro, los títulos de arriba de cada tabla u hoja
 *   (el título del extracto), las notas, las filas de total y las cifras con
 *   otra divisa (un formato «[$$-409]»);
 * - de una TABLA: su `<caption>`;
 * - de un BLOQUE: su cabecera y el título que lo precede, si no es una nota;
 * - de una FILA: el nombre y los demás textos de una fila de datos (un fondo
 *   «… USD Acc», una «CUENTA CORRIENTE USD»), salvo un texto que dice EUR.
 */
function collectScopedMentions(text: string, allTables: Table[], tables: Table[], segmentsByTable: Segment[][]): ScopedMention[] {
  const out: ScopedMention[] = [];
  const add = (list: CurrencyMention[], scope: MentionScope) => {
    for (const mention of list) out.push({ ...mention, scope });
  };
  if (isHtmlTable(text)) {
    for (const line of htmlOutsideText(text).split("\n")) add(mentionsIn(line, "note", "el texto del fichero"), FILE_SCOPE);
    // I1: lo que se ve al pasar el ratón por una celda.
    for (const match of text.matchAll(/\stitle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      add(mentionsIn(decodeEntities(match[1] ?? match[2] ?? ""), "note", "un texto que se ve al pasar el ratón"), FILE_SCOPE);
    }
  }
  const sourceOf = (row: string[]): MentionSource =>
    row.some((cell) => isIsinCode(cell) || isNumberLike(cell)) ? "cell" : isHeaderLikeRow(row) && row.some(isKnownHeaderCell) ? "header" : "note";
  const scanWhole = (row: string[], where: string, scope: MentionScope) => {
    const joined = row.filter((cell) => cell.trim()).join(" · ");
    if (joined) add(mentionsIn(joined, sourceOf(row), where), scope);
  };
  for (const table of allTables) {
    const tableIndex = tables.indexOf(table);
    if (tableIndex < 0) {
      // Una hoja oculta, una hoja vacía o las notas del libro: valen para todo el fichero.
      if (table.title) add(mentionsIn(table.title, "title", `el nombre de la ${table.hiddenSheet ? `hoja oculta «${table.title}»` : table.name}`), FILE_SCOPE);
      const where = table.hiddenSheet ? `la hoja oculta «${table.title}»` : table.name ?? "las notas del libro";
      for (const row of table.rows) scanWhole(row, where, FILE_SCOPE);
      continue;
    }
    if (table.title) {
      if (table.sheet) add(mentionsIn(table.title, "title", `el nombre de la ${table.name ?? "hoja"}`), FILE_SCOPE);
      else add(mentionsIn(table.title, "title", "el título de la tabla"), { kind: "table", table });
    }
    for (const row of table.hiddenRows) scanWhole(row, "una fila oculta", FILE_SCOPE);
    const role = new Map<number, { kind: "header" | "title" | "data"; key: string; first: boolean; segment: Segment }>();
    segmentsByTable[tableIndex].forEach((segment, k) => {
      // El alcance de un bloque es el bloque de verdad, no su clave de columna (dos bloques con la misma cabecera son dos).
      const key = `${tableIndex}:${k}`;
      for (const r of segment.dataRows) role.set(r, { kind: "data", key, first: k === 0, segment });
      for (const r of segment.headerRows) role.set(r, { kind: "header", key, first: k === 0, segment });
      for (const r of segment.titleRows) role.set(r, { kind: "title", key, first: k === 0, segment });
    });
    table.rows.forEach((row, r) => {
      const info = role.get(r);
      const joined = row.filter((cell) => cell.trim()).join(" · ");
      if (!joined) return;
      if (!info) {
        scanWhole(row, sourceOf(row) === "cell" ? "una fila" : "un título o una nota", FILE_SCOPE);
        return;
      }
      if (info.kind === "header") {
        add(mentionsIn(joined, "header", "la cabecera"), { kind: "block", key: info.key });
        return;
      }
      if (info.kind === "title") {
        const note = isNoteLike(joined);
        add(
          mentionsIn(joined, note ? "note" : "title", note ? "una nota" : info.first ? "el título del extracto" : "el título de un bloque"),
          info.first || note ? FILE_SCOPE : { kind: "block", key: info.key }
        );
        return;
      }
      const position = row.some(isIsinCode) || row.some((cell) => classifyPositionId(cell) === "code");
      if (!position && !row.some(isNumberLike)) {
        scanWhole(row, "un título o una nota", FILE_SCOPE);
        return;
      }
      // B1 (revisión 9): solo una fila que ES una posición tiene alcance de fila. Las demás filas con cifra:
      // una agrupación con subtotal vale para lo que agrupa; una línea de liquidez, para su fila; una nota
      // (con su llamada «(1)»), una suma o un total, para todo el fichero.
      const label = row.find((cell) => cell.trim() && !isNumberLike(cell))?.trim() ?? "";
      let scope: MentionScope = { kind: "row", table, row: r };
      let where = "una fila";
      if (!position) {
        // A1 (revisión 10): el orden importa. Una nota («(1)», «*») y una suma («total» o «suma» en cualquier
        // punto, o la cifra de todas las posiciones del bloque) valen para todo el fichero aunque su rótulo diga
        // «saldo» o «efectivo»; después, la agrupación; y solo si nada de eso, la liquidez vale para su fila.
        if (row.some((cell) => NOTE_CALL_RE.test(cell.trim()))) {
          scope = FILE_SCOPE;
          where = "una nota";
        } else if (SUM_LABEL_RE.test(normHeader(label)) || sumsBlockPositions(table, r, info.segment.dataRows)) {
          scope = FILE_SCOPE;
          where = "una suma o una fila de total";
        } else {
          const group = groupedRows(table, r, info.segment.dataRows);
          if (group.length > 0) {
            scope = { kind: "rows", table, rows: group };
            where = "una agrupación";
          } else if (LIQUIDITY_RE.test(normHeader(label))) {
            where = "una línea de liquidez";
          } else {
            scope = FILE_SCOPE;
            where = "una nota o una suma";
          }
        }
      }
      for (const cell of row) {
        const value = cell.trim();
        if (!value || isIsinCode(value)) continue;
        if (isNumberLike(value)) {
          // Una cifra con otra divisa (también la del formato de una celda de un libro): todo el fichero.
          if (readAmountCell(value).kind === "foreign") add(mentionsIn(value, "cell", "una cifra"), FILE_SCOPE);
          continue;
        }
        if (saysEuro(value)) continue;
        add(mentionsIn(value, "cell", where), scope);
      }
    });
  }
  return out;
}

/** Menciones que salen del plan: códigos de divisa (también numéricos) en una columna de divisa y tipos de cambio distintos de 1. */
function collectPlanMentions(planned: Planned[]): ScopedMention[] {
  const mentions: ScopedMention[] = [];
  for (const { table, plan } of planned) {
    for (const column of plan.allCurrencyCols) {
      for (const index of plan.positionRows) {
        const raw = (table.rows[index][column.index] ?? "").trim();
        const code = currencyOfColumnValue(raw);
        if (code && code !== "EUR") mentions.push({ currency: code, text: raw, where: `la columna «${column.label}»`, scope: FILE_SCOPE });
      }
    }
    for (const col of plan.fxCols) {
      for (const index of plan.positionRows) {
        const value = parseEuropeanNumber(table.rows[index][col] ?? "");
        if (Number.isFinite(value) && Math.abs(value - 1) > 1e-9) {
          mentions.push({ currency: "otra divisa", text: table.rows[index][col].trim(), where: `el tipo de cambio «${plan.header[col]?.label ?? ""}»`, scope: FILE_SCOPE });
        }
      }
    }
  }
  return mentions;
}

/**
 * Lector ÚNICO del extracto (ALTA-07): lo usan los pesos
 * (brokerExportToCanonicalImport), los importes (brokerExportToPositionAmounts)
 * y Posiciones globales, para que no puedan divergir.
 *
 * Por fila:
 * - Identificador: un ISIN; o un código (AAPL, PRIVADO-1, SAN.MC) si la fila
 *   trae más datos de posición o la tabla es solo «id;importe», y siempre con
 *   aviso (N3-03). Un rótulo de sección, una palabra suelta o un total nunca.
 * - Importe: la celda de la columna de su bloque (la única candidata, la que
 *   se concilia o la que elige el asesor), leída con el analizador único
 *   (eurAmount.ts) y el formato de su propia columna.
 * - Fuera, con un aviso que la nombra, toda fila con un indicio de otra divisa
 *   y, si el fichero menciona otra divisa en cualquier sitio, toda fila sin
 *   prueba explícita de EUR. Lo que queda se enseña al asesor para que lo
 *   confirme: la confirmación es siempre.
 *
 * `choices`: lo que ya ha elegido el asesor (columna de importe por bloque,
 * titular). Sin todas las elecciones hechas, la importación no se confirma.
 */
/** Para qué se lee: el Constructor hace la cartera de UN cliente (I6 de la revisión 9). */
export interface BrokerReadOptions {
  /** Una columna «Cliente» con dos personas es un titular que se elige (en Posiciones globales se acumulan). */
  oneClient?: boolean;
}

export function readBrokerExport(text: string, choices: ImportChoiceValues = {}, options: BrokerReadOptions = {}): BrokerExportRead {
  return readInternal(text, choices, true, options).read;
}

interface InternalRead {
  read: BrokerExportRead;
  kept: AcceptedRow[];
  /** Lo que la regla de divisa deja fuera (sin la segunda casilla). */
  left?: UnprovenRow[];
}

function readInternal(text: string, choices: ImportChoiceValues, withOptions: boolean, readOptions: BrokerReadOptions = {}): InternalRead {
  const allTables = readTables(text);
  const hiddenSheets = allTables.filter((table) => table.hiddenSheet);
  const tables = allTables.filter((table) => !table.hiddenSheet && !table.meta);
  const html = tables.some((table) => table.html);
  const maxColumns = Math.max(0, ...tables.flatMap((table) => table.rows.map((row) => row.length)));
  const sheetTables = tables.filter((table) => table.sheet);
  const summary = emptyImportSummary("extracto");
  const base: BrokerExportRead = {
    html,
    recognized: false,
    idFromHeader: false,
    amountFromHeader: false,
    headerFound: tables.some((table) => table.rows.some(isRecognizableHeaderRow)),
    idColumn: -1,
    maxColumns,
    sheets: sheetTables.length,
    unclosedQuote: tables.some((table) => table.unclosedQuote),
    positions: [],
    unreadableRows: 0,
    warnings: [],
    euroConfirmation: null,
    choices: [],
    mentions: [],
    summary
  };
  if (base.unclosedQuote) {
    return { read: { ...base, warnings: ["El fichero tiene unas comillas sin cerrar y no se puede leer con seguridad: no se importa nada."] }, kept: [] };
  }

  const warnings: string[] = [];
  const htmlTitles = isHtmlTable(text) ? htmlOutsideText(text).split("\n") : [];
  // Regla de divisa: las menciones del texto, con su alcance, se conocen antes de planificar los bloques (I5).
  const segmentsByTable = tables.map(findSegments);
  const textMentions = collectScopedMentions(text, allTables, tables, segmentsByTable);
  const fileMentioned = textMentions.some((mention) => mention.scope.kind === "file");
  const mentionedBlocks = new Set(textMentions.flatMap((mention) => (mention.scope.kind === "block" ? [mention.scope.key] : [])));
  const mentionedTables = new Set(textMentions.flatMap((mention) => (mention.scope.kind === "table" ? [mention.scope.table] : [])));
  const mentionedRows = new Set(
    textMentions.flatMap((mention) =>
      mention.scope.kind === "row"
        ? [`${tables.indexOf(mention.scope.table)}:${mention.scope.row}`]
        : mention.scope.kind === "rows"
          ? mention.scope.rows.map((row) => `${tables.indexOf((mention.scope as { table: Table }).table)}:${row}`)
          : []
    )
  );
  // B1 (revisión 9): la mención de una agrupación vale para las filas que agrupa.
  const groupMentions = new Map<string, ScopedMention>();
  for (const mention of textMentions) {
    if (mention.scope.kind !== "rows") continue;
    for (const row of mention.scope.rows) {
      const key = `${tables.indexOf(mention.scope.table)}:${row}`;
      if (!groupMentions.has(key)) groupMentions.set(key, mention);
    }
  }
  const includeUnproven = choices[INCLUDE_UNPROVEN_KEY] === INCLUDE_UNPROVEN_YES;
  // Bloques de cada tabla, con su titular (B5): un título de titular vale hasta el siguiente de su tabla.
  const allPlanned: Planned[] = [];
  const tablesWithoutId: Table[] = [];
  tables.forEach((table, tableIndex) => {
    // B3 (revisión 8) e I5 (revisión 9): una sección sin título de titular («Fondos», «Acciones») HEREDA el
    // último titular de su tabla u hoja; «sin titular» queda para lo que va antes del primero. La fecha solo
    // la hereda la continuación de un salto de página (sin título y con la misma cabecera).
    const tableHolder = tableHolderOf(table);
    let lastHolder: GroupTag | null = tableHolder;
    const tableDate = dateTagOf([table.title, ...table.lead]);
    let previous: { headerKey: string; holder: GroupTag | null; date: GroupTag | null; mentionKey: string } | null = null;
    let located = false;
    for (const [segmentIndex, segment] of segmentsByTable[tableIndex].entries()) {
      const headerKey = rowKey(table.rows[segment.headerRows[0]] ?? []);
      const key = `${tableIndex}#${headerKey}`;
      const own = [...segment.titleRun, ...segment.bands].filter((title) => !PAGE_TITLE_RE.test(title.trim()));
      const continuation: boolean = own.length === 0 && previous !== null && previous.headerKey === headerKey;
      const holder: GroupTag | null = own.map(holderOf).find((tag) => tag !== null) ?? lastHolder;
      lastHolder = holder;
      const date: GroupTag | null = dateTagOf(own) ?? (continuation ? previous!.date : tableDate);
      // Las menciones del bloque: las suyas o, en la continuación de un salto de página, las del anterior.
      const mentionKey: string = continuation ? previous!.mentionKey : `${tableIndex}:${segmentIndex}`;
      previous = { headerKey, holder, date, mentionKey };
      const blockMentioned = fileMentioned || mentionedBlocks.has(mentionKey) || mentionedTables.has(table);
      const plan = planSegment(
        table,
        segment,
        key,
        choices[key],
        htmlTitles,
        (rowIndex) => blockMentioned || mentionedRows.has(`${tableIndex}:${rowIndex}`),
        readOptions
      );
      if (plan.idCol >= 0) located = true;
      allPlanned.push({ table, tableIndex, segment, plan, holder, date, mentionKey });
    }
    if (!located) tablesWithoutId.push(table);
  });
  const withId = allPlanned.filter((entry) => entry.plan.idCol >= 0);
  const scopedMentions = [...textMentions, ...collectPlanMentions(allPlanned)];
  // Las de una fila solo valen para su fila: el resumen y los avisos hablan de las demás.
  const mentions = scopedMentions.filter((mention) => mention.scope.kind !== "row");
  base.mentions = mentions.map(({ currency, text: mentionText, where }) => ({ currency, text: mentionText, where }));
  const firstFileMention = mentions.find((mention) => mention.scope.kind === "file") ?? null;
  const mentionFor = (table: Table, blockKey: string): ScopedMention | null =>
    firstFileMention ??
    mentions.find((mention) => (mention.scope.kind === "block" && mention.scope.key === blockKey) || (mention.scope.kind === "table" && mention.scope.table === table)) ??
    null;
  if (withId.length === 0) {
    pushHiddenWarnings(warnings, summary, allTables);
    return { read: { ...base, warnings: dedupe(warnings) }, kept: [] };
  }

  // B5 y B3 (revisión 8): varios titulares no se mezclan; el asesor elige uno. I3: dos fotos fechadas, tampoco.
  const resultChoices: ImportChoice[] = [];
  const grouped = chooseGroups(text, choices, withOptions, withId, warnings, summary, resultChoices, readOptions);
  const planned = grouped.planned;
  const groupPending = grouped.pending;

  // Formato numérico: SOLO por la propia columna (B3). Los bloques de una misma
  // tabla con la misma cabecera (un salto de página) son la misma columna.
  const styleCells = new Map<string, AmountCell[]>();
  const keyOf = (table: Table, plan: SegmentPlan, col: number) => `${plan.key}#${tables.indexOf(table)}#${col}`;
  for (const { table, segment, plan } of planned) {
    for (const column of plan.candidates) {
      const key = keyOf(table, plan, column.index);
      const cells = styleCells.get(key) ?? [];
      for (const index of segment.dataRows) if (!table.continued[index]?.[column.index]) cells.push(readAmountCell(table.rows[index][column.index]));
      styleCells.set(key, cells);
    }
  }
  const styles = new Map<string, ColumnStyle>();
  const styleOf = (table: Table, plan: SegmentPlan, col: number) => {
    const key = keyOf(table, plan, col);
    let style = styles.get(key);
    if (!style) {
      style = decideColumnStyle(styleCells.get(key) ?? []);
      styles.set(key, style);
    }
    return style;
  };
  // B3: «€» en las demás filas, contado en TODO el fichero (W17), no por bloque.
  let markedRows = 0;
  for (const { table, plan } of planned) {
    if (plan.marksUnreliable) continue;
    const cols = plan.primary ? [plan.primary] : plan.candidates;
    for (const index of plan.positionRows) {
      if (cols.some((column) => {
        const cell = readAmountCell(table.rows[index][column.index]);
        return cell.kind === "number" && cell.currency === "EUR";
      })) markedRows += 1;
    }
  }
  const ctx: ReadContext = {
    tables,
    styleOf,
    mentionFor,
    groupMentionFor: (table: Table, row: number) => groupMentions.get(`${tables.indexOf(table)}:${row}`) ?? null,
    anyMention: scopedMentions.length > 0,
    includeUnproven,
    markedRows
  };

  const issues = newIssues();
  const accepted: AcceptedRow[] = [];
  const unprovenRows: UnprovenRow[] = [];
  const conflictColumns = new Set<string>();
  const failedBlocks: Array<{ where: string; reason: string; single: string; hint: string; ids: string[] }> = [];
  const unreliableMarks = new Set<string>();
  // IMP-2: la cuenta de cada bloque leído, y si se han leído todos.
  const totalReads: SegmentTotals[] = [];
  let everyBlockRead = allPlanned.length === planned.length;

  for (const entry of planned) {
    const { table, segment, plan } = entry;
    const where = blockWhere(entry, planned);
    const blockIds = rowIds(plan.positionRows.map((index) => table.rows[index]));
    // B1: elección de columna de importe, pendiente o hecha (también «ninguna»).
    const asked = plan.conflict || (choices[plan.key] !== undefined && plan.candidates.length > 1);
    if (asked && !resultChoices.some((choice) => choice.key === plan.key)) {
      const labels = plan.candidates.map((column) => column.label);
      const options = plan.candidates.map((column) => {
        if (!withOptions) return { value: String(column.index), label: column.label, total: 0, positions: 0 };
        const innerRead = readInternal(text, { ...choices, [plan.key]: String(column.index) }, false, readOptions);
        const inner = innerRead.kept.filter((row) => row.blockKey === plan.key);
        const outside = outsideOf((innerRead.left ?? []).filter((row) => row.blockKey === plan.key));
        return {
          value: String(column.index),
          label: column.label,
          total: inner.reduce((sum, row) => sum + row.amount, 0),
          positions: inner.length,
          ...(outside ? { outside } : {})
        };
      });
      options.push({ value: NONE_CHOICE, label: "Ninguna: no importar este bloque", total: 0, positions: 0 });
      resultChoices.push({
        kind: "amount",
        key: plan.key,
        question: "¿Qué columna es el valor de mercado en euros?",
        where: where === "El extracto" ? "el extracto" : where.charAt(0).toLowerCase() + where.slice(1),
        reason: conflictReason(plan.conflictKind, plan.candidates),
        options,
        chosen: plan.conflict ? null : plan.skipped ? NONE_CHOICE : String(plan.primary?.index ?? "")
      });
      if (plan.conflict) {
        warnings.push(
          `${where} tiene varias columnas que podrían ser el importe (${quoted(labels)}) y ${plan.conflictKind === "differ" ? "no coinciden" : plan.conflictKind === "qualified" ? `«${labels[0]}» es de otro momento o concepto` : "no se pueden comparar"}: ` +
            `no se elige ninguna en silencio. Elige en el resumen cuál es el valor de mercado en euros${blockIds.length ? ` (${all(blockIds)})` : ""}.`
        );
      }
    }
    if (plan.conflict || !plan.primary) everyBlockRead = false;
    if (plan.conflict) continue;
    if (!plan.primary) {
      // El bloque no se puede leer; sus posiciones se nombran y van al resumen (B2, B6).
      const ids = plan.idCol >= 0 ? blockIds : blockRowLabels(table, segment);
      if (plan.failure) failedBlocks.push({ where, ...plan.failure, ids });
      continue;
    }
    if (plan.marksUnreliable) unreliableMarks.add(plan.primary.label);
    const read = readSegmentRows(ctx, entry, plan);
    accepted.push(...read.accepted);
    unprovenRows.push(...read.unproven);
    mergeIssues(issues, read.issues);
    totalReads.push(read.totals);
    for (const label of read.conflictColumns) conflictColumns.add(label);
  }
  issues.totalMismatch.push(...totalMismatches(totalReads, everyBlockRead));

  // Bloques sin identificadores en tablas que sí los tienen (B6): se avisan con sus filas.
  for (const entry of allPlanned.filter((item) => item.plan.idCol < 0 && !tablesWithoutId.includes(item.table))) {
    const ids = blockRowLabels(entry.table, entry.segment);
    if (ids.length > 0) failedBlocks.push({ where: blockWhere(entry, allPlanned), ...entry.plan.failure!, ids });
  }

  // P20 (revisión 9): una fila sin prueba de EUR que repite una posición ya leída con prueba (el mismo
  // identificador y el mismo importe) es esa posición: ni se ofrece ni se incluye, y no la saca de la lista.
  const provenKeys = new Set(accepted.filter((row) => row.unproven === undefined).map((row) => `${row.id.toUpperCase()}|${row.amount.toFixed(2)}`));
  const repeatsProven = (id: string, amount: number) => provenKeys.has(`${id.toUpperCase()}|${amount.toFixed(2)}`);
  const repeatedIds = new Set(
    [...unprovenRows.filter((row) => repeatsProven(row.id, row.amount)), ...accepted.filter((row) => row.unproven !== undefined && repeatsProven(row.id, row.amount))].map(
      (row) => row.id.toUpperCase()
    )
  );
  if (repeatedIds.size > 0) {
    for (let i = unprovenRows.length - 1; i >= 0; i -= 1) if (repeatsProven(unprovenRows[i].id, unprovenRows[i].amount)) unprovenRows.splice(i, 1);
    for (let i = accepted.length - 1; i >= 0; i -= 1) {
      if (accepted[i].unproven !== undefined && repeatsProven(accepted[i].id, accepted[i].amount)) accepted.splice(i, 1);
    }
    const stillOut = (item: string) => !repeatedIds.has(item.split(" ")[0].toUpperCase()) || unprovenRows.some((row) => row.id.toUpperCase() === item.split(" ")[0].toUpperCase());
    issues.foreignInFile = issues.foreignInFile.filter(stillOut);
    issues.unprovenIsin = issues.unprovenIsin.filter(stillOut);
    issues.includedUnproven = issues.includedUnproven.filter((id) => !repeatedIds.has(id.toUpperCase()) || accepted.some((row) => row.unproven !== undefined && row.id.toUpperCase() === id.toUpperCase()));
    warnings.push(
      `${all([...repeatedIds])} ${repeatedIds.size === 1 ? "aparece" : "aparecen"} también en un bloque sin prueba de EUR con el mismo importe: se cuenta una vez, con la prueba.`
    );
  }

  // B5 e I2: identificadores repetidos, en la misma tabla o entre tablas y hojas.
  markRepeatedSummaries(accepted);
  const { kept, refused, summed } = resolveRepeatedIds(accepted);
  const positions: BrokerPositionAmount[] = kept.map((row) => ({ id: row.id, amount: row.amount }));
  const sourcesWithPositions = new Set<Table>();
  for (const row of kept) {
    sourcesWithPositions.add(row.table);
    if (row.idKind === "isin" && !isinCheckDigitOk(row.id)) summary.checkDigit.push(row.id);
    summary.positions += 1;
    summary.totalEur += row.amount;
    addAmountColumn(summary, row.columnLabel);
    addCurrencyCriterion(summary, row.criterion);
  }
  summary.checkDigit = [...new Set(summary.checkDigit)];
  // La confirmación es SIEMPRE; con elecciones pendientes no se puede dar (la pantalla lo impide).
  const euroConfirmation: EuroConfirmation | null =
    kept.length > 0 ? { positions: groupWithNames(kept), reason: summary.currency.join("; ") } : null;
  summary.euroConfirmation = euroConfirmation;
  summary.choices = resultChoices;
  summary.mentions = mentions.length > 0 ? describeMentions(mentions) : null;
  const rowMentions = scopedMentions.filter((mention) => mention.scope.kind === "row");
  if (mentions.length === 0 && rowMentions.length > 0) summary.mentions = describeMentions(rowMentions);
  summary.mentionScope = mentions.length === 0 ? (rowMentions.length > 0 ? "row" : null) : firstFileMention ? "file" : "block";
  summary.unproven = unprovenSummary(unprovenRows, kept);

  // Avisos globales, primero.
  for (const label of unreliableMarks) {
    warnings.push(
      `El formato «€» de las celdas de «${label}» está también en las unidades: es una plantilla y no dice la divisa. Comprueba que los importes están en euros.`
    );
  }
  for (const label of conflictColumns) {
    warnings.push(`La columna «${label}» mezcla cifras con formato español e inglés: las cifras que no se pueden leer con seguridad no se importan.`);
  }
  const anyImported = kept.length > 0;
  for (const block of failedBlocks) {
    const ids = block.ids.length > 0 ? ` (${all(block.ids)})` : "";
    warnings.push(
      block.where === "El extracto"
        ? `${block.single}${ids}. ${block.hint}`
        : `${block.where} no se ha importado: ${block.reason}${anyImported ? "" : "; no se importa ningún importe"}${ids}. ${block.hint}`
    );
    addDiscarded(summary, `bloque no leído: ${block.reason}`, block.ids);
  }
  for (const table of tables) {
    if (sourcesWithPositions.has(table) && table.name && (tables.length > 1 || table.sheet)) {
      summary.sources.push(table.title && !table.sheet ? `${table.name} («${table.title}»)` : table.name);
    }
  }
  if (!groupPending) pushTablesWithoutId(warnings, summary, tablesWithoutId, sheetTables.length);
  pushHiddenWarnings(warnings, summary, [...hiddenSheets, ...tables]);

  pushRowWarnings(warnings, issues, summary, firstFileMention ?? mentions[0] ?? null, firstFileMention ? "file" : "part");
  pushRepeatedWarnings(warnings, summary, refused, summed);
  summary.distinct = new Set(positions.map((position) => position.id.toUpperCase())).size;

  const first = withId[0].plan;
  return {
    read: {
      ...base,
      recognized: true,
      idFromHeader: withId.some(({ plan }) => plan.idFromHeader),
      amountFromHeader: withId.some(({ plan }) => plan.candidates.length > 0),
      idColumn: first.idCol,
      positions,
      unreadableRows: issues.unreadable.length + issues.negative.length + issues.ambiguous.length + issues.percent.length + issues.blank.length,
      warnings: dedupe(warnings),
      euroConfirmation,
      choices: resultChoices,
      summary
    },
    kept,
    left: unprovenRows
  };
}

/** Una fila de posición de un bloque. */
interface RowRef {
  entry: Planned;
  index: number;
}

interface Group {
  tag: GroupTag | null;
  rows: RowRef[];
}

/** Agrupa filas por una etiqueta (la clave; `null` aparte), en el orden en que aparecen. */
function groupRows(rows: RowRef[], tagOf: (row: RowRef) => GroupTag | null): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const tag = tagOf(row);
    const key = tag?.key ?? "";
    const group = groups.get(key) ?? { tag, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function idsOf(rows: RowRef[]): string[] {
  return rowIds(rows.map(({ entry, index }) => entry.table.rows[index]));
}

/** Solo las filas de unos grupos: los bloques sin ninguna fuera, y los demás con las suyas marcadas para no leerse. */
function keepRows(entries: Planned[], kept: RowRef[]): Planned[] {
  const keep = new Map<Planned, Set<number>>();
  for (const { entry, index } of kept) keep.set(entry, (keep.get(entry) ?? new Set()).add(index));
  return entries
    .filter((entry) => keep.has(entry))
    .map((entry) => {
      const rows = keep.get(entry)!;
      const skip = entry.plan.positionRows.filter((index) => !rows.has(index));
      return skip.length > 0 || entry.skipRows ? { ...entry, skipRows: new Set([...(entry.skipRows ?? []), ...skip]) } : entry;
    });
}

/** Donde está un grupo de filas: sus hojas o tablas, o los títulos de sus bloques. */
function groupWhere(rows: RowRef[]): string {
  const places = [...new Set(rows.map(({ entry }) => (entry.table.sheet ? entry.table.name : entry.segment.title && entry.segment.title !== entry.table.title ? `«${entry.segment.title}»` : entry.table.name ?? "")))].filter(Boolean);
  return places.join(", ");
}

/**
 * B5 (revisión 7), B3 e I3 (revisión 8): lo que no se mezcla en una cartera.
 * - TITULARES: el de la columna «Titular» de cada fila o el del bloque (su
 *   título, su `<caption>`, su hoja). Si hay dos o más, o uno y bloques sin
 *   titular que no van detrás de él desde el principio del fichero, el asesor
 *   elige; «sin titular» es una opción más. Un único titular al principio vale
 *   para todo el fichero.
 * - FECHAS: dos o más fotos con fechas distintas que repiten posiciones (la
 *   misma cartera a dos fechas) no se suman: el asesor elige la fecha. Un
 *   bloque sin fecha que repite posiciones de las fotos es otra opción; uno que
 *   no las repite entra con cualquiera.
 * Devuelve los bloques que se leen (vacío si falta una elección).
 */
function chooseGroups(
  text: string,
  choices: ImportChoiceValues,
  withOptions: boolean,
  withId: Planned[],
  warnings: string[],
  summary: ImportSummary,
  resultChoices: ImportChoice[],
  readOptions: BrokerReadOptions
): { planned: Planned[]; pending: boolean } {
  const optionOf = (key: string, value: string, label: string, rows: RowRef[]): ImportChoiceOption => {
    if (!withOptions) return { value, label, total: 0, positions: idsOf(rows).length };
    const inner = readInternal(text, { ...choices, [key]: value }, false, readOptions);
    const pendingInside = pendingChoices(inner.read.choices).length > 0;
    if (pendingInside) return { value, label, total: 0, positions: idsOf(rows).length, pendingInside: true };
    const outside = outsideOf(inner.left ?? []);
    return { value, label, total: inner.kept.reduce((sum, row) => sum + row.amount, 0), positions: inner.kept.length, ...(outside ? { outside } : {}) };
  };

  // Titulares.
  const allRows: RowRef[] = withId.flatMap((entry) => entry.plan.positionRows.map((index) => ({ entry, index })));
  const holderOfRow = ({ entry, index }: RowRef): GroupTag | null => {
    const cell = entry.plan.holderCol >= 0 ? (entry.table.rows[index][entry.plan.holderCol] ?? "").trim() : "";
    return cell ? personTag(cell) : entry.holder;
  };
  let holderGroups = groupRows(allRows, holderOfRow);
  const tagged = holderGroups.filter((group) => group.tag !== null);
  if (tagged.length === 1 && allRows.length > 0 && holderOfRow(allRows[0]) !== null) {
    // Un único titular, al principio del fichero: es el de todo el fichero.
    holderGroups = [{ tag: tagged[0].tag, rows: allRows }];
  }
  let planned = withId;
  if (holderGroups.length >= 2 && tagged.length >= 1) {
    const options = holderGroups.map((group) =>
      group.tag
        ? optionOf(HOLDER_CHOICE_KEY, group.tag.label, group.tag.label, group.rows)
        : optionOf(HOLDER_CHOICE_KEY, NO_HOLDER_CHOICE, `Sin titular en el fichero${groupWhere(group.rows) ? ` (${groupWhere(group.rows)})` : ""}`, group.rows)
    );
    options.push({ value: NONE_CHOICE, label: "Ninguno: no importar nada", total: 0, positions: 0 });
    const names = tagged.map((group) => group.tag!.label);
    const untitled = holderGroups.some((group) => group.tag === null);
    const reason = untitled
      ? `El fichero trae posiciones de ${quoted(names)} y otras sin titular: no se mezclan.`
      : `El fichero trae posiciones de ${tagged.length} titulares (${quoted(names)}): no se mezclan.`;
    const requested = choices[HOLDER_CHOICE_KEY];
    const chosen = options.find((option) => option.value === requested)?.value ?? null;
    resultChoices.push({ kind: "holder", key: HOLDER_CHOICE_KEY, question: "¿De qué titular es esta cartera?", where: "el fichero", reason, options, chosen });
    if (chosen === null) {
      warnings.push(`${reason.replace(/: no se mezclan\.$/, "")}: no se mezclan en una cartera. Elige en el resumen cuál importar.`);
      return { planned: [], pending: true };
    }
    const keptGroup = holderGroups.find((group) => (group.tag ? group.tag.label : NO_HOLDER_CHOICE) === chosen);
    const kept = chosen === NONE_CHOICE ? [] : keptGroup?.rows ?? [];
    const otherIds = idsOf(allRows.filter((row) => !kept.includes(row)));
    if (otherIds.length > 0) {
      warnings.push(
        chosen === NONE_CHOICE
          ? `Se ha elegido no importar ningún titular: no se importa nada (${all(otherIds)}).`
          : chosen === NO_HOLDER_CHOICE
            ? `No se leen las posiciones de los titulares del fichero (${all(otherIds)}): solo las que no tienen titular.`
            : `No se leen las posiciones de los demás titulares (${all(otherIds)}): solo las de «${chosen}».`
      );
      addDiscarded(summary, chosen === NONE_CHOICE ? "ningún titular elegido" : "de otro titular", otherIds);
    }
    planned = keepRows(withId, kept);
  }

  // Fechas: dos fotos de la misma cartera no se suman.
  const plannedRows: RowRef[] = planned.flatMap((entry) =>
    entry.plan.positionRows.filter((index) => !entry.skipRows?.has(index)).map((index) => ({ entry, index }))
  );
  const dated = groupRows(plannedRows.filter(({ entry }) => entry.date !== null), ({ entry }) => entry.date);
  if (dated.length < 2) return { planned, pending: false };
  const datedIds = dated.map((group) => new Set(idsOf(group.rows)));
  const repeated = datedIds.some((ids, i) => datedIds.some((other, j) => i !== j && [...ids].some((id) => other.has(id))));
  if (!repeated) return { planned, pending: false };
  const allDatedIds = new Set(datedIds.flatMap((ids) => [...ids]));
  const undated = plannedRows.filter(({ entry }) => entry.date === null);
  const undatedRepeating = undated.filter((row) => idsOf([row]).some((id) => allDatedIds.has(id)));
  const always = undated.filter((row) => !undatedRepeating.includes(row));
  const dateGroups: Group[] = [...dated, ...(undatedRepeating.length > 0 ? [{ tag: null, rows: undatedRepeating }] : [])];
  const options = dateGroups.map((group) =>
    group.tag
      ? optionOf(DATE_CHOICE_KEY, group.tag.key, `${group.tag.label}${groupWhere(group.rows) ? ` (${groupWhere(group.rows)})` : ""}`, [...group.rows, ...always])
      : optionOf(DATE_CHOICE_KEY, NO_DATE_CHOICE, `Sin fecha${groupWhere(group.rows) ? ` (${groupWhere(group.rows)})` : ""}`, [...group.rows, ...always])
  );
  options.push({ value: NONE_CHOICE, label: "Ninguna: no importar nada", total: 0, positions: 0 });
  const labels = dated.map((group) => group.tag!.label);
  const reason = `El fichero trae ${dated.length} fotos de la cartera con fechas distintas (${quoted(labels)}) que repiten posiciones: no se suman.`;
  const requested = choices[DATE_CHOICE_KEY];
  const chosen = options.find((option) => option.value === requested)?.value ?? null;
  resultChoices.push({ kind: "date", key: DATE_CHOICE_KEY, question: "¿De qué fecha es la cartera?", where: "el fichero", reason, options, chosen });
  if (chosen === null) {
    warnings.push(`${reason.replace(/: no se suman\.$/, "")}: no se suman. Elige en el resumen qué fecha importar.`);
    return { planned: [], pending: true };
  }
  const keptGroup = dateGroups.find((group) => (group.tag ? group.tag.key : NO_DATE_CHOICE) === chosen);
  const kept = chosen === NONE_CHOICE ? [] : [...(keptGroup?.rows ?? []), ...always];
  const otherIds = idsOf(plannedRows.filter((row) => !kept.includes(row)));
  if (otherIds.length > 0) {
    warnings.push(
      chosen === NONE_CHOICE
        ? `Se ha elegido no importar ninguna fecha: no se importa nada (${all(otherIds)}).`
        : `No se leen las posiciones de las otras fechas (${all(otherIds)}): solo las de ${keptGroup?.tag ? `«${keptGroup.tag.label}»` : "los bloques sin fecha"}.`
    );
    addDiscarded(summary, chosen === NONE_CHOICE ? "ninguna fecha elegida" : "de otra fecha", otherIds);
  }
  return { planned: keepRows(planned, kept), pending: false };
}

/** Tablas u hojas sin ninguna columna de identificadores: se avisan con sus filas (B6). */
function pushTablesWithoutId(warnings: string[], summary: ImportSummary, tables: Table[], sheetCount: number): void {
  for (const table of tables) {
    const withAmounts = tableAmountRows(table);
    if (table.sheet) {
      if (sheetCount <= 1 && withAmounts.length === 0) continue;
      const rows = withAmounts.length > 0 ? ` (${quoted(withAmounts)})` : "";
      warnings.push(`La ${table.name} no tiene una tabla de posiciones con ISIN: no se lee${rows}.`);
      summary.sources.push(`${table.name} (sin tabla de posiciones, no leída)`);
      addDiscarded(summary, "en una hoja sin ISIN", withAmounts);
      continue;
    }
    if (withAmounts.length > 0) {
      warnings.push(
        `${table.name ? `La ${table.name}` : "La tabla"} no tiene ninguna columna de ISIN: ` +
          `${plural(withAmounts.length, "no se importa su fila con importe", "no se importan sus {n} filas con importe")} ` +
          `(${quoted(withAmounts)}).`
      );
      addDiscarded(summary, "en una tabla sin ISIN", withAmounts);
    }
  }
}

/** I1 (revisión 7): lo oculto (hojas, filas) no se lee; se nombra. */
function pushHiddenWarnings(warnings: string[], summary: ImportSummary, tables: Table[]): void {
  for (const table of tables) {
    if (table.hiddenSheet) {
      const ids = rowIds(table.rows);
      warnings.push(`La hoja oculta «${table.title}» no se lee${ids.length ? ` (${all(ids)})` : ""}: si debe entrar, muéstrala en el libro y vuelve a importarlo.`);
      addDiscarded(summary, "hoja oculta", ids.length ? ids : [table.title]);
      continue;
    }
    if (table.hiddenRows.length > 0) {
      const ids = rowIds(table.hiddenRows);
      const where = table.sheet ? `de la ${table.name}` : table.name ? `de la ${table.name}` : "de la tabla";
      warnings.push(
        `${plural(table.hiddenRows.length, "1 fila oculta", "{n} filas ocultas")} ${where} no se ${table.hiddenRows.length === 1 ? "lee" : "leen"}` +
          `${ids.length ? ` (${all(ids)})` : ""}: si debe entrar, muéstrala y vuelve a importar.`
      );
      if (ids.length) addDiscarded(summary, "fila oculta", ids);
    }
  }
}

function pushMap(map: Map<string, string[]>, key: string, value: string): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Lo que dice el fichero sobre la divisa de una posición, para el resumen (M4: con la columna real). */
function currencyCriterion(plan: SegmentPlan, column: AmountColumn, explicitEur: boolean, rowCode: string | null, foreignMentioned: boolean): string {
  if (column.kind === "eur") {
    // M1 (W10): con «Divisa de referencia: EUR», es la nota la que lo dice, no la cabecera.
    if (column.viaReference && plan.reference) return `la nota «${plan.reference.text}» dice que «${column.label}» está en EUR`;
    return `la cabecera «${column.label}» dice EUR`;
  }
  if (explicitEur) return "«€» o «EUR» en la propia celda";
  if (rowCode === "EUR") {
    const cols = column.groupCurrency.length > 0 ? column.groupCurrency : plan.rowCurrencyCols;
    return `${plural(cols.length, "la columna", "las columnas")} ${quoted(cols.map((c) => c.label))} dice EUR en la fila`;
  }
  return foreignMentioned
    ? `«${column.label}» no dice su divisa`
    : `«${column.label}» no dice su divisa y el fichero no menciona ninguna otra divisa`;
}

/** Rótulos de las filas con alguna cifra positiva de una tabla sin ISIN que tiene cabecera de importe. */
function tableAmountRows(table: Table): string[] {
  const headerIndex = table.rows.findIndex(isSegmentHeaderRow);
  if (headerIndex < 0) return [];
  const header = table.rows[headerIndex];
  const amountCols = header
    .map((cell, col) => (classifyHeader(normHeader(cell)) ? col : -1))
    .filter((col) => col >= 0);
  const labels: string[] = [];
  for (const row of table.rows.slice(headerIndex + 1)) {
    const hasAmount = amountCols.some((col) => {
      const amount = eurAmountOf(readAmountCell(row[col]), { style: null, language: null });
      return amount.ok || amount.reason === "ambiguous";
    });
    if (!hasAmount) continue;
    const label = row.find((cell, col) => cell.trim() && !amountCols.includes(col) && !isNumberLike(cell)) ?? "";
    if (TOTAL_LABEL_RE.test(label)) continue;
    labels.push(label.trim() || "sin rótulo");
  }
  return labels;
}

export function pushRowWarnings(
  warnings: string[],
  issues: RowIssues,
  summary: ImportSummary,
  mention: CurrencyMention | null = null,
  reach: "file" | "part" = "file"
): void {
  const list = (items: string[]) => quoted([...new Set(items)]);
  if (issues.foreignInFile.length > 0) {
    const n = issues.foreignInFile.length;
    const where = mention ? ` (${describeMentions([mention], 1)})` : "";
    warnings.push(
      `${mention ? `Hay otra divisa que el euro en ${reach === "file" ? "el fichero" : "una parte del fichero"}${where}` : "Hay otra divisa que el euro en el nombre de alguna posición"}: ` +
        "solo entran solas las filas que dicen EUR (la divisa de la fila, la cabecera del importe o «€» en la celda). " +
        `${plural(n, "1 posición no lo dice", "{n} posiciones no lo dicen")} (${all(issues.foreignInFile)}): no se ${verb(n)}. ` +
        "Exporta con contravalor en EUR o con columna de divisa, o compruébalas y márcalas en el resumen."
    );
    addDiscarded(summary, "sin prueba de EUR y con otra divisa en el fichero, su bloque o su nombre", issues.foreignInFile);
  }
  if (issues.unprovenIsin.length > 0) {
    const n = issues.unprovenIsin.length;
    warnings.push(
      `${plural(n, "1 posición con un ISIN de fuera del euro y sin divisa", "{n} posiciones con un ISIN de fuera del euro y sin divisa")} ` +
        `(${all(issues.unprovenIsin)}): no se ${verb(n)} solas. Exporta con contravalor en EUR o con columna de divisa, o compruébalas y márcalas en el resumen.`
    );
    addDiscarded(summary, "ISIN de fuera del euro sin divisa", issues.unprovenIsin);
  }
  if (issues.includedUnproven.length > 0) {
    warnings.push(
      `${plural(new Set(issues.includedUnproven).size, "Has incluido 1 posición", "Has incluido {n} posiciones")} sin prueba de EUR (${all(issues.includedUnproven)}): ` +
        "van marcadas en la lista; comprueba que sus importes están en euros antes de confirmar."
    );
  }
  if (issues.codesImported.length > 0) {
    warnings.push(
      plural(issues.codesImported.length, "Se importa como posición un identificador que no es ISIN", "Se importan como posiciones {n} identificadores que no son ISIN") +
        ` (${all(issues.codesImported)}): comprueba que no sea un subtotal o un rótulo.`
    );
  }
  if (issues.notPositions.length > 0) {
    warnings.push(
      plural(issues.notPositions.length, "Se ignora una fila de sección o subtotal", "Se ignoran {n} filas de sección o subtotal") +
        ` (${all(issues.notPositions)}): ${issues.notPositions.length === 1 ? "no es una posición" : "no son posiciones"}.`
    );
    addDiscarded(summary, "rótulo o total, no posición", issues.notPositions);
  }
  if (issues.subtotals.length > 0) {
    warnings.push(
      plural(issues.subtotals.length, "Se ignora un subtotal con el ISIN", "Se ignoran {n} subtotales con el ISIN") + ` (${all(issues.subtotals)}).`
    );
    addDiscarded(summary, "subtotal", issues.subtotals);
  }
  if (issues.otherCurrency.length > 0) {
    const n = issues.otherCurrency.length;
    warnings.push(
      plural(n, "1 posición con un indicio de otra divisa y sin contravalor en EUR", "{n} posiciones con un indicio de otra divisa y sin contravalor en EUR") +
        ` (${all(issues.otherCurrency)}): no se ${verb(n)}. Usa el extracto con «Contravalor EUR» relleno.`
    );
    addDiscarded(summary, "en otra divisa sin contravalor en EUR", issues.otherCurrency);
  }
  if (issues.unknownCurrency.length > 0) {
    const n = issues.unknownCurrency.length;
    warnings.push(
      `${plural(n, "1 posición con una divisa que no se reconoce", "{n} posiciones con una divisa que no se reconoce")} (${all(issues.unknownCurrency)}): no se ${verb(n)}.`
    );
    addDiscarded(summary, "divisa no reconocida", issues.unknownCurrency);
  }
  if (issues.conflicting.length > 0) {
    const n = issues.conflicting.length;
    warnings.push(`${plural(n, "1 posición con divisas contradictorias", "{n} posiciones con divisas contradictorias")} (${all(issues.conflicting)}): no se ${verb(n)}.`);
    addDiscarded(summary, "divisas contradictorias", issues.conflicting);
  }
  for (const [label, ids] of issues.noCurrency) {
    warnings.push(
      plural(ids.length, "1 posición sin divisa conocida", "{n} posiciones sin divisa conocida") +
        ` (${all(ids)}): no se ${verb(ids.length)}. La columna «${label}» no es el contravalor en EUR y no consta que la fila esté en euros.`
    );
    addDiscarded(summary, "sin divisa conocida", ids);
  }
  if (issues.short.length > 0) {
    const n = issues.short.length;
    warnings.push(
      `${plural(n, "1 posición corta o vendida", "{n} posiciones cortas o vendidas")} (${all(issues.short)}): no se ${verb(n)} como posición larga.`
    );
    addDiscarded(summary, "posición corta", issues.short);
  }
  if (issues.hiddenText.length > 0) {
    const n = issues.hiddenText.length;
    warnings.push(`${plural(n, "1 posición con texto oculto", "{n} posiciones con texto oculto")} en la celda del importe (${all(issues.hiddenText)}): no se ${verb(n)}.`);
    addDiscarded(summary, "texto oculto en el importe", issues.hiddenText);
  }
  if (issues.percent.length > 0) {
    const n = issues.percent.length;
    warnings.push(`${plural(n, "1 posición con un porcentaje", "{n} posiciones con porcentajes")} en vez de un importe (${all(issues.percent)}): no se ${verb(n)}.`);
    addDiscarded(summary, "porcentaje, no importe", issues.percent);
  }
  if (issues.ambiguous.length > 0) {
    const n = issues.ambiguous.length;
    warnings.push(
      `${plural(n, "1 posición con un importe ambiguo", "{n} posiciones con importes ambiguos")} (${all(issues.ambiguous)}): ` +
        `no se sabe si la coma o el punto son de miles o de decimales, y no se ${verb(n)}. Escribe el importe con decimales («80.000,00»).`
    );
    addDiscarded(summary, "importe ambiguo", issues.ambiguous);
  }
  if (issues.negative.length > 0) {
    const n = issues.negative.length;
    warnings.push(`${plural(n, "1 posición con importe negativo o cero", "{n} posiciones con importe negativo o cero")} (${all(issues.negative)}): no se ${verb(n)}.`);
    addDiscarded(summary, "importe negativo o cero", issues.negative);
  }
  if (issues.blank.length > 0) {
    const n = issues.blank.length;
    warnings.push(
      `${plural(n, "1 fila con identificador y sin importe en EUR", "{n} filas con identificador y sin importe en EUR")} (${all(issues.blank)}): no se ${verb(n)}.`
    );
    addDiscarded(summary, "sin importe en EUR", issues.blank);
  }
  if (issues.sharedAmount.length > 0) {
    const n = issues.sharedAmount.length;
    warnings.push(`${plural(n, "1 fila comparte", "{n} filas comparten")} el importe de la fila anterior (${all(issues.sharedAmount)}): no se ${verb(n)}.`);
    addDiscarded(summary, "importe de otra fila", issues.sharedAmount);
  }
  if (issues.misaligned.length > 0) {
    const n = issues.misaligned.length;
    warnings.push(
      `${plural(n, "1 fila tiene", "{n} filas tienen")} más columnas que la cabecera (${all(issues.misaligned)}), ` +
        `quizá por un separador de miles sin comillas o una celda de más: no se ${verb(n)}.`
    );
    addDiscarded(summary, "más columnas que la cabecera", issues.misaligned);
  }
  if (issues.unreadable.length > 0) {
    const n = issues.unreadable.length;
    warnings.push(
      `${plural(n, "1 fila con identificador y sin importe legible", "{n} filas con identificador y sin importe legible")} (${all(issues.unreadable)}): no se ${verb(n)}.`
    );
    addDiscarded(summary, "sin importe legible", issues.unreadable);
  }
  if (issues.unlabelled.length > 0) {
    const n = issues.unlabelled.length;
    warnings.push(`${plural(n, "1 fila con importe", "{n} filas con importe")} y sin un identificador reconocible (${list(issues.unlabelled)}): no se ${verb(n)}.`);
    addDiscarded(summary, "sin identificador", issues.unlabelled);
  }
  if (issues.noId.length > 0) {
    const n = issues.noId.length;
    warnings.push(`${plural(n, "1 fila con importe", "{n} filas con importe")} y sin ISIN (${list(issues.noId)}), como la liquidez: no se ${verb(n)}.`);
    addDiscarded(summary, "sin ISIN", issues.noId);
  }
  addDiscarded(summary, "fila de total", issues.totals);
  if (issues.totalMismatch.length > 0) {
    // IMP-2 (auditoría del 16-11-2026): el total del extracto es la única cifra del fichero que dice cuánto debería
    // haberse leído. No se usa para nada más: ni corrige importes ni cambia lo que entra.
    const n = issues.totalMismatch.length;
    warnings.push(
      `${plural(n, "La fila de total no cuadra", "{n} filas de total no cuadran")} con lo leído: ${issues.totalMismatch.join("; ")}. ` +
        "Puede faltar alguna posición en el fichero o haberse leído mal un importe: compruébalo antes de confirmar."
    );
  }
}

function delimitedCell(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Las tablas visibles de un HTML como texto delimitado por «;»: el título de cada tabla, sus filas y una línea en blanco. */
function htmlToDelimitedText(html: string): string {
  const lines: string[] = [];
  const outside = htmlOutsideText(html);
  if (outside) lines.push(...outside.split("\n").map(delimitedCell), "");
  for (const table of readTables(html)) {
    if (table.title) lines.push(delimitedCell(table.title));
    for (const row of table.rows) lines.push(row.map(delimitedCell).join(";").replace(/;+$/, ""));
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * I6 (revisión 7): el texto que Posiciones globales deja en el cuadro tras
 * cargar un fichero. Leer el fichero y tocar el cuadro aplican la MISMA regla
 * porque el cuadro trae el propio contenido: un CSV o un libro tal cual (el
 * libro, con sus líneas «## Hoja: …»), y un HTML como texto delimitado si se
 * lee igual (mismas posiciones y mismas elecciones); si no, el HTML tal cual.
 * Antes el cuadro traía «id;importe» y la lista aplicaba sus propias reglas al
 * releerlo (W17, W25, V52).
 */
export function importBoxText(content: string): string {
  if (!isHtmlTable(content)) return content;
  const delimited = htmlToDelimitedText(content);
  const fingerprint = (read: BrokerExportRead) =>
    JSON.stringify({
      positions: read.positions,
      choices: read.choices.map((choice) => [choice.kind, choice.options.map((option) => [option.label, Math.round(option.total * 100)])])
    });
  return fingerprint(readBrokerExport(delimited)) === fingerprint(readBrokerExport(content)) ? delimited : content;
}

/** Extrae la foto actual de posiciones de un export de broker conservando importes. */
export function brokerExportToPositionAmounts(text: string, choices: ImportChoiceValues = {}, options: BrokerReadOptions = {}): BrokerPositionAmount[] {
  return readBrokerExport(text, choices, options).positions;
}

/**
 * ¿El texto parece un extracto de broker (no el formato simple asset_id,weight)?
 * HTML siempre; un texto delimitado con una columna de identificadores
 * localizada y, o bien un importe que sale de una cabecera reconocida (también
 * con dos columnas: «ISIN;Contravalor EUR» son importes, nunca pesos, I2), o
 * bien más de dos columnas con la cabecera de ISIN.
 */
export function looksLikeBrokerExport(text: string): boolean {
  if (isHtmlTable(text)) return true;
  const read = readBrokerExport(text);
  return read.recognized && (read.amountFromHeader || (read.maxColumns > 2 && read.idFromHeader));
}

export interface BrokerCanonicalImport {
  /** Texto canónico "asset_id,weight" (o el texto original si no parece un extracto útil). */
  text: string;
  /**
   * El lector no ha aceptado ninguna posición y `text` es el texto original. Quien ya sabe que el texto es un extracto
   * (`looksLikeBrokerExport`) NO debe leer ese texto como «asset_id,peso»: sus importes pasarían por pesos.
   */
  noPositions: boolean;
  /** Filas con identificador cuyo importe no se pudo leer (o no era positivo) y se han ignorado. */
  unreadableRows: number;
  /** Avisos del lector: lo que no se ha importado o se ha importado con reservas. */
  warnings: string[];
  /** Lo que el asesor tiene que confirmar antes de usar nada. */
  euroConfirmation: EuroConfirmation | null;
  /** Elecciones del asesor, pendientes o hechas (columna de importe, titular). */
  choices: ImportChoice[];
  /** Resumen del lector. */
  summary: ImportSummary;
}

/** Transforma un extracto de broker en texto canonico "asset_id,weight" (pesos por valor de mercado). */
export function brokerExportToCanonicalText(text: string): string {
  return brokerExportToCanonicalImport(text).text;
}

/**
 * B8 (auditoría 29-09): la ruta del Constructor no agrupaba por ISIN, así que
 * un fondo presente en dos cuentas llegaba como dos líneas y la segunda se
 * rechazaba como DUPLICATE_ASSET (su importe desaparecía de la cartera); y las
 * filas con importe ilegible se saltaban sin contarse. Ahora se suman los
 * importes por ISIN — la misma agrupación que Posiciones globales — y se
 * devuelve el recuento de filas descartadas para que la UI lo muestre.
 */
export function brokerExportToCanonicalImport(text: string, choices: ImportChoiceValues = {}, options: BrokerReadOptions = {}): BrokerCanonicalImport {
  const read = readBrokerExport(text, choices, options);
  const positions = groupWithNames(read.positions);
  const total = positions.reduce((sum, p) => sum + p.amount, 0);
  if (read.choices.some((choice) => choice.chosen === null)) {
    // Elección pendiente (columna de importe o titular): no se carga nada hasta que el asesor elija.
    return { text: "asset_id,weight", noPositions: false, unreadableRows: read.unreadableRows, warnings: read.warnings, euroConfirmation: null, choices: read.choices, summary: read.summary };
  }
  if (positions.length === 0 || total <= 0) {
    // No parece un extracto útil: que lo gestione el parser normal, con los avisos. Quien llama decide con `noPositions`.
    return { text, noPositions: true, unreadableRows: 0, warnings: read.warnings, euroConfirmation: null, choices: read.choices, summary: read.summary };
  }

  const out = ["asset_id,weight"];
  for (const p of positions) out.push(`${p.id},${((p.amount / total) * 100).toFixed(4)}`);
  return {
    text: out.join("\n"),
    noPositions: false,
    unreadableRows: read.unreadableRows,
    warnings: read.warnings,
    euroConfirmation: read.euroConfirmation,
    choices: read.choices,
    summary: read.summary
  };
}
