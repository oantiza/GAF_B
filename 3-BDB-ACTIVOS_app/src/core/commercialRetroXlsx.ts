/**
 * Escritor mínimo de .xlsx para las retrocesiones: tres columnas
 * (nombre · isin · retro) con la retrocesión como fracción y formato de
 * porcentaje, que es exactamente el formato del fichero con el que se trabaja
 * en Excel. La importación lo reconoce como «fracción» y lo convierte.
 *
 * S-15 (auditoría 29-09): antes generaba el OOXML a mano y lo comprimía con
 * fflate; ahora usa SheetJS (`xlsx`), el único lector/escritor de hojas de
 * cálculo de la app, cargado bajo demanda para no tocar el presupuesto del
 * bundle inicial. El resultado es equivalente: hoja «Retrocesiones», cabecera
 * en minúsculas, celdas de texto en nombre/isin y numérica con `0.00%` en retro.
 */

import type { WorkSheet } from "xlsx";

export interface CommercialRetroXlsxRow {
  nombre?: string;
  isin: string;
  /** Retrocesión en porcentaje (0,80 = 0,80 %). */
  retro_pct: number;
}

export const COMMERCIAL_RETRO_SHEET_NAME = "Retrocesiones";

/** Formato de la columna retro: la celda guarda 0,008 y Excel muestra 0,80 %. */
export const COMMERCIAL_RETRO_PERCENT_FORMAT = "0.00%";

export const COMMERCIAL_RETRO_TEMPLATE_ROWS: readonly CommercialRetroXlsxRow[] = [
  { nombre: "Ejemplo Fondo A Acc EUR", isin: "LU0000000001", retro_pct: 0.8 },
  { nombre: "Ejemplo Fondo Clase Limpia", isin: "IE0000000002", retro_pct: 0 }
];

/** Fracción con 8 decimales, como la que escribía el generador anterior. */
export function commercialRetroFraction(retro_pct: number): number {
  return Math.round((retro_pct / 100) * 1e8) / 1e8;
}

/** Hoja SheetJS con las tres columnas y el formato de porcentaje en la tercera. */
export async function buildCommercialRetroWorksheet(rows: readonly CommercialRetroXlsxRow[]): Promise<WorkSheet> {
  const { utils } = await import("xlsx");
  const sheet = utils.aoa_to_sheet([
    ["nombre", "isin", "retro"],
    ...rows.map((row) => [
      row.nombre ?? "",
      row.isin,
      { t: "n", v: commercialRetroFraction(row.retro_pct), z: COMMERCIAL_RETRO_PERCENT_FORMAT }
    ])
  ]);
  sheet["!cols"] = [{ wch: 44 }, { wch: 16 }, { wch: 10 }];
  return sheet;
}

export async function buildCommercialRetroXlsx(rows: readonly CommercialRetroXlsxRow[]): Promise<Uint8Array> {
  const { utils, write } = await import("xlsx");
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, await buildCommercialRetroWorksheet(rows), COMMERCIAL_RETRO_SHEET_NAME);
  return new Uint8Array(write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}
