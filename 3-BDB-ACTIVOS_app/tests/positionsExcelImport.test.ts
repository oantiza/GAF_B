// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { readImportFileText } from "../src/core/importFileReader";
import { parsePositionLines } from "../src/core/positionImport";
import { groupPositionAmounts } from "../src/core/groupPositionAmounts";

describe("importación real de Excel de posiciones globales", () => {
  it.each(["xlsx", "xls"] as const)("lee un libro .%s y acumula por fondo sin perder decimales", async (format) => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ["Cliente", "ISIN", "Instrumento", "Valor de mercado"],
      ["Cliente A", "LU0232524495", "Fondo A", 302.597],
      ["Cliente B", "LU0232524495", "Fondo A", 25000.25],
      ["Cliente C", "LU0524465548", "Fondo B", 4500],
      ["TOTAL", null, null, 29802.847]
    ]), "Posiciones");
    const bytes: ArrayBuffer = write(workbook, { bookType: format === "xls" ? "biff8" : "xlsx", type: "array" });
    const file = new File([bytes], `cartera.${format}`);
    const entries = groupPositionAmounts(parsePositionLines(await readImportFileText(file)));
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("LU0232524495");
    expect(entries[0].amount).toBeCloseTo(25302.847, 3);
    expect(entries[1]).toEqual({ id: "LU0524465548", amount: 4500 });
    expect(JSON.stringify(entries)).not.toContain("Cliente");
  });

  it("mantiene los extractos HTML de Andbank con extensión .xls", async () => {
    const file = new File(['<table><tr><td>ISIN</td><td>Valor de mercado</td></tr><tr><td>LU0232524495</td><td>1.234,56</td></tr></table>'], "andbank.xls");
    expect(parsePositionLines(await readImportFileText(file))).toEqual([{ id: "LU0232524495", amount: 1234.56 }]);
  });

  /* S-15 (auditoría 29-09): con SheetJS como único lector, las fechas de un
     .xlsx deben salir en dd/mm/aaaa del día correcto también en hora peninsular
     (SheetJS las devuelve en hora local salvo con `UTC: true`). */
  it("lee las fechas de un .xlsx en el día correcto aunque la zona horaria no sea UTC", async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/Madrid";
    try {
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, utils.aoa_to_sheet([
        ["Fecha", "ISIN", "Importe"],
        [{ t: "n", v: 46268, z: "dd/mm/yyyy" }, "LU0232524495", 1000]
      ]), "Movimientos");
      const file = new File([write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer], "movs.xlsx");
      expect((await readImportFileText(file)).split("\n")[1]).toBe("03/09/2026;LU0232524495;1000");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("rechaza un .xlsx que no es un libro (SheetJS lo leería como texto)", async () => {
    const file = new File(["ISIN;Importe\nLU0232524495;1000"], "falso.xlsx");
    await expect(readImportFileText(file)).rejects.toThrow("No se pudo leer el fichero .xlsx");
  });

  it("explica el error si un .xls binario está dañado", async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], "roto.xls");
    await expect(readImportFileText(file)).rejects.toThrow("No se pudo leer el fichero .xls");
  });
});
