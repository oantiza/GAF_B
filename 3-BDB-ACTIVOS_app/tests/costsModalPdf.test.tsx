// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * ANA-28 (auditoría de frontend, 13-11-2026): en el cuadro de costes, el fallo del PDF salía como un mensaje técnico en el pie, sin
 * «Reintentar», y el diálogo se podía cerrar mientras se generaba. Ahora va dentro, con la pieza de los demás diálogos de informe, y
 * mientras se genera no se cierra.
 */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../src/reports/costsPdf", () => ({ downloadCostsPdf: mocks.download }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: async () => new Map(), saveCommercialRetro: vi.fn(), assetCommercialRetroKey: () => null
}));

import { CostsModal } from "../src/components/CostsModal";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";

let contenedor: HTMLDivElement;
let raiz: Root;
const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === texto);
const pulsar = (b: HTMLElement) => act(async () => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const esperar = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.download.mockReset();
  contenedor = document.body.appendChild(document.createElement("div"));
  raiz = createRoot(contenedor);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("el PDF del cuadro de costes", () => {
  test("si falla, lo dice dentro del diálogo, con «Reintentar», y reintentar repite la descarga", async () => {
    mocks.download.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(undefined);
    await act(async () => raiz.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await pulsar(boton("Descargar el informe")!);
    await esperar();
    const aviso = document.querySelector('[role="dialog"] .async-error-banner');
    expect(aviso).not.toBeNull();
    expect(aviso!.closest(".ui-dialog__footer, footer")).toBeNull();
    expect(document.body.textContent).not.toContain("Failed to fetch");
    await pulsar(boton("Reintentar")!);
    await esperar();
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"] .async-error-banner')).toBeNull();
  });

  test("mientras se genera no se cierra: ni con Escape, ni con la X, ni con «Cerrar»", async () => {
    let terminar: () => void = () => undefined;
    mocks.download.mockImplementationOnce(() => new Promise<void>((resolve) => { terminar = resolve; }));
    const cerrar = vi.fn();
    await act(async () => raiz.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={cerrar} />));
    await pulsar(boton("Descargar el informe")!);
    await esperar();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.querySelector('[aria-label="Cerrar"]')).toBeNull();
    expect(boton("Cerrar")?.disabled).toBe(true);
    await act(async () => {
      dialogo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cerrar).not.toHaveBeenCalled();
    await act(async () => terminar());
    await esperar();
    expect(boton("Cerrar")?.disabled).toBe(false);
  });
});
