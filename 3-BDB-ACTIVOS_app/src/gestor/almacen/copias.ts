/**
 * Copias de seguridad de las carteras: cómo se llaman y cuáles se conservan.
 *
 * Una copia vive en `copias/<id de la cartera>/<marca>.cartera.json`, donde la marca es la
 * fecha y hora UTC en que se hizo, con guiones en lugar de dos puntos (Windows no admite «:»
 * en un nombre): «2026-11-13T15-04-22Z.cartera.json». Va en UTC para que el orden por nombre
 * sea el orden en el tiempo también cuando cambia la hora de verano. Si dos copias cayeran en
 * el mismo segundo, la segunda lleva «-2», la tercera «-3»…
 *
 * Este módulo no toca el disco: son funciones puras, probadas aparte.
 */
import type { CopiaDeSeguridad } from "./almacen";
import { EXTENSION_DE_CARTERA } from "./nombres";

/** Las copias más recientes que se conservan siempre. */
export const COPIAS_RECIENTES = 20;
/** Días hacia atrás en los que se conserva, además, la última copia de cada día. */
export const DIAS_DE_RETENCION = 90;
/** Tiempo mínimo entre dos copias automáticas de la misma cartera. */
export const MINUTOS_ENTRE_COPIAS = 10;

const MS_POR_DIA = 86_400_000;
const FORMA_DE_COPIA = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-\d+)?\.cartera\.json$/i;

/** La marca de una fecha para el nombre de una copia: «2026-11-13T15-04-22Z». */
export function marcaDeTiempo(fecha: Date): string {
  return `${fecha.toISOString().slice(0, 19).replace(/:/g, "-")}Z`;
}

/** El nombre de fichero de una copia hecha en `fecha`, con su desempate si hace falta (2, 3…). */
export function nombreDeCopia(fecha: Date, desempate?: number): string {
  return `${marcaDeTiempo(fecha)}${desempate === undefined ? "" : `-${desempate}`}${EXTENSION_DE_CARTERA}`;
}

/** La fecha ISO de una copia a partir de su nombre, o `undefined` si el nombre no es de una copia. */
export function fechaDeCopia(nombre: string): string | undefined {
  const partes = FORMA_DE_COPIA.exec(nombre);
  if (partes === null) return undefined;
  const fecha = new Date(`${partes[1]}T${partes[2]}:${partes[3]}:${partes[4]}Z`);
  return Number.isFinite(fecha.getTime()) ? fecha.toISOString() : undefined;
}

function instante(copia: CopiaDeSeguridad): number {
  const ms = Date.parse(copia.fecha);
  return Number.isFinite(ms) ? ms : 0;
}

/** Las copias de la más reciente a la más antigua; a igual fecha, por nombre de fichero descendente. */
export function ordenarCopias(copias: readonly CopiaDeSeguridad[]): CopiaDeSeguridad[] {
  return [...copias].sort((a, b) => instante(b) - instante(a) || (a.fichero < b.fichero ? 1 : a.fichero > b.fichero ? -1 : 0));
}

/**
 * Las copias que se conservan, de la más reciente a la más antigua:
 * - las `COPIAS_RECIENTES` (20) más recientes, siempre;
 * - de las anteriores, la última de cada día (UTC) de los últimos `DIAS_DE_RETENCION` (90)
 *   días contados desde `ahora`, salvo que ese día ya esté representado por una copia que se
 *   conserva: el fin es tener al menos una versión por día, no dos.
 * Lo demás puede eliminarse.
 */
export function copiasAConservar(copias: readonly CopiaDeSeguridad[], ahora: Date): CopiaDeSeguridad[] {
  const ordenadas = ordenarCopias(copias);
  const conservadas = ordenadas.slice(0, COPIAS_RECIENTES);
  const diasCubiertos = new Set(conservadas.map((copia) => new Date(instante(copia)).toISOString().slice(0, 10)));
  const limite = ahora.getTime() - DIAS_DE_RETENCION * MS_POR_DIA;
  for (const copia of ordenadas.slice(COPIAS_RECIENTES)) {
    const ms = instante(copia);
    if (ms < limite) continue;
    const dia = new Date(ms).toISOString().slice(0, 10);
    if (diasCubiertos.has(dia)) continue;
    diasCubiertos.add(dia);
    conservadas.push(copia);
  }
  return conservadas;
}

/** Si toca hacer una copia nueva: no hay ninguna, o la última tiene más de `MINUTOS_ENTRE_COPIAS`. */
export function tocaCopia(copias: readonly CopiaDeSeguridad[], ahora: Date): boolean {
  if (copias.length === 0) return true;
  const ultima = instante(ordenarCopias(copias)[0]);
  return ahora.getTime() - ultima > MINUTOS_ENTRE_COPIAS * 60_000;
}
