import * as formato from "./formato";

/**
 * Un precio con los decimales que de verdad tiene, de dos a cuatro: un valor liquidativo
 * de 99,55 no se escribe «99,550», y una accion de 3,556 pierde informacion en «3,56».
 * Sin divisa: quien lo pinta pone la suya al lado.
 */
export function precio(numero: number): string {
  return formato.oFalta(formato.precio(numero, { divisa: null }));
}

/** La divisa tal como llega, o ninguna: sin ella no se inventa el euro. */
function divisaDe(divisa: unknown): string | null {
  return typeof divisa === "string" && divisa.trim() ? divisa : null;
}

/**
 * Un precio con su divisa detrás, con espacio duro: «535,02 €», «3,556 USD». El código se escribe tal como llega
 * (lo hace el módulo común): «GBp» son peniques, y escrito «GBP» sería un precio cien veces mayor. Sin divisa, la
 * cifra sola.
 */
export function precioConDivisa(numero: number, divisa: unknown): string {
  return formato.oFalta(formato.precio(numero, { divisa: divisaDe(divisa) }));
}

/**
 * El patrimonio en millones, que es como se lee: «1.007,8 M€» y no 1.007.800.000. Siempre en millones, también por
 * encima del billón (una capitalización de 3,5 billones de dólares es «3.500.000,0 M USD»): una «B» de billón se
 * confunde con el *billion* inglés, que son mil millones (FMT-07).
 */
export function importeGrande(valor: unknown, divisa: unknown): string {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  return formato.oFalta(formato.importeGrande(numero, { divisa: divisaDe(divisa) }));
}
