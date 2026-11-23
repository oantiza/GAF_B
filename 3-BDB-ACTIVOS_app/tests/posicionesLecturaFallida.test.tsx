// @vitest-environment happy-dom
/**
 * Hallazgo 19 (15-11-2026): en Posiciones, una posición que la base no pudo leer no se cuenta como «no reconocida en el
 * catálogo». Se dice aparte, con lo que hay que hacer: volver a analizar.
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
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nUno;LU0232524495;Fondo A;1.000,00\nDos;LU0524465548;Fondo B;400,00\nTres;LU0000000001;Fondo C;100,00";

test("la posición que no se pudo leer se dice aparte de la que no está en el catálogo", async () => {
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => {
    if (p.asset_id === "LU0524465548") return { id: p.asset_id, amount: p.amount, asset: null, sinLeer: ["asset"] };
    if (p.asset_id === "LU0000000001") return { id: p.asset_id, amount: p.amount, asset: null };
    return { id: p.asset_id, amount: p.amount, asset: { asset_id: p.asset_id, display_name: "Fondo A", instrument_type: "FUND" } };
  }));
  mocks.retro.mockResolvedValue(new Map());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>); });
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click(); });
    expect(await confirmEurosAndAnalyze(host, "Calcular retrocesiones")).toBe(true);
    const texto = host.textContent ?? "";
    expect(texto).toContain("Una posición no se pudo leer de la base.");
    expect(texto).toContain("No es que falten en el catálogo ni que les falte el dato");
    expect(texto).toContain("Vuelve a analizar en unos segundos. LU0524465548.");
    // La que no existe sigue contándose sola como no reconocida; la que no se leyó, no.
    expect(texto).toContain("1 posición no reconocida en el catálogo.");
    /* 20-11-2026: la tabla tiene tres estados, y la que no se leyó dice el suyo, no «No reconocida». */
    const estadoDe = (isin: string) => {
      const fila = [...host.querySelectorAll(".positions-table-panel .tabla tbody tr")].find((tr) => tr.textContent?.includes(isin));
      const celdas = [...(fila?.querySelectorAll("td") ?? [])].map((td) => td.textContent ?? "");
      return celdas.find((c) => /Reconocida|No reconocida|No se pudo leer/.test(c));
    };
    expect(estadoDe("LU0232524495")).toBe("Reconocida");
    expect(estadoDe("LU0524465548")).toBe("No se pudo leer");
    expect(estadoDe("LU0000000001")).toBe("No reconocida");
    /* Y el filtro de estado la separa. */
    const filtro = [...host.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "unread"))!;
    expect([...filtro.options].map((o) => o.textContent)).toEqual(["Todos", "Reconocidos", "No reconocidos", "No se pudieron leer"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(filtro, "unread");
      filtro.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const filas = [...host.querySelectorAll(".positions-table-panel .tabla tbody tr")].map((tr) => tr.textContent ?? "");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toContain("LU0524465548");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test("un código sin forma de identificador («BRK/B») sale como no reconocido y el resto se analiza, sin error", async () => {
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => (
    p.asset_id === "BRK/B"
      ? { id: p.asset_id, amount: p.amount, asset: null }
      : { id: p.asset_id, amount: p.amount, asset: { asset_id: p.asset_id, display_name: "Fondo A", instrument_type: "FUND" } }
  )));
  mocks.retro.mockResolvedValue(new Map());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>); });
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input, "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nUno;LU0232524495;Fondo A;1.000,00\nDos;BRK/B;Berkshire;400,00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click(); });
    expect(await confirmEurosAndAnalyze(host, "Calcular retrocesiones")).toBe(true);
    expect(mocks.resolve).toHaveBeenLastCalledWith([{ asset_id: "LU0232524495", amount: 1000 }, { asset_id: "BRK/B", amount: 400 }]);
    const texto = host.textContent ?? "";
    expect(texto).toContain("1 posición no reconocida en el catálogo.");
    expect(texto).not.toContain("no se pudo leer");
    expect(host.querySelectorAll(".positions-table-panel .tabla tbody tr")).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("No se ha podido");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
