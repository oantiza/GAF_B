/**
 * Las celdas del Excel del gestor, sin SheetJS: cada hoja devuelve filas de estas celdas y
 * `libro.ts` las convierte. Las cifras van como números de verdad, con su formato; una cifra
 * que falta va como celda vacía, nunca como un cero.
 */
import type { Dia } from "../../motor/fechas";
import type { DatosDelInforme } from "../tipos";

export type FormatoDeCelda = "importe" | "porcentaje" | "puntos" | "titulos" | "precio" | "entero" | "fecha" | "decimal";

export type Celda = string | number | null | { valor: number | null; formato: FormatoDeCelda };

export interface HojaDelExcel {
  /** Nombre de la pestaña: 31 caracteres como mucho, sin «: \ / ? * [ ]». */
  nombre: string;
  /** Ancho de cada columna, en caracteres. */
  anchos: number[];
  /** Filas de la hoja; la primera es la cabecera. */
  filas(datos: DatosDelInforme): Celda[][];
  /** Cuántas filas, contando la cabecera, cubre el filtro automático. Sin él, todas. */
  filasDelFiltro?(datos: DatosDelInforme): number;
}

const conFormato = (formato: FormatoDeCelda) => (valor: number | null | undefined): Celda => ({ valor: typeof valor === "number" && Number.isFinite(valor) ? valor : null, formato });

export const importe = conFormato("importe");
export const porcentaje = conFormato("porcentaje");
/** Una diferencia de rentabilidades en puntos porcentuales: la fracción 0,0123 se escribe 1,23 pp, como en el resto de la app. */
export const puntos = (fraccion: number | null | undefined): Celda => conFormato("puntos")(typeof fraccion === "number" ? fraccion * 100 : fraccion);
export const titulos = conFormato("titulos");
export const precio = conFormato("precio");
export const entero = conFormato("entero");
export const decimal = conFormato("decimal");

/** Una fecha «AAAA-MM-DD» como fecha de Excel (número de serie con formato de fecha). */
export function fecha(dia: Dia | undefined): Celda {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const [a, m, d] = dia.split("-").map(Number);
  return { valor: (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000, formato: "fecha" };
}

export const FORMATOS: Record<FormatoDeCelda, string> = {
  importe: "#,##0.00",
  porcentaje: "0.00%",
  puntos: '0.00" pp"',
  titulos: "#,##0.00####",
  precio: "#,##0.00##",
  entero: "0",
  fecha: "dd/mm/yyyy",
  decimal: "0.00"
};
