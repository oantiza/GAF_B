/* Octava pasada del importador (revisión 7): lectura de ficheros. Lo oculto de
   un libro va aparte para que el lector lo nombre (I1), las letras escapadas de
   un formato se ven (W27b) y la codificación se detecta (W46, W47). */
import { describe, expect, it } from "vitest";
import { hiddenRowsMarkerLine, hiddenSheetMarkerLine, sheetMarkerLine, splitSheetBlocks } from "../src/core/delimitedText";
import { decodeImportBytes, numberFormatMark, spreadsheetSheetsToPositionText } from "../src/core/importFileReader";

describe("lectura de ficheros de posiciones (octava pasada)", () => {
  it("una hoja oculta y las filas ocultas de una hoja van aparte, tras su línea", () => {
    const text = spreadsheetSheetsToPositionText([
      { name: "Cartera", rows: [["ISIN", "Contravalor EUR"], ["LU1234567891", 80000], ["FR0000120271", 30000]], hiddenRows: [2] },
      { name: "Antigua", rows: [["ISIN", "Contravalor EUR"], ["DE0005557508", 20000]], hidden: true }
    ]);
    expect(text).toBe(
      [
        sheetMarkerLine("Cartera"), "ISIN;Contravalor EUR", "LU1234567891;80000",
        hiddenRowsMarkerLine("Cartera"), "FR0000120271;30000",
        hiddenSheetMarkerLine("Antigua"), "ISIN;Contravalor EUR", "DE0005557508;20000"
      ].join("\n")
    );
    expect(splitSheetBlocks(text).map((block) => [block.sheet, block.hidden])).toEqual([
      ["Cartera", null],
      ["Cartera", "rows"],
      ["Antigua", "sheet"]
    ]);
  });

  it("las letras escapadas de un formato se ven: «\\U\\S\\D» es USD (W27b)", () => {
    expect(numberFormatMark("#,##0.00\\ \\U\\S\\D")).toBe("USD");
    expect(numberFormatMark("#,##0.00\\ \\€")).toBe("€");
  });

  it("la codificación: utf-8 si lo es, windows-1252 si no, y el <meta charset> manda (W46, W47)", () => {
    expect(decodeImportBytes(new TextEncoder().encode("Valoración (€)"))).toBe("Valoración (€)");
    expect(decodeImportBytes(new Uint8Array([0x56, 0x61, 0x6c, 0x6f, 0x72, 0x61, 0x63, 0x69, 0xf3, 0x6e, 0x20, 0x80]))).toBe("Valoración €");
    const html = new TextEncoder().encode('<meta charset="utf-8"><p>Cañada</p>');
    expect(decodeImportBytes(html)).toContain("Cañada");
  });
});
