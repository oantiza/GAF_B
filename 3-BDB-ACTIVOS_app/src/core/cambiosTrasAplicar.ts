import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import { oFalta, peso } from "./formato";

/**
 * Lo que pasa con una propuesta aplicada cuando la cartera sigue cambiando. La línea base sobrevive a cambiar de
 * pantalla (hallazgo 53), así que entre aplicarla y volver atrás se ha podido añadir un fondo o escribir un peso.
 */
type Posicion = Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">;

const pesoDe = (posicion: Posicion | undefined) => posicion?.weight_percent || 0;
/** Media centésima: lo que `round2` puede mover al aplicar no es un cambio. */
const IGUALES = 0.005;

export function mismaComposicion(a: readonly Posicion[], b: readonly Posicion[]): boolean {
  if (a.length !== b.length) return false;
  const deB = new Map(b.map((posicion) => [posicion.asset_id, posicion]));
  return a.every((posicion) => deB.has(posicion.asset_id) && Math.abs(pesoDe(deB.get(posicion.asset_id)) - pesoDe(posicion)) < IGUALES);
}

/** El candado es de la posición, no del fondo: el sustituto hereda el peso, y con él el candado. */
export function candadosTrasSustituir(
  candados: Record<string, boolean>,
  anterior: string,
  nuevo: string
): Record<string, boolean> {
  if (!candados[anterior]) return candados;
  return { ...Object.fromEntries(Object.entries(candados).filter(([id]) => id !== anterior)), [nuevo]: true };
}

/** Lo que deshace «Volver a los pesos anteriores» además de la propuesta, en palabras. Vacío si no hay nada. */
export function loQueSePerderiaAlVolver(
  aplicada: readonly Posicion[],
  ahora: readonly Posicion[],
  nombreDe: (assetId: string) => string
): string[] {
  const deAplicada = new Map(aplicada.map((posicion) => [posicion.asset_id, posicion]));
  const deAhora = new Map(ahora.map((posicion) => [posicion.asset_id, posicion]));
  return [
    ...ahora
      .filter((posicion) => !deAplicada.has(posicion.asset_id))
      .map((posicion) => `Se quita «${nombreDe(posicion.asset_id)}», añadida después.`),
    ...aplicada
      .filter((posicion) => !deAhora.has(posicion.asset_id))
      .map((posicion) => `Vuelve «${nombreDe(posicion.asset_id)}», quitada después.`),
    ...ahora
      .filter((posicion) => deAplicada.has(posicion.asset_id) && Math.abs(pesoDe(posicion) - pesoDe(deAplicada.get(posicion.asset_id))) >= IGUALES)
      .map((posicion) => `«${nombreDe(posicion.asset_id)}» pierde el peso escrito después, ${oFalta(peso(pesoDe(posicion) / 100))}.`)
  ];
}
