// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Análisis rediseñado (14-11-2026, «Informe vivo»): primero la respuesta —cinco cifras del periodo elegido— y el detalle en seis
 * pestañas, con la pestaña en la dirección. Las cifras esperadas salen a mano de la serie y de los datos de abajo, no de la pantalla:
 *
 * - La simulación declara rentabilidad anualizada 0,119, volatilidad 0,078, Sharpe 1,18, caída máxima −0,114 y tipo sin riesgo 0,026.
 * - La serie sube de 100 a 120 en la semana 10, cae a 106,32 en la semana 20 (106,32 / 120 − 1 = −11,40 %, la misma caída) y acaba
 *   en 140: el tramo de la caída va de la semana 10 a la 20.
 * - El coste corriente: A pesa el 60 % con un 0,20 % y B el 40 % con un 1,39 %: 0,6 × 0,002 + 0,4 × 0,0139 = 0,00676 → «0,68 %»;
 *   sobre 100.000 €, 676 € al año.
 */
const doble = vi.hoisted(() => ({
  informe: vi.fn(),
  simular: vi.fn()
}));

vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    buildManualPortfolioReport: doble.informe,
    getComparableAssets: async () => [
      { asset_id: "A", display_name: "Fondo A", instrument_type: "FUND", economic_asset_class: "EQUITY", metrics: {}, costs: { ongoing_charge: 0.002 }, quality_flags: [], warnings: [] },
      { asset_id: "B", display_name: "Fondo B", instrument_type: "FUND", economic_asset_class: "FIXED_INCOME", metrics: {}, costs: { ongoing_charge: 0.0139 }, quality_flags: [], warnings: [] }
    ],
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => new Map()
  })
}));
vi.mock("../src/core/reportPipeline", () => ({
  viabilidadDelInforme: () => ({}),
  useReportLookThrough: () => ({ lookThroughLoad: { data: null, loading: false, error: null }, isLookThroughPending: false })
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: doble.simular }));
vi.mock("../src/core/useSeriesDeReferencia", () => ({ useSeriesDeReferencia: () => ({ estado: "no-disponible", series: null, reintentar: () => undefined }) }));
// Los bloques de cada pestaña tienen sus pruebas; aquí, testigos con su nombre, para saber qué pestaña los monta.
vi.mock("../src/components/PortfolioXray", () => ({
  PortfolioXray: () => createElement("p", null, "testigo: estructura"),
  ComposicionSubyacente: () => createElement("p", null, "testigo: composición subyacente"),
  MayoresAcciones: () => createElement("p", null, "testigo: mayores acciones")
}));
vi.mock("../src/components/XrayMetricsStyle", () => ({ XrayMetricsStyle: () => createElement("p", null, "testigo: estilo") }));
vi.mock("../src/components/RegionAllocation", () => ({ RegionAllocation: () => createElement("p", null, "testigo: geografía") }));
vi.mock("../src/components/XrayAdvanced", () => ({
  XrayAdvanced: ({ seccion }: { seccion?: string }) => createElement("p", null, `testigo: analítica ${seccion}`)
}));
vi.mock("../src/components/SaludYControl", () => ({ SaludYControl: () => createElement("p", null, "testigo: qué conviene mirar") }));
vi.mock("../src/components/ComposicionDeLaCartera", () => ({ ComposicionDeLaCartera: () => createElement("p", null, "testigo: posiciones") }));
vi.mock("../src/components/PortfolioDataDiagnostic", () => ({ PortfolioDataDiagnostic: () => createElement("p", null, "testigo: diagnóstico") }));
vi.mock("../src/components/PortfolioReportWarnings", () => ({ PortfolioReportWarnings: () => createElement("p", null, "testigo: avisos") }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { XrayPage } from "../src/pages/XrayPage";
import { saltosDeNivel } from "./support/saltosDeNivel";

const fecha = (semana: number) => new Date(Date.UTC(2023, 9, 20) + semana * 7 * 86400000).toISOString().slice(0, 10);
const enBarras = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const valorEn = (semana: number) => (semana <= 10 ? 100 + 2 * semana : semana <= 20 ? 120 - ((120 - 106.32) * (semana - 10)) / 10 : 106.32 + ((140 - 106.32) * (semana - 20)) / 136);
const SEMANAS = 156;

const horizonte = {
  window: "3Y",
  years: 3,
  referenceVersion: "series-observadas.v1",
  coverageWeightPercent: 100,
  extensions: [],
  frontier: null,
  backtest: {
    asset_ids: ["A", "B"],
    excluded_assets: [],
    warnings: [],
    frequency: "WEEKLY",
    window: "3Y",
    coverage: { requested_assets: 2, included_assets: 2, common_observations: SEMANAS + 1, first_date: fecha(0), last_date: fecha(SEMANAS) },
    metrics: { cagr: 0.119, volatility: 0.078, sharpe: 1.18, max_drawdown: -0.114, rf_rate: 0.026 },
    portfolio_series: Array.from({ length: SEMANAS + 1 }, (_, semana) => ({ date: fecha(semana), value: valorEn(semana) })),
    correlation_matrix: [[1, 0.2], [0.2, 1]],
    stress_scenarios: []
  }
};

const POSICIONES = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function montar({ modoCliente = false, posiciones = POSICIONES } = {}) {
  await act(async () => {
    root.render(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(XrayPage, {
          positions: posiciones,
          sourceKind: "LOCAL_MOCK",
          totalCapital: 100000,
          portfolioName: "Familia García",
          onBack: () => undefined
        })
      })
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const plano = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const datosDeLaRespuesta = () =>
  [...host.querySelectorAll(".respuesta__dato")].map((dato) => ({
    rotulo: plano(dato.querySelector(".respuesta__rotulo")?.textContent),
    cifra: plano(dato.querySelector(".respuesta__cifra")?.textContent),
    apunte: plano(dato.querySelector(".respuesta__apunte")?.textContent)
  }));
const pestanas = () => [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const pulsarPestana = (nombre: string) =>
  act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === nombre) as HTMLButtonElement).click());

beforeEach(() => {
  window.history.replaceState(null, "", "/analisis");
  doble.informe.mockResolvedValue({ summary: {}, xray: {}, positions: [], warnings: [], data_diagnostic: { top_warnings: [] } });
  doble.simular.mockResolvedValue(horizonte);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("la cabecera", () => {
  test("dice de qué propuesta es, con sus posiciones y su capital, y tiene una sola acción principal", async () => {
    await montar();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("Análisis");
    expect(plano(host.querySelector(".ui-eyebrow")?.textContent)).toBe("Propuesta · Familia García · 2 posiciones · 100.000 €");
    expect(host.querySelectorAll(".ui-page-header .ui-button--primary").length).toBe(1);
    expect(host.querySelector('[aria-label="Periodo"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Cartera de referencia"]')).not.toBeNull();
  });
});

describe("la respuesta: cinco cifras del periodo elegido", () => {
  test("las mismas cifras que la simulación y el informe de costes, con el formato del sistema", async () => {
    await montar();
    /* Desde el 14-11-2026 (Óscar: recuperar los datos de antes del rediseño) cada cifra de la serie vuelve a decir su periodo en el
       rótulo; el coste corriente es de hoy y no lo lleva. */
    expect(datosDeLaRespuesta()).toEqual([
      { rotulo: "Rentabilidad anualizada · 3 años", cifra: "+11,90 %", apunte: "" },
      { rotulo: "Volatilidad · 3 años", cifra: "7,80 %", apunte: "" },
      { rotulo: "Ratio de Sharpe · 3 años", cifra: "1,18", apunte: "tipo sin riesgo, 2,60 %" },
      { rotulo: "Caída máxima · 3 años", cifra: "−11,40 %", apunte: `del ${enBarras(fecha(10))} al ${enBarras(fecha(20))}` },
      { rotulo: "Coste corriente de la cartera", cifra: "0,68 %", apunte: "676 € al año sobre 100.000 €" }
    ]);
  });

  test("solo la rentabilidad lleva color de signo; la volatilidad, la caída y el coste, en tinta", async () => {
    await montar();
    const cifras = [...host.querySelectorAll(".respuesta__cifra")];
    expect(cifras[0].querySelector(".cifra--sube")).not.toBeNull();
    for (const indice of [1, 2, 3, 4]) expect(cifras[indice].querySelector(".cifra--sube, .cifra--baja")).toBeNull();
  });

  test("bajo la banda, qué simulación es: pesos de hoy, sin reequilibrar y qué parte del peso mide", async () => {
    await montar();
    const metodo = plano(host.querySelector(".analisis-metodo")?.textContent);
    expect(metodo).toContain("Simulación con los pesos de hoy");
    expect(metodo).toContain("100,0 % del peso");
    expect(metodo).toContain("sin reequilibrar");
    /* Cada cosa, una vez: con la nota entera detrás de la procedencia se leía dos veces qué simulación es y cuánto mide. */
    expect(metodo.match(/pesos de hoy/g)).toHaveLength(1);
    expect(metodo).not.toContain("Peso medido:");
    expect(metodo).toContain("No constituyen recomendación personalizada ni evalúan idoneidad.");
  });

  test("mientras se mide, «Midiendo…» y no una cifra que luego cambie", async () => {
    doble.simular.mockReturnValue(new Promise(() => undefined));
    await montar();
    const cifras = datosDeLaRespuesta().map((dato) => dato.cifra);
    expect(cifras.slice(0, 4)).toEqual(["Midiendo…", "Midiendo…", "Midiendo…", "Midiendo…"]);
    /* El coste no depende de la simulación: ya está. */
    expect(cifras[4]).toBe("0,68 %");
  });

  test("si la cartera no se puede medir, cada casilla dice que falta el dato y un aviso dice por qué", async () => {
    doble.simular.mockResolvedValue({ ...horizonte, coverageWeightPercent: 40 });
    await montar();
    expect(datosDeLaRespuesta().slice(0, 4).map((dato) => dato.cifra)).toEqual(["Falta el dato", "Falta el dato", "Falta el dato", "Falta el dato"]);
    expect(plano(host.querySelector(".analisis-respuesta .aviso")?.textContent)).toContain("La simulación mide el 40,0 % del peso");
  });
});

describe("las pestañas", () => {
  test("seis preguntas para el asesor; «Datos» no existe en Modo cliente", async () => {
    await montar();
    expect(pestanas()).toEqual(["Resumen", "Exposición", "Dentro de los fondos", "Frente a la referencia", "Diversificación", "Datos"]);
    act(() => root.unmount());
    root = createRoot(host);
    await montar({ modoCliente: true });
    expect(pestanas()).toEqual(["Resumen", "Exposición", "Dentro de los fondos", "Frente a la referencia", "Diversificación"]);
    expect(host.textContent).not.toContain("testigo: diagnóstico");
  });

  test("cada pestaña monta sus bloques", async () => {
    await montar();
    const panel = () => plano(host.querySelector('[role="tabpanel"]')?.textContent);
    expect(panel()).toContain("testigo: analítica resumen");
    expect(panel()).toContain("testigo: qué conviene mirar");
    expect(panel()).toContain("testigo: posiciones");
    expect(panel()).toContain("En qué está invertida");
    await pulsarPestana("Exposición");
    expect(panel()).toContain("testigo: geografía");
    expect(panel()).toContain("testigo: estructura");
    await pulsarPestana("Dentro de los fondos");
    expect(panel()).toContain("testigo: estilo");
    expect(panel()).toContain("testigo: mayores acciones");
    expect(panel()).toContain("testigo: composición subyacente");
    await pulsarPestana("Frente a la referencia");
    expect(panel()).toBe("testigo: analítica referencia");
    await pulsarPestana("Diversificación");
    expect(panel()).toBe("testigo: analítica diversificacion");
    await pulsarPestana("Datos");
    expect(panel()).toContain("testigo: diagnóstico");
    expect(panel()).toContain("testigo: avisos");
  });

  test("la pestaña elegida va en la dirección y se recupera al volver a cargar", async () => {
    await montar();
    await pulsarPestana("Exposición");
    expect(window.location.hash).toBe("#pestana=exposicion");
    act(() => root.unmount());
    root = createRoot(host);
    await montar();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Exposición");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("analisis-tab-exposicion");
  });

  /* 20-11-2026: una posición sin divisa declarada salía como una fila «N/D», que el sistema no deja en pantalla. La clave
     sigue siendo esa en el dato (`CLAVE_SIN_DATO_DEL_REPARTO`): es la pantalla la que la dice con la pieza, y la deja la última. */
  test("en Exposición, las posiciones sin divisa declarada dicen «Falta el dato», y no «N/D»", async () => {
    doble.informe.mockResolvedValue({
      summary: {},
      xray: { by_currency: [{ key: "EUR", weight_percent: 50 }, { key: "N/D", weight_percent: 30 }, { key: "USD", weight_percent: 20 }] },
      positions: [],
      warnings: [],
      data_diagnostic: { top_warnings: [] }
    });
    for (const modoCliente of [false, true]) {
      await montar({ modoCliente });
      await pulsarPestana("Exposición");
      const titulo = [...host.querySelectorAll("h2")].find((h) => h.textContent === "Divisa de la clase");
      const bloque = titulo?.closest(".panel");
      expect(bloque, `el bloque, modo cliente ${modoCliente}`).toBeTruthy();
      expect([...bloque!.querySelectorAll(".xray-dist-rows li")].map((fila) => plano(fila.textContent))).toEqual(["EUR50,0 %", "USD20,0 %", "Falta el dato30,0 %"]);
      expect(bloque!.querySelector("li:last-child .ausencia.ausencia--falta")?.textContent).toBe("Falta el dato");
      expect(plano(host.querySelector('[role="tabpanel"]')?.textContent)).not.toContain("N/D");
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  test("en Modo cliente, una dirección con «Datos» abre el Resumen", async () => {
    window.history.replaceState(null, "", "/analisis#pestana=datos");
    await montar({ modoCliente: true });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Resumen");
    expect(host.textContent).not.toContain("testigo: diagnóstico");
  });

  /* MAR-32: `h1` la pantalla, `h2` cada bloque, `h3` lo que va dentro; en ninguna pestaña se salta un nivel. Los bloques
     que aquí son testigos tienen su propia prueba de marcado. */
  test("en ninguna pestaña se salta un nivel de encabezado (MAR-32)", async () => {
    await montar();
    for (const pestana of ["Resumen", "Exposición", "Dentro de los fondos", "Frente a la referencia", "Diversificación", "Datos"]) {
      await pulsarPestana(pestana);
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent, pestana).toBe(pestana);
      expect(saltosDeNivel(host), pestana).toEqual([]);
    }
    act(() => root.unmount());
    root = createRoot(host);
    await montar({ posiciones: [] });
    expect(saltosDeNivel(host), "sin posiciones").toEqual([]);
  });

  test("el teclado mueve entre pestañas con las flechas", async () => {
    await montar();
    const primera = host.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () => primera.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Exposición");
  });
});

describe("los estados", () => {
  test("sin posiciones, un estado vacío que dice qué hacer, sin banda ni pestañas", async () => {
    await montar({ posiciones: [] });
    expect(host.querySelector("h2")?.textContent).toBe("Aún no hay propuesta que analizar");
    expect([...host.querySelectorAll("button")].some((boton) => boton.textContent === "Ir al Buscador")).toBe(true);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector(".respuesta")).toBeNull();
  });

  test("mientras carga, el esqueleto y el aviso de que calcula", async () => {
    doble.informe.mockReturnValue(new Promise(() => undefined));
    await montar();
    expect(host.textContent).toContain("Calculando el análisis…");
    expect(host.querySelector(".esqueleto")).not.toBeNull();
  });
});
