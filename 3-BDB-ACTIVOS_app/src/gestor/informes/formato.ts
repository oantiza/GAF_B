/**
 * Lo que queda del formato propio de los informes del gestor. Las cifras y las fechas de los PDF se escriben con el
 * módulo común (`src/core/formato.ts`); aquí solo hay lo que es del gestor: la fecha con la que se rotula el inicio del
 * periodo, el periodo en palabras, de dónde sale un precio, y lo que usa el Excel, que no es un PDF y no se migra.
 */
import { fechaLarga } from "../../core/formato";
import { fechaDeInicioDelPeriodo, type Analisis } from "../motor/analisis";
import type { Dia } from "../motor/fechas";
import { FUENTE, type FuenteDelPrecio } from "../motor/valoracion";

/** Lo que el Excel escribe en una celda de texto cuando falta una cifra. */
export const NO_DISPONIBLE = "Falta el dato";

/**
 * La fecha con la que se rotula el inicio del periodo: la misma regla que la pantalla
 * (`fechaDeInicioDelPeriodo`, MOT-09 y DIR-08). Es la fecha desde la que se mide, el cierre del
 * día anterior al primer día («del 31 de diciembre» en el año en curso), o la del primer
 * movimiento si la cartera empieza después.
 */
export function primerDiaDelPeriodo(analisis: Analisis): Dia {
  return fechaDeInicioDelPeriodo(analisis);
}

/** «Del 13 de noviembre de 2023 al 13 de noviembre de 2026». */
export function periodoEnPalabras(analisis: Analisis): string {
  const desde = primerDiaDelPeriodo(analisis);
  const hasta = analisis.periodo.hasta;
  return `Del ${fechaLarga(desde) ?? desde} al ${fechaLarga(hasta) ?? hasta}`;
}

/** De dónde sale el precio de una posición, en palabras. */
export function fuenteDelPrecio(fuente: FuenteDelPrecio): string {
  switch (fuente) {
    case FUENTE.mercado:
      return "Mercado";
    case FUENTE.manual:
      return "A mano";
    case FUENTE.operacion:
      return "Última operación";
    case FUENTE.extracto:
      return "Extracto del banco";
    default:
      return "Sin precio";
  }
}

/** Los meses, para las cabeceras de la tabla de rentabilidad por meses: los del módulo único, los mismos que en la
    pantalla (antes el papel y el Excel los escribían «Ene», «Feb»… y la pantalla, «ene», «feb»). */
export { MESES_CORTOS } from "../../core/formato";
