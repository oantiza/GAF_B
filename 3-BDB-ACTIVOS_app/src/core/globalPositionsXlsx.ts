import { TEXTO_DEL_ESTADO, type PositionRowStatus } from "./positionsShared";

export interface GlobalPositionExportRow {
  id: string;
  name: string;
  amount: number;
  retroPct: number | null;
  cessionPct: number | null;
  incomeEur: number | null;
  status: PositionRowStatus;
}

/**
 * Recibe las filas ya filtradas y ordenadas de la tabla.
 *
 * Lo que falta va en una **celda vacía**, no en un texto (INF-16): con «N/D» escrito, la columna mezclaba texto y número,
 * y el filtro y la suma de Excel la trataban mal. Es lo que hace el Excel de «Carteras de clientes».
 */
export async function buildGlobalPositionsXlsx(
  rows: readonly GlobalPositionExportRow[],
  clientMode = false
): Promise<Uint8Array> {
  const { utils, write } = await import("xlsx");
  const header = ["Fondo", "ISIN", "Importe EUR", ...(!clientMode ? ["Retrocesión %", "Cesión %", "Ingreso EUR"] : []), "Estado"];
  const values = rows.map((row) => [
    row.name, row.id, row.amount,
    ...(!clientMode ? [row.retroPct == null ? null : row.retroPct / 100, row.cessionPct == null ? null : row.cessionPct / 100, row.incomeEur ?? null] : []),
    TEXTO_DEL_ESTADO[row.status]
  ]);
  const sheet = utils.aoa_to_sheet([header, ...values]);
  const totalRow = rows.length + 2;
  sheet[`A${totalRow}`] = { t: "s", v: "Total visible" };
  sheet[`C${totalRow}`] = {
    t: "n", v: rows.reduce((sum, row) => sum + row.amount, 0),
    ...(rows.length ? { f: `SUM(C2:C${totalRow - 1})` } : {})
  };
  if (!clientMode) {
    /* Sin ningún ingreso conocido no hay total que escribir: la celda queda vacía, como las de arriba. */
    if (rows.some((row) => row.incomeEur != null)) {
      sheet[`F${totalRow}`] = { t: "n", v: rows.reduce((sum, row) => sum + (row.incomeEur ?? 0), 0), f: `SUM(F2:F${totalRow - 1})` };
    }
  }
  for (let row = 2; row <= totalRow; row += 1) {
    for (const col of clientMode ? ["C"] : ["C", "F"]) {
      if (sheet[`${col}${row}`]?.t === "n") sheet[`${col}${row}`].z = '#,##0.00 "€"';
    }
    if (!clientMode) for (const col of ["D", "E"]) {
      if (sheet[`${col}${row}`]?.t === "n") sheet[`${col}${row}`].z = "0.00%";
    }
  }
  sheet["!ref"] = `A1:${clientMode ? "D" : "G"}${totalRow}`;
  sheet["!autofilter"] = { ref: `A1:${clientMode ? "D" : "G"}${rows.length + 1}` };
  sheet["!cols"] = [44, 18, 20, ...(!clientMode ? [18, 18, 20] : []), 20].map((wch) => ({ wch }));
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Posiciones globales");
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}
