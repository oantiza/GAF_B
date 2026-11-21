/**
 * Los informes del gestor de carteras: el PDF del cliente, el de costes, el del asesor y el Excel de
 * datos, generados en el navegador a partir de un `Analisis`. No calculan nada: imprimen el
 * análisis y la lista de movimientos de la cartera.
 *
 * `@react-pdf/renderer` y `xlsx` se cargan aquí dentro, al generar, para que no entren en la
 * carga inicial de la aplicación. Lo único estático de este módulo es ligero: tipos, la lista
 * de movimientos del periodo y los nombres de fichero.
 */
import { descargar } from "../../core/descargaDeFicheros";
import { nombreDelFichero } from "./nombres";
import type { DatosDelInforme, TipoDeInforme } from "./tipos";

export { movimientosDelPeriodo } from "./movimientos";
export { nombreDelFichero, sanearNombreDeFichero } from "./nombres";
export type { DatosDelInforme, MovimientoDelInforme, SeccionDeInforme, TipoDeInforme } from "./tipos";

const TIPO_DEL_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function crearInformePdf(tipo: TipoDeInforme, datos: DatosDelInforme): Promise<Blob> {
  const { renderizarInforme } = await import("./documento");
  return renderizarInforme(tipo, datos);
}

export async function crearExcel(datos: DatosDelInforme): Promise<Blob> {
  const { crearLibroExcel } = await import("./excel/libro");
  const bytes = await crearLibroExcel(datos);
  return new Blob([bytes.buffer as ArrayBuffer], { type: TIPO_DEL_EXCEL });
}

/** Genera y descarga el PDF. Devuelve el nombre del fichero. */
export async function descargarInformePdf(tipo: TipoDeInforme, datos: DatosDelInforme): Promise<string> {
  const nombre = nombreDelFichero(tipo, datos.analisis);
  descargar(await crearInformePdf(tipo, datos), nombre);
  return nombre;
}

/** Genera y descarga el Excel. Devuelve el nombre del fichero. */
export async function descargarExcel(datos: DatosDelInforme): Promise<string> {
  const nombre = nombreDelFichero("excel", datos.analisis);
  descargar(await crearExcel(datos), nombre);
  return nombre;
}
