/**
 * Diseño › Simular: junto a cada diferencia de la comparativa, «mejora» o «empeora» (Óscar, 20-11-2026), con el sentido de cada cifra: en volatilidad
 * y en caída, menos es mejor. Cifras escritas a mano.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MedidaDelObjetivo } from "../src/components/MedidaDelObjetivo";
import { TablaDeMetricasComparativas } from "../src/components/MetricasComparativas";
import type { FrontierViewModel } from "../src/types/portfolioFrontier";

const fila = (html: string, rotulo: string) => {
  const celdas = html.split("<tr>").find((tr) => tr.includes(`<td>${rotulo}</td>`))?.split("</tr>")[0] ?? "";
  /* Sin tocar el espacio duro entre la cifra y su unidad: `\s` lo cuenta como espacio. */
  return celdas.replace(/<[^>]+>/g, " ").replace(/[ \t\n]+/g, " ").trim();
};

describe("la palabra de la diferencia", () => {
  const html = renderToStaticMarkup(createElement(TablaDeMetricasComparativas, {
    aria: "Comparativa", rotuloA: "Cartera", rotuloB: "Máx. Sharpe", conPalabra: true,
    /* Rentabilidad 5 % → 4 %: −1,00 pp, empeora. Volatilidad 10 % → 8 %: −2,00 pp, mejora. Sharpe 0,50 → 0,50: nada.
       Caída −20 % → −15 %: +5,00 pp, mejora (más cerca de cero). */
    a: { cagr: 0.05, volatility: 0.1, sharpe: 0.5, max_drawdown: -0.2 },
    b: { cagr: 0.04, volatility: 0.08, sharpe: 0.5, max_drawdown: -0.15 }
  }));
  test("menos rentabilidad empeora", () => expect(fila(html, "Rentabilidad anualizada")).toMatch(/−1,00\u00a0pp empeora$/));
  test("menos volatilidad mejora", () => expect(fila(html, "Volatilidad")).toMatch(/−2,00\u00a0pp mejora$/));
  test("una caída menos profunda mejora, aunque la resta sea positiva", () => expect(fila(html, "Caída máxima")).toMatch(/\+5,00\u00a0pp mejora$/));
  test("lo que se escribe como cero no lleva palabra", () => expect(fila(html, "Sharpe")).toMatch(/0,00$/));
  test("sin `conPalabra`, como antes: solo el color", () => {
    const sinPalabra = renderToStaticMarkup(createElement(TablaDeMetricasComparativas, {
      aria: "Comparativa", rotuloA: "Cartera", rotuloB: "Máx. Sharpe",
      a: { cagr: 0.05, volatility: 0.1, sharpe: 0.5, max_drawdown: -0.2 }, b: { cagr: 0.04, volatility: 0.08, sharpe: 0.5, max_drawdown: -0.15 }
    }));
    expect(sinPalabra).not.toMatch(/mejora<|empeora</);
  });
});

/*
 * Diseño › Optimizar, la rentabilidad objetivo: su tabla lleva también la palabra (Óscar, 21-11-2026). Cifras a mano: rentabilidad
 * 4 % → 6 %, +2,00 pp, mejora; volatilidad 8 % → 11 %, +3,00 pp, empeora; Sharpe 0,40 → 0,40, nada; caída −12 % → −18 %, −6,00 pp, empeora.
 */
describe("la palabra de la diferencia en la rentabilidad objetivo de Optimizar", () => {
  const medida = (cagr: number, volatility: number, sharpe: number, max_drawdown: number) => ({ cagr, volatility, sharpe, max_drawdown });
  const model = {
    window: "3Y",
    targetReturn: { expectedReturn: 0.06 },
    methodologyV2: { targetReturn: 0.06 },
    medidaDelObjetivo: { actual: medida(0.04, 0.08, 0.4, -0.12), propuesta: medida(0.06, 0.11, 0.4, -0.18) },
    coverage: { firstDate: "2023-10-31", lastDate: "2026-10-31" },
    points: []
  } as unknown as FrontierViewModel;
  const html = renderToStaticMarkup(createElement(MedidaDelObjetivo, { model }));
  test("más rentabilidad mejora", () => expect(fila(html, "Rentabilidad anualizada")).toMatch(/\+2,00\u00a0pp mejora$/));
  test("más volatilidad empeora", () => expect(fila(html, "Volatilidad")).toMatch(/\+3,00\u00a0pp empeora$/));
  test("una caída más profunda empeora", () => expect(fila(html, "Caída máxima")).toMatch(/−6,00\u00a0pp empeora$/));
  test("lo que se escribe como cero no lleva palabra", () => expect(fila(html, "Sharpe")).toMatch(/0,00$/));
});
