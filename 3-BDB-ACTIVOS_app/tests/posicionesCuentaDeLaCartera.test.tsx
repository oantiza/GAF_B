// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* pantalla-1 de las puertas finales (06-11-2026): el detalle de una fila de Posiciones escribía «Cartera publicada: 1 posiciones» con la
   cuenta del proveedor, que en la base nueva es su número de bonos. Ahora lee las líneas de la cartera al abrir el detalle y sigue la regla de
   la ficha y del informe interno (`cuentaQueCuadra`). */

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), retro: vi.fn(), detalle: vi.fn(), cartera: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getAssetDetail: mocks.detalle, getAssetHoldings: mocks.cartera }) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));

import { clearSessionCaches } from "../src/core/sessionCaches";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FONDO = "ES0137397008";
const csv = `CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;${FONDO};Fon Fineco;100.000,00`;
const linea = (codigo: string, i: number) => ({ name: `${codigo} ${i}`, weight_pct: 1, holding_type_code: codigo });
/* Como FON FINECO en 8092: declara 1, y su cartera trae once ETF, cuatro fondos y un bono entre siete líneas de efectivo y dos futuros. */
const LINEAS = [
  ...Array.from({ length: 11 }, (_, i) => linea("FE", i)), ...Array.from({ length: 7 }, (_, i) => linea("C", i)),
  ...Array.from({ length: 4 }, (_, i) => linea("FO", i)), ...Array.from({ length: 2 }, (_, i) => linea("CL", i)), linea("BT", 0)
];

let root: Root;
let view: HTMLDivElement;

async function abrirElDetalle(cliente = false) {
  view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root.render(<ClientModeProvider initialValue={cliente}><PositionsWorkbench mode="extracto" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>));
  const input = view.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, csv);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { [...view.querySelectorAll("button")].find((b) => b.textContent === "Analizar cartera")!.click(); });
  expect(await confirmEurosAndAnalyze(view, "Analizar cartera")).toBe(true);
  const fila = [...view.querySelectorAll(".positions-table-panel .tabla tbody tr")].find((tr) => tr.textContent?.includes(FONDO));
  /* El primer «Ver» de la fila es el del detalle; el segundo, el de las alternativas. */
  const ver = [...(fila?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Ver");
  if (!ver) throw new Error(`No aparece «Ver» en la fila de ${FONDO}`);
  await act(async () => { ver.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  /* Solo la línea del detalle: el resumen de la importación dice «1 posición leída», que es otra cosa. */
  return /Cartera publicada[^·]*· Categoría: [^.]*?EUR/.exec(view.textContent ?? "")?.[0].trim() ?? "(sin detalle)";
}

const detalle = (positionsCount: number) => ({
  asset_id: FONDO, display_name: "FON FINECO PATRIMONIO PERMANENTE, FI", instrument_type: "FUND", category: "Mixtos Flexibles EUR",
  holdings_summary: { has_holdings: true, positions_count: positionsCount, as_of_date: "2026-08-31" }
});

beforeEach(() => {
  clearSessionCaches();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.retro.mockResolvedValue(new Map());
  mocks.resolve.mockImplementation(async (positions: { asset_id: string; amount: number }[]) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: { asset_id: p.asset_id, display_name: "FON FINECO PATRIMONIO PERMANENTE, FI", instrument_type: "FUND" } })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  view.remove();
  clearSessionCaches();
});

describe("Posiciones · el detalle de una fila", () => {
  test.each([["como asesor", false], ["en Modo cliente", true]])("la cuenta que desmienten sus 16 títulos no se escribe, %s", async (_modo, cliente) => {
    mocks.detalle.mockResolvedValue(detalle(1));
    mocks.cartera.mockResolvedValue({ asset_id: FONDO, storage_mode: "SINGLE_DOCUMENT", holdings: LINEAS });
    /* Como en la ficha, no se escribe: queda que la cartera está publicada, sin «N/D» en pantalla. */
    expect(await abrirElDetalle(cliente)).toBe("Cartera publicada · Categoría: Mixtos Flexibles EUR");
    expect(mocks.cartera).toHaveBeenCalledWith(FONDO);
  });

  test("la que cuadra se escribe, en singular si es una", async () => {
    mocks.detalle.mockResolvedValue(detalle(1));
    mocks.cartera.mockResolvedValue({ asset_id: FONDO, storage_mode: "SINGLE_DOCUMENT", holdings: [linea("FO", 0), linea("C", 1)] });
    expect(await abrirElDetalle()).toBe("Cartera publicada: 1 posición · Categoría: Mixtos Flexibles EUR");
  });

  test("si su cartera no llega, el detalle sale igual, con la cuenta del proveedor", async () => {
    mocks.detalle.mockResolvedValue(detalle(25));
    mocks.cartera.mockRejectedValue(new Error("sin red"));
    expect(await abrirElDetalle()).toBe("Cartera publicada: 25 posiciones · Categoría: Mixtos Flexibles EUR");
  });

  test("un fondo sin cartera publicada sigue diciéndolo, y no se le pide", async () => {
    mocks.detalle.mockResolvedValue({ ...detalle(25), holdings_summary: { has_holdings: false } });
    expect(await abrirElDetalle()).toBe("Cartera publicada: Falta el dato · Categoría: Mixtos Flexibles EUR");
    expect(mocks.cartera).not.toHaveBeenCalled();
  });
});
