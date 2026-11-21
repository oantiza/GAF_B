// @vitest-environment happy-dom

/* Revisión de la tercera pasada (N3-02), invertida en la cuarta: en
   Posiciones globales, una lista con cabecera se lee por su cabecera y al
   backend llegan los importes de verdad; una fila de total sin ISIN no es una
   posición. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(async () => []), retro: vi.fn(async () => ({})) }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

let lastSummary = "";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function paste(text: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
  });
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click();
  });
  // Séptima pasada: se analiza tras confirmar lo que enseña el resumen.
  await confirmEurosAndAnalyze(host, "Calcular retrocesiones");
  const warning = host.querySelector('[aria-label="Avisos de la importación"]')?.textContent ?? null;
  lastSummary = host.querySelector('[aria-label="Resumen de la importación"]')?.textContent ?? "";
  await act(async () => { root.unmount(); });
  host.remove();
  return warning;
}

test("R8a · «ISIN;Importe;Peso %»: al backend llegan los importes, no los pesos", async () => {
  mocks.resolve.mockClear();
  const warning = await paste("ISIN;Importe;Peso %\nLU1234567891;80000;40\nIE0098765432;120000;60");
  const sent = (mocks.resolve.mock.calls[0]?.[0] ?? []) as Array<{ asset_id: string; amount: number }>;
  expect(sent).toEqual([
    { asset_id: "LU1234567891", amount: 80000 },
    { asset_id: "IE0098765432", amount: 120000 }
  ]);
  // Séptima pasada: sin avisos; el resumen dice que «Importe» no dice su divisa.
  expect(warning).toBeNull();
  expect(lastSummary).toContain("«Importe» no dice su divisa");
});

test("R4b · una fila de total sin ISIN ni nombre no es una posición", async () => {
  mocks.resolve.mockClear();
  await paste("ISIN;Nombre;Importe\nLU1234567891;Fondo A;80000\nIE0098765432;Fondo B;120000\n;;200000");
  const sent = (mocks.resolve.mock.calls[0]?.[0] ?? []) as Array<{ asset_id: string; amount: number }>;
  expect(sent.map((p) => p.asset_id)).toEqual(["LU1234567891", "IE0098765432"]);
  expect(sent.reduce((s, p) => s + p.amount, 0)).toBe(200000);
});
