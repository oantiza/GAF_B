// @vitest-environment happy-dom

/**
 * Decisión A-124: el botón de la cabecera de la ficha imprime lo que la pantalla enseña. El papel recibe el MISMO modelo, compuesto con
 * el mismo `modoCliente`, y la evolución que la ficha tiene cargada; el generador se carga al pulsar.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { componerFicha } from "../src/adapters/componerFicha";
import type { EvolucionDeLaFicha } from "../src/types/fichaInstrumento";

const EVOLUCION: EvolucionDeLaFicha = { procedencia: "Base 100 · diaria", fechas: ["2026-01-02", "2026-01-05"], valores: [100, 101], variacion: "+1,0 %" };

const mocks = vi.hoisted(() => ({
  leerInstrumento: vi.fn(),
  getAssetDetail: vi.fn(),
  descargar: vi.fn(),
  evolucion: { value: null as EvolucionDeLaFicha | null }
}));

vi.mock("../src/adapters/baseNuevaLectura", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/baseNuevaLectura")>()),
  BASE_NUEVA_DISPONIBLE: true,
  leerInstrumento: mocks.leerInstrumento
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getAssetDetail: mocks.getAssetDetail, getAssetHoldings: async () => null })
}));
vi.mock("../src/components/AssetHistoryChart", async () => {
  const { useEffect } = await import("react");
  return {
    AssetHistoryChart: ({ alCargar }: { alCargar?: (e: EvolucionDeLaFicha | null) => void }) => {
      useEffect(() => alCargar?.(mocks.evolucion.value), [alCargar]);
      return createElement("output", { id: "evolucion" }, "Evolución");
    }
  };
});
vi.mock("../src/reports/fichaDeActivoPdf", () => ({ downloadFichaDeActivoPdf: mocks.descargar }));

import { FichaDeActivo } from "../src/components/ficha/FichaDeActivo";

const INSTRUMENTO = {
  isin: "LU1295551144",
  raiz: { identity: { name: "Un fondo de prueba", currency: "EUR" }, instrument_type: "FUND" },
  tarjeta: { instrument_id: "LU1295551144", computed_at: "2026-11-09T14:05:20.205Z" },
  calidad: undefined,
  bloques: { "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING" } }
};

const PROPS = {
  assetId: "LU1295551144",
  sourceKind: "LOCAL_MOCK",
  enCartera: false,
  enComparacion: false,
  comparacionLlena: false,
  onAnadirACartera: () => undefined,
  onAlternarComparacion: () => undefined,
  onIrAlBuscador: () => undefined,
  vuelta: { etiqueta: "Ir al Buscador", direccion: "/buscador", alVolver: () => undefined }
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.leerInstrumento.mockReset().mockResolvedValue(INSTRUMENTO);
  mocks.getAssetDetail.mockReset().mockResolvedValue({ asset_id: "LU1295551144", display_name: "Un fondo", quality_flags: [] });
  mocks.descargar.mockReset().mockResolvedValue(undefined);
  mocks.evolucion.value = EVOLUCION;
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

async function reposar() {
  for (let vuelta = 0; vuelta < 8; vuelta += 1) {
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
  }
}

async function montar(modoCliente: boolean) {
  await act(async () => {
    root!.render(createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(FichaDeActivo, PROPS as never) }));
  });
  await reposar();
}

const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

describe("A-124. El botón de la ficha", () => {
  test("está en la cabecera, junto a los de cartera y comparación", async () => {
    await montar(false);
    const acciones = host.querySelector(".ficha__acciones");
    expect([...(acciones?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim())).toEqual(["Descargar ficha", "Comparar", "Añadir"]);
  });

  for (const modoCliente of [false, true]) {
    test(`imprime el mismo modelo que pinta, con el mismo modo (${modoCliente ? "Modo cliente" : "interno"}), y la evolución cargada`, async () => {
      await montar(modoCliente);
      await act(async () => boton("Descargar ficha")!.click());
      await reposar();
      expect(mocks.descargar).toHaveBeenCalledTimes(1);
      const [input] = mocks.descargar.mock.calls[0];
      expect(input.ficha).toEqual(componerFicha(INSTRUMENTO as never, undefined, { modoCliente }));
      expect(input.modoCliente).toBe(modoCliente);
      expect(input.isin).toBe("LU1295551144");
      expect(input.datosA).toBe("2026-11-09T14:05:20.205Z");
      expect(input.evolucion).toEqual(EVOLUCION);
      expect(input.generado).toBeInstanceOf(Date);
    });
  }

  test("sin evolución cargada, el papel no la recibe", async () => {
    mocks.evolucion.value = null;
    await montar(false);
    await act(async () => boton("Descargar ficha")!.click());
    await reposar();
    expect(mocks.descargar.mock.calls[0][0].evolucion).toBeNull();
  });

  test("si falla, lo dice y el botón vuelve", async () => {
    mocks.descargar.mockRejectedValueOnce(new Error("sin fuentes"));
    await montar(false);
    await act(async () => boton("Descargar ficha")!.click());
    await reposar();
    /* El aviso de error lleva su palabra para el lector de pantalla («Error.») delante del motivo. */
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Error. No se pudo generar la ficha en PDF. Vuelve a intentarlo.");
    expect(boton("Descargar ficha")?.disabled).toBe(false);
  });
});
