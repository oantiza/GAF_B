/**
 * Auditoría · los arreglos de MOT-01 a MOT-04, con sus cifras. `defectos.test.ts` demuestra que el
 * resultado ya no depende de lo que no debía; aquí se comprueba, con una cuenta a mano junto a cada
 * cifra, que el resultado es el que dice la convención nueva.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { construirLibro, posicionesDe } from "../../../src/gestor/motor/libro";
import { valorar } from "../../../src/gestor/motor/valoracion";
import { importe, importeConSigno, porcentaje, porcentajeConSigno, precio, puntos } from "../../../src/gestor/ui/formato";
import { Cifra } from "../../../src/components/ui/Cifra";
import { activo, cartera, mov } from "../ayudas";
import { enTexto, canonica, mercado } from "./ayudasAuditoria";

describe("MOT-01 · el split divide el precio anterior a él aunque la serie de mercado no lo ajuste", () => {
  it("con serie de mercado que no lo ajusta y que acaba antes del split, el precio a mano anterior se divide", () => {
    /*
     * Serie de la plataforma hasta el 03-01 (100), no ajustada por el split (serieAjustada: false). Precio a mano de 110 el
     * 06-01. Split 2×1 el 10-01. El 12-01: 20 títulos × 110 / 2 = 1.100 (antes: 20 × 110 = 2.200).
     */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2025-01-02", { importe: "1000" }),
      mov("compra", "2025-01-02", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("split", "2025-01-10", { activoId: "ACC", razon: "2", serieAjustada: false })
    ], { preciosManuales: [{ activoId: "ACC", fecha: "2025-01-06", precio: "110" }] });
    const v = valorar(c, mercado({ ACC: [["2025-01-02", 100], ["2025-01-03", 100]] }), { hasta: "2025-01-12" });
    expect(v.valor[v.indice.get("2025-01-09")!]).toBeCloseTo(1100, 9); // 10 × 110
    expect(v.valor[v.indice.get("2025-01-12")!]).toBeCloseTo(1100, 9); // 20 × 55
    expect(v.porActivo.get("ACC")!.precio[v.indice.get("2025-01-12")!]).toBeCloseTo(55, 9); // precio real del día: 110 / 2
  });
});

describe("MOT-02 · las cifras con la convención nueva", () => {
  it("dos compras del mismo día son un lote a coste medio: el realizado y lo que queda salen a 15", () => {
    /*
     * 10 a 10 (100) y 10 a 20 (200) el 02-01: un lote de 20 títulos que cuesta 300, coste medio 15.
     * Venta de 15 a 30 el 03-02 (450): coste 15 × 15 = 225, resultado 450 − 225 = 225.
     * Quedan 5 títulos con coste 300 − 225 = 75.
     */
    const libro = construirLibro(cartera([activo("ACC")], [
      mov("aportacion", "2025-01-02", { importe: "1000" }),
      mov("compra", "2025-01-02", { id: "cara", activoId: "ACC", titulos: "10", precio: "20", importe: "-200" }),
      mov("compra", "2025-01-02", { id: "barata", activoId: "ACC", titulos: "10", precio: "10", importe: "-100" }),
      mov("venta", "2025-02-03", { activoId: "ACC", titulos: "15", precio: "30", importe: "450" })
    ]));
    expect(libro.realizados.map((r) => [enTexto(r.titulos), enTexto(r.costeBase), enTexto(r.resultado)])).toEqual([[canonica("15"), canonica("225"), canonica("225")]]);
    const [posicion] = posicionesDe(libro.final);
    expect([enTexto(posicion.titulos), enTexto(posicion.costeBase)]).toEqual([canonica("5"), canonica("75")]);
    expect(posicion.lotes).toHaveLength(1);
  });

  it("sin serie de cambios, dos cambios propios del mismo día se promedian ponderados por importe", () => {
    /*
     * 1.000 € a 1,10 compran 10 U1 a 110 $ (1.100 $); 500 € a 1,20 compran 5 U2 a 120 $ (600 $). Aportación 1.500 €.
     * Cambio del día: (1.100 + 600) $ / (1.000 + 500) € = 1,13333…  →  posiciones 1.700 $ / 1,13333… = 1.500 €;
     * efectivo 1.500 − 1.000 − 500 = 0. Patrimonio 1.500 €, en los dos órdenes.
     * (Con la media simple, 1,15: 1.478,26 €; con el último del fichero: 1.416,67 € o 1.545,45 €.)
     */
    const u1 = mov("compra", "2025-01-02", { id: "u1", activoId: "U1", titulos: "10", precio: "110", cambio: "1.10", importe: "-1000" });
    const u2 = mov("compra", "2025-01-02", { id: "u2", activoId: "U2", titulos: "5", precio: "120", cambio: "1.20", importe: "-500" });
    const activos = [activo("U1", "ACCION", "USD"), activo("U2", "ACCION", "USD")];
    const m = mercado({ U1: [["2025-01-02", 110]], U2: [["2025-01-02", 120]] });
    for (const orden of [[u1, u2], [u2, u1]]) {
      const v = valorar(cartera(activos, [mov("aportacion", "2025-01-02", { importe: "1500" }), ...orden]), m, { hasta: "2025-01-03" });
      expect(v.valor[v.valor.length - 1]).toBeCloseTo(1500, 9);
      expect(1 / v.aBase("USD", "2025-01-02")).toBeCloseTo(1700 / 1500, 12);
    }
  });
});

describe("MOT-03 · el color sale de lo que se pinta", () => {
  it("un cero escrito sin decimales no lleva color; una cifra pintada distinta de cero, sí", () => {
    /* Desde el rediseño (14-11-2026) la pantalla escribe sus cifras con la pieza común `Cifra`, que decide el color con
       el signo de la cifra ya redondeada: la misma regla, en el módulo común. */
    const importeConColor = (valor: number, decimales?: number) => renderToStaticMarkup(createElement(Cifra, { tipo: "importe", valor, decimales, conSigno: true, colorDeSigno: true }));
    const rentabilidad = (valor: number) => renderToStaticMarkup(createElement(Cifra, { tipo: "rentabilidad", valor }));
    expect(importeConColor(-0.4, 0)).toBe('<span class="cifra">0\u00a0€</span>'); // −0,4 € a 0 decimales: «0 €»
    expect(importeConColor(-0.006)).toBe('<span class="cifra cifra--baja">\u22120,01\u00a0€</span>'); // −0,006 → −0,01
    expect(rentabilidad(0.0001)).toBe('<span class="cifra cifra--sube">+0,01\u00a0%</span>'); // 0,01 %
    expect(rentabilidad(-0.00004)).toBe('<span class="cifra">0,00\u00a0%</span>'); // −0,004 % → 0,00 %
    /* Los textos del formato de pantalla del gestor, que delega en el módulo común, escriben lo mismo. */
    expect([importeConSigno(-0.4, "EUR", 0), importe(-0.006), porcentajeConSigno(0.0001), porcentajeConSigno(-0.00004)]).toEqual(["0\u00a0€", "\u22120,01\u00a0€", "+0,01\u00a0%", "0,00\u00a0%"]);
  });
});

describe("MOT-04 · una cifra que no es un número se escribe como un dato que falta", () => {
  it("ningún formato escribe «NaN» ni «Infinity»", () => {
    for (const valor of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      for (const texto of [importe(valor), importeConSigno(valor), porcentaje(valor), porcentajeConSigno(valor), puntos(valor), precio(valor, "USD")]) {
        expect(texto).toBe("Falta el dato");
      }
    }
  });
});
