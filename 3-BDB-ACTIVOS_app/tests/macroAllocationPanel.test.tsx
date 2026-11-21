// @vitest-environment happy-dom

/**
 * Hallazgo 20, sobre la pantalla: «Aplicar a la cartera» de la asignación táctica. El caso medido con la
 * pantalla real era A con candado al 30 %, B con importe fijo de 30.000 € al 30 % y objetivo 40/60: A
 * pasaba al 20 %, B al 20 % con su importe aún en 30.000 €, y el aviso decía que todo había ido bien.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MacroAllocationPanel } from "../src/components/MacroAllocationPanel";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const activo = (asset_id: string, economic_asset_class: string) => ({ asset_id, economic_asset_class }) as unknown as BdbAssetDetail;
const ACTIVOS = [activo("A", "EQUITY"), activo("B", "EQUITY"), activo("D", "EQUITY"), activo("C", "FIXED_INCOME")];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(positions: BdbManualPortfolioPosition[], locks: Record<string, boolean>) {
  const onWeightChange = vi.fn();
  await act(async () => {
    root.render(createElement(MacroAllocationPanel, { assets: ACTIVOS, positions, locks, onWeightChange }));
  });
  return onWeightChange;
}

function moverDeslizador(etiqueta: string, valor: number) {
  const slider = document.querySelector(`input[aria-label="Peso objetivo ${etiqueta}"]`) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(slider, String(valor));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

const aplicar = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Aplicar a la cartera") as HTMLButtonElement;

describe("«Aplicar a la cartera»", () => {
  test("el caso del hallazgo no se aplica: se dice antes, con la cifra medida", async () => {
    const onWeightChange = await montar(
      [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 30, keepEuros: true, targetEuros: 30000 },
        { asset_id: "C", weight_percent: 40 }
      ],
      { A: true }
    );
    expect(host.textContent).toContain("fijado 60,0\u00a0%");
    await act(async () => moverDeslizador("Renta variable", 40));
    await act(async () => moverDeslizador("Renta fija", 60));
    expect(host.textContent?.replace(/\u00a0/g, " ")).toContain("Renta variable no puede bajar al 40,0 %: el 60,0 % está fijado.");
    expect(aplicar().disabled).toBe(true);
    await act(async () => {
      aplicar().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onWeightChange).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Pesos aplicados");
  });

  test("si cabe, solo se mueve lo libre: lo fijado no recibe ninguna orden", async () => {
    const onWeightChange = await montar(
      [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 30, keepEuros: true, targetEuros: 30000 },
        { asset_id: "D", weight_percent: 10 },
        { asset_id: "C", weight_percent: 30 }
      ],
      { A: true }
    );
    await act(async () => moverDeslizador("Renta variable", 65));
    await act(async () => moverDeslizador("Renta fija", 35));
    expect(aplicar().disabled).toBe(false);
    await act(async () => {
      aplicar().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(Object.fromEntries(onWeightChange.mock.calls)).toEqual({ D: 5, C: 35 });
    expect(host.textContent).toContain("Pesos aplicados");
  });

  test("los objetivos que se están probando sobreviven a cambiar de paso, si la cartera es la misma", async () => {
    const positions = [
      { asset_id: "A", weight_percent: 60 },
      { asset_id: "C", weight_percent: 40 }
    ];
    await montar(positions, {});
    await act(async () => moverDeslizador("Renta variable", 50));
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar(positions, {});
    expect((document.querySelector('input[aria-label="Peso objetivo Renta variable"]') as HTMLInputElement).value).toBe("50");
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar([{ asset_id: "A", weight_percent: 70 }, { asset_id: "C", weight_percent: 30 }], {});
    expect((document.querySelector('input[aria-label="Peso objetivo Renta variable"]') as HTMLInputElement).value).toBe("70");
  });
});
