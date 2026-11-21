/**
 * El registro de hojas del Excel del gestor.
 *
 * AÑADIR UNA HOJA: crea su módulo en esta carpeta (nombre de la pestaña, anchos y sus filas a
 * partir de los datos del informe, con la cabecera como primera fila) y añádela a la lista.
 * `libro.ts` la convierte con sus formatos de celda. Como los informes, no calcula: escribe
 * las cifras del `Analisis`.
 */
import { hojaCerradas } from "./cerradas";
import type { HojaDelExcel } from "./celdas";
import { hojaComposicion } from "./composicion";
import { hojaConciliacion } from "./conciliacion";
import { hojaEfectivo } from "./efectivo";
import { hojaIngresosYCostes } from "./ingresosYCostes";
import { hojaMovimientos } from "./movimientos";
import { hojaPosiciones } from "./posiciones";
import { hojaRentabilidadMensual } from "./rentabilidadMensual";
import { hojaResumen } from "./resumen";

export const HOJAS_DEL_EXCEL: readonly HojaDelExcel[] = [
  hojaResumen,
  hojaPosiciones,
  hojaEfectivo,
  hojaMovimientos,
  hojaRentabilidadMensual,
  hojaIngresosYCostes,
  hojaCerradas,
  hojaComposicion,
  hojaConciliacion
];

if (new Set(HOJAS_DEL_EXCEL.map((hoja) => hoja.nombre)).size !== HOJAS_DEL_EXCEL.length) throw new Error("Hay dos hojas del Excel con el mismo nombre.");

export type { Celda, FormatoDeCelda, HojaDelExcel } from "./celdas";
