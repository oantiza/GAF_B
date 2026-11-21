import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TablaDeMetricasComparativas } from "../src/components/MetricasComparativas";

/*
 * La tabla de la Comparativa de Simular, que es también «Medida con la serie» en Optimizar › Rentabilidad objetivo (puertas finales del 06-11,
 * pantalla-2 y pantalla-3). Las cifras son las de la muestra en la base nueva que vio la puerta, y las diferencias, calculadas a mano:
 *   rentabilidad 8,24 − 13,48 = −5,24 puntos; volatilidad 5,46 − 8,44 = −2,98; caída −7,32 − (−13,05) = +5,73; Sharpe 1,01 − 1,27 = −0,26.
 */
const CARTERA = { cagr: 0.1348, volatility: 0.0844, sharpe: 1.27, max_drawdown: -0.1305 };
const MAXIMO_SHARPE = { cagr: 0.0824, volatility: 0.0546, sharpe: 1.01, max_drawdown: -0.0732 };

const pintar = (props: Partial<Parameters<typeof TablaDeMetricasComparativas>[0]> = {}) =>
  renderToStaticMarkup(createElement(TablaDeMetricasComparativas, {
    aria: "Comparativa de métricas",
    rotuloA: "Parte medida (88 %)",
    rotuloB: "Máx. Sharpe (máx. 35 % por activo)",
    a: CARTERA,
    b: MAXIMO_SHARPE,
    ...props
  }));

/** Las celdas de cada fila, en texto: React separa con un comentario los trozos de texto contiguos. */
const filas = (html: string) =>
  [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, fila]) =>
    [...fila.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, celda]) => celda.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "")));

describe("la diferencia de dos porcentajes, en puntos (pantalla-3)", () => {
  test("rentabilidad, volatilidad y caída en «pp», y el Sharpe sin unidad, como Buscar sustituciones y Comparar carteras", () => {
    expect(filas(pintar())).toEqual([
      ["Métrica", "Parte medida (88\u00a0%)", "Máx. Sharpe (máx. 35\u00a0% por activo)", "Diferencia"],
      ["Rentabilidad anualizada", "+13,48 %", "+8,24 %", "−5,24 pp"],
      ["Volatilidad", "8,44 %", "5,46 %", "−2,98 pp"],
      ["Sharpe", "1,27", "1,01", "−0,26"],
      ["Caída máxima", "−13,05 %", "−7,32 %", "+5,73 pp"]
    ]);
  });

  test("lo que falta sigue diciéndolo, sin restar contra nada", () => {
    const html = pintar({ b: { ...MAXIMO_SHARPE, cagr: undefined } });
    expect(filas(html)[1]).toEqual(["Rentabilidad anualizada", "+13,48 %", "Falta", "Falta"]);
    expect(html).not.toContain("NaN");
  });

  test("sin cartera con que comparar, una sola columna y ninguna diferencia", () => {
    const celdas = filas(pintar({ rotuloA: undefined, a: undefined }));
    expect(celdas[0]).toEqual(["Métrica", "Máx. Sharpe (máx. 35\u00a0% por activo)"]);
    expect(celdas.every((fila) => fila.length === 2)).toBe(true);
    expect(celdas.flat().filter((celda) => celda.endsWith(" pp"))).toEqual([]);
  });
});

describe("la tabla lleva su envoltorio (pantalla-2, trampa 5)", () => {
  test("la pieza envuelve la tabla, y no la pantalla que la usa", () => {
    /* El envoltorio se desplaza de lado donde la tabla no cabe (a 1.025 px, en Simular), así que se alcanza con el
       teclado y dice qué es, como el marco de la pieza de tablas (19-11-2026, apartado 14.7 del sistema). */
    /* Los atributos de la etiqueta que abre, se escriban en el orden que se escriban. */
    const envoltorio = (html: string) => Object.fromEntries([...(/^<div ([^>]*)><table /.exec(html)?.[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map(([, nombre, valor]) => [nombre, valor]));
    const esperado = { "aria-label": "Comparativa de métricas (tabla desplazable)", class: "report-table-wrapper", role: "group", tabindex: "0" };
    expect(envoltorio(pintar())).toEqual(esperado);
    expect(pintar()).toMatch(/^<div [^>]*><table class="report-table backtest-metrics-table" aria-label="Comparativa de métricas">/);
    expect(envoltorio(pintar({ rotuloA: undefined, a: undefined }))).toEqual(esperado);
  });

  test("y el envoltorio acota: desplazamiento propio y ancho mínimo cero", () => {
    const hoja = readFileSync(new URL("../src/styles/modules.css", import.meta.url), "utf8");
    const regla = /\n\.report-table-wrapper \{([^}]*)\}/.exec(hoja)?.[1] ?? "";
    expect(regla).toContain("overflow-x: auto;");
    expect(regla).toContain("min-width: 0;");
  });
});

/*
 * T12, de las puertas finales: a 1024 en las dos bases y a 1280 en la vieja, la tabla de Simular no cabía en su caja. Había que deslizarla para ver
 * «Diferencia», y en la vieja a 1024 la columna del Máximo Sharpe se cortaba a media cifra: del Sharpe 1,09 se veía «1». Con las cabeceras de cifra
 * en dos líneas y el «%» pegado a su número, cabe entera en los seis anchos, en Simular y en Rentabilidad objetivo.
 */
describe("las cabeceras de cifra parten en dos líneas, y el «%» no se separa de su número", () => {
  const cabeceras = (html: string) => filas(html)[0];

  test("el espacio entre el número y su «%» no parte; los demás sí", () => {
    const [, actual, propuesta] = cabeceras(pintar());
    expect(actual).toBe("Parte medida (88\u00a0%)");
    expect(propuesta).toBe("Máx. Sharpe (máx. 35\u00a0% por activo)");
    /* Lo que no es un «%» sigue partiendo: «Máx. Sharpe» y «por activo» pueden ir a la segunda línea. */
    expect(propuesta.split(" ")).toEqual(["Máx.", "Sharpe", "(máx.", "35\u00a0%", "por", "activo)"]);
  });

  test("un rótulo sin «%» sale tal cual", () => {
    expect(cabeceras(pintar({ rotuloA: "Tu cartera", rotuloB: "Rentabilidad objetivo" }))).toEqual(["Métrica", "Tu cartera", "Rentabilidad objetivo", "Diferencia"]);
  });

  test("la regla de la hoja deja partir la cabecera de cifra, y pesa más que la que no la deja partir en las demás tablas", () => {
    const hoja = readFileSync(new URL("../src/styles/modules.css", import.meta.url), "utf8");
    const regla = /\n\.backtest-comparison-metrics \.backtest-metrics-table th\.num \{([^}]*)\}/.exec(hoja)?.[1] ?? "";
    expect(regla).toContain("white-space: normal;");
    /* `.report-table th.num` (dos clases y un elemento) no deja partir las cifras de los informes; esta lleva tres clases y gana sin depender del orden. */
    expect(hoja).toMatch(/\n\.report-table td\.num,\n\.report-table th\.num \{\n {2}white-space: nowrap;/);
  });

  test("las cifras de las celdas no cambian: las escribe el módulo de formato, y la hoja no las deja partir", () => {
    expect(filas(pintar())[1]).toEqual(["Rentabilidad anualizada", "+13,48 %", "+8,24 %", "−5,24 pp"]);
  });
});
