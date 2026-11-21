// @vitest-environment happy-dom

/**
 * Mín. por activo en Optimizar (decisión de Óscar, 14-11-2026): 0 por defecto; lo que no cabe se dice antes de llamar, con sus
 * cifras, y no se recorta; un candado por debajo del mínimo no se calcula; y una propuesta por debajo no se aplica.
 * Las cifras esperadas son cuentas a mano: 3 activos a partes iguales son 33,33 %; 8, 12,5 %.
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

import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { problemaDelMinimo } from "../src/core/minimoPorActivo";
import { optimizationWeightIssue } from "../src/core/optimizationWeightValidation";

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


/** El espacio duro entre la cifra y «%» se lee aquí como un espacio. */
const texto = (valor: string | null | undefined) => (valor == null ? null : valor.replace(/\u00a0/g, " "));

const tres: BdbManualPortfolioPosition[] = [...positions, { asset_id: "C", label: "Fondo C", weight_percent: 0 }];
const tresActivos = tres.map((p) => ({ ...assets[0], asset_id: p.asset_id, display_name: p.label })) as BdbAssetDetail[];

describe("problemaDelMinimo · las cuentas", () => {
  test("0 % es lo de antes: nunca bloquea", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 0, maximoPct: 100, assetIds: ["A", "B", "C"] }))).toBeNull();
  });
  test("con 8 activos, 12,5 % es exactamente partes iguales y cabe; 12,6 % no, y dice cuál cabe", () => {
    const ocho = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(texto(problemaDelMinimo({ minimoPct: 12.5, maximoPct: 100, assetIds: ocho }))).toBeNull();
    expect(texto(problemaDelMinimo({ minimoPct: 12.6, maximoPct: 100, assetIds: ocho })))
      .toBe("Con 8 activos, un mínimo del 12,6 % por activo suma un 100,8 %: pasa del 100 %. El mínimo más alto que cabe es un 12,5 %, que deja la cartera a partes iguales.");
  });
  test("con 3 activos el mínimo que cabe se redondea hacia abajo: 33,33 %", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 33.33, maximoPct: 100, assetIds: ["A", "B", "C"] }))).toBeNull();
    expect(texto(problemaDelMinimo({ minimoPct: 34, maximoPct: 100, assetIds: ["A", "B", "C"] }))).toContain("un 33,33 %");
  });
  test("un mínimo por encima del máximo escrito no tiene cartera", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 15, maximoPct: 12, assetIds: ["A", "B", "C", "D", "E"] })))
      .toBe("El mínimo por activo (15 %) pasa del máximo (12 %): ninguna cartera cumple los dos. Baja el mínimo o sube el máximo.");
  });
  test("un candado por debajo del mínimo se nombra", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 10, maximoPct: 100, assetIds: ["A", "B", "C"], candados: { A: 0.05 }, nombre: () => "Fondo A" })))
      .toBe("El candado de Fondo A (5 %) queda por debajo del mínimo por activo (10 %): baja el mínimo o cambia el candado.");
  });
  test("candados más el mínimo de los libres: 60 % + 2 × 25 % pasa; 60 % + 2 × 20 % cabe justo", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 20, maximoPct: 100, assetIds: ["A", "B", "C"], candados: { A: 0.6 } }))).toBeNull();
    expect(texto(problemaDelMinimo({ minimoPct: 25, maximoPct: 100, assetIds: ["A", "B", "C"], candados: { A: 0.6 } })))
      .toBe("Los candados suman un 60 %, y un mínimo del 25 % para los 2 activos libres suma un 50 %: pasa del 100 %. El mínimo más alto que cabe es un 20 %.");
  });
  test("un candado de un activo que no entra en el cálculo no cuenta aquí", () => {
    expect(texto(problemaDelMinimo({ minimoPct: 10, maximoPct: 100, assetIds: ["A", "B"], candados: { Z: 0.01 } }))).toBeNull();
  });
});

describe("optimizationWeightIssue · el mínimo", () => {
  test("una propuesta que deja un activo por debajo no se aplica; en el mínimo justo, sí", () => {
    expect(optimizationWeightIssue({ A: 0.95, B: 0.05 }, ["A", "B"], {}, 1, undefined, 0.1)).toContain("peso mínimo");
    expect(optimizationWeightIssue({ A: 0.9, B: 0.1 }, ["A", "B"], {}, 1, undefined, 0.1)).toBeNull();
    expect(optimizationWeightIssue({ A: 1, B: 0 }, ["A", "B"])).toBeNull();
  });
});

describe("el campo en el panel", () => {
  test("arranca en 0 y no manda mínimo: la llamada es la de antes", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "error", message: "sin datos" });
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined }));
    });
    expect(campo("Mín. por activo (%)").value).toBe("0");
    await act(async () => boton("Optimizar")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].minWeight).toBeUndefined();
  });

  test("un mínimo del 10 % sale en la llamada como 0,10", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "error", message: "sin datos" });
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets: tresActivos, positions: tres, onApplyWeights: () => undefined }));
    });
    await borrarYTeclear(campo("Mín. por activo (%)"), "10");
    await act(async () => boton("Optimizar")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].minWeight).toBeCloseTo(0.1, 12);
  });

  test("un mínimo que no cabe con 3 activos (la posición al 0 % cuenta) se dice y no deja optimizar", async () => {
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets: tresActivos, positions: tres, onApplyWeights: () => undefined }));
    });
    await borrarYTeclear(campo("Mín. por activo (%)"), "40");
    expect(texto(host.textContent)).toContain("Con 3 activos, un mínimo del 40 % por activo suma un 120 %");
    expect(boton("Optimizar")?.disabled).toBe(true);
    expect(backend.fetchHistoricalFrontier).not.toHaveBeenCalled();
  });

  test("un candado por debajo del mínimo bloquea y se nombra", async () => {
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets: tresActivos, positions: tres, lockedWeights: { A: 0.05 }, onApplyWeights: () => undefined }));
    });
    await borrarYTeclear(campo("Mín. por activo (%)"), "10");
    expect(texto(host.textContent)).toContain("El candado de Fondo A (5 %) queda por debajo del mínimo por activo (10 %)");
    expect(boton("Optimizar")?.disabled).toBe(true);
  });
});
