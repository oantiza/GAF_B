// @vitest-environment happy-dom

/**
 * DIS-01 (auditoría de frontend, 13-11-2026): al aplicar una optimización, una posición con «Importe fijo»
 * (`keepEuros`) cambiaba de peso pero conservaba su importe de referencia antiguo (`targetEuros`). El siguiente
 * cambio de capital la recolocaba en `targetEuros / capital`, es decir, en su peso de antes de optimizar.
 * Ahora, al aplicar, su importe de referencia pasa a ser el del peso aplicado.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { PortfolioAmountUpdate } from "../src/core/portfolioAmounts";

type ApplyWeights = (weights: Record<string, number>) => string | null | void;
const captured = vi.hoisted(() => ({ onApplyWeights: null as ApplyWeights | null }));

vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/components/OptimizerPanel", () => ({
  OptimizerPanel: (props: { onApplyWeights?: ApplyWeights }) => {
    captured.onApplyWeights = props.onApplyWeights ?? null;
    return null;
  }
}));

import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

/** Cáscara como la página: posiciones y capital son suyos. */
function Shell({ initial, initialCapital }: { initial: BdbManualPortfolioPosition[]; initialCapital: number }) {
  const [positions, setPositions] = useState(initial);
  const [capital, setCapital] = useState(initialCapital);
  return createElement("div", null,
    createElement("output", { id: "estado" }, JSON.stringify({ capital, positions })),
    createElement(PortfolioBuilder, {
      assets: [],
      positions,
      summary: null,
      optimizationPreview: null,
      localOptimizationPreview: null,
      importResult: null,
      riskProfilePreview: null,
      riskProfiles: RISK_PROFILE_CONTRACTS,
      selectedRiskProfileId: "RISK_5",
      portfolioNotice: null,
      initialCapital: capital,
      onCapitalChange: setCapital,
      onRemove: () => undefined,
      onOpenReport: () => undefined,
      onReset: () => undefined,
      onImportText: async () => undefined,
      onSaveLocalPortfolio: () => undefined,
      onRiskProfileChange: () => undefined,
      onWeightChange: (assetId: string, weight: number) =>
        setPositions((current) => current.map((p) => (p.asset_id === assetId ? { ...p, weight_percent: weight } : p))),
      onPositionPatch: (assetId: string, patch: Pick<BdbManualPortfolioPosition, "keepEuros" | "targetEuros">) =>
        setPositions((current) => current.map((p) => (p.asset_id === assetId ? { ...p, ...patch } : p))),
      onAmountsChange: (update: PortfolioAmountUpdate) => {
        setPositions(update.positions);
        setCapital(update.totalCapital);
      },
      onFindAlternatives: async () => [],
      onSwap: () => undefined,
      savedPortfolios: [],
      initialPanel: "optimization"
    } as never)
  );
}

function state(): { capital: number; positions: BdbManualPortfolioPosition[] } {
  return JSON.parse(host!.querySelector("#estado")!.textContent!);
}
const position = (id: string) => state().positions.find((p) => p.asset_id === id)!;

async function commitEuroField(label: string, value: string) {
  const input = host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}

describe("Diseño · una posición de importe fijo tras aplicar pesos nuevos", () => {
  test("optimizar y después cambiar el capital conserva lo aplicado, no el importe de antes", async () => {
    captured.onApplyWeights = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(Shell, {
        initial: [
          { asset_id: "A", weight_percent: 20, keepEuros: true, targetEuros: 20000 },
          { asset_id: "B", weight_percent: 50 },
          { asset_id: "C", weight_percent: 30 }
        ],
        initialCapital: 100000
      }));
    });
    if (!captured.onApplyWeights) throw new Error("El constructor no ha montado el optimizador");
    const apply = captured.onApplyWeights;

    let motivo: string | null | void = undefined;
    await act(async () => { motivo = apply({ A: 0.05, B: 0.6, C: 0.35 }); });
    expect(motivo).toBeNull();
    // A pasa al 5 % de 100.000 € = 5.000 €: su importe fijo es ahora ese, no los 20.000 € de antes.
    expect(position("A")).toMatchObject({ weight_percent: 5, keepEuros: true, targetEuros: 5000 });

    // El capital se edita en Componer.
    const pestana = host.querySelector<HTMLElement>("#builder-step-tab-compose");
    if (!pestana) throw new Error("Falta la pestaña de Componer");
    await act(async () => { pestana.click(); });
    await commitEuroField("Capital total en euros", "110.000");

    /* Cuenta a mano. A conserva sus 5.000 €: 5.000 / 110.000 = 4,5454… %. Antes del arreglo volvía a
       20.000 / 110.000 = 18,18 %. B y C absorben el resto en su proporción 60 : 35:
       hueco = 95 + 5 − 4,5454… = 95,4545… %; B = 95,4545 × 60/95 = 60,2871 %; C = 95,4545 × 35/95 = 35,1675 %. */
    expect(state().capital).toBe(110000);
    expect(position("A").weight_percent).toBeCloseTo(4.5455, 3);
    expect((position("A").weight_percent / 100) * 110000).toBeCloseTo(5000, 6);
    expect(position("B").weight_percent).toBeCloseTo(60.2871, 3);
    expect(position("C").weight_percent).toBeCloseTo(35.1675, 3);
  });
});
