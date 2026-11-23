/**
 * Textos y pequeñas transformaciones que comparten varias vistas del gestor.
 *
 * Las cifras y las fechas que van dentro de una frase (un apunte, un subtítulo, el nombre de un botón) se escriben con
 * `escrito`, que es el módulo común de formato (`src/core/formato.ts`) con el texto de ausencia puesto: donde hay sitio
 * para una pieza, la cifra va con `Cifra` y lo que falta con `Ausencia`. `./formato.ts` se queda con lo que es solo del
 * gestor: leer lo que teclea el usuario y el día local de un instante.
 */
import * as formato from "../../core/formato";
import { d } from "../motor/decimal";
import type { Metrica } from "../motor/metricas/tipos";
import type { Movimiento } from "../motor/modelo";
import { nombreDelTipo } from "../motor/movimientos/registro";

/** Reduce una serie larga a unos cuatrocientos puntos, conservando el primero y el último: un gráfico no enseña más. */
export function aclarar<T>(puntos: T[], maximo = 400): T[] {
  if (puntos.length <= maximo) return puntos;
  const paso = (puntos.length - 1) / (maximo - 1);
  return Array.from({ length: maximo }, (_, i) => puntos[Math.round(i * paso)]);
}

/**
 * Cifras y fechas escritas como texto, por el módulo común: «1.234,56 €», «+10,39 %», «24,0 %», «13/11/2026». Si el
 * valor no es una cifra, «Falta el dato».
 */
export const escrito = {
  fecha: (dia: formato.FechaDeEntrada): string => formato.oFalta(formato.fecha(dia)),
  fechaYHora: (instante: formato.FechaDeEntrada): string => formato.oFalta(formato.fechaYHora(instante)),
  /** «del 31/12/2025 al 13/11/2026». */
  periodo: (desde: formato.FechaDeEntrada, hasta: formato.FechaDeEntrada): string => formato.oFalta(formato.periodo(desde, hasta)),
  importe: (valor: number | null | undefined, divisa?: string, decimales?: number): string => formato.oFalta(formato.importe(valor, { divisa, decimales })),
  importeConSigno: (valor: number | null | undefined, divisa?: string, decimales?: number): string =>
    formato.oFalta(formato.importe(valor, { divisa, decimales, conSigno: true })),
  /** Sin decimales: la cifra de un titular o de un apunte. */
  importeTitular: (valor: number | null | undefined, divisa?: string): string => formato.oFalta(formato.importeTitular(valor, { divisa })),
  porcentaje: (fraccion: number | null | undefined, decimales?: number): string => formato.oFalta(formato.porcentaje(fraccion, { decimales })),
  rentabilidad: (fraccion: number | null | undefined): string => formato.oFalta(formato.rentabilidad(fraccion)),
  peso: (fraccion: number | null | undefined): string => formato.oFalta(formato.peso(fraccion)),
  puntos: (diferencia: number | null | undefined): string => formato.oFalta(formato.puntos(diferencia)),
  precio: (valor: number | null | undefined, divisa?: string | null): string => formato.oFalta(formato.precio(valor, { divisa })),
  titulos: (valor: number | { toNumber(): number } | null | undefined): string => formato.oFalta(formato.titulos(valor))
};

/**
 * Lo que dice un movimiento en una línea: «Compra · 100 títulos de Telefónica». La nota del asesor entra solo con `conNota`, que
 * en Modo cliente es falso (`SE_OCULTA.notasDelAsesor`).
 */
export function descripcionDelMovimiento(movimiento: Movimiento, nombreDelActivo: string | undefined, nombreDelDestino?: string, { conNota = true }: { conNota?: boolean } = {}): string {
  const partes = [nombreDelTipo(movimiento.tipo)];
  if (nombreDelActivo) partes.push(movimiento.titulos ? `${escrito.titulos(d(movimiento.titulos))} de ${nombreDelActivo}` : nombreDelActivo);
  if (nombreDelDestino) partes.push(`a ${nombreDelDestino}`);
  if (conNota && movimiento.nota && !nombreDelActivo) partes.push(movimiento.nota);
  return partes.join(" · ");
}

/**
 * El nombre de una métrica en pantalla, con la palabra del glosario (FMT-11). El registro del motor conserva los
 * suyos, que leen también los informes; aquí solo cambia cómo se rotula.
 */
const NOMBRE_EN_PANTALLA: Record<string, string> = {
  rentabilidad: "Rentabilidad de la cartera",
  rentabilidadAnualizada: "Rentabilidad anualizada",
  maximaCaida: "Caída máxima"
};

export function nombreDeMetrica(metrica: Metrica): string {
  return NOMBRE_EN_PANTALLA[metrica.id] ?? metrica.nombre;
}
