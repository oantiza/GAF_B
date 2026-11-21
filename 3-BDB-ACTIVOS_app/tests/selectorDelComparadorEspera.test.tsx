// @vitest-environment happy-dom
/**
 * Selector del Comparador (auditoría de frontend, ACT-12 b): la búsqueda va al servidor, y sin espera
 * entre teclas «san» eran tres llamadas a la Function. Se espera 250 ms desde la última tecla.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ searchAssetsPage: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ searchAssets: vi.fn(async () => []), searchAssetsPage: mocks.searchAssetsPage })
}));

import { AssetPicker } from "../src/components/AssetPicker";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mocks.searchAssetsPage.mockReset().mockResolvedValue({ results: [], totalMatches: 0, nextCursor: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function teclear(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("ACT-12: al teclear «san» se pregunta una sola vez, 250 ms después de la última tecla", async () => {
  await act(async () => root.render(<AssetPicker sourceKind="LOCAL_MOCK" selectedIds={[]} max={5} onPick={() => {}} />));
  /* La primera lista, sin nada tecleado, no espera. */
  expect(mocks.searchAssetsPage).toHaveBeenCalledTimes(1);
  const input = container.querySelector<HTMLInputElement>('input[type="search"], input:not([type])')!;
  for (const valor of ["s", "sa", "san"]) {
    await act(async () => teclear(input, valor));
    await act(async () => { vi.advanceTimersByTime(100); });
  }
  expect(mocks.searchAssetsPage).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(250); });
  expect(mocks.searchAssetsPage).toHaveBeenCalledTimes(2);
  expect(mocks.searchAssetsPage.mock.calls[1][0]).toMatchObject({ query: "san" });
});
