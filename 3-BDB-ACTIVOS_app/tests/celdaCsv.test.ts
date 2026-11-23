/**
 * Inyección de fórmulas en los CSV (P1-08, 21-11-2026): una celda que una hoja de cálculo leería como fórmula sale con una
 * comilla simple delante; una cifra, con su signo, sale como estaba. Se prueba la pieza y las tres salidas que la usan: el
 * resumen de Posiciones (por `csvCell` de `positionsShared`) y los dos CSV de Retrocesiones.
 */
import { describe, expect, test } from "vitest";
import { celdaCsv, neutralizarFormula } from "../src/core/celdaCsv";
import { exportCommercialRetroCsv, exportCommercialRetroPreviewCsv, parseCommercialRetroCsv } from "../src/core/commercialRetroCsv";
import { csvCell } from "../src/core/positionsShared";
import type { CommercialRetroImportPreviewRow, CommercialRetroRecord } from "../src/types/commercialRetro";

describe("neutralizarFormula", () => {
  test.each([
    ["=HYPERLINK(\"http://x\",\"pulsa\")", "'=HYPERLINK(\"http://x\",\"pulsa\")"],
    ["=1+1", "'=1+1"],
    ["+SUM(A1:A9)", "'+SUM(A1:A9)"],
    ["-2+3", "'-2+3"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1", "'\t=1"],
    ["\r=1", "'\r=1"],
    ["  =1", "'  =1"],
    ["+34 600 000 000", "'+34 600 000 000"],
    ["-Fondo raro", "'-Fondo raro"],
    ["=", "'="]
  ])("neutraliza %j", (entrada, salida) => {
    expect(neutralizarFormula(entrada)).toBe(salida);
  });

  test.each(["-12,5", "-12.5", "-1.234,56", "-0", "+3", "-1e-3", "1E+5", " -7,25 ", "0,15", "LU0123456789", "Amundi Funds", "", "Fondo = renta fija", "a-b"])(
    "deja como está %j",
    (entrada) => {
      expect(neutralizarFormula(entrada)).toBe(entrada);
    }
  );
});

describe("celdaCsv", () => {
  test("neutraliza antes de entrecomillar, y entrecomilla lo que lleva separador o comillas", () => {
    expect(celdaCsv('=A1;"x"')).toBe(`"'=A1;""x"""`);
    expect(celdaCsv("Fondo; clase A")).toBe('"Fondo; clase A"');
    expect(celdaCsv("-12,5")).toBe("-12,5");
  });
});

describe("Posiciones: csvCell", () => {
  test("una cifra negativa sale como cifra, con coma decimal", () => {
    expect(csvCell(-12.5)).toBe("-12,5");
    expect(csvCell(-0.25)).toBe("-0,25");
    expect(csvCell(null)).toBe("");
  });

  test("un nombre que empieza por un carácter de fórmula se neutraliza", () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell("@Fondo")).toBe("'@Fondo");
    expect(csvCell("Amundi Funds")).toBe("Amundi Funds");
  });
});

describe("Retrocesiones: los dos CSV", () => {
  const registro = (isin: string, retro: number): CommercialRetroRecord =>
    ({ isin, retro_pct: retro, status: "ACTIVE" }) as unknown as CommercialRetroRecord;

  test("el CSV de retrocesiones conserva las cifras negativas y se vuelve a leer igual", () => {
    const csv = exportCommercialRetroCsv([registro("LU0000000001", -0.25), registro("LU0000000002", 0.5)]);
    expect(csv).toBe("isin;retro_pct\nLU0000000001;-0,25\nLU0000000002;0,5\n");
    expect(csv).not.toContain("'");
  });

  test("la pasada en seco neutraliza un nombre y un aviso con fórmula, y no la cifra", () => {
    const fila = {
      action: "CREATE",
      entry: { isin: "LU0000000001", name: "=HYPERLINK(\"http://x\")", retro_pct: -0.25, as_of_date: "2026-11-21" },
      master_name: "+Fondo de la maestra",
      existing: undefined,
      changes: ["@aviso"],
      warnings: []
    } as unknown as CommercialRetroImportPreviewRow;
    const [, linea] = exportCommercialRetroPreviewCsv([fila]).split("\n");
    const celdas = linea.split(";");
    expect(celdas[2]).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(celdas[3]).toBe("'+Fondo de la maestra");
    expect(celdas[4]).toBe("-0,25");
    expect(celdas[7]).toBe("'@aviso");
  });
});

/* El CSV de retrocesiones se vuelve a importar: que sus cifras sigan leyéndose después de pasar por la neutralización. */
test("lo exportado de retrocesiones se vuelve a leer con las mismas cifras", () => {
  const csv = exportCommercialRetroCsv([{ isin: "LU0000000001", retro_pct: 0.5, status: "ACTIVE" } as unknown as CommercialRetroRecord]);
  const leido = parseCommercialRetroCsv(csv);
  expect(leido.entries.map((entrada) => [entrada.isin, entrada.retro_pct])).toEqual([["LU0000000001", 0.5]]);
});
