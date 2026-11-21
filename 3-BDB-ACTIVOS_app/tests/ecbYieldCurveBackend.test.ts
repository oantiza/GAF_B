import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parseEcbYieldCurveResponse } from "../src/adapters/ecbYieldCurveBackend";

function payload() {
  return {
    schema_version: "ecb-yield-curve.v1",
    as_of_date: "2026-07-09",
    aaa: [
      { maturity_years: 0.25, yield_pct: 2.32218836 },
      { maturity_years: 1, yield_pct: 2.55987976 },
      { maturity_years: 30, yield_pct: 3.15 }
    ],
    all_bonds: [
      { maturity_years: 0.25, yield_pct: 2.41 },
      { maturity_years: 1, yield_pct: 2.62 },
      { maturity_years: 30, yield_pct: 3.34 }
    ],
    source: "ECB_DATA_PORTAL",
    notes: ""
  };
}

describe("ECB euro yield curve contract", () => {
  test("acepta curvas ordenadas y conserva el eje numérico", () => {
    const result = parseEcbYieldCurveResponse(payload());
    expect(result.aaa.map((point) => point.maturity_years)).toEqual([0.25, 1, 30]);
    expect(result.all_bonds[2].yield_pct).toBe(3.34);
  });

  test("acepta una curva parcial sin inventar la ausente", () => {
    const raw = payload();
    raw.aaa = [];
    raw.notes = "AAA: temporary outage";
    const result = parseEcbYieldCurveResponse(raw);
    expect(result.aaa).toEqual([]);
    expect(result.all_bonds).toHaveLength(3);
  });

  test("rechaza vencimientos desconocidos, desorden y respuesta vacía", () => {
    const unknown = payload();
    unknown.aaa[0].maturity_years = 0.3;
    expect(() => parseEcbYieldCurveResponse(unknown)).toThrow(AppError);

    const unordered = payload();
    unordered.aaa.reverse();
    expect(() => parseEcbYieldCurveResponse(unordered)).toThrow(AppError);

    const empty = payload();
    empty.aaa = [];
    empty.all_bonds = [];
    expect(() => parseEcbYieldCurveResponse(empty)).toThrow(AppError);
  });

  test("rechaza fechas, valores y claves fuera del contrato v1", () => {
    expect(() => parseEcbYieldCurveResponse({ ...payload(), as_of_date: "09/07/2026" })).toThrow(AppError);
    expect(() => parseEcbYieldCurveResponse({ ...payload(), aaa: [{ maturity_years: 1, yield_pct: 999 }] })).toThrow(AppError);
    expect(() => parseEcbYieldCurveResponse({ ...payload(), unexpected: true })).toThrow(AppError);
    expect(() => parseEcbYieldCurveResponse({ ...payload(), aaa: [{ maturity_years: 1, yield_pct: 2, extra: 1 }] })).toThrow(AppError);
  });
});
