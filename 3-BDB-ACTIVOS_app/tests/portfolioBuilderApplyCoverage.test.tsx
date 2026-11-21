// @vitest-environment happy-dom

/**
 * R-01 (auditoría 29-09-2026): «Aplicar» la propuesta del optimizador ponía a 0 % las
 * posiciones que el tope del objetivo dejó fuera del cálculo. El panel ya bloquea el
 * botón; esto es la defensa en profundidad del constructor: si la propuesta no menciona
 * una posición con peso y sin candado, no se toca ningún peso y se devuelve el motivo.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

type ApplyWeights = (weights: Record<string, number>) => string | null | void;
const captured = vi.hoisted(() => ({ onApplyWeights: null as ApplyWeights | null }));

vi.mock("../src/components/OptimizerPanel", () => ({
  OptimizerPanel: (props: { onApplyWeights?: ApplyWeights }) => {
    captured.onApplyWeights = props.onApplyWeights ?? null;
    return null;
  }
}));

import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 50 },
  { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 20 }
];

function props(onWeightChange: (assetId: string, weightPercent: number) => void) {
  return {
    assets: [],
    positions: POSICIONES,
    summary: null,
    optimizationPreview: null,
    localOptimizationPreview: null,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: "RISK_5",
    portfolioNotice: null,
    onRemove: () => undefined,
    onOpenReport: () => undefined,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    onGenerate: async () => undefined,
    onAutoComplete: async () => false,
    savedPortfolios: [],
    initialPanel: "optimization"
  } as never;
}

async function montar(onWeightChange: (assetId: string, weightPercent: number) => void): Promise<ApplyWeights> {
  captured.onApplyWeights = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PortfolioBuilder, props(onWeightChange)));
  });
  if (!captured.onApplyWeights) throw new Error("El constructor no ha montado el optimizador");
  return captured.onApplyWeights;
}

describe("constructor · aplicar pesos del optimizador", () => {
  test("una propuesta que no cubre todas las posiciones no cambia ningún peso y devuelve el motivo", async () => {
    const onWeightChange = vi.fn();
    const apply = await montar(onWeightChange);
    let motivo: string | null | void = undefined;
    await act(async () => { motivo = apply({ A: 0.6, B: 0.4 }); });
    expect(motivo).toContain("La propuesta no cubre 1 posición de la cartera");
    expect(motivo).toContain("No se ha cambiado ningún peso.");
    expect(onWeightChange).not.toHaveBeenCalled();
  });

  test("una propuesta completa se aplica a todas las posiciones", async () => {
    const onWeightChange = vi.fn();
    const apply = await montar(onWeightChange);
    let motivo: string | null | void = undefined;
    await act(async () => { motivo = apply({ A: 0.6, B: 0.4, C: 0 }); });
    expect(motivo).toBeNull();
    expect(onWeightChange.mock.calls).toEqual([["A", 60], ["B", 40], ["C", 0]]);
  });
});
