// @vitest-environment happy-dom

/**
 * ALTA-12 (auditoría 16-10-2026): con dos «Ver» seguidos en Posiciones, si las
 * alternativas de A llegaban después que las de B, la tabla mezclaba la
 * posición B (retrocesión actual) con las alternativas de A. Ahora solo pinta
 * la respuesta del último «Ver».
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  retro: vi.fn(),
  universe: new Map<string, (value: unknown) => void>()
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/core/swapUniverse", () => ({
  loadSwapUniverse: (_dataSource: unknown, types: string[]) =>
    new Promise((resolve) => { mocks.universe.set(types[0], resolve); })
}));
vi.mock("../src/core/fundSwapper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/fundSwapper")>()),
  findHomogeneousAlternatives: (_asset: unknown, universe: Array<Record<string, unknown>>) =>
    universe.map((asset) => ({ asset, tier: 1 }))
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;LU0232524495;Fondo A;1.000,00\nCliente Dos;IE00B4L5Y983;ETF B;2.000,00";

function alternative(id: string, name: string) {
  return { asset_id: id, display_name: name, economic_asset_class: "EQUITY", metrics: {} };
}

test("dos «Ver» seguidos: quedan las alternativas del último aunque las del primero lleguen después", async () => {
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => ({
    id: p.asset_id,
    amount: p.amount,
    asset: {
      asset_id: p.asset_id,
      display_name: "Posición " + p.asset_id,
      instrument_type: p.asset_id.startsWith("LU") ? "FUND" : "ETF"
    }
  })));
  mocks.retro.mockResolvedValue(new Map());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
    });
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click();
    });
    // Sexta pasada: el CSV Legacy («VALOR DE MERCADO», sin divisa) se analiza tras confirmar que son euros.
    expect(await confirmEurosAndAnalyze(host, "Calcular retrocesiones")).toBe(true);

    const verDe = (assetId: string) => {
      const row = [...host.querySelectorAll(".positions-table-panel .tabla tbody tr")].find((tr) => tr.textContent?.includes(assetId));
      const button = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Ver");
      if (!button) throw new Error(`No aparece «Ver» en la fila de ${assetId}`);
      return button;
    };
    await act(async () => { verDe("LU0232524495").click(); });
    await act(async () => { verDe("IE00B4L5Y983").click(); });

    await act(async () => { mocks.universe.get("ETF")?.([alternative("ALT-B", "Alternativa del ETF B")]); });
    await act(async () => { mocks.universe.get("FUND")?.([alternative("ALT-A", "Alternativa del fondo A")]); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const panel = host.querySelector('[aria-labelledby="positions-alternatives-title"]')!;
    expect(panel.textContent).toContain("Alternativa del ETF B");
    expect(panel.textContent).not.toContain("Alternativa del fondo A");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
