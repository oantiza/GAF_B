// @vitest-environment happy-dom

/**
 * El color y los datos que vuelven a Diseño, Análisis y Comparador (14-11-2026, Óscar al ver el rediseño: «le faltan colores en
 * general… ¿están todos los datos que salían antes? dale más vida»). Lo que se comprueba aquí es lo que cada pantalla le pasa a las
 * piezas —las porciones del aro con su color, la clase que pinta una diferencia, los puntos del estado—, no cómo las pinta el gráfico.
 *
 * Las diferencias esperadas salen a mano de las cifras de prueba, con el sentido de cada métrica: más rentabilidad y más Sharpe,
 * mejor; menos volatilidad, menos coste y una caída más cerca de cero, mejor.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OaaDonutSlice, OaaFrontierMark } from "../src/charts/oaa";

const capturas = vi.hoisted(() => ({
  aro: [] as Array<{ data: OaaDonutSlice[]; center?: { value: string; note?: string } }>,
  frontera: [] as Array<{ marks: OaaFrontierMark[]; height?: number }>
}));
const horizonte = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as string | undefined }));

vi.mock("../src/core/usePortfolioHorizon", () => ({
  usePortfolioHorizon: () => ({ window: "3Y", data: horizonte.data, error: horizonte.error, retry: () => undefined })
}));
vi.mock("../src/charts/oaa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/charts/oaa")>()),
  OaaDonutChart: (props: { data: OaaDonutSlice[]; center?: { value: string; note?: string } }) => {
    capturas.aro.push(props);
    return null;
  },
  OaaFrontierChart: (props: { marks: OaaFrontierMark[]; height?: number }) => {
    capturas.frontera.push(props);
    return null;
  },
  OaaLineChart: () => null,
  OaaMonteCarloChart: () => null,
  OaaRiskReturnChart: () => null,
  OaaCorrelationHeatmap: () => null
}));
vi.mock("../src/charts/UnderwaterChart", () => ({ UnderwaterChart: () => null }));
vi.mock("../src/charts/OverlapHeatmap", () => ({ OverlapHeatmap: () => null }));
vi.mock("../src/components/HistoricalStressCards", () => ({ HistoricalStressCards: () => null }));
vi.mock("../src/core/useSeriesDeReferencia", () => ({
  useSeriesDeReferencia: () => ({ estado: "no-disponible", series: null, reintentar: () => undefined })
}));
vi.mock("../src/components/FrontierPanel", () => ({
  FrontierPanel: () => createElement("section", { "data-panel": "frontera" }, createElement("h2", null, "Frontera eficiente"))
}));

import { parsePortfolioHorizon, type PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { columnasDeComposicion, filasDeComposicion } from "../src/adapters/tablaDeComposicion";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { TablaDeMetricasComparativas } from "../src/components/MetricasComparativas";
import { PortfolioHorizonPanel } from "../src/components/PortfolioHorizonPanel";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { PortfolioStatusPanel } from "../src/components/PortfolioStatusPanel";
import { PortfolioSummary } from "../src/components/PortfolioSummary";
import { PortfolioXray } from "../src/components/PortfolioXray";
import { XrayAdvanced } from "../src/components/XrayAdvanced";
import { colorDeLaClase } from "../src/core/coloresDeClase";
import { veredictoDeLaDiferencia } from "../src/core/sentidoDeLaDiferencia";
import { UNCLASSIFIED_COLOR } from "../src/core/theme";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioXray } from "../src/types/bdbAssets";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  capturas.aro.length = 0;
  capturas.frontera.length = 0;
  horizonte.data = undefined;
  horizonte.error = undefined;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const pintar = async (nodo: Parameters<Root["render"]>[0]) => act(async () => root!.render(nodo));
const plano = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");

/* ------------------------------------------------------------------ mejora y empeora */

describe("el sentido de una diferencia (G9, G10)", () => {
  test("más rentabilidad y más Sharpe, mejor; menos volatilidad y menos coste, mejor", () => {
    expect(veredictoDeLaDiferencia(0.04, 0.05, "mas", 4)).toBe("mejora");
    expect(veredictoDeLaDiferencia(1.27, 1.01, "mas", 2)).toBe("empeora");
    expect(veredictoDeLaDiferencia(0.12, 0.119, "menos", 4)).toBe("mejora");
    expect(veredictoDeLaDiferencia(0.008, 0.015, "menos", 4)).toBe("empeora");
  });

  test("la caída, más cerca de cero es mejor, se escriba con signo o sin él", () => {
    expect(veredictoDeLaDiferencia(-0.1305, -0.0732, "menosProfunda", 4)).toBe("mejora");
    expect(veredictoDeLaDiferencia(0.1305, 0.0732, "menosProfunda", 4)).toBe("mejora");
    expect(veredictoDeLaDiferencia(-0.09, -0.12, "menosProfunda", 4)).toBe("empeora");
  });

  test("lo que se escribe como cero, o no se puede calcular, no mejora ni empeora", () => {
    /* 0,10004 − 0,1 = 0,00004: con dos decimales de punto se escribe «+0,00 pp». */
    expect(veredictoDeLaDiferencia(0.1, 0.10004, "mas", 4)).toBeNull();
    expect(veredictoDeLaDiferencia(1.18, 1.18, "mas", 2)).toBeNull();
    expect(veredictoDeLaDiferencia(null, 0.1, "mas", 4)).toBeNull();
    expect(veredictoDeLaDiferencia(0.1, Number.NaN, "menos", 4)).toBeNull();
  });
});

describe("la tabla de métricas comparadas (Simular y Optimizar) vuelve a decir qué mejora", () => {
  /* Las cifras de `tablaDeMetricasComparativas.test.tsx`. Rentabilidad 8,24 − 13,48 = −5,24 pp, empeora; volatilidad 5,46 − 8,44 =
     −2,98 pp, mejora; Sharpe 1,01 − 1,27 = −0,26, empeora; caída −7,32 − (−13,05) = +5,73 pp, menos profunda: mejora. */
  const CARTERA = { cagr: 0.1348, volatility: 0.0844, sharpe: 1.27, max_drawdown: -0.1305 };
  const MAXIMO_SHARPE = { cagr: 0.0824, volatility: 0.0546, sharpe: 1.01, max_drawdown: -0.0732 };
  const html = () =>
    renderToStaticMarkup(createElement(TablaDeMetricasComparativas, { aria: "Comparativa", rotuloA: "Cartera", rotuloB: "Máx. Sharpe", a: CARTERA, b: MAXIMO_SHARPE }));
  const diferencias = (marcado = html()) => {
    const contenedor = document.createElement("div");
    contenedor.innerHTML = marcado;
    return [...contenedor.querySelectorAll("tbody tr")].map((fila) => {
      const celda = fila.lastElementChild!.querySelector(".cifra")!;
      return [plano(celda.textContent), celda.classList.contains("cifra--sube") ? "verde" : celda.classList.contains("cifra--baja") ? "rojo" : "tinta"];
    });
  };

  test("verde lo que mejora y rojo lo que empeora, con el signo escrito de siempre", () => {
    expect(diferencias()).toEqual([
      ["−5,24 pp", "rojo"],
      ["−2,98 pp", "verde"],
      ["−0,26", "rojo"],
      ["+5,73 pp", "verde"]
    ]);
  });

  test("bajo la tabla, la nota que dice qué significa el color; sin diferencia, ni color ni nota", () => {
    expect(html()).toContain("En verde, lo que mejora; en rojo, lo que empeora.");
    const sola = renderToStaticMarkup(createElement(TablaDeMetricasComparativas, { aria: "Comparativa", rotuloB: "Máx. Sharpe", b: MAXIMO_SHARPE }));
    expect(sola).not.toContain("En verde");
    expect(sola).not.toContain("Diferencia");
  });

  test("una diferencia nula va sin color", () => {
    const igual = renderToStaticMarkup(createElement(TablaDeMetricasComparativas, { aria: "Comparativa", rotuloA: "A", rotuloB: "B", a: CARTERA, b: CARTERA }));
    expect(diferencias(igual)).toEqual([
      ["0,00 pp", "tinta"],
      ["0,00 pp", "tinta"],
      ["0,00", "tinta"],
      ["0,00 pp", "tinta"]
    ]);
  });
});

/* ------------------------------------------------------------------ Diseño → Componer */

const activo = (asset_id: string, clase = "EQUITY", extra: Record<string, unknown> = {}) =>
  ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: clase, currency: "EUR", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, ...extra }) as unknown as BdbAssetDetail;

const RESUMEN = {
  position_count: 3,
  is_valid: true,
  validation_status: "VALID",
  non_investable_assets: [],
  weighted_metrics: {},
  by_instrument_type: [{ key: "FUND", weight_percent: 90 }],
  by_economic_asset_class: [
    { key: "FIXED_INCOME", weight_percent: 50 },
    { key: "EQUITY", weight_percent: 30 },
    { key: "MONEY_MARKET", weight_percent: 10 }
  ],
  warnings: []
};

describe("Componer, «Reparto por clase»: vuelve el aro (G1)", () => {
  test("cada clase con su color fijo, lo que no entra en gris y el capital en el hueco", async () => {
    await pintar(
      createElement(PortfolioSummary, {
        summary: RESUMEN as never,
        variant: "side",
        totalCapital: 250000,
        fueraDelReparto: [{ clave: "fuera", rotulo: "No invertible", peso: 10 }] as never
      })
    );
    expect(capturas.aro).toHaveLength(1);
    const { data, center } = capturas.aro[0];
    expect(data.map((porcion) => [porcion.label, porcion.value, porcion.colorDeCategoria ?? porcion.color])).toEqual([
      ["Renta fija", 50, colorDeLaClase("FIXED_INCOME")],
      ["Renta variable", 30, colorDeLaClase("EQUITY")],
      ["Monetario", 10, colorDeLaClase("MONEY_MARKET")],
      ["No invertible", 10, UNCLASSIFIED_COLOR]
    ]);
    /* La renta variable va en su índigo aunque sea la segunda por peso: el color sigue a la clase, no al puesto. */
    expect(data[1].colorDeCategoria).not.toBe(data[0].colorDeCategoria);
    expect(data[3].colorDeCategoria).toBeUndefined();
    expect(plano(center?.value)).toBe("250.000 €");
    expect(center?.note).toBe("3 posiciones · 3 clases");
    expect(host.textContent).toContain("Por producto · Fondo 90,0");
    expect(host.querySelector(".partes")).toBeNull();
  });

  test("con el capital de ejemplo, el hueco no lo da por bueno", async () => {
    await pintar(createElement(PortfolioSummary, { summary: RESUMEN as never, variant: "side", totalCapital: 100000, capitalSinFijar: true }));
    expect(capturas.aro[0].center?.value).toBe("Capital sin fijar");
  });

  test("con una sola clase el aro se vuelve cifra, y el capital y las posiciones pasan bajo el título", async () => {
    const unaClase = { ...RESUMEN, position_count: 1, by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] };
    await pintar(createElement(PortfolioSummary, { summary: unaClase as never, variant: "side", totalCapital: 50000 }));
    expect(plano(host.querySelector(".panel__subtitle")?.textContent)).toBe("50.000 € · 1 posición · 1 clase");
  });
});

/* La mayor posición al 18 %: concentración baja. La simulación mide el 100 % del peso: datos completos. */
const CINCO: BdbManualPortfolioPosition[] = [18, 18, 18, 18, 18, 10].map((peso, indice) => ({ asset_id: `P${indice}`, weight_percent: peso }));
const SIMULACION_ENTERA = {
  years: 3,
  referenceVersion: "x",
  extensions: [],
  coverageWeightPercent: 100,
  backtest: { asset_ids: CINCO.map((p) => p.asset_id), excluded_assets: [], coverage: { requested_assets: 6, first_date: "2023-10-20", last_date: "2026-10-23" } }
};

describe("Componer, «Estado»: vuelve con sus filas y su punto de color (G8, D5)", () => {
  const estado = (posiciones: BdbManualPortfolioPosition[], resumen: Record<string, unknown> = RESUMEN, modoCliente = false) =>
    createElement(ClientModeProvider, {
      initialValue: modoCliente,
      children: createElement(PortfolioStatusPanel, {
        summary: resumen as never,
        positions: posiciones,
        assets: posiciones.map((p) => activo(p.asset_id)),
        riskProfilePreview: null,
        onVerComprobar: () => undefined
      })
    });
  const filas = () =>
    [...host.querySelectorAll(".diseno-estado__fila")].map((fila) => [
      plano(fila.textContent),
      fila.classList.contains("diseno-estado__fila--bien") ? "bien" : fila.classList.contains("diseno-estado__fila--atencion") ? "atención" : fila.classList.contains("diseno-estado__fila--mal") ? "mal" : "neutro"
    ]);

  test("cuando está bien también lo dice: «Concentración baja · mayor posición 18,0 %», en verde", async () => {
    horizonte.data = SIMULACION_ENTERA;
    await pintar(estado(CINCO));
    expect(host.querySelector("h2")?.textContent).toBe("Estado");
    expect(filas()).toEqual([
      ["Perfil: sin elegir", "neutro"],
      ["Concentración baja · mayor posición 18,0 %", "bien"],
      ["Datos completos · 6 de 6 activos · 100,0 % del peso en la simulación", "bien"]
    ]);
    expect(host.querySelector(".diseno-estado")?.textContent).toContain("Nada que revisar");
    expect(host.querySelector('button[aria-label="Ver lo que hay que revisar, en el paso Comprobar"]')).not.toBeNull();
  });

  test("lo que pide atención va en ocre y lo que está mal en rojo, cada uno con su palabra", async () => {
    horizonte.data = { ...SIMULACION_ENTERA, coverageWeightPercent: 60, backtest: { ...SIMULACION_ENTERA.backtest, asset_ids: ["P0"] } };
    const descuadrada = { ...RESUMEN, validation_status: "INVALID" };
    await pintar(estado([{ asset_id: "P0", weight_percent: 30 }, { asset_id: "P1", weight_percent: 66 }], descuadrada));
    const leidas = filas();
    expect(leidas[0][0]).toMatch(/^Pesos sin cuadrar · suma 96,0 % · normaliza al 100 %$/);
    expect(leidas[0][1]).toBe("mal");
    expect(leidas.find(([texto]) => texto.startsWith("Concentración"))).toEqual(["Concentración alta · mayor posición 66,0 %", "mal"]);
    expect(leidas.find(([texto]) => texto.startsWith("Datos"))?.[0]).toMatch(/^Datos parciales · /);
    expect(leidas.find(([texto]) => texto.startsWith("Datos"))?.[1]).toBe("atención");
  });

  test("mientras se mide, el punto de los datos no adelanta un color", async () => {
    await pintar(estado(CINCO));
    expect(filas().find(([texto]) => texto.startsWith("Datos"))).toEqual(["Datos · 6/6 invertibles · midiendo…", "neutro"]);
  });

  test("en Modo cliente no sale: es el semáforo de trabajo del asesor", async () => {
    horizonte.data = SIMULACION_ENTERA;
    await pintar(estado(CINCO, RESUMEN, true));
    expect(host.textContent).toBe("");
  });
});

describe("las tablas de posiciones: la clase con el punto de su color", () => {
  test("Diseño, columna «Producto · clase»", async () => {
    const posiciones = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
    await pintar(
      createElement(PortfolioPositionsTable, {
        assets: [activo("A", "EQUITY"), activo("B", "FIXED_INCOME")],
        positions: posiciones,
        locks: {},
        totalCapital: 100000,
        onWeightChange: () => undefined,
        onEuroChange: () => undefined,
        onRemove: () => undefined,
        onToggleLock: () => undefined,
        onSwapRequest: () => undefined
      } as never)
    );
    const clases = [...host.querySelectorAll(".clase-con-color")].map((clase) => [plano(clase.textContent), (clase.querySelector(".clase-con-color__punto") as HTMLElement).style.background]);
    expect(clases.map(([nombre]) => nombre)).toEqual(["Renta variable", "Renta fija"]);
    expect(clases[0][1]).not.toBe(clases[1][1]);
  });

  test("Análisis, «Posiciones», columna «Clase de activo»: punto y nombre; lo que falta sigue diciéndolo, sin punto", () => {
    const posiciones = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
    const filas = filasDeComposicion({ positions: posiciones, assets: [activo("A", "EQUITY", { category: "Renta variable global" }), activo("B", "", { economic_asset_class: undefined, category: "Mixto" })] } as never);
    const columna = columnasDeComposicion({ anos: 3, clientMode: false } as never).find((c) => c.id === "clase")!;
    const [conClase, sinClase] = filas.filter((fila) => !fila.cabeceraDeGrupo).map((fila) => columna.celda(fila));
    expect(conClase.texto).toBe("Renta variable");
    expect(renderToStaticMarkup(createElement("div", null, conClase.nodo))).toContain('class="clase-con-color__punto"');
    expect(sinClase.ausencia).toBe("falta");
    expect(sinClase.nodo).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ la frontera vuelve (D1) */

function simulacionConFrontera(): PortfolioHorizon {
  const primera = Date.UTC(2023, 8, 1);
  const serie = Array.from({ length: 158 }, (_, i) => ({ date: new Date(primera + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 + i / 4 }));
  const backtest = {
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", units: "decimal", frequency: "WEEKLY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "WEEKLY",
    metrics: { cagr: 0.1, volatility: 0.08, sharpe: 1, max_drawdown: -0.1, rf_rate: 0.02 }, portfolio_series: serie,
    asset_ids: ["A", "B"], weights_normalized: { A: 0.6, B: 0.4 }, correlation_matrix: [[1, 0.2], [0.2, 1]], benchmark_series: {}, synthetics: [],
    coverage: { requested_assets: 2, included_assets: 2, common_observations: serie.length, first_date: serie[0].date, last_date: serie.at(-1)!.date }, excluded_assets: [], warnings: []
  };
  const analisis = parsePortfolioHorizon(
    { schema_version: "portfolio-horizon.v1", window: "3Y", horizon_years: 3, reference_version: "test", backtest, equal_weight: backtest, max_sharpe: null, frontier: null, coverage_weight_percent: 100, extensions: [], methodology: "" },
    "3Y"
  );
  const punto = (volatility: number, expectedReturn: number) => ({ volatility, expectedReturn, sharpeRatio: 1, expectedReturnLabel: "", volatilityLabel: "", sharpeLabel: "", weights: [] });
  return {
    ...analisis,
    frontier: {
      label: "Frontera eficiente · 3 años",
      frontier: [punto(0.05, 0.04), punto(0.08, 0.07), punto(0.12, 0.09)],
      current: punto(0.08, 0.06),
      maxSharpe: punto(0.08, 0.07),
      minVolatility: punto(0.05, 0.04)
    } as never
  };
}

const marcasDe = (indice: number) => capturas.frontera[indice].marks.map((marca) => marca.label);

describe("la frontera eficiente vuelve a Simular, a Componer y a Análisis (D1)", () => {
  test("Simular: la simulación entera lleva su frontera, con la cartera actual, el máximo Sharpe y la mínima volatilidad", async () => {
    horizonte.data = simulacionConFrontera();
    await pintar(createElement(PortfolioHorizonPanel, { positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }] }));
    expect([...host.querySelectorAll("h3")].map((titulo) => titulo.textContent)).toContain("Frontera eficiente · 3 años");
    expect(marcasDe(0)).toEqual(["Cartera actual", "Máx. Sharpe", "Mín. volatilidad"]);
  });

  test("Componer: en «Rentabilidad y riesgo», la frontera compacta encima de las cuatro cifras, solo con la cartera", async () => {
    horizonte.data = simulacionConFrontera();
    await pintar(createElement(PortfolioHorizonPanel, { positions: [{ asset_id: "A", weight_percent: 60 }], variant: "metricas" }));
    expect(host.querySelector("h2")?.textContent).toBe("Rentabilidad y riesgo");
    const titulos = [...host.querySelectorAll("h3")].map((titulo) => titulo.textContent ?? "");
    expect(titulos.indexOf("Frontera eficiente · 3 años")).toBeGreaterThanOrEqual(0);
    expect(titulos.indexOf("Frontera eficiente · 3 años")).toBeLessThan(titulos.findIndex((titulo) => titulo.startsWith("Métricas")));
    expect(marcasDe(0)).toEqual(["Cartera actual"]);
    expect(capturas.frontera[0].height).toBe(220);
  });

  test("Componer, sin frontera que dibujar, no dice nada: las cifras de debajo siguen valiendo", async () => {
    horizonte.data = { ...simulacionConFrontera(), frontier: null };
    await pintar(createElement(PortfolioHorizonPanel, { positions: [{ asset_id: "A", weight_percent: 60 }], variant: "metricas" }));
    expect(host.textContent).not.toContain("Sin frontera eficiente");
    expect(host.textContent).toContain("Métricas");
  });

  test("Análisis → Diversificación: la frontera es el primer bloque", async () => {
    horizonte.data = simulacionConFrontera();
    const posiciones = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
    await pintar(createElement(XrayAdvanced, { positions: posiciones, assets: [activo("A"), activo("B")], seccion: "diversificacion" }));
    const bloques = [...host.querySelectorAll("h2")].map((titulo) => titulo.textContent);
    expect(bloques[0]).toBe("Frontera eficiente");
    expect(bloques).toContain("Matriz de correlación");
  });

  test("Análisis → Diversificación: si la simulación falla, el bloque lo dice sin repetir el «Reintentar» de la página", async () => {
    horizonte.error = "Fallo de la petición";
    await pintar(createElement(XrayAdvanced, { positions: [{ asset_id: "A", weight_percent: 100 }], assets: [activo("A")], seccion: "diversificacion", falloDichoFuera: true }));
    expect(host.querySelector('[data-panel="frontera"]')).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("Frontera eficiente");
    expect(host.textContent).toContain("Sin simulación no hay nada que dibujar.");
    expect([...host.querySelectorAll("button")].some((boton) => boton.textContent === "Reintentar")).toBe(false);
  });
});

/* ------------------------------------------------------------------ Análisis → Exposición */

describe("Análisis → Exposición, «Mayor posición»: vuelven el producto y la clase (D2)", () => {
  test("junto al nombre y el peso, «Fondo · Renta fija», con el punto de la clase", () => {
    const xray = {
      total_positions: 2,
      investable_positions: 2,
      top_position: { asset_id: "A", display_name: "Fondo A", instrument_type: "FUND", economic_asset_class: "FIXED_INCOME", weight_percent: 60 },
      position_concentration: [],
      by_instrument_type: [],
      by_economic_asset_class: [],
      by_currency: [],
      by_region: [],
      by_category: [],
      data_risk_signals: [],
      performance_preview_available: 0,
      coverage_complete_positions: 0,
      data_quality_summary_available: 0,
      pms_exposure_percent: {}
    } as unknown as BdbPortfolioXray;
    const html = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: false, children: createElement(PortfolioXray, { xray }) }));
    const contenedor = document.createElement("div");
    contenedor.innerHTML = html;
    const mayor = [...contenedor.querySelectorAll(".analisis-filas__fila")].find((fila) => fila.querySelector("dt")?.textContent?.startsWith("Mayor posición"))!;
    expect([...mayor.querySelectorAll("dt small")].map((linea) => linea.textContent)).toEqual(["Fondo A", "Fondo · Renta fija"]);
    expect(mayor.querySelector(".clase-con-color__punto")).not.toBeNull();
    expect(plano(mayor.querySelector("dd")?.textContent)).toBe("60,0 %");
  });
});
