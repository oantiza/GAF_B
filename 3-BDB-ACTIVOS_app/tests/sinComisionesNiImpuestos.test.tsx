// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { FundSwapModal } from "../src/components/FundSwapModal";
import { MacroAllocationPanel } from "../src/components/MacroAllocationPanel";
import { OptimizationReviewDialog } from "../src/components/OptimizationReviewDialog";
import { SE_QUEDA_SIEMPRE } from "../src/core/modoCliente";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../src/core/textosDeCartera";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

vi.mock("../src/core/useCommercialRetroData", () => ({
  useCommercialRetroData: () => ({ records: new Map(), error: null, retry: () => undefined })
}));

/**
 * Decisión 45 de Óscar (05-11-2026): antes de aplicar una propuesta se dice lo que no incluye, también en Modo cliente,
 * con una sola redacción, provisional hasta que la revise cumplimiento. Mejorar cartera se comprueba en su propia prueba.
 */
const RAIZ_SRC = join(process.cwd(), "src");

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) ficherosDe(ruta, salida);
    else if (/\.tsx?$/.test(ruta)) salida.push(ruta);
  }
  return salida;
}

const assets = [
  { asset_id: "A", display_name: "Fondo A", instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", metrics: {}, quality_flags: [], warnings: [] },
  { asset_id: "B", display_name: "Fondo B", instrument_type: "FUND", economic_asset_class: "FIXED_INCOME", currency: "EUR", metrics: {}, quality_flags: [], warnings: [] }
] as unknown as BdbAssetDetail[];
const positions = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function pinta(nodo: ReactNode, modoCliente: boolean) {
  await act(async () => root.render(createElement(ClientModeProvider, { initialValue: modoCliente, children: nodo })));
}

const boton = (texto: string) => [...document.querySelectorAll("button")].find((candidato) => candidato.textContent === texto);

describe("la línea, en un solo sitio", () => {
  test("el texto es el que decidió Óscar", () => {
    expect(SIN_COMISIONES_NI_IMPUESTOS).toBe("No incluye comisiones de entrada (suscripción) o salida (reembolso) ni impuestos por el cambio.");
  });

  test("vive en textosDeCartera.ts y en ningún otro fichero de src, con la nota de que es provisional", () => {
    const conElTexto = ficherosDe(RAIZ_SRC).filter((ruta) => readFileSync(ruta, "utf8").includes("comisiones de entrada (suscripción) o salida"));
    expect(conElTexto.map((ruta) => ruta.replace(/\\/g, "/").split("/src/")[1])).toEqual(["core/textosDeCartera.ts"]);
    const fuente = readFileSync(conElTexto[0], "utf8");
    expect(fuente.slice(0, fuente.indexOf("SIN_COMISIONES_NI_IMPUESTOS"))).toMatch(/PROVISIONAL hasta que cumplimiento la revise/);
  });

  test("consta entre lo que Modo cliente no oculta", () => {
    expect(Object.keys(SE_QUEDA_SIEMPRE)).toContain("sinComisionesNiImpuestos");
  });
});

describe.each([
  ["asesor", false],
  ["Modo cliente", true]
])("antes de aplicar, en modo %s", (_modo, modoCliente) => {
  test("Revisar propuesta la lleva junto a «Aplicar optimización»", async () => {
    await pinta(
      createElement(OptimizationReviewDialog, {
        assets,
        positions,
        proposal: { weights: { A: 0.5, B: 0.5 }, context: { source: "Máximo Sharpe" } },
        onCancel: () => undefined,
        onApply: () => undefined
      }),
      modoCliente
    );
    expect(boton("Aplicar optimización")?.closest("footer")?.textContent).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  });

  test("Sustituir la lleva junto a la lista de alternativas", async () => {
    await pinta(
      createElement(FundSwapModal, {
        assets,
        positions,
        totalCapital: 100000,
        onClose: () => undefined,
        onFindAlternatives: async () => [],
        onSwap: () => undefined
      }),
      modoCliente
    );
    expect(boton("Cerrar")?.closest("footer")?.textContent).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  });

  test("Reparte por clase la lleva antes de «Aplicar a la cartera»", async () => {
    await pinta(createElement(MacroAllocationPanel, { assets, positions, onWeightChange: () => undefined }), modoCliente);
    expect(boton("Aplicar a la cartera")).toBeDefined();
    expect(host.textContent).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  });
});
