// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* Posiciones hacía su propia media: con una acción decía «Coste anual identificado» para siempre, y la misma cartera daba
   un 1,00 % aquí y un 0,70 % en el análisis de costes (decisión 10). */

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));

import { clearSessionCaches } from "../src/core/sessionCaches";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;LU0232524495;Fondo A;70.000,00\nCliente Dos;ES0144580Y14;Iberdrola;30.000,00";
const ACTIVOS: Record<string, unknown> = {
  LU0232524495: { asset_id: "LU0232524495", display_name: "Fondo A", instrument_type: "FUND", costs: { ongoing_charge: 0.01 } },
  ES0144580Y14: { asset_id: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" }
};

let root: Root;
let view: HTMLDivElement;

async function analizar() {
  view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="extracto" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>));
  const input = view.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { [...view.querySelectorAll("button")].find((b) => b.textContent === "Analizar cartera")!.click(); });
  expect(await confirmEurosAndAnalyze(view, "Analizar cartera")).toBe(true);
}

/* Rediseño: la banda es la pieza `Respuesta`: rótulo, cifra y apunte de cada dato. */
const kpi = (rotulo: string) => {
  const celda = [...view.querySelectorAll(".respuesta__dato")].find((e) => e.querySelector(".respuesta__rotulo")?.textContent === rotulo);
  return celda ? { valor: celda.querySelector(".respuesta__cifra")?.textContent, texto: celda.textContent } : null;
};

beforeEach(() => {
  clearSessionCaches();
  mocks.resolve.mockReset();
  mocks.retro.mockReset();
  mocks.retro.mockResolvedValue(new Map());
});
afterEach(async () => {
  await act(async () => root.unmount());
  view.remove();
  clearSessionCaches();
});

describe("Posiciones con una acción", () => {
  test("70 % en un fondo al 1 % y 30 % en una acción: 0,70 % y 700 €, y la nota de lo que no incluye", async () => {
    mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
      positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: ACTIVOS[p.asset_id] })));
    await analizar();
    /* El módulo común escribe un espacio duro antes del «%» (antes, uno normal). */
    expect(kpi("Coste medio conocido")?.valor).toBe("0,70 %");
    expect(kpi("Coste medio conocido")?.texto).toContain("No incluye custodia ni corretaje");
    expect(kpi("Coste corriente anual")?.valor).toMatch(/^700\s*€$/);
    expect(kpi("Coste anual identificado")).toBeNull();
    const fila = [...view.querySelectorAll(".positions-table-panel .tabla tbody tr")].find((tr) => tr.textContent?.includes("Iberdrola"));
    expect(fila?.textContent).toContain("No aplica");
  });

  test("solo con acciones no dice 0,00 % ni 0 €: dice «No aplica», con lo que no incluye", async () => {
    mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
      positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: ACTIVOS.ES0144580Y14 })));
    await analizar();
    expect(kpi("Coste corriente anual")?.valor).toBe("No aplica");
    expect(kpi("Coste medio conocido")?.valor).toBe("No aplica");
    expect(kpi("Coste medio conocido")?.texto).toContain("No incluye custodia ni corretaje");
  });

  test("un fondo sin coste sigue siendo un dato que falta; junto a una acción no se convierte en 0 €", async () => {
    const sinCoste = { LU0232524495: { ...(ACTIVOS.LU0232524495 as object), costs: undefined }, ES0144580Y14: ACTIVOS.ES0144580Y14 } as Record<string, unknown>;
    mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
      positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: sinCoste[p.asset_id] })));
    await analizar();
    /* Lo que falta se dice con la pieza `Ausencia` (antes «N/D»). */
    expect(kpi("Coste anual identificado")?.valor).toBe("Falta el dato");
  });
});
