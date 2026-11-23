// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AssetSearchPage } from "../src/types/assetDataSource";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";

/* Revisión 14-10, ronda 2: «Cargar más» del selector comparaba la consulta
   consigo misma en el mismo cierre. Si el filtro cambiaba mientras volvía la
   página siguiente, esa página (de la búsqueda anterior) se añadía a la lista
   nueva con su cursor y su total. */

const mocks = vi.hoisted(() => ({ searchAssetsPage: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ searchAssets: vi.fn(async () => []), searchAssetsPage: mocks.searchAssetsPage })
}));

import { AssetPicker } from "../src/components/AssetPicker";

function asset(id: string, name: string): BdbAssetSearchResult {
  return { asset_id: id, display_name: name, isin: id, economic_asset_class: "EQUITY" } as unknown as BdbAssetSearchResult;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.searchAssetsPage.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("una página que vuelve tras cambiar el filtro no se mezcla con la búsqueda nueva", async () => {
  let resolveStale: (page: AssetSearchPage) => void = () => {};
  mocks.searchAssetsPage.mockImplementation(async (options: { cursor?: string; instrumentTypes?: string[] }) => {
    if (options.cursor) {
      // «Cargar más» de la búsqueda inicial: queda en vuelo hasta que la soltemos.
      return new Promise<AssetSearchPage>((resolve) => { resolveStale = resolve; });
    }
    if (options.instrumentTypes?.includes("ETF")) {
      return { results: [asset("ETF-1", "ETF nuevo")], totalMatches: 1, nextCursor: null };
    }
    return { results: [asset("ALL-1", "Fondo inicial")], totalMatches: 3, nextCursor: "c1" };
  });

  await act(async () => root.render(<AssetPicker sourceKind="LOCAL_MOCK" selectedIds={[]} max={5} onPick={() => {}} />));
  expect(container.textContent).toContain("Fondo inicial");

  const loadMore = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Cargar"))!;
  expect(loadMore).toBeTruthy();
  await act(async () => loadMore.click());

  // Cambia el filtro mientras la página siguiente sigue en vuelo.
  const etf = [...container.querySelectorAll("button")].find((b) => b.textContent === "ETF")!;
  await act(async () => etf.click());
  expect(container.textContent).toContain("ETF nuevo");

  // Ahora vuelve la página de la búsqueda anterior.
  await act(async () => resolveStale({ results: [asset("ALL-2", "Fondo de la búsqueda vieja")], totalMatches: 3, nextCursor: "c2" }));

  expect(container.textContent).toContain("ETF nuevo");
  expect(container.textContent).not.toContain("Fondo de la búsqueda vieja");
  expect(container.textContent).not.toContain("Fondo inicial");
  // Ni el cursor ni el total de la búsqueda vieja: no queda «Cargar más».
  expect([...container.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Cargar"))).toBe(false);
});

test("un error tardío de «Cargar más» de una búsqueda anterior no aparece en la nueva", async () => {
  let rejectStale: (error: Error) => void = () => {};
  mocks.searchAssetsPage.mockImplementation(async (options: { cursor?: string; instrumentTypes?: string[] }) => {
    if (options.cursor) return new Promise<AssetSearchPage>((_resolve, reject) => { rejectStale = reject; });
    if (options.instrumentTypes?.includes("ETF")) return { results: [asset("ETF-1", "ETF nuevo")], totalMatches: 1, nextCursor: null };
    return { results: [asset("ALL-1", "Fondo inicial")], totalMatches: 3, nextCursor: "c1" };
  });

  await act(async () => root.render(<AssetPicker sourceKind="LOCAL_MOCK" selectedIds={[]} max={5} onPick={() => {}} />));
  const loadMore = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Cargar"))!;
  await act(async () => loadMore.click());
  const etf = [...container.querySelectorAll("button")].find((b) => b.textContent === "ETF")!;
  await act(async () => etf.click());

  await act(async () => rejectStale(new Error("timeout de la página vieja")));

  expect(container.textContent).toContain("ETF nuevo");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("No se pudo cargar el resto del catálogo");
});

test("sin cambios de búsqueda, «Cargar más» añade la página siguiente con su cursor y su total", async () => {
  mocks.searchAssetsPage.mockImplementation(async (options: { cursor?: string }) => {
    if (options.cursor === "c1") return { results: [asset("ALL-2", "Fondo de la página dos"), asset("ALL-1", "Fondo inicial")], totalMatches: 3, nextCursor: "c2" };
    if (options.cursor === "c2") return { results: [asset("ALL-3", "Fondo de la página tres")], totalMatches: 3, nextCursor: null };
    return { results: [asset("ALL-1", "Fondo inicial")], totalMatches: 3, nextCursor: "c1" };
  });

  await act(async () => root.render(<AssetPicker sourceKind="LOCAL_MOCK" selectedIds={[]} max={5} onPick={() => {}} />));
  const loadMoreButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Cargar"));

  await act(async () => loadMoreButton()!.click());
  expect(container.textContent).toContain("Fondo de la página dos");
  // El duplicado de la página uno no se repite.
  expect(container.querySelectorAll(".asset-picker-row")).toHaveLength(2);
  expect(mocks.searchAssetsPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));

  await act(async () => loadMoreButton()!.click());
  expect(container.textContent).toContain("Fondo de la página tres");
  expect(container.querySelectorAll(".asset-picker-row")).toHaveLength(3);
  expect(mocks.searchAssetsPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c2" }));
  // Universo completo: ya no se ofrece otra página.
  expect(loadMoreButton()).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

/* 20-11-2026: al llegar al máximo todas las filas se desactivan, y la lista, que se desplaza en vertical, se quedaba
   sin nada que el teclado pudiera enfocar. La lista se enfoca ella, con un nombre que dice que se desplaza. */
test("con el máximo alcanzado y todas las filas desactivadas, la lista sigue alcanzable con el teclado", async () => {
  mocks.searchAssetsPage.mockResolvedValue({ results: [asset("A-1", "Uno"), asset("A-2", "Dos")], totalMatches: 2, nextCursor: null });
  await act(async () => root.render(<AssetPicker sourceKind="LOCAL_MOCK" selectedIds={["X-1", "X-2"]} max={2} onPick={() => {}} />));
  const lista = container.querySelector("ul.asset-picker-list") as HTMLUListElement;
  expect(lista).toBeTruthy();
  const filas = [...lista.querySelectorAll("button")];
  expect(filas.length).toBe(2);
  expect(filas.every((fila) => fila.disabled)).toBe(true);
  expect(lista.tabIndex).toBe(0);
  expect(lista.getAttribute("aria-label")).toBe("Activos encontrados (lista desplazable)");
});
