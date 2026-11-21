/*
 * Ola A2 (A2.5). La TIR solo puede devolver una raíz VERIFICADA del NPV:
 * antes, si Newton no convergía y la bisección no acotaba, se devolvía el
 * último iterado — un número arbitrario en pantalla.
 */
import { describe, expect, it } from "vitest";
import { xirr } from "../src/core/xirr";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("xirr", () => {
  it("calcula la TIR de un flujo clásico aportación → valor final", () => {
    // −10.000 hoy, +11.000 dentro de un año ⇒ TIR ≈ 10 %.
    const rate = xirr([
      { date: d("2025-01-01"), amount: -10000 },
      { date: d("2026-01-01"), amount: 11000 }
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0.095);
    expect(rate!).toBeLessThan(0.105);
  });

  it("la misma TIR que el servidor: 6,11 % con el ejemplo de la pantalla (functions_python/tests/test_macro_comparador.py)", () => {
    const rate = xirr([
      { date: d("2021-01-15"), amount: -50000 },
      { date: d("2023-06-15"), amount: -20000 },
      { date: d("2026-11-04"), amount: 95000 }
    ]);
    expect(rate!).toBeCloseTo(0.0611281, 6);
  });

  it("sin flujos de signo mixto no hay TIR: null, nunca un número arbitrario", () => {
    expect(
      xirr([
        { date: d("2025-01-01"), amount: 1000 },
        { date: d("2026-01-01"), amount: 2000 }
      ])
    ).toBeNull();
    expect(
      xirr([
        { date: d("2025-01-01"), amount: -1000 },
        { date: d("2026-01-01"), amount: -2000 }
      ])
    ).toBeNull();
  });

  it("usa la misma convención de año en todo el módulo (365,2425)", () => {
    // A un año natural exacto, la TIR de −100 → +110 debe rondar 10 %
    // sin el sesgo de mezclar 365 con 365,2425.
    const rate = xirr([
      { date: d("2025-06-30"), amount: -100 },
      { date: d("2026-06-30"), amount: 110 }
    ]);
    expect(rate).not.toBeNull();
    expect(Math.abs(rate! - 0.1)).toBeLessThan(0.005);
  });
});
