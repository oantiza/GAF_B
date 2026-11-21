/* Batería de aceptación de la revisión de la tercera pasada (17-10-2026):
   o el resultado es correcto, o hay aviso y no se importa nada. Extractos
   SINTÉTICOS (ISIN inventados salvo IE00B4L5Y983). */
import { describe, expect, it } from "vitest";
import { brokerExportToCanonicalImport, looksLikeBrokerExport } from "../src/core/brokerPortfolioImport";
import { parsePositionImport } from "../src/core/positionImport";

const OK = [
  { id: "LU1234567891", amount: 80000 },
  { id: "IE0098765432", amount: 120000 }
];

/** Correcto, o vacío con aviso. */
function correctOrRefused(text: string, expected: Array<{ id: string; amount: number }>) {
  const r = parsePositionImport(text);
  if (r.entries.length === 0) {
    expect(r.warnings.length, "sin posiciones y sin aviso").toBeGreaterThan(0);
  } else {
    expect(r.entries).toEqual(expected);
  }
}

describe("importación en Posiciones globales: aceptación de la revisión 3", () => {
  it("R4b · «ISIN;Nombre;Importe» con una fila de total sin ISIN ni nombre", () => {
    correctOrRefused("ISIN;Nombre;Importe\nLU1234567891;Fondo A;80000\nIE0098765432;Fondo B;120000\n;;200000", OK);
  });
  it("R4c · «ISIN;Importe» con una fila de total sin ISIN", () => {
    correctOrRefused("ISIN;Importe\nLU1234567891;80000\nIE0098765432;120000\n;200000", OK);
  });
  it("R8a · «ISIN;Importe;Peso %»: el peso no es el importe", () => {
    correctOrRefused("ISIN;Importe;Peso %\nLU1234567891;80000;40\nIE0098765432;120000;60", OK);
  });
  it("R8b · «ISIN;Contravalor EUR;Rentabilidad»", () => {
    correctOrRefused("ISIN;Contravalor EUR;Rentabilidad\nLU1234567891;80000;5,2\nIE0098765432;120000;3,1", OK);
  });
  it("R8f · «ISIN;Importe;Peso» con el peso en fracción", () => {
    correctOrRefused("ISIN;Importe;Peso\nLU1234567891;80000;0,4\nIE0098765432;120000;0,6", OK);
  });
  it("R10a · subtotales «FONDOS» y «ETF» en la columna del ISIN no son posiciones (o se avisa)", () => {
    const text =
      "ISIN;Nombre;Títulos;Valor de mercado\nFONDOS;;;80000\nLU1234567891;Fondo A;100;80000\nETF;;;120000\nIE0098765432;ETF B;50;120000\nTOTAL;;;200000";
    const r = parsePositionImport(text);
    const ids = r.entries.map((e) => e.id);
    if (ids.includes("FONDOS") || ids.includes("ETF")) {
      expect(r.warnings.join(" "), "subtotales importados como posiciones sin aviso").toMatch(/FONDOS|ETF/);
    }
  });
});

describe("importación: errores silenciosos anteriores a la rama", () => {
  it("R3c · CSV en inglés con importes entre comillas («80,000.00»)", () => {
    const csv =
      'Security,ISIN,Currency,Quantity,Price,Market value EUR\n"Fund A",LU1234567891,EUR,"1,000","80.00","80,000.00"\n"ETF B",IE00B4L5Y983,USD,50,"174.72","7,512.09"';
    correctOrRefused(csv, [
      { id: "LU1234567891", amount: 80000 },
      { id: "IE00B4L5Y983", amount: 7512.09 }
    ]);
  });
  it("R1c · contravalor vacío en una posición en USD: no vale el valor de mercado en dólares", () => {
    const csv = "Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;";
    const r = parsePositionImport(csv);
    const ie = r.entries.find((e) => e.id === "IE0098765432");
    if (ie) expect(ie.amount === 8736 && r.warnings.length === 0, "USD como EUR sin aviso").toBe(false);
  });
  it("R2b · «Valor de mercado» (USD) frente a «Importe» (EUR) con Divisa USD", () => {
    const csv = "Producto;ISIN;Divisa;Valor de mercado;Importe\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;7512,09";
    const r = parsePositionImport(csv);
    const ie = r.entries.find((e) => e.id === "IE0098765432");
    if (ie) expect(ie.amount === 8736 && r.warnings.length === 0, "USD como EUR sin aviso").toBe(false);
  });
  it("R9b · primera línea con importe ilegible: no puede desaparecer sin aviso", () => {
    const r = parsePositionImport("LU1234567891;80.000,00 EUR\nIE0098765432;120000");
    const lost = !r.entries.some((e) => e.id === "LU1234567891");
    if (lost) expect(r.warnings.length, "posición perdida sin aviso").toBeGreaterThan(0);
  });
});

describe("importación: cabecera con saltos de línea entre comillas", () => {
  it("R6d · el liquidativo no puede entrar como importe (ALTA-07)", () => {
    const csv = 'ISIN;Producto;"Valor\nliquidativo";"Peso\n%"\nLU1234567891;A;12,34;91,4\nIE0098765432;B;5,67;8,6';
    const k = brokerExportToCanonicalImport(csv);
    const r = parsePositionImport(csv);
    expect(looksLikeBrokerExport(csv)).toBe(true);
    expect(r.entries.map((e) => e.amount)).not.toEqual([12.34, 5.67]);
    expect(k.text).not.toContain("68.5");
  });
});
