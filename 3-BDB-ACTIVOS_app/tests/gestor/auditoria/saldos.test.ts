/**
 * Auditoría · la cuenta de efectivo.
 *
 * El saldo de efectivo a varias fechas, por fecha de operación y por fecha valor, y el saldo
 * por divisa de una cartera en euros con una cuenta en dólares. Cada cifra esperada lleva su
 * cuenta a mano al lado; ninguna sale del motor.
 */
import { describe, expect, it } from "vitest";
import { cuentasA, extractoDeEfectivo, construirLibro, posicionesDe, titulosDe } from "../../../src/gestor/motor/libro";
import { activo, cartera, mov } from "../ayudas";
import { canonica, enTexto } from "./ayudasAuditoria";

/*
 * Cartera en euros con un fondo «FON».
 *
 *   02-01  aportación                         +10.000,00
 *   03-01  compra 50 × 100 + 7,50 de comisión  −5.007,50   (fecha valor 07-01)
 *   10-01  dividendo 100 bruto, 19 retenido       +81,00
 *   15-01  custodia                               −12,10
 *   20-01  venta 20 × 110 − 4,40 de comisión   +2.195,60   (fecha valor 22-01)
 *   25-01  retirada                            −3.000,00
 *   31-01  intereses 3,00 brutos, 0,57 retenido    +2,43
 */
const saldosEnEuros = cartera([activo("FON", "FONDO")], [
  mov("aportacion", "2025-01-02", { importe: "10000" }),
  mov("compra", "2025-01-03", { activoId: "FON", titulos: "50", precio: "100", comision: "7.50", importe: "-5007.50", fechaValor: "2025-01-07" }),
  mov("dividendo", "2025-01-10", { activoId: "FON", importe: "81", retencion: "19" }),
  mov("comision", "2025-01-15", { importe: "-12.10", nota: "Custodia" }),
  mov("venta", "2025-01-20", { activoId: "FON", titulos: "20", precio: "110", comision: "4.40", importe: "2195.60", fechaValor: "2025-01-22" }),
  mov("retirada", "2025-01-25", { importe: "-3000" }),
  mov("interes", "2025-01-31", { importe: "2.43", retencion: "0.57" })
]);

const saldoEUR = (fecha: string, criterio: "operacion" | "valor" = "operacion") =>
  enTexto(cuentasA(saldosEnEuros, fecha, { criterio }).final.efectivo.get("EUR"));

describe("saldo de efectivo por fecha de operación", () => {
  it("da el saldo de cada fecha intermedia y del final", () => {
    expect(saldoEUR("2025-01-01")).toBe("sin saldo"); // antes del primer movimiento no hay cuenta
    expect(saldoEUR("2025-01-02")).toBe(canonica("10000")); // la aportación
    expect(saldoEUR("2025-01-03")).toBe(canonica("4992.50")); // 10.000 − 5.007,50
    expect(saldoEUR("2025-01-09")).toBe(canonica("4992.50")); // sin movimientos entre medias
    expect(saldoEUR("2025-01-10")).toBe(canonica("5073.50")); // 4.992,50 + 81
    expect(saldoEUR("2025-01-15")).toBe(canonica("5061.40")); // 5.073,50 − 12,10
    expect(saldoEUR("2025-01-20")).toBe(canonica("7257.00")); // 5.061,40 + 2.195,60
    expect(saldoEUR("2025-01-25")).toBe(canonica("4257.00")); // 7.257 − 3.000
    expect(saldoEUR("2025-01-31")).toBe(canonica("4259.43")); // 4.257 + 2,43
  });

  it("el extracto de la cuenta lleva el saldo acumulado línea a línea", () => {
    const lineas = extractoDeEfectivo(construirLibro(saldosEnEuros), "EUR");
    expect(lineas.map((linea) => [linea.fecha, enTexto(linea.importe), enTexto(linea.saldo)])).toEqual([
      ["2025-01-02", canonica("10000"), canonica("10000")],
      ["2025-01-03", canonica("-5007.50"), canonica("4992.50")],
      ["2025-01-10", canonica("81"), canonica("5073.50")],
      ["2025-01-15", canonica("-12.10"), canonica("5061.40")],
      ["2025-01-20", canonica("2195.60"), canonica("7257.00")],
      ["2025-01-25", canonica("-3000"), canonica("4257.00")],
      ["2025-01-31", canonica("2.43"), canonica("4259.43")]
    ]);
  });

  it("la cuenta de valores queda con los títulos que no se vendieron", () => {
    const final = construirLibro(saldosEnEuros).final;
    expect(enTexto(titulosDe(final, "FON"))).toBe(canonica("30")); // 50 comprados − 20 vendidos
  });
});

describe("saldo de efectivo por fecha valor", () => {
  it("la compra no carga hasta su fecha valor y la venta no abona hasta la suya", () => {
    expect(saldoEUR("2025-01-03", "valor")).toBe(canonica("10000")); // la compra liquida el 07-01
    expect(saldoEUR("2025-01-06", "valor")).toBe(canonica("10000"));
    expect(saldoEUR("2025-01-07", "valor")).toBe(canonica("4992.50")); // 10.000 − 5.007,50
    expect(saldoEUR("2025-01-20", "valor")).toBe(canonica("5061.40")); // 4.992,50 + 81 − 12,10: la venta aún no
    expect(saldoEUR("2025-01-21", "valor")).toBe(canonica("5061.40"));
    expect(saldoEUR("2025-01-22", "valor")).toBe(canonica("7257.00")); // + 2.195,60
    expect(saldoEUR("2025-01-31", "valor")).toBe(canonica("4259.43")); // al final, los dos criterios coinciden
  });

  it("el criterio de fecha valor no cambia los títulos (se miden por fecha de operación)", () => {
    /* Con fecha valor, los efectos de la compra solo entran el 07-01: el 05-01 aún no hay títulos. Es el corte
       por fecha valor del libro entero, no solo del efectivo; la valoración usa siempre la fecha de operación. */
    expect(enTexto(titulosDe(cuentasA(saldosEnEuros, "2025-01-05", { criterio: "valor" }).final, "FON"))).toBe(canonica("0"));
    expect(enTexto(titulosDe(cuentasA(saldosEnEuros, "2025-01-05").final, "FON"))).toBe(canonica("50"));
  });
});

/*
 * Dos divisas: base euro y una cuenta en dólares.
 *
 *   03-03  aportación                                       EUR +20.000
 *   04-03  cambio: salen 9.000 €, entran 9.765 $ (1,085)    EUR −9.000   USD +9.765
 *   05-03  compra en dólares 40 × 200 + 5 $ de comisión               USD −8.005   (cambio 1,085)
 *   10-03  dividendo en dólares: 10 brutos, 1,50 retenido             USD +8,50
 */
const dosDivisas = cartera([activo("USA", "ACCION", "USD")], [
  mov("aportacion", "2025-03-03", { importe: "20000" }),
  mov("cambioDeDivisa", "2025-03-04", { divisa: "EUR", importe: "-9000", destino: { divisa: "USD", importe: "9765" } }),
  mov("compra", "2025-03-05", { activoId: "USA", titulos: "40", precio: "200", comision: "5", divisa: "USD", importe: "-8005", cambio: "1.085" }),
  mov("dividendo", "2025-03-10", { activoId: "USA", divisa: "USD", importe: "8.50", retencion: "1.50" })
]);

describe("saldo por divisa", () => {
  const saldo = (fecha: string, divisa: string) => enTexto(cuentasA(dosDivisas, fecha).final.efectivo.get(divisa));

  it("cada divisa lleva su propio saldo", () => {
    expect(saldo("2025-03-03", "EUR")).toBe(canonica("20000"));
    expect(saldo("2025-03-03", "USD")).toBe("sin saldo");
    expect(saldo("2025-03-04", "EUR")).toBe(canonica("11000")); // 20.000 − 9.000
    expect(saldo("2025-03-04", "USD")).toBe(canonica("9765")); // 9.000 × 1,085
    expect(saldo("2025-03-05", "USD")).toBe(canonica("1760")); // 9.765 − 8.005
    expect(saldo("2025-03-10", "USD")).toBe(canonica("1768.50")); // 1.760 + 8,50
    expect(saldo("2025-03-10", "EUR")).toBe(canonica("11000")); // la compra y el dividendo en dólares no tocan el euro
  });

  it("el coste en euros de la compra en dólares usa el cambio de la operación", () => {
    const [posicion] = posicionesDe(construirLibro(dosDivisas).final);
    /* 8.005 $ / 1,085 = 8.005.000 / 1.085 = 7.377 + 955/1.085 = 7.377,880184331797… € */
    expect(posicion.costeBase.toNumber()).toBeCloseTo(7377.880184331797, 9);
    expect(enTexto(posicion.costeLocal)).toBe(canonica("8005")); // en dólares, lo pagado tal cual
    expect(posicion.costeIncompleto).toBe(false);
  });
});
