// @vitest-environment happy-dom

/**
 * ALTA-10 (auditoría 16-10-2026): «Guardar como propuesta» (paso Optimizar)
 * pasaba siempre el capital del Constructor, también los 100.000 € ilustrativos
 * de un borrador sin capital fijado. La cartera guardada salía con
 * total_capital = 100000 y, además, la sesión pasaba a capital fijado (sin el
 * aviso de capital sin fijar y con el informe en euros sobre esa cifra). Debe
 * comportarse como el guardado normal (F-04): sin capital fijado, undefined.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

type SaveProposal = (name: string, positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[]) => void;
const captured = vi.hoisted(() => ({ onSaveProposal: null as SaveProposal | null }));

vi.mock("../src/components/OptimizerPanel", () => ({ OptimizerPanel: () => null }));
vi.mock("../src/components/PortfolioImprovementPanel", () => ({
  PortfolioImprovementPanel: (props: { onSaveProposal?: SaveProposal }) => {
    captured.onSaveProposal = props.onSaveProposal ?? null;
    return null;
  }
}));

import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];
const PROPUESTA: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 50 },
  { asset_id: "C", weight_percent: 50 }
];

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

async function guardarPropuesta(initialCapital: number | undefined) {
  captured.onSaveProposal = null;
  const onSaveLocalPortfolio = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
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
    onSaveLocalPortfolio,
    onRiskProfileChange: () => undefined,
    onWeightChange: () => undefined,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    onBuildImprovementCandidates: async () => ({ candidates: [] }),
    onApplyImprovement: () => undefined,
    savedPortfolios: [],
    initialPanel: "optimization",
    initialCapital
  } as never;
  await act(async () => {
    root?.render(createElement(PortfolioBuilder, props));
  });
  if (!captured.onSaveProposal) throw new Error("El Constructor no ha montado el panel de mejora");
  const save = captured.onSaveProposal;
  await act(async () => {
    save("Propuesta", PROPUESTA, []);
  });
  return onSaveLocalPortfolio;
}

describe("Constructor · Guardar como propuesta", () => {
  test("sin capital fijado no guarda los 100.000 € ilustrativos", async () => {
    const onSaveLocalPortfolio = await guardarPropuesta(undefined);
    expect(onSaveLocalPortfolio).toHaveBeenCalledTimes(1);
    expect(onSaveLocalPortfolio).toHaveBeenCalledWith("Propuesta", PROPUESTA, [], undefined);
  });

  test("con capital fijado guarda ese capital", async () => {
    const onSaveLocalPortfolio = await guardarPropuesta(250000);
    expect(onSaveLocalPortfolio).toHaveBeenCalledWith("Propuesta", PROPUESTA, [], 250000);
  });
});
