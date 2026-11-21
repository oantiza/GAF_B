import type {
  CommercialRetroImportAction,
  CommercialRetroImportConflict,
  CommercialRetroImportEntry,
  CommercialRetroImportIssue,
  CommercialRetroImportPreviewRow,
  CommercialRetroInterpretation,
  CommercialRetroInterpretOptions,
  CommercialRetroPreviewCounts,
  CommercialRetroPreviewOptions,
  CommercialRetroRawRow,
  CommercialRetroRecord,
  CommercialRetroScale,
  CommercialRetroSheet,
  CommercialRetroSheetColumns
} from "../types/commercialRetro";

import { diaLocal } from "./fechaLocal";
import { parseEuropeanNumber } from "./numberFormat";
import { readSpreadsheetSheets } from "./importFileReader";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Cabeceras que reconoce la detección de columnas (sin distinguir mayúsculas). */
const HEADER_ISIN = /^isin$/i;
const HEADER_RETRO = /retro|rebate|comisi|incentiv|cesi[oó]n/i;
const HEADER_NAME = /nombre|name|fondo|denominaci|activo/i;
const HEADER_DATE = /fecha|vigen|as_of|date/i;
const HEADER_NOTE = /nota|note|coment|observ/i;

/** Por encima de esta cifra, un valor ya no puede ser una fracción (20 % de
 *  retrocesión sobre patrimonio no existe): si todos los valores del fichero
 *  quedan por debajo, la columna viene como fracción con formato % de Excel. */
const FRACTION_MAX = 0.2;

/**
 * El día de un instante en el calendario del asesor, «AAAA-MM-DD» (PLA-09, FMT-19). Con `toISOString` salía el de
 * Greenwich: entre las 00:00 y las 01:00 o las 02:00 de Madrid, la vigencia por defecto era la de ayer.
 */
export function diaDeHoyLocal(instante: Date = new Date()): string {
  return diaLocal(instante.toISOString()) ?? instante.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return diaDeHoyLocal();
}

export function normalizeCommercialIsin(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isCommercialIsin(value: string): boolean {
  return ISIN_RE.test(normalizeCommercialIsin(value));
}

export function parseCommercialRetroNumber(raw: string): number {
  const clean = raw.trim().replace(/[€%\s]/g, "");
  if (!clean) return Number.NaN;
  // Ola 2 (T4c): cuarta copia unificada — delega en el parser numérico único
  // (esta versión ni siquiera trataba los miles europeos sin coma).
  return parseEuropeanNumber(clean);
}

/** Redondeo a cuatro decimales de porcentaje: los restos de fórmula del Excel
 *  (0,58980690890447 %) no deben producir «actualizaciones» falsas. */
export function roundCommercialRetroPct(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function splitLine(line: string): string[] {
  if (line.includes(";")) {
    return line.split(";").map((part) => part.trim());
  }
  if (line.includes("\t")) {
    return line.split("\t").map((part) => part.trim());
  }

  const parts = line.split(",").map((part) => part.trim());
  if (parts.length <= 4) {
    const dateIdx = parts.findIndex((part, idx) => idx >= 2 && DATE_RE.test(part));
    if (dateIdx > 2) {
      return [parts[0] ?? "", parts.slice(1, dateIdx).join(","), parts[dateIdx] ?? "", parts.slice(dateIdx + 1).join(",")];
    }
    if (parts.length > 2) {
      return [parts[0] ?? "", parts.slice(1).join(",")];
    }
    return parts;
  }

  const dateIdx = parts.findIndex((part, idx) => idx >= 2 && DATE_RE.test(part));
  if (dateIdx > 1) {
    return [parts[0] ?? "", parts.slice(1, dateIdx).join(","), parts[dateIdx] ?? "", parts.slice(dateIdx + 1).join(",")];
  }
  return parts;
}

function isHeader(fields: string[]): boolean {
  return (fields[0] ?? "").trim().toLowerCase() === "isin";
}

function parseCommercialRetroFields(
  rows: { fields: string[]; line_number: number; raw_line: string }[]
): {
  entries: CommercialRetroImportEntry[];
  issues: CommercialRetroImportIssue[];
} {
  const entries: CommercialRetroImportEntry[] = [];
  const issues: CommercialRetroImportIssue[] = [];
  const seen = new Set<string>();

  rows.forEach(({ fields, line_number, raw_line }) => {
    if (isHeader(fields)) return;

    const isin = normalizeCommercialIsin(fields[0] ?? "");
    const retroRaw = fields[1] ?? "";
    const optionalDate = (fields[2] ?? "").trim();
    const hasLegacyDate = DATE_RE.test(optionalDate);
    const asOf = hasLegacyDate ? optionalDate : todayIsoDate();
    const note = fields.slice(hasLegacyDate ? 3 : 2).join(" ").trim();
    const retro = parseCommercialRetroNumber(retroRaw);

    if (!isCommercialIsin(isin)) {
      issues.push({ line_number, raw_line, message: "ISIN no válido." });
      return;
    }
    if (!Number.isFinite(retro) || retro < 0 || retro > 100) {
      issues.push({ line_number, raw_line, message: "Retrocesión fuera de rango 0-100." });
      return;
    }
    if (seen.has(isin)) {
      issues.push({ line_number, raw_line, message: "ISIN duplicado en el import." });
      return;
    }
    seen.add(isin);
    entries.push({
      isin,
      retro_pct: retro,
      as_of_date: asOf,
      note: note || undefined,
      line_number
    });
  });

  return { entries, issues };
}

function textRows(text: string): CommercialRetroRawRow[] {
  return text
    .split(/\r?\n/)
    .map((rawLine, index) => ({ rawLine, line: rawLine.trim(), line_number: index + 1 }))
    .filter((row) => row.line)
    .map((row) => ({
      fields: splitLine(row.line),
      line_number: row.line_number,
      raw_line: row.rawLine
    }));
}

export function parseCommercialRetroCsv(text: string): {
  entries: CommercialRetroImportEntry[];
  issues: CommercialRetroImportIssue[];
} {
  return parseCommercialRetroFields(textRows(text));
}

function excelCellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cellObject = value as {
      formula?: unknown;
      hyperlink?: unknown;
      result?: unknown;
      richText?: { text?: unknown }[];
      text?: unknown;
    };
    if (cellObject.result != null) return excelCellText(cellObject.result);
    if (typeof cellObject.text === "string") return cellObject.text.trim();
    if (Array.isArray(cellObject.richText)) {
      return cellObject.richText.map((part) => String(part.text ?? "")).join("").trim();
    }
  }
  return String(value).trim();
}

function excelRows(matrix: unknown[][]): CommercialRetroRawRow[] {
  return matrix
    .map((values, index) => ({
      fields: values.map(excelCellText),
      values,
      line_number: index + 1,
      raw_line: values.map(excelCellText).join(";")
    }))
    .filter((row) => row.fields.some((field) => field.trim()));
}

const EXCEL_READ_ISSUE: CommercialRetroImportIssue = {
  line_number: 1,
  raw_line: "",
  message: "No se pudo leer el Excel. Usa un .xlsx válido o exporta el archivo a CSV."
};

export async function parseCommercialRetroExcel(buffer: ArrayBuffer): Promise<{
  entries: CommercialRetroImportEntry[];
  issues: CommercialRetroImportIssue[];
}> {
  let matrix: unknown[][];
  try {
    matrix = (await readSpreadsheetSheets(buffer))[0].rows;
  } catch {
    return { entries: [], issues: [EXCEL_READ_ISSUE] };
  }

  const rows = excelRows(matrix);
  if (rows.length === 0) {
    return { entries: [], issues: [{ line_number: 1, raw_line: "", message: "El Excel no contiene filas de datos." }] };
  }

  return parseCommercialRetroFields(rows);
}

export async function parseCommercialRetroFile(file: File): Promise<{
  entries: CommercialRetroImportEntry[];
  issues: CommercialRetroImportIssue[];
}> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") {
    return await parseCommercialRetroExcel(await file.arrayBuffer());
  }
  if (extension === "xls") {
    return {
      entries: [],
      issues: [{
        line_number: 1,
        raw_line: "",
        message: "El formato .xls antiguo no está soportado. Exporta el archivo a .xlsx o CSV."
      }]
    };
  }
  return parseCommercialRetroCsv(await file.text());
}

/* ------------------------------------------------------------------------ */
/* Importación por columnas: el fichero manda el orden y la escala se elige. */
/* ------------------------------------------------------------------------ */

function cellNumber(row: CommercialRetroRawRow, column: number): number {
  const typed = row.values?.[column];
  if (typeof typed === "number") return typed;
  if (typed instanceof Date) return Number.NaN;
  return parseCommercialRetroNumber(row.fields[column] ?? "");
}

function columnScore(rows: CommercialRetroRawRow[], column: number, test: (row: CommercialRetroRawRow) => boolean): number {
  const filled = rows.filter((row) => (row.fields[column] ?? "").trim() !== "");
  if (filled.length === 0) return 0;
  return filled.filter(test).length / filled.length;
}

function widestRow(rows: CommercialRetroRawRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.fields.length), 0);
}

function bestColumn(rows: CommercialRetroRawRow[], excluded: Set<number>, test: (row: CommercialRetroRawRow, column: number) => boolean): number {
  let best = -1;
  let bestScore = 0;
  for (let column = 0; column < widestRow(rows); column += 1) {
    if (excluded.has(column)) continue;
    const score = columnScore(rows, column, (row) => test(row, column));
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : -1;
}

function opt(index: number): number | undefined {
  return index >= 0 ? index : undefined;
}

/** Localiza la cabecera y qué columna es cada cosa. Sin cabecera, vale el
 *  formato compacto de siempre: `isin;retro;[fecha];[nota]`. */
export function detectCommercialRetroColumns(rows: CommercialRetroRawRow[]): CommercialRetroSheetColumns | null {
  if (rows.length === 0) return null;

  const headerIdx = rows.slice(0, 5).findIndex((row) => row.fields.some((field) => HEADER_ISIN.test(field.trim())));
  if (headerIdx >= 0) {
    const header = rows[headerIdx].fields.map((field) => field.trim());
    const dataRows = rows.slice(headerIdx + 1);
    const isin = header.findIndex((field) => HEADER_ISIN.test(field));
    const find = (pattern: RegExp) => header.findIndex((field, index) => index !== isin && pattern.test(field));
    const nombre = find(HEADER_NAME);
    const fecha = find(HEADER_DATE);
    const nota = find(HEADER_NOTE);
    let retro = header.findIndex((field, index) => index !== isin && index !== nombre && index !== fecha && index !== nota && HEADER_RETRO.test(field));
    if (retro < 0) {
      retro = bestColumn(dataRows, new Set([isin, nombre, fecha, nota].filter((index) => index >= 0)), (row, column) =>
        Number.isFinite(cellNumber(row, column))
      );
    }
    if (retro < 0) return null;
    return {
      header_row: rows[headerIdx].line_number,
      isin,
      retro,
      nombre: opt(nombre),
      fecha: opt(fecha),
      nota: opt(nota)
    };
  }

  const isin = bestColumn(rows, new Set(), (row, column) => isCommercialIsin(row.fields[column] ?? ""));
  if (isin < 0) return null;
  const retro = bestColumn(rows, new Set([isin]), (row, column) => Number.isFinite(cellNumber(row, column)));
  if (retro < 0) return null;
  const fecha = bestColumn(rows, new Set([isin, retro]), (row, column) => DATE_RE.test((row.fields[column] ?? "").trim()));
  return { header_row: null, isin, retro, fecha: opt(fecha) };
}

function numericColumnValues(rows: CommercialRetroRawRow[], columns: CommercialRetroSheetColumns | null): number[] {
  if (!columns) return [];
  return rows
    .filter((row) => columns.header_row == null || row.line_number !== columns.header_row)
    .map((row) => cellNumber(row, columns.retro))
    .filter((value) => Number.isFinite(value));
}

/** Si todos los valores caben como fracción (≤ 0,2), la columna viene con el
 *  formato de porcentaje de Excel y hay que multiplicar por 100. */
export function suggestCommercialRetroScale(values: number[]): CommercialRetroScale {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return "porcentaje";
  const max = Math.max(...finite);
  return max <= FRACTION_MAX ? "fraccion" : "porcentaje";
}

/**
 * ¿Alguna celda de la columna de retrocesión lleva escrito su «%»? Entonces el fichero dice él mismo que son porcentajes
 * (auditoría 16-11-2026, RET-1). El signo se quita al leer la cifra, y la escala se decidía solo por el tamaño: un fichero
 * de clases casi limpias («0,15%», «0%», «0,10 %», todo por debajo de 0,2) se tomaba por fracciones y entraba como 15, 0 y
 * 10. En el informe interno, 15 % sobre 100.000 € son 15.000 € de ingreso al año en vez de 150 €. Una hoja de Excel con
 * formato de porcentaje no pasa por aquí: sus celdas llegan como número (0,0015), sin signo.
 */
function percentSignWritten(rows: CommercialRetroRawRow[], columns: CommercialRetroSheetColumns | null): boolean {
  if (!columns) return false;
  return rows
    .filter((row) => columns.header_row == null || row.line_number !== columns.header_row)
    .some((row) => (row.fields[columns.retro] ?? "").includes("%"));
}

function sheetFromRows(rows: CommercialRetroRawRow[], extra: Partial<CommercialRetroSheet> = {}): CommercialRetroSheet {
  const columns = detectCommercialRetroColumns(rows);
  return {
    rows,
    columns,
    suggested_scale: percentSignWritten(rows, columns) ? "porcentaje" : suggestCommercialRetroScale(numericColumnValues(rows, columns)),
    ...extra
  };
}

export function readCommercialRetroText(text: string): CommercialRetroSheet {
  return sheetFromRows(textRows(text));
}

/** Lee la hoja pedida (por defecto la primera) conservando los valores tipados. */
export async function readCommercialRetroExcel(buffer: ArrayBuffer, sheetIndex = 0): Promise<CommercialRetroSheet> {
  let sheetNames: string[] = [];
  let matrix: unknown[][];
  try {
    // S-15 (auditoría 29-09): lector único SheetJS (antes read-excel-file).
    const sheets = await readSpreadsheetSheets(buffer);
    sheetNames = sheets.map((sheet) => sheet.name);
    const index = Math.min(Math.max(sheetIndex, 0), Math.max(sheetNames.length - 1, 0));
    matrix = sheets[index].rows;
    sheetIndex = index;
  } catch {
    return { rows: [], columns: null, suggested_scale: "porcentaje", sheet_names: sheetNames, sheet_index: 0 };
  }
  return sheetFromRows(excelRows(matrix), { sheet_names: sheetNames, sheet_index: sheetIndex });
}

export async function readCommercialRetroFile(file: File, sheetIndex = 0): Promise<CommercialRetroSheet> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") {
    return await readCommercialRetroExcel(await file.arrayBuffer(), sheetIndex);
  }
  if (extension === "xls") {
    return { rows: [], columns: null, suggested_scale: "porcentaje" };
  }
  return readCommercialRetroText(await file.text());
}

/** Convierte las filas leídas en entradas: aplica la escala, valida, colapsa
 *  los duplicados idénticos y aparta los que traen valores distintos. */
export function interpretCommercialRetroSheet(
  sheet: CommercialRetroSheet,
  options: CommercialRetroInterpretOptions
): CommercialRetroInterpretation {
  const columns = sheet.columns;
  if (!columns) {
    const message = sheet.rows.length === 0
      ? "El fichero no contiene filas de datos."
      : "No encuentro una columna con ISIN válidos ni una columna numérica de retrocesión.";
    return { entries: [], issues: [{ line_number: 1, raw_line: "", message }], conflicts: [], zero_isins: [] };
  }
  const factor = options.scale === "fraccion" ? 100 : 1;
  const issues: CommercialRetroImportIssue[] = [];
  const groups = new Map<string, { name?: string; note?: string; as_of_date: string; values: { line_number: number; retro_pct: number }[] }>();
  const knownColumns = [columns.isin, columns.retro, columns.nombre, columns.fecha, columns.nota]
    .filter((index): index is number => index != null);
  const lastKnown = Math.max(...knownColumns);

  sheet.rows.forEach((row) => {
    if (columns.header_row != null && row.line_number === columns.header_row) return;
    const isin = normalizeCommercialIsin(row.fields[columns.isin] ?? "");
    const retroText = (row.fields[columns.retro] ?? "").trim();
    if (!isin && !retroText) return;
    if (!isCommercialIsin(isin)) {
      issues.push({ line_number: row.line_number, raw_line: row.raw_line, message: "ISIN no válido." });
      return;
    }
    const parsed = cellNumber(row, columns.retro);
    if (!Number.isFinite(parsed)) {
      issues.push({ line_number: row.line_number, raw_line: row.raw_line, message: "Retrocesión no numérica." });
      return;
    }
    const retro = roundCommercialRetroPct(parsed * factor);
    if (retro < 0 || retro > 100) {
      issues.push({ line_number: row.line_number, raw_line: row.raw_line, message: "Retrocesión fuera de rango 0-100." });
      return;
    }
    const name = columns.nombre != null ? (row.fields[columns.nombre] ?? "").trim() || undefined : undefined;
    const dateText = columns.fecha != null ? (row.fields[columns.fecha] ?? "").trim() : "";
    const asOf = DATE_RE.test(dateText) ? dateText : options.as_of_date;
    const note = columns.nota != null
      ? (row.fields[columns.nota] ?? "").trim()
      : columns.header_row == null
        ? row.fields.slice(lastKnown + 1).join(" ").trim()
        : "";

    const group = groups.get(isin);
    if (group) {
      group.values.push({ line_number: row.line_number, retro_pct: retro });
      if (!group.name && name) group.name = name;
      if (!group.note && note) group.note = note;
    } else {
      groups.set(isin, { name, note: note || undefined, as_of_date: asOf, values: [{ line_number: row.line_number, retro_pct: retro }] });
    }
  });

  const entries: CommercialRetroImportEntry[] = [];
  const conflicts: CommercialRetroImportConflict[] = [];
  groups.forEach((group, isin) => {
    const distinct = [...new Set(group.values.map((value) => value.retro_pct))];
    const resolved = options.resolved_conflicts?.[isin];
    const first = group.values[0];
    if (distinct.length > 1 && (resolved == null || !distinct.includes(resolved))) {
      conflicts.push({ isin, name: group.name, values: group.values });
      return;
    }
    entries.push({
      isin,
      retro_pct: distinct.length > 1 ? (resolved as number) : first.retro_pct,
      as_of_date: group.as_of_date,
      note: group.note,
      line_number: first.line_number,
      name: group.name,
      duplicated_lines: group.values.length > 1 ? group.values.slice(1).map((value) => value.line_number) : undefined
    });
  });
  entries.sort((left, right) => left.line_number - right.line_number);
  conflicts.sort((left, right) => left.values[0].line_number - right.values[0].line_number);

  return {
    entries,
    issues,
    conflicts,
    zero_isins: entries.filter((entry) => entry.retro_pct === 0).map((entry) => entry.isin)
  };
}

/* ------------------------------------------------------------------------ */
/* Vista previa                                                              */
/* ------------------------------------------------------------------------ */

const NAME_STOPWORDS = new Set([
  "fund", "funds", "fondo", "fondos", "fi", "sicav", "fcp", "class", "clase", "cl", "acc", "dis", "inc", "cap",
  "eur", "usd", "gbp", "chf", "eurh", "usdh", "hedged", "h", "the", "de", "del", "la", "el", "and", "y", "sa", "plc",
  "portfolio", "shares", "units", "a", "b", "c", "d", "e", "i", "p", "r", "z", "n", "x", "accumulation", "distribution",
  "acumulacion", "distribucion", "retail", "institutional", "ucits", "etf", "ii", "iii", "iv", "lux", "es", "ie", "lu"
]);

function nameTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !NAME_STOPWORDS.has(token))
  );
}

/** Cierto cuando el nombre del fichero y el de la maestra no comparten ni un
 *  término significativo: la forma barata de cazar un ISIN equivocado. */
export function nameLooksDifferent(fileName: string, masterName: string): boolean {
  const left = nameTokens(fileName);
  const right = nameTokens(masterName);
  if (left.size === 0 || right.size === 0) return false;
  for (const token of left) {
    for (const other of right) {
      if (token === other || (token.length >= 5 && other.startsWith(token.slice(0, 5)))) return false;
    }
  }
  return true;
}

function sameText(left?: string, right?: string): boolean {
  return (left ?? "").trim() === (right ?? "").trim();
}

export function buildCommercialRetroPreview(
  entries: CommercialRetroImportEntry[],
  existingByIsin: Map<string, CommercialRetroRecord>,
  options: CommercialRetroPreviewOptions = {}
): CommercialRetroImportPreviewRow[] {
  const rows: CommercialRetroImportPreviewRow[] = entries.map((entry) => {
    const existing = existingByIsin.get(entry.isin);
    const masterName = options.masterNames?.get(entry.isin);
    const warnings: string[] = [];
    if (options.existingAssetIds && !options.existingAssetIds.has(entry.isin)) {
      return { entry, existing, action: "OUT_OF_MASTER", changes: [], warnings, master_name: masterName };
    }
    if (entry.name && masterName && nameLooksDifferent(entry.name, masterName)) {
      warnings.push("El nombre del fichero no se parece al del catálogo.");
    }
    if (entry.retro_pct === 0) {
      warnings.push("Retrocesión 0.");
    }
    if (entry.duplicated_lines?.length) {
      warnings.push(`Repetido en el fichero (líneas ${entry.duplicated_lines.join(", ")}) con el mismo valor.`);
    }
    if (!existing) {
      return { entry, action: "CREATE", changes: ["nuevo"], warnings, master_name: masterName };
    }

    // Solo el valor y la nota deciden si hay cambio: la fecha de vigencia
    // acompaña al valor («vigente desde»), así que recargar cada mes el mismo
    // fichero no reescribe la tabla entera ni tapa lo que de verdad cambió.
    const changes: string[] = [];
    if (Math.abs(existing.retro_pct - entry.retro_pct) > 0.000001) {
      changes.push(`retro_pct ${existing.retro_pct} -> ${entry.retro_pct}`);
    }
    if (!sameText(existing.note, entry.note)) {
      changes.push("nota");
    }
    // Una fila pendiente de confirmar no está vigente (no cuenta en costes ni en
    // informes): si el fichero trae su porcentaje, la importación la confirma
    // aunque el valor coincida. Si se quedara en UNCHANGED, nunca se confirmaría.
    if (existing.status === "PENDING_CONFIRMATION") {
      changes.push("confirmar (pendiente)");
    }
    if (changes.length > 0 && existing.as_of_date !== entry.as_of_date) {
      changes.push(`as_of_date ${existing.as_of_date} -> ${entry.as_of_date}`);
    }

    return {
      entry,
      existing,
      action: changes.length > 0 ? "UPDATE" : "UNCHANGED",
      changes,
      warnings,
      master_name: masterName
    };
  });

  if (options.replaceAll) {
    const inFile = new Set(entries.map((entry) => entry.isin));
    [...existingByIsin.values()]
      .filter((record) => !inFile.has(record.isin))
      .sort((left, right) => left.isin.localeCompare(right.isin))
      .forEach((record) => {
        rows.push({
          entry: { isin: record.isin, retro_pct: record.retro_pct, as_of_date: record.as_of_date, note: record.note, line_number: 0 },
          existing: record,
          action: "DELETE",
          changes: ["no está en el fichero"],
          warnings: [],
          master_name: options.masterNames?.get(record.isin)
        });
      });
  }
  return rows;
}

export function summarizeCommercialRetroPreview(rows: CommercialRetroImportPreviewRow[]): CommercialRetroPreviewCounts {
  const counts: CommercialRetroPreviewCounts = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, DELETE: 0, OUT_OF_MASTER: 0 };
  rows.forEach((row) => {
    counts[row.action] += 1;
  });
  return counts;
}

export const COMMERCIAL_RETRO_WRITE_ACTIONS: ReadonlySet<CommercialRetroImportAction> = new Set(["CREATE", "UPDATE", "DELETE"]);

export function countCommercialRetroWrites(rows: CommercialRetroImportPreviewRow[]): number {
  return rows.filter((row) => COMMERCIAL_RETRO_WRITE_ACTIONS.has(row.action)).length;
}

/* ------------------------------------------------------------------------ */
/* Exportación                                                               */
/* ------------------------------------------------------------------------ */

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* Se queda con su propio formato: es una celda del CSV de retrocesiones, que se vuelve a importar y abre una hoja de
   cálculo en español (coma decimal, sin punto de millar ni espacio duro). No es texto de pantalla. */
function formatEuropeanNumber(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(value);
}

export function exportCommercialRetroCsv(records: CommercialRetroRecord[]): string {
  const lines = ["isin;retro_pct"];
  [...records]
    .filter((record) => record.status !== "PENDING_CONFIRMATION")
    .sort((a, b) => a.isin.localeCompare(b.isin))
    .forEach((record) => {
      lines.push([
        csvCell(record.isin),
        csvCell(formatEuropeanNumber(record.retro_pct))
      ].join(";"));
    });
  return `${lines.join("\n")}\n`;
}

/** Vista previa descargable, con la acción decidida por fila. */
export function exportCommercialRetroPreviewCsv(rows: CommercialRetroImportPreviewRow[]): string {
  const lines = ["accion;isin;nombre_fichero;nombre_maestra;retro_nueva_pct;retro_actual_pct;vigente_desde;avisos"];
  rows.forEach((row) => {
    lines.push([
      row.action,
      row.entry.isin,
      row.entry.name ?? "",
      row.master_name ?? "",
      formatEuropeanNumber(row.entry.retro_pct),
      row.existing ? formatEuropeanNumber(row.existing.retro_pct) : "",
      row.entry.as_of_date,
      [...row.changes, ...(row.warnings ?? [])].join(" · ")
    ].map(csvCell).join(";"));
  });
  return `${lines.join("\n")}\n`;
}
