import { describe, expect, it } from "vitest";
import { parseEuropeanNumber } from "../src/core/numberFormat";

describe("parseEuropeanNumber (parser numérico europeo único, T4c)", () => {
  it("coma decimal con miles europeos: 25.000,00 -> 25000", () => {
    expect(parseEuropeanNumber("25.000,00")).toBe(25000);
  });

  it("solo puntos en grupos exactos de tres -> miles europeos", () => {
    expect(parseEuropeanNumber("20.000")).toBe(20000);
    expect(parseEuropeanNumber("1.234.567")).toBe(1234567);
    expect(parseEuropeanNumber("-3.000")).toBe(-3000);
  });

  it("punto decimal anglosajón se conserva: 1000.50 -> 1000.5", () => {
    expect(parseEuropeanNumber("1000.50")).toBe(1000.5);
  });

  it("solo coma -> decimal español", () => {
    expect(parseEuropeanNumber("0,5")).toBe(0.5);
    expect(parseEuropeanNumber("12,5")).toBe(12.5);
  });

  it("cadena vacía -> NaN", () => {
    expect(Number.isNaN(parseEuropeanNumber(""))).toBe(true);
  });

  it("coma y punto: el de más a la derecha es el decimal", () => {
    expect(parseEuropeanNumber("1.234,56")).toBe(1234.56);
    expect(parseEuropeanNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("limpia símbolos de moneda y espacios", () => {
    expect(parseEuropeanNumber("25.000,00 €")).toBe(25000);
  });

  /* Ola A2 (A2.8): varias comas sin punto. */
  it("acepta millares US en grupos exactos de tres y rechaza el resto", () => {
    expect(parseEuropeanNumber("1,234,567")).toBe(1234567);
    expect(Number.isNaN(parseEuropeanNumber("1,23,45"))).toBe(true);
    expect(Number.isNaN(parseEuropeanNumber("12,34,567"))).toBe(true);
  });

  /* N3-12 (cuarta pasada): ningún grupo de miles empieza por cero. */
  it("«0.008» es 0,008 y no 8; los miles con punto siguen funcionando", () => {
    expect(parseEuropeanNumber("0.008")).toBe(0.008);
    expect(parseEuropeanNumber("0.500")).toBe(0.5);
    expect(parseEuropeanNumber("1.234")).toBe(1234);
    expect(parseEuropeanNumber("-3.000")).toBe(-3000);
  });

  /* N-02 (revisión del 17-10-2026): con letras no es un número. */
  it("un texto con letras no es un número, salvo el símbolo o el código de divisa", () => {
    for (const raw of ["IE00B4L5Y983", "LU1234567891", "Fondo 2030", "A 2030", "n/d", "15/10/2026", "(1.234)", "12:30", "1e5"]) {
      expect(Number.isNaN(parseEuropeanNumber(raw))).toBe(true);
    }
    expect(parseEuropeanNumber("1.234,56 EUR")).toBe(1234.56);
    expect(parseEuropeanNumber("USD 8.736,00")).toBe(8736);
    expect(parseEuropeanNumber("80000EUR")).toBe(80000);
    expect(parseEuropeanNumber("25.000 euros")).toBe(25000);
    expect(parseEuropeanNumber("12,5 %")).toBe(12.5);
    expect(parseEuropeanNumber("8 736,00")).toBe(8736);
    expect(parseEuropeanNumber("\u221213,7")).toBe(-13.7);
  });
});
