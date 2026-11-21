/**
 * Auditoría · rentabilidad ponderada por tiempo (TWR) y del cliente (TIR).
 *
 * Convención del motor (cabecera de `valoracion.ts` y `rentabilidad.ts`): un periodo va del
 * CIERRE de `desde` al CIERRE de `hasta`; cada día r = (V − salidas) / (V ayer + entradas) − 1,
 * es decir, lo que entra cuenta desde el inicio del día y lo que sale, al cierre. La TIR usa
 * los mismos instantes: una entrada del día k cuenta en el cierre del día k − 1. Se anualiza
 * desde 365 días, un año (GES-12; antes 367, MOT-07), con años = días / 365,2425. Cada cifra esperada lleva su cuenta a mano.
 */
import { describe, expect, it } from "vitest";
import { rentabilidadDelPeriodo, tirDeFlujos } from "../../../src/gestor/motor/rentabilidad";
import { valorar } from "../../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "../ayudas";
import { TODO, mercado } from "./ayudasAuditoria";

const FON = activo("FON", "FONDO");

describe("(a) sin flujos en el periodo", () => {
  /* 10 participaciones a 100 el 01-01-2025; el precio va 100 → 104 → 98 → 105 (06-01). */
  const c = cartera([FON], [
    mov("aportacion", "2025-01-01", { importe: "1000" }),
    mov("suscripcion", "2025-01-01", { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" })
  ]);
  const v = valorar(c, mercado({ FON: [["2025-01-01", 100], ["2025-01-02", 104], ["2025-01-03", 98], ["2025-01-06", 105]] }), { hasta: "2025-01-06" });

  it("TWR = valor final / valor inicial − 1", () => {
    const r = rentabilidadDelPeriodo(v, { desde: "2025-01-01", hasta: "2025-01-06" })!;
    expect(r.valorInicial).toBeCloseTo(1000, 9);
    expect(r.valorFinal).toBeCloseTo(1050, 9); // 10 × 105
    expect(r.twr).toBeCloseTo(0.05, 12); // 1.050 / 1.000 − 1
    expect(r.resultado).toBeCloseTo(50, 9);
  });

  it("(d) la TIR de un flujo inicial y un valor final tiene solución cerrada: la misma", () => {
    /* −1.000 en el día 0 y +1.050 en el día 5: (1 + R) = 1.050 / 1.000. */
    expect(rentabilidadDelPeriodo(v, { desde: "2025-01-01", hasta: "2025-01-06" })!.tir).toBeCloseTo(0.05, 10);
  });

  it("(f) un periodo que empieza con la cartera en marcha parte de su valor de ese cierre", () => {
    const r = rentabilidadDelPeriodo(v, { desde: "2025-01-02", hasta: "2025-01-06" })!;
    expect(r.valorInicial).toBeCloseTo(1040, 9); // 10 × 104
    expect(r.twr).toBeCloseTo(1050 / 1040 - 1, 12);
    expect(r.tir).toBeCloseTo(1050 / 1040 - 1, 10); // sin flujos, TIR = TWR
    expect(r.aportacionesNetas).toBe(0);
  });

  it("(f) un periodo que empieza antes del primer movimiento se mide desde su víspera, con valor inicial cero", () => {
    const r = rentabilidadDelPeriodo(v, TODO)!;
    expect(r.desde).toBe("2024-12-31");
    expect(r.valorInicial).toBe(0);
    expect(r.entradas).toBeCloseTo(1000, 9);
    /* El día 1: 1.000 / (0 + 1.000) − 1 = 0; después, 1.050 / 1.000 − 1. */
    expect(r.twr).toBeCloseTo(0.05, 12);
    expect(r.resultado).toBeCloseTo(50, 9); // 1.050 − 0 − 1.000
  });
});

describe("(b) una aportación grande a mitad de periodo", () => {
  /*
   *   01-01  aporta 1.000 y compra 10 a 100            V = 1.000      r = 1.000 / (0 + 1.000) − 1     = 0
   *   02-01  precio 110                                 V = 1.100      r = 1.100 / 1.000 − 1           = +10 %
   *   03-01  aporta 11.000 y compra 100 a 110           V = 110 × 110 = 12.100
   *                                                                    r = 12.100 / (1.100 + 11.000) − 1 = 0
   *   04-01  precio 99                                  V = 110 × 99 = 10.890
   *                                                                    r = 10.890 / 12.100 − 1         = −10 %
   *
   *   TWR = 1,10 × 0,90 − 1 = −1 %.
   *   Rentabilidad simple sobre lo aportado: (10.890 − 12.000) / 12.000 = −9,25 %: no coinciden, y es lo esperado.
   */
  const c = cartera([FON], [
    mov("aportacion", "2025-01-01", { importe: "1000" }),
    mov("suscripcion", "2025-01-01", { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" }),
    mov("aportacion", "2025-01-03", { importe: "11000" }),
    mov("suscripcion", "2025-01-03", { activoId: "FON", titulos: "100", precio: "110", importe: "-11000" })
  ]);
  const v = valorar(c, mercado({ FON: [["2025-01-01", 100], ["2025-01-02", 110], ["2025-01-04", 99]] }), { hasta: "2025-01-04" });
  const r = rentabilidadDelPeriodo(v, TODO)!;

  it("encadena los subperiodos y la aportación no mueve la TWR", () => {
    expect([...v.rentabilidad].map((x) => Number(x.toFixed(12)))).toEqual([0, 0.1, 0, -0.1]);
    expect(r.twr).toBeCloseTo(-0.01, 12);
  });

  it("el resultado y la rentabilidad simple difieren de la TWR", () => {
    expect(r.resultado).toBeCloseTo(-1110, 9); // 10.890 − 0 − 12.000
    expect(r.resultado / r.aportacionesNetas).toBeCloseTo(-0.0925, 12);
  });

  it("(d) la TIR con tres flujos: solución cerrada y valor actual neto nulo", () => {
    /*
     * Flujos del cliente: −1.000 en el instante 0 (inicio del 01-01), −11.000 en el 2 (inicio del 03-01),
     * +10.890 en el 4 (cierre del 04-01). Con x = 1 + R:
     *   −1.000 − 11.000 · x^(−2/4) + 10.890 · x^(−1) = 0   →   1.000 y² + 11.000 y − 10.890 = 0,  y = √x
     *   y = (−11 + √(121 + 43,56)) / 2,   R = y² − 1 ≈ −16,45 %
     */
    const y = (-11 + Math.sqrt(164.56)) / 2;
    expect(r.tir).toBeCloseTo(y * y - 1, 10);
    const x = 1 + r.tir!;
    const van = -1000 - 11000 * Math.pow(x, -2 / 4) + 10890 * Math.pow(x, -1);
    expect(Math.abs(van)).toBeLessThan(1e-6);
  });
});

describe("(c) con una retirada", () => {
  /*
   *   01-01  aporta 2.000 y compra 20 a 100      V = 2.000                   r = 0
   *   02-01  precio 105                           V = 2.100                   r = 2.100 / 2.000 − 1 = +5 %
   *   03-01  vende 10 a 108 y retira 1.080        V = 10 × 108 = 1.080, salen 1.080
   *                                                r = (1.080 + 1.080) / 2.100 − 1 = 2.160 / 2.100 − 1
   *   06-01  precio 102                           V = 1.020                   r = 1.020 / 1.080 − 1
   *
   *   TWR = (2.100 / 2.000) × (2.160 / 2.100) × (1.020 / 1.080) − 1 = 1,08 × 1.020 / 1.080 − 1 = +2 %.
   *   Resultado = 1.020 − 0 − (2.000 − 1.080) = 100.
   */
  const c = cartera([FON], [
    mov("aportacion", "2025-01-01", { importe: "2000" }),
    mov("suscripcion", "2025-01-01", { activoId: "FON", titulos: "20", precio: "100", importe: "-2000" }),
    mov("reembolso", "2025-01-03", { activoId: "FON", titulos: "10", precio: "108", importe: "1080" }),
    mov("retirada", "2025-01-03", { importe: "-1080" })
  ]);
  const v = valorar(c, mercado({ FON: [["2025-01-01", 100], ["2025-01-02", 105], ["2025-01-03", 108], ["2025-01-06", 102]] }), { hasta: "2025-01-06" });
  const r = rentabilidadDelPeriodo(v, TODO)!;

  it("la retirada cuenta al cierre del día y no mueve la TWR", () => {
    expect(v.rentabilidad[v.indice.get("2025-01-03")!]).toBeCloseTo(2160 / 2100 - 1, 12);
    expect(r.twr).toBeCloseTo(0.02, 12);
    expect(r.salidas).toBeCloseTo(-1080, 9);
    expect(r.resultado).toBeCloseTo(100, 9);
  });

  it("la TIR coincide con su solución cerrada", () => {
    /*
     * −2.000 en el instante 0, +1.080 en el 3 (cierre del 03-01), +1.020 en el 6 (cierre del 06-01).
     *   −2.000 + 1.080 · x^(−1/2) + 1.020 · x^(−1) = 0  →  2.000 y² − 1.080 y − 1.020 = 0
     *   y = (0,54 + √(0,54² + 4 × 0,51)) / 2 = (0,54 + √2,3316) / 2,   R = y² − 1 ≈ +6,81 %
     */
    const y = (0.54 + Math.sqrt(2.3316)) / 2;
    expect(r.tir).toBeCloseTo(y * y - 1, 10);
  });
});

describe("(d) la TIR de flujos sueltos", () => {
  it("con tres flujos sin solución cerrada, la tasa del motor anula el valor actual neto", () => {
    const flujos = [
      { dia: 0, importe: -1000 },
      { dia: 100, importe: -500 },
      { dia: 200, importe: 1600 }
    ];
    const tasa = tirDeFlujos(flujos, 200)!;
    /* Comprobación a mano de la ecuación: Σ importe × (1 + R)^(−día / 200) = 0. */
    const van = -1000 - 500 * Math.pow(1 + tasa, -100 / 200) + 1600 * Math.pow(1 + tasa, -200 / 200);
    expect(Math.abs(van)).toBeLessThan(1e-6);
    expect(tasa).toBeGreaterThan(0); // se gana: 1.600 > 1.500
  });

  it("sin flujos de los dos signos no hay TIR", () => {
    expect(tirDeFlujos([{ dia: 0, importe: -1000 }, { dia: 10, importe: -5 }], 10)).toBeNull();
  });
});

describe("(e) anualización", () => {
  /* 10 participaciones a 100 el 02-01-2023; 110 el 02-01-2024, 111 el 03-01-2024 y 121 el 02-01-2025. */
  const c = cartera([FON], [
    mov("aportacion", "2023-01-02", { importe: "1000" }),
    mov("suscripcion", "2023-01-02", { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" })
  ]);
  const v = valorar(c, mercado({ FON: [["2023-01-02", 100], ["2024-01-02", 110], ["2024-01-03", 111], ["2025-01-02", 121]] }), { hasta: "2025-01-02" });

  it("un año de 365 días se anualiza (GES-12): 1,1^(365,2425 / 365) − 1 = 10,00697 %, y la TIR igual sin flujos", () => {
    const r = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2024-01-02" })!;
    expect(r.dias).toBe(365);
    expect(r.twr).toBeCloseTo(0.1, 12);
    expect(r.anualiza).toBe(true);
    expect(r.twrAnualizada).toBeCloseTo(0.100069656974, 12);
    expect(r.tirAnualizada).toBeCloseTo(0.100069656974, 9);
  });

  it("más de un año se anualiza con años = días / 365,2425", () => {
    /* MOT-07: del 02-01-2023 al 04-01-2024 son 367 días; el 04-01 sigue a 111. */
    const r = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2024-01-04" })!;
    expect(r.dias).toBe(367);
    expect(r.anualiza).toBe(true);
    expect(r.twrAnualizada).toBeCloseTo(Math.pow(1.11, 365.2425 / 367) - 1, 12);
  });

  it("dos años: 1,21^(365,2425 / 731) − 1 ≈ 9,99 % al año, y la TIR anualizada coincide sin flujos", () => {
    const r = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2025-01-02" })!;
    expect(r.dias).toBe(731); // 365 + 366 (2024 es bisiesto)
    expect(r.twr).toBeCloseTo(0.21, 12);
    expect(r.twrAnualizada).toBeCloseTo(Math.pow(1.21, 365.2425 / 731) - 1, 12);
    expect(r.tirAnualizada).toBeCloseTo(Math.pow(1.21, 365.2425 / 731) - 1, 9);
  });

  it("un año natural bisiesto (366 días) se anualiza, igual que uno de 365", () => {
    /* GES-12: el «1 año» de 2024 y el de 2023 se tratan igual, los dos anualizados (antes, con MOT-07, ninguno). */
    const r = rentabilidadDelPeriodo(v, { desde: "2023-12-31", hasta: "2024-12-31" })!;
    expect(r.dias).toBe(366);
    expect(r.anualiza).toBe(true);
  });
});
