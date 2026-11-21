// @vitest-environment happy-dom

/**
 * ACT-01, cerrado con la decisión de Óscar del 14-11-2026: al pulsar «Añadir», el Buscador decide con el activo que sirve
 * el servidor, como la ficha y el Comparador.
 *
 * La base que lee el Buscador no lleva las marcas del equipo (suspendido, cerrado a suscripciones, bloqueado por calidad
 * del dato): solo dice si cotiza. Por eso el Buscador añadía, sin decir nada, lo que la ficha del mismo activo marcaba
 * «No disponible» o «No se puede proponer». Ahora pregunta al servidor al pulsar:
 *
 *  - lo que no está disponible no se añade, y se dice por qué;
 *  - lo bloqueado por calidad del dato **se añade, y se avisa** («Sin datos fiables para medirlo»);
 *  - si el servidor no contesta, se decide con lo que dice la base, como antes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listarTarjetas: vi.fn(), leerDocumento: vi.fn(), getAssetDetail: vi.fn(), getAssetDataSource: vi.fn() }));

vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  listarTarjetas: mocks.listarTarjetas,
  leerDocumento: mocks.leerDocumento
}));

vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: mocks.getAssetDataSource }));

import { olvidarCatalogoEnSesion } from "../src/adapters/catalogoEnSesion";
import { BuscadorNuevoPage } from "../src/pages/BuscadorNuevoPage";

const ACCION = {
  instrument_id: "ES0110047919",
  instrument_type: "STOCK",
  identity: { name: "Deoleo S.A", currency: "EUR" },
  classification: { asset_class: "EQUITY" },
  availability: { state: "TRADING" }
};

/** El activo como lo manda el servidor: lo justo para la regla del botón. */
const delServidor = (extra: { is_investable?: boolean; quality_flags?: string[] }) => ({
  asset_id: ACCION.instrument_id,
  display_name: ACCION.identity.name,
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: [],
  ...extra
});

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  olvidarCatalogoEnSesion();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listarTarjetas.mockResolvedValue([ACCION]);
  mocks.leerDocumento.mockResolvedValue({ availability: { state: "TRADING" } });
  mocks.getAssetDataSource.mockReturnValue({ getAssetDetail: mocks.getAssetDetail });
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

async function pulsarAnadir(props: Record<string, unknown> = { sourceKind: "BBDD_LIVE_API" }) {
  const anadidos: string[] = [];
  await act(async () => {
    root!.render(createElement(BuscadorNuevoPage, { onAnadirACartera: (isin: string) => anadidos.push(isin), ...props }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  const boton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Añadir");
  await act(async () => boton!.click());
  await act(async () => {
    await Promise.resolve();
  });
  return anadidos;
}

const aviso = () => host.querySelector(".buscador-nuevo__aviso")?.textContent ?? null;
const botonDeLaFila = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find((b) => !b.classList.contains("tabla__favorito"))!;

describe("al pulsar Añadir, el Buscador decide con el activo que sirve el servidor", () => {
  test("lo bloqueado por calidad del dato se añade, y se avisa", async () => {
    /* La forma real de Deoleo: el servidor lo manda «no invertible» con la marca de calidad. */
    mocks.getAssetDetail.mockResolvedValue(delServidor({ is_investable: false, quality_flags: ["QUALITY_BLOCKED"] }));
    const anadidos = await pulsarAnadir();
    expect(mocks.getAssetDetail).toHaveBeenCalledWith("ES0110047919");
    expect(anadidos).toEqual(["ES0110047919"]);
    expect(aviso()).toBe("Deoleo S.A, añadido. Sin datos fiables para medirlo: queda fuera de las métricas de la cartera.");
  });

  test.each([
    ["suspendido", "NON_INVESTABLE_SUSPENDED", "Deoleo S.A. Suspendido de cotización: no admite nuevas selecciones."],
    ["cerrado a nuevas suscripciones", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", "Deoleo S.A. Clase cerrada a nuevas suscripciones."],
    ["excluido de cotización", "NON_INVESTABLE_DELISTED", "Deoleo S.A. Excluido de cotización: no admite nuevas selecciones."]
  ])("lo %s no se añade, y se dice por qué", async (_caso, marca, texto) => {
    mocks.getAssetDetail.mockResolvedValue(delServidor({ is_investable: false, quality_flags: [marca] }));
    const anadidos = await pulsarAnadir();
    expect(anadidos).toEqual([]);
    expect(aviso()).toBe(texto);
    expect(botonDeLaFila().textContent).toBe("No disponible");
    expect(botonDeLaFila().disabled).toBe(true);
  });

  test("lo bloqueado por calidad que además está suspendido no se añade", async () => {
    mocks.getAssetDetail.mockResolvedValue(delServidor({ is_investable: false, quality_flags: ["QUALITY_BLOCKED", "NON_INVESTABLE_SUSPENDED"] }));
    expect(await pulsarAnadir()).toEqual([]);
    expect(aviso()).toContain("Suspendido de cotización");
  });

  test("un activo sin marcas se añade sin ningún aviso", async () => {
    mocks.getAssetDetail.mockResolvedValue(delServidor({}));
    expect(await pulsarAnadir()).toEqual(["ES0110047919"]);
    expect(aviso()).toBeNull();
  });

  test("si el servidor no contesta, se decide con lo que dice la base, como antes", async () => {
    mocks.getAssetDetail.mockRejectedValue(new Error("Failed to fetch"));
    expect(await pulsarAnadir()).toEqual(["ES0110047919"]);
    expect(aviso()).toBeNull();
  });

  test("si el servidor no conoce el activo, también decide la base", async () => {
    mocks.getAssetDetail.mockResolvedValue(null);
    expect(await pulsarAnadir()).toEqual(["ES0110047919"]);
  });

  test("sin fuente no se pregunta al servidor", async () => {
    expect(await pulsarAnadir({})).toEqual(["ES0110047919"]);
    expect(mocks.getAssetDataSource).not.toHaveBeenCalled();
    expect(mocks.getAssetDetail).not.toHaveBeenCalled();
  });

  test("lo que dice la base sigue mandando: lo que dejó de cotizar no se añade aunque el servidor no ponga marca", async () => {
    mocks.leerDocumento.mockResolvedValue({ availability: { state: "DELISTED", since: "2026-09-21" } });
    mocks.getAssetDetail.mockResolvedValue(delServidor({}));
    expect(await pulsarAnadir()).toEqual([]);
    expect(aviso()).toContain("dejó de cotizar");
  });
});
