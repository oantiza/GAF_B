/**
 * Decisión de Óscar (15-11-2026): un tramo de menos de 330 días no se anualiza.
 *
 * El servidor manda `cagr` y `sharpe` vacíos y la rentabilidad del periodo con sus fechas; el adaptador acepta esa
 * respuesta y la de un servidor todavía sin actualizar; y el comparador, que recalcula sus cifras con la serie, aplica la
 * misma regla. Cada cifra esperada sale de una cuenta escrita aquí.
 */
import { describe, expect, test } from "vitest";
import { exigeAnualizado, parseBacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import { alignPortfolioComparison, comparisonMetrics, MIN_DIAS_PARA_ANUALIZAR } from "../src/core/portfolioComparison";
import { historiaDeTramo } from "./support/tramoCorto";

function respuesta(metrics: Record<string, unknown>, series = [{ date: "2026-06-05", value: 100 }, { date: "2026-10-02", value: 106 }]) {
  return {
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", frequency: "DAILY", units: "decimal",
    metrics, portfolio_series: series, asset_ids: ["A"], weights_normalized: { A: 1 }, correlation_matrix: [[1]],
    benchmark_series: {}, synthetics: [], coverage: null, excluded_assets: [], warnings: []
  };
}

describe("el adaptador de la simulación", () => {
  test("servidor nuevo, tramo corto: sin anualizar, con la rentabilidad del periodo y sus fechas", () => {
    const parsed = parseBacktestResponse(respuesta({
      cagr: null, volatility: 0.08, sharpe: null, max_drawdown: -0.0192, rf_rate: 0.02,
      cumulative_return: 0.06, period_start: "2026-06-05", period_end: "2026-10-02", period_days: 119, annualized: false
    }));
    expect(parsed.metrics).toMatchObject({ cagr: null, sharpe: null, annualized: false, cumulative_return: 0.06, period_days: 119,
      period_start: "2026-06-05", period_end: "2026-10-02", volatility: 0.08, max_drawdown: -0.0192 });
  });

  test("servidor nuevo, tramo largo: las cifras de siempre y la marca de anualizada", () => {
    const parsed = parseBacktestResponse(respuesta({
      cagr: 0.1004, volatility: 0.1, sharpe: 0.8, max_drawdown: -0.1, rf_rate: 0.02,
      cumulative_return: 0.331, period_start: "2025-01-06", period_end: "2028-01-03", period_days: 1092, annualized: true
    }));
    expect(parsed.metrics).toMatchObject({ cagr: 0.1004, sharpe: 0.8, annualized: true, cumulative_return: 0.331 });
  });

  test("servidor sin actualizar: sin los campos nuevos y con cagr numérico, se acepta tal cual y la rentabilidad del periodo sale de la serie", () => {
    const parsed = parseBacktestResponse(respuesta({ cagr: 0.05, volatility: 0.1, sharpe: 0.3, max_drawdown: -0.12, rf_rate: 0.02 }));
    // 106 / 100 − 1 = 0,06; del 05-06 al 02-10-2026 van 119 días.
    expect(parsed.metrics.cumulative_return).toBeCloseTo(0.06, 12);
    expect(parsed.metrics).toMatchObject({ cagr: 0.05, sharpe: 0.3, annualized: true, period_days: 119, period_start: "2026-06-05", period_end: "2026-10-02" });
  });

  test("un vacío que no cuadra con la marca es contrato roto, no un cero", () => {
    expect(() => parseBacktestResponse(respuesta({ cagr: null, volatility: 0.1, sharpe: null, max_drawdown: 0, rf_rate: 0.02,
      cumulative_return: 0.06, period_start: "a", period_end: "b", period_days: 119, annualized: true }))).toThrow();
    expect(() => parseBacktestResponse(respuesta({ cagr: 0.19, volatility: 0.1, sharpe: 1, max_drawdown: 0, rf_rate: 0.02,
      cumulative_return: 0.06, period_start: "a", period_end: "b", period_days: 119, annualized: false }))).toThrow();
  });

  test("el análisis de 3 y 5 años sigue exigiendo cifras anualizadas", () => {
    const corto = parseBacktestResponse(respuesta({ cagr: null, volatility: 0.1, sharpe: null, max_drawdown: 0, rf_rate: 0.02,
      cumulative_return: 0.06, period_start: "2026-06-05", period_end: "2026-10-02", period_days: 119, annualized: false }));
    expect(() => exigeAnualizado(corto, "backtest")).toThrow(/sin anualizar/);
  });
});

describe("las cifras del comparador", () => {
  test("el umbral es el del servidor", () => {
    expect(MIN_DIAS_PARA_ANUALIZAR).toBe(330);
  });

  test("+6 % en 119 días: rentabilidad del periodo 0,06; anualizada y Sharpe vacíos (antes, 1,06^(365,2425/119) − 1 = 19,58 %)", () => {
    const m = comparisonMetrics(historiaDeTramo(119, 0.06).backtest.portfolio_series, 0.02);
    expect(m.cumulative).toBeCloseTo(0.06, 12);
    expect(m.annualized).toBe(false);
    expect(m.cagr).toBeNull();
    expect(m.sharpe).toBeNull();
    // La volatilidad y la caída máxima se siguen dando: una recta que sube no cae.
    expect(m.volatility).not.toBeNull();
    expect(m.maxDrawdown).toBe(0);
  });

  test("329 días no anualizan; 330 sí, con el CAGR por fechas de siempre", () => {
    const corto = comparisonMetrics(historiaDeTramo(329, 0.1).backtest.portfolio_series, 0.02);
    expect(corto).toMatchObject({ annualized: false, cagr: null, sharpe: null });
    const justo = comparisonMetrics(historiaDeTramo(330, 0.1).backtest.portfolio_series, 0.02);
    expect(justo.annualized).toBe(true);
    // 1,10^(365,2425/330) − 1 = 11,12 %.
    expect(justo.cagr).toBeCloseTo(1.1 ** (365.2425 / 330) - 1, 12);
    expect(justo.sharpe).toBeCloseTo((justo.cagr! - 0.02) / justo.volatility!, 12);
  });

  test("tres años: nada cambia", () => {
    const m = comparisonMetrics(historiaDeTramo(1092, 0.331).backtest.portfolio_series, null);
    expect(m.annualized).toBe(true);
    // 1,331^(365,2425/1092) − 1 = 10,04 %.
    expect(m.cagr).toBeCloseTo(1.331 ** (365.2425 / 1092) - 1, 12);
    expect(m.cumulative).toBeCloseTo(0.331, 12);
  });

  test("la comparación de dos tramos cortos lo dice, con los días y las fechas", () => {
    const result = alignPortfolioComparison(historiaDeTramo(119, 0.06, "A"), historiaDeTramo(119, 0.03, "B"), "10Y");
    expect(result.annualized).toBe(false);
    expect(result.periodDays).toBe(119);
    expect(result.metricsA.cagr).toBeNull();
    expect(result.metricsB.sharpe).toBeNull();
    expect(result.notes.join(" ")).toContain("comparten 119 días, menos de un año");
    expect(result.notes.join(" ")).toContain(`rentabilidad del periodo, ${result.rangeLabel}`);
    expect(result.notes.join(" ")).not.toContain("no llegan a tres semanas");
  });
});
