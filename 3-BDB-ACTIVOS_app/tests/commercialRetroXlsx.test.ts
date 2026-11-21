import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { buildCommercialRetroWorksheet, buildCommercialRetroXlsx, COMMERCIAL_RETRO_TEMPLATE_ROWS } from "../src/core/commercialRetroXlsx";
import { interpretCommercialRetroSheet, readCommercialRetroExcel } from "../src/core/commercialRetroCsv";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("Excel de retrocesiones (escritor y lectura de ida y vuelta)", () => {
  it("escribe la retrocesión como fracción con formato % y la importación la reconoce", async () => {
    const bytes = await buildCommercialRetroXlsx([
      { nombre: "Fondo Alfa A Acc EUR", isin: "LU0000000001", retro_pct: 0.8 },
      { nombre: "Fondo Beta & Gamma", isin: "IE0000000002", retro_pct: 1.4634 },
      { nombre: "Clase limpia", isin: "ES0000000003", retro_pct: 0 }
    ]);
    const sheet = await readCommercialRetroExcel(toArrayBuffer(bytes));

    expect(sheet.sheet_names).toEqual(["Retrocesiones"]);
    expect(sheet.columns).toMatchObject({ header_row: 1, nombre: 0, isin: 1, retro: 2 });
    // Las celdas guardan 0,008, 0,014634 y 0: todo por debajo de 0,2 -> fracción.
    expect(sheet.suggested_scale).toBe("fraccion");

    const parsed = interpretCommercialRetroSheet(sheet, { scale: sheet.suggested_scale, as_of_date: "2026-09-05" });
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct, entry.name])).toEqual([
      ["LU0000000001", 0.8, "Fondo Alfa A Acc EUR"],
      ["IE0000000002", 1.4634, "Fondo Beta & Gamma"],
      ["ES0000000003", 0, "Clase limpia"]
    ]);
    expect(parsed.zero_isins).toEqual(["ES0000000003"]);
  });

  it("la plantilla es un fichero válido con el mismo formato de tres columnas", async () => {
    const sheet = await readCommercialRetroExcel(toArrayBuffer(await buildCommercialRetroXlsx(COMMERCIAL_RETRO_TEMPLATE_ROWS)));
    expect(sheet.columns).not.toBeNull();
    expect(sheet.rows[0].fields).toEqual(["nombre", "isin", "retro"]);
    const parsed = interpretCommercialRetroSheet(sheet, { scale: sheet.suggested_scale, as_of_date: "2026-09-05" });
    expect(parsed.entries).toHaveLength(COMMERCIAL_RETRO_TEMPLATE_ROWS.length);
  });

  /* S-15 (auditoría 29-09): el escritor pasa a SheetJS; se comprueba la hoja
     generada y que el fichero conserva el formato de porcentaje al releerlo. */
  it("conserva los nombres con caracteres especiales y aplica el formato de porcentaje a la columna de retrocesión", async () => {
    const sheet = await buildCommercialRetroWorksheet([{ nombre: "A & B <C>", isin: "LU0000000001", retro_pct: 0.5 }]);
    expect(sheet.A2).toMatchObject({ t: "s", v: "A & B <C>" });
    expect(sheet.C2).toMatchObject({ t: "n", v: 0.005, z: "0.00%" });
    expect(sheet["!cols"]?.map((col) => col.wch)).toEqual([44, 16, 10]);

    const bytes = await buildCommercialRetroXlsx([{ nombre: "A & B <C>", isin: "LU0000000001", retro_pct: 0.5 }]);
    const workbook = read(bytes, { type: "array", cellNF: true });
    expect(workbook.SheetNames).toEqual(["Retrocesiones"]);
    const reread = workbook.Sheets.Retrocesiones;
    expect(reread.A2.v).toBe("A & B <C>");
    expect(reread.C2).toMatchObject({ v: 0.005, z: "0.00%", w: "0.50%" });
    expect(utils.sheet_to_json(reread, { header: 1 })).toEqual([["nombre", "isin", "retro"], ["A & B <C>", "LU0000000001", 0.005]]);
  });
});
