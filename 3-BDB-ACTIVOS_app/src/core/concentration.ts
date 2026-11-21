// Umbral único de concentración de la mayor posición (MEDIA-06; decisión de Óscar
// del 17-10-2026). Lo leen la Radiografía, las reglas de salud, «Salud y control»
// y el Estado del Constructor. Hasta entonces cada uno tenía su escala
// (35/50, 25/40 y 15/30), y una posición del 30 % salía en la misma pantalla
// como «Balanceada», con aviso y «Alta».
//
// Las fronteras exactas no disparan, como ya hacía la Salud: una cartera de
// cuatro posiciones al 25 % está equilibrada, y una al 40 % justo se vigila.

export const CONCENTRATION_THRESHOLDS = { watch: 25, high: 40 } as const;

export type ConcentrationBand = "BALANCED" | "WATCH" | "HIGH";

/** Nivel de concentración de un peso en % (0-100): hasta 25 equilibrado, de 25 a 40 vigilar, por encima de 40 alto. */
export function concentrationBand(weightPercent: number): ConcentrationBand {
  if (weightPercent > CONCENTRATION_THRESHOLDS.high) return "HIGH";
  if (weightPercent > CONCENTRATION_THRESHOLDS.watch) return "WATCH";
  return "BALANCED";
}
