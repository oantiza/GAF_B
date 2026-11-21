import { useId } from "react";
import { importe, oFalta } from "../core/formato";

/** Un importe sin «€», con el mismo formato de millares: lo que no consta que esté en euros. */
const plainAmount = (amount: number) => oFalta(importe(amount, { divisa: null }));
const euroAmount = (amount: number) => oFalta(importe(amount));
import {
  confirmationRows,
  includeUnprovenText,
  NONE_CHOICE,
  positionNotes,
  type ConfirmationPosition,
  type ImportChoice
} from "../core/importSummary";

/**
 * Octava pasada del importador (revisión 7): lo que el asesor revisa antes de
 * confirmar una importación, igual en Posiciones globales y en el Constructor.
 *
 * - `ImportChoices`: lo que el lector no elige por el asesor (la columna de
 *   importe cuando hay varias que no se concilian, el titular cuando el fichero
 *   trae varios, la fecha cuando trae dos fotos). Cada opción con su cabecera
 *   exacta y lo que daría; por defecto, ninguna marcada.
 * - `ImportConfirmationTable`: las posiciones para confirmar como tabla
 *   (ISIN en monoespaciada, cifras a la derecha), de mayor a menor importe y
 *   con las que tienen un criterio débil marcadas en «Nota». En una columna
 *   estrecha (`compact`, el Constructor a 768 px: I10 de la revisión 8), el
 *   nombre, el ISIN y la nota van apilados en una celda y el importe al lado,
 *   para que la cifra y la nota se lean sin desplazar la tabla.
 * - `UnprovenPositions` (novena pasada, I5): lo que la regla de divisa deja
 *   fuera sin prueba de EUR, con su importe y su motivo, y la segunda casilla
 *   para incluirlo.
 */

interface ImportChoicesProps {
  choices: readonly ImportChoice[];
  onChoose: (key: string, value: string) => void;
}

function optionText(choice: ImportChoice, option: ImportChoice["options"][number]): string {
  if (option.value === NONE_CHOICE) return option.label;
  const label = choice.kind === "amount" ? `«${option.label}»` : option.label;
  const positions = option.positions === 1 ? "1 posición" : `${option.positions} posiciones`;
  // M5 (revisión 8): con otra elección dentro (la columna de importe), el total aún no se sabe.
  if (option.pendingInside) return `${label} · ${positions} · el importe depende de la columna que elijas después`;
  // I2 (revisión 9): lo que la opción deja fuera por no decir EUR también cuenta; sin «€», porque no consta que lo sea.
  const outside = option.outside && option.outside.positions > 0 ? option.outside : null;
  const outsideCount = outside ? (outside.positions === 1 ? "1 posición" : `${outside.positions} posiciones`) : "";
  if (outside && option.positions === 0) return `${label} · ${outsideCount} · ${plainAmount(outside.total)} (fuera, sin prueba de EUR)`;
  return `${label} · ${positions} · ${euroAmount(option.total)}${outside ? ` · y ${outsideCount} fuera, sin prueba de EUR (${plainAmount(outside.total)})` : ""}`;
}

export function ImportChoices({ choices, onChoose }: ImportChoicesProps) {
  const groupId = useId();
  return (
    <>
      {choices.map((choice, index) => {
        const questionId = `${groupId}-${index}`;
        return (
          <div key={choice.key} role="radiogroup" aria-labelledby={questionId}>
            <span id={questionId}>
              {choice.reason} {choice.question}
              {choice.where !== "el extracto" && choice.where !== "el fichero" ? ` (${choice.where})` : ""}
            </span>
            {choice.options.map((option) => (
              <div key={option.value}>
                <label className="check">
                  <input
                    type="radio"
                    name={questionId}
                    value={option.value}
                    checked={choice.chosen === option.value}
                    onChange={() => onChoose(choice.key, option.value)}
                  />
                  <span>{optionText(choice, option)}</span>
                </label>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

interface ImportConfirmationTableProps {
  positions: readonly ConfirmationPosition[];
  /** Nombre accesible de la tabla. */
  label?: string;
  /** Rótulo de la columna de notas («Nota»; «Motivo» para lo que queda fuera). */
  noteHeader?: string;
  /** Columna estrecha: nombre, ISIN y nota apilados, y el importe al lado. */
  compact?: boolean;
  /** `false`: los importes sin «€» (lo que queda fuera porque no consta que esté en euros). */
  euros?: boolean;
}

export function ImportConfirmationTable({
  positions,
  label = "Posiciones para comprobar",
  noteHeader = "Nota",
  compact = false,
  euros = true
}: ImportConfirmationTableProps) {
  const rows = confirmationRows({ positions });
  if (rows.length === 0) return null;
  const amountText = (amount: number) => (euros ? euroAmount(amount) : plainAmount(amount));
  if (compact) {
    return (
      <div aria-label={`${label} (tabla desplazable)`} className="table-wrap" role="group" tabIndex={0}>
        <table aria-label={label}>
          <thead>
            <tr>
              <th scope="col">Posición</th>
              <th scope="col" className="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => {
              const notes = positionNotes(position).join("; ");
              return (
                <tr key={position.id}>
                  <td>
                    <div className="cell-entity">
                      {position.name ? (
                        // I3 (revisión 9): el nombre se parte en varias líneas; así la columna no crece y el importe se ve a 768 px.
                        <span data-field="name">
                          {position.name}
                        </span>
                      ) : null}
                      <span className="cell-entity__code" data-field="id">
                        {position.id}
                      </span>
                      {notes ? (
                        <span className="warn" data-field="note">
                          {noteHeader === "Nota" ? notes : `${noteHeader}: ${notes}`}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="num" data-field="amount">
                    {amountText(position.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div aria-label={`${label} (tabla desplazable)`} className="table-wrap" role="group" tabIndex={0}>
      <table aria-label={label}>
        <thead>
          <tr>
            <th scope="col">ISIN o id</th>
            <th scope="col">Nombre</th>
            <th scope="col" className="num">Importe</th>
            <th scope="col">{noteHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((position) => (
            <tr key={position.id}>
              <td className="mono" data-field="id">{position.id}</td>
              <td data-field="name">{position.name ?? ""}</td>
              <td className="num" data-field="amount">{amountText(position.amount)}</td>
              <td data-field="note">{positionNotes(position).join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface UnprovenReviewProps {
  unproven: { positions: readonly ConfirmationPosition[]; included: boolean } | null | undefined;
  /** El asesor marca o desmarca la segunda casilla. */
  onToggle: (include: boolean) => void;
  disabled?: boolean;
}

/** I5 (revisión 8): la segunda casilla, para incluir lo que la regla de divisa deja fuera. Desmarcada por defecto. */
export function IncludeUnprovenBox({ unproven, onToggle, disabled = false }: UnprovenReviewProps) {
  if (!unproven || unproven.positions.length === 0) return null;
  return (
    <label className="check">
      <input type="checkbox" checked={unproven.included} disabled={disabled} onChange={(event) => onToggle(event.target.checked)} />
      <span>{includeUnprovenText(unproven.positions.length)}</span>
    </label>
  );
}

/** Lo que queda fuera sin prueba de EUR, con su importe y su motivo (solo mientras no se incluye). */
export function UnprovenTable({ unproven, compact = false }: { unproven: UnprovenReviewProps["unproven"]; compact?: boolean }) {
  if (!unproven || unproven.included || unproven.positions.length === 0) return null;
  // M4 (revisión 9): con su título a la vista, y los importes sin «€»: no consta que lo sean.
  return (
    <>
      {/* Va dentro del resumen de la importación, que pinta la pieza `Aviso` (MAR-21): su título, en negrita. */}
      <strong>Posiciones fuera, sin prueba de EUR</strong>
      <ImportConfirmationTable
        positions={unproven.positions.map((position) => ({ ...position, eurStated: true }))}
        label="Posiciones fuera, sin prueba de EUR"
        noteHeader="Motivo"
        compact={compact}
        euros={false}
      />
    </>
  );
}
