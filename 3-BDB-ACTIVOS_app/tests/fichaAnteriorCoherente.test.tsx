// @vitest-environment happy-dom

/**
 * La ficha anterior, la de respaldo (auditoría de frontend, ACT-07).
 * (a) El recuadro destacado dice qué enseña: el último valor liquidativo o precio, con su divisa, o la
 *     rentabilidad en el año; no «Último dato» para dos magnitudes distintas.
 * (b) Un solo «Coste corriente», con su fuente: antes salía en Resumen y Costes de una fuente y en
 *     Fundamentales de otra, y podían no coincidir.
 * (c) Una acción no tiene pestaña de Costes ni «Comisión de gestión»: no aplica (decisión 17).
 * Lo de «N/D» frente a «Falta el dato» queda para el rediseño.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/components/AssetHistoryChart", () => ({ AssetHistoryChart: () => createElement("output", null, "Evolución") }));

import { AssetDetail } from "../src/components/AssetDetail";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const base = (extra: Record<string, unknown>) =>
  ({
    asset_id: "LU0000000001",
    isin: "LU0000000001",
    display_name: "Un fondo",
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "USD",
    is_investable: true,
    quality_flags: [],
    coverage_status: "FULL",
    metrics: {},
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    description: "",
    ...extra
  }) as unknown as BdbAssetDetail;

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const pintar = async (asset: BdbAssetDetail) => {
  await act(async () => { root!.render(createElement(AssetDetail, { asset })); });
};
const pestana = (texto: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === texto) as HTMLElement | undefined;
/* El recuadro destacado de antes es ahora el primer dato de la banda de la respuesta (rediseño, paso 4). */
const destacado = () => host.querySelector(".respuesta__dato")?.textContent ?? "";
const valorDe = (rotulo: string) =>
  [...host.querySelectorAll("dt")].filter((dt) => dt.textContent?.startsWith(rotulo)).map((dt) => dt.nextElementSibling?.textContent);

test("ACT-07 a: con valor, el recuadro dice que es el último valor liquidativo y en qué divisa", async () => {
  await pintar(base({ performance_preview: { latest_value: 123.456, latest_value_date: "2026-11-12" } }));
  expect(destacado()).toContain("Último valor liquidativo");
  /* El precio, con el formato común: de dos a cuatro decimales, los que tenga (antes se redondeaba a dos). */
  expect(destacado().replace(/\s/g, " ")).toContain("123,456 USD");
  expect(destacado()).not.toContain("Último dato");
});

test("ACT-07 a: sin valor, el recuadro dice que es la rentabilidad en el año", async () => {
  await pintar(base({ metrics: { ytd_return: 0.034 } }));
  expect(destacado()).toContain("Rentabilidad en el año");
  expect(destacado()).not.toContain("Último dato");
});

test("ACT-07 b: un solo coste corriente; el de los fundamentales no se enseña aparte", async () => {
  const asset = base({
    instrument_type: "ETF",
    costs: { ongoing_charge: 0.012 },
    fundamentals_summary: { source: "yahoo", fund_metrics: { ongoing_charge_pct: 0.2 } }
  });
  await pintar(asset);
  /* 0,012 es un 1,20 %. */
  expect(valorDe("Coste corriente").map((t) => t?.replace(/\s/g, " "))).toEqual(["1,20 %"]);
  await act(async () => pestana("Fundamentales")!.click());
  expect(valorDe("Coste corriente")).toEqual([]);
  await act(async () => pestana("Costes")!.click());
  expect(valorDe("Coste corriente").map((t) => t?.replace(/\s/g, " "))).toEqual(["1,20 %"]);
});

test("ACT-07 b: si solo lo traen los fundamentales, ese es el coste, y dice de dónde sale", async () => {
  const asset = base({ instrument_type: "ETF", fundamentals_summary: { source: "yahoo", fund_metrics: { ongoing_charge_pct: 0.2 } } });
  await pintar(asset);
  /* Los fundamentales lo dan en por ciento: 0,2 es un 0,20 %. */
  expect(valorDe("Coste corriente").map((t) => t?.replace(/\s/g, " "))).toEqual(["0,20 % · de los datos del ETF"]);
});

test("ACT-07 c: una acción no tiene pestaña de Costes, y su comisión de gestión no aplica", async () => {
  await pintar(base({ instrument_type: "STOCK", display_name: "Una acción" }));
  expect(pestana("Costes")).toBeUndefined();
  expect(valorDe("Comisión de gestión")).toEqual(["No aplica"]);
});
