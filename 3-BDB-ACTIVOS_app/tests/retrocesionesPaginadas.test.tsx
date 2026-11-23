// @vitest-environment happy-dom

/**
 * Sistema › Retrocesiones, de 25 en 25 (Óscar, 20-11-2026), con la búsqueda y el filtro sobre todas las filas. 60 retrocesiones escritas a mano:
 * tres páginas, 25 + 25 + 10.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";

const isin = (i: number) => `LU${String(i).padStart(10, "0")}`;
const REGISTROS: CommercialRetroRecord[] = Array.from({ length: 60 }, (_, i) => ({ isin: isin(i + 1), retro_pct: 0.4, as_of_date: "2026-06-30", source: "ADMIN_UI" }));

const store = vi.hoisted(() => ({
  getCommercialRetroList: vi.fn(),
  getLastCommercialRetroImport: vi.fn(),
  applyCommercialRetroImport: vi.fn(),
  undoCommercialRetroImport: vi.fn(),
  saveCommercialRetro: vi.fn(),
  deleteCommercialRetro: vi.fn()
}));
vi.mock("../src/adapters/commercialRetroStore", () => store);
vi.mock("../src/firebaseEnv", () => ({ FIREBASE_CONFIGURED: true, PRODUCCION_SIN_CONFIGURAR: false, APUNTA_A_BDB: false }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    getComparableAssets: async (ids: string[]) => ids.map((id) => ({ asset_id: id, isin: id, display_name: `Fondo ${id}` }))
  })
}));

import { AdminRetrocessions } from "../src/components/AdminRetrocessions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const filas = (c: HTMLElement) => [...c.querySelectorAll(".retro-table tbody tr")].map((tr) => tr.querySelector(".retro-isin")?.textContent);
const paginas = (c: HTMLElement) => (c.querySelector('nav[aria-label="Páginas de retrocesiones registradas"]')?.textContent ?? "").replace(/\s+/g, " ").trim();
const boton = (c: HTMLElement, texto: string) => [...c.querySelectorAll<HTMLButtonElement>("nav button")].find((b) => b.textContent?.trim() === texto)!;
const pulsar = (b: HTMLElement) => act(async () => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function escribir(input: HTMLInputElement, valor: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, "value")?.set?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Retrocesiones, paginadas", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    store.getCommercialRetroList.mockReset().mockResolvedValue(REGISTROS);
    store.getLastCommercialRetroImport.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(AdminRetrocessions)); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  test("enseña 25 filas, y las páginas dicen cuántas hay: 1–25 de 60, 1 de 3", () => {
    expect(filas(container)).toHaveLength(25);
    expect(filas(container)[0]).toBe(isin(1));
    expect(paginas(container)).toBe("1–25 de 60Anterior1 de 3Siguiente");
  });

  test("la tercera página lleva las 10 que quedan, de la 51 a la 60", async () => {
    await pulsar(boton(container, "Siguiente"));
    await pulsar(boton(container, "Siguiente"));
    expect(filas(container)).toEqual(Array.from({ length: 10 }, (_, i) => isin(51 + i)));
    expect(paginas(container)).toBe("51–60 de 60Anterior3 de 3Siguiente");
  });

  test("la búsqueda mira todas las filas, no solo la página, y vuelve a la primera", async () => {
    await pulsar(boton(container, "Siguiente"));
    await escribir(container.querySelector<HTMLInputElement>('input[type="search"]')!, isin(58));
    expect(filas(container)).toEqual([isin(58)]);
    /* Una sola página: no hay páginas que enseñar. */
    expect(paginas(container)).toBe("");
    expect((container.textContent ?? "").replace(/\s+/g, " ")).toContain("1 de 60 fondos");
  });
});
