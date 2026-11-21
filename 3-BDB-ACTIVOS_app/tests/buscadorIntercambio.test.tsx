// @vitest-environment happy-dom

/**
 * La lista y la ficha son dos pantallas, y ninguna monta a la otra (decisión 26, hallazgos 17 y 120).
 *
 * Se monta el marco real. Lo que no se puede fallar: que abrir una ficha no pase por el Buscador ni lea
 * el catálogo, que un ISIN que no existe conserve su dirección y lo diga, y que al volver la lista siga
 * donde estaba sin leer otra vez el catálogo, que en la web son más de mil lecturas facturadas.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disponible: { value: true },
  listarTarjetas: vi.fn(),
  leerInstrumento: vi.fn(),
  searchAssets: vi.fn(async () => [])
}));

/* La fuente de activos, con un solo activo y conocido. */
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    metadata: {
      kind: "LOCAL_MOCK",
      label: "Mock local",
      description: "",
      status: "ACTIVE_LOCAL",
      isRealConnection: false
    },
    searchAssets: mocks.searchAssets,
    getAssetDetail: async (id: string) =>
      id === "BE0943877671"
        ? {
            asset_id: "BE0943877671",
            display_name: "DPAM B - Bonds Eur Government B EUR Cap",
            is_investable: true,
            quality_flags: [],
            currency: "EUR"
          }
        : null,
    getAssetHoldings: async () => null
  })
}));
vi.mock("../src/config/runtimeConfig", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/config/runtimeConfig")>();
  return { ...real, DEFAULT_DATA_SOURCE_KIND: real.SAFE_DEFAULT_DATA_SOURCE_KIND };
});
vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminClaim: () => ({ isAdmin: false, resolved: true })
}));
vi.mock("../src/components/AssetHistoryChart", () => ({ AssetHistoryChart: () => null }));
vi.mock("../src/adapters/baseNuevaLectura", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/adapters/baseNuevaLectura")>();
  return {
    ...real,
    get BASE_NUEVA_DISPONIBLE() {
      return mocks.disponible.value;
    },
    listarTarjetas: mocks.listarTarjetas,
    leerInstrumento: mocks.leerInstrumento
  };
});

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { InstrumentoDesconocido } from "../src/adapters/baseNuevaLectura";
import { olvidarCatalogoEnSesion } from "../src/adapters/catalogoEnSesion";

const tarjeta = (isin: string, nombre: string, ticker?: string) => ({
  instrument_id: isin,
  instrument_type: "FUND",
  identity: { name: nombre, currency: "EUR", ticker },
  classification: { asset_class: "FIXED_INCOME" }
});

const INSTRUMENTO = {
  isin: "BE0943877671",
  raiz: { identity: { name: "DPAM B - Bonds Eur Government B EUR Cap", currency: "EUR" }, instrument_type: "FUND" },
  tarjeta: { instrument_id: "BE0943877671" },
  calidad: undefined,
  bloques: {}
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  olvidarCatalogoEnSesion();
  mocks.disponible.value = true;
  mocks.searchAssets.mockClear();
  mocks.listarTarjetas.mockReset();
  mocks.listarTarjetas.mockResolvedValue([
    tarjeta("BE0943877671", "DPAM B - Bonds Eur Government B EUR Cap"),
    tarjeta("LU0000000001", "Fondo Dos", "FDOS"),
    tarjeta("LU0000000002", "Otro Tres")
  ]);
  mocks.leerInstrumento.mockReset();
  mocks.leerInstrumento.mockImplementation(async (isin: string) => {
    if (isin === "BE0943877671") return INSTRUMENTO;
    throw new InstrumentoDesconocido("no está");
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function esperar(condicion: () => boolean, que: string) {
  for (let intento = 0; intento < 300; intento += 1) {
    if (condicion()) return;
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 10));
    });
  }
  throw new Error(`No aparece: ${que}`);
}

async function abrir(ruta: string) {
  window.history.replaceState(null, "", ruta);
  await act(async () => {
    root!.render(createElement(BdbActivosApp));
  });
}

const lista = () => host.querySelector(".buscador-nuevo");
const buscar = () => host.querySelector<HTMLInputElement>('input[type="search"]');
const filas = () => [...host.querySelectorAll(".tabla tbody tr")];
const vuelta = () => host.querySelector<HTMLAnchorElement>(".ficha-pantalla__vuelta");

async function teclear(campo: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function abrirPrimeraFicha() {
  await act(async () => (filas()[0] as HTMLElement).click());
  await esperar(() => host.querySelector(".ficha") !== null, "la ficha");
}

test("/buscador pinta la lista, y solo la lista", async () => {
  await abrir("/buscador");
  await esperar(() => filas().length === 3, "las filas");
  expect(host.querySelector("h1")?.textContent).toBe("Buscador");
  expect(mocks.searchAssets).not.toHaveBeenCalled();
});

test("sin camino al catálogo, /buscador lo dice y no cae a otra pantalla", async () => {
  mocks.disponible.value = false;
  await abrir("/buscador");
  await esperar(() => lista() !== null, "el Buscador");
  expect(host.textContent).toContain("Sin acceso al catálogo");
  expect(mocks.searchAssets).not.toHaveBeenCalled();
});

test("si el catálogo no contesta, lo dice y deja reintentar", async () => {
  mocks.listarTarjetas.mockRejectedValueOnce(new Error("Failed to fetch"));
  await abrir("/buscador");
  await esperar(() => host.textContent?.includes("No hemos podido leer el catálogo") ?? false, "el mensaje");
  const reintentar = [...host.querySelectorAll("button")].find((b) => b.textContent === "Reintentar");
  await act(async () => reintentar!.click());
  await esperar(() => filas().length === 3, "las filas tras reintentar");
  expect(mocks.listarTarjetas).toHaveBeenCalledTimes(2);
});

test("/activo/<ISIN> abre la ficha sola: sin lista, sin catálogo y sin búsqueda", async () => {
  await abrir("/activo/BE0943877671");
  await esperar(() => document.title.startsWith("DPAM B - Bonds Eur Government B EUR Cap"), "el nombre en la pestaña");
  expect(document.title).toBe("DPAM B - Bonds Eur Government B EUR Cap · Independent Private Bankers");
  expect(host.querySelector(".ficha")).not.toBeNull();
  expect(lista()).toBeNull();
  expect(mocks.listarTarjetas).not.toHaveBeenCalled();
  expect(mocks.searchAssets).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/activo/BE0943877671");
});

test("entrando por un enlace directo a la ficha, el menú también lleva al listado", async () => {
  await abrir("/activo/BE0943877671");
  await esperar(() => host.querySelector(".ficha") !== null, "la ficha por enlace directo");
  const menu = host.querySelector<HTMLAnchorElement>('nav.rail-nav a[aria-label="Buscador"]');
  await act(async () => menu!.click());
  await esperar(() => host.querySelector(".ficha") === null && lista() !== null, "el listado tras el menú");
  expect(window.location.pathname + window.location.search).toBe("/buscador");
});

test("la dirección vieja con ?activo= sigue abriendo la ficha", async () => {
  /* Hay enlaces mandados por correo con esa forma. */
  await abrir("/buscador?activo=BE0943877671");
  await esperar(() => host.querySelector(".ficha") !== null, "la ficha desde la dirección vieja");
  expect(window.location.pathname).toBe("/buscador");
});

test("un ISIN que no existe conserva su dirección, lo dice y lleva al Buscador", async () => {
  await abrir("/activo/XX0000000000");
  await esperar(() => host.querySelector("h1")?.textContent === "No encontramos este activo", "el mensaje");
  expect(host.textContent).toContain("XX0000000000 no está en el catálogo");
  expect(window.location.pathname).toBe("/activo/XX0000000000");
  const irAlBuscador = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ir al Buscador");
  await act(async () => irAlBuscador!.click());
  await esperar(() => filas().length > 0, "la lista");
  expect(window.location.pathname).toBe("/buscador");
});

test("buscar también por ticker, que la ficha de una acción ya enseña", async () => {
  await abrir("/buscador");
  await esperar(() => filas().length === 3, "las filas");
  expect(buscar()?.placeholder).toBe("Nombre, ticker o ISIN");
  await teclear(buscar()!, "fdos");
  expect(filas()).toHaveLength(1);
  expect(filas()[0].textContent).toContain("Fondo Dos");
});

test("al volver con el enlace, la búsqueda sigue, y el catálogo no se lee otra vez", async () => {
  await abrir("/buscador");
  await esperar(() => filas().length === 3, "las filas");
  await teclear(buscar()!, "DPAM");
  expect(filas()).toHaveLength(1);

  await abrirPrimeraFicha();
  expect(window.location.pathname).toBe("/activo/BE0943877671");
  expect(vuelta()?.textContent).toContain("Volver a los resultados");

  /* Lo que hace `history.back()`: el navegador cambia la dirección y emite popstate. */
  const atras = vi.spyOn(window.history, "back").mockImplementation(() => {
    window.history.replaceState(null, "", "/buscador");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(async () => vuelta()!.click());
  expect(atras).toHaveBeenCalledTimes(1);
  atras.mockRestore();
  await esperar(() => buscar() !== null, "la lista");
  expect(buscar()!.value).toBe("DPAM");
  expect(filas()).toHaveLength(1);
  expect(mocks.listarTarjetas).toHaveBeenCalledTimes(1);
});

test("el menú también vuelve con la búsqueda, y limpia la dirección", async () => {
  await abrir("/buscador");
  await esperar(() => filas().length === 3, "las filas");
  await teclear(buscar()!, "DPAM");
  await abrirPrimeraFicha();
  const menu = host.querySelector<HTMLAnchorElement>('nav.rail-nav a[aria-label="Buscador"]');
  /* MAR-23: en la ficha, el Buscador sigue marcado, pero la pantalla es la ficha: «location», no «page». */
  expect(menu?.getAttribute("aria-current")).toBe("location");
  await act(async () => menu!.click());
  await esperar(() => buscar() !== null, "la lista");
  expect(buscar()!.value).toBe("DPAM");
  expect(window.location.pathname).toBe("/buscador");
  expect(window.location.search).toBe("");
});

test("una ficha sin pantalla de origen ofrece ir al Buscador", async () => {
  /* Es la que se abre en otra pestaña o desde un correo: no hay adónde volver. */
  await abrir("/activo/BE0943877671");
  await esperar(() => vuelta() !== null, "la vuelta");
  expect(vuelta()?.textContent).toContain("Ir al Buscador");
  expect(vuelta()?.getAttribute("href")).toBe("/buscador");
});
