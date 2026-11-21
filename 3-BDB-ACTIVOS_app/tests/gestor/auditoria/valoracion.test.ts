/**
 * Auditoría · el valor de la cartera.
 *
 * Un fondo en euros, una acción en dólares, un bono con cupón corrido y efectivo en dos divisas,
 * valorados a una fecha con todos los precios y a otra en la que faltan (último conocido) y uno
 * es a mano. Cambio: dólares por 1 euro (convención del BCE). Cada cifra esperada lleva su
 * cuenta a mano al lado; ninguna sale del motor.
 */
import { describe, expect, it } from "vitest";
import { analizar, preparar } from "../../../src/gestor/motor/analisis";
import { FUENTE } from "../../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "../ayudas";
import { mercado } from "./ayudasAuditoria";

/*
 * Todo se compra el 30-06-2025, que es fecha de cupón del bono (cupón corrido cero ese día).
 *
 *   aportación                                       EUR +20.000
 *   fondo FON:  100 × 50                             EUR  −5.000
 *   acción USA:  20 × 150 $ al cambio 1,20            EUR  −2.500   (3.000 $ / 1,20)
 *   bono BON:   nominal 10.000 al 98 %                EUR  −9.800   (10.000 × 98 × 0,01)
 *   cambio: salen 1.100 €, entran 1.320 $ (1,20)     EUR  −1.100   USD +1.320
 *   ─────────────────────────────────────────────────────────────
 *   efectivo:  EUR 20.000 − 5.000 − 2.500 − 9.800 − 1.100 = 1.600     USD 1.320
 *
 * El bono: cupón 4 % anual, vence el 30-06-2030, base 30/360.
 */
const BONO = { cupon: "0.04", frecuencia: 1 as const, vencimiento: "2030-06-30", base: "30/360" as const };
const c = cartera(
  [activo("FON", "FONDO"), activo("USA", "ACCION", "USD"), activo("BON", "BONO", "EUR", { multiplicador: "0.01", bono: BONO })],
  [
    mov("aportacion", "2025-06-30", { importe: "20000" }),
    mov("suscripcion", "2025-06-30", { activoId: "FON", titulos: "100", precio: "50", importe: "-5000" }),
    mov("compra", "2025-06-30", { activoId: "USA", titulos: "20", precio: "150", cambio: "1.20", importe: "-2500" }),
    mov("compra", "2025-06-30", { activoId: "BON", titulos: "10000", precio: "98", importe: "-9800" }),
    mov("cambioDeDivisa", "2025-06-30", { divisa: "EUR", importe: "-1100", destino: { divisa: "USD", importe: "1320" } })
  ],
  { preciosManuales: [{ activoId: "BON", fecha: "2026-01-02", precio: "99.5" }] }
);
/* El 02-01-2026 faltan el fondo (último: 55 del 31-12) y el cambio (último: 1,25 del 31-12); el bono va a mano. */
const m = mercado(
  {
    FON: [["2025-06-30", 50], ["2025-12-31", 55]],
    USA: [["2025-06-30", 150], ["2025-12-31", 160], ["2026-01-02", 170]],
    BON: [["2025-06-30", 98], ["2025-12-31", 99]]
  },
  { USD: [["2025-06-30", 1.2], ["2025-12-31", 1.25]] }
);
const preparado = preparar(c, m, new Map(), "2026-01-02");
const a = (hasta: string) => analizar(preparado, { desde: "2025-06-29", hasta });
const posicion = (hasta: string, id: string) => a(hasta).posiciones.find((p) => p.activo.id === id)!;

describe("valor a una fecha con todos los precios (31-12-2025)", () => {
  it("el fondo en euros: títulos × precio", () => {
    const p = posicion("2025-12-31", "FON");
    expect(p.valor).toBeCloseTo(5500, 9); // 100 × 55
    expect(p.coste).toBeCloseTo(5000, 9);
    expect(p.latente).toBeCloseTo(500, 9); // 5.500 − 5.000
    expect(p.latentePct).toBeCloseTo(0.1, 12); // 5.500 / 5.000 − 1
    expect([p.fuente, p.antiguedad]).toEqual([FUENTE.mercado, 0]);
  });

  it("la acción en dólares: títulos × precio, dividido por el cambio (dólares por euro)", () => {
    const p = posicion("2025-12-31", "USA");
    expect(p.valor).toBeCloseTo(2560, 9); // 20 × 160 = 3.200 $; / 1,25 = 2.560 €
    expect(p.coste).toBeCloseTo(2500, 9); // al cambio de la compra
    expect(p.latente).toBeCloseTo(60, 9); // 2.560 − 2.500
    expect(p.precio).toBe(160); // en la divisa del activo
    expect(p.precioMedio).toBeCloseTo(150, 9); // 2.500 € × 1,20 = 3.000 $; / 20
  });

  it("el bono: nominal × (precio limpio % + cupón corrido)", () => {
    /*
     * 30/360 europea del 30-06-2025 al 31-12-2025: 6 meses × 30 + (min(31,30) − 30) = 180 días.
     * Cupón corrido = 4 % × 180/360 = 2 % del nominal = 200 €.
     * Valor = 10.000 × (99 × 0,01 + 0,02) = 10.000 × 1,01 = 10.100.
     */
    const p = posicion("2025-12-31", "BON");
    expect(p.valor).toBeCloseTo(10100, 9);
    expect(p.precio).toBe(99); // el precio que se enseña es el limpio
    expect(p.latente).toBeCloseTo(300, 9); // 10.100 − 9.800: incluye los 200 de cupón corrido
    expect(a("2025-12-31").bonos[0].cuponCorrido).toBeCloseTo(200, 9);
  });

  it("el efectivo en dos divisas y el valor total", () => {
    const analisis = a("2025-12-31");
    const porDivisa = new Map(analisis.efectivo.porDivisa.map((linea) => [linea.divisa, linea.valor]));
    expect(porDivisa.get("EUR")).toBeCloseTo(1600, 9);
    expect(porDivisa.get("USD")).toBeCloseTo(1056, 9); // 1.320 $ / 1,25
    expect(analisis.efectivo.total).toBeCloseTo(2656, 9); // 1.600 + 1.056
    /* Total: 5.500 + 2.560 + 10.100 + 1.600 + 1.056 = 20.816. */
    expect(analisis.patrimonio).toBeCloseTo(20816, 9);
    /* Latente: 500 + 60 + 300 = 860. */
    expect(analisis.latente).toBeCloseTo(860, 9);
    /* Los pesos suman uno: 20.816 / 20.816. */
    /* Todas tienen precio: si alguna no lo tuviera, su peso sería `null` y la suma, NaN. */
    const pesos = analisis.posiciones.reduce((suma, p) => suma + (p.peso ?? Number.NaN), 0) + analisis.efectivo.peso;
    expect(pesos).toBeCloseTo(1, 12);
  });

  it("el día de la compra la cartera vale lo aportado", () => {
    /* 5.000 + 20 × 150 / 1,20 + 10.000 × 0,98 + 1.600 + 1.320 / 1,20 = 5.000 + 2.500 + 9.800 + 1.600 + 1.100 = 20.000. */
    expect(a("2025-06-30").patrimonio).toBeCloseTo(20000, 9);
  });
});

describe("valor a una fecha en la que falta algún precio (02-01-2026)", () => {
  it("el fondo se valora con el último precio conocido y lo dice", () => {
    const p = posicion("2026-01-02", "FON");
    expect(p.valor).toBeCloseTo(5500, 9); // 100 × 55, el del 31-12
    expect([p.fuente, p.antiguedad]).toEqual([FUENTE.mercado, 2]); // del 31-12 al 02-01
  });

  it("la acción tiene precio del día y usa el último cambio conocido", () => {
    expect(posicion("2026-01-02", "USA").valor).toBeCloseTo(2720, 9); // 20 × 170 = 3.400 $; / 1,25
  });

  it("el bono se valora con su precio a mano y el cupón corrido del día", () => {
    /*
     * 30/360 del 30-06-2025 al 02-01-2026: (2026 − 2025) × 360 + (1 − 6) × 30 + (2 − 30) = 360 − 150 − 28 = 182 días.
     * Corrido = 4 % × 182/360 = 0,0202222… del nominal = 202,2222… €.
     * Valor = 10.000 × 99,5 × 0,01 + 202,2222… = 9.950 + 202,2222… = 10.152,2222…
     */
    const p = posicion("2026-01-02", "BON");
    expect(p.valor).toBeCloseTo(9950 + (10000 * 0.04 * 182) / 360, 9);
    expect([p.precio, p.fuente]).toEqual([99.5, FUENTE.manual]);
  });

  it("el valor total suma posiciones y efectivo", () => {
    /* 5.500 + 2.720 + 10.152,2222… + 1.600 + 1.056 = 21.028,2222… */
    expect(a("2026-01-02").patrimonio).toBeCloseTo(5500 + 2720 + 9950 + (10000 * 0.04 * 182) / 360 + 1600 + 1056, 9);
  });
});
