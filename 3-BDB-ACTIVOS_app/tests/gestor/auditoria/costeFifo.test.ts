/**
 * Auditoría · la cuenta de valores y el coste (FIFO).
 *
 * Tres compras del mismo activo, una venta que consume un lote entero y parte del siguiente,
 * un split y otra venta; un traspaso entre fondos; una entrada y una salida de títulos sin
 * efectivo; y una posición que se cierra y se vuelve a abrir. Cada cifra esperada lleva su
 * cuenta a mano al lado; ninguna sale del motor.
 */
import { describe, expect, it } from "vitest";
import { analizar, preparar } from "../../../src/gestor/motor/analisis";
import { construirLibro, cuentasA, posicionesDe } from "../../../src/gestor/motor/libro";
import { rentabilidadDelPeriodo } from "../../../src/gestor/motor/rentabilidad";
import { valorar } from "../../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "../ayudas";
import { TODO, canonica, enTexto, mercado } from "./ayudasAuditoria";

/*
 *   03-01  compra 100 × 10 + 10 de comisión  → lote 1: 100 títulos, coste 1.010
 *   03-02  compra  50 × 12 +  6              → lote 2:  50 títulos, coste   606
 *   03-03  compra  80 × 11 +  8              → lote 3:  80 títulos, coste   888
 *   01-04  venta  120 × 13 − 15,60           → cobra 1.560 − 15,60 = 1.544,40
 *   02-05  split 2 por 1
 *   02-06  venta   70 × 7, sin comisión      → cobra 490
 */
const tresCompras = cartera([activo("ACC")], [
  mov("aportacion", "2025-01-02", { importe: "100000" }),
  mov("compra", "2025-01-03", { activoId: "ACC", titulos: "100", precio: "10", comision: "10", importe: "-1010" }),
  mov("compra", "2025-02-03", { activoId: "ACC", titulos: "50", precio: "12", comision: "6", importe: "-606" }),
  mov("compra", "2025-03-03", { activoId: "ACC", titulos: "80", precio: "11", comision: "8", importe: "-888" }),
  mov("venta", "2025-04-01", { activoId: "ACC", titulos: "120", precio: "13", comision: "15.60", importe: "1544.40" }),
  mov("split", "2025-05-02", { activoId: "ACC", razon: "2" }),
  mov("venta", "2025-06-02", { activoId: "ACC", titulos: "70", precio: "7", importe: "490" })
]);

const posicionA = (fecha: string) => posicionesDe(cuentasA(tresCompras, fecha).final).find((p) => p.activoId === "ACC")!;

describe("tres compras y una venta parcial (FIFO)", () => {
  it("antes de vender: 230 títulos con un coste de 2.504 y su precio medio", () => {
    const p = posicionA("2025-03-31");
    expect(enTexto(p.titulos)).toBe(canonica("230")); // 100 + 50 + 80
    expect(enTexto(p.costeBase)).toBe(canonica("2504")); // 1.010 + 606 + 888
    expect(p.costeBase.div(p.titulos).toNumber()).toBeCloseTo(10.886956521739, 10); // 2.504 / 230
  });

  it("la venta de 120 consume el lote 1 entero y 20 del lote 2", () => {
    const realizados = construirLibro(tresCompras).realizados.filter((r) => r.fechaVenta === "2025-04-01");
    /*
     * Tramo 1: 100 títulos del lote 1, coste 1.010; cobrado 1.544,40 × 100/120 = 1.287,00; resultado 277,00.
     * Tramo 2:  20 títulos del lote 2, coste 606 × 20/50 = 242,40; cobrado 1.544,40 − 1.287 = 257,40; resultado 15,00.
     */
    expect(realizados.map((r) => [r.fechaCompra, enTexto(r.titulos), enTexto(r.costeBase), enTexto(r.cobradoBase), enTexto(r.resultado)])).toEqual([
      ["2025-01-03", canonica("100"), canonica("1010"), canonica("1287"), canonica("277")],
      ["2025-02-03", canonica("20"), canonica("242.40"), canonica("257.40"), canonica("15")]
    ]);
    /* Resultado de la venta: 1.544,40 − (1.010 + 242,40) = 292,00. */
    expect(enTexto(realizados.reduce((suma, r) => suma.plus(r.resultado), realizados[0].resultado.times(0)))).toBe(canonica("292"));
  });

  it("después de la venta quedan 110 títulos con su coste y su precio medio", () => {
    const p = posicionA("2025-04-01");
    expect(enTexto(p.titulos)).toBe(canonica("110")); // 30 del lote 2 + 80 del lote 3
    expect(enTexto(p.costeBase)).toBe(canonica("1251.60")); // 606 − 242,40 = 363,60; + 888
    expect(p.lotes.map((lote) => [enTexto(lote.titulos), enTexto(lote.costeBase)])).toEqual([
      [canonica("30"), canonica("363.60")],
      [canonica("80"), canonica("888")]
    ]);
    expect(p.costeBase.div(p.titulos).toNumber()).toBeCloseTo(11.378181818182, 10); // 1.251,60 / 110
  });

  it("el split duplica los títulos de cada lote y no cambia el coste", () => {
    const p = posicionA("2025-05-02");
    expect(enTexto(p.titulos)).toBe(canonica("220")); // 110 × 2
    expect(enTexto(p.costeBase)).toBe(canonica("1251.60")); // igual que antes
    expect(p.lotes.map((lote) => enTexto(lote.titulos))).toEqual([canonica("60"), canonica("160")]); // 30 × 2, 80 × 2
    expect(p.costeBase.div(p.titulos).toNumber()).toBeCloseTo(5.689090909091, 10); // 1.251,60 / 220: la mitad que antes
  });

  it("la venta posterior al split sigue el FIFO con los títulos ya duplicados", () => {
    const realizados = construirLibro(tresCompras).realizados.filter((r) => r.fechaVenta === "2025-06-02");
    /*
     * Tramo 1: 60 títulos del lote 2, coste 363,60; cobrado 490 × 60/70 = 420; resultado 56,40.
     * Tramo 2: 10 de los 160 del lote 3, coste 888 × 10/160 = 55,50; cobrado 490 − 420 = 70; resultado 14,50.
     */
    expect(realizados.map((r) => [enTexto(r.titulos), enTexto(r.costeBase), enTexto(r.cobradoBase), enTexto(r.resultado)])).toEqual([
      [canonica("60"), canonica("363.60"), canonica("420"), canonica("56.40")],
      [canonica("10"), canonica("55.50"), canonica("70"), canonica("14.50")]
    ]);
    const p = posicionA("2025-06-02");
    expect(enTexto(p.titulos)).toBe(canonica("150")); // 160 − 10
    expect(enTexto(p.costeBase)).toBe(canonica("832.50")); // 888 − 55,50
  });

  it("el análisis da el resultado realizado de las dos ventas, el precio medio y el latente", () => {
    const preparado = preparar(tresCompras, mercado({}), new Map(), "2025-06-02");
    const a = analizar(preparado, TODO);
    /* Realizado: 292 + 56,40 + 14,50 = 362,90. */
    expect(a.realizado).toBeCloseTo(362.9, 9);
    const p = a.posiciones.find((posicion) => posicion.activo.id === "ACC")!;
    /* Sin serie de mercado, el precio es el de la última operación: 7. Valor 150 × 7 = 1.050. */
    expect(p.precio).toBe(7);
    expect(p.valor).toBeCloseTo(1050, 9);
    expect(p.coste).toBeCloseTo(832.5, 9);
    expect(p.precioMedio).toBeCloseTo(5.55, 12); // 832,50 / 150
    expect(p.latente).toBeCloseTo(217.5, 9); // 1.050 − 832,50
  });
});

describe("traspaso entre fondos", () => {
  /*
   *   02-01  suscripción FA 100 × 10 = 1.000
   *   03-03  traspaso de 40 participaciones de FA (a 12: 480) a 24 de FB (a 20)
   */
  const traspaso = cartera([activo("FA", "FONDO"), activo("FB", "FONDO")], [
    mov("aportacion", "2025-01-02", { importe: "1000" }),
    mov("suscripcion", "2025-01-02", { activoId: "FA", titulos: "100", precio: "10", importe: "-1000" }),
    mov("traspaso", "2025-03-03", { activoId: "FA", titulos: "40", precio: "12", valor: "480", destino: { activoId: "FB", titulos: "24", precio: "20" } })
  ]);

  it("realiza el resultado del fondo de origen por FIFO", () => {
    const [realizado] = construirLibro(traspaso).realizados;
    /* Coste de 40 de las 100: 1.000 × 40/100 = 400. Cobrado: 480. Resultado: 80. */
    expect([enTexto(realizado.costeBase), enTexto(realizado.cobradoBase), enTexto(realizado.resultado)]).toEqual([canonica("400"), canonica("480"), canonica("80")]);
  });

  it("el fondo de destino entra con el valor traspasado como coste y el efectivo no se mueve", () => {
    const final = construirLibro(traspaso).final;
    const porActivo = new Map(posicionesDe(final).map((p) => [p.activoId, p]));
    expect([enTexto(porActivo.get("FA")!.titulos), enTexto(porActivo.get("FA")!.costeBase)]).toEqual([canonica("60"), canonica("600")]); // 1.000 − 400
    expect([enTexto(porActivo.get("FB")!.titulos), enTexto(porActivo.get("FB")!.costeBase)]).toEqual([canonica("24"), canonica("480")]);
    expect(enTexto(final.efectivo.get("EUR"))).toBe(canonica("0")); // 1.000 − 1.000; el traspaso no pasa por la cuenta
  });

  it("si el destino llega días después, el dinero figura en tránsito entre tanto", () => {
    const conEspera = cartera(traspaso.activos, [
      ...traspaso.movimientos.slice(0, 2),
      mov("traspaso", "2025-03-03", { activoId: "FA", titulos: "40", precio: "12", valor: "480", destino: { activoId: "FB", titulos: "24", precio: "20", fecha: "2025-03-06" } })
    ]);
    const el = (fecha: string) => cuentasA(conEspera, fecha).final;
    expect(enTexto(el("2025-03-05").transito.get("EUR"))).toBe(canonica("480"));
    expect(posicionesDe(el("2025-03-05")).some((p) => p.activoId === "FB")).toBe(false);
    expect(enTexto(el("2025-03-06").transito.get("EUR"))).toBe(canonica("0")); // 480 − 480
    expect(enTexto(posicionesDe(el("2025-03-06")).find((p) => p.activoId === "FB")!.costeBase)).toBe(canonica("480"));
  });
});

describe("entrada y salida de títulos sin efectivo", () => {
  /*
   *   02-01  entran 10 títulos con un coste declarado de 50 cada uno (500); el mercado los da a 55
   *   03-02  salen 4 títulos; el mercado los da a 60
   */
  const especie = cartera([activo("ENT")], [
    mov("entradaDeTitulos", "2025-01-02", { activoId: "ENT", titulos: "10", precio: "50" }),
    mov("salidaDeTitulos", "2025-02-03", { activoId: "ENT", titulos: "4" })
  ]);
  const m = mercado({ ENT: [["2025-01-02", 55], ["2025-02-03", 60]] });

  it("la entrada abre un lote con su coste declarado y la salida lo reduce sin realizar resultado", () => {
    const libro = construirLibro(especie);
    const [p] = posicionesDe(libro.final);
    expect(enTexto(p.titulos)).toBe(canonica("6")); // 10 − 4
    expect(enTexto(p.costeBase)).toBe(canonica("300")); // 500 × 6/10
    expect(libro.realizados).toEqual([]); // una salida a otra entidad no es una venta
    expect(libro.final.efectivo.size).toBe(0); // ninguna de las dos toca el efectivo
  });

  it("las dos cuentan como flujos externos a su valor de mercado y no mueven la rentabilidad", () => {
    const v = valorar(especie, m);
    const i = (dia: string) => v.indice.get(dia)!;
    expect(v.entradas[i("2025-01-02")]).toBeCloseTo(550, 9); // 10 × 55
    expect(v.salidas[i("2025-02-03")]).toBeCloseTo(-240, 9); // 4 × 60
    /* Del 02-01 al 03-02: (V − salidas) / (V ayer + entradas) = (6 × 60 + 240) / 550 = 600 / 550. */
    expect(rentabilidadDelPeriodo(v, TODO)!.twr).toBeCloseTo(600 / 550 - 1, 12);
    /* Resultado: 360 − 0 − (550 − 240) = 50, que es lo que subieron 10 títulos de 55 a 60. */
    expect(rentabilidadDelPeriodo(v, TODO)!.resultado).toBeCloseTo(50, 9);
  });
});

describe("posición que se cierra entera y se vuelve a abrir", () => {
  /*
   *   03-01  compra 10 × 20 = 200
   *   03-02  venta  10 × 25 = 250   → resultado 50; la posición desaparece
   *   03-03  compra  5 × 30 = 150   → posición nueva, coste 150, desde el 03-03
   */
  const ciclo = cartera([activo("CYC")], [
    mov("aportacion", "2025-01-02", { importe: "1000" }),
    mov("compra", "2025-01-03", { activoId: "CYC", titulos: "10", precio: "20", importe: "-200" }),
    mov("venta", "2025-02-03", { activoId: "CYC", titulos: "10", precio: "25", importe: "250" }),
    mov("compra", "2025-03-03", { activoId: "CYC", titulos: "5", precio: "30", importe: "-150" })
  ]);

  it("tras la venta no queda posición y el resultado realizado es 50", () => {
    const libro = cuentasA(ciclo, "2025-02-28");
    expect(posicionesDe(libro.final)).toEqual([]);
    expect(libro.realizados.map((r) => enTexto(r.resultado))).toEqual([canonica("50")]); // 250 − 200
  });

  it("la posición nueva no arrastra nada de la anterior", () => {
    const [p] = posicionesDe(construirLibro(ciclo).final);
    expect([enTexto(p.titulos), enTexto(p.costeBase), p.desde]).toEqual([canonica("5"), canonica("150"), "2025-03-03"]);
    expect(p.costeBase.div(p.titulos).toNumber()).toBe(30); // 150 / 5
  });

  it("en el análisis, la venta sale como cerrada pero no «del todo», porque se reabrió", () => {
    const a = analizar(preparar(ciclo, mercado({}), new Map(), "2025-03-03"), TODO);
    expect(a.cerradas.map((c) => [c.activoId, c.coste, c.cobrado, c.resultado, c.cerradaDelTodo])).toEqual([["CYC", 200, 250, 50, false]]);
    expect(a.cerradas[0].resultadoPct).toBeCloseTo(0.25, 12); // 50 / 200
    expect(a.realizado).toBe(50);
  });
});
