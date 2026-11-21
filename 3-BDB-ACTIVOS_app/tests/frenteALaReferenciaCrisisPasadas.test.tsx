// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * ANA-15: las crisis pasadas van en el informe de cliente que se descarga desde Análisis, así que el asesor tiene que poder
 * verlas antes en Análisis. Salen en la pestaña «Frente a la referencia», de la misma simulación que la evolución.
 */
const mocks = vi.hoisted(() => ({ horizonte: vi.fn(), referencia: vi.fn() }));

vi.mock("../src/core/usePortfolioHorizon", () => ({ usePortfolioHorizon: mocks.horizonte }));
vi.mock("../src/core/useSeriesDeReferencia", () => ({ useSeriesDeReferencia: mocks.referencia }));
vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/charts/oaa", () => ({ OaaLineChart: () => null, OaaRiskReturnChart: () => null, OaaCorrelationHeatmap: () => null }));
vi.mock("../src/charts/UnderwaterChart", () => ({ UnderwaterChart: () => null }));
vi.mock("../src/charts/OverlapHeatmap", () => ({ OverlapHeatmap: () => null }));

import { XrayAdvanced } from "../src/components/XrayAdvanced";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const SEMANAS = 60;
const fecha = (semana: number) => new Date(Date.UTC(2024, 0, 5) + semana * 7 * 86400000).toISOString().slice(0, 10);
const serie = Array.from({ length: SEMANAS + 1 }, (_, semana) => ({ date: fecha(semana), value: 100 + semana / 10 }));

const COVID = {
  id: "COVID_2020",
  label: "Crisis COVID-19",
  configured_start_date: "2020-02-19",
  configured_end_date: "2020-03-23",
  start_date: "2020-02-19",
  end_date: "2020-03-23",
  trough_date: "2020-03-23",
  common_data_end_date: "2026-07-10",
  drawdown_pct: -27.4,
  duration_days: 33,
  recovery_date: "2020-08-10",
  recovery_days: 140,
  remaining_to_recover_pct: 0,
  recovery_status: "RECOVERED",
  coverage: { weight_pct: 100, included_assets: 2, total_assets: 2 },
  representative: true,
  included_assets: ["A", "B"],
  worst_asset: null,
  excluded_assets: [],
  reason: null
};

const horizonte = {
  window: "3Y",
  years: 3,
  coverageWeightPercent: 100,
  extensions: [],
  frontier: null,
  backtest: {
    asset_ids: ["A", "B"],
    excluded_assets: [],
    frequency: "WEEKLY",
    coverage: { requested_assets: 2, included_assets: 2, common_observations: SEMANAS + 1, first_date: fecha(0), last_date: fecha(SEMANAS) },
    metrics: { cagr: 0.03, volatility: 0.04, sharpe: 0.06, max_drawdown: -0.1, rf_rate: 0.02 },
    portfolio_series: serie,
    correlation_matrix: [[1, 0.5], [0.5, 1]],
    stress_scenarios: [COVID]
  }
};

const activo = (asset_id: string) => ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND" }) as unknown as BdbAssetDetail;

let contenedor: HTMLDivElement;
let raiz: Root;

async function pintar(seccion: "referencia" | "diversificacion") {
  mocks.horizonte.mockReturnValue({ window: "3Y", data: horizonte, error: undefined, retry: () => undefined });
  mocks.referencia.mockReturnValue({ estado: "lista", series: null, reintentar: () => undefined });
  await act(async () =>
    raiz.render(createElement(XrayAdvanced, {
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      assets: [activo("A"), activo("B")],
      seccion
    }))
  );
}

const titulos = () => [...contenedor.querySelectorAll("h2")].map((h) => h.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  contenedor = document.body.appendChild(document.createElement("div"));
  raiz = createRoot(contenedor);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  contenedor.remove();
  vi.unstubAllGlobals();
  mocks.horizonte.mockReset();
  mocks.referencia.mockReset();
});

describe("Análisis, «Frente a la referencia»: las crisis pasadas (ANA-15)", () => {
  test("pinta el bloque «Crisis pasadas» con el episodio de la simulación", async () => {
    await pintar("referencia");
    expect(titulos()).toContain("Crisis pasadas");
    const tarjeta = contenedor.querySelector('[aria-label="Escenario Crisis COVID-19"]');
    expect(tarjeta).not.toBeNull();
    expect(tarjeta?.textContent ?? "").toContain("\u221227,40\u00a0%");
  });

  test("en «Diversificación» no se repiten", async () => {
    await pintar("diversificacion");
    expect(titulos()).not.toContain("Crisis pasadas");
  });
});
