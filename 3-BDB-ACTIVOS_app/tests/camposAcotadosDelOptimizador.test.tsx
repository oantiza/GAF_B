// @vitest-environment happy-dom

/**
 * DIS-04: «Máx. por activo (%)» se recortaba en cada tecla. Al borrar «100» el campo vacío valía 0, se recortaba a 1 y
 * aparecía «1»; lo siguiente que se tecleaba se le añadía («15» en vez de «5») y se optimizaba con un tope que nadie había
 * pedido. Lo mismo «Máx. sustituciones» en Fondos equivalentes. Ahora el campo guarda lo escrito y lo lee al confirmar.
 *
 * DIS-20: el cálculo del optimizador no se anunciaba a quien usa lector de pantalla.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({
  fetchHistoricalFrontier: vi.fn(),
  isRealFrontierEnabled: vi.fn(() => true)
}));
vi.mock("../src/adapters/optimizePortfolioBackend", () => backend);
const mejora = vi.hoisted(() => ({ fetchPortfolioImprovement: vi.fn() }));
vi.mock("../src/adapters/improvePortfolioBackend", () => mejora);

import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { PortfolioImprovementPanel } from "../src/components/PortfolioImprovementPanel";
import { clearSessionCaches } from "../src/core/sessionCaches";

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

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  backend.fetchHistoricalFrontier.mockReset();
  mejora.fetchPortfolioImprovement.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function campo(rotulo: string): HTMLInputElement {
  const label = [...host.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === rotulo);
  const input = label?.querySelector("input");
  if (!input) throw new Error(`No aparece el campo ${rotulo}`);
  return input;
}

/** Como el navegador: lo que se teclea se añade a lo que el campo enseña en ese momento. */
async function teclear(input: HTMLInputElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function borrarYTeclear(input: HTMLInputElement, texto: string) {
  await teclear(input, "");
  await teclear(input, `${input.value}${texto}`);
  await act(async () => {
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

describe("DIS-04 · el tope por activo no se reescribe en cada tecla", () => {
  test("vaciar el campo y teclear 5 deja 5, y el cálculo sale con un tope del 5 %", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "error", message: "sin datos" });
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined }));
    });
    const tope = campo("Máx. por activo (%)");
    await borrarYTeclear(tope, "5");
    expect(tope.value).toBe("5");
    await act(async () => boton("Optimizar")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(backend.fetchHistoricalFrontier).toHaveBeenCalledTimes(1);
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].maxWeight).toBe(0.05);
  });

  test("un tope fuera de 1-100 se marca, no se aplica y no deja optimizar con el anterior", async () => {
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined }));
    });
    const tope = campo("Máx. por activo (%)");
    await borrarYTeclear(tope, "150");
    expect(tope.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("entre 1 y 100");
    expect(boton("Optimizar")?.disabled).toBe(true);
  });

  test("«Máx. sustituciones»: vaciar y teclear 2 deja 2", async () => {
    await act(async () => {
      root.render(createElement(PortfolioImprovementPanel, {
        assets, positions, portfolioName: "Cliente", onBuildCandidates: vi.fn(), onApplyProposal: vi.fn(), onSaveProposal: vi.fn()
      } as never));
    });
    const maximo = campo("Máx. sustituciones");
    await borrarYTeclear(maximo, "2");
    expect(maximo.value).toBe("2");
  });
});

describe("DIS-20 · el cálculo del optimizador se anuncia", () => {
  test("mientras calcula, una región viva lo dice", async () => {
    backend.fetchHistoricalFrontier.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined }));
    });
    await act(async () => boton("Optimizar")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const vivas = [...host.querySelectorAll('[role="status"]')].map((nodo) => nodo.textContent ?? "");
    expect(vivas.some((texto) => texto.includes("Calculando"))).toBe(true);
  });
});
