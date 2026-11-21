/**
 * Resumen de una importación de posiciones (quinta pasada de la auditoría del
 * 16-10-2026): la red de seguridad que convierte en visibles los errores que
 * aún no conocemos. Tras importar se enseña SIEMPRE, en Posiciones globales y
 * en el Constructor, cuántas posiciones y cuántos euros se han leído, de qué
 * columna, con qué criterio de divisa, de qué hojas o tablas, y qué filas se
 * han descartado y por qué.
 *
 * Séptima pasada: la confirmación es SIEMPRE. Ninguna «prueba» automática de
 * que un importe está en euros es de fiar (seis revisiones lo han falseado), así
 * que toda importación queda pendiente hasta que el asesor marca «He comprobado
 * que estos importes son el valor de mercado en euros de cada posición». El
 * resumen le deja verificarlo de un vistazo: la cabecera exacta de la columna
 * de importe, el criterio de divisa, las hojas o tablas leídas, cada posición
 * con su ISIN, su nombre y su importe, el total y lo descartado.
 *
 * Octava pasada (revisión 7): el resumen dice también qué otras divisas
 * menciona el fichero y dónde (regla global de divisa), y trae las ELECCIONES
 * que el lector no hace por el asesor: la columna de importe cuando hay varias
 * que no se concilian (B1) y el titular cuando el fichero trae varios (B5).
 * Sin todas las elecciones hechas no se puede confirmar. La lista de
 * posiciones se enseña en la pantalla como una tabla ordenada por importe.
 */
import { importe, oFalta } from "./formato";

/* Lo leído de un extracto se dice con sus céntimos: es lo que el asesor compara con el fichero. */
const enEuros = (valor: number) => oFalta(importe(valor));

export interface DiscardedRows {
  /** Motivo en una frase corta: «en otra divisa», «subtotal», «sin ISIN»… */
  reason: string;
  /** Identificadores o rótulos de las filas descartadas por ese motivo. */
  items: string[];
}

export interface ImportedPosition {
  id: string;
  /** Nombre de la posición en el fichero, si lo trae (todos, si el identificador se repite: W38). */
  name?: string;
  amount: number;
  /** El fichero dice que esa posición está en euros (cabecera, columna de divisa o «€» en la celda).
      No es una prueba —la confirmación es siempre—; sin ella, la posición va marcada en la lista. */
  eurStated: boolean;
  /** Notas para la lista de confirmación: «el nombre dice USD», «no está en la maestra: no se cargará». */
  notes?: string[];
}

/** Lo que el asesor confirma: cada posición (agrupada por identificador) y el criterio de divisa. */
export interface EuroConfirmation {
  positions: ImportedPosition[];
  /** Criterio de divisa, en una frase (lo que dice el fichero sobre la divisa). */
  reason: string;
}

/** Una opción de una elección: la columna o el titular, con lo que daría. */
export interface ImportChoiceOption {
  value: string;
  /** Cabecera exacta de la columna o nombre del titular. */
  label: string;
  /** Total en euros y número de posiciones que se leerían con esta opción. */
  total: number;
  positions: number;
  /** Con esta opción queda otra elección por hacer (la columna de importe): el total aún no se sabe (M5 de la revisión 8). */
  pendingInside?: boolean;
  /** Lo que esta opción deja fuera por no decir EUR (I2 de la revisión 9): se puede incluir con la segunda casilla. */
  outside?: { positions: number; total: number };
}

/** Algo que el lector no decide por el asesor (octava pasada, B1 y B5; novena, la fecha de la foto). */
export interface ImportChoice {
  kind: "amount" | "holder" | "date";
  /** Clave estable de la elección (el bloque, o «titular»). */
  key: string;
  question: string;
  /** Dónde: «el extracto», «el bloque «Fondos»», «el fichero». */
  where: string;
  /** Por qué hay que elegir. */
  reason: string;
  options: ImportChoiceOption[];
  /** La opción elegida; `null` mientras no se elija (por defecto, ninguna). */
  chosen: string | null;
}

/** Elecciones hechas: clave de la elección → valor de la opción. */
export type ImportChoiceValues = Readonly<Record<string, string>>;

/** Clave de la elección de titular. */
export const HOLDER_CHOICE_KEY = "titular";

/** Opción de toda elección: no importar ese bloque (o ningún titular). */
export const NONE_CHOICE = "ninguna";

/** Opción de la elección de titular: las posiciones que no tienen titular (B3 de la revisión 8). */
export const NO_HOLDER_CHOICE = "sin-titular";

/** Clave de la elección de fecha: dos fotos fechadas de la misma cartera no se suman (I3 de la revisión 8). */
export const DATE_CHOICE_KEY = "fecha";

/** Opción de la elección de fecha: los bloques sin fecha que repiten posiciones. */
export const NO_DATE_CHOICE = "sin-fecha";

/**
 * I5 (revisión 8): la segunda casilla. Las posiciones que la regla de divisa
 * deja fuera (el fichero o su bloque mencionan otra divisa y la fila no dice
 * EUR, o un ISIN de fuera del euro sin divisa) solo entran si el asesor dice
 * que ha comprobado que sus importes están en euros. Viaja con las elecciones:
 * queda ligada a la entrada y otra entrada la borra.
 */
export const INCLUDE_UNPROVEN_KEY = "incluir-sin-prueba";
export const INCLUDE_UNPROVEN_YES = "sí";

/**
 * I1 (revisión 9): las elecciones tras elegir una opción. La segunda casilla vale para las posiciones que se
 * listaron con las demás elecciones: si cambia otra (titular, fecha, columna), se borra.
 */
export function nextChoiceValues(current: Readonly<Record<string, string>>, key: string, value: string): Record<string, string> {
  if (key === INCLUDE_UNPROVEN_KEY) return { ...current, [key]: value };
  const next: Record<string, string> = { ...current, [key]: value };
  delete next[INCLUDE_UNPROVEN_KEY];
  return next;
}

/** Texto de la segunda casilla, el mismo en Posiciones globales y en el Constructor. */
export function includeUnprovenText(count: number): string {
  return `Incluir también ${count === 1 ? "esta posición" : `estas ${count} posiciones`}: he comprobado que ${count === 1 ? "su importe está" : "sus importes están"} en euros`;
}

/** Las posiciones sin prueba de EUR que la regla deja fuera (o que el asesor ha incluido), con su importe y su motivo en `notes`. */
export interface UnprovenPositions {
  positions: ImportedPosition[];
  /** El asesor las ha incluido con la segunda casilla. */
  included: boolean;
}

export interface ImportSummary {
  /** «extracto» (tabla con cabecera) o «lista» (una posición por línea). */
  format: "extracto" | "lista";
  /** Filas importadas (antes de agrupar por ISIN). */
  positions: number;
  /** Identificadores distintos entre ellas (un fondo en dos cuentas cuenta una vez). */
  distinct: number;
  /** Suma de sus importes en euros. */
  totalEur: number;
  /** Rótulos EXACTOS de las columnas de las que sale el importe. */
  amountColumns: string[];
  /** Criterio de divisa aplicado, en frases cortas. */
  currency: string[];
  /** Hojas o tablas leídas. */
  sources: string[];
  discarded: DiscardedRows[];
  /** Códigos con forma de ISIN cuyo dígito de control no cuadra. */
  checkDigit: string[];
  /** Lo que el asesor tiene que confirmar (`null` si no se ha leído ninguna posición). */
  euroConfirmation: EuroConfirmation | null;
  /** Elecciones del asesor, pendientes o hechas. */
  choices: ImportChoice[];
  /** Otras divisas que menciona el fichero y dónde (regla global de divisa); `null` si ninguna. */
  mentions: string | null;
  /** Alcance de esas menciones (I5 de la revisión 8): todo el fichero, o solo algún bloque. */
  mentionScope: "file" | "block" | "row" | null;
  /** Lo que la regla deja fuera sin prueba de EUR, para incluirlo a mano (I5); `null` si nada. */
  unproven: UnprovenPositions | null;
}

export function emptyImportSummary(format: ImportSummary["format"]): ImportSummary {
  return {
    format,
    positions: 0,
    distinct: 0,
    totalEur: 0,
    amountColumns: [],
    currency: [],
    sources: [],
    discarded: [],
    checkDigit: [],
    euroConfirmation: null,
    choices: [],
    mentions: null,
    mentionScope: null,
    unproven: null
  };
}

/** Texto de la casilla de confirmación, el mismo en Posiciones globales y en el Constructor. */
export const EURO_CONFIRMATION_TEXT = "He comprobado que estos importes son el valor de mercado en euros de cada posición";

/** En el formato «asset_id,peso» no hay importes: lo que se confirma son los activos y sus pesos. */
export const WEIGHTS_CONFIRMATION_TEXT = "He comprobado que estos activos y pesos son los de la cartera";

/** Nota de la lista para una posición sin prueba de EUR (criterio débil). */
export const WEAK_CRITERION_NOTE = "el fichero no dice su divisa";

/** ¿Queda alguna elección por hacer? Sin todas hechas, no se confirma. */
export function pendingChoices(choices: readonly ImportChoice[] | undefined): ImportChoice[] {
  return (choices ?? []).filter((choice) => choice.chosen === null);
}

/** Añade filas descartadas a un motivo (sin repetir motivos). */
export function addDiscarded(summary: ImportSummary, reason: string, items: string[]): void {
  if (items.length === 0) return;
  const existing = summary.discarded.find((entry) => entry.reason === reason);
  if (existing) existing.items.push(...items);
  else summary.discarded.push({ reason, items: [...items] });
}

function addUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

export function addAmountColumn(summary: ImportSummary, label: string): void {
  addUnique(summary.amountColumns, label);
}

export function addCurrencyCriterion(summary: ImportSummary, criterion: string): void {
  addUnique(summary.currency, criterion);
}

function quotedList(items: string[]): string {
  const quoted = items.map((item) => `«${item}»`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1]}` : quoted[0] ?? "";
}

function allOf(items: string[]): string {
  return [...new Set(items)].join(", ");
}

/** Una posición de la lista de confirmación tal como llega a la pantalla (en el Constructor, `eurStated` puede faltar). */
export type ConfirmationPosition = Omit<ImportedPosition, "eurStated"> & { eurStated?: boolean };

/** Notas de una posición en la lista: las suyas y, sin prueba de EUR, la del criterio débil. */
export function positionNotes(position: ConfirmationPosition): string[] {
  return [...(position.eurStated === false ? [WEAK_CRITERION_NOTE] : []), ...(position.notes ?? [])];
}

/** Una línea por posición: «LU1234567891 · Fondo A · 80.000,00 €». */
export function describePosition(position: ImportedPosition): string {
  return [position.id, position.name, enEuros(position.amount)].filter(Boolean).join(" · ");
}

/** Las posiciones para confirmar, de mayor a menor importe (con 200 posiciones, lo grande primero). */
export function confirmationRows<T extends ConfirmationPosition>(confirmation: { positions: readonly T[] } | null | undefined): T[] {
  return [...(confirmation?.positions ?? [])].sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
}

/** La lista de confirmación en texto, ordenada por importe y con las notas de cada posición. */
export function describeConfirmation(confirmation: { positions: readonly ImportedPosition[] } | null | undefined): string[] {
  return confirmationRows(confirmation).map((position) => {
    const notes = positionNotes(position);
    return `${describePosition(position)}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
  });
}

/**
 * Líneas del resumen, en el orden en que se leen. Por defecto incluye la
 * lista de posiciones y las elecciones pendientes en texto (para quien no las
 * pinta); la pantalla pinta la lista como tabla y las elecciones como opciones,
 * y pide `positions: false`.
 */
export function describeImportSummary(summary: ImportSummary, options: { positions?: boolean } = {}): string[] {
  const lines: string[] = [];
  const n = summary.positions;
  lines.push(
    n === 0
      ? "No se ha leído ninguna posición."
      : `${n === 1 ? "1 posición leída" : `${n} posiciones leídas`}` +
        `${summary.distinct > 0 && summary.distinct < n ? ` (${summary.distinct === 1 ? "un solo activo" : `${summary.distinct} activos distintos`})` : ""}` +
        ` por ${enEuros(summary.totalEur)} en total.`
  );
  if (summary.amountColumns.length > 0) {
    lines.push(`Importe: ${summary.amountColumns.length === 1 ? "columna" : "columnas"} ${quotedList(summary.amountColumns)}.`);
  } else if (summary.format === "lista" && n > 0) {
    lines.push("Importe: el último campo de cada línea.");
  }
  if (summary.currency.length > 0) lines.push(`Divisa: ${summary.currency.join("; ")}.`);
  if (summary.mentions) {
    lines.push(
      summary.mentionScope === "block"
        ? `Otras divisas en una parte del fichero (un bloque o una agrupación): ${summary.mentions}. Ahí solo entran solas las filas que dicen EUR.`
        : summary.mentionScope === "row"
          ? `Otras divisas en alguna fila: ${summary.mentions}. Esas filas solo entran solas si dicen EUR.`
          : `Otras divisas en el fichero: ${summary.mentions}. Solo entran solas las filas que dicen EUR.`
    );
  }
  const unproven = summary.unproven;
  if (unproven && unproven.positions.length > 0) {
    const n = unproven.positions.length;
    const amount = unproven.positions.reduce((sum, position) => sum + position.amount, 0);
    // b.8 (revisión 10): sin «€» lo que no consta que esté en euros; con él, lo que el asesor ya incluyó.
    const total = unproven.included ? enEuros(amount) : oFalta(importe(amount, { divisa: null }));
    lines.push(
      unproven.included
        ? `Incluidas a mano: ${n === 1 ? "1 posición" : `${n} posiciones`} sin prueba de EUR (${total}), marcadas en la lista.`
        : n === 1
          ? `Fuera por no decir EUR: 1 posición (${total}). Se puede incluir si compruebas que su importe está en euros.`
          : `Fuera por no decir EUR: ${n} posiciones (${total}). Se pueden incluir si compruebas que sus importes están en euros.`
    );
    if (!unproven.included && options.positions !== false) lines.push(...describeConfirmation({ positions: unproven.positions }));
  }
  if (summary.sources.length > 0) lines.push(`Leído: ${summary.sources.join(", ")}.`);
  if (options.positions !== false) {
    for (const choice of pendingChoices(summary.choices)) lines.push(`Por elegir: ${choice.reason} ${choice.question}`);
  }
  const confirmation = summary.euroConfirmation;
  if (confirmation && confirmation.positions.length > 0) {
    const weak = confirmation.positions.filter((position) => !position.eurStated).length;
    lines.push(
      `Posiciones para comprobar (ISIN · nombre · importe), de mayor a menor: ${confirmation.positions.length}` +
        `${weak > 0 ? `, ${weak === confirmation.positions.length ? "todas" : weak} sin que el fichero diga su divisa` : ""}.`
    );
    if (options.positions !== false) lines.push(...describeConfirmation(confirmation));
    lines.push(`Total para comprobar: ${enEuros(confirmation.positions.reduce((sum, position) => sum + position.amount, 0))}.`);
  }
  const discardedCount = summary.discarded.reduce((sum, entry) => sum + entry.items.length, 0);
  if (discardedCount > 0) {
    lines.push(
      `${discardedCount === 1 ? "1 fila descartada" : `${discardedCount} filas descartadas`}: ` +
        summary.discarded.map((entry) => `${entry.reason} (${allOf(entry.items)})`).join("; ") +
        "."
    );
  }
  if (summary.checkDigit.length > 0) {
    lines.push(
      `${summary.checkDigit.length === 1 ? "Un código con forma de ISIN no cumple" : `${summary.checkDigit.length} códigos con forma de ISIN no cumplen`} ` +
        `el dígito de control (${allOf(summary.checkDigit)}): ${summary.checkDigit.length === 1 ? "comprueba que esté bien escrito" : "comprueba que estén bien escritos"}.`
    );
  }
  return lines;
}
