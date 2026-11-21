// @vitest-environment happy-dom

/**
 * Comparador de activos (auditoría de frontend, ACT-04 y ACT-05).
 * - ACT-04: la primera carga no monta el comparador vacío para desmontarlo enseguida y volverlo a
 *   montar: se espera a que contesten los activos, y se monta una sola vez.
 * - ACT-05: un id guardado en la selección que el catálogo ya no devuelve no se queda ocupando sitio
 *   en el marco sin poder quitarse: se quita de la selección, y se dice.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getComparableAssets: vi.fn(), montajes: { cuenta: 0 } }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: mocks.getComparableAssets })
}));
vi.mock("../src/components/AssetComparison", () => ({
  AssetComparison: ({ assets }: { assets: Array<{ asset_id: string }> }) => {
    useEffect(() => {
      mocks.montajes.cuenta += 1;
    }, []);
    return <p className="comparador-de-prueba">{assets.map((a) => a.asset_id).join(",") || "vacío"}</p>;
  }
}));

import { AssetComparisonPage } from "../src/pages/AssetComparisonPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.getComparableAssets.mockReset();
  mocks.montajes.cuenta = 0;
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

const pintar = async (assetIds: string[], onRemove = vi.fn()) => {
  await act(async () => {
    root!.render(
      <AssetComparisonPage
        assetIds={assetIds}
        initialInstrumentFilter="ALL"
        onAdd={() => undefined}
        onRemove={onRemove}
        sourceKind="LOCAL_MOCK"
      />
    );
  });
  await act(async () => { await Promise.resolve(); });
  return onRemove;
};

test("ACT-04: con dos ids, el comparador se monta una sola vez y ya con sus activos", async () => {
  mocks.getComparableAssets.mockResolvedValue([{ asset_id: "LU0000000001" }, { asset_id: "LU0000000002" }]);
  await pintar(["LU0000000001", "LU0000000002"]);
  expect(host.querySelector(".comparador-de-prueba")?.textContent).toBe("LU0000000001,LU0000000002");
  expect(mocks.montajes.cuenta).toBe(1);
  expect(mocks.getComparableAssets).toHaveBeenCalledTimes(1);
});

test("ACT-04: si la lectura falla, no se queda en «Cargando» para siempre", async () => {
  mocks.getComparableAssets.mockRejectedValue(new Error("Sin conexión"));
  await pintar(["LU0000000001", "LU0000000002"]);
  expect(host.textContent).not.toContain("Cargando activos seleccionados");
  expect(host.textContent).toContain("Sin conexión");
});

test("ACT-05: un id que el catálogo no devuelve se quita de la selección del marco, una sola vez, y se dice", async () => {
  mocks.getComparableAssets.mockResolvedValue([{ asset_id: "LU0000000001" }, { asset_id: "LU0000000002" }]);
  const onRemove = await pintar(["LU0000000001", "XX0000000000", "LU0000000002"]);
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onRemove).toHaveBeenCalledWith("XX0000000000");
  expect(host.textContent).toContain("XX0000000000");
  expect(host.textContent).toContain("ya no está en el catálogo");
});

test("ACT-05: un activo recién añadido, que aún no se ha pedido, no se toma por perdido", async () => {
  mocks.getComparableAssets
    .mockResolvedValueOnce([{ asset_id: "LU0000000001" }, { asset_id: "LU0000000002" }])
    .mockImplementationOnce(() => new Promise(() => undefined));
  const onRemove = await pintar(["LU0000000001", "LU0000000002"]);
  await pintar(["LU0000000001", "LU0000000002", "LU0000000003"], onRemove);
  expect(onRemove).not.toHaveBeenCalled();
});

test("ACT-05: un id que vuelve con otra forma (minúsculas, o por su ISIN) no se toma por perdido", async () => {
  mocks.getComparableAssets.mockResolvedValue([{ asset_id: "LU0000000001" }, { asset_id: "ID-2", isin: "LU0000000002" }]);
  const onRemove = await pintar(["lu0000000001", "LU0000000002"]);
  expect(onRemove).not.toHaveBeenCalled();
});
