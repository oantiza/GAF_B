/**
 * Las frases del ciclo de vida de la cartera activa. Aparte de `carteraActiva.ts`, que está en la carga
 * inicial: esto solo lo leen el diálogo y Diseño de cartera, que se cargan después.
 */

import { fecha as escribirFecha, fechaYHora, oFalta } from "./formato";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * La línea fija antes de aplicar una propuesta. Decisión 45 de Óscar (05-11-2026): hay fondos con entrada del 5 %, y
 * hasta ahora no se decía nada. Sale igual en Modo cliente, y este es el único sitio donde vive el texto.
 *
 * **PROVISIONAL hasta que cumplimiento la revise.** Dice un hecho, pero no sustituye a su redacción: cuando la haya,
 * se cambia aquí. Las comisiones llevan la denominación de toda la aplicación, «entrada (suscripción)» y «salida (reembolso)»
 * (Óscar, 11-11-2026), la misma que `LO_QUE_NO_INCLUYE_EL_COSTE`.
 */
export const SIN_COMISIONES_NI_IMPUESTOS = "No incluye comisiones de entrada (suscripción) o salida (reembolso) ni impuestos por el cambio.";

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «Guardada hoy 12:30», «Guardada ayer 18:02» o «Guardada el 03/11/2026 12:30», en hora local. */
export function textoDeGuardada(fecha: string, ahora: Date = new Date()): string {
  const guardada = new Date(fecha);
  if (Number.isNaN(guardada.getTime())) return "Guardada";
  /* La fecha y la hora del módulo único, «03/11/2026 12:30»; la hora sola son sus cinco últimas cifras. */
  const momento = oFalta(fechaYHora(guardada));
  const hora = momento.slice(-5);
  if (mismoDia(guardada, ahora)) return `Guardada hoy ${hora}`;
  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  if (mismoDia(guardada, ayer)) return `Guardada ayer ${hora}`;
  return `Guardada el ${momento}`;
}

/**
 * El día de una cartera guardada en la lista, en la hora de quien mira, como la cabecera: a las 00:05 la cabecera
 * decía «Guardada hoy» y la lista, con el día de Greenwich, el anterior.
 */
export function diaDeGuardada(fecha: string): string {
  const guardada = new Date(fecha);
  if (Number.isNaN(guardada.getTime())) return textoDeAusencia("falta");
  return oFalta(escribirFecha(guardada));
}

/** La pregunta antes de sustituir o perder lo que hay. Sin nombre, se habla de «la cartera activa». */
export function tituloDeCambiosSinGuardar(nombre: string): string {
  const limpio = nombre.trim();
  return limpio ? `La cartera ${limpio} tiene cambios sin guardar` : "La cartera activa tiene cambios sin guardar";
}
