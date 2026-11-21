import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parseEconomicCalendarResult } from "../src/adapters/economicCalendarBackend";

function payload() {
  return {
    schema_version: "economic-calendar.v2",
    events: [
      {
        date: "2026-07-14T09:00:00+02:00",
        country: "USD",
        type: "IPC de junio en EE. UU.",
        actual: null,
        estimate: null,
        previous: null,
        importance: "High",
        source: "STRATEGY_REPORT"
      }
    ],
    from: "2026-07-10",
    to: "2026-07-17",
    source: "STRATEGY_REPORT_GROUNDED_FALLBACK",
    note: "Fuente primaria temporalmente limitada.",
    count: 1
  };
}

describe("economic calendar backend contract", () => {
  test("accepts a grounded fallback with row provenance", () => {
    const result = parseEconomicCalendarResult(payload());

    expect(result.count).toBe(1);
    expect(result.events[0].source).toBe("STRATEGY_REPORT");
    expect(result.from).toBe("2026-07-10");
  });

  test("keeps compatibility when an older response omits count and schema", () => {
    const raw = payload();
    delete (raw as Partial<typeof raw>).schema_version;
    delete (raw as Partial<typeof raw>).count;

    const result = parseEconomicCalendarResult(raw);

    expect(result.schema_version).toBeUndefined();
    expect(result.count).toBe(1);
  });

  test("rejects inconsistent counts and reversed ranges", () => {
    const badCount = payload();
    badCount.count = 2;
    expect(() => parseEconomicCalendarResult(badCount)).toThrow(AppError);

    const badRange = payload();
    badRange.from = "2026-07-18";
    expect(() => parseEconomicCalendarResult(badRange)).toThrow(AppError);
  });

  test("rejects malformed event dates and structured scalar values", () => {
    const badDate = payload();
    badDate.events[0].date = "14/07/2026";
    expect(() => parseEconomicCalendarResult(badDate)).toThrow(AppError);

    const badScalar = payload();
    badScalar.events[0].actual = {} as never;
    expect(() => parseEconomicCalendarResult(badScalar)).toThrow(AppError);
  });
});
