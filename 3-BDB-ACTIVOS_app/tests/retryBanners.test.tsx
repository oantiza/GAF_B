// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Banners de error con causa y «Reintentar» (auditoría 16-10, MEDIA-12 e
 * IMPORTANTE-1 de la revisión): el error de `usePortfolioHorizon` llega como
 * texto y el banner tiene que enseñar ESA causa, no el genérico; y cada
 * «Reintentar» repite la acción que falló.
 */
const mocks = vi.hoisted(() => ({
  horizon: vi.fn(),
  rebased: vi.fn()
}));

vi.mock("../src/core/usePortfolioHorizon", () => ({ usePortfolioHorizon: mocks.horizon }));
vi.mock("../src/core/useApproximateFrontier", () => ({ useApproximateFrontier: () => ({ result: null }) }));
vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/adapters/priceSeriesBackend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/priceSeriesBackend")>()),
  fetchRebasedSeries: mocks.rebased
}));

import { PortfolioHorizonPanel } from "../src/components/PortfolioHorizonPanel";
import { XrayAdvanced } from "../src/components/XrayAdvanced";
import { AssetComparison } from "../src/components/AssetComparison";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const CAUSE = "El histórico no cubre el periodo completo seleccionado.";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  mocks.horizon.mockReset();
  mocks.rebased.mockReset();
});

async function render(node: ReactElement) {
  await act(async () => root.render(node));
}
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const retryButtons = () => [...container.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Reintentar");

function asset(id: string): BdbAssetDetail {
  return {
    asset_id: id, display_name: `Fondo ${id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    metrics: { annualized_return_1y: 0.05, annualized_return_3y: 0.06, volatility_3y: 0.1, sharpe_3y: 0.6 },
    costs: { ongoing_charge: 0.012 }, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

describe("banners con la causa del error y reintento", () => {
  test("Constructor · Simular: el texto del error es la causa del banner y «Reintentar» repite el cálculo", async () => {
    const retry = vi.fn();
    mocks.horizon.mockReturnValue({ window: "3Y", data: undefined, error: CAUSE, retry });
    await render(createElement(PortfolioHorizonPanel, { positions: [{ asset_id: "A", weight_percent: 100 }] }));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain(CAUSE);
    expect(alerts()[0]).not.toContain("No se pudo completar la operación");
    await act(async () => retryButtons()[0].click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("Constructor · Simular: sin red, el banner se titula «Sin conexión», no «No se ha podido completar» (tercera revisión)", async () => {
    mocks.horizon.mockReturnValue({
      window: "3Y", data: undefined, retry: vi.fn(),
      error: "No hay conexión con el servidor. Comprueba la red y reinténtalo."
    });
    await render(createElement(PortfolioHorizonPanel, { positions: [{ asset_id: "A", weight_percent: 100 }] }));
    expect(alerts()[0]).toContain("Sin conexión con el servidor");
    expect(alerts()[0]).not.toContain("No se ha podido completar");
  });

  /* ANA-05 (13-11-2026): antes el mismo fallo salía dos veces, en la evolución y en la correlación, y esta prueba lo
     exigía. Ahora se dice una sola vez, con su causa, y «Reintentar» sigue repitiendo el análisis. */
  test("Análisis avanzado: el fallo se dice una vez, con su causa, y «Reintentar» repite el análisis", async () => {
    const retry = vi.fn();
    mocks.horizon.mockReturnValue({ window: "3Y", data: undefined, error: CAUSE, retry });
    await render(createElement(XrayAdvanced, {
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      assets: [asset("A"), asset("B")]
    }));
    const withCause = alerts().filter((text) => text.includes(CAUSE));
    expect(withCause).toHaveLength(1);
    expect(retryButtons().length).toBeGreaterThanOrEqual(1);
    for (const button of retryButtons()) await act(async () => button.click());
    expect(retry).toHaveBeenCalledTimes(retryButtons().length);
  });

  test("Comparador de activos: la serie rebasada que falla se vuelve a pedir", async () => {
    mocks.rebased.mockRejectedValueOnce(new Error("Series no disponibles.")).mockReturnValue(new Promise(() => {}));
    await render(createElement(AssetComparison, { assets: [asset("A"), asset("B")], sourceKind: "LOCAL_MOCK", onRemove: () => undefined }));
    expect(alerts().some((text) => text.includes("Series no disponibles."))).toBe(true);
    expect(mocks.rebased).toHaveBeenCalledTimes(1);
    const retry = retryButtons().find((button) => button.closest('[role="alert"]')?.textContent?.includes("Series no disponibles."));
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(mocks.rebased).toHaveBeenCalledTimes(2);
    expect(alerts().some((text) => text.includes("Series no disponibles."))).toBe(false);
    expect(container.textContent).toContain("Cargando series históricas");
  });
});
