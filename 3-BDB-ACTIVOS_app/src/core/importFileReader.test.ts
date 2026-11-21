import { describe, it, expect } from "vitest";
import { spreadsheetRowsToDelimitedText, xlsxCellToText } from "./importFileReader";
import { looksLikeBrokerExport, brokerExportToCanonicalText } from "./brokerPortfolioImport";
import { parseEuropeanNumber } from "./numberFormat";

describe("xlsxCellToText", () => {
  it("emite los números con coma decimal (el punto se confundiría con miles)", () => {
    // Sexta pasada (B4): una cifra menor que mil con justo tres decimales lleva un
    // cero más («302,5970»): «302,597» tiene la forma de unos miles en inglés.
    expect(xlsxCellToText(302.597)).toBe("302,5970");
    expect(xlsxCellToText(1302.597)).toBe("1302,597");
    expect(parseEuropeanNumber(xlsxCellToText(302.597))).toBeCloseTo(302.597, 3);
    expect(xlsxCellToText(14717.97)).toBe("14717,97");
    expect(xlsxCellToText(8736)).toBe("8736");
    expect(xlsxCellToText(-2045.02)).toBe("-2045,02");
  });

  it("fechas en dd/mm/aaaa y vacíos como cadena vacía", () => {
    expect(xlsxCellToText(new Date(Date.UTC(2026, 8, 3)))).toBe("03/09/2026");
    expect(xlsxCellToText(null)).toBe("");
    expect(xlsxCellToText(undefined)).toBe("");
  });
});

describe("spreadsheetRowsToDelimitedText", () => {
  it("salta filas totalmente vacías y neutraliza los ';' internos", () => {
    const text = spreadsheetRowsToDelimitedText([
      ["Producto", "ISIN", "Valor de mercado"],
      [null, null, null],
      ["Fondo; A", "LU0289214628", 80000]
    ]);
    expect(text).toBe("Producto;ISIN;Valor de mercado\nFondo, A;LU0289214628;80000");
  });

  it("una hoja de posiciones convertida sigue siendo un extracto de bróker válido", () => {
    const text = spreadsheetRowsToDelimitedText([
      ["Producto", "ISIN", "Div", "Valor de mercado", "Contravalor en EUR"],
      ["Fondo EUR", "LU0289214628", "EUR", 80000, 80000],
      ["ETF USD", "IE000DR59CI3", "USD", 8736, 7512.09],
      ["TOTAL CARTERA", null, null, 88736, 87512.09]
    ]);

    expect(looksLikeBrokerExport(text)).toBe(true);

    const lines = brokerExportToCanonicalText(text).split("\n");
    expect(lines[0]).toBe("asset_id,weight");
    expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual([
      "LU0289214628",
      "IE000DR59CI3"
    ]);
    const total = 80000 + 7512.09;
    expect(Number(lines[2].split(",")[1])).toBeCloseTo((7512.09 / total) * 100, 2);
  });
});
