// @vitest-environment happy-dom

/**
 * Al quitar Modo cliente, Posiciones vuelve a pedir las retrocesiones (hallazgo 95, 04-11-2026).
 *
 * Al entrar en el modo se vacían, y al salir la pantalla creía tenerlas ya, porque se acordaba de para
 * qué filas las había pedido. Resultado: todas N/D, ingreso N/D, «Cobertura de retrocesiones: 0 %» y
 * un Excel exportable con esas columnas vacías, con la base entera ahí. Parecía que se había perdido
 * la base comercial.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn() }));

vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: mocks.retro,
  assetCommercialRetroKey: (a: { isin?: string; asset_id: string }) => a.isin ?? a.asset_id,
  saveCommercialRetro: vi.fn()
}));

import { ClientModeProvider, useClientMode } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { PosicionesPage } from "../src/pages/PosicionesPage";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

const FICHERO = "ISIN;INSTRUMENTO;VALOR DE MERCADO\nLU0232524495;Fondo A;3.000,75\nLU0524465548;Fondo B;400,00";
const BASE = new Map([["LU0232524495", { isin: "LU0232524495", retro_pct: 0.5, source: "ADMIN_UI", as_of_date: "2026-09-25" }]]);

function Interruptor() {
  const { toggle } = useClientMode();
  return (
    <button data-testid="interruptor" onClick={toggle} type="button">
      modo
    </button>
  );
}

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  /* La pantalla guarda su estado en la sesión: sin esto, cada prueba hereda la anterior. */
  clearSessionCaches();
  localStorage.clear();
  mocks.resolve.mockReset();
  mocks.retro.mockReset();
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
    positions.map((p) => ({
      id: p.asset_id,
      amount: p.amount,
      asset: { asset_id: p.asset_id, display_name: `Fondo ${p.asset_id}`, instrument_type: "FUND" }
    }))
  );
  mocks.retro.mockResolvedValue(BASE);
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

const reposar = (ms = 30) =>
  act(async () => {
    await new Promise((listo) => setTimeout(listo, ms));
  });

async function cargarLasPosiciones() {
  await act(async () => {
    root!.render(
      <ClientModeProvider initialValue={false}>
        <Interruptor />
        <PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />
      </ClientModeProvider>
    );
  });
  const cuadro = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(cuadro, FICHERO);
    cuadro.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const calcular = [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!;
  await act(async () => calcular.click());
  await confirmEurosAndAnalyze(host, "Calcular retrocesiones");
  await reposar();
}

const pulsarElInterruptor = () =>
  act(async () => host.querySelector<HTMLButtonElement>('[data-testid="interruptor"]')!.click());

/* Rediseño: la banda es la pieza `Respuesta`, y la descarga se llama «Descargar en Excel». */
const kpi = (nombre: string) => [...host.querySelectorAll(".respuesta__dato")].find((k) => k.textContent?.includes(nombre))?.textContent ?? "(no está)";
const excel = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Descargar en Excel")) as HTMLButtonElement;

test("al quitar el modo se vuelven a pedir, y las cifras vuelven", async () => {
  await cargarLasPosiciones();
  expect(mocks.retro).toHaveBeenCalledTimes(1);
  expect(kpi("Retrocesión media")).toContain("0,50");

  await pulsarElInterruptor();
  await reposar();
  /* Delante del cliente no está, ni se ha pedido otra vez. */
  expect(kpi("Retrocesión media")).toBe("(no está)");
  expect(mocks.retro).toHaveBeenCalledTimes(1);

  await pulsarElInterruptor();
  await reposar();
  expect(mocks.retro).toHaveBeenCalledTimes(2);
  expect(kpi("Retrocesión media")).toContain("0,50");
  expect(host.textContent).not.toContain("Cobertura de retrocesiones: 0");
});

test("mientras llegan dice «Cargando…» y el Excel espera", async () => {
  await cargarLasPosiciones();
  await pulsarElInterruptor();
  await reposar();

  let entregar: (valor: typeof BASE) => void = () => undefined;
  mocks.retro.mockReturnValueOnce(new Promise((listo) => (entregar = listo)));
  await pulsarElInterruptor();
  await reposar();

  expect(kpi("Retrocesión media")).toContain("Cargando…");
  expect(excel().disabled).toBe(true);

  await act(async () => entregar(BASE));
  await reposar();
  expect(kpi("Retrocesión media")).toContain("0,50");
  expect(excel().disabled).toBe(false);
});

describe("Posiciones globales es el negocio entero de la casa (decisión 19)", () => {
  const pintar = async (modoCliente: boolean, initialMode?: "extracto" | "global") =>
    act(async () => {
      root!.render(
        <ClientModeProvider initialValue={modoCliente}>
          <Interruptor />
          <PosicionesPage initialMode={initialMode} sourceKind="BBDD_LIVE_API" />
        </ClientModeProvider>
      );
    });
  const pestanas = () => [...host.querySelectorAll('[role="tab"]')].map((p) => p.textContent);

  test("fuera del modo se ofrecen los dos", async () => {
    await pintar(false);
    expect(pestanas()).toEqual(["Extracto externo", "Posiciones globales"]);
    expect(host.querySelector("h1")?.textContent).toBe("Posiciones");
    /* Rediseño: Posiciones es del grupo «Clientes» del menú. */
    expect(host.querySelector(".ui-eyebrow")?.textContent).toBe("Clientes");
  });

  test("con el modo no se ofrece, tampoco por su dirección, y al quitarlo vuelve donde estaba", async () => {
    await pintar(true, "global");
    expect(pestanas()).toEqual([]);
    expect(host.querySelector("h1")?.textContent).toBe("Posiciones");
    expect(host.textContent).toContain("Cargar posiciones por importe");
    expect(host.textContent).not.toContain("Cargar cartera global de fondos");

    await pulsarElInterruptor();
    expect(pestanas()).toEqual(["Extracto externo", "Posiciones globales"]);
    expect(host.textContent).toContain("Cargar cartera global de fondos");
  });
});

test("las secciones pasan por la cabecera de la pieza, con su título de verdad", async () => {
  await cargarLasPosiciones();
  const sinCabecera = [...host.querySelectorAll("section.panel")].filter((s) => !s.querySelector(":scope > .panel__head"));
  expect(sinCabecera).toEqual([]);
  expect([...host.querySelectorAll("h2.panel__title")].map((h) => h.textContent)).toEqual([
    "Cargar cartera global de fondos",
    /* Las descargas pasan a la cabecera: el bloque solo filtra. */
    "Filtrar",
    "Detalle de fondos"
  ]);
});

test("con el modo puesto, el Excel se puede exportar: no lleva esas columnas", async () => {
  await cargarLasPosiciones();
  await pulsarElInterruptor();
  await reposar();
  expect(excel().disabled).toBe(false);
});
