// @vitest-environment happy-dom

/**
 * Posiciones globales (cuarta pasada, N3-10): los avisos de un FICHERO cargado
 * se ven y se mantienen al analizar. Al cargar el fichero, el texto se
 * sustituye por «id;importe», así que el aviso solo puede venir de la carga.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => []),
  retro: vi.fn(async () => new Map()),
  file: vi.fn()
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/core/importFileReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/importFileReader")>()),
  readImportFileText: mocks.file,
  readPositionImportFileText: mocks.file
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze, IMPORT_WARNINGS } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("el aviso de un fichero cargado se ve y sigue tras analizar", async () => {
  // Extracto con una fila en USD sin contravalor: se importa LU y se avisa de IE.
  mocks.file.mockResolvedValue(
    "Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;"
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "extracto.csv")] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    // Octava pasada (I6): el cuadro trae el propio fichero.
    expect(host.querySelector("textarea")!.value).toContain("A;LU1234567891;EUR;80000;80000");
    expect(host.querySelector(IMPORT_WARNINGS)?.textContent).toContain("IE0098765432 (USD)");
    // Quinta pasada: el resumen de la importación se ve siempre.
    const summary = () => host.querySelector('[aria-label="Resumen de la importación"]')?.textContent ?? "";
    expect(summary()).toContain("1 posición leída");
    expect(summary()).toContain("Importe: columna «Contravalor EUR»");
    expect(summary()).toContain("en otra divisa sin contravalor en EUR (IE0098765432 (USD))");

    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click();
    });
    // Séptima pasada: también con contravalor en EUR, nada llega al backend hasta confirmar.
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(await confirmEurosAndAnalyze(host, "Calcular retrocesiones")).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith([{ asset_id: "LU1234567891", amount: 80000 }]);
    expect(host.querySelector(IMPORT_WARNINGS)?.textContent).toContain("IE0098765432 (USD)");
    expect(summary()).toContain("Importe: columna «Contravalor EUR»");

    // Al salir de la pantalla y volver, el aviso vuelve con la tabla.
    await act(async () => { root.unmount(); });
    const again = createRoot(host);
    await act(async () => {
      again.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
    });
    expect(host.querySelector(IMPORT_WARNINGS)?.textContent).toContain("IE0098765432 (USD)");
    expect(summary()).toContain("Importe: columna «Contravalor EUR»");
    await act(async () => { again.unmount(); });
  } finally {
    host.remove();
  }
});
