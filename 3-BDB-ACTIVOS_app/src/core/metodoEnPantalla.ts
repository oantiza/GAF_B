import { metricsMethodLabel } from "./labels";

/**
 * El nombre de un método de cálculo en pantalla.
 *
 * «calculada por nosotros con rentabilidad geométrica» es el texto que los PDF leen de `labels.ts`. En pantalla
 * se dice la frecuencia, que es lo que distingue a este método de los otros dos.
 */
export function nombreDelMetodoEnPantalla(metodo: string | undefined): string {
  const nombre = metodo === "GEOMETRIC_CAGR" ? "calculada por nosotros, semanal" : metricsMethodLabel(metodo);
  /* Es el título de un panel del plano: con mayúscula, sin tocar lo que escribe `labels`, que lee el papel. */
  return nombre.charAt(0).toLocaleUpperCase("es") + nombre.slice(1);
}
