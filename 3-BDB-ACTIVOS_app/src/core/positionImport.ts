import {
  classifyPositionId,
  groupWithNames,
  headerLanguage,
  isAmountHeader,
  isEuroAmountHeader,
  isNonAmountHeader,
  isNonEuroAreaIsin,
  isRecognizableHeaderRow,
  newIssues,
  nonEuroIsinReason,
  normHeader,
  pushRepeatedWarnings,
  pushRowWarnings,
  readBrokerExport,
  resolveRepeatedIds,
  TOTAL_LABEL_RE,
  type BrokerExportRead
} from "./brokerPortfolioImport";
import { describeMentions, foreignCurrenciesIn, mentionsIn, saysEuro, type CurrencyMention } from "./currencyMentions";
import { isSheetMarkerLine, splitDelimitedLine, splitSheetBlocks } from "./delimitedText";
import { currencyOf, decideColumnStyle, eurAmountOf, readAmountCell, type NumberStyle } from "./eurAmount";
import {
  addAmountColumn,
  addCurrencyCriterion,
  addDiscarded,
  emptyImportSummary,
  INCLUDE_UNPROVEN_KEY,
  INCLUDE_UNPROVEN_YES,
  type EuroConfirmation,
  type ImportChoiceValues,
  type ImportSummary
} from "./importSummary";

export interface PositionImportEntry {
  id: string;
  amount: number;
}

/** Posiciones leídas, avisos de lo que no se ha podido leer (nada se pierde en
    silencio) y el resumen de la importación. */
export interface PositionImportResult {
  entries: PositionImportEntry[];
  warnings: string[];
  /** Lo que el asesor tiene que confirmar antes de usar nada: cada posición con
      su nombre y su importe (séptima pasada: siempre que haya posiciones). */
  euroConfirmation: EuroConfirmation | null;
  summary: ImportSummary;
}

/**
 * Importe de una lista de posiciones con el analizador único (quinta pasada,
 * R4-05): «1.000 €» o «EUR 1.000» valen; «8.736,00 USD», «40 %» o un texto
 * con letras no son un importe en EUR. Una cifra suelta se lee con el formato
 * de la pantalla («20.000» son veinte mil; «80,000» es ambigua y no vale).
 */
export function parsePositionAmount(raw: string): number {
  const amount = eurAmountOf(readAmountCell(raw), { style: null, language: "es" });
  return amount.ok ? amount.value : Number.NaN;
}

function lineTokens(line: string): string[] {
  // Auditoría 11-08 (N2): el formato natural «ISIN importe» (separado por
  // espacios) también se acepta. N3-04: los separadores respetan las comillas.
  // M5 (revisión 5): también la barra «|».
  let tokens: string[];
  if (line.includes(";")) {
    tokens = splitDelimitedLine(line, ";");
  } else if (line.includes("\t")) {
    tokens = splitDelimitedLine(line, "\t");
  } else if (line.includes("|")) {
    tokens = splitDelimitedLine(line, "|");
  } else {
    const spaceTokens = line.split(/\s+/).filter(Boolean);
    const lastSpaceToken = spaceTokens[spaceTokens.length - 1] ?? "";
    tokens =
      spaceTokens.length >= 2 && readAmountCell(lastSpaceToken).kind === "number"
        ? spaceTokens.map((token) => token.replace(/[,;]+$/, ""))
        : splitDelimitedLine(line, ",");
  }
  // Los campos vacíos se conservan (un total «;;200000» no tiene identificador),
  // salvo los del final de la línea.
  while (tokens.length > 0 && tokens[tokens.length - 1].trim() === "") tokens.pop();
  return tokens.map((token) => token.trim());
}

function splitLines(text: string): string[] {
  // R4-09: CR, LF y CRLF (un CSV de Excel para Mac solo lleva CR). Las líneas
  // «## Hoja: …» de un libro no son posiciones.
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isSheetMarkerLine(line));
}

interface ListOptions {
  /** Idioma de los números cuando ninguna cifra de la lista lo decide. */
  language: NumberStyle;
  /** Cabecera de la columna de importe, si la lista la tiene («Activo;Importe»). */
  amountHeader?: string;
  /** El asesor ha marcado la segunda casilla: las líneas sin prueba de EUR entran, marcadas (I5 de la revisión 8). */
  includeUnproven?: boolean;
  /** Menciones de otra divisa de fuera de la lista (lo oculto y las notas de un libro). */
  outsideMentions?: CurrencyMention[];
}

interface ListCandidate extends PositionImportEntry {
  name?: string;
  /** La línea (o la cabecera) dice que el importe está en euros. */
  eurStated: boolean;
  /** Lo que dice el nombre sobre otra divisa («el nombre dice USD»), para la lista de confirmación. */
  notes: string[];
  /** La primera divisa que menciona su nombre (si no dice EUR). */
  ownMention: string | null;
  totalLabel: boolean;
  summaryTable: boolean;
  unproven?: string;
}

/**
 * Lista línea a línea con el formato que pide la pantalla: «ISIN o id; nombre
 * opcional; importe €». Solo se acepta una línea con identificador e importe,
 * y como mucho un nombre (no una cifra) entre los dos (N3-02); si en medio va
 * una divisa, solo vale EUR (R4-06). Las mismas reglas que el lector: un
 * código que no es ISIN entra con aviso, una palabra suelta en mayúsculas
 * (PATRIMONIO, CARTERA) o un total no son posiciones (R4-08), el formato
 * numérico se decide por el conjunto de importes (R4-04, I3), un indicio de
 * otra divisa en el nombre —también en minúsculas o en palabras— deja la línea
 * fuera (B7), un identificador repetido con un posible total no entra (B5) y,
 * séptima pasada, quedan fuera también la línea sin «€» cuando las demás lo
 * dicen y el ISIN de fuera de la zona euro sin ninguna divisa. Octava pasada:
 * la misma regla global de divisa que el lector (si la lista menciona otra
 * divisa en cualquier línea, solo entran las líneas que dicen EUR), para que
 * leer un fichero y tocar el cuadro den lo mismo (I6). Lo que queda se
 * confirma siempre.
 */
function parseList(lines: string[], options: ListOptions): PositionImportResult {
  const candidates: ListCandidate[] = [];
  const issues = newIssues();
  const malformed: string[] = [];
  const summary = emptyImportSummary("lista");
  const rows = lines.map((line) => ({ line, tokens: lineTokens(line) })).filter(({ tokens }) => tokens.length > 0);
  const decided = decideColumnStyle(rows.map(({ tokens }) => readAmountCell(tokens[tokens.length - 1])));
  const context = {
    style: decided.style,
    language: decided.conflict ? null : options.language,
    maxDecimals: decided.maxDecimals
  };
  const headerSaysEur = options.amountHeader !== undefined && isEuroAmountHeader(options.amountHeader);
  // Regla de divisa (I5 de la revisión 8): la mención del nombre de una línea vale para esa línea; la de
  // cualquier otra línea (un título, una nota, un total), para toda la lista.
  const mentions: CurrencyMention[] = [...(options.outsideMentions ?? [])];
  const noteLine = (line: string) => mentions.push(...mentionsIn(line, "note", "la lista"));

  for (const { line, tokens } of rows) {
    const [rawId] = tokens;
    if (TOTAL_LABEL_RE.test(rawId)) {
      issues.totals.push(rawId);
      noteLine(line);
      continue;
    }
    const middle = tokens.length === 3 ? tokens[1] : null;
    const middleCurrency = middle !== null ? currencyOf(middle) : null;
    const middleIsNumber = middle !== null && !middleCurrency && readAmountCell(middle).kind !== "invalid";
    const kind = classifyPositionId(rawId, { list: true });
    if (kind === "none" || (tokens.length !== 2 && tokens.length !== 3) || middleIsNumber) {
      malformed.push(line.length > 60 ? `${line.slice(0, 60)}…` : line);
      noteLine(line);
      continue;
    }
    if (kind === "word") {
      issues.notPositions.push(rawId);
      noteLine(line);
      continue;
    }
    const id = kind === "isin" ? rawId.toUpperCase() : rawId;
    const cell = readAmountCell(tokens[tokens.length - 1]);
    if (cell.kind === "foreign") {
      // Una cifra en otra divisa vale para toda la lista (como el formato de una celda en un extracto).
      issues.otherCurrency.push(`${id} (${cell.raw})`);
      mentions.push(...mentionsIn(cell.raw, "cell", "una cifra de la lista"));
      continue;
    }
    if (cell.kind === "percent") {
      issues.percent.push(`${id} («${cell.raw}»)`);
      continue;
    }
    if (middleCurrency && middleCurrency !== "EUR") {
      issues.otherCurrency.push(`${id} (${middleCurrency})`);
      continue;
    }
    const signals = [kind === "code" ? rawId : "", middle !== null && !middleCurrency ? middle : ""]
      .filter((text) => !saysEuro(text))
      .flatMap((text) => foreignCurrenciesIn(text, "cell"));
    const amount = eurAmountOf(cell, context);
    if (!amount.ok) {
      if (amount.reason === "ambiguous") issues.ambiguous.push(`${id} («${amount.raw}»)`);
      else if (amount.reason === "negative") issues.negative.push(id);
      else issues.unreadable.push(id);
      continue;
    }
    const name = middle !== null && !middleCurrency ? middle : undefined;
    const eurStated = amount.explicitEur || middleCurrency === "EUR" || headerSaysEur;
    const notes = signals.length > 0 ? [`el nombre dice ${[...new Set(signals)].join(", ")}`] : [];
    candidates.push({ id, amount: amount.value, ...(name ? { name } : {}), eurStated, notes, ownMention: signals[0] ?? null, totalLabel: false, summaryTable: false });
  }

  // Sin prueba de EUR en la línea: fuera, con un aviso que la nombra, si su nombre o la lista mencionan
  // otra divisa (regla de divisa), si las demás líneas dicen «€» y esta no (I2), o si el ISIN es de fuera
  // del euro (W51, I8). Las de la regla de divisa y las del ISIN entran con la segunda casilla (I5).
  const anyStated = candidates.some((row) => row.eurStated);
  const listMention = mentions[0] ?? null;
  const unproven: ListCandidate[] = [];
  const listed = candidates.filter((row) => {
    if (row.eurStated) return true;
    let soft: { reason: string; list: string[] } | null = null;
    if (row.ownMention || listMention) {
      soft = {
        reason: row.ownMention ? `${row.ownMention} en el nombre` : `la lista menciona ${listMention!.currency}`,
        list: issues.foreignInFile
      };
    } else if (anyStated) {
      issues.otherCurrency.push(`${row.id} (las demás líneas dicen «€» y esta no)`);
      return false;
    } else if (isNonEuroAreaIsin(row.id)) {
      soft = { reason: nonEuroIsinReason(row.id), list: issues.unprovenIsin };
    }
    if (!soft) return true;
    if (!options.includeUnproven) {
      soft.list.push(`${row.id} (${soft.reason})`);
      unproven.push({ ...row, notes: [soft.reason] });
      return false;
    }
    issues.includedUnproven.push(row.id);
    row.notes = [...row.notes, `incluida a mano: ${soft.reason}`];
    row.unproven = soft.reason;
    return true;
  });
  for (const row of listed) if (classifyPositionId(row.id, { list: true }) === "code") issues.codesImported.push(row.id);

  const { kept, refused, summed } = resolveRepeatedIds(listed);
  const entries = kept.map(({ id, amount }) => ({ id, amount }));
  summary.positions = entries.length;
  summary.totalEur = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const euroConfirmation: EuroConfirmation | null = kept.length > 0 ? { positions: groupWithNames(kept), reason: "" } : null;

  const warnings: string[] = [];
  if (options.amountHeader && entries.length > 0) addAmountColumn(summary, options.amountHeader);
  if (kept.some((row) => row.eurStated)) {
    addCurrencyCriterion(summary, headerSaysEur ? `la cabecera «${options.amountHeader}» dice EUR` : "«€» o «EUR» en la línea");
  }
  if (kept.some((row) => !row.eurStated)) {
    addCurrencyCriterion(
      summary,
      options.amountHeader
        ? `la columna «${options.amountHeader}» no dice su divisa y la lista no menciona ninguna otra divisa`
        : "la lista no dice en qué divisa están los importes y no menciona ninguna otra divisa"
    );
  }
  summary.mentions = mentions.length > 0 ? describeMentions(mentions) : null;
  summary.mentionScope = mentions.length > 0 ? "file" : null;
  const included = kept.filter((row) => row.unproven !== undefined);
  summary.unproven =
    included.length > 0
      ? { positions: groupWithNames(included.map((row) => ({ ...row, eurStated: false, notes: [row.unproven!] }))), included: true }
      : unproven.length > 0
        ? { positions: groupWithNames(unproven.map((row) => ({ ...row, eurStated: false }))), included: false }
        : null;
  if (euroConfirmation) euroConfirmation.reason = summary.currency.join("; ");
  summary.euroConfirmation = euroConfirmation;
  if (malformed.length > 0) {
    const n = malformed.length;
    warnings.push(
      `${n === 1 ? "1 línea no sigue" : `${n} líneas no siguen`} el formato «ISIN o id; nombre opcional; importe €» ` +
        `(${[...new Set(malformed)].map((text) => `«${text}»`).join(", ")}): no se ${n === 1 ? "importa" : "importan"}.`
    );
    addDiscarded(summary, "fuera del formato de lista", malformed);
  }
  pushRowWarnings(warnings, issues, summary, listMention);
  pushRepeatedWarnings(warnings, summary, refused, summed);
  summary.distinct = new Set(entries.map((entry) => entry.id.toUpperCase())).size;
  return { entries, warnings, euroConfirmation, summary };
}

function fromReader(read: BrokerExportRead, text: string): PositionImportResult {
  const warnings = [...read.warnings];
  if (!read.recognized && !read.unclosedQuote) {
    // Si hay ISIN sueltos en el texto (dentro de otra celda), se nombran.
    const loose = [...new Set(text.toUpperCase().match(/(?<![A-Z0-9])[A-Z]{2}[A-Z0-9]{9}[0-9](?![A-Z0-9])/g) ?? [])];
    warnings.push(
      "No se encuentra ninguna columna de ISIN en la tabla: no se importa ninguna posición" +
        (loose.length > 0 ? ` (hay ISIN dentro de otras celdas: ${loose.join(", ")}).` : ".")
    );
  }
  return { entries: read.positions, warnings, euroConfirmation: read.euroConfirmation, summary: read.summary };
}

/**
 * Posiciones de un texto pegado o de un fichero (Posiciones globales).
 *
 * R4-06 (quinta pasada): si hay una cabecera reconocible en CUALQUIER fila se
 * usa SIEMPRE el lector de extractos, que elige la columna de importe por su
 * cabecera; una primera línea «;;» o un título de una palabra en A1 ya no
 * mandan la tabla a la lectura línea a línea. La lista queda para los textos
 * sin cabecera con el formato de la pantalla, y para «id;importe» de dos
 * columnas sin ningún ISIN. Una línea sin identificador válido nunca es una
 * posición.
 */
export function parsePositionImport(text: string, choices: ImportChoiceValues = {}): PositionImportResult {
  const read = readBrokerExport(text, choices);
  if (read.html || read.unclosedQuote || read.sheets > 1 || (read.recognized && read.headerFound)) return fromReader(read, text);

  // Lo oculto y las notas de un libro no son líneas de la lista, pero una divisa que nombren cuenta (I1).
  const blocks = splitSheetBlocks(text);
  const lines = blocks.filter((block) => block.hidden === null).flatMap((block) => splitLines(block.text));
  const outsideMentions = blocks
    .filter((block) => block.hidden !== null)
    .flatMap((block) => [
      ...(block.sheet ? mentionsIn(block.sheet, "title", "el nombre de una hoja") : []),
      ...splitLines(block.text).flatMap((line) => mentionsIn(line, "note", "lo oculto o las notas del libro"))
    ]);
  const includeUnproven = choices[INCLUDE_UNPROVEN_KEY] === INCLUDE_UNPROVEN_YES;
  if (lines.length === 0) return { entries: [], warnings: [], euroConfirmation: null, summary: emptyImportSummary("lista") };
  if (!read.headerFound) return parseList(lines, { language: "es", includeUnproven, outsideMentions });

  // Cabecera sin ninguna columna de ISIN: solo «id;importe» de dos columnas.
  const headerIndex = lines.findIndex((line) => isRecognizableHeaderRow(lineTokens(line)));
  const header = lineTokens(lines[headerIndex]);
  const rest = lines.slice(headerIndex + 1);
  if (header.length === 2 && isAmountHeader(header[1])) {
    return parseList(rest, { language: headerLanguage(normHeader(header[1])) ?? "es", amountHeader: header[1], includeUnproven, outsideMentions });
  }
  const summary = emptyImportSummary("extracto");
  if (header.length >= 2 && isNonAmountHeader(header[header.length - 1])) {
    return {
      entries: [],
      warnings: [
        `La última columna («${header[header.length - 1]}») es un precio, una cantidad, un coste o un peso, no un importe: no se importa ninguna posición.`
      ],
      euroConfirmation: null,
      summary
    };
  }
  return {
    entries: [],
    warnings: [
      "No se encuentra ninguna columna de ISIN reconocible: no se importa ninguna posición. " +
        "Usa una cabecera «ISIN;Importe» o el formato «ISIN o id; nombre opcional; importe €» sin cabecera."
    ],
    euroConfirmation: null,
    summary
  };
}

export function parsePositionLines(text: string): PositionImportEntry[] {
  return parsePositionImport(text).entries;
}
