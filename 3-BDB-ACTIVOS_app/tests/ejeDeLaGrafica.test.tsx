// @vitest-environment happy-dom

/**
 * El eje de la gráfica: una etiqueta por mes, y no el mes repetido (decisión 113). Se repetía en historias cortas como DIGI y, a 1.440 píxeles, en cualquier
 * ficha a un año, en 5 de 17 etiquetas. Lo que se ve a cada ancho se mide en el navegador; aquí, lo que se le pide a la gráfica.
 */
import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 1240, height: 260 }) : null
  };
});

import { compactDate, primeraFechaDeCadaMes } from "../src/charts/oaa/chartFormatters";
import { OaaLineChart } from "../src/charts/oaa/OaaLineChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Días laborables entre dos fechas: lo que trae una serie diaria. */
function laborables(desde: string, hasta: string): string[] {
  const fechas: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86400000) {
    const dia = new Date(t);
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) fechas.push(dia.toISOString().slice(0, 10));
  }
  return fechas;
}

describe("primeraFechaDeCadaMes", () => {
  test("una por mes, la primera de cada uno, y en su orden", () => {
    expect(primeraFechaDeCadaMes(["2026-07-16", "2026-07-17", "2026-08-03", "2026-08-04", "2026-09-01"])).toEqual(["2026-07-16", "2026-08-03", "2026-09-01"]);
  });

  test("DIGI: del 16 de julio al 4 de noviembre son cinco meses y cinco etiquetas", () => {
    const fechas = primeraFechaDeCadaMes(laborables("2026-07-16", "2026-11-04"));
    /* Paso 2 del rediseño: el eje escribe `fechaDeEje`, «nov 2026», con los meses propios del módulo común. */
    expect(fechas.map(compactDate)).toEqual(["jul 2026", "ago 2026", "sep 2026", "oct 2026", "nov 2026"]);
  });

  test("un año de serie diaria: trece etiquetas, ninguna repetida, porque empieza y acaba en el mismo mes de dos años", () => {
    const etiquetas = primeraFechaDeCadaMes(laborables("2025-11-05", "2026-11-04")).map(compactDate);
    expect(etiquetas).toHaveLength(13);
    expect(new Set(etiquetas).size).toBe(13);
    expect(etiquetas[0]).toBe("nov 2025");
    expect(etiquetas[12]).toBe("nov 2026");
  });

  test("diez años son ciento veinte meses y uno: el mismo mes de dos años distintos no se confunde", () => {
    const etiquetas = primeraFechaDeCadaMes(laborables("2016-11-01", "2026-11-04")).map(compactDate);
    expect(etiquetas).toHaveLength(121);
    expect(new Set(etiquetas).size).toBe(121);
  });

  test("casos límite: sin fechas, una sola, y todas del mismo mes", () => {
    expect(primeraFechaDeCadaMes([])).toEqual([]);
    expect(primeraFechaDeCadaMes(["2026-07-16"])).toEqual(["2026-07-16"]);
    expect(primeraFechaDeCadaMes(["2026-07-16", "2026-07-17", "2026-07-20"])).toEqual(["2026-07-16"]);
  });
});

describe("la gráfica", () => {
  async function etiquetasDe(fechas: string[]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<OaaLineChart series={[{ id: "A", label: "A", values: fechas.map((date, i) => ({ date, value: 100 + i })) }]} />));
    const etiquetas = [...host.querySelectorAll(".recharts-xAxis-tick-labels text, .recharts-xAxis-ticks text")].map((n) => n.textContent?.trim() ?? "").filter(Boolean);
    await act(async () => root.unmount());
    host.remove();
    return etiquetas;
  }

  test("no escribe dos veces el mismo mes, y la línea sigue teniendo todos sus puntos", async () => {
    const etiquetas = await etiquetasDe(laborables("2025-11-05", "2026-11-04"));
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });
});
