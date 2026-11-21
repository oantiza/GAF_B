// @vitest-environment happy-dom
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

/* Sin maquetación, ResponsiveContainer mide 0 y no pinta: aquí da un tamaño fijo a su hijo (como en chartsAccessibility). */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 480, height: 260 }) : null
  };
});

import { GeoDistributionMap } from "../src/charts/GeoDistributionMap";
import { UnderwaterChart } from "../src/charts/UnderwaterChart";
import {
  base100,
  compactDate,
  pctDecimal,
  pctPoint,
  pesoDelGrafico,
  rentabilidadDelGrafico,
  tooltipDate,
  volatilidadDelGrafico
} from "../src/charts/oaa/chartFormatters";
import {
  CORRELATION_THRESHOLDS,
  clasesDeLaRampa,
  estilosPorPapel,
  OVERLAP_THRESHOLDS,
  papelesDe,
  repartoConOtros
} from "../src/charts/oaa/chartTheme";
import { CLASES_DE_LA_CORRELACION, OaaCorrelationHeatmap } from "../src/charts/oaa/OaaCorrelationHeatmap";
import { OaaDonutChart } from "../src/charts/oaa/OaaDonutChart";
import { OaaFrontierChart } from "../src/charts/oaa/OaaFrontierChart";
import { OaaGroupedBarChart } from "../src/charts/oaa/OaaGroupedBarChart";
import { OaaLineChart } from "../src/charts/oaa/OaaLineChart";
import { aNAnios, MARGEN_DERECHO_DEL_CONO } from "../src/charts/oaa/ejeDelCono";
import { OaaMonteCarloChart } from "../src/charts/oaa/OaaMonteCarloChart";
import { CLASES_DEL_SOLAPAMIENTO, OaaOverlapHeatmap } from "../src/charts/oaa/OaaOverlapHeatmap";
import { OaaRiskReturnChart } from "../src/charts/oaa/OaaRiskReturnChart";
import { OaaStyleBoxChart } from "../src/charts/oaa/OaaStyleBoxChart";
import { OaaTooltip } from "../src/charts/oaa/OaaTooltip";
import { zoneColor, ZONE_CHIP } from "../src/core/regionTaxonomy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Los colores de la dirección A (18-11-2026), en literal. */
const MARINO = "#0F1E33";
/** La referencia: su gris cálido propio, a trazos. */
const REFERENCIA = "#7D776C";
const AZUL = "#2F5D8A";
const SALVIA = "#4E7D6A";
const LATON = "#A8824A";
const VIOLETA = "#8365B3";
const CACAO = "#553230";
/** El resto de un reparto. */
const GRIS = "#B3AC9E";
/** Una serie sin color propio: el gris de los puntos de contexto. */
const GRIS_DE_LINEA = "#8F887A";
const ROJO = "#C2261B";
const NB = " ";
const MENOS = "−";

async function montar(node: ReactElement): Promise<HTMLDivElement> {
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  await act(async () => raiz.render(node));
  return contenedor;
}

/** Las filas de la tabla alternativa: la cabecera de fila y sus celdas, como texto. */
function filasDeLaTabla(contenedor: HTMLElement): string[][] {
  const tabla = contenedor.querySelector("div.sr-only > table");
  if (!tabla) return [];
  return [...tabla.querySelectorAll("tbody tr")].map((fila) => [...fila.children].map((celda) => celda.textContent ?? ""));
}

const fechas = ["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-11-02"];
const serie = (id: string, label: string, valores: number[], extra: Record<string, unknown> = {}) => ({
  id,
  label,
  values: fechas.map((date, i) => ({ date, value: valores[i] })),
  ...extra
});

describe("el papel decide el color, no la posición ni el color a mano", () => {
  test("sin papel, la primera es la cartera y las demás, series en orden; un gris a mano es la referencia", () => {
    expect(papelesDe([{}, {}, {}])).toEqual(["cartera", "serie", "serie"]);
    expect(papelesDe([{}, { color: GRIS }])).toEqual(["cartera", "referencia"]);
    expect(papelesDe([{}, { color: "var(--borde-control)" }])).toEqual(["cartera", "referencia"]);
    /* Si alguna lo declara, las que no, son series. */
    expect(papelesDe([{}, {}, { papel: "cartera" }])).toEqual(["serie", "serie", "cartera"]);
  });

  /* 14-11-2026 (Óscar: «le faltan colores»): la referencia dejó el gris y fue en tostado, a trazos. Desde la dirección A
     (18-11-2026) lleva su gris cálido propio, fuera de la paleta, y las demás series empiezan en el azul de --serie-2. */
  test("una «cartera» es marino aunque llegue la tercera y con otro color; una «referencia», en su gris y a trazos", () => {
    const estilos = estilosPorPapel([{ papel: "serie" }, { papel: "referencia", color: "#B9862F" }, { papel: "cartera", color: "#C2261B" }]);
    expect(estilos.map((e) => e.color)).toEqual([AZUL, REFERENCIA, MARINO]);
    expect(estilos[1].trazos).toBe("5 4");
    expect(estilos[2].trazos).toBeUndefined();
    /* Dirección A (18-11-2026): la cartera, 2,25 px; la referencia, 1,25. */
    expect(estilos.map((e) => e.grosor)).toEqual([1.5, 1.25, 2.25]);
  });

  test("una serie con puesto lleva el color de su puesto, no el de su orden de llegada", () => {
    /* El Comparador con tres activos y el segundo sin serie: el tercero sigue llevando el color de su puesto (el latón
       desde la dirección A, cuando las series empezaron en el azul), como en su ficha de arriba. Sin el puesto pasaba al
       color del que no se dibuja. */
    const estilos = estilosPorPapel([{ papel: "serie", puesto: 0 }, { papel: "serie", puesto: 2 }]);
    expect(estilos.map((e) => e.color)).toEqual([AZUL, LATON]);
    /* Sin puesto, el orden de llegada, como siempre. */
    expect(estilosPorPapel([{ papel: "serie" }, { papel: "serie" }]).map((e) => e.color)).toEqual([AZUL, SALVIA]);
  });

  /* Dirección A (18-11-2026): la referencia tiene su color fuera de la paleta, así que las demás tienen cinco colores
     (azul, salvia, latón, violeta, cacao) y la sexta ya va en gris. Del 14-11 al 18-11 eran cuatro y la quinta, gris. */
  test("las series no se reciclan: la sexta «demás» va en gris continuo", () => {
    const estilos = estilosPorPapel(Array.from({ length: 8 }, () => ({})));
    expect(estilos.map((e) => e.color)).toEqual([MARINO, AZUL, SALVIA, LATON, VIOLETA, CACAO, GRIS_DE_LINEA, GRIS_DE_LINEA]);
    expect(estilos[6].trazos).toBeUndefined();
    expect(estilos[7].trazos).toBeUndefined();
    /* El color de la referencia no lo lleva ninguna serie que no sea la referencia. */
    expect(estilos.map((e) => e.color)).not.toContain(REFERENCIA);
  });

  /* Dirección A: la referencia, en su gris cálido, y la serie, en el azul. */
  test("OaaLineChart: la cartera, marino y de 2,25 px aunque llegue tercera con un rojo; la referencia, en su gris y a trazos", async () => {
    const contenedor = await montar(
      createElement(OaaLineChart, {
        series: [
          serie("a", "Fondo A", [100, 101, 102, 103, 104], { papel: "serie" }),
          serie("ref", "Índice", [100, 100, 101, 101, 102], { papel: "referencia", color: "#B9862F" }),
          serie("cartera", "Propuesta", [100, 102, 104, 106, 108], { papel: "cartera", color: "#C2261B" })
        ]
      })
    );
    const trazos = [...contenedor.querySelectorAll("path.recharts-line-curve")];
    expect(trazos.map((t) => t.getAttribute("stroke"))).toEqual([AZUL, REFERENCIA, MARINO]);
    expect(trazos[1].getAttribute("stroke-dasharray")).toBe("5 4");
    expect(trazos[2].getAttribute("stroke-width")).toBe("2.25");
    /* Leyenda con dos series o más, con su trazo. */
    const leyenda = contenedor.querySelector("ul.oaa-chart-legend");
    expect(leyenda?.textContent).toContain("Propuesta");
    expect(leyenda?.querySelectorAll("i.oaa-legend-mark--dash")).toHaveLength(1);
  });

  /* Esta prueba afirmaba lo contrario («UnderwaterChart no pinta de rojo la caída aunque se lo pidan»): el rediseño había
     dejado la caída en el índigo de su serie. El 14-11-2026 Óscar pidió recuperar el color, y una caída sola es un
     resultado: va en el rojo del signo (`--baja`), trazo y relleno suave. Con dos series, el rojo no diría cuál es cuál,
     y cada una sigue en el color de su papel. El color pasado a mano sigue sin pintarse. */
  test("UnderwaterChart: una sola caída va en el rojo del signo; con dos, cada una en el color de su papel", async () => {
    const caida = fechas.map((date, i) => ({ date, value: -0.01 * i }));
    const sola = await montar(createElement(UnderwaterChart, { series: [{ id: "dd", label: "Caída máxima", color: "#4C9A2A", values: caida }] }));
    const curva = sola.querySelector("path.recharts-area-curve");
    expect(curva?.getAttribute("stroke")).toBe(ROJO);
    expect(curva?.getAttribute("stroke-dasharray")).toBeNull();
    const relleno = sola.querySelector("path.recharts-area-area");
    expect(relleno?.getAttribute("fill")).toBe(ROJO);
    expect(Number(relleno?.getAttribute("fill-opacity"))).toBeGreaterThan(0);
    expect(Number(relleno?.getAttribute("fill-opacity"))).toBeLessThanOrEqual(0.2);
    expect(sola.innerHTML).not.toContain("#4C9A2A");

    const dos = await montar(
      createElement(UnderwaterChart, {
        series: [
          { id: "c", label: "Cartera", papel: "cartera", values: caida },
          { id: "r", label: "Índice", papel: "referencia", values: caida.map((p) => ({ ...p, value: p.value * 1.5 })) }
        ]
      })
    );
    const curvas = [...dos.querySelectorAll("path.recharts-area-curve")];
    expect(curvas.map((c) => c.getAttribute("stroke"))).toEqual([MARINO, REFERENCIA]);
    expect(curvas[1].getAttribute("stroke-dasharray")).toBe("5 4");
    expect(dos.innerHTML).not.toContain(ROJO);
  });

  /* El punto pasado en gris sigue siendo la referencia, y su rombo va en el gris de la referencia, no en el del resto; la
     candidata del optimizador, la primera serie, en el azul (dirección A). */
  test("la frontera: la cartera actual, marino aunque llegue en ocre; un punto gris, rombo de referencia en su gris", async () => {
    const contenedor = await montar(
      createElement(OaaFrontierChart, {
        frontier: [{ vol: 0.05, ret: 0.04 }, { vol: 0.1, ret: 0.07 }],
        marks: [
          { id: "current", label: "Cartera actual", vol: 0.08, ret: 0.06, color: "#B9862F" },
          { id: "target", label: "Tu objetivo", vol: 0.09, ret: 0.065, color: "var(--borde-control)" },
          { id: "max-sharpe", label: "Máx. Sharpe", vol: 0.07, ret: 0.06, color: "var(--serie-3)" }
        ]
      })
    );
    const svg = contenedor.querySelector("svg.recharts-surface");
    expect(svg?.querySelector(`circle[fill="${MARINO}"]`)).not.toBeNull();
    expect(svg?.querySelector(`path[fill="${REFERENCIA}"]`)).not.toBeNull();
    expect(svg?.querySelector(`path[fill="${GRIS}"]`)).toBeNull();
    expect(svg?.querySelector(`circle[fill="${AZUL}"]`)).not.toBeNull();
    expect(contenedor.innerHTML).not.toContain("#B9862F");
  });
});

describe("los repartos agrupan en «Otros» y no reciclan colores", () => {
  const siete = ["A", "B", "C", "D", "E", "F", "G"].map((letra, i) => ({ key: letra, label: `Sector ${letra}`, value: 20 - i }));

  test("la séptima categoría cae en «Otros»: cinco con color y el resto sumado, en gris", async () => {
    const agrupado = repartoConOtros(siete, (grupo, otros) => ({ ...otros, value: grupo.reduce((s, f) => s + f.value, 0) }));
    expect(agrupado.map((f) => f.label)).toEqual(["Sector A", "Sector B", "Sector C", "Sector D", "Sector E", "Otros"]);
    expect(agrupado[5].value).toBe(15 + 14);

    const contenedor = await montar(createElement(OaaDonutChart, { data: siete }));
    const porciones = [...contenedor.querySelectorAll("path.recharts-sector")].map((p) => p.getAttribute("fill"));
    /* Un reparto sin clases (sectores): azul, salvia, latón, violeta y cacao; el marino queda para una sexta. */
    expect(porciones).toEqual([AZUL, SALVIA, LATON, VIOLETA, CACAO, GRIS]);
    /* La tabla alternativa trae las mismas cifras que la leyenda. */
    expect(filasDeLaTabla(contenedor)).toEqual([
      ["Sector A", `20,0${NB}%`],
      ["Sector B", `19,0${NB}%`],
      ["Sector C", `18,0${NB}%`],
      ["Sector D", `17,0${NB}%`],
      ["Sector E", `16,0${NB}%`],
      ["Otros", `29,0${NB}%`]
    ]);
  });

  test("con seis categorías no se agrupa nada; «No declarado» va aparte y en gris", () => {
    const seis = siete.slice(0, 6);
    expect(repartoConOtros(seis, (g, o) => ({ ...o, value: 0 })).map((f) => f.label)).toHaveLength(6);
    const conResto = repartoConOtros([...seis, { key: "nd", label: "No declarado", value: 3 }], (g, o) => ({ ...o, value: 0 }));
    expect(conResto.map((f) => [f.label, f.resto])).toEqual([...seis.map((f) => [f.label, false]), ["No declarado", true]]);
  });

  /* El peso estratégico es la referencia y va en su gris cálido (dirección A; del 14-11 al 18-11, en tostado). */
  test("las barras agrupadas: la referencia en su gris, la cartera en marino y «Otros» desde la sexta fila", async () => {
    const filas = siete.map((f) => ({ key: f.key, label: f.label, a: 10, b: 12 }));
    const contenedor = await montar(createElement(OaaGroupedBarChart, { rows: filas, aLabel: "Peso estratégico", bLabel: "Peso táctico" }));
    const barras = [...contenedor.querySelectorAll("path.recharts-rectangle")].map((b) => b.getAttribute("fill"));
    expect(new Set(barras)).toEqual(new Set([REFERENCIA, MARINO]));
    const tabla = filasDeLaTabla(contenedor);
    expect(tabla).toHaveLength(6);
    expect(tabla[5]).toEqual(["Otros", `20,0${NB}%`, `24,0${NB}%`]);
  });
});

describe("las cifras y las fechas, con el formato común", () => {
  test.each([
    ["rentabilidad", rentabilidadDelGrafico(0.1039), `+10,39${NB}%`],
    ["rentabilidad negativa", rentabilidadDelGrafico(-0.0472), `${MENOS}4,72${NB}%`],
    ["volatilidad", volatilidadDelGrafico(0.078), `7,80${NB}%`],
    ["caída", volatilidadDelGrafico(-0.114), `${MENOS}11,40${NB}%`],
    ["peso en puntos", pesoDelGrafico(24), `24,0${NB}%`],
    ["porcentaje de eje", pctDecimal(0.1, 0), `10${NB}%`],
    ["porcentaje en puntos", pctPoint(2.456, 2), `2,46${NB}%`],
    ["base 100", base100(112.34), "112,3"],
    ["fecha del eje", compactDate("2026-11-13"), "nov 2026"],
    ["fecha de la nota", tooltipDate("2026-11-13"), "13/11/2026"],
    ["lo que falta", rentabilidadDelGrafico(null), "Falta el dato"],
    ["lo que falta, sin número", pctPoint(Number.NaN), "Falta el dato"]
  ])("%s", (_que, escrito, esperado) => {
    expect(escrito).toBe(esperado);
  });

  test("la nota: la cabecera, una fila por serie con su nombre entero y su cifra, y el trazo de la referencia", () => {
    const html = renderToStaticMarkup(
      createElement(OaaTooltip, {
        active: true,
        titulo: "13/11/2026 · base 100",
        filas: [
          { clave: "c", nombre: "Propuesta", valor: "112,3", color: MARINO, detalle: `+12,30${NB}% desde el inicio` },
          { clave: "r", nombre: "Índice de referencia", valor: "104,1", color: REFERENCIA, discontinua: true }
        ]
      })
    );
    expect(html).toContain("13/11/2026 · base 100");
    expect(html).toContain("Propuesta");
    expect(html).toContain(`+12,30${NB}% desde el inicio`);
    expect(html).toContain('class="oaa-chart-tooltip-dot oaa-chart-tooltip-dot--trazos"');
  });

  test("Monte Carlo escribe «a 1 año» y «a 3 años» en el eje, nunca «+1A»", async () => {
    const semanal = Array.from({ length: 160 }, (_, i) => ({
      date: new Date(Date.UTC(2023, 0, 2 + i * 7)).toISOString().slice(0, 10),
      value: 100 * 1.0015 ** i * (1 + 0.03 * Math.sin(i / 3))
    }));
    const contenedor = await montar(createElement(OaaMonteCarloChart, { series: semanal, frequency: "WEEKLY", horizonYears: 3 }));
    const eje = contenedor.querySelector(".recharts-xAxis-tick-labels")?.textContent ?? "";
    expect(eje).toContain("a 1 año");
    expect(eje).toContain("a 3 años");
    expect(contenedor.innerHTML).not.toMatch(/\+\dA/);
    expect(filasDeLaTabla(contenedor).map((fila) => fila[0])).toEqual(expect.arrayContaining(["Hoy", "a 1 año", "a 2 años", "a 3 años"]));
  });

  test("la última marca del eje del cono no se corta: el margen derecho deja sitio a media etiqueta", () => {
    /* La última marca va centrada en el último punto, así que media etiqueta cae fuera del plano. Con 18 px de margen,
       «a 3 años» se leía «a 3 año» (visto en las capturas de Diseño · Simular). A 12 px, un carácter de la letra del eje
       mide unos 6,5 px de media: «a 10 años», el horizonte más largo, son unos 58 px, y media etiqueta, 29. */
    const anchoDeLaEtiqueta = aNAnios(10).length * 6.5;
    expect(MARGEN_DERECHO_DEL_CONO).toBeGreaterThanOrEqual(anchoDeLaEtiqueta / 2);
  });
});

describe("cada pieza tiene nombre accesible y su tabla alternativa trae las cifras que pinta", () => {
  test("OaaLineChart: role img con nombre, y una fila por mes y la última con cada serie", async () => {
    const contenedor = await montar(
      createElement(OaaLineChart, { series: [serie("c", "Propuesta", [100, 101, 102, 103, 104.5]), serie("r", "Índice", [100, 100, 99, 101, 102])] })
    );
    const svg = contenedor.querySelector("svg.recharts-surface");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Evolución de Propuesta, Índice");
    expect(filasDeLaTabla(contenedor)).toEqual([
      ["01/09/2026", "100,0", "100,0"],
      ["01/10/2026", "102,0", "99,0"],
      ["02/11/2026", "104,5", "102,0"]
    ]);
    /* Etiqueta directa al final de cada línea: su nombre y su último valor, separados por « · » (18-11-2026). */
    expect(svg?.textContent).toContain("Propuesta · 104,5");
    expect(svg?.textContent).toContain("Índice · 102,0");
  });

  test("el mapa de riesgo y rentabilidad: ejes con título, cada referencia con su nombre y una tabla sin la «z»", async () => {
    const contenedor = await montar(
      createElement(OaaRiskReturnChart, {
        portfolio: { id: "p", label: "Tu cartera", vol: 0.08, ret: 0.06 },
        benchmarks: [
          { id: "b1", label: "Conservadora", vol: 0.04, ret: 0.03 },
          { id: "b2", label: "Dinámica", vol: 0.14, ret: 0.08 }
        ]
      })
    );
    const svg = contenedor.querySelector("svg.recharts-surface");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.textContent).toContain("Volatilidad");
    expect(svg?.textContent).toContain("Rentabilidad anualizada");
    expect(svg?.textContent).toContain("Conservadora");
    expect(svg?.textContent).toContain("Dinámica");
    expect(svg?.querySelector(`circle[fill="${MARINO}"]`)).not.toBeNull();
    /* Los rombos de las carteras de referencia, en el gris de la referencia (dirección A), no en el gris claro del resto. */
    expect(svg?.querySelectorAll(`path[fill="${REFERENCIA}"]`)).toHaveLength(2);
    expect(svg?.querySelectorAll(`path[fill="${GRIS}"]`)).toHaveLength(0);
    expect(filasDeLaTabla(contenedor)).toEqual([
      ["Tu cartera", "Cartera", `8,00${NB}%`, `+6,00${NB}%`],
      ["Conservadora", "Cartera de referencia", `4,00${NB}%`, `+3,00${NB}%`],
      ["Dinámica", "Cartera de referencia", `14,00${NB}%`, `+8,00${NB}%`]
    ]);
  });

  test("la caja de estilo: una fila por tamaño, una columna por estilo, con el nombre entero", async () => {
    const celdas = {
      large_value: 10, large_blend: 20, large_growth: 30,
      mid_value: 5, mid_blend: 10, mid_growth: 15,
      small_value: 2, small_blend: 3, small_growth: 5
    };
    const contenedor = await montar(createElement(OaaStyleBoxChart, { celdas }));
    expect(contenedor.querySelector("svg.recharts-surface")?.getAttribute("aria-label")).toBe("Caja de estilo y tamaño");
    expect(contenedor.querySelector("div.sr-only > table thead")?.textContent).toBe("TamañoValorMixtoCrecimiento");
    expect(filasDeLaTabla(contenedor)[0]).toEqual(["Grande", `10,0${NB}%`, `20,0${NB}%`, `30,0${NB}%`]);
  });
});

describe("la tabla alternativa no empuja la página", () => {
  /* Visto en el navegador a 768 px: con `sr-only` en la propia tabla, Análisis desbordaba 98 px, porque 1 × 1 px y
     `overflow: hidden` no valen en un `display: table`. Lo recortado tiene que ser un envoltorio. */
  test("en cada gráfico, la tabla va dentro de un contenedor `sr-only` y ella misma no lleva la clase", async () => {
    const semanal = Array.from({ length: 160 }, (_, i) => ({
      date: new Date(Date.UTC(2023, 0, 2 + i * 7)).toISOString().slice(0, 10),
      value: 100 * 1.0015 ** i
    }));
    const piezas: ReactElement[] = [
      createElement(OaaLineChart, { series: [serie("c", "Propuesta", [100, 101, 102, 103, 104])] }),
      createElement(UnderwaterChart, { series: [{ id: "dd", label: "Caída", values: fechas.map((date, i) => ({ date, value: -0.01 * i })) }] }),
      createElement(OaaRiskReturnChart, { portfolio: { id: "p", label: "Tu cartera", vol: 0.08, ret: 0.06 } }),
      createElement(OaaFrontierChart, { frontier: [{ vol: 0.05, ret: 0.04 }, { vol: 0.1, ret: 0.07 }], marks: [] }),
      createElement(OaaMonteCarloChart, { series: semanal, frequency: "WEEKLY" }),
      createElement(OaaDonutChart, { data: [{ key: "a", label: "A", value: 60 }, { key: "b", label: "B", value: 40 }] }),
      createElement(OaaGroupedBarChart, { rows: [{ key: "e", label: "Europa", a: 30, b: 25 }], aLabel: "Estratégico", bLabel: "Táctico" }),
      createElement(OaaCorrelationHeatmap, {
        items: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
        cells: [{ rowKey: "a", columnKey: "b", rowLabel: "A", columnLabel: "B", rowIndex: 0, columnIndex: 1, value: 0.5 }]
      }),
      createElement(OaaOverlapHeatmap, {
        items: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
        cells: [{ rowKey: "a", columnKey: "b", rowLabel: "A", columnLabel: "B", rowIndex: 0, columnIndex: 1, value: 45, commonTop: [] }]
      })
    ];
    for (const pieza of piezas) {
      const contenedor = await montar(pieza);
      const tablas = [...contenedor.querySelectorAll("table")];
      expect(tablas.length, String(pieza.type)).toBeGreaterThan(0);
      for (const tabla of tablas) {
        expect(tabla.classList.contains("sr-only")).toBe(false);
        expect(tabla.parentElement?.classList.contains("sr-only")).toBe(true);
      }
    }
  });
});

describe("las matrices: rampa índigo, leyenda por clases y cifras accesibles", () => {
  test("las clases de la leyenda dicen sus límites de verdad (escritos a mano)", () => {
    expect(CLASES_DE_LA_CORRELACION.map((c) => [c.paso, c.rotulo])).toEqual([
      [0, "Menos de 0,10"],
      [1, "De 0,10 a menos de 0,25"],
      [2, "De 0,25 a menos de 0,45"],
      [3, "De 0,45 a menos de 0,65"],
      [5, "De 0,65 a menos de 0,85"],
      [6, "De 0,85 a menos de 0,999"],
      [7, "Desde 0,999"]
    ]);
    expect(CLASES_DEL_SOLAPAMIENTO.map((c) => c.rotulo)).toEqual([
      `0${NB}%`,
      `Más de 0${NB}% y menos de 20${NB}%`,
      `De 20${NB}% a menos de 40${NB}%`,
      `De 40${NB}% a menos de 60${NB}%`,
      `De 60${NB}% a menos de 80${NB}%`,
      `De 80${NB}% a menos de 99${NB}%`,
      `Desde 99${NB}%`
    ]);
    /* La misma construcción que la de las casillas: mismos umbrales, mismos pasos. */
    expect(clasesDeLaRampa(CORRELATION_THRESHOLDS, String).map((c) => c.paso)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    expect(clasesDeLaRampa(OVERLAP_THRESHOLDS, String, { exclusiveFirst: true })).toHaveLength(7);
  });

  test("correlación: tabla con el nombre de cada activo, casillas por clase y tinta de papel desde el paso 5", async () => {
    const items = [{ key: "a", label: "Fondo A" }, { key: "b", label: "Fondo B" }];
    const cells = [
      { rowKey: "a", columnKey: "a", rowLabel: "Fondo A", columnLabel: "Fondo A", rowIndex: 0, columnIndex: 0, value: 1 },
      { rowKey: "a", columnKey: "b", rowLabel: "Fondo A", columnLabel: "Fondo B", rowIndex: 0, columnIndex: 1, value: 0.7 },
      { rowKey: "b", columnKey: "a", rowLabel: "Fondo B", columnLabel: "Fondo A", rowIndex: 1, columnIndex: 0, value: null },
      { rowKey: "b", columnKey: "b", rowLabel: "Fondo B", columnLabel: "Fondo B", rowIndex: 1, columnIndex: 1, value: 1 }
    ];
    const contenedor = await montar(createElement(OaaCorrelationHeatmap, { items, cells }));
    expect(filasDeLaTabla(contenedor)).toEqual([
      ["Fondo A", "1,00", "0,70"],
      ["Fondo B", "Falta el dato", "1,00"]
    ]);
    const casilla = contenedor.querySelector(".heatmap__cell.oaa-rampa--5");
    expect(casilla?.textContent).toBe("0,70");
    expect(casilla?.classList.contains("is-dark")).toBe(true);
    expect(contenedor.innerHTML).not.toContain("N/D");
    expect(contenedor.querySelector(".oaa-rampa-leyenda")?.textContent).toContain("Desde 0,999");
  });

  test("solapamiento: la tabla lleva la cifra y las mayores posiciones comunes; el índice va sin color", async () => {
    const contenedor = await montar(
      createElement(OaaOverlapHeatmap, {
        items: [{ key: "a", label: "Fondo A", color: "#143D66" }, { key: "b", label: "Fondo B", color: "#B9862F" }],
        cells: [
          { rowKey: "a", columnKey: "b", rowLabel: "Fondo A", columnLabel: "Fondo B", rowIndex: 0, columnIndex: 1, value: 45, commonTop: [{ name: "Apple", weight: 3 }] },
          { rowKey: "b", columnKey: "a", rowLabel: "Fondo B", columnLabel: "Fondo A", rowIndex: 1, columnIndex: 0, value: null, commonTop: [] }
        ]
      })
    );
    const tabla = filasDeLaTabla(contenedor);
    expect(tabla[0][2]).toContain("Apple 3,0");
    expect(tabla[1][1]).toBe("Falta");
    expect(contenedor.querySelector("ol.oaa-heatmap-index i")).toBeNull();
    expect(contenedor.innerHTML).not.toContain("#143D66");
    expect(contenedor.querySelectorAll(".oaa-rampa-leyenda li")).toHaveLength(7);
  });
});

/* 14-11-2026: el mapa vuelve a llevar un color por zona (decisión de Óscar: «imprescindibles»). El rediseño lo había
   dejado en una sola tinta y esta prueba lo exigía; ahora exige lo contrario. */
describe("el mapa geográfico: un color por zona, la intensidad por peso y paradas de teclado con nombre", () => {
  test("cada zona es una parada con nombre dentro de un grupo, y tres zonas con el mismo tramo de peso van cada una en su color", () => {
    const html = renderToStaticMarkup(
      createElement(GeoDistributionMap, { rows: [{ key: "united_states", weight_percent: 30 }, { key: "japan", weight_percent: 30 }, { key: "eurozone", weight_percent: 40 }] })
    );
    const contenedor = document.createElement("div");
    contenedor.innerHTML = html;
    const svg = contenedor.querySelector("svg.geo-map-svg");
    expect(svg?.getAttribute("role")).toBe("group");
    const zonas = [...contenedor.querySelectorAll("path.geo-map-zona")];
    expect(zonas.length).toBeGreaterThan(0);
    for (const zona of zonas) {
      expect(zona.getAttribute("tabindex")).toBe("0");
      expect(zona.getAttribute("aria-label")).toMatch(/de la renta variable$/);
    }
    /* América, 30 %; Asia, 30 %; Europa, 40 %: las tres en el mismo tramo de peso, y cada una en su tono. */
    const coloresDe = (zonaDelMapa: string) =>
      new Set(zonas.filter((zona) => zona.getAttribute("aria-label")?.includes(`en ${zonaDelMapa}:`)).map((zona) => zona.getAttribute("fill")));
    expect(coloresDe("América")).toEqual(new Set([zoneColor("america", 30)]));
    expect(coloresDe("Europa / O. Medio / África")).toEqual(new Set([zoneColor("emea", 40)]));
    expect(coloresDe("Asia")).toEqual(new Set([zoneColor("asia", 30)]));
    expect(new Set([zoneColor("america", 30), zoneColor("emea", 40), zoneColor("asia", 30)]).size).toBe(3);
    /* La leyenda nombra cada color: la marca de cada zona lleva su color pleno. */
    const marcas = [...contenedor.querySelectorAll<HTMLElement>(".geo-map-macro-chip i")].map((marca) => marca.style.background || marca.getAttribute("style"));
    expect(marcas).toHaveLength(3);
    for (const pleno of Object.values(ZONE_CHIP)) expect(html.toLowerCase()).toContain(pleno.toLowerCase());
  });
});
