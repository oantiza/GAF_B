import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sortinoRatio } from "../src/core/portfolioExtendedAnalytics";

// Quinta pasada (revisión del 6.3), I-3: la cartera real calcula el Sortino con
// weekly_sampling.ex_post_sortino, la misma definición que sortinoRatio del informe interno.
// El fixture lo comparten este test y functions_python/tests/test_ex_post_sortino_parity.py.
interface SortinoFixture {
  risk_free_rate: number;
  annual_return: number;
  weekly_returns: number;
  expected_sortino: number;
  series: Array<{ date: string; value: number }>;
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "functions_python", "tests", "fixtures", "sortino_parity.json"), "utf8")
) as SortinoFixture;

describe("Sortino ex post: paridad con el backend", () => {
  it("sortinoRatio da el Sortino del fixture que calcula el backend", () => {
    expect(fixture.weekly_returns).toBeGreaterThanOrEqual(26);
    const value = sortinoRatio(fixture.series, fixture.annual_return, fixture.risk_free_rate);
    expect(value).not.toBeNull();
    expect(value as number).toBeCloseTo(fixture.expected_sortino, 12);
  });
});
