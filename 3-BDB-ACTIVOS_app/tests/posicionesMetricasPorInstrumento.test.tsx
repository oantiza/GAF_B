// @vitest-environment happy-dom

/**
 * Las alternativas de Posiciones leen la lista de métricas por tipo de instrumento (hallazgo 94).
 *
 * En local enseñaban el Sharpe de una acción, y en la web, donde el servidor ya no lo manda, decían
 * «N/D», que se lee como que falta lo que no aplica. Qué acciones son alternativas y en qué orden lo
 * decide `core/fundSwapper`, con su sector (decisión 16).
 */
import { act } from "react";
import { columnasDePosiciones } from "../src/adapters/tablaDePosiciones";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn(), universe: vi.fn() }));

vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/core/swapUniverse", () => ({ loadSwapUniverse: mocks.universe }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: mocks.retro,
  assetCommercialRetroKey: (a: { isin?: string; asset_id: string }) => a.isin ?? a.asset_id,
  saveCommercialRetro: vi.fn()
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

const FICHERO = "ISIN;INSTRUMENTO;VALOR DE MERCADO\nES0144580Y14;Iberdrola;3.000,75";

const activo = (id: string, tipo: BdbAssetDetail["instrument_type"], sharpe: number) =>
  ({
    asset_id: id,
    isin: id,
    display_name: `Activo ${id}`,
    instrument_type: tipo,
    economic_asset_class: "EQUITY",
    currency: "EUR",
    region: "Europa",
    category: "accion",
    sector: "Utilities",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { annualized_return_3y: 0.06, volatility_3y: 0.2, sharpe_3y: sharpe }
  }) as unknown as BdbAssetDetail;

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  localStorage.clear();
  mocks.resolve.mockReset();
  mocks.retro.mockReset();
  mocks.universe.mockReset();
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: activo(p.asset_id, "STOCK", 0.37) }))
  );
  mocks.retro.mockResolvedValue(new Map());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const reposar = () =>
  act(async () => {
    await new Promise((listo) => setTimeout(listo, 30));
  });

async function abrirAlternativas() {
  await act(async () => {
    root!.render(
      <ClientModeProvider initialValue={false}>
        <PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />
      </ClientModeProvider>
    );
  });
  const cuadro = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(cuadro, FICHERO);
    cuadro.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click());
  await confirmEurosAndAnalyze(host, "Calcular retrocesiones");
  await reposar();
  const botones = [...host.querySelectorAll<HTMLButtonElement>(".positions-table-panel .tabla tbody button")];
  const abrir = botones.find((b) => /alternativas/i.test(b.textContent ?? "")) ?? botones.at(-1)!;
  await act(async () => abrir.click());
  await reposar();
}

const cabeceras = () => [...host.querySelectorAll(".tabla-de-alternativas thead th")].map((th) => th.textContent);
const filas = () => [...host.querySelectorAll(".tabla-de-alternativas tbody tr")].map((tr) => tr.textContent ?? "");

test("en una tabla solo de acciones el Sharpe y la retrocesión no salen", async () => {
  mocks.universe.mockResolvedValue([activo("ES0000000001", "STOCK", 1.23)]);
  await abrirAlternativas();
  expect(filas().length).toBe(1);
  expect(cabeceras()).not.toContain("Sharpe 3A");
  expect(cabeceras()).not.toContain("Retrocesión");
  expect(filas()[0]).not.toContain("1,23");
  expect(filas()[0]).not.toContain("N/D");
});

test("en una tabla mixta la celda de la acción dice No aplica, y la del fondo sigue con su cifra", async () => {
  /* Hoy las alternativas son del mismo tipo que la posición, y la mezcla no se da: si un día se da, ya está dicho. */
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: activo(p.asset_id, "FUND", 0.37) }))
  );
  mocks.universe.mockResolvedValue([activo("ES0000000001", "FUND", 0.87), activo("ES0000000002", "STOCK", 1.23)]);
  await abrirAlternativas();
  expect(cabeceras()).toContain("Sharpe 3A");
  const delFondo = filas().find((fila) => fila.includes("ES0000000001"));
  expect(delFondo).toContain("0,87");
  const deLaAccion = filas().find((fila) => fila.includes("ES0000000002"));
  if (deLaAccion) {
    expect(deLaAccion).not.toContain("1,23");
    expect(deLaAccion).toContain("No aplica");
  }
});

describe("las columnas de Posiciones preguntan por fila", () => {
  const opciones = { columnaDelActivo: "Activo", conCostes: true, conRetro: true, conDetalle: false, eur: (v: number) => `${v} €` } as never;
  const posicion = (instrument_type: string, datos: Record<string, unknown> = {}) =>
    ({ id: "X", amount: 1000, asset: { asset_id: "X", display_name: "X", instrument_type }, ongoingPct: null, costEur: null, retroPct: null, cessionPct: null, incomeEur: null, ...datos }) as never;
  const celda = (id: string, p: never) => columnasDePosiciones(opciones).find((columna) => columna.id === id)!.celda({ id: "X", posicion: p });

  test.each(["coste-corriente", "coste-anual", "retro", "cesion", "ingreso"])("a una acción, %s no le aplica: no es que falte", (id) => {
    expect(celda(id, posicion("STOCK"))).toEqual({ texto: "No aplica", ausencia: "no-aplica" });
  });

  test("a un fondo sin el dato, le falta", () => {
    expect(celda("coste-corriente", posicion("FUND"))).toMatchObject({ texto: "Falta", ausencia: "falta" });
    expect(celda("retro", posicion("FUND"))).toMatchObject({ texto: "Falta", ausencia: "falta", apunte: "Sin dato" });
  });

  test("con el dato, la cifra", () => {
    /* Rediseño: la cifra sale del módulo común, con espacio duro antes del «%» (antes, un espacio normal). */
    expect(celda("coste-corriente", posicion("FUND", { ongoingPct: 0.002 }))).toMatchObject({ texto: "0,20 %" });
  });
});
