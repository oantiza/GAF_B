// @vitest-environment happy-dom

/**
 * DIS-23: aplicar una optimización redondeaba cada peso a dos decimales por su cuenta, y la suma podía quedar fuera del
 * 100 %. Ahora reparte el residuo como «Normalizar» (método del mayor resto, `redondearQueSume`).
 *
 * DIS-10: las notas de la cartera («Importadas 12 posiciones…», «Posición sustituida por…») no se anunciaban.
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIETE: BdbManualPortfolioPosition[] = ["A", "B", "C", "D", "E", "F", "G"].map((asset_id) => ({ asset_id, weight_percent: 100 / 7 }));

function props(positions: BdbManualPortfolioPosition[], extra: Record<string, unknown> = {}) {
  return {
    assets: [],
    positions,
    summary: null,
    optimizationPreview: null,
    localOptimizationPreview: null,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: null,
    portfolioNotice: null,
    onRemove: () => undefined,
    onOpenReport: () => undefined,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange: () => undefined,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    savedPortfolios: [],
    ...extra
  } as never;
}

async function montar(positions: BdbManualPortfolioPosition[], extra: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PortfolioBuilder, props(positions, extra)));
  });
  return {
    container,
    desmontar: async () => {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

describe("DIS-23 · aplicar una propuesta cuadra la suma", () => {
  test("siete pesos de 1/7 quedan en 100,00 % y no en 100,03 %", async () => {
    const onWeightChange = vi.fn();
    captured.onApplyWeights = null;
    // Se empieza con otros pesos, para que cada posición cambie y se escriba.
    const antes = SIETE.map((posicion, indice) => ({ ...posicion, weight_percent: indice === 0 ? 40 : 10 }));
    const { desmontar } = await montar(antes, { onWeightChange, initialPanel: "optimization" });
    const septimo = 1 / 7;
    await act(async () => {
      captured.onApplyWeights!(Object.fromEntries(SIETE.map((posicion) => [posicion.asset_id, septimo])));
    });
    /* Cuenta a mano: 100 / 7 = 14,285714… Redondeando cada uno, 14,29 × 7 = 100,03. Con el mayor resto, cada uno baja a
       14,28 (suma 99,96), faltan 4 centésimas y, como todos pierden lo mismo (0,5714 centésimas), van a los cuatro
       primeros: 4 × 14,29 + 3 × 14,28 = 57,16 + 42,84 = 100,00. */
    expect(onWeightChange.mock.calls).toEqual([
      ["A", 14.29], ["B", 14.29], ["C", 14.29], ["D", 14.29], ["E", 14.28], ["F", 14.28], ["G", 14.28]
    ]);
    const suma = onWeightChange.mock.calls.reduce((total, [, peso]) => total + Math.round(peso * 100), 0);
    expect(suma).toBe(10000);
    await desmontar();
  });

  test("tres pesos de 1/3 quedan en 100,00 % y no en 99,99 %", async () => {
    const onWeightChange = vi.fn();
    captured.onApplyWeights = null;
    const tres: BdbManualPortfolioPosition[] = [
      { asset_id: "A", weight_percent: 50 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ];
    const { desmontar } = await montar(tres, { onWeightChange, initialPanel: "optimization" });
    await act(async () => {
      captured.onApplyWeights!({ A: 1 / 3, B: 1 / 3, C: 1 / 3 });
    });
    /* Cuenta a mano: 33,333… × 3 = 100. A dos decimales, 33,33 cada uno suma 99,99; falta 1 centésima y, con los restos
       iguales, va a la primera: 33,34 + 33,33 + 33,33 = 100,00. */
    expect(onWeightChange.mock.calls).toEqual([["A", 33.34], ["B", 33.33], ["C", 33.33]]);
    await desmontar();
  });
});

describe("DIS-10 · las notas de la cartera se anuncian", () => {
  test("la nota va en una región viva", async () => {
    const { container, desmontar } = await montar(SIETE, { portfolioNotice: "Importadas 7 posiciones." });
    const nota = [...container.querySelectorAll('[role="status"]')].find((nodo) => nodo.textContent?.includes("Importadas 7 posiciones."));
    expect(nota).toBeDefined();
    await desmontar();
  });
});
