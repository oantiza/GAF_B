import { describe, expect, test } from "vitest";
import {
  assumedAssetClassCorrelation,
  estimatePortfolioSharpe,
  estimatePortfolioVolatility
} from "../src/core/portfolioRiskModel";

describe("assumedAssetClassCorrelation (A3.1)", () => {
  test("la matriz supuesta es simétrica y respeta los pares definidos", () => {
    expect(assumedAssetClassCorrelation("EQUITY", "EQUITY")).toBe(0.75); // misma clase
    expect(assumedAssetClassCorrelation("EQUITY", "FIXED_INCOME")).toBe(0.05);
    expect(assumedAssetClassCorrelation("FIXED_INCOME", "EQUITY")).toBe(0.05);
    expect(assumedAssetClassCorrelation("EQUITY", "MONEY_MARKET")).toBe(0.05);
    expect(assumedAssetClassCorrelation("FIXED_INCOME", "MONEY_MARKET")).toBe(0.6);
    expect(assumedAssetClassCorrelation("ALTERNATIVE", "EQUITY")).toBe(0.3); // resto
  });

  test("cualquier clase consigo misma vale 0,75 (RF-RF y monetario-monetario incluidos)", () => {
    for (const assetClass of ["EQUITY", "FIXED_INCOME", "MONEY_MARKET", "ALTERNATIVE", "MIXED"]) {
      expect(assumedAssetClassCorrelation(assetClass, assetClass)).toBe(0.75);
    }
  });
});

describe("estimatePortfolioVolatility", () => {
  test("un solo activo devuelve su propia volatilidad con cobertura 1", () => {
    const out = estimatePortfolioVolatility([{ assetClass: "EQUITY", volatility: 0.18, weight: 100 }]);
    expect(out.value).toBeCloseTo(0.18, 4);
    expect(out.coverage).toBe(1);
  });

  test("dos clases poco correlacionadas diversifican: vol < media ponderada", () => {
    const out = estimatePortfolioVolatility([
      { assetClass: "EQUITY", volatility: 0.2, weight: 60 },
      { assetClass: "FIXED_INCOME", volatility: 0.05, weight: 40 }
    ]);
    const weightedAverage = 0.6 * 0.2 + 0.4 * 0.05;
    expect(out.value).toBeDefined();
    expect(out.value!).toBeLessThan(weightedAverage);
    // Cota inferior: nunca por debajo de la contribución de la RV sola.
    expect(out.value!).toBeGreaterThan(0.6 * 0.2 * 0.9);
    expect(out.coverage).toBe(1);
  });

  test("coincide con la fórmula cerrada para dos activos", () => {
    const wa = 0.6;
    const wb = 0.4;
    const va = 0.2;
    const vb = 0.05;
    const rho = assumedAssetClassCorrelation("EQUITY", "FIXED_INCOME");
    const expected = Math.sqrt(wa * wa * va * va + wb * wb * vb * vb + 2 * wa * wb * rho * va * vb);
    const out = estimatePortfolioVolatility([
      { assetClass: "EQUITY", volatility: va, weight: 60 },
      { assetClass: "FIXED_INCOME", volatility: vb, weight: 40 }
    ]);
    expect(out.value).toBeCloseTo(Number(expected.toFixed(4)), 10);
  });

  test("los activos sin volatilidad reducen la cobertura y se renormaliza el resto", () => {
    const out = estimatePortfolioVolatility([
      { assetClass: "EQUITY", volatility: 0.2, weight: 50 },
      { assetClass: "ALTERNATIVE", weight: 50 } // sin dato de vol
    ]);
    // Solo contribuye la RV, renormalizada al 100% de lo usable.
    expect(out.value).toBeCloseTo(0.2, 4);
    expect(out.coverage).toBeCloseTo(0.5, 6);
  });

  test("sin pesos positivos o sin ningún dato de vol ⇒ value undefined", () => {
    expect(estimatePortfolioVolatility([]).value).toBeUndefined();
    expect(estimatePortfolioVolatility([{ assetClass: "EQUITY", weight: 100 }]).value).toBeUndefined();
    expect(
      estimatePortfolioVolatility([{ assetClass: "EQUITY", volatility: 0.2, weight: -5 }]).value
    ).toBeUndefined();
  });
});

describe("estimatePortfolioSharpe", () => {
  test("aplica (r − rf) / vol con la tasa libre explícita", () => {
    expect(estimatePortfolioSharpe(0.08, 0.1, 0.02)).toBeCloseTo(0.6, 4);
  });

  test("rechaza volatilidad nula o entradas no numéricas", () => {
    expect(estimatePortfolioSharpe(0.08, 0)).toBeUndefined();
    expect(estimatePortfolioSharpe(undefined, 0.1)).toBeUndefined();
    expect(estimatePortfolioSharpe(Number.NaN, 0.1)).toBeUndefined();
    expect(estimatePortfolioSharpe(0.08, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
