/**
 * Auditoría · defectos encontrados.
 *
 * Cada prueba está escrita como debería pasar cuando el defecto se arregle: HOY FALLA. Su
 * número (MOT-nn) es el del informe de la auditoría, donde están la cuenta, la causa y el
 * arreglo propuesto. No se ha tocado el código: solo se demuestra.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { construirLibro } from "../../../src/gestor/motor/libro";
import { rentabilidadDelPeriodo } from "../../../src/gestor/motor/rentabilidad";
import { valorar } from "../../../src/gestor/motor/valoracion";
import { importe } from "../../../src/gestor/ui/formato";
import { Cifra } from "../../../src/components/ui/Cifra";
import { activo, cartera, mov } from "../ayudas";
import { TODO, mercado } from "./ayudasAuditoria";

describe("MOT-01 · un split en un activo sin serie de mercado no debe cambiar su valor", () => {
  /*
   * Acción creada a mano (sin serie en la plataforma): 10 títulos a 100 el 02-01. Split de 2 por 1 el 10-01.
   * El valor real no cambia: antes, 10 × 100 = 1.000; después, 20 × 50 = 1.000. Rentabilidad del periodo: 0.
   * Hoy el motor valora los 20 títulos al precio de la compra, anterior al split: 20 × 100 = 2.000 (+100 %).
   */
  const c = cartera([activo("MAN")], [
    mov("aportacion", "2025-01-02", { importe: "1000" }),
    mov("compra", "2025-01-02", { activoId: "MAN", titulos: "10", precio: "100", importe: "-1000" }),
    mov("split", "2025-01-10", { activoId: "MAN", razon: "2" })
  ]);

  it("con el precio de la última operación", () => {
    const v = valorar(c, mercado({}), { hasta: "2025-01-15" });
    expect(v.valor[v.indice.get("2025-01-09")!]).toBeCloseTo(1000, 9);
    expect(v.valor[v.indice.get("2025-01-10")!]).toBeCloseTo(1000, 9); // 20 × 50
    expect(rentabilidadDelPeriodo(v, TODO)!.twr).toBeCloseTo(0, 12);
  });

  it("con un precio a mano anterior al split", () => {
    /* Precio a mano de 105 el 05-01, antes del split: después vale 20 × 52,50 = 1.050, no 20 × 105 = 2.100. */
    const conPrecio = { ...c, preciosManuales: [{ activoId: "MAN", fecha: "2025-01-05", precio: "105" }] };
    const v = valorar(conPrecio, mercado({}), { hasta: "2025-01-15" });
    expect(v.valor[v.indice.get("2025-01-09")!]).toBeCloseTo(1050, 9); // 10 × 105
    expect(v.valor[v.indice.get("2025-01-12")!]).toBeCloseTo(1050, 9); // 20 × 52,50
  });
});

describe("MOT-02 · el orden en el fichero de dos movimientos iguales del mismo día no debe cambiar las cifras", () => {
  it("dos compras del mismo activo el mismo día y una venta parcial: el resultado realizado no depende de cuál va antes", () => {
    /*
     * 02-01: compra 10 a 10 (100) y compra 10 a 20 (200). 03-02: venta 15 a 30 (450).
     * Si se consume antes el lote de 10: coste 100 + 5 × 20 = 200, resultado 250.
     * Si se consume antes el de 20:     coste 200 + 5 × 10 = 250, resultado 200.
     * Las dos compras son del mismo día: el FIFO no distingue cuál es «la primera», y hoy decide el orden del fichero.
     */
    const barata = mov("compra", "2025-01-02", { id: "barata", activoId: "ACC", titulos: "10", precio: "10", importe: "-100" });
    const cara = mov("compra", "2025-01-02", { id: "cara", activoId: "ACC", titulos: "10", precio: "20", importe: "-200" });
    const resto = [mov("aportacion", "2025-01-02", { importe: "1000" }), mov("venta", "2025-02-03", { activoId: "ACC", titulos: "15", precio: "30", importe: "450" })];
    const realizado = (orden: typeof barata[]) =>
      construirLibro(cartera([activo("ACC")], [...resto, ...orden])).realizados.reduce((suma, r) => suma + r.resultado.toNumber(), 0);
    expect(realizado([barata, cara])).toBe(realizado([cara, barata]));
  });

  it("sin cambios de mercado, dos operaciones en dólares del mismo día con cambios distintos: el patrimonio no depende de cuál va antes", () => {
    /*
     * 10 títulos de U1 a 100 $ al cambio 1,10 y 10 de U2 a 100 $ al cambio 1,20, el mismo día. Sin serie de cambios,
     * el motor usa «el último cambio conocido de la cartera»; con dos el mismo día, hoy gana el último del fichero:
     * 2.000 $ / 1,20 = 1.666,67 € o 2.000 $ / 1,10 = 1.818,18 €, según el orden.
     */
    const u1 = mov("compra", "2025-01-02", { id: "u1", activoId: "U1", titulos: "10", precio: "100", cambio: "1.10", importe: "-909.09" });
    const u2 = mov("compra", "2025-01-02", { id: "u2", activoId: "U2", titulos: "10", precio: "100", cambio: "1.20", importe: "-833.33" });
    const activos = [activo("U1", "ACCION", "USD"), activo("U2", "ACCION", "USD")];
    const m = mercado({ U1: [["2025-01-02", 100]], U2: [["2025-01-02", 100]] });
    const patrimonio = (orden: typeof u1[]) => {
      const v = valorar(cartera(activos, [mov("aportacion", "2025-01-02", { importe: "2000" }), ...orden]), m, { hasta: "2025-01-03" });
      return v.valor[v.valor.length - 1];
    };
    expect(patrimonio([u1, u2])).toBeCloseTo(patrimonio([u2, u1]), 6);
  });
});

describe("MOT-03 · una cifra que se escribe como cero no se pinta en rojo", () => {
  it("−0,004 € se escribe «0,00 €» y no debe llevar la clase de bajada", () => {
    /* Desde el rediseño, la pantalla escribe sus cifras con la pieza común `Cifra`: el color sale de la cifra redondeada. */
    const html = renderToStaticMarkup(createElement(Cifra, { tipo: "importe", valor: -0.004, conSigno: true, colorDeSigno: true }));
    expect(html).toContain("0,00\u00a0€");
    expect(html).not.toContain("cifra--baja");
    expect(importe(-0.004)).toBe("0,00\u00a0€");
  });
});

describe("MOT-04 · el formato de pantalla no escribe «NaN» con una cifra ausente", () => {
  it("un importe que no es un número no se pinta como «NaN €»", () => {
    expect(importe(Number.NaN)).not.toContain("NaN");
    expect(importe(undefined as unknown as number)).not.toContain("NaN");
  });
});
