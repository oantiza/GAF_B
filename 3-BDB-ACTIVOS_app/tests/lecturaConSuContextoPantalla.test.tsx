// @vitest-environment happy-dom

/**
 * Hallazgos 16, 17 y 20 de la auditoría del backend (15-11-2026), en pantalla:
 * - la tabla de Comparar activos (y la de alternativas de Posiciones) dice qué columnas no comparten fecha de corte o base de
 *   rentabilidad, con un margen de una semana para el desfase de refresco;
 * - la ficha anterior pinta el último valor con la divisa de su precio;
 * - las posiciones dicen cuántas son y cuánto cubren, y que la lista está cortada cuando lo está.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/components/AssetHistoryChart", () => ({ AssetHistoryChart: () => createElement("output", null, "Evolución") }));

import { MARGEN_DE_FECHA_DE_CORTE_DIAS, notasDeCorteYBase, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";
import { AssetDetail } from "../src/components/AssetDetail";
import { AssetHoldingsSection } from "../src/components/AssetHoldingsSection";
import { alcanceDeLaCartera } from "../src/core/cuentaDePosiciones";
import type { BdbAssetDetail, BdbAssetHoldings, BdbAssetMetrics, BdbAssetSearchResult } from "../src/types/bdbAssets";

const activo = (nombre: string, metrics: BdbAssetMetrics) =>
  ({ asset_id: nombre, display_name: nombre, instrument_type: "FUND", metrics }) as unknown as BdbAssetSearchResult;
const delServidor = (nombre: string, as_of?: string, return_basis?: string): FuenteDeColumna => ({
  activo: activo(nombre, { annualized_return_3y: 0.05, ...(as_of ? { as_of } : {}), ...(return_basis ? { return_basis } : {}) })
});
const deLaTarjeta = (nombre: string, metrics: Record<string, unknown>): FuenteDeColumna => ({
  activo: activo(nombre, {}),
  tarjeta: { instrument_type: "FUND", metrics: { source: "COMPUTED", method: "EXTRACTOR_MONTHLY_V2", ...metrics } }
});

describe("la nota de fecha de corte y base de rentabilidad", () => {
  test("el margen es de una semana", () => {
    expect(MARGEN_DE_FECHA_DE_CORTE_DIAS).toBe(7);
  });

  test("dentro del margen no dice nada; fuera, nombra a cada uno con su fecha", () => {
    expect(notasDeCorteYBase([delServidor("A", "2026-11-06"), delServidor("B", "2026-11-12")])).toEqual([]);
    const [nota] = notasDeCorteYBase([delServidor("Fondo A", "2026-10-31"), delServidor("Fondo B", "2026-09-30"), delServidor("Acción C", "2026-10-31")]);
    expect(nota).toBe(
      "Las cifras no tienen la misma fecha de corte: Fondo B, a 30/09/2026; Fondo A y Acción C, a 31/10/2026. Una rentabilidad o una volatilidad a otra fecha mide otro periodo, y aquí no se ajusta."
    );
  });

  test("ocho días ya es otra fecha de corte", () => {
    expect(notasDeCorteYBase([delServidor("A", "2026-10-31"), delServidor("B", "2026-11-08")])).toHaveLength(1);
    expect(notasDeCorteYBase([delServidor("A", "2026-10-31"), delServidor("B", "2026-11-07")])).toEqual([]);
  });

  test("con la tarjeta de la base nueva lee la de la tarjeta, que es de donde salen las cifras de su columna", () => {
    const notas = notasDeCorteYBase([
      deLaTarjeta("Fondo", { as_of: "2026-10-31", return_basis: "TOTAL_RETURN" }),
      deLaTarjeta("Otro", { as_of: "2026-10-31", return_basis: "PRICE_RETURN" })
    ]);
    expect(notas).toEqual([
      "Las rentabilidades no miden lo mismo: Fondo, rentabilidad total, con dividendos; Otro, rentabilidad de precio, sin dividendos. Ponerlas en la misma fila no las vuelve comparables."
    ]);
  });

  test("lo que no consta se dice, y sin nada declarado (un servidor anterior) no se avisa de nada", () => {
    expect(notasDeCorteYBase([delServidor("A"), delServidor("B")])).toEqual([]);
    const notas = notasDeCorteYBase([delServidor("A", "2026-10-31", "TOTAL_RETURN"), delServidor("B")]);
    expect(notas).toEqual([
      "No consta a qué fecha están las cifras de B: no se puede afirmar que sea la de las demás.",
      "No consta si las rentabilidades de B incluyen los dividendos: no se puede afirmar que midan lo mismo que las demás."
    ]);
  });

  test("un activo sin ninguna cifra no entra en la cuenta", () => {
    const sinCifras = { activo: activo("Sin cifras", {}) };
    expect(notasDeCorteYBase([delServidor("A", "2026-10-31", "TOTAL_RETURN"), sinCifras])).toEqual([]);
  });
});

/* El formato común separa la unidad con un espacio fino que no parte línea; aquí se lee como un espacio. */
const plano = (texto: string | null) => texto?.replace(/\s/g, " ") ?? null;

describe("el alcance de una lista de posiciones", () => {
  test("con solo las principales, cuántas de cuántas y cuánto cubre la cartera publicada", () => {
    expect(plano(alcanceDeLaCartera({ securities_count: 160, coverage: 0.62, list_scope: "TOP" }, { lineas: 25, titulos: 25 }))).toBe(
      "Solo las 25 principales de 160 posiciones · la cartera publicada cubre el 62,0 % del patrimonio"
    );
  });

  test("con la lista entera, el total de títulos y no el recuento de bonos", () => {
    expect(plano(alcanceDeLaCartera({ securities_count: 243, coverage: 0.301148, list_scope: "FULL" }, { lineas: 260, titulos: 243 }))).toBe(
      "243 posiciones · la cartera publicada cubre el 30,1 % del patrimonio"
    );
  });

  test("un total que desmienten los títulos recibidos no se escribe; sin nada declarado, nada", () => {
    expect(plano(alcanceDeLaCartera({ securities_count: 1, list_scope: "FULL" }, { titulos: 16 }))).toBeNull();
    expect(plano(alcanceDeLaCartera({ coverage: 1 }, {}))).toBe("La cartera publicada cubre el 100,0 % del patrimonio");
    expect(plano(alcanceDeLaCartera(undefined))).toBeNull();
    expect(plano(alcanceDeLaCartera({}, { lineas: 25 }))).toBeNull();
  });
});

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

const ficha = (extra: Record<string, unknown>) =>
  ({
    asset_id: "IE0002PG6CA6",
    isin: "IE0002PG6CA6",
    display_name: "ETF en dólares",
    instrument_type: "ETF",
    economic_asset_class: "EQUITY",
    currency: "USD",
    is_investable: true,
    quality_flags: [],
    coverage_status: "COMPLETE",
    metrics: {},
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    description: "",
    ...extra
  }) as unknown as BdbAssetDetail;

describe("la ficha anterior", () => {
  const destacado = () => (host.querySelector(".respuesta__dato")?.textContent ?? "").replace(/\s/g, " ");

  test("pinta el último precio con la divisa de su precio, no con la de la clase", async () => {
    await act(async () => {
      root!.render(createElement(AssetDetail, { asset: ficha({ performance_preview: { available: true, latest_value: 98.4, latest_value_date: "2026-11-12", latest_value_currency: "EUR" } }) }));
    });
    expect(destacado()).toContain("98,40 €");
    expect(destacado()).not.toContain("USD");
  });

  test("con un servidor anterior, que no manda la divisa del precio, sigue como antes", async () => {
    await act(async () => {
      root!.render(createElement(AssetDetail, { asset: ficha({ performance_preview: { available: true, latest_value: 98.4, latest_value_date: "2026-11-12" } }) }));
    });
    expect(destacado()).toContain("98,40 USD");
  });

  test("la sección de posiciones dice que llegan solo las principales y cuánto cubre la cartera", async () => {
    const lista: BdbAssetHoldings = {
      asset_id: "DE0005318406",
      storage_mode: "SINGLE_DOCUMENT",
      holdings_count: 25,
      securities_count: 243,
      coverage: 0.301148,
      list_scope: "TOP",
      holdings: Array.from({ length: 25 }, (_, n) => ({ name: `Título ${n}`, weight_pct: 1, holding_type_code: "E" }))
    };
    const asset = ficha({ asset_id: "DE0005318406", instrument_type: "FUND", holdings_summary: { has_holdings: true, positions_count: 155 } });
    await act(async () => {
      root!.render(createElement(AssetHoldingsSection, { asset, loadHoldings: async () => lista }));
    });
    await act(async () => {});
    const texto = plano(host.querySelector(".asset-detail-muted")?.textContent ?? "") ?? "";
    expect(texto).toContain("Solo las 25 principales de 243 posiciones");
    expect(texto).toContain("la cartera publicada cubre el 30,1 % del patrimonio");
    expect(texto).not.toContain("155");
  });
});
