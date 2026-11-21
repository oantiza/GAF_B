// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Análisis: las cifras de la respuesta vuelven a decir su periodo y, si salen de un histórico ampliado con referencias, que son una
 * estimación; y «En qué está invertida» pinta cada clase en su color fijo (14-11-2026, Óscar: recuperar el color y los datos de antes
 * del rediseño). El montaje es el de `analisisRediseno.test.tsx`; la serie y sus cifras, las de allí.
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
import { colorDeLaClase } from "../src/core/coloresDeClase";
import { setAnalysisWindow } from "../src/core/analysisPreferences";

const fecha = (semana: number) => new Date(Date.UTC(2023, 9, 20) + semana * 7 * 86400000).toISOString().slice(0, 10);
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

beforeEach(() => {
  window.history.replaceState(null, "", "/analisis");
  doble.informe.mockResolvedValue({
    summary: {},
    xray: { by_economic_asset_class: [{ key: "FIXED_INCOME", weight_percent: 55 }, { key: "EQUITY", weight_percent: 45 }] },
    positions: [],
    warnings: [],
    data_diagnostic: { top_warnings: [] }
  });
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

const AMPLIADA = [{ assetId: "B", reference: "Referencia EUR", estimatedFrom: fecha(0), estimatedUntil: fecha(60) }];

describe("cada cifra de la serie dice su periodo (D3)", () => {
  test("a 3 años, «· 3 años» en las cuatro; el coste, que es de hoy, sin periodo", async () => {
    await montar();
    expect(datosDeLaRespuesta().map((dato) => dato.rotulo)).toEqual([
      "Rentabilidad anualizada · 3 años",
      "Volatilidad · 3 años",
      "Ratio de Sharpe · 3 años",
      "Caída máxima · 3 años",
      "Coste corriente de la cartera"
    ]);
  });

  test("a 5 años, «· 5 años», también mientras se mide", async () => {
    setAnalysisWindow("5Y");
    doble.simular.mockReturnValue(new Promise(() => undefined));
    try {
      await montar();
      expect(datosDeLaRespuesta().slice(0, 4).map((dato) => dato.rotulo)).toEqual([
        "Rentabilidad anualizada · 5 años",
        "Volatilidad · 5 años",
        "Ratio de Sharpe · 5 años",
        "Caída máxima · 5 años"
      ]);
    } finally {
      setAnalysisWindow("3Y");
    }
  });
});

describe("una estimación no se presenta como un hecho (D3, G16)", () => {
  test("con el histórico ampliado, «Estimado» en ocre delante de la procedencia", async () => {
    doble.simular.mockResolvedValue({ ...horizonte, extensions: AMPLIADA });
    await montar();
    const marca = host.querySelector(".analisis-metodo .distintivo");
    expect(marca?.textContent).toBe("Estimado");
    expect(marca?.classList.contains("distintivo--aviso")).toBe(true);
    expect(plano(host.querySelector(".analisis-metodo")?.textContent)).toContain("ampliada con referencias");
  });

  test("con precios observados, sin marca", async () => {
    await montar();
    expect(host.querySelector(".analisis-metodo .distintivo")).toBeNull();
  });

  test("sin cifras de la cartera no hay nada que marcar", async () => {
    doble.simular.mockResolvedValue({ ...horizonte, extensions: AMPLIADA, coverageWeightPercent: 40 });
    await montar();
    expect(host.querySelector(".analisis-metodo .distintivo")).toBeNull();
  });
});

describe("«En qué está invertida»: cada clase en su color (7a)", () => {
  test("el color de su clase, no el de su puesto", async () => {
    await montar();
    const partes = [...host.querySelectorAll<HTMLElement>(".partes__parte")];
    expect(partes.map((parte) => plano(parte.querySelector(".partes__nombre")?.textContent))).toEqual(["Renta fija", "Renta variable"]);
    expect(partes.map((parte) => parte.style.getPropertyValue("--parte-color"))).toEqual([colorDeLaClase("FIXED_INCOME"), colorDeLaClase("EQUITY")]);
  });
});
