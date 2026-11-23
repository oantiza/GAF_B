// @vitest-environment happy-dom

/**
 * Decisión B-78 en Análisis: una posición con la serie parada lleva un aviso bajo «Rentabilidad y riesgo», con su fecha. Es del asesor: en
 * Modo cliente no sale, ni se pide. Y el informe de cliente que sale de aquí recibe las mismas posiciones, para decirlo con sus palabras.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const doble = vi.hoisted(() => ({
  cliente: vi.fn(),
  usar: vi.fn((_ids: readonly string[], activo = true) => (activo ? new Map([["LU1882457739", "2025-11-28"]]) : new Map())),
  paradas: vi.fn(async () => new Map([["LU1882457739", "2025-11-28"]]))
}));

vi.mock("../src/adapters/finDeLaSerie", () => ({ useSeriesParadas: doble.usar, seriesParadas: doble.paradas }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    /* El total es el de la cartera de la prueba, una posición al 100 %: sin cuadrar, el informe de cliente no se genera (INF-1). */
    buildManualPortfolioReport: async () => ({ summary: { total_weight_percent: 100 }, xray: {}, positions: [], warnings: [], data_diagnostic: { top_warnings: [] } }),
    getComparableAssets: async () => [{ asset_id: "LU1882457739", display_name: "Amundi Funds Global Equity C", instrument_type: "FUND", metrics: {}, costs: {}, quality_flags: [], warnings: [] }],
    buildManualPortfolioSummary: async () => ({}),
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => ({})
  })
}));
vi.mock("../src/core/reportPipeline", () => ({
  viabilidadDelInforme: () => ({}),
  useReportLookThrough: () => ({ lookThroughLoad: { data: null, loading: false, error: null }, isLookThroughPending: false })
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: async () => ({}) }));
vi.mock("../src/reports/informeDeClientePdf", () => ({ downloadInformeDeClientePdf: doble.cliente, rentabilidadPorDividendoDe: () => ({}) }));
vi.mock("../src/components/PortfolioXray", () => ({ PortfolioXray: () => null, ComposicionSubyacente: () => null, MayoresAcciones: () => null }));
vi.mock("../src/components/XrayMetricsStyle", () => ({ XrayMetricsStyle: () => null }));
vi.mock("../src/components/RegionAllocation", () => ({ RegionAllocation: () => null }));
vi.mock("../src/components/XrayAdvanced", () => ({ XrayAdvanced: () => null }));
vi.mock("../src/components/SaludYControl", () => ({ SaludYControl: () => null }));
vi.mock("../src/components/ComposicionDeLaCartera", () => ({ ComposicionDeLaCartera: () => null }));
vi.mock("../src/components/PortfolioDataDiagnostic", () => ({ PortfolioDataDiagnostic: () => null }));
vi.mock("../src/components/PortfolioReportWarnings", () => ({ PortfolioReportWarnings: () => null }));
vi.mock("../src/components/BenchmarkSelect", () => ({ BenchmarkSelect: () => null }));

import { XrayPage } from "../src/pages/XrayPage";
import { ClientModeProvider } from "../src/app/ClientModeContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AVISO = "Amundi Funds Global Equity C · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores.";

let host: HTMLDivElement;
let root: Root;

async function montar(modoCliente: boolean) {
  await act(async () => {
    root.render(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(XrayPage, {
          positions: [{ asset_id: "LU1882457739", weight_percent: 100 }],
          sourceKind: "LOCAL_MOCK",
          portfolioName: "Cartera de prueba",
          onBack: () => undefined
        })
      })
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function pulsar(texto: string) {
  const boton = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(texto));
  if (!boton) throw new Error(`No aparece el botón «${texto}»`);
  return act(async () => {
    boton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Análisis · serie parada (decisión B-78)", () => {
  test("el asesor ve el aviso, con el nombre y la fecha, en la pestaña «Datos», con la pieza Aviso", async () => {
    await montar(false);
    /* Rediseño (14-11-2026): los avisos del asesor viven en la pestaña «Datos», que solo existe fuera del Modo cliente. */
    await pulsar("Datos");
    const aviso = [...host.querySelectorAll(".aviso")].find((nodo) => nodo.textContent?.includes("Serie parada"));
    expect(aviso?.querySelector(".aviso__texto")?.textContent).toBe(`Aviso. ${AVISO}`);
    window.history.replaceState(null, "", "/");
  });

  test("en Modo cliente no sale, ni se pide", async () => {
    await montar(true);
    expect(host.textContent).not.toContain("Serie parada");
    expect(doble.usar).toHaveBeenCalled();
    expect(doble.usar.mock.calls.every(([, activo]) => activo === false)).toBe(true);
  });

  test("el informe de cliente de aquí recibe las mismas posiciones paradas", async () => {
    await montar(true);
    await pulsar("Informe de la propuesta");
    await pulsar("Descargar el informe");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(doble.paradas).toHaveBeenCalledWith(["LU1882457739"], expect.any(String));
    expect(doble.cliente).toHaveBeenCalledWith(expect.objectContaining({ seriesParadas: new Map([["LU1882457739", "2025-11-28"]]) }));
  });
});
