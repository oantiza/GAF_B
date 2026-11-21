// @vitest-environment happy-dom

/**
 * DIS-05: un peso por encima de 100 se recortaba a 100 en silencio, y «12.500» (punto de miles para el lector común) se
 * leía como doce mil quinientos y acababa también en 100. Ahora no se aplica, y junto al campo se dice qué se ha leído.
 *
 * DIS-09: mientras llegan las fichas, la tabla nombraba cada posición por su ISIN aunque la posición trajera su nombre, y
 * «Producto · clase» decía lo mismo que cuando el dato no existe.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "LU1234567891", label: "Fondo Europa", weight_percent: 60 },
  { asset_id: "IE00B4L5Y983", label: "ETF Mundo", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(extra: Record<string, unknown> = {}) {
  const onWeightChange = vi.fn();
  await act(async () => {
    root.render(
      createElement(PortfolioPositionsTable, {
        assets: [],
        positions: POSICIONES,
        totalCapital: 100000,
        locks: {},
        onRemove: () => undefined,
        onWeightChange,
        onEuroChange: () => undefined,
        onToggleLock: () => undefined,
        ...extra
      })
    );
  });
  return onWeightChange;
}

async function escribirPeso(nombre: string, texto: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="Peso de ${nombre}"]`);
  if (!input) throw new Error(`No aparece el peso de ${nombre}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  await act(async () => {
    setter.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("DIS-05 · un peso de más de 100 no se aplica", () => {
  test("«150» no cambia el peso y se avisa junto al campo", async () => {
    const onWeightChange = await montar();
    await escribirPeso("Fondo Europa", "150");
    expect(onWeightChange).not.toHaveBeenCalled();
    const aviso = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(aviso).toContain("150\u00a0%");
    expect(aviso).toContain("no ha cambiado");
  });

  test("«12.500» dice que se ha leído como 12.500 y cómo escribir decimales", async () => {
    const onWeightChange = await montar();
    await escribirPeso("Fondo Europa", "12.500");
    expect(onWeightChange).not.toHaveBeenCalled();
    const aviso = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(aviso).toContain("12.500\u00a0%");
    expect(aviso).toContain("12,5");
  });

  test("un peso válido se aplica y el aviso se va", async () => {
    const onWeightChange = await montar();
    await escribirPeso("Fondo Europa", "150");
    await escribirPeso("Fondo Europa", "12,5");
    expect(onWeightChange).toHaveBeenCalledWith("LU1234567891", 12.5);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("DIS-09 · sin fichas todavía", () => {
  test("cada posición se nombra por su nombre, no por su ISIN", async () => {
    await montar();
    const nombres = [...host.querySelectorAll(".cell-entity__name a, .cell-entity__name button")].map((nodo) => nodo.textContent);
    expect(nombres).toEqual(["Fondo Europa", "ETF Mundo"]);
  });

  test("mientras se leen las fichas, «Producto · clase» dice que se están leyendo", async () => {
    await montar({ cargandoFichas: true });
    const celdas = [...host.querySelectorAll("tbody tr")].map((fila) => fila.querySelectorAll("td")[1]?.textContent ?? "");
    expect(celdas.every((texto) => texto.includes("Leyendo…"))).toBe(true);
  });
});
