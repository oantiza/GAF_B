import { describe, expect, it } from "vitest";
import { calculateUnderwaterSeries } from "./underwater";

describe("calculateUnderwaterSeries", () => {
  it("calculates drawdown correctly for a shape in V", () => {
    // values: 100 -> 90 -> 80 -> 95 -> 110
    // peak:   100    100   100   100   110
    // dd:      0    -10%  -20%   -5%    0
    const values = [100, 90, 80, 95, 110];
    const expected = [0, -0.1, -0.2, -0.05, 0];
    const result = calculateUnderwaterSeries(values);
    result.forEach((val, i) => {
      expect(val).toBeCloseTo(expected[i]);
    });
  });

  it("returns all 0s for a monotonically increasing series", () => {
    const values = [100, 110, 120, 130];
    const expected = [0, 0, 0, 0];
    const result = calculateUnderwaterSeries(values);
    result.forEach((val, i) => {
      expect(val).toBeCloseTo(expected[i]);
    });
  });

  it("handles NaNs correctly by returning NaN and maintaining the peak", () => {
    // 100, NaN, 80
    const values = [100, NaN, 80];
    const result = calculateUnderwaterSeries(values);
    expect(result[0]).toBeCloseTo(0);
    expect(Number.isNaN(result[1])).toBe(true);
    expect(result[2]).toBeCloseTo(-0.2);
  });

  it("returns an empty array for empty input", () => {
    expect(calculateUnderwaterSeries([])).toEqual([]);
  });
});
