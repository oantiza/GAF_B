// @vitest-environment happy-dom
/**
 * El nombre del eje vertical de la frontera compacta (lateral de Componer, 18-11-2026, dirección A).
 *
 * En 220 px de alto «Rentabilidad anualizada estimada» no cabe y salía cortado: la versión compacta dibuja uno corto,
 * «Rent. anualizada estimada» (medido en la pantalla: 143 px en un trazado de 150), y la tabla alternativa, que es la que
 * se lee sin ver el gráfico, conserva el nombre entero. «Rent. anual.» no vale: «anual» no es «anualizada».
 */
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

/* Sin maquetación, ResponsiveContainer mide 0 y no pinta: aquí da un tamaño fijo a su hijo (como en chartsAccessibility). */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 320, height: 220 }) : null
  };
});

import { parsePortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { HorizonFrontier } from "../src/components/PortfolioHorizonPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = ["A", "B"];

/** Una respuesta del servidor con frontera, dos activos y tres años de serie semanal. */
function respuesta(): Record<string, unknown> {
  const primera = Date.UTC(2023, 8, 1);
  const serie = Array.from({ length: 158 }, (_, i) => ({ date: new Date(primera + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 + i / 4 }));
  const cobertura = { requested_assets: 2, included_assets: 2, common_observations: serie.length, first_date: serie[0].date, last_date: serie.at(-1)!.date };
  const simulacion = (pesos: Record<string, number>) => ({
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", units: "decimal", frequency: "DAILY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY",
    metrics: { cagr: 0.1, volatility: 0.08, sharpe: 1, max_drawdown: -0.1, rf_rate: 0.02 }, portfolio_series: serie,
    asset_ids: IDS, weights_normalized: pesos, correlation_matrix: [[1, 0.2], [0.2, 1]], benchmark_series: {}, synthetics: [],
    coverage: cobertura, excluded_assets: [], warnings: []
  });
  const punto = (er: number, vol: number, weights: Record<string, number>) => ({ expected_return: er, volatility: vol, sharpe_ratio: (er - 0.02) / vol, weights });
  const propuestas = { A: 0.55, B: 0.45 };
  const frontera = {
    schema_version: "portfolio-frontier.v1", as_of_date: serie.at(-1)!.date, units: "decimal", base_currency: "EUR",
    methodology: { window: "3Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR", risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: cobertura,
    current_portfolio: punto(0.06, 0.07, { A: 0.5, B: 0.5 }),
    min_volatility_portfolio: punto(0.05, 0.09, propuestas),
    max_sharpe_portfolio: punto(0.08, 0.11, propuestas),
    target_portfolio: punto(0.07, 0.1, propuestas),
    frontier: [punto(0.05, 0.09, propuestas), punto(0.08, 0.11, propuestas)],
    excluded_assets: [], warnings: [],
    risk_contributions: [{ asset_id: "A", weight_pct: 50, risk_pct: 60 }, { asset_id: "B", weight_pct: 50, risk_pct: 40 }],
    risk_contributions_meta: { cov_model: "LEDOIT_WOLF" }
  };
  return {
    schema_version: "portfolio-horizon.v1", window: "3Y", horizon_years: 3, reference_version: "test",
    backtest: simulacion({ A: 0.5, B: 0.5 }), equal_weight: simulacion({ A: 0.5, B: 0.5 }), max_sharpe: simulacion(propuestas),
    frontier: frontera, frontier_unavailable_reason: null, coverage_weight_percent: 100, extensions: [], methodology: ""
  };
}

async function montar(compacta: boolean): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(HorizonFrontier, { analysis: parsePortfolioHorizon(respuesta(), "3Y"), compacta })));
  return host;
}

const textosDelGrafico = (host: HTMLElement) => [...host.querySelectorAll("svg text")].map((texto) => texto.textContent?.trim() ?? "");
const cabecerasDeLaTabla = (host: HTMLElement) => [...host.querySelectorAll("table th")].map((celda) => celda.textContent?.trim() ?? "");

describe("la frontera compacta nombra su eje vertical entero", () => {
  test("el gráfico dibuja el rótulo corto, y la tabla alternativa conserva el nombre entero", async () => {
    const host = await montar(true);
    expect(textosDelGrafico(host)).toContain("Rent. anualizada estimada");
    expect(textosDelGrafico(host)).not.toContain("Rentabilidad anualizada estimada");
    expect(textosDelGrafico(host).join(" ")).not.toContain("anual.");
    expect(cabecerasDeLaTabla(host)).toContain("Rentabilidad anualizada estimada");
    host.remove();
  });

  test("la frontera entera, fuera del lateral, dibuja el nombre largo", async () => {
    const host = await montar(false);
    expect(textosDelGrafico(host)).toContain("Rentabilidad anualizada estimada");
    expect(cabecerasDeLaTabla(host)).toContain("Rentabilidad anualizada estimada");
    host.remove();
  });
});
