// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Decisión 36 en Analítica avanzada: por debajo del 80 % del peso, lo dibujado dice que es la parte medida, y lo que se le
 * compara a una cartera entera no se escribe. Las cifras esperadas se calculan a mano con la serie de abajo:
 *
 *   La cartera va de 100 a 110, con un valle de 105 a 94,5: caída máxima −10 %.
 *   La referencia, con sus dos fondos iguales, va de 100 a 120. Diferencial: 110 − 120 = −10,0.
 */
const mocks = vi.hoisted(() => ({ horizonte: vi.fn(), referencia: vi.fn() }));

vi.mock("../src/core/usePortfolioHorizon", () => ({ usePortfolioHorizon: mocks.horizonte }));
vi.mock("../src/core/useSeriesDeReferencia", () => ({ useSeriesDeReferencia: mocks.referencia }));
vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/charts/oaa", () => ({ OaaLineChart: () => null, OaaRiskReturnChart: () => null, OaaCorrelationHeatmap: () => null }));
vi.mock("../src/charts/UnderwaterChart", () => ({ UnderwaterChart: () => null }));
vi.mock("../src/charts/OverlapHeatmap", () => ({ OverlapHeatmap: () => null }));

import { XrayAdvanced } from "../src/components/XrayAdvanced";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const SEMANAS = 60;
const fecha = (semana: number) => new Date(Date.UTC(2024, 0, 5) + semana * 7 * 86400000).toISOString().slice(0, 10);
const VALLE = SEMANAS / 2;
const carteraEn = (semana: number) => {
  if (semana === VALLE) return 94.5;
  if (semana === SEMANAS) return 110;
  return semana < VALLE ? 100 + (5 * semana) / (VALLE - 1) : 105;
};
const serieDeLaCartera = Array.from({ length: SEMANAS + 1 }, (_, semana) => ({ date: fecha(semana), value: carteraEn(semana) }));
const fondoDeReferencia = Array.from({ length: SEMANAS + 1 }, (_, semana) => ({ date: fecha(semana), value: 100 + (20 * semana) / SEMANAS }));

const horizonte = (coverageWeightPercent: number) => ({
  window: "3Y",
  years: 3,
  coverageWeightPercent,
  extensions: [],
  frontier: null,
  backtest: {
    asset_ids: ["A"],
    excluded_assets: coverageWeightPercent < 100 ? [{ asset_id: "B", reason: "QUALITY_BLOCKED" }] : [],
    frequency: "WEEKLY",
    coverage: { requested_assets: 2, included_assets: 1, common_observations: SEMANAS + 1, first_date: fecha(0), last_date: fecha(SEMANAS) },
    metrics: { cagr: 0.03, volatility: 0.04, sharpe: 0.06, max_drawdown: -0.1, rf_rate: 0.02 },
    portfolio_series: serieDeLaCartera,
    correlation_matrix: [[1]]
  }
});

const activo = (asset_id: string) => ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND" }) as unknown as BdbAssetDetail;

let contenedor: HTMLDivElement;
let raiz: Root;

async function pintar(pesoMedido: number) {
  mocks.horizonte.mockReturnValue({ window: "3Y", data: horizonte(pesoMedido), error: undefined, retry: () => undefined });
  mocks.referencia.mockReturnValue({ estado: "lista", series: { rf: fondoDeReferencia, rv: fondoDeReferencia }, reintentar: () => undefined });
  await act(async () =>
    raiz.render(createElement(XrayAdvanced, {
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      assets: [activo("A"), activo("B")]
    }))
  );
}

const texto = (selector: string) => [...contenedor.querySelectorAll(selector)].map((nodo) => (nodo.textContent ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  contenedor = document.body.appendChild(document.createElement("div"));
  raiz = createRoot(contenedor);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  contenedor.remove();
  vi.unstubAllGlobals();
  mocks.horizonte.mockReset();
  mocks.referencia.mockReset();
});

/* Rediseño (14-11-2026): el cierre va en `.analisis-cierre__dato`, con el formato del módulo común —la rentabilidad con dos
   decimales, la diferencia en puntos porcentuales con su unidad (ANA-09)— y «Diferencial» pasa a «Diferencia acumulada». La cifra
   de la caída máxima está en la respuesta de la pantalla y aquí no se repite: el bloque dice cuándo tocó fondo y de qué es la
   curva. Las cifras esperadas no cambian: son las de la serie de arriba, calculadas a mano. */
const FONDO = "02/08/2024"; // la semana 30, el valle: 5 de enero de 2024 más 210 días

describe("Analítica avanzada, por debajo y por encima del 80 % del peso", () => {
  test("con el 40 %: la curva es de la parte medida, la diferencia falta y dice por qué", async () => {
    await pintar(40);
    expect(texto(".analisis-cierre__dato")).toEqual(["Parte medida (40,0 %)110,0 (+10,00 %)", "Equilibrado120,0 (+20,00 %)", "Diferencia acumuladaFalta el dato"]);
    expect(contenedor.querySelector(".analisis-cierre__dato .ausencia--falta")?.textContent).toBe("Falta el dato");
    expect(contenedor.textContent).toContain("La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso.");
    expect(texto(".analisis-caida")[0]).toBe(`De la parte medida (40,0 %). El punto más bajo, el ${FONDO}.`);
  });

  test("con el 79,9 % tampoco", async () => {
    await pintar(79.9);
    expect(texto(".analisis-cierre__dato")[2]).toBe("Diferencia acumuladaFalta el dato");
  });

  test("con el 80 % justo: la cifra, calculada a mano, y sin la nota", async () => {
    await pintar(80);
    expect(texto(".analisis-cierre__dato")).toEqual(["Parte medida (80,0 %)110,0 (+10,00 %)", "Equilibrado120,0 (+20,00 %)", "Diferencia acumulada−10,00 pp"]);
    expect(contenedor.textContent).not.toContain("hace falta al menos el 80 %");
    expect(texto(".analisis-caida")[0]).toBe(`El punto más bajo, el ${FONDO}.`);
  });

  test("con el 100 %: se llama cartera", async () => {
    await pintar(100);
    expect(texto(".analisis-cierre__dato")[0]).toBe("Cartera110,0 (+10,00 %)");
    expect(texto(".analisis-cierre__dato")[2]).toBe("Diferencia acumulada−10,00 pp");
  });
});
