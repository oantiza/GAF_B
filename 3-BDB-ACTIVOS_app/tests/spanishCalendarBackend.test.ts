import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parseDividendsCalendarResult } from "../src/adapters/dividendsCalendarBackend";
import { parseEarningsCalendarResult } from "../src/adapters/earningsCalendarBackend";

function dividendsPayload() {
  return {
    schema_version: "spanish-calendar.v2",
    items: [
      {
        code: "IBE.MC",
        name: null,
        ex_date: "2026-07-14",
        payment_date: "2026-07-28",
        amount: 0.23,
        currency: "EUR",
        period: null,
        yield: null
      }
    ],
    from: "2026-07-10",
    to: "2026-10-08",
    source: "YAHOO_LIVE",
    count: 1
  };
}

function earningsPayload() {
  return {
    schema_version: "spanish-calendar.v2",
    items: [
      {
        code: "SAN.MC",
        name: null,
        report_date: "2026-07-29",
        when: null,
        currency: "EUR",
        eps_actual: null,
        eps_estimate: 0.21,
        eps_surprise_pct: null,
        revenue_actual: null,
        revenue_estimate: 15500000000
      }
    ],
    from: "2026-07-10",
    to: "2026-08-24",
    source: "YAHOO_LIVE",
    note: "Yahoo respondió para 34 de 35 componentes; pueden faltar anuncios.",
    count: 1
  };
}

describe("Spanish market calendars backend contracts", () => {
  test("accepts dividend rows and keeps compatibility without count", () => {
    const current = parseDividendsCalendarResult(dividendsPayload());
    expect(current.count).toBe(1);
    expect(current.items[0].payment_date).toBe("2026-07-28");

    const legacy = dividendsPayload();
    delete (legacy as Partial<typeof legacy>).count;
    expect(parseDividendsCalendarResult(legacy).count).toBe(1);
  });

  test("accepts earnings rows with nullable provider fields", () => {
    const result = parseEarningsCalendarResult(earningsPayload());

    expect(result.items[0].name).toBeNull();
    expect(result.items[0].eps_estimate).toBe(0.21);
    expect(result.note).toContain("34 de 35");
  });

  test("rejects impossible dates, reversed ranges and count mismatches", () => {
    const impossibleDate = dividendsPayload();
    impossibleDate.items[0].ex_date = "2026-02-31";
    expect(() => parseDividendsCalendarResult(impossibleDate)).toThrow(AppError);

    const reversed = earningsPayload();
    reversed.from = "2026-08-25";
    expect(() => parseEarningsCalendarResult(reversed)).toThrow(AppError);

    const badCount = earningsPayload();
    badCount.count = 2;
    expect(() => parseEarningsCalendarResult(badCount)).toThrow(AppError);
  });

  test("rejects non-numeric financial values instead of hiding them", () => {
    const badDividend = dividendsPayload();
    badDividend.items[0].amount = { value: 0.23 } as never;
    expect(() => parseDividendsCalendarResult(badDividend)).toThrow(AppError);

    const badEarnings = earningsPayload();
    badEarnings.items[0].eps_estimate = "0.21" as never;
    expect(() => parseEarningsCalendarResult(badEarnings)).toThrow(AppError);
  });
});
