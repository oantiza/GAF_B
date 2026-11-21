import { describe, expect, test } from "vitest";
import { portfolioPositionAmount, updatePortfolioAmount } from "../src/core/portfolioAmounts";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const initial: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60, label: "Fondo A" },
  { asset_id: "B", weight_percent: 40, keepEuros: true, targetEuros: 40000 },
  { asset_id: "C", weight_percent: 0 }
];

describe("edición de importes de cartera", () => {
  test("añadir 10.000 a una cartera de 100.000 conserva 60.000 y 40.000 y suma 100 %", () => {
    const result = updatePortfolioAmount(initial, 100000, "C", 10000)!;
    expect(result.totalCapital).toBe(110000);
    expect(result.positions.map((p) => portfolioPositionAmount(p, result.totalCapital))).toEqual([60000, 40000, 10000]);
    expect(result.positions.map((p) => p.weight_percent)).toEqual([60000 / 110000 * 100, 40000 / 110000 * 100, 10000 / 110000 * 100]);
    expect(result.positions.reduce((sum, p) => sum + p.weight_percent, 0)).toBeCloseTo(100, 12);
    expect(result.positions[1]).toMatchObject({ keepEuros: true, targetEuros: 40000 });
    expect(initial[2].weight_percent).toBe(0);
  });

  test.each([[25000.37, 65000.37], [0, 40000], [200000, 240000]])("sustituir el importe de una posición por %s actualiza el total, no añade dos veces", (amount, expectedCapital) => {
    const result = updatePortfolioAmount(initial, 100000, "A", amount)!;
    expect(result.totalCapital).toBe(expectedCapital);
    expect(result.positions.map((p) => portfolioPositionAmount(p, result.totalCapital))).toEqual([amount, 40000, 0]);
    expect(result.positions.reduce((sum, p) => sum + p.weight_percent, 0)).toBeCloseTo(100, 12);
  });

  test.each([0, 100000])("la primera posición usa su importe y no el capital inicial de %s", (capital) => {
    const result = updatePortfolioAmount([{ asset_id: "A", weight_percent: 0 }], capital, "A", 1234.56)!;
    expect(result.totalCapital).toBe(1234.56);
    expect(result.positions[0].weight_percent).toBe(100);
  });

  test("se puede retirar todo y volver a empezar desde cero", () => {
    const empty = updatePortfolioAmount([{ asset_id: "A", weight_percent: 100 }], 10000, "A", 0)!;
    expect(empty).toEqual({ positions: [{ asset_id: "A", weight_percent: 0 }], totalCapital: 0 });
    const next = updatePortfolioAmount(empty.positions, empty.totalCapital, "A", 500)!;
    expect(next.totalCapital).toBe(500);
    expect(next.positions[0].weight_percent).toBe(100);
  });

  test("los pesos antiguos por encima de 100 % se reconcilian con los importes de las filas", () => {
    const result = updatePortfolioAmount([
      { asset_id: "A", weight_percent: 80 }, { asset_id: "B", weight_percent: 70 }, { asset_id: "C", weight_percent: 0 }
    ], 100000, "C", 10000)!;
    expect(result.totalCapital).toBe(160000);
    expect(result.positions.map((p) => portfolioPositionAmount(p, result.totalCapital))).toEqual([80000, 70000, 10000]);
    expect(result.positions.reduce((sum, p) => sum + p.weight_percent, 0)).toBe(100);
  });

  test("las ediciones sucesivas no acumulan pérdidas por redondeo de pesos", () => {
    let result = updatePortfolioAmount(initial, 100000, "C", 999.99)!;
    for (let i = 0; i < 100; i++) result = updatePortfolioAmount(result.positions, result.totalCapital, "C", 1234.56 + i)!;
    expect(result.positions.map((p) => portfolioPositionAmount(p, result.totalCapital))).toEqual([60000, 40000, 1333.56]);
    expect(result.totalCapital).toBe(101333.56);
  });

  test("editar un activo con mantener euros actualiza su objetivo", () => {
    const result = updatePortfolioAmount(initial, 100000, "B", 12345.67)!;
    expect(result.positions[1]).toMatchObject({ keepEuros: true, targetEuros: 12345.67 });
    expect(result.totalCapital).toBe(72345.67);
  });

  test("rechaza entradas inválidas sin alterar la cartera", () => {
    for (const amount of [NaN, Infinity, -1, Number.MAX_VALUE]) expect(updatePortfolioAmount(initial, 100000, "C", amount)).toBeNull();
    expect(updatePortfolioAmount(initial, 100000, "UNKNOWN", 5)).toBeNull();
    expect(updatePortfolioAmount(initial, NaN, "C", 5)).toBeNull();
  });
});
