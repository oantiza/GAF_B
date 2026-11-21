/**
 * El libro de Excel: cada hoja del registro, convertida con SheetJS. Las cifras van como
 * números con formato de celda; los textos, como texto; una cifra que falta, como celda vacía.
 *
 * SheetJS (edición comunitaria) no escribe paneles inmovilizados: en su lugar, la fila de
 * cabecera lleva filtro automático, que en Excel también la señala y la deja a mano.
 */
import type { WorkSheet } from "xlsx";
import type { DatosDelInforme } from "../tipos";
import { FORMATOS, type Celda, type HojaDelExcel } from "./celdas";
import { HOJAS_DEL_EXCEL } from "./registro";

type CeldaDeSheetJs = { t: "n"; v: number; z?: string } | { t: "s"; v: string };

function convertir(celda: Celda): CeldaDeSheetJs | undefined {
  if (celda === null || celda === undefined || celda === "") return undefined;
  if (typeof celda === "string") return { t: "s", v: celda };
  if (typeof celda === "number") return Number.isFinite(celda) ? { t: "n", v: celda } : undefined;
  if (celda.valor === null || !Number.isFinite(celda.valor)) return undefined;
  return { t: "n", v: celda.valor, z: FORMATOS[celda.formato] };
}

export async function crearLibroExcel(datos: DatosDelInforme, hojas: readonly HojaDelExcel[] = HOJAS_DEL_EXCEL): Promise<Uint8Array> {
  const { utils, write } = await import("xlsx");
  const libro = utils.book_new();
  for (const hoja of hojas) {
    const filas = hoja.filas(datos);
    const columnas = Math.max(1, hoja.anchos.length, ...filas.map((fila) => fila.length));
    const hojaDeCalculo: WorkSheet = {};
    filas.forEach((fila, f) => {
      fila.forEach((celda, c) => {
        const convertida = convertir(celda);
        if (convertida) hojaDeCalculo[utils.encode_cell({ r: f, c })] = convertida;
      });
    });
    const ultima = utils.encode_cell({ r: Math.max(0, filas.length - 1), c: columnas - 1 });
    hojaDeCalculo["!ref"] = `A1:${ultima}`;
    hojaDeCalculo["!cols"] = Array.from({ length: columnas }, (_, c) => ({ wch: hoja.anchos[c] ?? 12 }));
    const conFiltro = Math.min(filas.length, hoja.filasDelFiltro?.(datos) ?? filas.length);
    if (conFiltro > 1) hojaDeCalculo["!autofilter"] = { ref: `A1:${utils.encode_cell({ r: conFiltro - 1, c: Math.max(0, (filas[0]?.length ?? 1) - 1) })}` };
    utils.book_append_sheet(libro, hojaDeCalculo, hoja.nombre);
  }
  return new Uint8Array(write(libro, { type: "array", bookType: "xlsx" }));
}
