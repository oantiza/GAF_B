// @vitest-environment happy-dom

/**
 * Posiciones globales (tercera pasada, N-04/N-06): lo que la importación no ha
 * querido adivinar se dice en pantalla. Con «ISIN;Valor;Valor liquidativo», la
 * última columna es un precio: no se importa nada y el aviso lo explica.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn() }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("una última columna que es un precio no se importa y el aviso lo dice", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
    });
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "ISIN;Valor;Valor liquidativo\nLU1234567891;80000;12,34\nIE0098765432;120000;5,67"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click();
    });

    expect(mocks.resolve).not.toHaveBeenCalled();
    const warning = host.querySelector('[aria-label="Avisos de la importación"]');
    /* Rediseño: el grupo lleva el nombre y, dentro, el `Aviso` se anuncia. */
    expect(warning?.querySelector('[role="status"]')).not.toBeNull();
    expect(warning?.textContent).toContain("«Valor liquidativo»");
    expect(host.textContent).toContain("No hay posiciones para analizar");

    // Al editar el texto, el aviso del texto anterior desaparece.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "LU1234567891;80000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="Avisos de la importación"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
