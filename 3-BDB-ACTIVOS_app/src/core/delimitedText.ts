/**
 * Lector ÚNICO de texto delimitado (CSV/TSV) para las importaciones de
 * posiciones (N3-04, revisión del 17-10-2026).
 *
 * Respeta las comillas como RFC 4180: el separador y los saltos de línea
 * dentro de un campo entre comillas son parte del campo, y `""` es una
 * comilla. Antes se partía por el separador sin mirar las comillas: en un CSV
 * en inglés, `"80,000.00"` se convertía en dos campos y el importe salía de
 * otra columna (80 y 7 en vez de 80.000 y 7.512,09), sin aviso.
 *
 * El separador se elige por prioridad entre los que aparecen FUERA de
 * comillas en todo el texto: el tabulador, luego el «;», luego la barra «|»
 * (sexta pasada, M5) y luego la «,» (una línea de título sin separadores no
 * decide). La detección abre y cierra las
 * comillas con la misma regla que el lector (R4-14): una comilla solo abre un
 * campo al principio de este.
 */

export type Separator = "\t" | ";" | "|" | ",";

export interface DelimitedText {
  rows: string[][];
  separator: Separator;
  /** Quedó una comilla sin cerrar que se tragaría un separador o un salto de
      línea: el resto del texto se habría leído como un campo. */
  unclosedQuote: boolean;
}

interface ScanHandlers {
  onSeparatorCandidate?: (char: string) => void;
}

/** Recorre el texto con las reglas de comillas del lector. */
function scanOutsideQuotes(text: string, handlers: ScanHandlers): void {
  let inQuotes = false;
  let fieldStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') index += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (char === "\t" || char === ";" || char === "|" || char === ",") {
      handlers.onSeparatorCandidate?.(char);
      fieldStart = true;
    } else if (char === "\n" || char === "\r") {
      fieldStart = true;
    } else if (char.trim().length > 0) {
      fieldStart = false;
    }
  }
}

export function detectSeparator(text: string): Separator {
  const seen = { "\t": false, ";": false, "|": false, ",": false };
  scanOutsideQuotes(text, {
    onSeparatorCandidate: (char) => {
      seen[char as Separator] = true;
    }
  });
  return seen["\t"] ? "\t" : seen[";"] ? ";" : seen["|"] ? "|" : ",";
}

/**
 * Registros del texto, con los campos recortados y sin las líneas en blanco.
 * Una fila de solo separadores («;;;») se conserva. Una comilla sin cerrar en
 * el último campo, sin separadores ni saltos dentro, se da por cerrada al
 * final del texto (R4-15); si se traga un separador o un salto, `unclosedQuote`.
 */
export function parseDelimitedText(text: string, separator: Separator = detectSeparator(text)): DelimitedText {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowHasContent = false;

  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    if (rowHasContent) rows.push(row);
    row = [];
    rowHasContent = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.trim().length === 0) {
      // Comilla de apertura (con espacios delante, se descartan).
      field = "";
      inQuotes = true;
      rowHasContent = true;
    } else if (char === separator) {
      endField();
      rowHasContent = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      endRow();
    } else {
      // Tras una comilla de cierre, el texto suelto se añade al campo.
      if (char.trim().length > 0) rowHasContent = true;
      field += char;
    }
  }
  const unclosedQuote = inQuotes && (field.includes(separator) || /[\r\n]/.test(field));
  if (rowHasContent || field.trim().length > 0) endRow();
  return { rows, separator, unclosedQuote };
}

/** Una sola línea partida por `separator`, respetando las comillas. */
export function splitDelimitedLine(line: string, separator: Separator): string[] {
  return parseDelimitedText(line, separator).rows[0] ?? [];
}

/* ─── Hojas de un libro ─────────────────────────────────────────────────── */

/** Línea que separa las hojas de un libro convertido a texto (R4-10). Octava
    pasada (I1 de la revisión 7): también las hojas ocultas y las filas ocultas
    de una hoja, que van aparte para que el lector las nombre y no las lea. */
const SHEET_MARKER_RE = /^## (Hoja|Hoja oculta|Filas ocultas|Hoja vacía|Notas del libro): (.+)$/;

function markerName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim() || "sin nombre";
}

export function sheetMarkerLine(name: string): string {
  return `## Hoja: ${markerName(name)}`;
}

export function hiddenSheetMarkerLine(name: string): string {
  return `## Hoja oculta: ${markerName(name)}`;
}

export function hiddenRowsMarkerLine(name: string): string {
  return `## Filas ocultas: ${markerName(name)}`;
}

/** Novena pasada (I1 de la revisión 8): una hoja sin datos también tiene nombre, y el nombre puede decir «USD». */
export function emptySheetMarkerLine(name: string): string {
  return `## Hoja vacía: ${markerName(name)}`;
}

/** Lo que el libro dice fuera de las celdas (comentarios, propiedades): no se lee como posiciones; sí cuenta para la divisa. */
export function workbookNotesMarkerLine(what: string): string {
  return `## Notas del libro: ${markerName(what)}`;
}

export function isSheetMarkerLine(line: string): boolean {
  return SHEET_MARKER_RE.test(line.trim());
}

export interface TextBlock {
  /** Nombre de la hoja; `null` si el texto no viene de un libro con varias hojas. */
  sheet: string | null;
  /** «sheet»: una hoja oculta · «rows»: las filas ocultas de la hoja `sheet` · «empty»: una hoja sin datos ·
      «notes»: comentarios o propiedades del libro (`sheet` dice cuáles) · `null`: lo visible. */
  hidden: "sheet" | "rows" | "empty" | "notes" | null;
  text: string;
}

/** Parte el texto por las líneas de hoja; sin ellas, un único bloque con el texto tal cual. */
export function splitSheetBlocks(text: string): TextBlock[] {
  if (!/^## (?:Hoja|Hoja oculta|Filas ocultas|Hoja vacía|Notas del libro): /m.test(text)) return [{ sheet: null, hidden: null, text }];
  const blocks: TextBlock[] = [];
  let current: TextBlock = { sheet: null, hidden: null, text: "" };
  const lines: string[] = [];
  const flush = () => {
    current.text = lines.join("\n");
    if (current.sheet !== null || current.text.trim().length > 0) blocks.push(current);
    lines.length = 0;
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    const marker = SHEET_MARKER_RE.exec(line.trim());
    if (marker) {
      flush();
      const hidden =
        marker[1] === "Hoja oculta" ? "sheet" : marker[1] === "Filas ocultas" ? "rows" : marker[1] === "Hoja vacía" ? "empty" : marker[1] === "Notas del libro" ? "notes" : null;
      current = { sheet: marker[2].trim(), hidden, text: "" };
    } else {
      lines.push(line);
    }
  }
  flush();
  return blocks;
}
