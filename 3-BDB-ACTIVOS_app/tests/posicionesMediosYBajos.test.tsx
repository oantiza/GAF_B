// @vitest-environment happy-dom

/**
 * Posiciones, hallazgos medios y bajos de la auditoría de frontend:
 * - DIS-13: los dos «Ver» de cada fila no se distinguían, y las alternativas se abrían lejos, sin mover la vista ni el foco.
 * - DIS-24: «Nueva carga» borraba el extracto pegado sin preguntar.
 * - MAR-14 / DIR-10: la pestaña del modo apuntaba con `aria-controls` a un panel que no existía.
 * - DIS-17: el traspaso a Diseño bautizaba la cartera «Extracto externo» y Diseño no decía qué había entrado.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn() }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/core/swapUniverse", () => ({ loadSwapUniverse: () => new Promise(() => undefined) }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { leerNotaDelTraspaso } from "../src/core/notaDelTraspaso";
import type { PositionsPortfolioTransfer } from "../src/core/positionsToPortfolio";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

const EXTRACTO = "ISIN;NOMBRE;IMPORTE EUR\nLU0232524495;Fondo A;1.000,00\nIE00B4L5Y983;ETF B;3.000,00\nXX0000000000;Desconocido;500,00";

function ficha(asset_id: string) {
  return {
    asset_id,
    isin: asset_id,
    display_name: `Posición ${asset_id}`,
    instrument_type: asset_id.startsWith("LU") ? "FUND" : "ETF",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { volatility_3y: 0.1 }
  };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  mocks.resolve.mockReset();
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: p.asset_id.startsWith("XX") ? null : ficha(p.asset_id) }))
  );
  mocks.retro.mockReset();
  mocks.retro.mockResolvedValue(new Map());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function analizar(extra: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      <ClientModeProvider initialValue={false}>
        <PositionsWorkbench mode="extracto" sourceKind="BBDD_LIVE_API" {...extra} />
      </ClientModeProvider>
    );
  });
  const cuadro = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(cuadro, EXTRACTO);
    cuadro.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Analizar cartera")!.click();
  });
  await confirmEurosAndAnalyze(host, "Analizar cartera");
  await act(async () => {
    await new Promise((listo) => setTimeout(listo, 0));
  });
  if (!host.querySelector(".positions-table-panel")) throw new Error("No se ha analizado el extracto");
}

const botonPorNombre = (nombre: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === nombre);

describe("DIS-13 · los dos «Ver» de cada fila", () => {
  test("cada uno dice qué abre y de qué posición", async () => {
    await analizar();
    const nombres = [...host.querySelectorAll(".positions-table-panel tbody tr button")].map((b) => b.getAttribute("aria-label"));
    expect(nombres).toContain("Ver el detalle de Posición LU0232524495");
    expect(nombres).toContain("Ver alternativas a Posición LU0232524495");
    const conNombre = nombres.filter((nombre): nombre is string => Boolean(nombre));
    expect(new Set(conNombre).size).toBe(conNombre.length);
  });

  test("abrir las alternativas lleva el foco a su título", async () => {
    await analizar();
    await act(async () => botonPorNombre("Ver alternativas a Posición LU0232524495")!.click());
    expect(document.activeElement?.id).toBe("positions-alternatives-title");
  });
});

describe("DIS-24 · «Nueva carga» pregunta antes de borrar", () => {
  test("cancelar deja el extracto; confirmar lo borra", async () => {
    await analizar();
    /* Rediseño: «Nueva carga» vive en el menú «Más» de la cabecera. */
    await act(async () => botonPorNombre("Más")!.click());
    await act(async () => botonPorNombre("Nueva carga")!.click());
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    await act(async () => [...dialogo!.querySelectorAll("button")].find((b) => b.textContent === "Cancelar")!.click());
    expect(host.querySelector("textarea")!.value).toBe(EXTRACTO);
    expect(host.querySelector(".positions-table-panel")).not.toBeNull();

    /* Rediseño: «Nueva carga» vive en el menú «Más» de la cabecera. */
    await act(async () => botonPorNombre("Más")!.click());
    await act(async () => botonPorNombre("Nueva carga")!.click());
    const otro = document.querySelector('[role="dialog"]')!;
    const confirmar = [...otro.querySelectorAll("button")].find((b) => b.textContent !== "Cancelar" && b.getAttribute("aria-label") !== "Cerrar");
    await act(async () => confirmar!.click());
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.querySelector(".positions-table-panel")).toBeNull();
  });
});

describe("MAR-14 · la pestaña del modo controla un panel que existe", () => {
  test("el panel lleva el id al que apunta la pestaña, su papel y su nombre", async () => {
    await act(async () => {
      root.render(
        <ClientModeProvider initialValue={false}>
          <PositionsWorkbench mode="extracto" onModeChange={() => undefined} sourceKind="BBDD_LIVE_API" />
        </ClientModeProvider>
      );
    });
    const pestana = host.querySelector("#posiciones-modo-tab-extracto")!;
    const panel = document.getElementById(pestana.getAttribute("aria-controls")!);
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("tabpanel");
    expect(panel!.getAttribute("aria-labelledby")).toBe("posiciones-modo-tab-extracto");
    expect(panel!.querySelector("textarea")).not.toBeNull();
  });
});

describe("DIS-17 · llevar el extracto a Diseño", () => {
  test("la cartera se llama por su fecha y Diseño tiene la nota de lo que entra y lo que no", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 13, 12, 0, 0));
    const onSendToBuilder = vi.fn();
    await analizar({ onSendToBuilder });
    await act(async () => botonPorNombre("Llevar a una propuesta")!.click());
    expect(onSendToBuilder).toHaveBeenCalledTimes(1);
    const enviado = onSendToBuilder.mock.calls[0][0] as PositionsPortfolioTransfer;
    expect(enviado.name).toBe("Extracto del 13/11/2026");
    const nota = leerNotaDelTraspaso(enviado.positions);
    /* Entran 2 posiciones, 1.000 + 3.000 = 4.000 €; se queda fuera la que el catálogo no conoce, con 500 €. */
    expect(nota?.replace(/\u00a0/g, " ")).toBe(
      "Del extracto han entrado 2 posiciones por 4.000 €. Se ha quedado fuera 1 posición (500 €): XX0000000000."
    );
  });
});

/* Rediseño (paso 4): la cabecera lleva las acciones, la banda es la pieza `Respuesta` y los importes se escriben igual en
   los dos modos (sin decimales en la banda, con dos en la tabla). */
describe("Posiciones · rediseño", () => {
  const normal = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");

  test("sin extracto analizado la cabecera no ofrece acciones; analizado, la principal es «Llevar a una propuesta»", async () => {
    await act(async () => {
      root.render(
        <ClientModeProvider initialValue={false}>
          <PositionsWorkbench mode="extracto" onSendToBuilder={vi.fn()} sourceKind="BBDD_LIVE_API" />
        </ClientModeProvider>
      );
    });
    expect(host.querySelector(".ui-page-header .ui-action-toolbar")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await analizar({ onSendToBuilder: vi.fn() });
    const cabecera = host.querySelector(".ui-page-header .ui-action-toolbar")!;
    const botones = [...cabecera.children].filter((n) => n.tagName === "BUTTON").map((b) => ({ texto: b.textContent, clase: b.className }));
    expect(botones[0].texto).toBe("Llevar a una propuesta");
    expect(botones[0].clase).toContain("ui-button--primary");
    expect(botones.map((b) => b.texto)).toContain("Descargar en CSV");
    /* «Nueva carga» no está a la vista junto a las descargas: va en «Más». */
    expect(botones.map((b) => b.texto)).not.toContain("Nueva carga");
    expect(cabecera.querySelector('[aria-haspopup="menu"]')?.textContent).toContain("Más");
    expect(host.querySelector(".ui-eyebrow")?.textContent).toBe("Clientes");
  });

  test("la banda: el patrimonio en grande y sin decimales, y lo interno lleva su distintivo", async () => {
    await analizar();
    const banda = host.querySelector('[role="group"][aria-label="Resumen de posiciones"]')!;
    expect(banda.className).toContain("respuesta");
    const principal = banda.querySelector(".respuesta__dato--principal")!;
    expect(principal.querySelector(".respuesta__rotulo")?.textContent).toBe("Patrimonio total");
    /* 1.000 + 3.000 + 500 = 4.500 €. */
    expect(normal(principal.querySelector(".respuesta__cifra")?.textContent)).toBe("4.500 €");
    const reconocidas = [...banda.querySelectorAll(".respuesta__dato")].find((d) => d.textContent?.includes("Posiciones reconocidas"));
    expect(reconocidas?.querySelector(".respuesta__cifra")?.textContent).toBe("2 de 3");
    /* La retrocesión es del asesor: a su vista, lleva «Interno». */
    const retro = [...banda.querySelectorAll(".respuesta__dato")].find((d) => d.textContent?.includes("Retrocesión media conocida"));
    expect(retro?.querySelector(".distintivo--interno")?.textContent).toBe("Interno");
  });

  test("en la tabla, el importe del extracto lleva dos decimales, como en Posiciones globales", async () => {
    await analizar();
    const fila = [...host.querySelectorAll(".positions-table-panel tbody tr")].find((tr) => tr.textContent?.includes("IE00B4L5Y983"))!;
    expect(normal(fila.textContent)).toContain("3.000,00 €");
  });
});
