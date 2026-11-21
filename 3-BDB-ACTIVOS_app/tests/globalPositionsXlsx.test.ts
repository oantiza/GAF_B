import { expect, test } from "vitest";
import { read, utils } from "xlsx";
import { buildGlobalPositionsXlsx, type GlobalPositionExportRow } from "../src/core/globalPositionsXlsx";

const rows: GlobalPositionExportRow[] = [
  { id: "LU0232524495", name: "Fondo A", amount: 3000.75, retroPct: 0.5, cessionPct: 0.25, incomeEur: 7.501875, status: "found" },
  { id: "LU0524465548", name: "=Fondo sin tarifa", amount: 400, retroPct: null, cessionPct: null, incomeEur: null, status: "missing" }
];

test("exporta números y porcentajes reales, lo que falta en celdas vacías, y sumatorios con valores precalculados", async () => {
  const workbook = read(await buildGlobalPositionsXlsx(rows), { type: "array", cellNF: true });
  const sheet = workbook.Sheets["Posiciones globales"];
  expect(sheet.C2.v).toBe(3000.75);
  expect(sheet.D2.v).toBe(0.005);
  expect(sheet.D2.z).toBe("0.00%");
  expect(sheet.E2.v).toBe(0.0025);
  expect(sheet.F2.v).toBe(7.501875);
  /* INF-16: antes se escribía «N/D» como texto en las tres columnas de cifras; ahora la celda no existe. */
  expect(sheet.D3).toBeUndefined();
  expect(sheet.E3).toBeUndefined();
  expect(sheet.F3).toBeUndefined();
  expect(sheet.A3.t).toBe("s");
  expect(sheet.A3.f).toBeUndefined();
  expect(sheet.C4).toMatchObject({ f: "SUM(C2:C3)", v: 3400.75 });
  expect(sheet.F4).toMatchObject({ f: "SUM(F2:F3)", v: 7.501875 });
});

test("exporta exclusivamente las filas recibidas y conserva su orden", async () => {
  const sheet = read(await buildGlobalPositionsXlsx([rows[1]]), { type: "array" }).Sheets["Posiciones globales"];
  expect(sheet.B2.v).toBe(rows[1].id);
  expect(sheet.C3.v).toBe(400);
  /* Sin ningún ingreso conocido, el total de ingresos no se escribe. */
  expect(sheet.F3).toBeUndefined();
  expect(JSON.stringify(utils.sheet_to_json(sheet))).not.toContain(rows[0].id);
});

test("ninguna columna de cifras mezcla texto y número", async () => {
  const sheet = read(await buildGlobalPositionsXlsx(rows), { type: "array" }).Sheets["Posiciones globales"];
  for (const columna of ["C", "D", "E", "F"]) {
    for (const fila of [2, 3, 4]) {
      const celda = sheet[`${columna}${fila}`];
      if (celda) expect(celda.t, `${columna}${fila}`).toBe("n");
    }
  }
  expect(JSON.stringify(utils.sheet_to_json(sheet, { header: 1 }))).not.toContain("N/D");
});

test("en modo cliente exporta solo las columnas visibles sin datos comerciales", async () => {
  const sheet = read(await buildGlobalPositionsXlsx(rows, true), { type: "array" }).Sheets["Posiciones globales"];
  const data = utils.sheet_to_json(sheet, { header: 1 });
  expect(data[0]).toEqual(["Fondo", "ISIN", "Importe EUR", "Estado"]);
  expect(sheet.C4.v).toBe(3400.75);
  expect(sheet.E2).toBeUndefined();
  expect(JSON.stringify(data)).not.toMatch(/Retrocesión|Cesión|Ingreso/);
});
