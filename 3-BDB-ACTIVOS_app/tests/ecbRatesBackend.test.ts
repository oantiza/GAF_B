import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parseEcbRatesResponse } from "../src/adapters/ecbRatesBackend";

function payload() {
  return {
    schema_version: "ecb-rates.v1",
    rates: [
      { id: "estr", date: "2026-07-09", value: 2.182 },
      { id: "dfr", date: "2026-07-10", value: 2.25 },
      { id: "mro", date: "2026-07-10", value: 2.4 },
      { id: "mlf", date: "2026-07-10", value: 2.65 }
    ],
    requested_count: 4,
    live_count: 4,
    source: "ECB_DATA_PORTAL",
    retrieved_at: "2026-07-10T14:20:00Z",
    notes: ""
  };
}

describe("ECB rates backend contract", () => {
  test("accepts a complete official response", () => {
    const result = parseEcbRatesResponse(payload());

    expect(result.rates.map((rate) => rate.id)).toEqual(["estr", "dfr", "mro", "mlf"]);
    expect(result.rates[0]).toEqual({ id: "estr", date: "2026-07-09", value: 2.182 });
    expect(result.live_count).toBe(4);
  });

  test("accepts partial coverage without inventing missing rates", () => {
    const raw = payload();
    raw.rates = raw.rates.slice(0, 3);
    raw.live_count = 3;
    raw.notes = "mlf: temporary outage";

    const result = parseEcbRatesResponse(raw);

    expect(result.rates).toHaveLength(3);
    expect(result.rates.some((rate) => rate.id === "mlf")).toBe(false);
  });

  test("rejects duplicate or unknown series", () => {
    const duplicate = payload();
    duplicate.rates[1] = { ...duplicate.rates[0] };
    expect(() => parseEcbRatesResponse(duplicate)).toThrow(AppError);

    const unknown = payload();
    unknown.rates[0].id = "euribor";
    expect(() => parseEcbRatesResponse(unknown)).toThrow(AppError);
  });

  test("rejects inconsistent coverage and malformed observations", () => {
    const badCount = payload();
    badCount.live_count = 3;
    expect(() => parseEcbRatesResponse(badCount)).toThrow(AppError);

    const badDate = payload();
    badDate.rates[0].date = "09/07/2026";
    expect(() => parseEcbRatesResponse(badDate)).toThrow(AppError);

    const badValue = payload();
    badValue.rates[0].value = 999;
    expect(() => parseEcbRatesResponse(badValue)).toThrow(AppError);
  });
});
