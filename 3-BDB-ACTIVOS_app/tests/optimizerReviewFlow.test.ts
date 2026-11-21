// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { FrontierHistoricalState, FrontierPointView, FrontierViewModel } from "../src/types/portfolioFrontier";

const backend = vi.hoisted(() => ({
  fetchHistoricalFrontier: vi.fn(),
  isRealFrontierEnabled: vi.fn(() => true)
}));

vi.mock("../src/adapters/optimizePortfolioBackend", () => backend);

import { OptimizerPanel } from "../src/components/OptimizerPanel";

const positions: BdbManualPortfolioPosition[] = [
  { asset_id: "A", label: "Fondo A", weight_percent: 60 },
  { asset_id: "B", label: "Fondo B", weight_percent: 40 }
];

const assets = positions.map((position) => ({
  asset_id: position.asset_id,
  display_name: position.label,
  instrument_type: "FUND",
  economic_asset_class: "EQUITY",
  currency: "EUR",
  coverage_status: "FULL",
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: [],
  warnings: [],
  metrics: { volatility_3y: 0.11, annualized_return_3y: 0.06 },
  description: "",
  pms_exposure: {}
})) as unknown as BdbAssetDetail[];

function point(a: number, b: number, expectedReturn: number, volatility: number, sharpeRatio: number): FrontierPointView {
  return {
    expectedReturn,
    volatility,
    sharpeRatio,
    expectedReturnLabel: `${(expectedReturn * 100).toFixed(2)} %`,
    volatilityLabel: `${(volatility * 100).toFixed(2)} %`,
    sharpeLabel: sharpeRatio.toFixed(2),
    weights: [
      { assetId: "A", weight: a, weightLabel: `${(a * 100).toFixed(2)} %` },
      { assetId: "B", weight: b, weightLabel: `${(b * 100).toFixed(2)} %` }
    ]
  };
}

function resultState(): FrontierHistoricalState {
  const current = point(0.6, 0.4, 0.06, 0.12, 0.35);
  const maxSharpe = point(0.25, 0.75, 0.085, 0.1, 0.66);
  const minVolatility = point(0.45, 0.55, 0.055, 0.08, 0.44);
  const target = point(0.35, 0.65, 0.072, 0.09, 0.58);
  const model: FrontierViewModel = {
    kind: "historical",
    label: "Frontera histórica",
    asOfDate: "2026-07-18",
    window: "3Y",
    riskFreeRateLabel: "1,93 %",
    riskFreeSource: "ECB_ESTR",
    riskFreeRatePolicy: "WINDOW_AVERAGE",
    coverage: {
      requested: 2,
      included: 2,
      commonObservations: 156,
      firstDate: "2023-07-21",
      lastDate: "2026-07-17"
    },
    insufficientCoverage: false,
    current,
    minVolatility,
    maxSharpe,
    target,
    frontier: [
      { expectedReturn: minVolatility.expectedReturn, volatility: minVolatility.volatility, sharpeRatio: minVolatility.sharpeRatio },
      { expectedReturn: maxSharpe.expectedReturn, volatility: maxSharpe.volatility, sharpeRatio: maxSharpe.sharpeRatio }
    ],
    excluded: [],
    warnings: []
  };
  return { status: "result", model };
}

function findButton(label: string, root: ParentNode = document): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón ${label}`);
  return button;
}

describe("flujo de revisión del optimizador", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    backend.fetchHistoricalFrontier.mockReset();
    backend.fetchHistoricalFrontier.mockResolvedValue(resultState());
    backend.isRealFrontierEnabled.mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  test("calcula, permite cancelar sin mutar y solo aplica tras confirmar", async () => {
    const onApplyWeights = vi.fn();
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights }));
    });

    await act(async () => {
      findButton("Optimizar", container).click();
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());

    const firstDialog = document.querySelector('[role="dialog"]');
    expect(firstDialog?.textContent).toContain("La cartera original no se ha modificado");
    expect(firstDialog?.textContent).toContain("60,0\u00a0%");
    expect(firstDialog?.textContent).toContain("25,0\u00a0%");
    expect(onApplyWeights).not.toHaveBeenCalled();

    await act(async () => findButton("Cancelar", firstDialog ?? document).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onApplyWeights).not.toHaveBeenCalled();

    await act(async () => findButton("Optimizar", container).click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await act(async () => findButton("Aplicar optimización").click());

    expect(onApplyWeights).toHaveBeenCalledTimes(1);
    expect(onApplyWeights.mock.calls[0]?.[0]).toEqual({ A: 0.25, B: 0.75 });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Ola 2 (P6): el aviso post-aplicar ofrece ahora el siguiente paso (informe).
    expect(container.textContent).toContain("Pesos aplicados a la cartera.");
  });

  test("una apertura automática conserva objetivo, riesgo y peso máximo", async () => {
    const onApplyWeights = vi.fn();
    await act(async () => {
      root.render(createElement(OptimizerPanel, {
        assets,
        positions,
        onApplyWeights,
        launch: {
          objective: "TARGET_RISK",
          riskSlider: 7,
          maxWeightPercent: 65,
          lockedWeights: { A: 0.6 },
          autoRun: true
        }
      }));
    });

    await vi.waitFor(() => expect(backend.fetchHistoricalFrontier).toHaveBeenCalledTimes(1));
    expect(backend.fetchHistoricalFrontier.mock.calls[0]?.[0]).toMatchObject({
      objective: "TARGET_RISK",
      riskSlider: 7,
      riskTargetMode: "FRONTIER_PERCENTILE",
      maxWeight: 0.65,
      lockedWeights: { A: 0.6 }
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("35,0\u00a0%");
    expect(onApplyWeights).not.toHaveBeenCalled();
  });

  test.each([
    [{ A: .6 }, 100, "bloqueado"],
    [{}, 65, "máximo"]
  ] as const)("impide aplicar una respuesta que incumple las restricciones %j", async (lockedWeights, maxWeightPercent, message) => {
    const onApplyWeights = vi.fn();
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights, lockedWeights,
        launch: { objective: "MAX_SHARPE", maxWeightPercent } }));
    });
    await act(async () => findButton("Optimizar", container).click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(message);
    const apply = findButton("Aplicar optimización");
    expect(apply.disabled).toBe(true);
    await act(async () => apply.click());
    expect(onApplyWeights).not.toHaveBeenCalled();
  });

  test("bloquea dobles envíos mientras el cálculo está en curso", async () => {
    let resolve: ((state: FrontierHistoricalState) => void) | undefined;
    backend.fetchHistoricalFrontier.mockImplementation(() => new Promise((next) => { resolve = next; }));
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: vi.fn() }));
    });

    await act(async () => findButton("Optimizar", container).click());
    const loadingButton = findButton("Optimizando…", container);
    expect(loadingButton.disabled).toBe(true);
    expect(loadingButton.getAttribute("aria-busy")).toBe("true");

    await act(async () => resolve?.(resultState()));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(backend.fetchHistoricalFrontier).toHaveBeenCalledTimes(1);
  });
});

/* R-01 (auditoría 29-09-2026): el backend admite un tope de activos; con más posiciones la
   propuesta cubre las que entran, y aplicarla ponía a 0 % las demás. Es de 40 con todos los objetivos. */
describe("propuesta recortada por el tope del cálculo", () => {
  const manyPositions: BdbManualPortfolioPosition[] = Array.from({ length: 42 }, (_, i) => ({
    asset_id: `F${i}`, label: `Fondo ${i}`, weight_percent: i < 2 ? 10 : 2
  }));
  const manyAssets = manyPositions.map((position) => ({
    ...(assets[0] as unknown as Record<string, unknown>),
    asset_id: position.asset_id,
    display_name: position.label
  })) as unknown as BdbAssetDetail[];

  function fortyAssetPoint(): FrontierPointView {
    const ids = manyPositions.slice(0, 40).map((p) => p.asset_id);
    return {
      ...point(0, 0, 0.08, 0.1, 0.6),
      weights: ids.map((assetId) => ({ assetId, weight: 0.025, weightLabel: "2,50 %" }))
    };
  }

  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    const base = resultState();
    if (base.status !== "result") throw new Error("estado inesperado");
    const p = fortyAssetPoint();
    backend.fetchHistoricalFrontier.mockReset();
    backend.fetchHistoricalFrontier.mockResolvedValue({
      status: "result",
      model: { ...base.model, current: p, maxSharpe: p, minVolatility: p, target: p, targetReturn: p, coverage: { ...base.model.coverage, requested: 40, included: 40 } }
    });
    backend.isRealFrontierEnabled.mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  test("Aplicar queda deshabilitado y explica cuántas posiciones no cubre", async () => {
    const onApplyWeights = vi.fn();
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets: manyAssets, positions: manyPositions, onApplyWeights,
        launch: { objective: "TARGET_RETURN" } }));
    });
    expect(backend.fetchHistoricalFrontier).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Se optimizan 40 de 42 posiciones");
    expect(container.textContent).toContain("El cálculo admite 40 activos.");

    await act(async () => findButton("Optimizar", container).click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(backend.fetchHistoricalFrontier.mock.calls[0]?.[0].assetIds).toHaveLength(40);

    const alert = document.querySelector('[role="dialog"] [role="alert"]');
    expect(alert?.textContent).toContain("La propuesta no cubre 2 posiciones de la cartera (límite de 40 activos por cálculo)");
    const apply = findButton("Aplicar optimización");
    expect(apply.disabled).toBe(true);
    await act(async () => apply.click());
    expect(onApplyWeights).not.toHaveBeenCalled();
  });

  test("si el receptor rechaza los pesos, el panel muestra el motivo y no dice «aplicados»", async () => {
    const onApplyWeights = vi.fn(() => "El constructor ha rechazado la propuesta.");
    backend.fetchHistoricalFrontier.mockResolvedValue(resultState());
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights }));
    });
    await act(async () => findButton("Optimizar", container).click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await act(async () => findButton("Aplicar optimización").click());
    expect(onApplyWeights).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("El constructor ha rechazado la propuesta.");
    expect(container.textContent).not.toContain("Pesos aplicados a la cartera.");
  });
});
