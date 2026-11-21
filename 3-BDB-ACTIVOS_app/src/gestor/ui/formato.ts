/**
 * Cómo escribe el gestor sus cifras en pantalla. No tiene formato propio: cada función delega en el
 * módulo único (`src/core/formato.ts`) y conserva su nombre y su firma para no mover a quien la
 * llama. Solo aquí se redondea; el motor trabaja con todos los decimales.
 *
 * Una cifra que no es un número (ausente, NaN, infinita) se escribe con el texto común de un
 * dato que falta, «Falta el dato» (`oFalta`), sin unidad ni signo: nunca «NaN €».
 */
import * as formato from "../../core/formato";
import { oFalta, signoDe } from "../../core/formato";
import { leerCifra, type Decimal } from "../motor/decimal";
import { hoy as hoyLocal, type Dia } from "../motor/fechas";
import type { FormatoDeMetrica } from "../motor/metricas/tipos";

function esCifra(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Un importe con su divisa: «1.234,56 €», «−120,00 USD», «5.000,00 CHF». */
export function importe(valor: number, divisa = "EUR", decimales = 2): string {
  return oFalta(formato.importe(valor, { divisa, decimales }));
}

/** Un importe grande sin céntimos, para titulares: «1.234.567 €». */
export function importeRedondo(valor: number, divisa = "EUR"): string {
  return importe(valor, divisa, 0);
}

/** Un importe con su signo siempre a la vista: «+1.234,56 €», «−120,00 €». */
export function importeConSigno(valor: number, divisa = "EUR", decimales = 2): string {
  return oFalta(formato.importe(valor, { divisa, decimales, conSigno: true }));
}

/** Un porcentaje a partir de una fracción: 0,1234 → «12,34 %». */
export function porcentaje(fraccion: number, decimales = 2): string {
  return oFalta(formato.porcentaje(fraccion, { decimales }));
}

export function porcentajeConSigno(fraccion: number, decimales = 2): string {
  return oFalta(formato.porcentaje(fraccion, { decimales, conSigno: true }));
}

/**
 * Una diferencia en puntos porcentuales: 0,0123 → «+1,23 pp». Con otros decimales que los dos de la regla, el
 * porcentaje con signo del módulo único con «pp» por unidad (el módulo único no tiene esa opción en `puntos`).
 */
export function puntos(fraccion: number, decimales = 2): string {
  if (decimales === 2) return oFalta(formato.puntos(fraccion));
  return oFalta(formato.porcentaje(fraccion, { decimales, conSigno: true })?.replace(/%$/, "pp"));
}

/** Un número sin unidad: «1,25». Con dos decimales es el `ratio` del módulo único. */
export function ratio(valor: number, decimales = 2): string {
  return oFalta(formato.numero(valor, { decimales }));
}

/** Títulos o participaciones: los decimales que tengan, hasta seis, sin ceros de relleno. */
export function titulos(valor: Decimal | number): string {
  return oFalta(formato.titulos(valor));
}

/** Un precio: entre dos y cuatro decimales; sin divisa, sin unidad. */
export function precio(valor: number, divisa?: string): string {
  return oFalta(formato.precio(valor, { divisa: divisa ? divisa : null }));
}

/** «13/11/2026»: la fecha de tabla y de detalle del módulo único (antes, «13 nov 2026»). */
export function fecha(dia: Dia): string {
  return oFalta(formato.fecha(dia));
}

/** «13 de noviembre de 2026». */
export function fechaLarga(dia: Dia): string {
  return oFalta(formato.fechaLarga(dia));
}

/** «13/11/2026», para columnas de tabla. */
export function fechaCorta(dia: Dia): string {
  return oFalta(formato.fecha(dia));
}

/**
 * Cómo se ha leído una cifra tecleada, cuando el texto admite dos lecturas (GES-22): un solo punto
 * sin coma («105.123» son ciento cinco mil ciento veintitrés; «12.5», doce y medio) o una sola
 * coma con tres cifras detrás («1,234» es uno coma dos tres cuatro, no mil doscientos). Devuelve
 * «Leído como 105.123,00.», o nada si el texto no es ambiguo o no es una cifra. No cambia la regla
 * de lectura (`leerCifra`): solo la enseña.
 */
export function lecturaDeUnaCifraAmbigua(texto: string): string | undefined {
  const limpio = texto.replace(/[\s€$%]/g, "").replace(/^[+\-−]/, "");
  if (!/^\d+\.\d+$/.test(limpio) && !/^\d+,\d{3}$/.test(limpio)) return undefined;
  const leida = leerCifra(texto);
  if (!leida) return undefined;
  const escrita = titulos(leida);
  return `Leído como ${escrita.includes(",") ? escrita : `${escrita},00`}.`;
}

/**
 * El día LOCAL de un instante guardado en ISO («2026-03-14T23:30:00.000Z»), no el de UTC: lo
 * guardado entre las 00:00 y las 01:00 o 02:00 en España es de ese día, no del anterior (GES-23).
 */
export function diaDeUnInstante(instante: string): Dia {
  const momento = new Date(instante);
  return Number.isNaN(momento.getTime()) ? instante.slice(0, 10) : hoyLocal(momento);
}

/** Los meses de la tabla de rentabilidad por meses: los del módulo único. */
export const NOMBRE_DEL_MES = formato.MESES_CORTOS;

/** El valor de una métrica, escrito según su formato. */
export function valorDeMetrica(valor: number, formato: FormatoDeMetrica, divisa: string, conSigno: boolean): string {
  switch (formato) {
    case "importe":
      return conSigno ? importeConSigno(valor, divisa) : importe(valor, divisa);
    case "porcentaje":
      return conSigno ? porcentajeConSigno(valor) : porcentaje(valor);
    case "puntos":
      return puntos(valor);
    case "ratio":
      return ratio(valor);
  }
}

/**
 * La clase de color de una cifra con signo: verde si sube, rojo si baja, nada si es cero. El signo es el de
 * `signoDe` del módulo único, sobre la fracción redondeada a los decimales del porcentaje que se pinta (dos de
 * porcentaje son cuatro de fracción): el color y el texto no pueden discrepar.
 */
export function claseDelSigno(valor: number | null | undefined, decimales = 2): string {
  const signo = signoDe(valor, decimales + 2);
  return signo === "sube" ? "gestor-sube" : signo === "baja" ? "gestor-baja" : "";
}

/**
 * La clase de color de una cifra ya escrita: un cero pintado no tiene color. Si en el texto no
 * hay ninguna cifra distinta de cero («0,00 €», «0 €», «0,0 %»), no hay color, sea cual sea el
 * valor sin redondear; si la hay, el color es el del signo del valor. Así el color sale de los
 * decimales que se pintan, sean de un importe o de un porcentaje.
 */
export function claseDelSignoEscrito(valor: number | null | undefined, texto: string): string {
  if (!esCifra(valor) || !/[1-9]/.test(texto)) return "";
  return valor > 0 ? "gestor-sube" : valor < 0 ? "gestor-baja" : "";
}
