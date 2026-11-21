import { describe, expect, test } from "vitest";
import { comparisonConcentration, comparisonDrawdown, comparisonPositionRows, comparisonYearReturns, validateComparisonHistory } from "../src/core/portfolioComparisonReport";
import { comparisonAssets } from "./support/portfolioComparisonFixtures";

describe("datos adicionales del informe comparativo", () => {
  test("normaliza y agrupa identificadores; no cuenta pesos cero ni pierde activos sin ficha", () => {
    const rows = comparisonPositionRows([{ asset_id: "A", weight_percent: 20 }, { asset_id: "A", weight_percent: 30 }, { asset_id: "cash", weight_percent: 50 }, { asset_id: "zero", weight_percent: 0 }],
      [{ asset_id: "A", weight_percent: 1 }, { asset_id: "unknown", label: "Sin ficha", weight_percent: 3 }], comparisonAssets);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "A")).toMatchObject({ a: 50, b: 25 });
    expect(rows.find((r) => r.id === "unknown")).toMatchObject({ name: "Sin ficha", category: "Sin clasificar", b: 75 });
    const c = comparisonConcentration(rows)!;
    expect(c).toMatchObject({ shared: 1, onlyA: 1, onlyB: 1, overlap: 25, reallocation: 75 });
    expect(c.a.effective).toBe(2);
    expect(c.b.effective).toBe(1.6);
  });
  test("pesos idénticos coinciden al 100 %, y los incompletos no producen concentración engañosa", () => {
    const rows = comparisonPositionRows([{ asset_id: "A", weight_percent: 40 }], [{ asset_id: "A", weight_percent: 20 }], comparisonAssets);
    expect(comparisonConcentration(rows)).toMatchObject({ overlap: 100, reallocation: 0 });
    expect(() => comparisonConcentration([{ ...rows[0], b: 80 }])).toThrow("100 %");
  });
  test("los años parciales encadenan exactamente la rentabilidad total", () => {
    const dates = ["2023-07-01", "2023-12-29", "2024-01-02", "2024-12-31", "2025-06-30"];
    const a = dates.map((date, i) => ({ date, value: [100, 110, 105, 99, 120][i] }));
    const b = dates.map((date, i) => ({ date, value: [200, 210, 205, 190, 180][i] }));
    const rows = comparisonYearReturns(a, b);
    expect(rows.map((r) => r.label)).toEqual(["2023 · parcial", "2024", "2025 · parcial"]);
    expect(rows[1].a).toBeCloseTo(-.1);
    expect(rows.reduce((v, r) => v * (1 + r.a), 1) - 1).toBeCloseTo(.2);
    expect(rows.reduce((v, r) => v * (1 + r.b), 1) - 1).toBeCloseTo(-.1);
    expect(() => validateComparisonHistory(a, b.slice(1))).toThrow();
    expect(() => validateComparisonHistory(a, b.map((r, i) => i === 2 ? { ...r, date: "2024-01-03" } : r))).toThrow();
    expect(() => validateComparisonHistory(a, b.map((r, i) => i === 2 ? { ...r, value: NaN } : r))).toThrow();
  });
  test("festivos de fin de año no hacen «parcial» un año completo (MEDIA-16)", () => {
    // El fondo no publica del 24 al 31-12: el último cierre de 2025 es el 23-12 (8 días antes del 31).
    const dates = ["2024-06-28", "2024-12-31", "2025-06-30", "2025-12-23", "2026-01-02", "2026-03-31"];
    const a = dates.map((date, i) => ({ date, value: [100, 104, 106, 110, 111, 115][i] }));
    const b = dates.map((date, i) => ({ date, value: [100, 101, 102, 103, 104, 105][i] }));
    expect(comparisonYearReturns(a, b).map((r) => r.label)).toEqual(["2024 · parcial", "2025", "2026 · parcial"]);
    // Una serie que empieza en la primera semana de enero sigue contando el año como completo.
    const early = ["2025-01-03", "2025-06-30", "2025-12-31", "2026-01-02"].map((date, i) => ({ date, value: 100 + i }));
    expect(comparisonYearReturns(early, early)[0].label).toBe("2025");
    // Una base lejos del 31-12 y con hueco hasta el primer dato del año no da un año completo.
    const gapped = ["2024-06-28", "2025-03-07", "2025-12-31", "2026-01-02"].map((date, i) => ({ date, value: 100 + i }));
    // (2024 solo tiene la base: no hay tramo propio.) Antes 2025 salía completo.
    expect(comparisonYearReturns(gapped, gapped).map((r) => r.label)).toEqual(["2025 · parcial", "2026 · parcial"]);
  });
  test("pesos que cuadran con la tolerancia única (±0,05) no rompen la concentración (MEDIA-15)", () => {
    const rows = [
      { id: "A", name: "A", category: "", currency: "EUR", a: 33.33, b: 50 },
      { id: "B", name: "B", category: "", currency: "EUR", a: 33.33, b: 50 },
      { id: "C", name: "C", category: "", currency: "EUR", a: 33.32, b: 0 }
    ];
    expect(() => comparisonConcentration(rows)).not.toThrow();
    expect(() => comparisonConcentration([{ ...rows[0], a: 99.9, b: 100 }])).toThrow("100 %");
  });
  test("identifica máximo, mínimo y recuperación del peor episodio, incluso sin recuperar", () => {
    const points = [100, 120, 90, 96, 121, 110].map((value, i) => ({ date: `2026-01-0${i + 1}`, value }));
    expect(comparisonDrawdown(points)).toMatchObject({ depth: -.25, peak: "2026-01-02", trough: "2026-01-03", recovery: "2026-01-05", daysToRecovery: 3 });
    expect(comparisonDrawdown(points.slice(0, 4))).toMatchObject({ recovery: null, daysToRecovery: null });
    expect(comparisonDrawdown(points.slice(0, 2))).toMatchObject({ depth: 0, peak: null, trough: null });
  });
});
