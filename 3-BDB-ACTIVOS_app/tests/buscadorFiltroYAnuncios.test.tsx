// @vitest-environment happy-dom

/**
 * Buscador (auditoría de frontend, ACT-10, ACT-11, ACT-22 y DIR-10).
 * - ACT-10 / DIR-10: el filtro de producto es una elección, no un juego de pestañas: botones con estado
 *   pulsado y ningún `role="tab"` que apunte a un panel que no existe. Y el mismo orden de opciones que
 *   el filtro del Comparador.
 * - ACT-11: el recuento de resultados se anuncia, con un respiro para no hacerlo en cada tecla.
 * - ACT-22: «Solo favoritos» sin ningún favorito lo dice; y el primer clic en Rentabilidad o Sharpe pone
 *   lo mejor arriba (de mayor a menor), y en Volatilidad o Coste, lo menor.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listarTarjetas: vi.fn(), leerDocumento: vi.fn() }));

vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  listarTarjetas: mocks.listarTarjetas,
  leerDocumento: mocks.leerDocumento
}));

import { olvidarCatalogoEnSesion } from "../src/adapters/catalogoEnSesion";
import { AssetSearchFilters } from "../src/components/AssetSearchFilters";
import { BuscadorNuevoPage } from "../src/pages/BuscadorNuevoPage";

const FONDO = {
  instrument_id: "BE0943877671",
  instrument_type: "FUND",
  identity: { name: "DPAM B - Bonds Eur Government B EUR Cap", currency: "EUR" },
  classification: { asset_class: "FIXED_INCOME" },
  metrics: { method: "EXTRACTOR_MONTHLY_V1", annualized_return: { "1y": 0.0423 } }
};
const ETF = {
  instrument_id: "US78462F1030",
  instrument_type: "ETF",
  identity: { name: "SPDR S&P 500 ETF Trust", currency: "USD" },
  classification: { asset_class: "EQUITY" },
  metrics: { method: "EXTRACTOR_MONTHLY_V1", annualized_return: { "1y": 0.12 } }
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  olvidarCatalogoEnSesion();
  localStorage.clear();
  mocks.listarTarjetas.mockReset().mockResolvedValue([FONDO, ETF]);
  mocks.leerDocumento.mockReset().mockResolvedValue({ availability: { state: "TRADING" } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pintar() {
  await act(async () => { root!.render(createElement(BuscadorNuevoPage, {})); });
  await act(async () => { await Promise.resolve(); });
}
const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto)!;

test("ACT-10 y DIR-10: el filtro de producto son botones con estado pulsado, sin pestañas", async () => {
  await pintar();
  expect(host.querySelector('[role="tab"], [role="tablist"], [aria-controls]')).toBeNull();
  const grupo = host.querySelector('[role="group"][aria-label="Producto"]');
  expect(grupo).not.toBeNull();
  expect([...grupo!.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
    ["Todos", "true"],
    ["Fondos", "false"],
    ["Acciones", "false"],
    ["ETF", "false"]
  ]);
  await act(async () => boton("ETF").click());
  expect(boton("ETF").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelectorAll(".tabla tbody tr").length).toBe(1);
});

test("ACT-10: el filtro del Comparador ofrece las mismas opciones en el mismo orden", () => {
  const html = renderToStaticMarkup(createElement(AssetSearchFilters, { activeFilter: "ALL", onFilterChange: () => undefined }));
  const rotulos = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  expect(rotulos).toEqual(["Todos", "Fondos", "Acciones", "ETF"]);
});

test("ACT-11: el recuento se anuncia como estado, medio segundo después del último cambio", async () => {
  vi.useFakeTimers();
  await pintar();
  await act(async () => { await vi.runOnlyPendingTimersAsync(); });
  const anuncio = () =>
    [...host.querySelectorAll('[role="status"]')].map((nodo) => nodo.textContent ?? "").find((texto) => texto.includes("activos"));
  expect(anuncio()).toBe("2 de 2 activos");
  await act(async () => boton("Fondos").click());
  /* Recién pulsado, aún no se anuncia: si se teclea, no se anuncia cada tecla. */
  expect(anuncio()).toBe("2 de 2 activos");
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(anuncio()).toBe("1 de 2 activos");
});

test("ACT-22: «Solo favoritos» sin ningún favorito dice que no hay y cómo marcarlos", async () => {
  await pintar();
  const casilla = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0];
  await act(async () => casilla.click());
  expect(host.textContent).toContain("Aún no has marcado ningún favorito");
  expect(host.textContent).not.toContain("Prueba con otro nombre, ticker o ISIN");
  /* Y lo dice con lo que se ve en la fila: el favorito es un corazón desde el 17-11-2026, y el texto hablaba de una
     estrella hasta el 19-11 (apartado 14.7 del sistema de diseño). */
  expect(host.textContent).toContain("pulsa el corazón de un activo");
  expect(host.textContent).not.toContain("pulsa la estrella");
});

test("ACT-22: el primer clic en Rentabilidad pone la mayor arriba; en Volatilidad, la menor", async () => {
  await pintar();
  const encabezado = (texto: string) =>
    [...host.querySelectorAll<HTMLTableCellElement>(".tabla thead th")].find((th) => th.textContent?.replace(/[↑↓]/g, "").startsWith(texto))!;
  await act(async () => encabezado("Rent.").querySelector("button")!.click());
  expect(encabezado("Rent.").getAttribute("aria-sort")).toBe("descending");
  /* El segundo clic sigue dando la vuelta, como siempre. */
  await act(async () => encabezado("Rent.").querySelector("button")!.click());
  expect(encabezado("Rent.").getAttribute("aria-sort")).toBe("ascending");
  await act(async () => encabezado("Vol.").querySelector("button")!.click());
  expect(encabezado("Vol.").getAttribute("aria-sort")).toBe("ascending");
});
