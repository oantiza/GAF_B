/**
 * Lo que hay que saber para leer la columna de una cartera comparada, en frases: lo que no
 * se pudo incluir, desde cuándo se mide y en qué divisa. Nada de esto se calla.
 */
import { notaDeLoContadoComoCero } from "../../motor/sinPrecio";
import { escrito } from "../textos";
import type { CarteraComparada } from "./calcular";

export function notasDeLaComparada(comparada: CarteraComparada, divisaBase: string): string[] {
  const quien = `«${comparada.nombre}»`;
  const notas: string[] = [];
  if (comparada.sinHistoria) notas.push(`${quien} no tiene historia en este periodo.`);
  else if (comparada.empiezaEl) notas.push(`${quien} empieza el ${escrito.fecha(comparada.empiezaEl)}: se mide desde ese día, no desde el inicio del periodo.`);
  if (comparada.analisis.cartera.divisaBase !== divisaBase) {
    notas.push(`${quien} lleva sus cuentas en ${comparada.analisis.cartera.divisaBase}: su rentabilidad está medida en esa divisa.`);
  }
  if (comparada.noEncontrados.length > 0) {
    const lista = comparada.noEncontrados.map((linea) => `${linea.isin} (${escrito.peso(linea.peso)})`).join(", ");
    notas.push(`${quien}: el catálogo de la plataforma no tiene ${lista}. Su peso se queda en efectivo.`);
  }
  for (const linea of comparada.sinComprar) {
    notas.push(`${quien}: no se ha podido comprar ${linea.nombre} (${escrito.peso(linea.peso)}) el primer día. ${linea.motivo} Su peso se queda en efectivo.`);
  }
  for (const aviso of comparada.avisos) notas.push(`${quien}: ${aviso}`);
  /* Sus cifras salen de la serie del valor: una posición sin precio vale cero en ella, y la columna lo dice. */
  const comoCero = notaDeLoContadoComoCero(comparada.analisis, { quien });
  if (comoCero) notas.push(comoCero);
  return notas;
}
