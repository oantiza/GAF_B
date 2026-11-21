/**
 * ANA-02 (auditoría de frontend, 13-11-2026): el cono de proyección se dibuja apilando una base transparente (p5, p25) y el hueco
 * hasta el extremo superior (p95 − p5, p75 − p25). El tooltip genérico listaba esas series auxiliares y enseñaba la anchura de cada
 * banda como si fuera un nivel, y decía «Proyección» también en el histórico. El suyo escribe los extremos de cada banda.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TooltipDelCono } from "../src/charts/oaa/OaaMonteCarloChart";

const texto = (fila: Record<string, number | string | null>) => {
  const html = renderToStaticMarkup(createElement(TooltipDelCono, { active: true, payload: [{ dataKey: "p5", value: fila.p5, payload: fila }] }));
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

describe("tooltip del cono de proyección", () => {
  /* Un punto proyectado: p5 = 92,1 y p95 = 126,7, así que la serie apilada lleva p95Gap = 126,7 − 92,1 = 34,6.
     p25 = 101,4 y p75 = 115,0: p75Gap = 115,0 − 101,4 = 13,6. Mediana 108,3. */
  const proyectado = { index: 160, label: "+1A", hist: null, p5: 92.1, p95Gap: 34.6, p25: 101.4, p75Gap: 13.6, p50: 108.3 };

  test("en un punto proyectado escribe la mediana y los dos extremos de cada banda, nunca su anchura", () => {
    const leido = texto(proyectado);
    expect(leido).toContain("Proyección");
    expect(leido).toContain("Mediana 108,3");
    expect(leido).toContain("Percentil 25 a 75 de 101,4 a 115,0");
    expect(leido).toContain("Percentil 5 a 95 de 92,1 a 126,7");
    /* Las anchuras (p95 − p5 y p75 − p25) no salen como cifra. */
    expect(leido).not.toContain("34,6");
    expect(leido).not.toContain("13,6");
    /* Ni los nombres de las series auxiliares. */
    for (const auxiliar of ["p5-p95", "p25-p75", "p95Gap", "p75Gap"]) expect(leido).not.toContain(auxiliar);
    expect(leido).not.toContain("Histórico");
  });

  test("en un punto del histórico dice «Histórico» y su valor, sin bandas", () => {
    const leido = texto({ index: 10, label: "", hist: 104.2, p5: null, p25: null, p50: null, p75Gap: null, p95Gap: null });
    expect(leido).toContain("Histórico");
    expect(leido).toContain("104,2");
    expect(leido).not.toContain("Proyección");
    expect(leido).not.toContain("Percentil");
  });

  test("sin punto activo no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(TooltipDelCono, { active: false, payload: [] }))).toBe("");
  });
});
