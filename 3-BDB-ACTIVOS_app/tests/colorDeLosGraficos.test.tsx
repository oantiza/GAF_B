// @vitest-environment happy-dom
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

/* Sin maquetación, ResponsiveContainer mide 0 y no pinta: aquí da un tamaño fijo a su hijo (como en graficosPorPapel). */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 480, height: 260 }) : null
  };
});

import type { EcbYieldCurveResult } from "../src/adapters/ecbYieldCurveBackend";
import { EuroYieldCurvePanel } from "../src/charts/EuroYieldCurveChart";
import { pctDecimal } from "../src/charts/oaa/chartFormatters";
import {
  COLOR_DE_LA_REFERENCIA,
  COLOR_DEL_CONTEXTO,
  COLOR_DEL_PUNTO_DE_CONTEXTO,
  COLOR_DEL_RESTO,
  coloresDelReparto,
  esResto,
  estilosPorPapel,
  grisMarcaResto,
  grisPideReferencia,
  papelesDe,
  repartoConOtros
} from "../src/charts/oaa/chartTheme";
import { OaaDonutChart } from "../src/charts/oaa/OaaDonutChart";
import { OaaLineChart } from "../src/charts/oaa/OaaLineChart";
import { OaaTooltip } from "../src/charts/oaa/OaaTooltip";

/*
 * El paso de color del 14-11-2026 (Óscar: «le faltan colores en general… dale más vida, más impacto visual»):
 * la referencia deja el gris y va en tostado a trazos; el gris queda para el resto de un reparto; la cartera lleva un
 * relleno suave bajo su línea; la segunda curva del BCE, a trazos; y el aro admite el color fijo de la categoría.
 * Cada cifra esperada se escribe a mano: los colores, en literal, no leídos de la paleta.
 *
 * Con la dirección A (18-11-2026) cambian los colores, no las reglas: la cartera va en marino; la referencia, en su
 * gris cálido propio y a trazos (ya no es un puesto de la paleta); las demás series, azul, salvia, latón, violeta y cacao;
 * el resto, un gris claro; y una serie que se queda sin color, el gris de los puntos de contexto, que se ve como línea.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARINO = "#0F1E33";
const REFERENCIA = "#7D776C";
const AZUL = "#2F5D8A";
const SALVIA = "#4E7D6A";
const LATON = "#A8824A";
const VIOLETA = "#8365B3";
const CACAO = "#553230";
/** El gris frío de la liquidez. */
const GRIS_FRIO = "#8A8F98";
/** El resto de un reparto. */
const GRIS = "#B3AC9E";
/** Una serie sin color propio: el gris de los puntos de contexto (3,52:1). */
const GRIS_DE_LINEA = "#8F887A";

async function montar(node: ReactElement): Promise<HTMLDivElement> {
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  await act(async () => raiz.render(node));
  return contenedor;
}

function filasDeLaTabla(contenedor: HTMLElement): string[][] {
  const tabla = contenedor.querySelector("div.sr-only > table");
  if (!tabla) return [];
  return [...tabla.querySelectorAll("tbody tr")].map((fila) => [...fila.children].map((celda) => celda.textContent ?? ""));
}

/** Las coordenadas «y» de un `d` de SVG hecho de pares x,y (M, L, C, Z): los números en posición impar. */
function coordenadasY(d: string): number[] {
  const numeros = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  return numeros.filter((_, indice) => indice % 2 === 1);
}

const fechas = ["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-11-02"];
const serie = (id: string, label: string, valores: number[], extra: Record<string, unknown> = {}) => ({
  id,
  label,
  values: fechas.map((date, i) => ({ date, value: valores[i] })),
  ...extra
});

describe("G-1 · la referencia es gris cálida y a trazos; el gris claro es solo el resto", () => {
  test("dos constantes y dos ideas: la referencia, su gris cálido; el resto, gris claro; el contexto, ninguna de las dos", () => {
    expect(COLOR_DE_LA_REFERENCIA).toBe(REFERENCIA);
    expect(COLOR_DEL_RESTO).toBe(GRIS);
    /* El contexto (la curva de la frontera, los activos sueltos) sigue en tinta apagada: no es la referencia. */
    expect([COLOR_DEL_CONTEXTO, COLOR_DEL_PUNTO_DE_CONTEXTO]).not.toContain(REFERENCIA);
    expect([COLOR_DEL_CONTEXTO, COLOR_DEL_PUNTO_DE_CONTEXTO]).not.toContain(GRIS);
  });

  /* Dirección A (18-11-2026): la cartera, un punto más firme (2,25 px), y la referencia, algo más fina (1,25 px), para
     que no ensucie la línea marina cuando van pegadas. Las demás, como estaban. */
  test("la cartera, marino de 2,25 px; la referencia, gris cálido de 1,25 px a trazos; las demás, azul, salvia, latón, violeta, cacao y gris", () => {
    const estilos = estilosPorPapel([
      { papel: "cartera" },
      { papel: "referencia" },
      { papel: "serie" },
      { papel: "serie" },
      { papel: "serie" },
      { papel: "serie" },
      { papel: "serie" },
      { papel: "serie" }
    ]);
    expect(estilos.map((e) => e.color)).toEqual([MARINO, REFERENCIA, AZUL, SALVIA, LATON, VIOLETA, CACAO, GRIS_DE_LINEA]);
    expect(estilos.map((e) => e.trazos)).toEqual([undefined, "5 4", undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(estilos.map((e) => e.grosor)).toEqual([2.25, 1.25, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
  });

  /* Un gráfico sin cartera (el Comparador de activos, hasta cinco) pinta sus series con los cinco colores; si llegara una
     sexta, el marino está libre: un activo de verdad no va en gris mientras quede un color. */
  test("sin cartera en el gráfico, la sexta serie lleva el marino, que está libre; con cartera, el gris; las cinco primeras no cambian", () => {
    const seis = Array.from({ length: 6 }, (_, puesto) => ({ papel: "serie" as const, puesto }));
    expect(estilosPorPapel(seis.slice(0, 5)).map((e) => e.color)).toEqual([AZUL, SALVIA, LATON, VIOLETA, CACAO]);
    expect(estilosPorPapel(seis).map((e) => e.color)).toEqual([AZUL, SALVIA, LATON, VIOLETA, CACAO, MARINO]);
    expect(estilosPorPapel([...seis, { papel: "referencia" as const }]).map((e) => e.color)).toEqual([AZUL, SALVIA, LATON, VIOLETA, CACAO, MARINO, REFERENCIA]);
    expect(estilosPorPapel([{ papel: "cartera" as const }, ...seis]).map((e) => e.color)).toEqual([MARINO, AZUL, SALVIA, LATON, VIOLETA, CACAO, GRIS_DE_LINEA]);
    /* De la séptima en adelante, gris también sin cartera: no hay más colores. */
    expect(estilosPorPapel(Array.from({ length: 7 }, (_, puesto) => ({ papel: "serie" as const, puesto }))).at(-1)?.color).toBe(GRIS_DE_LINEA);
    /* La sexta sigue siendo una serie más: sin el trazo ni el grosor de la cartera. */
    expect(estilosPorPapel(seis).at(-1)).toMatchObject({ papel: "serie", grosor: 1.5 });
  });

  test("un gris a mano dice dos cosas: en una serie sin papel, referencia (que se pinta en su gris y a trazos); en un reparto, resto", () => {
    /* El literal de la referencia, en las dos cajas: sin él, una serie sin papel que llegue con ese gris se pintaría como
       una serie de color y no como la referencia. */
    for (const gris of [GRIS, "var(--clase-resto)", "var(--serie-referencia)", "var(--borde-control)", GRIS_DE_LINEA, REFERENCIA, REFERENCIA.toLowerCase()]) {
      expect(grisPideReferencia(gris)).toBe(true);
      expect(grisMarcaResto(gris)).toBe(true);
    }
    expect(grisPideReferencia(AZUL)).toBe(false);
    expect(grisMarcaResto(MARINO)).toBe(false);

    expect(papelesDe([{}, { color: GRIS }])).toEqual(["cartera", "referencia"]);
    const [, referencia] = estilosPorPapel([{}, { color: "var(--borde-control)" }]);
    expect(referencia).toEqual({ papel: "referencia", color: REFERENCIA, grosor: 1.25, trazos: "5 4" });

    /* En un reparto, el mismo gris marca un resto, y el resto va en gris claro, no en el de la referencia. */
    expect(esResto("Liquidez", GRIS)).toBe(true);
    const filas = repartoConOtros(
      [
        { key: "a", label: "Europa", value: 50 },
        { key: "b", label: "Liquidez", value: 30, color: "var(--serie-referencia)" },
        { key: "c", label: "No declarado", value: 20 }
      ],
      (grupo, otros) => ({ ...otros, value: grupo.reduce((s, f) => s + f.value, 0) })
    );
    expect(coloresDelReparto(filas)).toEqual([AZUL, GRIS, GRIS]);
  });
});

describe("G-2 · el relleno suave bajo la línea de la cartera", () => {
  test("la cartera lleva un degradado de su color, de 0,09 arriba a 0 abajo; la referencia y la serie, ninguno", async () => {
    const contenedor = await montar(
      createElement(OaaLineChart, {
        series: [
          serie("a", "Fondo A", [100, 101, 102, 103, 104], { papel: "serie" }),
          serie("ref", "Índice", [100, 100, 101, 101, 102], { papel: "referencia" }),
          serie("cartera", "Propuesta", [100, 102, 104, 106, 108], { papel: "cartera" })
        ]
      })
    );
    const areas = [...contenedor.querySelectorAll("path.recharts-area-area")];
    expect(areas).toHaveLength(1);
    const relleno = areas[0].getAttribute("fill") ?? "";
    const id = /^url\(#([^)]+)\)$/.exec(relleno)?.[1];
    expect(id).toBeTruthy();
    const degradado = contenedor.querySelector(`linearGradient[id="${id}"]`);
    expect(degradado?.getAttribute("x1")).toBe("0");
    expect(degradado?.getAttribute("y1")).toBe("0");
    expect(degradado?.getAttribute("x2")).toBe("0");
    expect(degradado?.getAttribute("y2")).toBe("1");
    const paradas = [...(degradado?.querySelectorAll("stop") ?? [])].map((parada) => [
      parada.getAttribute("offset"),
      parada.getAttribute("stop-color"),
      parada.getAttribute("stop-opacity")
    ]);
    expect(paradas).toEqual([
      ["0%", MARINO, "0.09"],
      ["100%", MARINO, "0"]
    ]);
    /* El relleno no tiene trazo propio: las tres líneas siguen siendo las de antes, en su orden y con su color. */
    expect(areas[0].getAttribute("stroke")).toBe("none");
    expect([...contenedor.querySelectorAll("path.recharts-line-curve")].map((t) => t.getAttribute("stroke"))).toEqual([AZUL, REFERENCIA, MARINO]);
  });

  /* El relleno comparte datos con la línea: en la nota emergente la cartera salía dos veces, con la misma clave. */
  test("la nota emergente no cuenta el relleno: una fila por serie, no dos de la cartera", async () => {
    const contenedor = await montar(
      createElement(OaaTooltip, {
        active: true,
        label: "2026-11-02",
        payload: [
          { dataKey: "cartera", name: "Cartera", value: 108, color: MARINO, type: "none" },
          { dataKey: "cartera", name: "Cartera", value: 108, color: MARINO },
          { dataKey: "ref", name: "Índice", value: 102, color: REFERENCIA }
        ]
      })
    );
    const filas = [...contenedor.querySelectorAll(".oaa-chart-tooltip-row")].map((fila) => fila.textContent);
    expect(filas).toHaveLength(2);
    expect(filas.filter((fila) => fila?.includes("Cartera"))).toHaveLength(1);
  });

  test("con una sola serie (la ficha, la evolución de un plan) también lleva relleno; sin cartera, ninguno", async () => {
    const sola = await montar(createElement(OaaLineChart, { series: [serie("c", "Fondo", [100, 101, 102, 103, 104])] }));
    expect(sola.querySelectorAll("path.recharts-area-area")).toHaveLength(1);
    const sinCartera = await montar(
      createElement(OaaLineChart, {
        series: [serie("a", "Fondo A", [100, 101, 102, 103, 104], { papel: "serie" }), serie("r", "Índice", [100, 100, 101, 101, 102], { papel: "referencia" })]
      })
    );
    expect(sinCartera.querySelectorAll("path.recharts-area-area")).toHaveLength(0);
    expect(sinCartera.querySelectorAll("linearGradient")).toHaveLength(0);
  });

  test("si la serie cruza el cero, el relleno baja hasta el borde inferior del área de dibujo, no hasta el cero", async () => {
    const contenedor = await montar(
      createElement(OaaLineChart, {
        series: [serie("c", "Cartera", [-0.06, -0.02, 0.03, 0.08, 0.1])],
        yFormatter: (valor: unknown) => pctDecimal(valor, 0),
        referenceValue: 0
      })
    );
    const area = contenedor.querySelector("path.recharts-area-area");
    const ys = coordenadasY(area?.getAttribute("d") ?? "");
    expect(ys.length).toBeGreaterThan(0);
    /* El borde inferior del área de dibujo es la línea del eje X. */
    const ejeX = contenedor.querySelector(".recharts-xAxis line.recharts-cartesian-axis-line");
    const bordeInferior = Number(ejeX?.getAttribute("y1"));
    expect(Number.isFinite(bordeInferior)).toBe(true);
    expect(Math.max(...ys)).toBeCloseTo(bordeInferior, 0);
    /* Y la línea del cero queda por encima: el relleno pasa por debajo de ella. */
    const cero = contenedor.querySelector(".recharts-reference-line line");
    expect(Number(cero?.getAttribute("y1"))).toBeLessThan(bordeInferior - 10);
  });

  test("la tabla alternativa y las etiquetas de final de línea no cambian con el relleno", async () => {
    const contenedor = await montar(
      createElement(OaaLineChart, { series: [serie("c", "Propuesta", [100, 101, 102, 103, 104.5]), serie("r", "Índice", [100, 100, 99, 101, 102])] })
    );
    expect(contenedor.querySelectorAll("path.recharts-area-area")).toHaveLength(1);
    expect(filasDeLaTabla(contenedor)).toEqual([
      ["01/09/2026", "100,0", "100,0"],
      ["01/10/2026", "102,0", "99,0"],
      ["02/11/2026", "104,5", "102,0"]
    ]);
    const svg = contenedor.querySelector("svg.recharts-surface");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.textContent).toContain("Propuesta · 104,5");
    expect(svg?.textContent).toContain("Índice · 102,0");
  });
});

describe("G-4 · la curva del BCE: la segunda, a trazos", () => {
  const resultado: EcbYieldCurveResult = {
    schema_version: "ecb-yield-curve.v1",
    as_of_date: "2026-11-13",
    aaa: [{ maturity_years: 0.25, yield_pct: 1.92 }, { maturity_years: 10, yield_pct: 2.6 }, { maturity_years: 30, yield_pct: 3.1 }],
    all_bonds: [{ maturity_years: 0.25, yield_pct: 2.01 }, { maturity_years: 10, yield_pct: 3.0 }, { maturity_years: 30, yield_pct: 3.5 }],
    source: "ECB_DATA_PORTAL",
    notes: ""
  };

  test("AAA, marino y continua; todos los bonos, a trazos «7 5», y su marca de leyenda también", async () => {
    const contenedor = await montar(createElement(EuroYieldCurvePanel, { result: resultado, loading: false, error: null, onRetry: () => undefined }));
    const curvas = [...contenedor.querySelectorAll("path.recharts-line-curve")];
    expect(curvas).toHaveLength(2);
    expect(curvas[0].getAttribute("stroke")).toBe(MARINO);
    expect(curvas[0].getAttribute("stroke-dasharray")).toBeNull();
    expect(curvas[1].getAttribute("stroke-dasharray")).toBe("7 5");
    const marcas = [...contenedor.querySelectorAll(".euro-yield-legend i")];
    expect(marcas.map((marca) => marca.classList.contains("is-dashed"))).toEqual([false, true]);
  });
});

describe("G-5 · el aro admite el color fijo de la categoría", () => {
  const sumar = (grupo: ReadonlyArray<{ value: number }>, otros: { key: string; label: string }) => ({
    ...otros,
    value: grupo.reduce((s, f) => s + f.value, 0)
  });

  test("las porciones con color de categoría lo llevan; las demás, la paleta sin los ya usados; el resto, gris", async () => {
    const data = [
      { key: "a", label: "Fondos sin clase", value: 30 },
      { key: "rv", label: "Renta variable", value: 25, colorDeCategoria: AZUL },
      { key: "b", label: "Otra cosa", value: 15 },
      { key: "rf", label: "Renta fija", value: 12, colorDeCategoria: SALVIA },
      { key: "oro", label: "Materias primas", value: 10, colorDeCategoria: CACAO },
      { key: "nd", label: "No declarado", value: 8, colorDeCategoria: VIOLETA }
    ];
    const contenedor = await montar(createElement(OaaDonutChart, { data }));
    const porciones = [...contenedor.querySelectorAll("path.recharts-sector")].map((p) => p.getAttribute("fill"));
    /* «Fondos sin clase» y «Otra cosa» saltan el azul y el salvia, que ya son de la renta variable y la renta fija (y el
       cacao, de las materias primas); «No declarado» es un resto y va en gris aunque traiga un color. */
    expect(porciones).toEqual([LATON, AZUL, VIOLETA, SALVIA, CACAO, GRIS]);

    /* La leyenda usa los mismos colores, en el mismo orden. */
    const html = renderToStaticMarkup(createElement(OaaDonutChart, { data }));
    const leyenda = html.slice(html.indexOf('<ul class="oaa-chart-legend">'));
    const fondos = [...leyenda.matchAll(/<i style="background:([^;"]+)/g)].map((m) => m[1].toUpperCase());
    expect(fondos).toEqual([LATON, AZUL, VIOLETA, SALVIA, CACAO, GRIS]);
    /* La tabla alternativa trae las mismas porciones. */
    expect(filasDeLaTabla(contenedor).map((fila) => fila[0])).toEqual(data.map((d) => d.label));
  });

  test("sin ningún color de categoría, el orden del reparto: azul, salvia, latón…", () => {
    const filas = [{ resto: false }, { resto: false }, { resto: false }, { resto: true }];
    expect(coloresDelReparto(filas)).toEqual([AZUL, SALVIA, LATON, GRIS]);
  });

  test("con más de seis, lo agrupado en «Otros» pierde su color y va en gris", async () => {
    const data = [
      { key: "rv", label: "Renta variable", value: 30, colorDeCategoria: AZUL },
      { key: "rf", label: "Renta fija", value: 20, colorDeCategoria: SALVIA },
      { key: "m", label: "Monetario", value: 15, colorDeCategoria: GRIS_FRIO },
      { key: "al", label: "Alternativos", value: 10, colorDeCategoria: LATON },
      { key: "mx", label: "Mixtos", value: 9, colorDeCategoria: VIOLETA },
      { key: "ra", label: "Activos reales", value: 8, colorDeCategoria: CACAO },
      { key: "x", label: "Otra clase", value: 8, colorDeCategoria: MARINO }
    ];
    expect(repartoConOtros(data, sumar).map((f) => f.label)).toEqual(["Renta variable", "Renta fija", "Monetario", "Alternativos", "Mixtos", "Otros"]);
    const contenedor = await montar(createElement(OaaDonutChart, { data }));
    const porciones = [...contenedor.querySelectorAll("path.recharts-sector")].map((p) => p.getAttribute("fill"));
    expect(porciones).toEqual([AZUL, SALVIA, GRIS_FRIO, LATON, VIOLETA, GRIS]);
    expect(porciones).not.toContain(CACAO);
    expect(porciones).not.toContain(MARINO);
  });
});
