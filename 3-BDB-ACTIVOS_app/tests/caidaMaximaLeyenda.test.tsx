/**
 * ANA-22: con dos series (la cartera y la referencia), el gráfico de caída dice cuál es cuál con su leyenda, y cada
 * muestra lleva el trazo de su serie; con una sola, no hace falta leyenda.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { UnderwaterChart } from "../src/charts/UnderwaterChart";

const fechas = ["2025-11-03", "2025-12-01", "2026-01-05", "2026-02-02"];
const serie = (id: string, label: string, papel?: "cartera" | "referencia") => ({
  id,
  label,
  papel,
  values: fechas.map((date, i) => ({ date, value: -0.01 * i }))
});

describe("la leyenda del gráfico de caída (ANA-22)", () => {
  test("con más de una serie, la leyenda nombra las dos y la referencia va a trazos", () => {
    const html = renderToStaticMarkup(
      createElement(UnderwaterChart, { series: [serie("cartera", "Tu cartera", "cartera"), serie("ref", "Cartera de referencia", "referencia")] })
    );
    const leyenda = html.slice(html.indexOf('<ul class="oaa-chart-legend">'));
    expect(leyenda.startsWith('<ul class="oaa-chart-legend">')).toBe(true);
    expect(leyenda).toContain("<span>Tu cartera</span>");
    expect(leyenda).toContain("<span>Cartera de referencia</span>");
    expect(leyenda.match(/<li>/g)).toHaveLength(2);
    expect(leyenda).toContain("oaa-legend-mark--dash");
  });

  test("con una sola serie, sin leyenda", () => {
    const html = renderToStaticMarkup(createElement(UnderwaterChart, { series: [serie("cartera", "Tu cartera", "cartera")] }));
    expect(html).not.toContain("oaa-chart-legend");
  });
});
