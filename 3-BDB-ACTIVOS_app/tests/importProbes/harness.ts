// Arnés de las sondas del importador (octava pasada de la auditoría del
// 16-10-2026). Juez ESTRICTO: un aviso solo cuenta si nombra la fila (el ISIN
// o el identificador); un aviso global no cuenta para una posición concreta.
// Usa el código real por tres caminos, como la revisión 7:
// - pegar: Posiciones globales con el texto (o el libro leído) del caso;
// - fichero: el fichero real por readPositionImportFileText (un .xlsx real, un
//   .xls HTML en windows-1252, un .csv en utf-8, o los bytes del caso);
// - Constructor: buildLocalPortfolioImport con el contenido del fichero.
//
// La confirmación es SIEMPRE, así que se juzga lo que el resumen ENSEÑA para
// confirmar: tiene que ser el importe correcto, o la fila tiene que quedar
// fuera con un aviso que la nombre. Con una ELECCIÓN pendiente (columna de
// importe, titular o fecha), no se puede confirmar sin elegir: el caso es bueno
// solo si alguna opción de la lista da un resultado sin ✘ («⇄» delante).
//
// Novena pasada (I5): la INCLUSIÓN EXPLÍCITA. Lo que la regla de divisa deja
// fuera sin prueba de EUR se lista aparte y solo entra con la segunda casilla.
// El veredicto de cada camino es SIN la casilla (esas filas no se usan). Con
// ella (`incl`), el resumen tiene que enseñarlas con su importe y marcadas: las
// que tienen un importe en EUR conocido, con ese importe («✔i»); las que no, con
// la marca «incluida a mano», porque las ha incluido el asesor tras verlas
// fuera y con su motivo. Si no, «✘i».
import * as XLSX from "xlsx";
import { readPositionImportFileText } from "../../src/core/importFileReader";
import {
  INCLUDE_UNPROVEN_KEY,
  INCLUDE_UNPROVEN_YES,
  NONE_CHOICE,
  pendingChoices,
  type ImportChoice,
  type ImportChoiceValues,
  type ImportedPosition
} from "../../src/core/importSummary";
import { buildLocalPortfolioImport } from "../../src/core/portfolioImport";
import { parsePositionImport } from "../../src/core/positionImport";
import type { BdbAssetDetail } from "../../src/types/bdbAssets";

export type Truth = Record<string, number | null>;
export interface SheetDef {
  name: string;
  rows: unknown[][];
  fmt?: Record<string, string>;
  cells?: Record<string, Record<string, unknown>>;
  merges?: string[];
  hidden?: boolean;
  hiddenRows?: number[];
  /** Columnas ocultas (revisión 8). */
  hiddenCols?: number[];
  /** Comentarios de celda por dirección («C1»: «Importes en USD»), revisión 8. */
  comments?: Record<string, string>;
}
export interface ProbeCase {
  id: string;
  group?: string;
  tema: string;
  text?: string;
  /** Texto para «pegar» si no es `text` (los casos de bytes de la revisión 8). */
  pasteText?: string;
  sheets?: SheetDef[];
  /** Propiedades del libro (Título, Asunto…), revisión 8. */
  props?: Record<string, string>;
  /** Nombre y bytes del fichero, si no son los de por defecto (W46, W47). */
  fileName?: string;
  fileBytes?: Uint8Array;
  truth: Truth;
  alias?: Record<string, number>;
  /** Resultados alternativos aceptables SI las filas que difieren se avisan por su nombre. */
  alt?: Truth[];
  nota?: string;
  /** Ids que la maestra no resuelve (Constructor: MISSING_ASSET). */
  rejectIds?: string[];
  esperado?: string;
  /** Revisión 8: el fallo dependía de un criterio discutible (se dice cuál). */
  gris?: string;
  /** Revisión 8: la clase residual aceptada. */
  residual?: boolean;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsxBuffer(sheets: SheetDef[], props?: Record<string, string>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const def of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(def.rows, { cellDates: true });
    for (const [addr, z] of Object.entries(def.fmt ?? {})) if (ws[addr]) (ws[addr] as { z?: string }).z = z;
    for (const [addr, cell] of Object.entries(def.cells ?? {})) ws[addr] = cell as XLSX.CellObject;
    for (const [addr, text] of Object.entries(def.comments ?? {})) {
      if (!ws[addr]) ws[addr] = { t: "s", v: "" } as XLSX.CellObject;
      (ws[addr] as XLSX.CellObject).c = [{ a: "Banco", t: text }] as XLSX.Comments;
    }
    if (def.merges) ws["!merges"] = def.merges.map((m) => XLSX.utils.decode_range(m));
    if (def.hiddenRows) ws["!rows"] = def.rows.map((_, i) => (def.hiddenRows!.includes(i) ? { hidden: true } : {}));
    if (def.hiddenCols) ws["!cols"] = Array.from({ length: 12 }, (_, i) => (def.hiddenCols!.includes(i) ? { hidden: true } : {}));
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  if (sheets.some((sheet) => sheet.hidden)) {
    wb.Workbook = wb.Workbook ?? {};
    wb.Workbook.Sheets = sheets.map((sheet) => ({ name: sheet.name, Hidden: sheet.hidden ? 1 : 0 })) as never;
  }
  if (props) wb.Props = props as XLSX.FullProperties;
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b,
  "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99,
  "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f
};

/** Texto -> bytes windows-1252 (lo que no cabe, como entidad HTML). */
function cp1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else for (const b of `&#${code};`) out.push(b.charCodeAt(0));
  }
  return new Uint8Array(out);
}

/** El fichero que subiría el asesor: un .xlsx real, un .xls HTML en windows-1252 (Andbank) o un .csv en utf-8. */
export function fileOf(c: ProbeCase): File {
  if (c.sheets) return new File([xlsxBuffer(c.sheets, c.props)], c.fileName ?? "extracto.xlsx", { type: XLSX_MIME });
  if (c.fileBytes) return new File([c.fileBytes as BlobPart], c.fileName ?? "extracto.csv");
  const text = c.text ?? "";
  if (/<t(?:able|r)[\s>]/i.test(text)) return new File([cp1252(text) as BlobPart], c.fileName ?? "extracto.xls");
  return new File([text], c.fileName ?? "extracto.csv", { type: "text/csv" });
}

/** Texto para «pegar»: el del caso o el de leer su libro. */
export async function textOf(c: ProbeCase): Promise<string> {
  if (c.pasteText !== undefined) return c.pasteText;
  if (!c.sheets) return c.text ?? "";
  return readPositionImportFileText(new File([xlsxBuffer(c.sheets, c.props)], "extracto.xlsx", { type: XLSX_MIME }));
}

export type Verdict = string;

const squash = (s: string) => s.toUpperCase().replace(/[\s\u200b\u00a0]+/g, "");

export function named(id: string, warnings: string[]): boolean {
  const key = squash(id);
  return warnings.some((w) => squash(w).includes(key));
}

export interface Judged {
  v: Verdict;
  wrong: string[];
  missing: string[];
  unnamedMissing: string[];
}

function normId(id: string): string {
  return /^[a-z]{2}[a-z0-9]{9}\d$/i.test(id) ? id.toUpperCase() : id;
}

function sumById(entries: Array<{ id: string; amount: number }>): Map<string, number> {
  const got = new Map<string, number>();
  for (const e of entries) got.set(normId(e.id), (got.get(normId(e.id)) ?? 0) + e.amount);
  return got;
}

function judgeOnce(truth: Truth, alias: Record<string, number> | undefined, got: Map<string, number>, warnings: string[]): Judged {
  const wrong: string[] = [];
  for (const [id, amount] of got) {
    const expected = Object.prototype.hasOwnProperty.call(truth, id) ? truth[id] : alias?.[id];
    // Sin excusa por «pendiente»: lo que se enseña para confirmar tiene que ser el importe en EUR.
    if (expected === undefined || expected === null || Math.abs(expected - amount) > 0.01) wrong.push(id);
  }
  const aliasHit = (id: string) => Object.keys(alias ?? {}).some((a) => got.has(a) && alias![a] === truth[id]);
  const missing = Object.keys(truth).filter((id) => !got.has(normId(id)) && !aliasHit(id));
  const unnamedMissing = missing.filter((id) => !named(id, warnings));
  let v: Verdict;
  if (wrong.length > 0) v = wrong.every((id) => named(id, warnings)) ? "✘⚠" : "✘";
  else if (missing.length === 0) v = "✔";
  else if (got.size === 0) v = unnamedMissing.length === 0 ? "∅⚠" : warnings.length > 0 ? "∅⚠g" : "✘∅";
  else v = unnamedMissing.length === 0 ? "½⚠" : warnings.length > 0 ? "✘∅(aviso ajeno)" : "✘∅";
  return { v, wrong, missing, unnamedMissing };
}

export function judge(c: ProbeCase, shown: Array<{ id: string; amount: number }>, warnings: string[]): Judged {
  const got = sumById(shown);
  const main = judgeOnce(c.truth, c.alias, got, warnings);
  if ((main.v === "✘" || main.v === "✘⚠") && c.alt) {
    for (const alt of c.alt) {
      const a = judgeOnce(alt, c.alias, got, warnings);
      const differing = Object.keys({ ...c.truth, ...alt }).filter((id) => c.truth[id] !== alt[id]);
      if (a.v === "✔" && differing.every((id) => named(id, warnings))) return { ...main, v: "½⚠(alt)" };
    }
  }
  return main;
}

export const isFailing = (verdict: string) => verdict.startsWith("✘") || verdict.startsWith("⇄✘");

function activo(assetId: string): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: `Activo ${assetId}`,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  } as unknown as BdbAssetDetail;
}

/** Lo que da un camino con unas elecciones: lo enseñado para confirmar, los avisos y las elecciones. */
interface PathRun {
  shown: ImportedPosition[];
  /** Lo que se usaría tras confirmar (Posiciones globales: las entradas; Constructor: peso × capital). */
  used: Array<{ id: string; amount: number }>;
  warnings: string[];
  choices: ImportChoice[];
  mode?: "extracto" | "pesos" | "rechaza";
  /** Lo que la regla de divisa deja fuera sin prueba de EUR (o lo incluido con la segunda casilla). */
  unproven?: { positions: Array<{ id: string; amount: number; notes?: string[] }>; included: boolean } | null;
}

/**
 * Inclusión explícita (I5): sin la casilla, lo de fuera no se usa; con ella, el
 * resumen lo enseña con su importe y marcado, y lo usado es lo enseñado.
 */
async function judgeInclusion(c: ProbeCase, run: (choices: ImportChoiceValues) => Promise<PathRun>, choices: ImportChoiceValues, without: PathRun): Promise<string> {
  const left = without.unproven && !without.unproven.included ? without.unproven.positions : [];
  if (left.length === 0) return "";
  const leftIds = new Set(left.map((p) => normId(p.id)));
  if (without.used.some((p) => leftIds.has(normId(p.id)))) return "✘i (se usa sin la casilla)";
  const r = await run({ ...choices, [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES });
  const shown = sumById(r.shown);
  const before = sumById(without.shown);
  for (const position of left) {
    const id = normId(position.id);
    const got = shown.get(id);
    if (got === undefined || Math.abs(got - ((before.get(id) ?? 0) + position.amount)) > 0.02) return `✘i (${id} no se enseña con su importe)`;
    const expected = c.truth[id];
    const marked = r.shown.some((p) => normId(p.id) === id && (p.notes ?? []).some((note) => note.startsWith("incluida a mano")));
    if (!marked) return `✘i (${id} sin la marca)`;
    if (typeof expected === "number" && Math.abs(expected - got) > 0.01) return `✘i (${id} con otro importe)`;
  }
  if (r.mode === undefined || r.mode === "extracto") {
    const kept = r.mode === undefined ? r.shown : r.shown.filter((p) => !(p.notes ?? []).some((note) => /no se cargará/.test(note)));
    if (!sameMaps(sumById(r.used), sumById(kept))) return "✘i (lo usado no es lo enseñado)";
  }
  return "✔i";
}

/**
 * Veredicto de un camino. Sin elecciones pendientes, el del juez. Con alguna,
 * no se puede confirmar sin elegir (lo comprueban los tests de pantalla):
 * se prueba cada opción y el caso es bueno si alguna da un resultado sin ✘.
 * La opción «ninguna» (no importar el bloque, o ningún titular) solo vale si
 * no deja fuera ninguna posición con un importe en EUR conocido.
 */
async function judgePath(
  c: ProbeCase,
  run: (choices: ImportChoiceValues) => Promise<PathRun>,
  choices: ImportChoiceValues = {},
  depth = 0
): Promise<{ v: Verdict; last: PathRun; missingNumeric: string[]; incl: string }> {
  const r = await run(choices);
  const pending = pendingChoices(r.choices);
  if (pending.length === 0 || depth > 3) {
    const incl = await judgeInclusion(c, run, choices, r);
    if (r.mode && r.mode !== "extracto") return { v: r.mode === "pesos" ? "– (pesos)" : "– (rechaza)", last: r, missingNumeric: [], incl };
    const judged = judge(c, r.shown, r.warnings);
    return { v: judged.v, last: r, missingNumeric: judged.missing.filter((id) => typeof c.truth[id] === "number"), incl };
  }
  const choice = pending[0];
  let best: { v: Verdict; last: PathRun; missingNumeric: string[]; incl: string } | null = null;
  // Undécima pasada (b.9 de la revisión 10): la inclusión explícita se juzga en TODAS las opciones, no solo
  // en la mejor: si alguna falla, ese es el resultado; si alguna la tiene y todas aciertan, «✔i».
  const inclusions: string[] = [];
  for (const option of choice.options) {
    const inner = await judgePath(c, run, { ...choices, [choice.key]: option.value }, depth + 1);
    let v = inner.v.replace(/^⇄/, "");
    if (option.value === NONE_CHOICE && inner.missingNumeric.length > 0) v = "✘ (ninguna pierde posiciones)";
    const candidate = { v, last: inner.last, missingNumeric: inner.missingNumeric, incl: inner.incl };
    if (inner.incl) inclusions.push(inner.incl);
    if (best === null || (isFailing(best.v) && !isFailing(v))) best = candidate;
  }
  const incl = inclusions.find((value) => value !== "✔i") ?? (inclusions.length > 0 ? "✔i" : "");
  return { v: `⇄${best?.v ?? "✘"}`, last: r, missingNumeric: best?.missingNumeric ?? [], incl };
}

const fmt = (list: Array<{ id: string; amount: number }>) => list.map((e) => `${e.id}=${Math.round(e.amount * 100) / 100}`).join(" ") || "∅";

function sameMaps(a: Map<string, number>, b: Map<string, number>, tol = 0.02): boolean {
  if (a.size !== b.size) return false;
  for (const [id, v] of a) {
    const w = b.get(id);
    if (w === undefined || Math.abs(w - v) > tol) return false;
  }
  return true;
}

export interface ProbeResult {
  id: string;
  group?: string;
  tema: string;
  truth: Truth;
  /** Posiciones globales con el texto pegado. */
  gp: Verdict;
  gpShown: string;
  gpWarnings: string[];
  /** Posiciones globales con el fichero real. */
  file: Verdict;
  /** Constructor con el fichero real. */
  cons: Verdict;
  consShown: string;
  /** Sin elecciones pendientes, lo usado tras confirmar es lo enseñado (en el Constructor, menos lo que la maestra rechaza). */
  usedEqualsShown: boolean;
  /** Elecciones pendientes al importar (por camino). */
  choices: string[];
  /** Inclusión explícita (I5), por camino «pegar / fichero / Constructor»: «» si no hay nada fuera sin prueba de EUR. */
  incl: string;
}

export async function runCase(c: ProbeCase): Promise<ProbeResult> {
  const text = await textOf(c);
  const content = await readPositionImportFileText(fileOf(c));
  const gpRun = (source: string) => async (choices: ImportChoiceValues): Promise<PathRun> => {
    const r = parsePositionImport(source, choices);
    return { shown: r.euroConfirmation?.positions ?? [], used: r.entries, warnings: r.warnings, choices: r.summary.choices, unproven: r.summary.unproven };
  };
  const reject = new Set((c.rejectIds ?? []).map((id) => id.toUpperCase()));
  const consRun = async (choices: ImportChoiceValues): Promise<PathRun> => {
    const r = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: content,
      choices,
      resolveAsset: (id: string) =>
        reject.has(id.toUpperCase()) ? null : /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id) || /^[A-Z][A-Z0-9.-]{1,15}$/.test(id) ? activo(id) : null
    });
    const warnings = [...r.warnings, ...r.rejected_positions.filter((p) => p.asset_id).map((p) => `${p.asset_id}: ${p.reason}`)];
    const capital = r.detected_capital ?? 0;
    const used = capital > 0 ? r.imported_positions.map((p) => ({ id: p.asset_id, amount: (p.weight_percent / 100) * capital })) : [];
    const mode = capital > 0 || (r.import_choices ?? []).length > 0 ? "extracto" : r.imported_positions.length > 0 ? "pesos" : "rechaza";
    return { shown: r.euro_confirmation?.positions ?? [], used, warnings, choices: r.import_choices ?? [], mode, unproven: r.import_unproven ?? null };
  };
  const gp = await judgePath(c, gpRun(text));
  const file = await judgePath(c, gpRun(content));
  const cons = await judgePath(c, consRun);
  const usedEqualsShown =
    pendingChoices(gp.last.choices).length > 0 ||
    (sameMaps(sumById(gp.last.used), sumById(gp.last.shown)) &&
      (cons.last.mode !== "extracto" ||
        sameMaps(sumById(cons.last.used), sumById(cons.last.shown.filter((p) => !reject.has(p.id.toUpperCase()))))));
  return {
    id: c.id,
    group: c.group,
    tema: c.tema,
    truth: c.truth,
    gp: gp.v,
    gpShown: fmt(gp.last.shown),
    gpWarnings: gp.last.warnings,
    file: file.v,
    cons: cons.v,
    consShown: fmt(cons.last.shown),
    usedEqualsShown,
    choices: pendingChoices(gp.last.choices).map((choice) => `${choice.kind}: ${choice.options.map((o) => o.label).join(" | ")}`),
    incl: [gp.incl, file.incl, cons.incl].every((v) => v === gp.incl) ? gp.incl : [gp.incl, file.incl, cons.incl].join(" / ")
  };
}
