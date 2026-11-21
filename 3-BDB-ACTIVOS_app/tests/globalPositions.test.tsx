// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { groupPositionAmounts } from "../src/core/groupPositionAmounts";
import { parsePositionLines } from "../src/core/positionImport";
import * as excelExport from "../src/core/globalPositionsXlsx";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn() }));
// B4 / R-07: estos tests ejercitan la pantalla CON acceso a retrocesiones; el gate real
// depende de la sesion de Firebase (.env), asi que se fija aqui de forma explicita.
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;LU0232524495;Fondo A;1.000,25\nCliente Dos;LU0232524495;Fondo A;2.000,50\nCliente Tres;LU0524465548;Fondo B;400,00";

test("agrupa el CSV del Legacy por ISIN sin conservar clientes", () => {
  expect(groupPositionAmounts(parsePositionLines(csv))).toEqual([
    { id: "LU0232524495", amount: 3000.75 },
    { id: "LU0524465548", amount: 400 }
  ]);
  expect(groupPositionAmounts([{ id: "lu0232524495 ", amount: 10 }, { id: "LU0232524495", amount: 20 }])).toEqual([{ id: "LU0232524495", amount: 30 }]);
});

test("muestra un acumulado por fondo y calcula ingreso con el coeficiente del Legacy", async () => {
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => ({
    id: p.asset_id, amount: p.amount,
    asset: { asset_id: p.asset_id, display_name: "Fondo " + p.asset_id, instrument_type: "FUND" }
  })));
  mocks.retro.mockResolvedValue(new Map([["LU0232524495", { isin: "LU0232524495", retro_pct: 0.5, source: "ADMIN_UI", as_of_date: "2026-09-25" }]]));
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
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!;
    await act(async () => { button.click(); });
    // Séptima pasada: no llega nada al backend hasta que el asesor confirma lo que enseña el resumen.
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Resumen de la importación"]')?.textContent).toContain("Posiciones para comprobar");
    expect(await confirmEurosAndAnalyze(host, "Calcular retrocesiones")).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: "LU0232524495", amount: 3000.75 }, { asset_id: "LU0524465548", amount: 400 }
    ]);
    const rows = host.querySelectorAll(".positions-table-panel .tabla tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("3.000,75");
    expect(rows[0].textContent).toContain("15,00");
    expect(rows[1].textContent).toContain("Falta");
    expect(host.querySelector(".positions-table-panel .tabla")!.textContent).not.toContain("Cliente");
    expect(host.querySelector(".positions-table-panel .tabla")!.textContent).not.toContain("Coste");
    const coefficient = host.querySelector('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(coefficient, "0.5");
      coefficient.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".positions-table-panel .tabla tbody tr")!.textContent).toContain("7,50");
    const search = host.querySelector('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "LU0232524495");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const exportSpy = vi.spyOn(excelExport, "buildGlobalPositionsXlsx").mockResolvedValue(new Uint8Array([1]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Descargar en Excel")!.click(); });
    expect(exportSpy).toHaveBeenCalledWith([{
      id: "LU0232524495", name: "Fondo LU0232524495", amount: 3000.75,
      retroPct: 0.5, cessionPct: 0.25, incomeEur: 7.501875, status: "found"
    }], false);
    expect(download).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    host.remove();
  }
});
