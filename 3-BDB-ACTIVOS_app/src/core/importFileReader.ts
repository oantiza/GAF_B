/**
 * Lectura única de los ficheros de importación (incidente 04-09-2026).
 *
 * Hasta ahora los tres puntos de subida de la app hacían `FileReader.readAsText`
 * directamente. Un `.xlsx` es un ZIP binario: leído como texto salía basura, el
 * detector de extractos devolvía `false` y todas las líneas se rechazaban como
 * `MALFORMED_LINE` — el usuario veía «no importa nada» sin explicación. Y el
 * panel de importar declaraba `accept=".csv,.txt,.xls,.xlsx"`, prometiendo algo
 * que no funcionaba.
 *
 * Aquí se centraliza la lectura:
 *  - `.xlsx` (OOXML real) y `.xls` binario (OLE/BIFF) -> SheetJS (`xlsx`,
 *    import dinámico: no entra en el bundle inicial), convertidos a texto
 *    delimitado por ";". S-15 (auditoría 29-09): antes el .xlsx pasaba por
 *    `read-excel-file`; ahora hay un único lector de hojas de cálculo.
 *  - Todo lo demás (.csv, .txt, .tsv, .xls-que-es-HTML, .html) -> texto plano,
 *    con la codificación indicada (por defecto, windows-1252 para los exports
 *    del banco y utf-8 para el resto).
 *
 * El texto resultante entra en los parsers existentes sin cambios.
 *
 * Quinta pasada (R4-10, R4-07): las importaciones de POSICIONES (Posiciones
 * globales y Constructor) leen con `readPositionImportFileText` TODAS las
 * hojas con datos, separadas por una línea «## Hoja: …» que el lector de
 * extractos trata como una tabla aparte (y avisa de las que no tienen una
 * tabla de posiciones), y conservan la divisa del FORMATO de las celdas
 * numéricas («"$"#,##0.00» se lee «8736 $»: no es un importe en EUR). La
 * cartera real y las retrocesiones siguen con la primera hoja y los valores
 * en bruto.
 *
 * Octava pasada (revisión 7):
 * - I1: las hojas y las filas OCULTAS de un libro no se leen como visibles. Van
 *   aparte, tras «## Hoja oculta: …» o «## Filas ocultas: …», para que el
 *   lector las nombre en un aviso sin importarlas.
 * - W27b: las letras escapadas de un formato («#,##0.00\ \U\S\D») son texto
 *   que se ve: «USD».
 * - I7: un CSV de Excel en español (windows-1252) o un HTML en utf-8 se leen
 *   bien: se respeta el `<meta charset>` y, si no lo hay, se prueba utf-8 y,
 *   si no es utf-8 válido, windows-1252.
 *
 * Novena pasada (revisión 8, M8): el UTF-16 con marca de orden de bytes («Texto
 * Unicode» de Excel) se lee, y un `<meta charset="utf-8">` falso no se respeta.
 * I1: el nombre de una hoja vacía, los comentarios de las celdas y las
 * propiedades del libro van aparte («## Hoja vacía: …», «## Notas del libro:
 * …»): no se leen como posiciones, pero una divisa que nombren cuenta.
 */
import { emptySheetMarkerLine, hiddenRowsMarkerLine, hiddenSheetMarkerLine, sheetMarkerLine, workbookNotesMarkerLine } from "./delimitedText";
import { currencyOf } from "./eurAmount";

/** `accept` para los puntos de subida que aceptan extractos de bróker. */
export const BROKER_IMPORT_ACCEPT = ".csv,.txt,.tsv,.xls,.xlsx,.html,.htm";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLSX_NAME_RE = /\.xlsx$/i;
const LEGACY_EXPORT_NAME_RE = /\.(?:xls|html?|htm)$/i;

/** Separador de las filas sintetizadas desde una hoja de cálculo. */
const CELL_SEPARATOR = ";";

export function isXlsxFile(file: File): boolean {
  return XLSX_NAME_RE.test(file.name) || file.type === XLSX_MIME;
}

/** utf-8 salvo en los exports del banco (.xls/.html), que vienen en windows-1252. */
export function defaultTextEncoding(file: File): string {
  return LEGACY_EXPORT_NAME_RE.test(file.name) ? "windows-1252" : "utf-8";
}

function formatDateCell(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getUTCFullYear()}`;
}

/**
 * Convierte una celda a texto.
 *
 * Los números se emiten con COMA decimal a propósito: el parser numérico único
 * (`parseEuropeanNumber`) trata "302.597" como miles europeos (302597), asi que
 * emitir el punto decimal de JavaScript corrompería importes de tres decimales.
 *
 * Sexta pasada (B4): una cifra menor que mil con justo tres decimales
 * («512,875») tiene la misma forma que unos miles en inglés («512,875» =
 * 512.875), y el importador de posiciones la leía como miles bajo una cabecera
 * inglesa. Se escribe con un cero más («512,8750»): sigue siendo el mismo
 * número para cualquier lector con coma decimal (también el backend de la
 * cartera real) y ya no es ambigua.
 */
export function xlsxCellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateCell(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const text = String(value).replace(".", ",");
    return /^-?[1-9]\d{0,2},\d{3}$/.test(text) ? `${text}0` : text;
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

/**
 * Marca de divisa (o «%») del formato de número de una celda de Excel:
 * «[$€-C0A]», «#,##0.00 "€"», «"$"#,##0.00», «[$USD] 0.00», «0.00%». `null`
 * si el formato no dice ninguna.
 */
export function numberFormatMark(format: string): string | null {
  // Séptima pasada (B3, experimento E1): «_X» es un relleno del ancho de X y
  // «*X» repite X para llenar la celda; ninguno de los dos enseña X. El estilo
  // «Millares» de Excel en español (`_-* #,##0.00\ _€_-`) no dice «€».
  const outside = format
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  // Octava pasada (W27b): «\U\S\D» son letras escapadas que Excel enseña tal cual («USD»).
  const escaped = [...outside.matchAll(/(?:\\.)+/g)].map((match) => match[0].replace(/\\/g, "").trim()).filter(Boolean);
  if (outside.includes("%")) return "%";
  const candidates: string[] = [];
  // «[$símbolo-código]»: el símbolo es la divisa, la reconozcamos o no (B7:
  // «[$kr-41D]», «[$zł-415]», «[$R$-416]»…). Una que no se reconoce se marca
  // con «¤», que el analizador de importes trata como otra divisa.
  const bracketed: string[] = [];
  for (const match of format.matchAll(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g)) if (match[1].trim()) bracketed.push(match[1].trim());
  candidates.push(...bracketed);
  for (const match of format.matchAll(/"([^"]*)"/g)) candidates.push(match[1]);
  candidates.push(...escaped);
  for (const symbol of ["€", "$", "£", "¥"]) if (outside.includes(symbol)) candidates.push(symbol);
  for (const candidate of candidates) {
    const code = currencyOf(candidate.replace(/\\/g, "").trim());
    if (code) return code === "EUR" ? "€" : code === "otra divisa" ? "¤" : code;
  }
  return bracketed.length > 0 ? "¤" : null;
}

/** Filas de hoja de cálculo -> texto delimitado por ";" (sin filas vacías).
 *  `marks["fila,columna"]`: marca de divisa del formato de esa celda numérica. */
export function spreadsheetRowsToDelimitedText(
  rows: readonly (readonly unknown[])[],
  marks?: Readonly<Record<string, string>>,
  include?: (rowIndex: number) => boolean
): string {
  const lines: string[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    if (include && !include(rowIndex)) continue;
    // El ";" es el separador: dentro de una celda se sustituye por coma para no
    // partir la columna. Los saltos de línea internos se colapsan.
    const cells = row.map((cell, colIndex) => {
      const text = xlsxCellToText(cell).replace(/[\r\n]+/g, " ").replace(/;/g, ",").trim();
      const mark = typeof cell === "number" ? marks?.[`${rowIndex},${colIndex}`] : undefined;
      return mark && text ? `${text} ${mark}` : text;
    });

    if (cells.every((cell) => cell.length === 0)) continue;
    lines.push(cells.join(CELL_SEPARATOR));
  }

  return lines.join("\n");
}

/** Una hoja leída con SheetJS: nombre y filas como arrays de celdas tipadas
 *  (string, number, boolean, Date en UTC o null si está vacía). */
export interface SpreadsheetSheet {
  name: string;
  rows: unknown[][];
  /** Marca de divisa (o «%») del formato de las celdas numéricas, por «fila,columna» de `rows`. */
  marks?: Record<string, string>;
  /** La hoja está oculta en el libro (I1 de la revisión 7). */
  hidden?: boolean;
  /** Índices de `rows` de las filas ocultas. */
  hiddenRows?: number[];
  /** Comentarios de sus celdas (I1 de la revisión 8). */
  comments?: string[];
}

/** Lo que el libro dice de sí mismo (Título, Asunto, Palabras clave…), con su nombre en español. */
export type WorkbookProps = ReadonlyArray<readonly [label: string, value: string]>;

const PROP_LABELS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["Title", "Título"],
  ["Subject", "Asunto"],
  ["Keywords", "Palabras clave"],
  ["Category", "Categoría"],
  ["Comments", "Comentarios"]
];

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** `.xlsx` (ZIP/OOXML) o `.xls` binario (OLE compuesto o flujo BIFF suelto). */
export function looksLikeBinaryWorkbook(bytes: Uint8Array): boolean {
  const isBiff = bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]);
  return startsWith(bytes, ZIP_SIGNATURE) || startsWith(bytes, OLE_SIGNATURE) || isBiff;
}

/**
 * Lee todas las hojas de un libro `.xlsx`/`.xls` con SheetJS.
 *
 * SheetJS acepta cualquier byte y, si no reconoce el formato, lo trata como
 * texto plano; por eso se exige la firma binaria antes de leer (así un
 * fichero corrupto o renombrado falla con un error claro, como antes con
 * `read-excel-file`). Las fechas salen como `Date` a medianoche UTC
 * (`UTC: true`), que es lo que esperan `xlsxCellToText` y los parsers de
 * retrocesiones: sin esa opción SheetJS las devuelve en hora local y en
 * España `getUTCDate()` daría el día anterior.
 */
export async function readSpreadsheetSheets(buffer: ArrayBuffer): Promise<SpreadsheetSheet[]> {
  return (await readSpreadsheetBook(buffer)).sheets;
}

/** Las hojas de un libro y sus propiedades (I1 de la revisión 8: el título del libro puede decir «USD»). */
export async function readSpreadsheetBook(buffer: ArrayBuffer): Promise<{ sheets: SpreadsheetSheet[]; props: WorkbookProps }> {
  if (!looksLikeBinaryWorkbook(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)))) {
    throw new Error("Formato de libro no reconocido");
  }
  const { read, utils } = await import("xlsx");
  // `cellStyles` hace que SheetJS lea las propiedades de las filas (`!rows`), entre ellas si están ocultas.
  const workbook = read(buffer, { type: "array", cellDates: true, cellNF: true, cellStyles: true });
  const hiddenSheets = new Set(
    (workbook.Workbook?.Sheets ?? []).filter((sheet) => Number(sheet?.Hidden ?? 0) > 0).map((sheet) => sheet?.name ?? "")
  );
  const sheets = workbook.SheetNames.map((name): SpreadsheetSheet => {
    const sheet = workbook.Sheets[name];
    // Con `header: 1` SheetJS devuelve también las filas en blanco: la fila i
    // de `rows` es la fila `s.r + i` de la hoja y la columna j, la `s.c + j`.
    const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true, UTC: true, blankrows: true });
    const marks: Record<string, string> = {};
    const ref = sheet["!ref"];
    const hiddenRows: number[] = [];
    const comments: string[] = [];
    if (ref) {
      const range = utils.decode_range(ref);
      for (const [index, props] of (sheet["!rows"] ?? []).entries()) {
        if (props?.hidden && index >= range.s.r) hiddenRows.push(index - range.s.r);
      }
      for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue;
        for (const note of (sheet[address] as { c?: Array<{ t?: unknown }> } | undefined)?.c ?? []) {
          if (typeof note.t === "string" && note.t.trim()) comments.push(note.t.replace(/\s+/g, " ").trim());
        }
        const cell = sheet[address] as { t?: string; z?: unknown } | undefined;
        if (cell?.t !== "n" || typeof cell.z !== "string") continue;
        const mark = numberFormatMark(cell.z);
        if (!mark) continue;
        const { r, c } = utils.decode_cell(address);
        marks[`${r - range.s.r},${c - range.s.c}`] = mark;
      }
    }
    return {
      name,
      rows,
      ...(Object.keys(marks).length > 0 ? { marks } : {}),
      ...(hiddenSheets.has(name) ? { hidden: true } : {}),
      ...(hiddenRows.length > 0 ? { hiddenRows } : {}),
      ...(comments.length > 0 ? { comments } : {})
    };
  });
  if (sheets.length === 0) throw new Error("Libro sin hojas");
  const rawProps = (workbook.Props ?? {}) as Record<string, unknown>;
  const props = PROP_LABELS.flatMap(([key, label]) => {
    const value = rawProps[key];
    return typeof value === "string" && value.trim() ? [[label, value.replace(/\s+/g, " ").trim()] as const] : [];
  });
  return { sheets, props };
}

/** Lee un `.xlsx` real (primera hoja) y lo devuelve como texto delimitado. */
export async function readXlsxFileAsDelimitedText(file: File): Promise<string> {
  let rows: unknown[][];

  try {
    rows = (await readSpreadsheetSheets(await file.arrayBuffer()))[0].rows;
  } catch {
    throw new Error(
      "No se pudo leer el fichero .xlsx. Vuelve a exportarlo desde el banco o guárdalo como CSV."
    );
  }

  return spreadsheetRowsToDelimitedText(rows);
}

function readTextFile(file: File, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("No se pudo leer el fichero."));
    reader.readAsText(file, encoding);
  });
}

/** `<meta charset="…">` (o el `content` de un `http-equiv`) en los primeros bytes de un HTML. */
function declaredCharset(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 4096)));
  const match = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  return match ? match[1].toLowerCase() : null;
}

/**
 * I7 (revisión 7): texto de un fichero sin codificación impuesta. Se respeta
 * el `<meta charset>` de un HTML; si no lo hay, se prueba utf-8 estricto y, si
 * el fichero no es utf-8 válido (un CSV de Excel en español, un `.xls` HTML de
 * Andbank), se lee como windows-1252. Antes se imponía utf-8 al `.csv` y
 * windows-1252 al `.html`, y «Valoración (€)» llegaba como «Valoraci�n (�)».
 */
export function decodeImportBytes(bytes: Uint8Array): string {
  // M8 (revisión 8): el «Texto Unicode» de Excel es UTF-16 con su marca de orden de bytes.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const declared = declaredCharset(bytes);
  if (declared) {
    try {
      // Un HTML que dice utf-8 y no lo es (un `.xls` en windows-1252 mal etiquetado) no se respeta: se sigue probando.
      const fatal = /^utf-?8$/.test(declared);
      return new TextDecoder(declared, { fatal }).decode(bytes);
    } catch {
      // Una codificación que el navegador no conoce, o un utf-8 que no lo es: se prueba como cualquier otro fichero.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export interface ReadImportFileOptions {
  /** Codificación para ficheros de texto. Por defecto, `defaultTextEncoding`. */
  encoding?: string;
  /** Importación de posiciones: todas las hojas y la divisa del formato de las celdas. */
  positions?: boolean;
}

/** Libro -> texto para las importaciones de posiciones: todas las hojas con
    datos, cada una tras su línea «## Hoja: …» (también si solo hay una, para
    que el resumen diga qué hoja se ha leído: M4 de la revisión 5). */
export function spreadsheetSheetsToPositionText(sheets: readonly SpreadsheetSheet[], props: WorkbookProps = []): string {
  const blocks: string[] = [];
  // I1 (revisión 8): lo que el libro dice fuera de las celdas va aparte; no se lee, pero cuenta para la divisa.
  if (props.length > 0) blocks.push(`${workbookNotesMarkerLine("propiedades del libro")}\n${props.map(([label, value]) => `${label}: ${value}`).join("\n")}`);
  for (const sheet of sheets) {
    if (sheet.comments && sheet.comments.length > 0) {
      blocks.push(`${workbookNotesMarkerLine(`comentarios de la hoja «${sheet.name}»`)}\n${sheet.comments.join("\n")}`);
    }
    if (!sheet.rows.some((row) => row.some((cell) => xlsxCellToText(cell).trim()))) {
      // Una hoja vacía no tiene filas, pero su nombre se ve en la pestaña.
      blocks.push(emptySheetMarkerLine(sheet.name));
      continue;
    }
    const hiddenRows = new Set(sheet.hiddenRows ?? []);
    const visible = spreadsheetRowsToDelimitedText(sheet.rows, sheet.marks, (index) => !hiddenRows.has(index));
    if (sheet.hidden) {
      // I1: una hoja oculta va aparte; el lector la nombra y no la lee.
      const text = spreadsheetRowsToDelimitedText(sheet.rows, sheet.marks);
      if (text.trim()) blocks.push(`${hiddenSheetMarkerLine(sheet.name)}\n${text}`);
      continue;
    }
    if (visible.trim()) blocks.push(`${sheetMarkerLine(sheet.name)}\n${visible}`);
    if (hiddenRows.size > 0) {
      const text = spreadsheetRowsToDelimitedText(sheet.rows, sheet.marks, (index) => hiddenRows.has(index));
      if (text.trim()) blocks.push(`${hiddenRowsMarkerLine(sheet.name)}\n${text}`);
    }
  }
  return blocks.join("\n");
}

async function workbookText(file: File, positions: boolean): Promise<string> {
  const { sheets, props } = await readSpreadsheetBook(await file.arrayBuffer());
  return positions ? spreadsheetSheetsToPositionText(sheets, props) : spreadsheetRowsToDelimitedText(sheets[0].rows);
}

/** Punto único de lectura: devuelve SIEMPRE texto listo para los parsers. */
export async function readImportFileText(
  file: File,
  options: ReadImportFileOptions = {}
): Promise<string> {
  if (isXlsxFile(file)) {
    if (!options.positions) return readXlsxFileAsDelimitedText(file);
    try {
      return await workbookText(file, true);
    } catch {
      throw new Error("No se pudo leer el fichero .xlsx. Vuelve a exportarlo desde el banco o guárdalo como CSV.");
    }
  }

  if (/\.xls$/i.test(file.name)) {
    // Un .xls que en realidad es HTML (extractos de Andbank) sigue al lector de texto.
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (looksLikeBinaryWorkbook(signature)) {
      try {
        return await workbookText(file, options.positions === true);
      } catch {
        throw new Error("No se pudo leer el fichero .xls. Comprueba que no esté protegido o vuelve a guardarlo como .xlsx.");
      }
    }
  }

  if (options.encoding) return readTextFile(file, options.encoding);
  if (options.positions) return decodeImportBytes(new Uint8Array(await file.arrayBuffer()));
  return readTextFile(file, defaultTextEncoding(file));
}

/** Lectura de un fichero de POSICIONES (Posiciones globales y Constructor): todas las hojas de un libro. */
export function readPositionImportFileText(file: File, options: Omit<ReadImportFileOptions, "positions"> = {}): Promise<string> {
  return readImportFileText(file, { ...options, positions: true });
}
