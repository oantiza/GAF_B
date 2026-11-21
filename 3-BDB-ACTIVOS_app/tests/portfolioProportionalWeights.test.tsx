// @vitest-environment happy-dom

/**
 * ALTA-20.1 (auditoría 14-10-2026): en modo «Proporcional», al cambiar un peso
 * el resto se reescala para mantener el 100 %. Las posiciones que conservan su
 * importe (`keepEuros`, p. ej. tras una sustitución «manteniendo euros») no se
 * reescalaban, pero tampoco contaban como fijas: la suma salía por encima del
 * 100 %. Ahora cuentan como fijas, igual que un candado.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));

import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

function Shell({ initial, capital = 100000 }: { initial: BdbManualPortfolioPosition[]; capital?: number }) {
  const [positions, setPositions] = useState(initial);
  const onWeightChange = (assetId: string, weight: number) =>
    setPositions((current) => current.map((p) => (p.asset_id === assetId ? { ...p, weight_percent: weight } : p)));
  const onPositionPatch = (assetId: string, patch: Pick<BdbManualPortfolioPosition, "keepEuros" | "targetEuros">) =>
    setPositions((current) => current.map((p) => (p.asset_id === assetId ? { ...p, ...patch } : p)));
  return createElement("div", null,
    createElement("output", { id: "estado" }, JSON.stringify(positions)),
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
      onRemove: () => undefined,
      onOpenReport: () => undefined,
      onReset: () => undefined,
      onImportText: async () => undefined,
      onSaveLocalPortfolio: () => undefined,
      onRiskProfileChange: () => undefined,
      onWeightChange,
      onPositionPatch,
      onAmountsChange: () => undefined,
      onFindAlternatives: async () => [],
      onSwap: () => undefined,
      onGenerate: async () => undefined,
      onAutoComplete: async () => false,
      savedPortfolios: []
    } as never)
  );
}

async function mount(initial: BdbManualPortfolioPosition[], capital = 100000) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Shell, { initial, capital })); });
}

function state(): BdbManualPortfolioPosition[] {
  return JSON.parse(host!.querySelector("#estado")!.textContent!) as BdbManualPortfolioPosition[];
}

const notice = () => host!.querySelector('[data-testid="aviso-peso"]')?.textContent ?? null;
/* Rediseño del 14-11-2026: el aviso de las fijas por encima del 100 % es la pieza `Aviso` (antes, `.notice--warn`). */
const overflowNotice = () =>
  [...host!.querySelectorAll(".aviso")].find((node) => node.textContent?.includes("Las posiciones fijas"))?.textContent ?? null;

async function lockRow(index: number) {
  const lockButtons = [...host!.querySelectorAll<HTMLButtonElement>("button.portfolio-lock")];
  await act(async () => { lockButtons[index].click(); });
}

async function commitCapital(value: string) {
  const input = host!.querySelector<HTMLInputElement>('input[aria-label="Capital total en euros"]')!;
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}

function weights(): Record<string, number> {
  const positions = JSON.parse(host!.querySelector("#estado")!.textContent!) as BdbManualPortfolioPosition[];
  return Object.fromEntries(positions.map((p) => [p.asset_id, p.weight_percent]));
}

const total = () => Object.values(weights()).reduce((sum, weight) => sum + weight, 0);

async function clickButton(text: string) {
  const button = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
  if (!button) throw new Error(`Falta el botón «${text}»`);
  await act(async () => { button.click(); });
}

/** Campo de peso de la fila `index` (orden de la cartera). */
async function typeWeight(index: number, value: string) {
  const inputs = [...host!.querySelectorAll<HTMLInputElement>("label.portfolio-weight-input:not(.portfolio-euro-input) input")];
  const input = inputs[index];
  if (!input) throw new Error(`Falta el campo de peso de la fila ${index}`);
  /* El peso se confirma al salir del campo, como el importe. */
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.blur());
}

describe("edición proporcional con posiciones que conservan su importe", () => {
  test("la posición keepEuros no se reescala y la suma se queda en el 100 %", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ]);
    await clickButton("Proporcional");
    await typeWeight(1, "40");

    // Antes: C pasaba a 60 (100 − 40, ignorando los 50 de A) y la cartera sumaba 150 %.
    expect(weights()).toEqual({ A: 50, B: 40, C: 10 });
    expect(total()).toBeCloseTo(100, 6);
  });

  test("el peso tecleado no puede pasar de lo que dejan las posiciones fijas", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ]);
    await clickButton("Proporcional");
    await typeWeight(1, "80");

    expect(weights()).toEqual({ A: 50, B: 50, C: 0 });
    expect(total()).toBeCloseTo(100, 6);
  });

  test("candados y keepEuros se suman como fijos", async () => {
    await mount([
      { asset_id: "A", weight_percent: 40, keepEuros: true, targetEuros: 40000 },
      { asset_id: "B", weight_percent: 20 },
      { asset_id: "C", weight_percent: 25 },
      { asset_id: "D", weight_percent: 15 }
    ]);
    // Candado sobre B (segunda fila).
    await lockRow(1);
    await clickButton("Proporcional");
    await typeWeight(2, "30");

    expect(weights()).toEqual({ A: 40, B: 20, C: 30, D: 10 });
    expect(total()).toBeCloseTo(100, 6);
  });

  test("en modo Libre el peso se aplica tal cual (sin reescalar)", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ]);
    await typeWeight(1, "40");
    expect(weights()).toEqual({ A: 50, B: 40, C: 20 });
  });
});

/* Revisión de ALTA-20.1 (14-10-2026): el acotado solo limitaba hacia arriba.
   Sin otras posiciones libres, la editada es la única que puede cerrar el
   100 %: su peso es lo que dejan las fijas, y la pantalla dice por qué. */
describe("edición proporcional sin otras posiciones libres", () => {
  test("A keepEuros 50 y B 50: teclear 30 en B lo deja en 50 y lo explica", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    await clickButton("Proporcional");
    await typeWeight(1, "30");

    expect(weights()).toEqual({ A: 50, B: 50 });
    expect(total()).toBeCloseTo(100, 6);
    expect(notice()).toContain("«B» es la única posición libre");
    expect(notice()).toContain("50,0\u00a0%");
  });

  test("A keepEuros 30, B 40 y C con candado 30: teclear 10 en B lo deja en 40", async () => {
    await mount([
      { asset_id: "A", weight_percent: 30, keepEuros: true, targetEuros: 30000 },
      { asset_id: "B", weight_percent: 40 },
      { asset_id: "C", weight_percent: 30 }
    ]);
    await lockRow(2);
    await clickButton("Proporcional");
    await typeWeight(1, "10");

    expect(weights()).toEqual({ A: 30, B: 40, C: 30 });
    expect(total()).toBeCloseTo(100, 6);
    expect(notice()).toContain("única posición libre");
  });

  test("si las fijas pasan del 100 % (A keepEuros 80 y C candado 30), avisa en vez de callar", async () => {
    await mount([
      { asset_id: "A", weight_percent: 80, keepEuros: true, targetEuros: 80000 },
      { asset_id: "B", weight_percent: 0 },
      { asset_id: "C", weight_percent: 30 }
    ]);
    await lockRow(2);
    expect(overflowNotice()).toContain("110,0\u00a0%");

    await clickButton("Proporcional");
    await typeWeight(1, "20");
    expect(weights().B).toBe(0);
    expect(notice()).toContain("Las posiciones fijas ya suman 110,0\u00a0%");
    // Hay candado (C) e importe fijo (A): el consejo nombra los dos.
    expect(overflowNotice()).toContain("Quita un candado o reduce o suelta un importe fijo");
  });

  test("con una sola libre, esa absorbe la diferencia y no hay aviso", async () => {
    await mount([
      { asset_id: "A", weight_percent: 40, keepEuros: true, targetEuros: 40000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 30 }
    ]);
    await clickButton("Proporcional");
    await typeWeight(1, "50");

    expect(weights()).toEqual({ A: 40, B: 50, C: 10 });
    expect(notice()).toBeNull();
  });

  test("con capital cero el reparto cuadra igual y editar la fila keepEuros suelta su ancla en euros", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ], 0);
    await clickButton("Proporcional");
    await typeWeight(1, "40");
    expect(weights()).toEqual({ A: 50, B: 40, C: 10 });

    // Con 0 € no hay importe que conservar: la fila deja de fijar euros y guarda el peso.
    await typeWeight(0, "60");
    const a = state().find((p) => p.asset_id === "A")!;
    expect(a.weight_percent).toBe(60);
    expect(a.keepEuros).toBe(false);
    expect(a.targetEuros).toBeUndefined();
    expect(total()).toBeCloseTo(100, 6);
    expect(Object.values(weights()).every(Number.isFinite)).toBe(true);
  });
});

/* Revisión de ALTA-20.1: una posición keepEuros se trata igual en los tres
   sitios — se ve fija, la normalización no la toca y editarla fija su importe. */
describe("posición que conserva su importe (keepEuros)", () => {
  test("la fila se marca como «Importe fijo»", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    const rows = [...host!.querySelectorAll("table.portfolio-table tbody tr")];
    expect(rows[0].textContent).toContain("Importe fijo");
    expect(rows[1].textContent).not.toContain("Importe fijo");
  });

  test("«Normalizar al 100 %» reparte solo entre las libres", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 20 },
      { asset_id: "C", weight_percent: 10 }
    ]);
    await clickButton("Normalizar al 100 %");

    expect(weights().A).toBe(50);
    expect(weights().B).toBeCloseTo(33.33, 2);
    expect(weights().C).toBeCloseTo(16.67, 2);
    expect(total()).toBeCloseTo(100, 1);
  });

  test("«Normalizar al 100 %» deja la suma en 100 justos: lo que se ve y lo que se guarda", async () => {
    /* Redondeados uno a uno daban 99,99 % con «Correcto» al lado. */
    await mount([11, 20, 10, 9, 25, 18, 20].map((weight_percent, i) => ({ asset_id: `P${i}`, weight_percent })));
    await clickButton("Normalizar al 100 %");

    expect(Object.values(weights())).toEqual([9.73, 17.7, 8.85, 7.97, 22.12, 15.93, 17.7]);
    expect(Math.round(total() * 100)).toBe(10000);
  });

  test("si todas son fijas, normalizar no reescala nada y lo explica", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 }
    ]);
    await lockRow(1);
    await clickButton("Normalizar al 100 %");

    expect(weights()).toEqual({ A: 50, B: 30 });
    expect(notice()).toContain("No hay posiciones libres que reescalar");
  });

  test("editar su peso fija el importe nuevo: un cambio de capital ya no la devuelve al antiguo", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    await typeWeight(0, "40");
    expect(state().find((p) => p.asset_id === "A")).toMatchObject({ weight_percent: 40, keepEuros: true, targetEuros: 40000 });

    await commitCapital("200.000");
    // Conserva los 40.000 € nuevos (20 %), no los 50.000 € de antes (25 %).
    expect(weights().A).toBe(20);
  });
});
