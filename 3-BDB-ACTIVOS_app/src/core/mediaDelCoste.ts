import { esSoloDeAcciones, fraseDelCoste, SIN_MEDIA_QUE_DAR, type calculatePortfolioCosts } from "./portfolioCosts";
import { textoDeAusencia } from "./textoDeAusencia";

/** Los costes de una cartera, como los calcula `calculatePortfolioCosts` sobre las fichas: el coste corriente es el de la ficha (decisión B-53). */
export type CostesDeLaCartera = ReturnType<typeof calculatePortfolioCosts>;

const enMinusculas = (texto: string) => texto.toLocaleLowerCase("es-ES");

/**
 * Lo que se dice de la media ponderada del coste corriente de una cartera en los papeles de cliente (informe de cliente y comparativa de
 * carteras), con la regla del informe de costes: con un fondo sin coste no hay media, porque sumar lo demás lo trataría como un cero, y se
 * dice cuánto falta; una acción no tiene coste corriente y cuenta como cero (decisión 10); con solo acciones no hay media que dar.
 *
 * `texto` va detrás de un rótulo y dos puntos («…: 0,64 % al año, unos 64 € por cada 10.000 €.»). `tasa` es la media, o null si no se da;
 * `completa` dice si es una media de verdad, para que quien la enseña añada lo que no incluye.
 */
export function mediaDelCoste(costes: CostesDeLaCartera | null | undefined): { texto: string; tasa: number | null; completa: boolean } {
  if (!costes || costes.rows.length === 0) return { texto: `${enMinusculas(textoDeAusencia("falta"))}.`, tasa: null, completa: false };
  if (esSoloDeAcciones(costes)) return { texto: `${enMinusculas(textoDeAusencia("no-aplica"))}. ${SIN_MEDIA_QUE_DAR}`, tasa: null, completa: false };
  if (costes.missing > 0) {
    const cuantas = costes.rows.length === 1 ? "la única posición" : `${costes.missing} de las ${costes.rows.length} posiciones`;
    return { texto: `${enMinusculas(textoDeAusencia("falta"))}. Falta el coste de ${cuantas}, y sin él no se da una media.`, tasa: null, completa: false };
  }
  const acciones = costes.acciones > 0 ? " Las acciones, que no tienen coste corriente, cuentan como cero." : "";
  return { texto: `${fraseDelCoste(costes)}.${acciones}`, tasa: costes.avgCostPct, completa: true };
}

/** De qué van netas las rentabilidades de una simulación: con algún fondo dentro, de sus gastos; con solo acciones no hay gastos de fondo que descontar. */
export function deQueVanNetasLasRentabilidades(hayFondos: boolean): string {
  return hayFondos
    ? "Las cifras de rentabilidad son netas de los gastos de los fondos y antes de asesoramiento e impuestos."
    : "Las cifras de rentabilidad van antes de asesoramiento e impuestos.";
}
