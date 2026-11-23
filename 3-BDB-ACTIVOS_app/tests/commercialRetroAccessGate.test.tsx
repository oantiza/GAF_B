// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as excelExport from "../src/core/globalPositionsXlsx";

/* B4 / R-07 (auditoría 29-09): `commercial_retro` solo es legible por admin
   (`4-base-nueva/firestore.rules`), pero el hook y los analizadores consultaban Firestore
   con cualquier cuenta: «Missing or insufficient permissions» en cada pantalla
   y, en Posiciones globales, exportaciones deshabilitadas. Sin claim no se
   consulta y se devuelve «sin dato» en silencio. */

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  retro: vi.fn(),
  access: vi.fn<() => "granted" | "denied" | "pending">(() => "granted")
}));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: mocks.retro,
  getCommercialRetroList: mocks.retro,
  saveCommercialRetro: vi.fn(),
  assetCommercialRetroKey: (asset: { asset_id: string } | undefined) => asset?.asset_id ?? null
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: mocks.access }));

import { useCommercialRetroData } from "../src/core/useCommercialRetroData";
import { CostsModal } from "../src/components/CostsModal";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.retro.mockReset();
  mocks.access.mockReset();
  mocks.access.mockReturnValue("granted");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

describe("useCommercialRetroData con cuenta sin claim admin", () => {
  const assets = [{ asset_id: "FUND-A", isin: "LU0000000001" }];
  let snapshot: ReturnType<typeof useCommercialRetroData> | null = null;

  function Probe() {
    snapshot = useCommercialRetroData(assets);
    return null;
  }

  test("no consulta Firestore y devuelve «sin dato» sin error ni carga", async () => {
    mocks.access.mockReturnValue("denied");
    mocks.retro.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await mount(<Probe />);
    expect(mocks.retro).not.toHaveBeenCalled();
    expect(snapshot!.records.size).toBe(0);
    expect(snapshot!.error).toBeNull();
    expect(snapshot!.loading).toBe(false);
  });

  test("mientras el claim se resuelve no consulta; con admin sí", async () => {
    mocks.access.mockReturnValue("pending");
    mocks.retro.mockResolvedValue(new Map([["LU0000000001", { isin: "LU0000000001", retro_pct: 0.4, source: "ADMIN_UI", as_of_date: "2026-09-25" }]]));
    const view = await mount(<Probe />);
    expect(mocks.retro).not.toHaveBeenCalled();
    expect(snapshot!.loading).toBe(true);

    mocks.access.mockReturnValue("granted");
    await act(async () => { root!.render(<Probe key="again" />); });
    expect(view).toBeDefined();
    expect(mocks.retro).toHaveBeenCalledTimes(1);
    expect(snapshot!.records.get("LU0000000001")?.retro_pct).toBe(0.4);
    expect(snapshot!.loading).toBe(false);
  });
});

describe("Posiciones globales sin claim admin", () => {
  const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;LU0232524495;Fondo A;1.000,25\nCliente Dos;LU0524465548;Fondo B;400,00";

  test("no consulta retros, no muestra error y exporta Excel y CSV con columnas de retro vacías", async () => {
    mocks.access.mockReturnValue("denied");
    mocks.retro.mockRejectedValue(new Error("Missing or insufficient permissions."));
    mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => ({
      id: p.asset_id, amount: p.amount,
      asset: { asset_id: p.asset_id, display_name: "Fondo " + p.asset_id, instrument_type: "FUND" }
    })));
    const view = await mount(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
    const input = view.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { [...view.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click(); });
    // Sexta pasada: el CSV Legacy («VALOR DE MERCADO», sin divisa) se analiza tras confirmar que son euros.
    expect(await confirmEurosAndAnalyze(view, "Calcular retrocesiones")).toBe(true);

    expect(mocks.retro).not.toHaveBeenCalled();
    expect(view.querySelector(".async-error-banner")).toBeNull();
    expect(view.textContent).not.toContain("permissions");
    const excelButton = [...view.querySelectorAll("button")].find((b) => b.textContent === "Descargar en Excel") as HTMLButtonElement;
    const csvButton = [...view.querySelectorAll("button")].find((b) => b.textContent === "Descargar en CSV") as HTMLButtonElement;
    expect(excelButton.disabled).toBe(false);
    expect(csvButton.disabled).toBe(false);

    const exportSpy = vi.spyOn(excelExport, "buildGlobalPositionsXlsx").mockResolvedValue(new Uint8Array([1]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => { excelButton.click(); });
    expect(exportSpy).toHaveBeenCalledTimes(1);
    const exported = exportSpy.mock.calls[0][0];
    expect(exported).toHaveLength(2);
    expect(exported.every((row) => row.retroPct === null && row.cessionPct === null && row.incomeEur === null)).toBe(true);
  });
});

describe("Costes sin claim admin", () => {
  test("no consulta retros y la pestaña de retrocesiones se abre sin error", async () => {
    mocks.access.mockReturnValue("denied");
    mocks.retro.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await mount(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />);
    await act(async () => ([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((e) => e.textContent === "Retrocesiones")!).click());
    expect(mocks.retro).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("permissions");
    expect(document.body.textContent).not.toContain("Cargando");
    expect(document.querySelector(".costs-retro-section tbody")).not.toBeNull();
  });
});
