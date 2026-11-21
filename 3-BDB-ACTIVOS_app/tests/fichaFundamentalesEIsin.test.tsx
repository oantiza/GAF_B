// @vitest-environment happy-dom

/**
 * Ficha de activo (auditoría de frontend, ACT-08 y ACT-23).
 * - ACT-08: la ficha se pinta sin esperar a la otra lectura, de la que salen los fundamentales de una
 *   acción. Mientras llega, se dice; y si falla, se dice y se puede reintentar, en vez de que la
 *   valoración desaparezca sin una palabra.
 * - ACT-23: un ISIN en minúsculas o con espacios se busca sin espacios y en mayúsculas; un identificador
 *   con «?» o «#» no se pregunta, y se dice que no está, no que no se pudo leer.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ leerInstrumento: vi.fn(), getAssetDetail: vi.fn() }));

vi.mock("../src/adapters/baseNuevaLectura", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/baseNuevaLectura")>()),
  BASE_NUEVA_DISPONIBLE: true,
  leerInstrumento: mocks.leerInstrumento
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getAssetDetail: mocks.getAssetDetail, getAssetHoldings: async () => null })
}));
vi.mock("../src/pages/AssetDetailPage", () => ({
  AssetDetailPage: () => createElement("output", { id: "anterior" }, "Ficha anterior")
}));
vi.mock("../src/components/AssetHistoryChart", () => ({
  AssetHistoryChart: () => createElement("output", { id: "evolucion" }, "Evolución")
}));

import { FichaDeActivo } from "../src/components/ficha/FichaDeActivo";

const accion = (isin: string) => ({
  isin,
  raiz: { identity: { name: "Una acción de prueba", currency: "EUR" }, instrument_type: "STOCK" },
  tarjeta: { instrument_id: isin, instrument_type: "STOCK" },
  calidad: undefined,
  bloques: {}
});

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.leerInstrumento.mockReset().mockImplementation(async (isin: string) => accion(isin));
  mocks.getAssetDetail.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const PROPS = {
  sourceKind: "LOCAL_MOCK",
  enCartera: false,
  enComparacion: false,
  comparacionLlena: false,
  onAnadirACartera: () => undefined,
  onAlternarComparacion: () => undefined,
  onIrAlBuscador: () => undefined,
  vuelta: { etiqueta: "Ir al Buscador", direccion: "/buscador", alVolver: () => undefined }
};

async function montar(assetId: string) {
  await act(async () => {
    root!.render(createElement(FichaDeActivo, { ...PROPS, assetId } as never));
  });
  for (let vuelta = 0; vuelta < 6; vuelta += 1) {
    await act(async () => { await new Promise((listo) => setTimeout(listo, 0)); });
  }
}
const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

test("ACT-08: si la otra lectura falla, se dice que no se han podido leer los fundamentales, con Reintentar", async () => {
  mocks.getAssetDetail.mockRejectedValueOnce(new Error("Function en frío")).mockResolvedValue(null);
  await montar("ES0113900J37");
  expect(host.textContent).toContain("Una acción de prueba");
  expect(host.textContent).toContain("No se han podido leer los fundamentales");
  await act(async () => boton("Reintentar los fundamentales")!.click());
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    await act(async () => { await new Promise((listo) => setTimeout(listo, 0)); });
  }
  expect(mocks.getAssetDetail).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("No se han podido leer los fundamentales");
});

test("ACT-08: mientras llega la otra lectura, la ficha de una acción dice que los fundamentales están cargando", async () => {
  mocks.getAssetDetail.mockImplementation(() => new Promise(() => undefined));
  await montar("ES0113900J37");
  expect(host.textContent).toContain("Una acción de prueba");
  expect(host.textContent).toContain("Cargando los fundamentales");
});

test("ACT-23: un ISIN en minúsculas y con espacios se busca sin espacios y en mayúsculas", async () => {
  mocks.getAssetDetail.mockResolvedValue(null);
  await montar(" es01 1390 0j37 ");
  expect(mocks.leerInstrumento).toHaveBeenCalledWith("ES0113900J37");
  expect(mocks.getAssetDetail).toHaveBeenCalledWith("ES0113900J37");
  expect(host.textContent).toContain("Una acción de prueba");
});

test("ACT-23: un identificador con «?» o «#» no se pregunta: no está", async () => {
  mocks.getAssetDetail.mockResolvedValue(null);
  await montar("ES0113900J37?x=1");
  expect(mocks.leerInstrumento).not.toHaveBeenCalled();
  expect(mocks.getAssetDetail).not.toHaveBeenCalled();
  expect(host.textContent).toContain("No encontramos este activo");
});
