// @vitest-environment happy-dom

/**
 * A-135 (10-11-2026): el panel de antes de repartir pesos ya no pide la frontera histórica al servidor.
 *
 * Ese panel solo sale sin pesos, con la histórica dada desde fuera o donde no está habilitada: con pesos manda el otro,
 * que la mide con la simulación. Así que la única petición que hacía era sin pesos. El servidor la calculaba sin el punto
 * de la cartera —a propósito: sin pesos no hay cartera que situar—, el sitio rechazaba la respuesta y enseñaba la
 * estimada. Cada cambio en la composición lanzaba otro cálculo, para nada. Lo que se ve no cambia: la estimada, con el
 * pie «asigna pesos a la cartera para calcular la histórica» (A-131).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const servidor = vi.hoisted(() => ({ fetchHistoricalFrontier: vi.fn(), habilitada: true }));
vi.mock("../src/adapters/optimizePortfolioBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/optimizePortfolioBackend")>()),
  isRealFrontierEnabled: () => servidor.habilitada,
  fetchHistoricalFrontier: servidor.fetchHistoricalFrontier
}));

import { FrontierPanel } from "../src/components/FrontierPanel";
import { approximateFrontierReason, HISTORICA_SIN_PESOS, MOTIVO_SIN_PESOS } from "../src/core/frontierPresentation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function activo(id: string, rentabilidad: number, volatilidad: number, clase = "EQUITY"): BdbAssetDetail {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: clase, currency: "EUR", coverage_status: "FULL",
    is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [],
    metrics: { annualized_return_3y: rentabilidad, volatility_3y: volatilidad, metrics_frequency: "WEEKLY" }
  } as unknown as BdbAssetDetail;
}
const DOS = [activo("A", 0.08, 0.12), activo("B", 0.05, 0.16, "FIXED_INCOME")];
const TRES = [...DOS, activo("C", 0.06, 0.1)];
const aCero = (activos: BdbAssetDetail[]) => activos.map((a) => ({ asset_id: a.asset_id, weight_percent: 0 }));
const PIE_SIN_PESOS = "Frontera estimada por composición · asigna pesos a la cartera para calcular la histórica";

describe("el estado que va en lugar de la petición", () => {
  test("dice que faltan los pesos, en el pie y en la frase", () => {
    expect(HISTORICA_SIN_PESOS).toEqual({ status: "error", message: "Asigna pesos a la cartera para calcular la frontera histórica." });
    expect(approximateFrontierReason(HISTORICA_SIN_PESOS, false)).toBe(MOTIVO_SIN_PESOS);
  });
});

describe("el panel de antes de repartir pesos, montado de verdad", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    servidor.habilitada = true;
    servidor.fetchHistoricalFrontier.mockReset();
    servidor.fetchHistoricalFrontier.mockReturnValue(new Promise(() => undefined));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  /** Monta el panel y deja pasar de sobra el retardo con que antes agrupaba las peticiones (300 ms). */
  const monta = (activos: BdbAssetDetail[]) => {
    act(() => root.render(createElement(FrontierPanel, { assets: activos, positions: aCero(activos), compact: true })));
    act(() => { vi.advanceTimersByTime(2000); });
  };

  test("sin ningún peso no llama al servidor: ni al montar ni al cambiar la composición", () => {
    monta(DOS);
    expect(servidor.fetchHistoricalFrontier).not.toHaveBeenCalled();
    monta(TRES);
    expect(servidor.fetchHistoricalFrontier).not.toHaveBeenCalled();
    expect(host.textContent).toContain(PIE_SIN_PESOS);
    expect(host.textContent).not.toContain("calculando la histórica");
  });

  test("donde la histórica no está habilitada tampoco llama, y el pie no manda repartir pesos", () => {
    servidor.habilitada = false;
    monta(DOS);
    expect(servidor.fetchHistoricalFrontier).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("asigna pesos");
  });
});

describe("lo que se ve no cambia", () => {
  test("en Diseño, sin pesos: la estimada con su pie, sin el nombre de ningún campo y sin «calculando»", () => {
    servidor.habilitada = true;
    const html = renderToStaticMarkup(createElement(FrontierPanel, { assets: DOS, positions: aCero(DOS), compact: true }));
    expect(html).toContain(PIE_SIN_PESOS);
    expect(html).not.toContain("current_portfolio");
    expect(html).not.toContain("calculando la histórica");
  });

  test("en Análisis, sin pesos: la frase entera en el estado de la histórica", () => {
    servidor.habilitada = true;
    const html = renderToStaticMarkup(createElement(FrontierPanel, { assets: DOS, positions: aCero(DOS) }));
    expect(html).toContain("Asigna pesos a la cartera para calcular la frontera histórica.");
  });

  test("con la histórica dada desde fuera, manda esa", () => {
    servidor.habilitada = true;
    const html = renderToStaticMarkup(createElement(FrontierPanel, {
      assets: DOS, positions: aCero(DOS), compact: true, historical: { status: "error", message: "Sin series comunes" }
    }));
    expect(html).toContain("Frontera estimada por composición · Sin series comunes");
    expect(html).not.toContain("asigna pesos");
  });
});
