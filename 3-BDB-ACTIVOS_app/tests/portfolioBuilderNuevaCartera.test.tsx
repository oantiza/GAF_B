// @vitest-environment happy-dom

/**
 * «Nueva cartera», en el sitio de «Vaciar la cartera» (hallazgo 47).
 *
 * No había forma de empezar la cartera de otro cliente sin vaciar la actual. Ahora el botón pide empezar
 * otra y nada más: si hay algo que perder, pregunta el marco (`useCicloDeCartera`), y las carteras
 * guardadas no se tocan: eliminarlas se hace en su pantalla, y esta ya no tiene con qué.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function props(positions: BdbManualPortfolioPosition[], overrides: Record<string, unknown> = {}) {
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
    ...overrides
  } as never;
}

const DOS_POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

/**
 * Rediseño del 14-11-2026: «Nueva propuesta» sale de la barra de edición y va en «Más» de la cabecera, marcada como
 * destructiva. Hace lo mismo: pide empezar otra, y si hay algo que perder pregunta el marco.
 */
async function conElMenu(positions: BdbManualPortfolioPosition[], overrides: Record<string, unknown>, uso: (item: HTMLButtonElement | undefined) => Promise<void> | void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PortfolioBuilder, props(positions, overrides)));
  });
  const mas = [...container.querySelectorAll<HTMLButtonElement>(".portfolio-header-actions button")].find((b) => b.textContent === "Más");
  await act(async () => mas?.click());
  const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.querySelector("span")?.textContent === "Nueva propuesta");
  await uso(item);
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("Diseño de cartera · Nueva propuesta", () => {
  test("ocupa el sitio de «Vaciar la cartera», que ya no existe", async () => {
    const html = renderToStaticMarkup(createElement(PortfolioBuilder, props(DOS_POSICIONES)));
    expect(html).not.toContain("Vaciar");
    await conElMenu(DOS_POSICIONES, {}, (item) => {
      expect(item).toBeDefined();
      expect(item?.className).toContain("is-danger");
    });
  });

  test("con todo vacío no hay nada que empezar", async () => {
    await conElMenu([], {}, (item) => {
      expect(item?.disabled).toBe(true);
    });
  });

  test("con un nombre, un capital o una cartera abierta sí, aunque no tenga posiciones", async () => {
    for (const overrides of [
      { portfolioName: "Cliente" },
      { initialCapital: 250000 },
      { guardado: { abierta: { portfolio_id: "p", created_at: "", updated_at: "", huella: "" }, sinGuardar: false, guardando: false } }
    ]) {
      await conElMenu([], overrides, (item) => {
        expect(item?.disabled).toBe(false);
      });
    }
  });

  test("un clic la pide, sin armar nada y sin tocar las carteras guardadas", async () => {
    const onReset = vi.fn();
    await conElMenu(DOS_POSICIONES, { onReset }, async (item) => {
      await act(async () => item?.click());
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
