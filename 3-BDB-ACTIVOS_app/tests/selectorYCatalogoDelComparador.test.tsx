// @vitest-environment happy-dom

/**
 * El selector y el catálogo del Comparador de activos (auditoría de frontend, ACT-14 y ACT-19).
 *
 * ACT-19: las clases de activo del selector estaban escritas a mano y dejaban fuera el inmobiliario y lo sin clasificar;
 * salen del dato, como en el Buscador. Y la región de cada fila salía con su código («Europe») mientras el desplegable de
 * encima la escribía en español («Europa»).
 *
 * ACT-14: el diálogo del catálogo se titulaba «Listado por filtro», con «Comparador multi-activo» encima; se llama como
 * el botón que lo abre, «Elegir del catálogo».
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetSearchResult, EconomicAssetClass } from "../src/types/bdbAssets";

const RESULTADOS: BdbAssetSearchResult[] = (
  [
    ["A", "EQUITY", "Europe"],
    ["B", "REAL_ASSET", "Global"],
    ["C", "UNKNOWN", undefined],
    ["D", "OTHER", "Japan"],
    ["E", "FIXED_INCOME", "Eurozone"]
  ] as Array<[string, EconomicAssetClass, string | undefined]>
).map(
  ([id, clase, region]) =>
    ({
      asset_id: `LU000000000${id}`,
      isin: `LU000000000${id}`,
      display_name: `Fondo ${id}`,
      instrument_type: "FUND",
      economic_asset_class: clase,
      region,
      currency: "EUR",
      is_investable: true,
      quality_flags: [],
      coverage_status: "COMPLETE",
      metrics: { annualized_return_1y: 0.05, volatility_3y: 0.1 },
      performance_preview: { latest_value: 100 }
    }) as unknown as BdbAssetSearchResult
);

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ searchAssets: async () => RESULTADOS })
}));
vi.mock("../src/adapters/commercialRetroStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/commercialRetroStore")>()),
  getCommercialRetroList: async () => []
}));

import { AssetComparisonCatalogModal } from "../src/components/AssetComparisonCatalogModal";
import { AssetPicker } from "../src/components/AssetPicker";

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

const pintarElSelector = async () => {
  await act(async () => {
    root!.render(createElement(AssetPicker, { sourceKind: "LOCAL_MOCK", selectedIds: [], max: 5, onPick: () => undefined }));
  });
};
const desplegable = (rotulo: string) =>
  [...host.querySelectorAll("label")].find((label) => label.querySelector("span")?.textContent === rotulo)?.querySelector("select");

describe("ACT-19 · el selector del Comparador", () => {
  test("las clases salen del dato, con el inmobiliario y lo sin clasificar, y en el orden de su nombre", async () => {
    await pintarElSelector();
    const opciones = [...(desplegable("Clase de activo")?.options ?? [])].map((opcion) => [opcion.value, opcion.textContent]);
    expect(opciones).toEqual([
      ["ALL", "Todas"],
      ["REAL_ASSET", "Inmobiliario"],
      ["OTHER", "Otros"],
      ["FIXED_INCOME", "Renta fija"],
      ["EQUITY", "Renta variable"],
      ["UNKNOWN", "Sin clasificar"]
    ]);
    /* Una clase que ningún resultado tiene no se ofrece. */
    expect(opciones.map(([valor]) => valor)).not.toContain("COMMODITIES");
  });

  test("elegir una clase filtra la lista por ella", async () => {
    await pintarElSelector();
    const select = desplegable("Clase de activo")!;
    await act(async () => {
      select.value = "REAL_ASSET";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    /* El nombre es el primer texto de la celda: debajo va su ISIN (17-11-2026). */
    expect([...host.querySelectorAll(".apk-name")].map((nombre) => nombre.firstChild?.textContent)).toEqual(["Fondo B"]);
    expect(host.querySelector(".apk-name .apk-isin")?.textContent).toBe("LU000000000B");
  });

  test("la región de cada fila se escribe como en el desplegable, no con su código", async () => {
    await pintarElSelector();
    /* Una fila sin región deja su columna vacía, para que las demás sigan alineadas (17-11-2026). */
    const regiones = [...host.querySelectorAll(".apk-region")].map((region) => region.textContent).filter(Boolean);
    expect(regiones).toEqual(["Europa", "Global", "Japón", "Eurozona"]);
    const enElDesplegable = [...(desplegable("Región")?.options ?? [])].map((opcion) => opcion.textContent);
    for (const region of regiones) expect(enElDesplegable).toContain(region);
  });
});

describe("ACT-14 · el catálogo del Comparador", () => {
  test("el diálogo se llama como el botón que lo abre, en palabras llanas", async () => {
    await act(async () => {
      root!.render(
        createElement(AssetComparisonCatalogModal, {
          assets: RESULTADOS,
          selected: [],
          sourceKind: "LOCAL_MOCK",
          max: 5,
          avisoDeLimite: null,
          onApply: () => undefined,
          onClose: () => undefined
        })
      );
    });
    const dialogo = document.body.querySelector('[role="dialog"]');
    expect(dialogo?.querySelector("#comparison-catalog-title")?.textContent).toBe("Elegir del catálogo");
    expect(dialogo?.textContent).not.toMatch(/Listado por filtro|multi-activo/);
    const cabeceras = [...(dialogo?.querySelectorAll("th") ?? [])].map((celda) => celda.textContent?.trim());
    expect(cabeceras).toContain("Producto");
    expect(cabeceras).toContain("Rent. 1A (Rentabilidad 1 año)");
    expect(cabeceras).not.toContain("Tipo");
  });
});
