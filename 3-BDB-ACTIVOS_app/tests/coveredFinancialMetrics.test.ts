import { describe, expect, test } from "vitest";
import { summarizeCoveredRate } from "../src/core/coveredFinancialMetrics";

describe("covered financial metrics", () => {
  test("does not treat an uncovered position as a zero rate", () => {
    const result = summarizeCoveredRate([
      { amount: 100_000, rate: 0.01 },
      { amount: 100_000, rate: null }
    ]);

    expect(result.totalAmount).toBe(200_000);
    expect(result.coveredAmount).toBe(100_000);
    expect(result.coverageRatio).toBe(0.5);
    expect(result.weightedAverage).toBe(0.01);
    expect(result.weightedTotal).toBe(1_000);
  });

  test("counts an explicit zero rate as covered information", () => {
    const result = summarizeCoveredRate([
      { amount: 75_000, rate: 0 },
      { amount: 25_000, rate: 1 }
    ]);

    expect(result.coverageRatio).toBe(1);
    expect(result.weightedAverage).toBe(0.25);
    expect(result.weightedTotal).toBe(25_000);
  });

  test("ignores invalid or non-positive amounts", () => {
    const result = summarizeCoveredRate([
      { amount: Number.NaN, rate: 1 },
      { amount: -100, rate: 1 },
      { amount: 0, rate: 1 }
    ]);

    expect(result).toEqual({
      totalAmount: 0,
      coveredAmount: 0,
      coverageRatio: 0,
      weightedTotal: 0,
      weightedAverage: null
    });
  });
});
