import { describe, expect, it } from "vitest";
import {
  buildCommercialRetroPreview,
  countCommercialRetroWrites,
  exportCommercialRetroPreviewCsv,
  interpretCommercialRetroSheet,
  nameLooksDifferent,
  readCommercialRetroText,
  suggestCommercialRetroScale,
  summarizeCommercialRetroPreview
} from "../src/core/commercialRetroCsv";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";

/* Importación por columnas (05-09): cabecera libre, escala, duplicados y
   pasada en seco contra la maestra. El fichero real con el que se trabaja trae
   `nombre · isin · retro` con la retrocesión como fracción con formato %. */

const AS_OF = "2026-09-05";

describe("lectura por columnas y escala", () => {
  it("reconoce la cabecera nombre;isin;retro en ese orden y sugiere fracción cuando los valores son pequeños", () => {
    const sheet = readCommercialRetroText([
      "nombre;isin;retro",
      "AB AMERICAN GROWTH A ACC EUR;LU0232524495;0,008",
      "ACATIS GANE VALUE EVENT;DE000A0X7541;0,0058980690890447",
      "CLASE LIMPIA;IE00B4L5Y983;0"
    ].join("\n"));

    expect(sheet.columns).toEqual({ header_row: 1, isin: 1, retro: 2, nombre: 0, fecha: undefined, nota: undefined });
    expect(sheet.suggested_scale).toBe("fraccion");

    const parsed = interpretCommercialRetroSheet(sheet, { scale: "fraccion", as_of_date: AS_OF });
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct, entry.name, entry.as_of_date])).toEqual([
      ["LU0232524495", 0.8, "AB AMERICAN GROWTH A ACC EUR", AS_OF],
      ["DE000A0X7541", 0.5898, "ACATIS GANE VALUE EVENT", AS_OF],
      ["IE00B4L5Y983", 0, "CLASE LIMPIA", AS_OF]
    ]);
    expect(parsed.zero_isins).toEqual(["IE00B4L5Y983"]);
  });

  /* Auditoría 16-11-2026 (RET-1). Un fichero de clases casi limpias, todo por debajo de 0,2, se tomaba por fracciones aunque
     cada celda dijera «%»: «0,15%» entraba como 15. Sobre 100.000 €, 15.000 € de ingreso al año en vez de 150 €. */
  it("si las celdas llevan su «%», son porcentajes aunque todas queden por debajo de 0,2", () => {
    const sheet = readCommercialRetroText("isin;retro\nLU0232524495;0,15%\nIE00B4L5Y983;0%\nDE000A0X7541;0,10 %");
    expect(sheet.suggested_scale).toBe("porcentaje");
    const parsed = interpretCommercialRetroSheet(sheet, { scale: sheet.suggested_scale, as_of_date: AS_OF });
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct])).toEqual([
      ["LU0232524495", 0.15],
      ["IE00B4L5Y983", 0],
      ["DE000A0X7541", 0.1]
    ]);
  });

  it("basta una celda con «%» para que el fichero entero se lea en porcentaje; sin ninguna, manda el tamaño como antes", () => {
    expect(readCommercialRetroText("isin;retro\nLU0232524495;0,15%\nIE00B4L5Y983;0,10").suggested_scale).toBe("porcentaje");
    expect(readCommercialRetroText("isin;retro\nLU0232524495;0,0015\nIE00B4L5Y983;0,001").suggested_scale).toBe("fraccion");
    /* Un «%» en la cabecera o en el nombre no es una celda de retrocesión. */
    expect(readCommercialRetroText("nombre;isin;retro %\nFondo 5%;LU0232524495;0,0015").suggested_scale).toBe("fraccion");
  });

  it("en escala porcentaje guarda el valor tal cual y redondea a cuatro decimales", () => {
    const sheet = readCommercialRetroText("isin;retro\nLU0232524495;0,80\nIE00B4L5Y983;1,46345678");
    expect(sheet.suggested_scale).toBe("porcentaje");
    const parsed = interpretCommercialRetroSheet(sheet, { scale: "porcentaje", as_of_date: AS_OF });
    expect(parsed.entries.map((entry) => entry.retro_pct)).toEqual([0.8, 1.4635]);
  });

  it("la sugerencia de escala mira el máximo: 0,2 o menos es fracción", () => {
    expect(suggestCommercialRetroScale([0.008, 0.025, 0])).toBe("fraccion");
    expect(suggestCommercialRetroScale([0.8, 0.25])).toBe("porcentaje");
    expect(suggestCommercialRetroScale([])).toBe("porcentaje");
  });

  it("acepta cabeceras en cualquier orden, fecha por fila y nota", () => {
    const sheet = readCommercialRetroText([
      "Fecha;Retrocesión %;Nota;ISIN;Denominación",
      "2026-06-30;0,45;Clase limpia;IE00B4L5Y983;Fondo A",
      ";0,55;;IE00B18GC888;Fondo B"
    ].join("\n"));
    expect(sheet.columns).toEqual({ header_row: 1, isin: 3, retro: 1, nombre: 4, fecha: 0, nota: 2 });
    const parsed = interpretCommercialRetroSheet(sheet, { scale: "porcentaje", as_of_date: AS_OF });
    expect(parsed.entries).toEqual([
      { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: "2026-06-30", note: "Clase limpia", line_number: 2, name: "Fondo A", duplicated_lines: undefined },
      { isin: "IE00B18GC888", retro_pct: 0.55, as_of_date: AS_OF, note: undefined, line_number: 3, name: "Fondo B", duplicated_lines: undefined }
    ]);
  });

  it("sin cabecera sigue valiendo el formato compacto isin;retro;[fecha];[nota]", () => {
    const sheet = readCommercialRetroText("IE00B4L5Y983;0,45;2026-06-30;Clase limpia\nLU0404220724;1,25");
    expect(sheet.columns).toMatchObject({ header_row: null, isin: 0, retro: 1, fecha: 2 });
    const parsed = interpretCommercialRetroSheet(sheet, { scale: "porcentaje", as_of_date: AS_OF });
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct, entry.as_of_date, entry.note])).toEqual([
      ["IE00B4L5Y983", 0.45, "2026-06-30", "Clase limpia"],
      ["LU0404220724", 1.25, AS_OF, undefined]
    ]);
  });

  it("los valores tipados de Excel mandan sobre el texto (0.008 no son ocho mil)", () => {
    const parsed = interpretCommercialRetroSheet({
      rows: [
        { line_number: 1, fields: ["isin", "retro"], raw_line: "isin;retro" },
        { line_number: 2, fields: ["LU0232524495", "0.008"], values: ["LU0232524495", 0.008], raw_line: "LU0232524495;0.008" }
      ],
      columns: { header_row: 1, isin: 0, retro: 1 },
      suggested_scale: "fraccion"
    }, { scale: "fraccion", as_of_date: AS_OF });
    expect(parsed.entries[0].retro_pct).toBe(0.8);
  });

  it("colapsa los duplicados idénticos y aparta los que traen valores distintos hasta que se elige uno", () => {
    const text = [
      "nombre;isin;retro",
      "FF GLOBAL FINANCIAL SERVICES;LU1391767586;0,0075",
      "GLOBAL FINANCIAL SERVICES A;LU1391767586;0,0075",
      "ROBCCO CONSUMER TRENDS;LU0187079347;0,0075",
      "ROBECO GLOBAL CONSUMER TRENDS;LU0187079347;0,008"
    ].join("\n");
    const sheet = readCommercialRetroText(text);
    const parsed = interpretCommercialRetroSheet(sheet, { scale: "fraccion", as_of_date: AS_OF });
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct, entry.duplicated_lines])).toEqual([["LU1391767586", 0.75, [3]]]);
    expect(parsed.conflicts).toEqual([{
      isin: "LU0187079347",
      name: "ROBCCO CONSUMER TRENDS",
      values: [{ line_number: 4, retro_pct: 0.75 }, { line_number: 5, retro_pct: 0.8 }]
    }]);

    const resolved = interpretCommercialRetroSheet(sheet, { scale: "fraccion", as_of_date: AS_OF, resolved_conflicts: { LU0187079347: 0.8 } });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.entries.map((entry) => [entry.isin, entry.retro_pct])).toEqual([["LU1391767586", 0.75], ["LU0187079347", 0.8]]);
  });

  it("separa las filas no válidas sin frenar al resto", () => {
    const parsed = interpretCommercialRetroSheet(readCommercialRetroText([
      "isin;retro",
      "BAD;0,45",
      "IE00B4L5Y983;abc",
      "IE00B18GC888;150",
      "LU0404220724;0,9"
    ].join("\n")), { scale: "porcentaje", as_of_date: AS_OF });
    expect(parsed.issues.map((issue) => [issue.line_number, issue.message])).toEqual([
      [2, "ISIN no válido."],
      [3, "Retrocesión no numérica."],
      [4, "Retrocesión fuera de rango 0-100."]
    ]);
    expect(parsed.entries.map((entry) => entry.isin)).toEqual(["LU0404220724"]);
  });

  it("sin columna ISIN devuelve un único aviso y ninguna entrada", () => {
    const sheet = readCommercialRetroText("nombre;valor\nFondo A;0,45");
    expect(sheet.columns).toBeNull();
    const parsed = interpretCommercialRetroSheet(sheet, { scale: "porcentaje", as_of_date: AS_OF });
    expect(parsed.entries).toEqual([]);
    expect(parsed.issues[0].message).toMatch(/columna con ISIN/);
  });
});

describe("pasada en seco con maestra y modo lista completa", () => {
  const entries = interpretCommercialRetroSheet(readCommercialRetroText([
    "nombre;isin;retro",
    "Fondo A Acc EUR;IE00B4L5Y983;0,45",
    "Fondo B;IE00B18GC888;0,55",
    "Fondo Nuevo;LU0404220724;1,25",
    "Fuera;LU0000000099;0,30",
    "Nombre Raro;ES0000000001;0"
  ].join("\n")), { scale: "porcentaje", as_of_date: AS_OF }).entries;
  const existing = new Map<string, CommercialRetroRecord>([
    ["IE00B4L5Y983", { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: AS_OF, source: "ADMIN_UI" }],
    ["IE00B18GC888", { isin: "IE00B18GC888", retro_pct: 0.5, as_of_date: AS_OF, source: "ADMIN_UI" }],
    ["ES0000000001", { isin: "ES0000000001", retro_pct: 0.2, as_of_date: AS_OF, source: "ADMIN_UI" }],
    ["FR0000000007", { isin: "FR0000000007", retro_pct: 0.9, as_of_date: AS_OF, source: "ADMIN_UI" }]
  ]);
  const existingAssetIds = new Set(["IE00B4L5Y983", "IE00B18GC888", "LU0404220724", "ES0000000001", "FR0000000007"]);
  const masterNames = new Map([["ES0000000001", "Renta Fija Corto Plazo FI"], ["IE00B4L5Y983", "Fondo A Acc EUR"]]);

  it("marca fuera de la maestra, avisa del nombre distinto y del cero, y propone borrar en modo lista completa", () => {
    const rows = buildCommercialRetroPreview(entries, existing, { existingAssetIds, masterNames, replaceAll: true });
    expect(rows.map((row) => [row.entry.isin, row.action])).toEqual([
      ["IE00B4L5Y983", "UNCHANGED"],
      ["IE00B18GC888", "UPDATE"],
      ["LU0404220724", "CREATE"],
      ["LU0000000099", "OUT_OF_MASTER"],
      ["ES0000000001", "UPDATE"],
      ["FR0000000007", "DELETE"]
    ]);
    expect(rows[4].warnings).toEqual(["El nombre del fichero no se parece al del catálogo.", "Retrocesión 0."]);
    expect(rows[5].changes).toEqual(["no está en el fichero"]);
    expect(summarizeCommercialRetroPreview(rows)).toEqual({ CREATE: 1, UPDATE: 2, UNCHANGED: 1, DELETE: 1, OUT_OF_MASTER: 1 });
    expect(countCommercialRetroWrites(rows)).toBe(4);

    const csv = exportCommercialRetroPreviewCsv(rows);
    expect(csv.split("\n")[0]).toBe("accion;isin;nombre_fichero;nombre_maestra;retro_nueva_pct;retro_actual_pct;vigente_desde;avisos");
    expect(csv).toContain("OUT_OF_MASTER;LU0000000099;Fuera;;0,3;;2026-09-05;");
  });

  it("sin lista de la maestra no marca nada como fuera, y sin lista completa no borra", () => {
    const rows = buildCommercialRetroPreview(entries, existing, { existingAssetIds: null });
    expect(rows.some((row) => row.action === "OUT_OF_MASTER" || row.action === "DELETE")).toBe(false);
  });

  it("compara nombres por términos significativos", () => {
    expect(nameLooksDifferent("AB AMERICAN GROWTH A ACC EUR", "AB SICAV I - American Growth Portfolio A EUR")).toBe(false);
    expect(nameLooksDifferent("Nombre Raro", "Renta Fija Corto Plazo FI")).toBe(true);
    expect(nameLooksDifferent("Fondo A", "Fondo B")).toBe(false);
  });
});
