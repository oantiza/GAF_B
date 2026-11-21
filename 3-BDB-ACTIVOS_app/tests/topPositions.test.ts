import { describe, expect, test } from "vitest";
import { MATRICES_MAX_POSITIONS, selectTopPositionsByWeight } from "../src/core/topPositions";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

function pos(id: string, weight: number): BdbManualPortfolioPosition {
  return { asset_id: id, weight_percent: weight };
}

describe("selectTopPositionsByWeight (las matrices de Analítica avanzada, D3)", () => {
  test("una cartera dentro del límite pasa intacta", () => {
    const positions = [pos("A", 60), pos("B", 40)];
    const selection = selectTopPositionsByWeight(positions, 25);
    expect(selection.positions).toBe(positions);
    expect(selection.omittedCount).toBe(0);
    expect(selection.coveredWeightPercent).toBe(100);
  });

  test("con más posiciones que el límite se quedan las de mayor peso", () => {
    const positions = Array.from({ length: 30 }, (_, i) => pos(`A${String(i).padStart(2, "0")}`, i + 1));
    const selection = selectTopPositionsByWeight(positions, 25);
    expect(selection.positions).toHaveLength(25);
    expect(selection.omittedCount).toBe(5);
    // Quedan fuera las 5 menores (pesos 1..5); cobertura = (6+..+30)/(1+..+30)
    const total = (30 * 31) / 2;
    const covered = total - (1 + 2 + 3 + 4 + 5);
    expect(selection.coveredWeightPercent).toBeCloseTo((covered / total) * 100, 6);
    expect(selection.positions.map((p) => p.asset_id)).not.toContain("A00");
    expect(selection.positions[0].asset_id).toBe("A29");
  });

  test("desempata por asset_id para que el recorte sea estable", () => {
    const positions = [pos("Z", 10), pos("A", 10), pos("M", 10)];
    const selection = selectTopPositionsByWeight(positions, 2);
    expect(selection.positions.map((p) => p.asset_id)).toEqual(["A", "M"]);
  });

  test("el orden original se conserva cuando no hay recorte", () => {
    const positions = [pos("B", 1), pos("A", 99)];
    expect(selectTopPositionsByWeight(positions, 25).positions.map((p) => p.asset_id)).toEqual(["B", "A"]);
  });

  test("las matrices se quedan en 40 posiciones", () => {
    expect(MATRICES_MAX_POSITIONS).toBe(40);
  });
});
