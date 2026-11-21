// @vitest-environment happy-dom
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

/* Sin maquetación, ResponsiveContainer mide 0 y no pinta el gráfico: aquí pasa
   un tamaño fijo a su hijo para que el SVG exista y se pueda leer. Recharts 3
   monta el SVG en el cliente, así que el nombre accesible se lee tras montar. */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 480, height: 260 }) : null
  };
});

import { OaaDonutChart } from "../src/charts/oaa/OaaDonutChart";
import { OaaFrontierChart } from "../src/charts/oaa/OaaFrontierChart";
import { OaaGroupedBarChart } from "../src/charts/oaa/OaaGroupedBarChart";
import { OaaLegend } from "../src/charts/oaa/OaaLegend";
import { OaaMonteCarloChart } from "../src/charts/oaa/OaaMonteCarloChart";
import { OaaOverlapHeatmap } from "../src/charts/oaa/OaaOverlapHeatmap";
import {
  CORRELATION_THRESHOLDS,
  OVERLAP_THRESHOLDS,
  SEQUENTIAL_CLASS_STEPS,
  sequentialStep
} from "../src/charts/oaa/chartTheme";
import { SEQUENTIAL_RAMP } from "../src/core/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mountedHtml(node: ReactElement): Promise<string> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return html;
}

/**
 * Gráficos: leyenda fiel, rampa secuencial única y nombre accesible
 * (auditoría 16-10-2026, MEDIA-11).
 */
const weeklySeries = Array.from({ length: 160 }, (_, index) => ({
  date: new Date(Date.UTC(2023, 0, 2 + index * 7)).toISOString().slice(0, 10),
  value: 100 * 1.0015 ** index * (1 + 0.03 * Math.sin(index / 3))
}));

describe("la frontera dice qué eje es cada uno (hallazgo 144)", () => {
  const curva = [{ vol: 0.05, ret: 0.06 }, { vol: 0.1, ret: 0.09 }, { vol: 0.15, ret: 0.11 }];
  const punto = { id: "current", vol: 0.08, ret: 0.08, color: "var(--tinta)" };

  /* Paso 2 del rediseño: «riesgo» se dice «volatilidad» (una palabra por concepto) y la media anual de varios años,
     «rentabilidad anualizada». */
  test("los dos ejes llevan su nombre", async () => {
    const html = await mountedHtml(createElement(OaaFrontierChart, { frontier: curva, marks: [{ ...punto, label: "Cartera actual" }] }));
    expect(html).toContain("Volatilidad anualizada");
    expect(html).toContain("Rentabilidad anualizada estimada");
  });

  test("lo rotulado en la curva no se repite en la leyenda; lo que no, sí", async () => {
    const rotulado = await mountedHtml(createElement(OaaFrontierChart, { frontier: curva, marks: [{ ...punto, label: "Parte cubierta", labelled: true }] }));
    /* La leyenda es la lista del final; la tabla alternativa, que va antes, sí nombra todos los puntos. */
    const leyenda = (html: string) => html.slice(html.lastIndexOf('<ul class="oaa-chart-legend"'));
    expect(leyenda(rotulado)).not.toContain("Parte cubierta");
    const sinRotulo = await mountedHtml(createElement(OaaFrontierChart, { frontier: curva, marks: [{ ...punto, label: "Tu cartera" }] }));
    expect(leyenda(sinRotulo)).toContain("Tu cartera");
  });
});

describe("sequentialStep: siete clases explícitas sobre la rampa de ocho pasos", () => {
  test("las clases son 0, 1, 2, 3, 5, 6 y 7 (el 4 se salta a propósito)", () => {
    expect([...SEQUENTIAL_CLASS_STEPS]).toEqual([0, 1, 2, 3, 5, 6, 7]);
    const reached = new Set<number>();
    for (let value = -1; value <= 1; value += 0.0005) reached.add(sequentialStep(value, CORRELATION_THRESHOLDS));
    for (let value = 0; value <= 100; value += 0.5) reached.add(sequentialStep(value, OVERLAP_THRESHOLDS, { exclusiveFirst: true }));
    expect([...reached].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    for (const step of reached) expect(SEQUENTIAL_RAMP[step]).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test("valor a valor, igual que las cascadas de master (revisión 16-10)", () => {
    /* Copias literales de master (e8af7ee): OaaCorrelationHeatmap.corrStep y
       OaaOverlapHeatmap.overlapStep, que el PDF del informe de cliente repetía a mano. */
    const oldCorr = (value: number | null): number => {
      if (value == null || !Number.isFinite(value)) return -1;
      if (value >= 0.999) return 7;
      if (value >= 0.85) return 6;
      if (value >= 0.65) return 5;
      if (value >= 0.45) return 3;
      if (value >= 0.25) return 2;
      if (value >= 0.1) return 1;
      return 0;
    };
    const oldOverlap = (value: number | null): number => {
      if (value == null || !Number.isFinite(value)) return -1;
      if (value >= 99) return 7;
      if (value >= 80) return 6;
      if (value >= 60) return 5;
      if (value >= 40) return 3;
      if (value >= 20) return 2;
      if (value > 0) return 1;
      return 0;
    };
    const around = (limits: readonly number[], eps: number) => limits.flatMap((limit) => [limit - eps, limit, limit + eps]);
    const corrValues = [
      null, Number.NaN, Number.POSITIVE_INFINITY,
      ...Array.from({ length: 4001 }, (_, i) => -1 + i * 0.0005),
      ...around(CORRELATION_THRESHOLDS, 1e-9)
    ];
    for (const value of corrValues) expect(sequentialStep(value, CORRELATION_THRESHOLDS), String(value)).toBe(oldCorr(value));
    const overlapValues = [
      null, Number.NaN,
      ...Array.from({ length: 401 }, (_, i) => i * 0.25),
      ...around(OVERLAP_THRESHOLDS, 1e-9)
    ];
    for (const value of overlapValues) {
      expect(sequentialStep(value, OVERLAP_THRESHOLDS, { exclusiveFirst: true }), String(value)).toBe(oldOverlap(value));
    }
  });

  test("conserva los umbrales de antes: correlación inclusiva, solapamiento con 0 % aparte", () => {
    expect(sequentialStep(null, CORRELATION_THRESHOLDS)).toBe(-1);
    expect(sequentialStep(Number.NaN, OVERLAP_THRESHOLDS)).toBe(-1);
    expect(sequentialStep(0.0999, CORRELATION_THRESHOLDS)).toBe(0);
    expect(sequentialStep(0.1, CORRELATION_THRESHOLDS)).toBe(1);
    expect(sequentialStep(0.65, CORRELATION_THRESHOLDS)).toBe(5);
    expect(sequentialStep(0.85, CORRELATION_THRESHOLDS)).toBe(6);
    expect(sequentialStep(0.999, CORRELATION_THRESHOLDS)).toBe(7);
    expect(sequentialStep(0, OVERLAP_THRESHOLDS, { exclusiveFirst: true })).toBe(0);
    expect(sequentialStep(0.5, OVERLAP_THRESHOLDS, { exclusiveFirst: true })).toBe(1);
    expect(sequentialStep(40, OVERLAP_THRESHOLDS, { exclusiveFirst: true })).toBe(3);
    expect(sequentialStep(60, OVERLAP_THRESHOLDS, { exclusiveFirst: true })).toBe(5);
    expect(sequentialStep(99, OVERLAP_THRESHOLDS, { exclusiveFirst: true })).toBe(7);
  });
});

describe("leyenda fiel al trazo", () => {
  test("OaaLegend pinta segmento para la línea, discontinuo para la mediana y relleno translúcido para la banda", () => {
    const html = renderToStaticMarkup(createElement(OaaLegend, {
      items: [
        { id: "l", label: "Línea", color: "#143D66", variant: "line" },
        { id: "d", label: "Discontinua", color: "#143D66", variant: "dash" },
        { id: "b", label: "Banda", color: "#143D66", variant: "band", opacity: 0.12 },
        { id: "s", label: "Barra", color: "#4F86B8" }
      ]
    }));
    expect(html).toContain('class="oaa-legend-mark--line"');
    expect(html).toContain('class="oaa-legend-mark--line oaa-legend-mark--dash"');
    expect(html).toContain("background:rgba(20, 61, 102, 0.12)");
    expect(html).toContain("background:#4F86B8");
  });

  test("Monte Carlo: Histórico, Mediana y las dos bandas, con el color real y sin --brand-40", () => {
    const html = renderToStaticMarkup(createElement(OaaMonteCarloChart, { series: weeklySeries, frequency: "WEEKLY" }));
    const legend = html.slice(html.indexOf('<ul class="oaa-chart-legend">'));
    expect(legend).toContain("Histórico");
    expect(legend).toContain("Mediana");
    /* Paso 2 del rediseño: las bandas con su nombre entero, como en la nota. */
    expect(legend).toContain("Percentil 25 a 75");
    expect(legend).toContain("Percentil 5 a 95");
    expect(legend).not.toContain("--brand-40");
    // Ninguna muestra repetida: cuatro marcas, cuatro estilos distintos.
    const marks = [...legend.matchAll(/<i[^>]*>/g)].map((match) => match[0]);
    expect(marks).toHaveLength(4);
    expect(new Set(marks).size).toBe(4);
  });
});

describe("nombre accesible en los gráficos que no lo tenían", () => {
  const svgLabel = (html: string) => /<svg[^>]*aria-label="([^"]+)"/.exec(html)?.[1] ?? null;

  test("donut, barras agrupadas, radar, Monte Carlo y solapamiento llevan aria-label en el SVG", async () => {
    const donut = await mountedHtml(createElement(OaaDonutChart, {
      data: [{ key: "rv", label: "Renta variable", value: 60 }, { key: "rf", label: "Renta fija", value: 40 }]
    }));
    expect(svgLabel(donut)).toContain("Renta variable");

    const bars = await mountedHtml(createElement(OaaGroupedBarChart, {
      rows: [{ key: "a", label: "Europa", a: 30, b: 25 }], aLabel: "Cartera", bLabel: "Benchmark"
    }));
    expect(svgLabel(bars)).toContain("Cartera frente a Benchmark");

    const cone = await mountedHtml(createElement(OaaMonteCarloChart, { series: weeklySeries, frequency: "WEEKLY", horizonYears: 3 }));
    expect(svgLabel(cone)).toContain("3 años");

    const overlap = await mountedHtml(createElement(OaaOverlapHeatmap, {
      items: [{ key: "a", label: "Fondo A", color: "#143D66" }, { key: "b", label: "Fondo B", color: "#B9862F" }],
      cells: [{ rowKey: "a", columnKey: "b", rowLabel: "Fondo A", columnLabel: "Fondo B", rowIndex: 0, columnIndex: 1, value: 45, commonTop: [] }]
    }));
    /* 14-11-2026: el solapamiento dejó el SVG de Recharts y es una rejilla CSS, como la correlación; el nombre lo lleva
       la rejilla (`role="group"`), que es donde están las casillas que se enfocan. */
    expect(/<div[^>]*role="group"[^>]*aria-label="([^"]+)"/.exec(overlap)?.[1]).toContain("solapamiento de 2 activos");
  });
});

describe("un gráfico sin nada que dibujar dice de qué no hay datos", () => {
  /* FMT-08: el anillo decía «Sin datos.» a secas, otra manera más de decir que algo falta. */
  test("el anillo y las barras agrupadas, con las mismas palabras", async () => {
    const anillo = await mountedHtml(createElement(OaaDonutChart, { data: [] }));
    expect(anillo).toContain("Sin datos de distribución.");
    const barras = await mountedHtml(createElement(OaaGroupedBarChart, { rows: [], aLabel: "Cartera", bLabel: "Referencia" }));
    expect(barras).toContain("Sin datos de distribución.");
  });
});
