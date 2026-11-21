import { act } from "react";
import { EURO_CONFIRMATION_TEXT } from "../../src/core/importSummary";

/** Texto de la casilla con la que el asesor confirma lo que enseña el resumen (séptima pasada). */
export const EURO_CONFIRMATION_LABEL = EURO_CONFIRMATION_TEXT;

export function euroConfirmationBox(view: ParentNode): HTMLInputElement | null {
  return (
    [...view.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
      input.closest("label")?.textContent?.includes(EURO_CONFIRMATION_LABEL)
    ) ?? null
  );
}

/** Selector de los avisos de la importación (octava pasada: filete ocre, «avisa»). */
export const IMPORT_WARNINGS = '[aria-label="Avisos de la importación"]';

/** Texto de los avisos de la importación, o `null` si no hay. */
export function importWarningsText(view: ParentNode): string | null {
  return view.querySelector(IMPORT_WARNINGS)?.textContent ?? null;
}

/**
 * Octava pasada: la lista para confirmar es una tabla, de mayor a menor importe.
 * Cada fila, como «ISIN · nombre · importe», y la nota detrás si la hay.
 */
export function confirmationLines(view: ParentNode, label = "Posiciones para comprobar"): string[] {
  // Novena pasada (I10): en el Constructor la tabla es estrecha (nombre, ISIN y nota en una celda); los campos
  // se leen por su `data-field`, igual en las dos formas.
  return [...view.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((row) => {
    const field = (name: string) => (row.querySelector(`[data-field="${name}"]`)?.textContent ?? "").replace(/\s/g, " ").trim();
    const note = field("note").replace(/^Motivo: /, "");
    return [field("id"), field("name"), field("amount")].filter(Boolean).join(" · ") + (note ? ` (${note})` : "");
  });
}

/**
 * Séptima pasada de la auditoría del 16-10-2026: Posiciones globales no analiza
 * NADA hasta que el asesor marca la casilla y vuelve a pulsar el botón, haya o
 * no «€», contravalor en EUR o columna de divisa. Devuelve si había que
 * confirmar.
 */
export async function confirmEurosAndAnalyze(view: ParentNode, buttonLabel: string): Promise<boolean> {
  const box = euroConfirmationBox(view);
  if (!box) return false;
  await act(async () => {
    box.click();
  });
  await act(async () => {
    [...view.querySelectorAll("button")].find((button) => button.textContent === buttonLabel)!.click();
  });
  return true;
}
