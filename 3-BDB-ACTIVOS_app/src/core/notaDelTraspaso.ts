import { rotuloDePosiciones } from "./cuentaDePosiciones";
import { fecha, importeTitular, oFalta } from "./formato";
import type { PositionsPortfolioTransfer } from "./positionsToPortfolio";
import { createSessionSlot } from "./sessionCaches";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

/**
 * DIS-17: lo que Posiciones lleva a Diseño de cartera. Antes la cartera llegaba con el nombre del modo, «Extracto externo»
 * (y así se guardaba la de un cliente si se pulsaba «Guardar»), y Diseño no decía cuántas posiciones habían entrado ni
 * cuáles se habían quedado fuera: solo lo decía Posiciones, antes de pulsar.
 *
 * El traspaso pasa por el marco de la aplicación, que sustituye la cartera y navega. La nota se deja aquí, en memoria
 * (son datos de un cliente), y Diseño la toma al abrirse solo si la cartera que tiene es la que se llevó: si el asesor se
 * echó atrás en la pregunta de cambios sin guardar, la nota no sale sobre otra cartera.
 */

/** «Extracto del 13/11/2026»: de dónde viene la cartera y de qué día es la lectura. */
export function nombreDelExtracto(hoy: Date = new Date()): string {
  return `Extracto del ${oFalta(fecha(hoy))}`;
}

export function notaDelTraspaso(traspaso: Pick<PositionsPortfolioTransfer, "positions" | "totalCapital" | "excludedIds" | "excludedCapital">): string {
  const entran = traspaso.positions.length;
  const fuera = traspaso.excludedIds.length;
  return [
    `Del extracto ${entran === 1 ? "ha entrado" : "han entrado"} ${rotuloDePosiciones(entran)} por ${oFalta(importeTitular(traspaso.totalCapital))}.`,
    fuera === 0
      ? " No se ha quedado ninguna fuera."
      : ` Se ${fuera === 1 ? "ha quedado" : "han quedado"} fuera ${rotuloDePosiciones(fuera)} (${oFalta(importeTitular(traspaso.excludedCapital))}): ${traspaso.excludedIds.join(", ")}.`
  ].join("");
}

const huella = (positions: readonly Pick<BdbManualPortfolioPosition, "asset_id">[]) => positions.map((position) => position.asset_id).join("|");

const traspasoPendiente = createSessionSlot<{ huella: string; nota: string } | null>(() => null);

export function anotarTraspaso(traspaso: PositionsPortfolioTransfer): void {
  traspasoPendiente.write({ huella: huella(traspaso.positions), nota: notaDelTraspaso(traspaso) });
}

/** La nota del traspaso, si la cartera que hay es la que se llevó. No la consume: eso lo hace `olvidarNotaDelTraspaso`. */
export function leerNotaDelTraspaso(positions: readonly Pick<BdbManualPortfolioPosition, "asset_id">[]): string | null {
  const pendiente = traspasoPendiente.read();
  return pendiente && positions.length > 0 && pendiente.huella === huella(positions) ? pendiente.nota : null;
}

export function olvidarNotaDelTraspaso(): void {
  traspasoPendiente.reset();
}
