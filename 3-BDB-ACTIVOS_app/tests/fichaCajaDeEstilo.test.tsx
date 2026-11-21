/**
 * Decisión A-123 (Óscar, 09-11-2026): la caja de estilo y tamaño en la ficha del fondo. Las nueve celdas con su peso, la mayor
 * destacada y dicha como «la celda con más peso», junto a las barras de Estilo y Tamaño, que se quedan. Solo con las nueve; si no,
 * ni sección ni hueco. También en Modo cliente. Los resultados esperados están escritos a mano.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha, seccionDeLaCaja } from "../src/adapters/componerFicha";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { nueveCeldas, tramoDeLaCaja } from "../src/core/cajaDeEstilo";

/* Suman 1: 0,10 + 0,15 + 0,35 + 0,05 + 0,10 + 0,15 + 0,02 + 0,03 + 0,05. */
const CELDAS = {
  large_value: 0.1,
  large_blend: 0.15,
  large_growth: 0.35,
  mid_value: 0.05,
  mid_blend: 0.1,
  mid_growth: 0.15,
  small_value: 0.02,
  small_blend: 0.03,
  small_growth: 0.05
};

function fondo(caja: Record<string, unknown> | undefined): InstrumentoDeLaBase {
  return {
    isin: "LU1295551144",
    raiz: { identity: { name: "Capital Group New Perspective", currency: "EUR" }, instrument_type: "FUND" },
    tarjeta: {
      instrument_id: "LU1295551144",
      identity: { name: "Capital Group New Perspective" },
      exposure: {
        equity_styles: { value: 0.17, blend: 0.28, growth: 0.55 },
        market_caps: { large: 0.6, mid: 0.3, small: 0.1 }
      }
    },
    calidad: undefined,
    bloques: {
      "declared/exposure": { source: "MORNINGSTAR", as_of: "2026-09-30", confidence: "HIGH", ...(caja ? { equity_style_box: caja } : {}) }
    }
  } as unknown as InstrumentoDeLaBase;
}

const seccion = (instrumento: InstrumentoDeLaBase, modoCliente = false) =>
  componerFicha(instrumento, undefined, { modoCliente }).secciones.find((s) => s.id === "caja-de-estilo");

describe("A-123. La caja en el modelo de la ficha", () => {
  test("las nueve celdas, grande-mediana-pequeña por valor-mixto-crecimiento, con la precisión de las barras", () => {
    const caja = seccion(fondo(CELDAS))?.caja;
    expect(caja?.columnas).toEqual(["Valor", "Mixto", "Crecimiento"]);
    expect(caja?.filas.map((fila) => fila.rotulo)).toEqual(["Grande", "Mediana", "Pequeña"]);
    expect(caja?.filas.map((fila) => fila.celdas.map((celda) => celda.valor))).toEqual([
      ["10,0\u00a0%", "15,0\u00a0%", "35,0\u00a0%"],
      ["5,0\u00a0%", "10,0\u00a0%", "15,0\u00a0%"],
      ["2,0\u00a0%", "3,0\u00a0%", "5,0\u00a0%"]
    ]);
    expect(caja?.filas[0].celdas[2].peso).toBe(0.35);
  });

  test("la mayor va destacada, una sola, y la nota la dice con palabras y sin nombrar a Morningstar", () => {
    const s = seccion(fondo(CELDAS));
    const destacadas = s?.caja?.filas.flatMap((fila) => fila.celdas.filter((celda) => celda.destacada).map((celda) => celda.valor));
    expect(destacadas).toEqual(["35,0\u00a0%"]);
    expect(s?.nota).toBe("En % de la renta variable. La celda con más peso, destacada: grande · crecimiento, 35,0\u00a0%.");
    expect(JSON.stringify(s)).not.toMatch(/Morningstar/i);
  });

  test("procedencia bajo el título, como las barras: la taxonomía del proveedor y la fecha del bloque", () => {
    expect(seccion(fondo(CELDAS))?.procedencia.map((t) => t.texto).join("")).toBe("Taxonomía del proveedor · 30/09/2026");
  });

  test("va junto a Estilo y Tamaño, que se quedan", () => {
    const ids = componerFicha(fondo(CELDAS)).secciones.map((s) => s.id);
    expect(ids.slice(ids.indexOf("estilos"), ids.indexOf("estilos") + 3)).toEqual(["estilos", "tamanos", "caja-de-estilo"]);
  });

  test("las barras llevan su peso en número para el papel, y la pantalla no lo pinta", () => {
    const estilos = componerFicha(fondo(CELDAS)).secciones.find((s) => s.id === "estilos");
    expect(estilos?.filas.map((fila) => [fila.rotulo, fila.valor, fila.peso])).toEqual([
      ["Crecimiento", "55,0\u00a0%", 0.55],
      ["Mixto", "28,0\u00a0%", 0.28],
      ["Valor", "17,0\u00a0%", 0.17]
    ]);
  });

  test("sin las nueve, o si no suman 1, no hay sección ni hueco", () => {
    expect(seccion(fondo(undefined))).toBeUndefined();
    const ocho: Record<string, number> = { ...CELDAS };
    delete ocho.small_growth;
    expect(seccion(fondo(ocho))).toBeUndefined();
    expect(seccion(fondo({ ...CELDAS, small_growth: "0,05" }))).toBeUndefined();
    /* 1,02: fuera de la tolerancia de la plataforma, 0,01. */
    expect(seccion(fondo({ ...CELDAS, small_growth: 0.07 }))).toBeUndefined();
    /* 1,005: dentro. */
    expect(seccion(fondo({ ...CELDAS, small_growth: 0.055 }))).toBeDefined();
    expect(seccionDeLaCaja(undefined)).toBeUndefined();
  });

  test("también en Modo cliente, igual que en el interno", () => {
    expect(seccion(fondo(CELDAS), true)).toEqual(seccion(fondo(CELDAS), false));
  });

  test("una celda neta de cortos sale en negativo y la nota lo explica; un cero a la precisión escrita no lleva signo", () => {
    /* 0,40 + 0,15 + 0,35 − 0,05 + 0,10 + 0,05 + 0 − 0,00003 + 0,00003 = 1. */
    const s = seccion(fondo({ ...CELDAS, large_value: 0.4, mid_value: -0.05, mid_growth: 0.05, small_value: 0, small_blend: -0.00003, small_growth: 0.00003 }));
    expect(s?.caja?.filas[1].celdas[0].valor).toBe("−5,0\u00a0%");
    expect(s?.caja?.filas[2].celdas[1].valor).toBe("0,0\u00a0%");
    expect(s?.nota).toBe("En % de la renta variable. La celda con más peso, destacada: grande · valor, 40,0\u00a0%. Celdas netas de cortos: alguna sale en negativo.");
  });

  test("lo reescalado que pasa del 100 % se dice", () => {
    /* 1,50 − 0,60 + 0,10 y seis ceros = 1. */
    const s = seccion(fondo({ ...CELDAS, large_value: 1.5, large_blend: -0.6, large_growth: 0.1, mid_value: 0, mid_blend: 0, mid_growth: 0, small_value: 0, small_blend: 0, small_growth: 0 }));
    expect(s?.nota).toContain("Celdas netas de cortos: alguna sale en negativo, y el proveedor reescala lo neto al 100 %, así que otra pasa del 100 %.");
  });

  test("con empate a la precisión escrita, las empatadas, y la nota lo dice", () => {
    const s = seccion(fondo({ ...CELDAS, large_blend: 0.25, large_growth: 0.25 }));
    expect(s?.caja?.filas[0].celdas.map((celda) => Boolean(celda.destacada))).toEqual([false, true, true]);
    expect(s?.nota).toBe("En % de la renta variable. Las celdas con más peso, empatadas y destacadas: grande · mixto y grande · crecimiento, 25,0\u00a0% cada una.");
  });

  test("la tolerancia es la de la radiografía: una sola función para las dos", () => {
    expect(nueveCeldas(CELDAS)).toEqual(CELDAS);
    expect(nueveCeldas({ ...CELDAS, small_growth: 0.07 })).toBeNull();
    expect(nueveCeldas(null)).toBeNull();
  });
});

/* 14-11-2026 (Óscar: «el stylebox así es horroroso»): la caja deja de ser una tabla de filetes con una celda realzada
   y pasa a casillas de color por peso. Los tramos son los cuatro con los que el sector sombrea la caja. */
describe("La caja, en casillas de color por peso", () => {
  test("los cuatro tramos: menos del 10 %, del 10 al 25 %, del 25 al 50 % y desde el 50 %", () => {
    expect([0.0005, 0.02, 0.0999].map(tramoDeLaCaja)).toEqual([1, 1, 1]);
    expect([0.1, 0.2499].map(tramoDeLaCaja)).toEqual([2, 2]);
    expect([0.25, 0.4999].map(tramoDeLaCaja)).toEqual([3, 3]);
    expect([0.5, 1, 1.5].map(tramoDeLaCaja)).toEqual([4, 4, 4]);
  });

  test("lo que se escribiría «0,0 %», una celda neta de cortos y lo que no es un número no se pintan", () => {
    expect([0, 0.0004, -0.05, Number.NaN].map(tramoDeLaCaja)).toEqual([0, 0, 0, 0]);
  });

  test("cada casilla de la ficha lleva el color de su tramo, y la cifra sigue escrita en las nueve", () => {
    const html = renderToStaticMarkup(createElement(FichaInstrumento, { ficha: componerFicha(fondo(CELDAS)) }));
    const caja = html.slice(html.indexOf('<table class="ficha__caja"'), html.indexOf("</table>", html.indexOf('<table class="ficha__caja"')));
    /* Grande: 10, 15 y 35 %. Mediana: 5, 10 y 15 %. Pequeña: 2, 3 y 5 %. */
    expect([...caja.matchAll(/ficha__caja-celda--t([0-9])/g)].map((trozo) => Number(trozo[1]))).toEqual([2, 2, 3, 1, 2, 2, 1, 1, 1]);
    expect(caja.match(/<td [^>]*>[^<]+<[/]td>/g)).toHaveLength(9);
  });

  test("una celda en negativo va sin color, con su cifra", () => {
    /* 0,40 + 0,15 + 0,35 − 0,05 + 0,10 + 0,05 + 0 + 0 + 0 = 1. */
    const conCortos = { ...CELDAS, large_value: 0.4, mid_value: -0.05, mid_growth: 0.05, small_value: 0, small_blend: 0, small_growth: 0 };
    const html = renderToStaticMarkup(createElement(FichaInstrumento, { ficha: componerFicha(fondo(conCortos)) }));
    expect(html).toMatch(/ficha__caja-celda--t0">−5,0\u00a0%</);
  });
});

describe("A-123. La caja en pantalla", () => {
  test("una tabla de tres por tres con sus rótulos, y la mayor marcada", () => {
    const html = renderToStaticMarkup(createElement(FichaInstrumento, { ficha: componerFicha(fondo(CELDAS)) }));
    const caja = html.slice(html.indexOf('<table class="ficha__caja"'), html.indexOf("</table>", html.indexOf('<table class="ficha__caja"')));
    expect(caja.match(/<td /g)).toHaveLength(9);
    expect(caja.match(/ficha__caja-celda--mayor/g)).toHaveLength(1);
    expect(caja).toMatch(/ficha__caja-celda--mayor">35,0\u00a0%</);
    for (const rotulo of ["Valor", "Mixto", "Crecimiento", "Grande", "Mediana", "Pequeña"]) expect(caja).toContain(`>${rotulo}</th>`);
    expect(html).toContain("Caja de estilo y tamaño");
  });

  test("sin caja, ni rastro en la ficha", () => {
    const html = renderToStaticMarkup(createElement(FichaInstrumento, { ficha: componerFicha(fondo(undefined)) }));
    expect(html).not.toContain("ficha__caja");
    expect(html).not.toContain("Caja de estilo");
  });
});
