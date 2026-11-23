/**
 * Las cuatro correcciones de las notas de Optimizar que aprobó Óscar el 20-11-2026, con respuestas del servidor escritas a mano:
 * (a) «rentabilidades … regularizadas» solo con más de tres activos, que es cuando `estimate_returns` las encoge;
 * (b) el tope dice que un candado puede pasarlo, cuando una posición con candado lo pasa;
 * (c) con rotación máxima, la de mínima volatilidad depende también de la cartera de partida;
 * (d) sobre las tarjetas va la nota del objetivo calculado.
 */
import { describe, expect, test } from "vitest";
import { buildFrontierViewModel, parsePortfolioFrontierResponse } from "../src/adapters/portfolioFrontierAdapter";
import { notaDelMaximoSharpe } from "../src/core/internalPortfolioReport";
import { MIN_VOLATILIDAD, notaDeLaCartera, notaDeLaPropuesta, notaDelObjetivoCalculado } from "../src/core/notaDeLaPropuesta";
import type { FrontierViewModel } from "../src/types/portfolioFrontier";

const punto = (weights: Record<string, number>, expected_return = 0.09) => ({ expected_return, volatility: 0.06, sharpe_ratio: 1.1, weights });

function modelo(methodology: Record<string, unknown>, carteras: { maxSharpe: Record<string, number>; minVol: Record<string, number> }): FrontierViewModel {
  const ids = Object.keys(carteras.maxSharpe);
  return buildFrontierViewModel(parsePortfolioFrontierResponse({
    schema_version: "portfolio-frontier.v1",
    as_of_date: "2026-10-23",
    units: "decimal",
    base_currency: "EUR",
    methodology: {
      window: "3Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR", risk_free_rate: 0.0275, risk_free_rate_policy: "WINDOW_AVERAGE", optimizer: "QP",
      ...methodology
    },
    coverage: { requested_assets: ids.length, included_assets: ids.length, common_observations: 158, first_date: "2023-10-20", last_date: "2026-10-23" },
    current_portfolio: punto(Object.fromEntries(ids.map((id) => [id, 1 / ids.length]))),
    min_volatility_portfolio: punto(carteras.minVol, 0.07),
    max_sharpe_portfolio: punto(carteras.maxSharpe),
    frontier: [punto(carteras.maxSharpe), punto(carteras.maxSharpe, 0.1)],
    excluded_assets: [],
    warnings: []
  }));
}

const CUATRO = { maxSharpe: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 }, minVol: { A: 0.3, B: 0.3, C: 0.2, D: 0.2 } };
const TRES = { maxSharpe: { A: 0.4, B: 0.3, C: 0.3 }, minVol: { A: 0.2, B: 0.4, C: 0.4 } };

describe("(a) qué se regulariza", () => {
  test("con cuatro activos, rentabilidades y covarianza", () => {
    expect(notaDeLaPropuesta(modelo({ weight_bounds: [0, 0.35] }, CUATRO))).toBe(
      "Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, tope del 35,0\u00a0% por posición. Medida luego con la serie real puede quedar por debajo de la cartera actual."
    );
  });
  test("con tres, solo la covarianza, y lo dice", () => {
    expect(notaDeLaPropuesta(modelo({ weight_bounds: [0, 0.4] }, TRES))).toBe(
      "Máximo Sharpe del modelo: covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan), tope del 40,0\u00a0% por posición. Medida luego con la serie real puede quedar por debajo de la cartera actual."
    );
  });
  test("el informe interno dice lo mismo, ventana a ventana si difieren", () => {
    const ventana = (years: 3 | 5, frontier: FrontierViewModel) =>
      ({ horizon: { years, backtest: { metrics: { sharpe: 0.5 } }, maxSharpe: { metrics: { sharpe: 0.6 } }, frontier } }) as unknown as Parameters<typeof notaDelMaximoSharpe>[0][number];
    expect(notaDelMaximoSharpe([ventana(3, modelo({ weight_bounds: [0, 0.4] }, TRES))])).toContain(
      "covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan), tope del 40,0\u00a0% por posición."
    );
    expect(notaDelMaximoSharpe([ventana(3, modelo({ weight_bounds: [0, 0.4] }, TRES)), ventana(5, modelo({ weight_bounds: [0, 0.4] }, CUATRO))])).toContain(
      "Máximo Sharpe del modelo: covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan) a 3 años y rentabilidades y covarianza regularizadas a 5 años, tope del 40,0\u00a0% por posición."
    );
  });
});

describe("(b) un candado por encima del tope", () => {
  /* A, con candado al 50 %: pesa lo mismo en las dos carteras y pasa del tope del 30 % que el modelo pone por defecto. */
  const CON_CANDADO = { maxSharpe: { A: 0.5, B: 0.3, C: 0.2, D: 0 }, minVol: { A: 0.5, B: 0.2, C: 0.1, D: 0.2 } };
  test("se dice en las notas de las carteras y en la del interno", () => {
    const conCandado = modelo({ weight_bounds: [0, 0.3] }, CON_CANDADO);
    expect(notaDeLaPropuesta(conCandado)).toContain("tope del 30,0\u00a0% por posición, que una posición con candado puede superar.");
    expect(notaDeLaCartera(conCandado, MIN_VOLATILIDAD)).toContain("tope del 30,0\u00a0% por posición, que una posición con candado puede superar.");
    const ventana = { horizon: { years: 3, backtest: { metrics: { sharpe: 0.5 } }, maxSharpe: { metrics: { sharpe: 0.6 } }, frontier: conCandado } } as unknown as Parameters<typeof notaDelMaximoSharpe>[0][number];
    expect(notaDelMaximoSharpe([ventana])).toContain("tope del 30,0\u00a0% por posición, que una posición con candado puede superar.");
  });
  test("sin ninguna posición por encima del tope, no", () => {
    expect(notaDeLaPropuesta(modelo({ weight_bounds: [0, 0.35] }, CUATRO))).not.toContain("candado");
  });
});

describe("(c) mínima volatilidad con rotación máxima", () => {
  test("Σ|w − w₀| ≤ 0,30 es un 15,0 % del patrimonio, y depende de la cartera de partida", () => {
    expect(notaDeLaCartera(modelo({ weight_bounds: [0, 0.35], max_turnover: 0.3 }, CUATRO), MIN_VOLATILIDAD)).toBe(
      "Mínima volatilidad del modelo: covarianza regularizada, tope del 35,0\u00a0% por posición. Con una rotación máxima del 15,0\u00a0% del patrimonio, depende también de la cartera de partida. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real."
    );
  });
  test("sin rotación máxima no se dice", () => {
    expect(notaDeLaCartera(modelo({ weight_bounds: [0, 0.35] }, CUATRO), MIN_VOLATILIDAD)).not.toContain("rotación");
  });
});

describe("(d) la nota del objetivo calculado", () => {
  test.each([
    ["MAX_SHARPE", "Máximo Sharpe del modelo:"],
    ["MIN_VOLATILITY", "Mínima volatilidad del modelo:"],
    ["TARGET_RISK", "Posición en la frontera del modelo:"]
  ])("con %s, «%s»", (objective, empieza) => {
    expect(notaDelObjetivoCalculado(modelo({ weight_bounds: [0, 0.35], objective }, CUATRO))?.startsWith(empieza)).toBe(true);
  });
  test("con Rentabilidad objetivo, ninguna: la suya ya la pinta su medida", () => {
    expect(notaDelObjetivoCalculado(modelo({ weight_bounds: [0, 0.35], objective: "TARGET_RETURN" }, CUATRO))).toBeNull();
  });
  test("sin objetivo declarado, la de Máximo Sharpe, como antes", () => {
    expect(notaDelObjetivoCalculado(modelo({ weight_bounds: [0, 0.35] }, CUATRO))?.startsWith("Máximo Sharpe del modelo:")).toBe(true);
  });
});
