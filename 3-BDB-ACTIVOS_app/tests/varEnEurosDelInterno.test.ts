import { describe, expect, test } from "vitest";
import { varEnEurosDelInterno } from "../src/reports/internalPortfolioReportPdf";

/**
 * INF-19 (auditoría de frontend, 13-11-2026): el informe interno pasaba el VaR a euros multiplicándolo por todo el capital, aunque la
 * serie con la que se mide solo cubra una parte del peso (los pesos medidos se llevan al 100 %). La pérdida es de la parte medida: se
 * aplica al capital medido, capital × cobertura, y se dice. Sin cobertura conocida, no hay cifra en euros.
 */
describe("el VaR en euros del informe interno", () => {
  test("con el 85 % medido, sobre el capital medido y diciéndolo", () => {
    /* A mano: 200.000 € × 85 % = 170.000 € medidos; un VaR del 2,5 % son 0,025 × 170.000 = 4.250 €.
       Antes salía 0,025 × 200.000 = 5.000 € «sobre el capital actual». */
    const texto = varEnEurosDelInterno(-0.025, 200_000, 85);
    expect(texto).toMatch(/^ \(unos 4\.250\s€ sobre el 85,0\s% medido del capital\)$/);
    expect(texto).not.toMatch(/5\.000/);
  });

  test("con todo medido, sobre el capital actual, como antes", () => {
    /* A mano: 0,031 × 150.000 = 4.650 €. */
    expect(varEnEurosDelInterno(-0.031, 150_000, 100)).toMatch(/^ \(unos 4\.650\s€ sobre el capital actual\)$/);
  });

  test("sin cobertura conocida no hay cifra en euros, y se dice", () => {
    for (const cobertura of [undefined, Number.NaN, 0]) {
      const texto = varEnEurosDelInterno(-0.025, 200_000, cobertura);
      expect(texto).not.toMatch(/€/);
      expect(texto).toBe(" (sin cifra en euros: no consta qué parte del capital mide la serie)");
    }
  });

  test("sin capital, nada que añadir", () => {
    expect(varEnEurosDelInterno(-0.025, null, 85)).toBe("");
  });
});
