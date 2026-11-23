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

  /*
   * H2-09 / N-2 (22-11-2026). Con todos los flujos el mismo día no pasa el tiempo: el NPV es la suma de los flujos con
   * cualquier tasa y la TIR no está definida. Con suma cero, los dos extremos de la bisección daban 0 y el primer punto
   * medio, (−0,95 + 5) / 2 = 2,025, se aceptaba como raíz: 202,5 %.
   */
  it("con todos los flujos el mismo día no hay TIR: null, no 202,5 %", () => {
    const dia = d("2025-01-01");
    expect(xirr([{ date: dia, amount: -1000 }, { date: dia, amount: 1000 }])).toBeNull(); // antes, 2,025
    expect(xirr([{ date: dia, amount: -1000 }, { date: dia, amount: 1050 }])).toBeNull();
    expect(
      xirr([{ date: dia, amount: -600 }, { date: dia, amount: -400 }, { date: dia, amount: 1000 }])
    ).toBeNull(); // antes, 2,025
  });

  it("netea los flujos del mismo día: pesan lo que su suma", () => {
    // −1.000 y −500 el 01-01-2020 pesan lo que −1.500; +1.650 el 01-01-2021 (366 días). A mano: 1.650 / 1.500 = 1,1,
    // y 1,1^(365,2425/366) − 1 = 9,9783 %, la TIR de −1.000 → +1.100 en esas fechas.
    const esperada = Math.pow(1.1, 365.2425 / 366) - 1;
    expect(
      xirr([
        { date: d("2020-01-01"), amount: -1000 },
        { date: d("2020-01-01"), amount: -500 },
        { date: d("2021-01-01"), amount: 1650 }
      ])!
    ).toBeCloseTo(esperada, 8);
    // Un día con −100 y +100 no cambia nada.
    expect(
      xirr([
        { date: d("2020-01-01"), amount: -1000 },
        { date: d("2020-06-01"), amount: -100 },
        { date: d("2020-06-01"), amount: 100 },
        { date: d("2021-01-01"), amount: 1100 }
      ])!
    ).toBeCloseTo(esperada, 8);
    // Y si tras netear solo queda un signo, no hay TIR.
    expect(
      xirr([
        { date: d("2020-01-01"), amount: -1000 },
        { date: d("2021-01-01"), amount: -100 },
        { date: d("2021-01-01"), amount: 100 }
      ])
    ).toBeNull();
  });

  it("la tasa devuelta anula el NPV, comprobado sin xirr", () => {
    const flows = [
      { date: d("2020-01-01"), amount: -10000 },
      { date: d("2021-03-01"), amount: 4000 },
      { date: d("2022-07-01"), amount: -3000 },
      { date: d("2024-01-01"), amount: -2000 },
      { date: d("2024-01-01"), amount: 13500 }
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    const t0 = flows[0].date.getTime();
    const npv = flows.reduce(
      (sum, flow) => sum + flow.amount / Math.pow(1 + rate!, (flow.date.getTime() - t0) / (365.2425 * 86400000)),
      0
    );
    expect(Math.abs(npv)).toBeLessThanOrEqual(Math.max(1e-6, 1e-9 * 32500));
  });
});
