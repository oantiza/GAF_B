// @vitest-environment happy-dom

/**
 * Capital y posiciones de importe fijo (`keepEuros`), revisión del 14-10-2026.
 *
 * 1. Aportación: el panel ponía los pesos nuevos y después el cambio de
 *    capital devolvía la posición fija a su importe anterior. Con A fijo en
 *    50.000 € y B al 50 %, aportar 10.000 € dejaba A en 45,45 %, la cartera en
 *    95,45 % y 5.000 € desaparecían.
 * 2. Subir el capital de 100.000 a 200.000 € dejaba la cartera al 75 % sin
 *    aviso: la fija conservaba sus euros y las libres no se movían.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { PortfolioAmountUpdate } from "../src/core/portfolioAmounts";

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
      onGenerate: async () => undefined,
      onAutoComplete: async () => false,
      savedPortfolios: []
    } as never)
  );
}

async function mount(initial: BdbManualPortfolioPosition[], initialCapital = 100000) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Shell, { initial, initialCapital })); });
}

function state(): { capital: number; positions: BdbManualPortfolioPosition[] } {
  return JSON.parse(host!.querySelector("#estado")!.textContent!);
}
const weight = (id: string) => state().positions.find((p) => p.asset_id === id)!.weight_percent;
const totalWeight = () => state().positions.reduce((sum, p) => sum + p.weight_percent, 0);
const euros = (id: string) => (weight(id) / 100) * state().capital;
const notice = () => host!.querySelector('[data-testid="aviso-peso"]')?.textContent ?? null;

/* Rediseño del 14-11-2026: la aportación es «Añadir dinero», una acción de la cabecera de Posiciones que abre su
   diálogo. Los diálogos se pintan fuera de la página, en el cuerpo del documento: los botones se buscan allí. */
async function clickButton(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
  if (!button) throw new Error(`Falta el botón «${text}»`);
  await act(async () => { button.click(); });
}

async function commitEuroField(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}

async function abrirAportacion() {
  await clickButton("Añadir dinero");
}

describe("aportación de capital con posiciones de importe fijo", () => {
  test("A fijo en 50.000 € y B al 50 %: aportar 10.000 € no pierde euros y la cartera suma 100 %", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    await abrirAportacion();
    await clickButton("Aplicar aportación");

    expect(state().capital).toBe(110000);
    expect(weight("A")).toBeCloseTo(50, 9);
    expect(weight("B")).toBeCloseTo(50, 9);
    expect(totalWeight()).toBeCloseTo(100, 9);
    expect(euros("A") + euros("B")).toBeCloseTo(110000, 6);
    // A sigue fija, con su importe nuevo.
    expect(state().positions[0]).toMatchObject({ keepEuros: true, targetEuros: 55000 });
    expect(document.body.textContent).toContain("Las posiciones de importe fijo pasan a su importe nuevo.");
  });

  test("con «Igual entre posiciones» la fija también recibe su parte y la conserva", async () => {
    await mount([
      { asset_id: "A", weight_percent: 20, keepEuros: true, targetEuros: 20000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 50 }
    ]);
    await abrirAportacion();
    await commitEuroField("Importe de la aportación en euros", "30.000");
    const equal = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((radio) => radio.value === "equal")!;
    await act(async () => { equal.click(); });
    await clickButton("Aplicar aportación");

    expect(state().capital).toBe(130000);
    expect(euros("A")).toBeCloseTo(30000, 6);
    expect(euros("B")).toBeCloseTo(40000, 6);
    expect(euros("C")).toBeCloseTo(60000, 6);
    expect(totalWeight()).toBeCloseTo(100, 9);
    expect(state().positions[0].targetEuros).toBe(30000);

    // Un cambio de capital posterior ya no la devuelve a los 20.000 € de antes.
    await commitEuroField("Capital total en euros", "260.000");
    expect(euros("A")).toBeCloseTo(30000, 6);
  });
});

describe("cambio de capital con posiciones de importe fijo", () => {
  test("de 100.000 a 200.000 €: la fija conserva sus euros y las libres absorben el resto", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 30 },
      { asset_id: "C", weight_percent: 20 }
    ]);
    await commitEuroField("Capital total en euros", "200.000");

    expect(state().capital).toBe(200000);
    expect(weight("A")).toBeCloseTo(25, 9);
    expect(weight("B")).toBeCloseTo(45, 9);
    expect(weight("C")).toBeCloseTo(30, 9);
    expect(totalWeight()).toBeCloseTo(100, 9);
    expect(euros("A")).toBeCloseTo(50000, 6);
    expect(notice()).toContain("el cambio de capital se reparte entre las libres");
  });

  test("sin libres que absorban (B con candado) avisa con la suma y ofrece normalizar", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    const lockButtons = [...host!.querySelectorAll<HTMLButtonElement>("button.portfolio-lock")];
    await act(async () => { lockButtons[1].click(); });
    await commitEuroField("Capital total en euros", "200.000");

    expect(weight("A")).toBeCloseTo(25, 9);
    expect(weight("B")).toBe(50);
    expect(notice()).toContain("la cartera suma 75,0\u00a0%");
    expect(notice()).toContain("quita un candado o suelta un importe fijo");
    expect(notice()).toContain("«Normalizar al 100 %»");

    // Quitar el candado y normalizar cuadra la cartera sin tocar los euros fijos.
    await act(async () => { lockButtons[1].click(); });
    await clickButton("Normalizar al 100 %");
    expect(weight("A")).toBeCloseTo(25, 6);
    expect(weight("B")).toBeCloseTo(75, 2);
    expect(totalWeight()).toBeCloseTo(100, 2);
  });

  test("sin posiciones fijas, cambiar el capital no toca los pesos ni avisa", async () => {
    await mount([
      { asset_id: "A", weight_percent: 60 },
      { asset_id: "B", weight_percent: 40 }
    ]);
    await commitEuroField("Capital total en euros", "250.000");
    expect(state().capital).toBe(250000);
    expect(weight("A")).toBe(60);
    expect(weight("B")).toBe(40);
    expect(notice()).toBeNull();
  });
});

/* Ronda 3 de la revisión (14-10-2026). */
describe("avisos del cambio de capital, a la medida del caso", () => {
  test("bajar el capital por debajo del importe fijo: la suma del aviso es la aplicada y dice cuánto no cabe", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50 }
    ]);
    await commitEuroField("Capital total en euros", "40.000");

    // La página acota cada peso a 100 %: A queda al 100 % y la cartera al 150 %, no al 175 %.
    expect(weight("A")).toBe(100);
    expect(weight("B")).toBe(50);
    expect(totalWeight()).toBeCloseTo(150, 9);
    expect(notice()).toContain("La cartera suma 150,0\u00a0%");
    expect(notice()).not.toContain("175");
    expect(notice()).toMatch(/los importes fijos \(50\.000,00\s€\) no caben: quedan fuera 10\.000,00\s€/);
  });

  test("solo importes fijos, sin candados: el aviso no habla de candados", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50, keepEuros: true, targetEuros: 50000 }
    ]);
    await commitEuroField("Capital total en euros", "200.000");

    expect(notice()).toContain("la cartera suma 50,0\u00a0%");
    expect(notice()).toContain("suelta un importe fijo («Soltar» en su fila)");
    expect(notice()).not.toMatch(/candado/i);
  });

  test("«Soltar» quita el importe fijo de la fila y la deja libre para normalizar", async () => {
    await mount([
      { asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 50000 },
      { asset_id: "B", weight_percent: 50, keepEuros: true, targetEuros: 50000 }
    ]);
    await commitEuroField("Capital total en euros", "200.000");
    const release = host!.querySelector<HTMLButtonElement>('button[aria-label="Soltar el importe fijo de B"]')!;
    await act(async () => { release.click(); });

    expect(state().positions[1]).toMatchObject({ keepEuros: false });
    expect(state().positions[1].targetEuros).toBeUndefined();
    const rows = [...host!.querySelectorAll("table.portfolio-table tbody tr")];
    expect(rows[1].textContent).not.toContain("Importe fijo");

    await clickButton("Normalizar al 100 %");
    expect(euros("A")).toBeCloseTo(50000, 6);
    expect(weight("B")).toBeCloseTo(75, 2);
  });
});

describe("la aportación respeta los candados con cualquier estrategia", () => {
  const initial: BdbManualPortfolioPosition[] = [
    { asset_id: "A", weight_percent: 40 },
    { asset_id: "B", weight_percent: 30 },
    { asset_id: "C", weight_percent: 30 }
  ];

  async function contributeWith(strategy: "proportional" | "equal" | "toward_equal") {
    await mount(initial);
    const lockButtons = [...host!.querySelectorAll<HTMLButtonElement>("button.portfolio-lock")];
    await act(async () => { lockButtons[1].click(); });
    await abrirAportacion();
    const radio = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === strategy)!;
    await act(async () => { radio.click(); });
    await clickButton("Aplicar aportación");
  }

  test.each(["proportional", "equal", "toward_equal"] as const)("%s: B con candado se queda en el 30 %", async (strategy) => {
    await contributeWith(strategy);
    expect(state().capital).toBe(110000);
    expect(weight("B")).toBe(30);
    expect(euros("B")).toBeCloseTo(33000, 6);
    expect(totalWeight()).toBeCloseTo(100, 9);
    expect(euros("A") + euros("B") + euros("C")).toBeCloseTo(110000, 6);
  });

  test("«Igual entre posiciones» reparte lo que no va a B a partes iguales entre A y C", async () => {
    await contributeWith("equal");
    expect(euros("A")).toBeCloseTo(43500, 6);
    expect(euros("C")).toBeCloseTo(33500, 6);
  });

  test("el panel dice que el 100 % solo se mantiene si la cartera ya sumaba el 100 %", async () => {
    await mount(initial);
    await abrirAportacion();
    expect(document.body.textContent).toContain("Si la cartera suma el 100 %, tu asignación (%) no cambia");
    expect(document.body.textContent).toContain("Las posiciones con candado conservan su peso con cualquier opción");
  });
});
