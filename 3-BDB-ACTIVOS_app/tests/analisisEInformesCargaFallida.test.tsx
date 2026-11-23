// @vitest-environment happy-dom

/**
 * ANA-08 (auditoría de frontend, 13-11-2026): si falla la carga del informe, Análisis e Informes enseñaban el error y debajo
 * «Calculando el análisis…» o «Preparando los documentos de la cartera…», que ya no iban a terminar; Informes perdía además su cabecera.
 * ANA-31: Análisis pedía el resumen de la cartera solo para comprobar que existía antes de generar el PDF, que no lo usa.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));

const fuente = vi.hoisted(() => ({
  informe: vi.fn(),
  resumen: vi.fn(async () => ({})),
  cliente: vi.fn(async () => undefined)
}));

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    buildManualPortfolioReport: fuente.informe,
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: fuente.resumen,
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => ({})
  })
}));
vi.mock("../src/core/reportPipeline", () => ({
  viabilidadDelInforme: () => ({}),
  useReportLookThrough: () => ({ lookThroughLoad: { data: null, loading: false, error: null }, isLookThroughPending: false })
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: async () => ({}) }));
vi.mock("../src/reports/informeDeClientePdf", () => ({ downloadInformeDeClientePdf: fuente.cliente, rentabilidadPorDividendoDe: () => ({}) }));
vi.mock("../src/components/PortfolioXray", () => ({ PortfolioXray: () => null, ComposicionSubyacente: () => null, MayoresAcciones: () => null }));
vi.mock("../src/components/XrayMetricsStyle", () => ({ XrayMetricsStyle: () => null }));
vi.mock("../src/components/RegionAllocation", () => ({ RegionAllocation: () => null }));
vi.mock("../src/components/XrayAdvanced", () => ({ XrayAdvanced: () => null }));
vi.mock("../src/components/SaludYControl", () => ({ SaludYControl: () => null }));
vi.mock("../src/components/ComposicionDeLaCartera", () => ({ ComposicionDeLaCartera: () => null }));
vi.mock("../src/components/PortfolioDataDiagnostic", () => ({ PortfolioDataDiagnostic: () => null }));
vi.mock("../src/components/PortfolioReportWarnings", () => ({ PortfolioReportWarnings: () => null }));
vi.mock("../src/components/BenchmarkSelect", () => ({ BenchmarkSelect: () => null }));
vi.mock("../src/components/PortfolioReport", () => ({ PortfolioReport: () => null }));

import { XrayPage } from "../src/pages/XrayPage";
import { PortfolioReportPage } from "../src/pages/PortfolioReportPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const POSICIONES = [{ asset_id: "A", weight_percent: 100 }];
const esperar = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const texto = () => host.textContent ?? "";

beforeEach(() => {
  fuente.informe.mockReset();
  fuente.resumen.mockClear();
  fuente.cliente.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("si falla la carga, no se queda en «Calculando…» (ANA-08)", () => {
  test("Análisis: el error, con su «Reintentar», y ningún texto de carga", async () => {
    fuente.informe.mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => root.render(createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined })));
    await esperar();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(texto()).not.toContain("Calculando el análisis");
    expect(texto()).toContain("Reintentar");
  });

  test("Análisis: mientras carga, sí lo dice", async () => {
    fuente.informe.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined })));
    expect(texto()).toContain("Calculando el análisis");
  });

  test("Informes: el error, sin «Preparando…», y con la cabecera de la página", async () => {
    fuente.informe.mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => root.render(createElement(PortfolioReportPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined })));
    await esperar();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(texto()).not.toContain("Preparando los documentos");
    expect(host.querySelector("h1, h2")?.textContent).toContain("Informes");
  });

  test("Informes: mientras carga, la cabecera y el texto de carga", async () => {
    fuente.informe.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(createElement(PortfolioReportPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined })));
    expect(texto()).toContain("Preparando los documentos");
    expect(host.querySelector("h1, h2")?.textContent).toContain("Informes");
  });
});

describe("Análisis no pide el resumen de la cartera, que nadie usa (ANA-31)", () => {
  test("ni al cargar ni al descargar el informe de cliente", async () => {
    /* El total de pesos es el de la cartera de la prueba (A al 100 %): sin cuadrar, el informe de cliente no se genera (INF-1). */
    fuente.informe.mockResolvedValue({ summary: { total_weight_percent: 100 }, xray: {}, positions: [], warnings: [], data_diagnostic: { top_warnings: [] } });
    await act(async () => root.render(createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined })));
    await esperar();
    const abrir = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Informe de la propuesta")!;
    await act(async () => abrir.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const descargar = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Descargar el informe")!;
    await act(async () => descargar.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await esperar();
    expect(fuente.cliente).toHaveBeenCalledTimes(1);
    expect(fuente.resumen).not.toHaveBeenCalled();
  });
});
