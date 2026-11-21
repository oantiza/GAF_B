/**
 * Auditoría · de dónde viene el resultado.
 *
 * Una acción en dólares comprada desde euros con comisión, un dividendo con retención y una
 * comisión de custodia. Comprueba, al céntimo, que efecto precio + ingresos + efecto divisa −
 * costes = resultado = valor final − valor inicial − flujos externos, y que la contribución por
 * posición suma la rentabilidad del periodo. Convención (cabecera de `valoracion.ts`): el
 * efecto precio es la variación en la divisa del activo al cambio de HOY, y el efecto divisa,
 * el resto. Cada cifra esperada lleva su cuenta a mano al lado.
 */
import { describe, expect, it } from "vitest";
import { analizar, preparar } from "../../../src/gestor/motor/analisis";
import { activo, cartera, mov } from "../ayudas";
import { TODO, mercado } from "./ayudasAuditoria";

/*
 *   03-03  aporta 10.000 €
 *   03-03  compra 50 USA × 100 $ al cambio 1,25 + 10 € de comisión:  50 × 100 / 1,25 + 10 = 4.010 €
 *   10-03  dividendo 50 € brutos, 10 retenidos: 40 € netos
 *   12-03  custodia: −15 €
 *   14-03  USA a 110 $ y el dólar a 1,20
 *
 * Valor final: 50 × 110 / 1,20 = 4.583,3333… + efectivo (10.000 − 4.010 + 40 − 15 = 6.015) = 10.598,3333…
 * Resultado: 10.598,3333… − 0 − 10.000 = 598,3333…
 *
 * Por partes (cuenta a mano, día a día):
 *   03-03  USA: valor 4.000, invertido 4.010 → −10 €. En dólares: 5.000 − 4.010 × 1,25 = −12,5 $ → precio −12,5 / 1,25 = −10; divisa 0.
 *   14-03  USA: en dólares 5.500 − 5.000 = +500 $ → precio 500 / 1,20 = 416,6667;
 *          en euros 4.583,3333 − 4.000 = 583,3333 → divisa 583,3333 − 416,6667 = 166,6667.
 *   Precio  = −10 + 416,6667 = 406,6667      Ingresos = 40      Divisa = 166,6667      Costes = 15
 *   406,6667 + 40 + 166,6667 − 15 = 598,3333 ✓
 */
const c = cartera([activo("USA", "ACCION", "USD")], [
  mov("aportacion", "2025-03-03", { importe: "10000" }),
  mov("compra", "2025-03-03", { activoId: "USA", titulos: "50", precio: "100", cambio: "1.25", comision: "10", importe: "-4010" }),
  mov("dividendo", "2025-03-10", { activoId: "USA", importe: "40", retencion: "10" }),
  mov("comision", "2025-03-12", { importe: "-15", nota: "Custodia" })
]);
const m = mercado({ USA: [["2025-03-03", 100], ["2025-03-14", 110]] }, { USD: [["2025-03-03", 1.25], ["2025-03-14", 1.2]] });
const a = analizar(preparar(c, m, new Map(), "2025-03-14"), TODO);
const desglose = a.desglose!;
const rentabilidad = a.rentabilidad!;
const RESULTADO = 50 * 110 / 1.2 + 6015 - 10000; // 598,3333…

describe("las partes del resultado", () => {
  it("cada parte vale lo calculado a mano", () => {
    expect(desglose.precio).toBeCloseTo(500 / 1.2 - 10, 9); // 406,6667: la comisión de compra queda dentro del efecto precio
    expect(desglose.ingresos).toBeCloseTo(40, 9); // el dividendo, neto de su retención
    expect(desglose.divisa).toBeCloseTo(50 * 110 / 1.2 - 4000 - 500 / 1.2, 9); // 166,6667
    expect(desglose.costes).toBeCloseTo(15, 9); // solo la custodia: la comisión de la compra no está aquí
  });

  it("suman el resultado, y el resultado es valor final − inicial − flujos externos", () => {
    expect(desglose.precio + desglose.ingresos + desglose.divisa - desglose.costes).toBeCloseTo(desglose.resultado, 9);
    expect(desglose.resultado).toBeCloseTo(RESULTADO, 9);
    expect(rentabilidad.valorFinal - rentabilidad.valorInicial - rentabilidad.aportacionesNetas).toBeCloseTo(RESULTADO, 9);
    expect(rentabilidad.resultado).toBeCloseTo(desglose.resultado, 9);
  });

  it("redondeadas al céntimo, las partes suman exactamente el resultado redondeado", () => {
    const q = desglose.cuadrado;
    const centimos = (x: number) => Math.round(x * 100);
    /* Resultado: 598,33. Sin cuadrar, 406,67 + 40,00 + 166,67 − 15,00 = 598,34: sobra un céntimo que hay que quitar a una parte. */
    expect(q.resultado).toBe(598.33);
    expect(centimos(q.precio) + centimos(q.ingresos) + centimos(q.divisa) - centimos(q.costes)).toBe(59833);
    expect([q.ingresos, q.costes]).toEqual([40, 15]);
    expect(Math.abs(q.precio - desglose.precio)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(q.divisa - desglose.divisa)).toBeLessThanOrEqual(0.01);
  });

  it("la comisión de la compra y la retención siguen visibles en ingresos y costes", () => {
    const ic = a.ingresosYCostes;
    expect(ic.costesDeOperacion).toBeCloseTo(10, 9);
    expect(ic.costesDelServicio).toBeCloseTo(15, 9);
    expect(ic.costesExplicitos).toBeCloseTo(25, 9); // 10 + 15
    expect([ic.dividendos.bruto, ic.dividendos.retencion, ic.dividendos.neto]).toEqual([50, 10, 40]);
    expect(ic.impuestos).toBeCloseTo(10, 9); // la retención del dividendo
  });
});

describe("la contribución por posición", () => {
  /*
   * Sin flujos después del primer día, la TWR se telescopia: 10.598,3333 / 10.000 − 1 = 5,983333 %.
   * Contribución: cada día, resultado del día × (factor acumulado antes de ese día) / (capital del día).
   *   03-03  USA:  −10  × 1 / 10.000                        = −0,001
   *   10-03  USA:  +40  × (9.990 / 10.000) / 9.990          = +0,004
   *   12-03  cuenta: −15 × (10.030 / 10.000) / 10.030       = −0,0015
   *   14-03  USA:  +583,3333 × (10.015 / 10.000) / 10.015   = +0,0583333
   *   USA = −0,001 + 0,004 + 0,0583333 = 0,0613333;  efectivo = −0,0015;  total = 0,0598333
   */
  it("la de cada parte es la calculada a mano", () => {
    const usa = desglose.posiciones.find((p) => p.activoId === "USA")!;
    expect(usa.contribucion).toBeCloseTo(-0.001 + 0.004 + 583.3333333333 / 10000, 9);
    expect(desglose.efectivo.contribucion).toBeCloseTo(-0.0015, 12);
  });

  it("suman la rentabilidad ponderada por tiempo del periodo", () => {
    expect(rentabilidad.twr).toBeCloseTo(RESULTADO / 10000, 12);
    const suma = desglose.posiciones.reduce((total, p) => total + p.contribucion, 0) + desglose.efectivo.contribucion;
    expect(suma).toBeCloseTo(rentabilidad.twr, 12);
    expect(desglose.contribucionTotal).toBeCloseTo(rentabilidad.twr, 12);
  });

  it("el resultado de la posición es su variación de valor menos lo invertido, más sus ingresos", () => {
    const usa = desglose.posiciones.find((p) => p.activoId === "USA")!;
    /* 4.583,3333 − 0 − 4.010 + 40 de dividendo = 613,3333. */
    expect(usa.resultado).toBeCloseTo(50 * 110 / 1.2 - 4010 + 40, 9);
    expect(usa.valorFinal - usa.valorInicial - usa.invertido + usa.ingresos - usa.costes).toBeCloseTo(usa.resultado, 9);
  });
});
