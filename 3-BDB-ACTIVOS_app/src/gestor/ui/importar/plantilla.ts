/**
 * La plantilla genérica de movimientos, para descargar desde el asistente: en CSV (solo la
 * hoja de movimientos) o en Excel (las tres hojas). Se genera en el navegador; `xlsx` se
 * carga solo al pedir el Excel.
 */
import { descargar, nombreDelFichero } from "../../../core/descargaDeFicheros";
import { hojasDeLaPlantilla, plantillaCsv } from "../../importacion/plantilla";

/* Una plantilla en blanco no es de nadie ni de ningún día: solo el documento. */
export const NOMBRE_DE_LA_PLANTILLA_CSV = nombreDelFichero({ documento: "Plantilla de movimientos", extension: "csv" });
export const NOMBRE_DE_LA_PLANTILLA_EXCEL = nombreDelFichero({ documento: "Plantilla de movimientos", extension: "xlsx" });

export function descargarPlantillaCsv(): void {
  descargar(new Blob([plantillaCsv()], { type: "text/csv;charset=utf-8" }), NOMBRE_DE_LA_PLANTILLA_CSV);
}

export async function descargarPlantillaExcel(): Promise<void> {
  const { utils, write } = await import("xlsx");
  const libro = utils.book_new();
  for (const hoja of hojasDeLaPlantilla()) utils.book_append_sheet(libro, utils.aoa_to_sheet(hoja.filas), hoja.nombre);
  const bytes = write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  descargar(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), NOMBRE_DE_LA_PLANTILLA_EXCEL);
}
