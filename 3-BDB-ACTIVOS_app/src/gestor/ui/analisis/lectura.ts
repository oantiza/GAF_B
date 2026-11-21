/**
 * Lo que la pestaña de análisis escribe a partir de las cifras del motor: frases y clases de
 * presentación. No calcula ninguna cifra nueva; solo decide cómo se lee la que ya hay.
 */
import { colorDeLaClasePorNombre } from "../../../core/coloresDeClase";
import { signoDe } from "../../../core/formato";
import type { MaximaCaida } from "../../motor/riesgo";
import { escrito } from "../textos";

/** La caída máxima en una frase: de cuándo a cuándo y si ya se recuperó. */
export function fraseDeLaCaida(caida: MaximaCaida): string {
  if (caida.caida === 0 || !caida.maximo || !caida.minimo) return "En el periodo no ha bajado de ningún máximo anterior.";
  const tramo = `Del ${escrito.fecha(caida.maximo)} al ${escrito.fecha(caida.minimo)}`;
  return caida.recuperacion ? `${tramo}; recuperada el ${escrito.fecha(caida.recuperacion)}.` : `${tramo}; aún sin recuperar.`;
}

/* Cinco intensidades por signo, de punto en punto porcentual, con tope en el 5 % mensual: la escala de antes del
   rediseño (commit 8da9cb9d). Escritas enteras para que el censo de CSS vea su uso. */
const SUBE = ["gestor-mes--sube-1", "gestor-mes--sube-2", "gestor-mes--sube-3", "gestor-mes--sube-4", "gestor-mes--sube-5"];
const BAJA = ["gestor-mes--baja-1", "gestor-mes--baja-2", "gestor-mes--baja-3", "gestor-mes--baja-4", "gestor-mes--baja-5"];

/**
 * La clase de fondo de una casilla de la tabla de meses: verde si el mes gana y rojo si pierde, con cinco intensidades
 * según la magnitud —hasta un 1 % el nivel 1, de un 1 a un 2 % el 2… y del 4 % en adelante el 5—. Es el único sitio de
 * la pantalla donde una casilla lleva fondo; la cifra lleva además su signo escrito, y en las dos intensidades más
 * fuertes la tinta pasa a clara para que se siga leyendo (`gestor-analisis.css`).
 *
 * El signo sale de la cifra tal como se escribe, con dos decimales: lo que se escribe «0,00 %» no lleva fondo (GES-25).
 *
 * Hasta el 14-11-2026 la casilla llevaba un solo fondo suave por signo; ese día Óscar pidió recuperar el color de antes
 * del rediseño («le faltan colores en general»), y con él vuelve cuánto fue de bueno o de malo cada mes a golpe de vista.
 */
export function claseDelMes(rentabilidad: number): string {
  const signo = signoDe(rentabilidad, 4);
  if (signo !== "sube" && signo !== "baja") return "";
  /* La magnitud, en puntos y redondeada como se escribe (dos decimales): un mes que se lee «+3,00 %» es del nivel 3,
     aunque por debajo valga 0,030004; y sin el redondeo, 0,03 × 100 da 3,0000000000000004 y saltaba al 4. */
  const enPuntos = Math.round(Math.abs(rentabilidad) * 10_000) / 100;
  const nivel = Math.min(5, Math.max(1, Math.ceil(enPuntos - 1e-9)));
  return (signo === "sube" ? SUBE : BAJA)[nivel - 1];
}

/* Lo que no es una clase con nombre: el resto y lo que la plataforma no sabe repartir. */
const SIN_CLASE = /^(otros|sin clasificar)$/i;

/**
 * El color de una clase de activo en una lista de partes del gestor («En qué está invertida», «Por clase de activo»):
 * el mismo que lleva esa clase en toda la aplicación (`colorDeLaClasePorNombre`), porque aquí la clase llega por su
 * nombre en pantalla. «Otros» y «Sin clasificar», apagados, en el gris de la referencia (14-11-2026, Óscar: «le faltan
 * colores en general»).
 */
export function colorDeLaParteDeClase(nombre: string): { color?: string; apagada?: boolean } {
  return SIN_CLASE.test(nombre.trim()) ? { apagada: true } : { color: colorDeLaClasePorNombre(nombre) };
}
