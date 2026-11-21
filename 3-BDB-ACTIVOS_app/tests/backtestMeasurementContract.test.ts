/**
 * El backtest declara COMO ha medido cada cosa.
 *
 * `frequency` es la serie que se dibuja; `metrics_frequency` con que se han
 * medido CAGR, volatilidad, Sharpe y la correlacion (siempre semanal); y
 * `max_drawdown_frequency` sobre que serie se ha leido la maxima caida (la
 * dibujada, para que el numero impreso coincida con el grafico).
 */
import { describe, expect, test, vi } from "vitest";

const callBackend = vi.fn();
vi.mock("../src/adapters/callableBackend", () => ({
  callBackend: (...args: unknown[]) => callBackend(...args)
}));

const { fetchBacktest, parseBacktestResponse } = await import("../src/adapters/backtestPortfolioBackend");

function respuesta(extra: Record<string, unknown> = {}) {
  return {
    schema_version: "backtest.v1",
    base_currency: "EUR",
    window: "3Y",
    frequency: "DAILY",
    units: "decimal",
    metrics: { cagr: 0.05, volatility: 0.1, sharpe: 0.3, max_drawdown: -0.12, rf_rate: 0.02 },
    portfolio_series: [{ date: "2026-01-05", value: 100 }],
    asset_ids: ["A"],
    weights_normalized: { A: 1 },
    correlation_matrix: [[1]],
    benchmark_series: {},
    synthetics: [],
    coverage: null,
    excluded_assets: [],
    ...extra
  };
}

describe("contrato de medicion del backtest", () => {
  test("lee las dos frecuencias declaradas por el backend", () => {
    const parsed = parseBacktestResponse(respuesta({ metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY" }));
    expect(parsed.frequency).toBe("DAILY");
    expect(parsed.metrics_frequency).toBe("WEEKLY");
    expect(parsed.max_drawdown_frequency).toBe("DAILY");
  });

  test("sin los campos nuevos cae a la frecuencia de la serie: el backend viejo medía así", () => {
    const parsed = parseBacktestResponse(respuesta());
    expect(parsed.metrics_frequency).toBe("DAILY");
    expect(parsed.max_drawdown_frequency).toBe("DAILY");
  });

  test("una frecuencia desconocida es contrato invalido, no un valor por defecto", () => {
    expect(() => parseBacktestResponse(respuesta({ metrics_frequency: "MONTHLY" }))).toThrow();
  });

  test("por defecto se pide la serie diaria: el grafico manda", async () => {
    callBackend.mockResolvedValueOnce(respuesta({ metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY" }));
    await fetchBacktest([{ asset_id: "A", weight: 1 }], "3Y");
    expect(callBackend).toHaveBeenCalledWith(
      "backtest_portfolio",
      // 06-09-2026: por defecto entra TODA la cartera. Apartar activos por histórico
      // corto es una decisión del asesor, nunca el comportamiento por omisión.
      { positions: [{ asset_id: "A", weight: 1 }], period: "3Y", frequency: "DAILY", min_history: "NONE" },
      expect.any(String),
      // La misma espera que el servidor (hallazgo 14, 15-11-2026).
      { timeout: 300_000 }
    );
  });

  test("con la ventana forzada se pide apartar los activos que no la cubren", async () => {
    callBackend.mockResolvedValueOnce(respuesta({ metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY" }));
    await fetchBacktest([{ asset_id: "A", weight: 1 }], "5Y", "DAILY", "ENFORCE");
    expect(callBackend).toHaveBeenCalledWith(
      "backtest_portfolio",
      { positions: [{ asset_id: "A", weight: 1 }], period: "5Y", frequency: "DAILY", min_history: "ENFORCE" },
      expect.any(String),
      // La misma espera que el servidor (hallazgo 14, 15-11-2026).
      { timeout: 300_000 }
    );
  });
});
