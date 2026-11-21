// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* U-08 (auditoría 29-09): Extracto externo y Posiciones globales guardaban el
   extracto pegado, las filas resueltas y las retros en `useState` local, y
   BdbActivosApp los monta por ruta: ir al Buscador y volver borraba el
   extracto y repetía las llamadas al backend. Ahora el estado vive en una
   caché de sesión por pantalla (memoria, nunca localStorage: son datos de
   clientes) que se restaura al remontar y se invalida con la sesión. */

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  retro: vi.fn(),
  access: vi.fn<() => "granted" | "denied" | "pending">(() => "granted")
}));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: mocks.access }));

import { clearSessionCaches } from "../src/core/sessionCaches";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { PosicionesPage } from "../src/pages/PosicionesPage";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csv = "CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;LU0232524495;Fondo A;1.000,25\nCliente Dos;LU0524465548;Fondo B;400,00";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}

async function unmount() {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
}

async function pasteAndAnalyze(view: HTMLElement, buttonLabel: string) {
  const input = view.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { [...view.querySelectorAll("button")].find((b) => b.textContent === buttonLabel)!.click(); });
  // Sexta pasada: el CSV Legacy («VALOR DE MERCADO», sin divisa) se analiza tras confirmar que son euros.
  expect(await confirmEurosAndAnalyze(view, buttonLabel)).toBe(true);
}

beforeEach(() => {
  clearSessionCaches();
  mocks.resolve.mockReset();
  mocks.retro.mockReset();
  mocks.access.mockReset();
  mocks.access.mockReturnValue("granted");
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) => positions.map((p) => ({
    id: p.asset_id, amount: p.amount,
    asset: { asset_id: p.asset_id, display_name: "Fondo " + p.asset_id, instrument_type: "FUND" }
  })));
  mocks.retro.mockResolvedValue(new Map([["LU0232524495", { isin: "LU0232524495", retro_pct: 0.5, source: "ADMIN_UI", as_of_date: "2026-09-25" }]]));
});

afterEach(async () => {
  await unmount();
  clearSessionCaches();
});

describe("Posiciones globales conserva el análisis entre montajes", () => {
  const render = () => <ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>;

  test("montar → pegar → desmontar → montar conserva texto, filas y retros sin volver a llamar al backend", async () => {
    let view = await mount(render());
    await pasteAndAnalyze(view, "Calcular retrocesiones");
    expect(view.querySelectorAll(".positions-table-panel .tabla tbody tr")).toHaveLength(2);
    expect(view.querySelector(".positions-table-panel .tabla tbody tr")!.textContent).toContain("5,00");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.retro).toHaveBeenCalledTimes(1);

    await unmount();
    view = await mount(render());

    expect(view.querySelector("textarea")!.value).toBe(csv);
    expect(view.querySelectorAll(".positions-table-panel .tabla tbody tr")).toHaveLength(2);
    expect(view.querySelector(".positions-table-panel .tabla tbody tr")!.textContent).toContain("5,00");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.retro).toHaveBeenCalledTimes(1);
  });

  test("al cambiar de sesión el análisis anterior no se restaura", async () => {
    let view = await mount(render());
    await pasteAndAnalyze(view, "Calcular retrocesiones");
    await unmount();
    clearSessionCaches();
    view = await mount(render());
    expect(view.querySelector("textarea")!.value).toBe("");
    expect(view.querySelector(".positions-table-panel .tabla")).toBeNull();
  });

  test("«Nueva carga» vacía también lo recordado", async () => {
    let view = await mount(render());
    await pasteAndAnalyze(view, "Calcular retrocesiones");
    /* Rediseño: «Nueva carga» vive en el menú «Más» de la cabecera, lejos de las descargas. */
    await act(async () => { [...view.querySelectorAll("button")].find((b) => b.textContent === "Más")!.click(); });
    await act(async () => { [...view.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === "Nueva carga")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // DIS-24: ahora pregunta antes de borrar; se confirma.
    await act(async () => { [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Borrar y empezar otra")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await unmount();
    view = await mount(render());
    expect(view.querySelector("textarea")!.value).toBe("");
    expect(view.querySelector(".positions-table-panel .tabla")).toBeNull();
  });
});

/* Revisión de la dirección A (18-11-2026): en la pantalla de dos modos el componente seguía montado al cambiar de
   pestaña, así que Globales enseñaba lo pegado en Extracto (con su botón ya activo) y lo escribía en su ranura. */
describe("Posiciones: cada modo guarda su propia carga", () => {
  const render = () => <ClientModeProvider initialValue={false}><PosicionesPage sourceKind="BBDD_LIVE_API" /></ClientModeProvider>;
  const pestana = (view: HTMLElement, nombre: string) =>
    act(async () => { [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === nombre)!.click(); });
  const escribir = (view: HTMLElement, valor: string) =>
    act(async () => {
      const input = view.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const boton = (view: HTMLElement, rotulo: string) => [...view.querySelectorAll("button")].find((b) => b.textContent === rotulo)!;

  test("lo pegado en Extracto no aparece en Globales, y cada modo lo recupera al volver", async () => {
    const view = await mount(render());
    await escribir(view, csv);
    await pestana(view, "Posiciones globales");
    expect(view.querySelector("textarea")!.value).toBe("");
    expect(boton(view, "Calcular retrocesiones").disabled).toBe(true);

    await escribir(view, "LU0524465548;400");
    await pestana(view, "Extracto externo");
    expect(view.querySelector("textarea")!.value).toBe(csv);
    await pestana(view, "Posiciones globales");
    expect(view.querySelector("textarea")!.value).toBe("LU0524465548;400");
  });

  test("las filas analizadas en Extracto no se pintan en Globales", async () => {
    const view = await mount(render());
    await pasteAndAnalyze(view, "Analizar cartera");
    expect(view.querySelector(".positions-table-panel .tabla")).not.toBeNull();
    await pestana(view, "Posiciones globales");
    expect(view.querySelector(".positions-table-panel .tabla")).toBeNull();
    await pestana(view, "Extracto externo");
    expect(view.querySelectorAll(".positions-table-panel .tabla tbody tr").length).toBeGreaterThanOrEqual(2);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("Extracto externo conserva el análisis entre montajes", () => {
  const render = () => <ClientModeProvider initialValue={false}><PositionsWorkbench mode="extracto" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>;

  test("montar → pegar → desmontar → montar conserva filas y retros sin volver a llamar al backend", async () => {
    let view = await mount(render());
    await pasteAndAnalyze(view, "Analizar cartera");
    expect(view.querySelectorAll(".positions-table-panel .tabla tbody tr").length).toBeGreaterThanOrEqual(2);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.retro).toHaveBeenCalledTimes(1);

    await unmount();
    view = await mount(render());

    expect(view.querySelector("textarea")!.value).toBe(csv);
    expect(view.querySelectorAll(".positions-table-panel .tabla tbody tr").length).toBeGreaterThanOrEqual(2);
    expect(view.querySelector(".positions-table-panel .tabla")!.textContent).toContain("Base comercial");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.retro).toHaveBeenCalledTimes(1);
  });
});
