import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parsePortfolioAnalysisResult } from "../src/adapters/analyzePortfolioBackend";
import { parseBacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import { parseDividendsCalendarResult } from "../src/adapters/dividendsCalendarBackend";
import { parseEconomicCalendarResult } from "../src/adapters/economicCalendarBackend";
import { parseMacroReference } from "../src/adapters/macroReferenceBackend";
import { parseRebasedSeriesResponse } from "../src/adapters/priceSeriesBackend";
import { parseWeeklyReportResponse } from "../src/adapters/weeklyReportBackend";

function expectBackendContractError(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe("BACKEND");
    expect((error as AppError).message).toContain("Contrato de backend inválido");
    return;
  }
  throw new Error("Expected AppError BACKEND");
}

function stressScenario(id: "COVID" | "RATES_2022" | "COMMON_HISTORY") {
  return {
    id,
    label: id,
    configured_start_date: id === "COMMON_HISTORY" ? "2019-01-01" : "2020-02-19",
    configured_end_date: "2026-07-10",
    start_date: "2020-02-19",
    end_date: "2020-03-23",
    trough_date: "2020-03-23",
    common_data_end_date: "2026-07-10",
    drawdown_pct: -21.5,
    duration_days: 33,
    recovery_date: "2020-08-10",
    recovery_days: 140,
    remaining_to_recover_pct: 0,
    recovery_status: "RECOVERED",
    worst_asset: { asset_id: "A", weight_pct: 100, return_pct: -21.5, contribution_pct: -21.5 },
    coverage: { weight_pct: 100, included_assets: 1, total_assets: 1 },
    representative: true,
    included_assets: ["A"],
    excluded_assets: [],
    reason: null
  };
}

describe("callable runtime contract guards", () => {
  test("price_series valida shape minimo y rechaza tipos rotos", () => {
    const ok = parseRebasedSeriesResponse({
      schema_version: "price-series.v1",
      base_currency: "EUR",
      window: "3Y",
      frequency: "WEEKLY",
      rebased_to: 100,
      dates: ["2024-01-05"],
      series: [{ asset_id: "A", display_name: "Activo A", values: [100] }],
      coverage: { requested_assets: 1, included_assets: 1, common_observations: 1, first_date: "2024-01-05", last_date: "2024-01-05" },
      excluded_assets: []
    });
    expect(ok.series[0].values).toEqual([100]);

    expectBackendContractError(() => parseRebasedSeriesResponse({ schema_version: "price-series.v1", dates: "bad" }));
  });

  test("backtest_portfolio valida metricas, series y matriz", () => {
    const raw = {
      schema_version: "backtest.v1",
      base_currency: "EUR",
      window: "1Y",
      frequency: "WEEKLY",
      units: "decimal",
      metrics: { cagr: 0.04, volatility: 0.12, sharpe: 0.3, max_drawdown: -0.1, rf_rate: 0.02 },
      risk_free: {
        risk_free_source: "ECB_ESTR",
        risk_free_rate: 0.028,
        risk_free_rate_policy: "WINDOW_AVERAGE",
        risk_free_first_date: "2023-01-01",
        risk_free_last_date: "2026-01-01",
        risk_free_observations: 750,
        risk_free_coverage_ratio: 1
      },
      portfolio_series: [{ date: "2024-01-05", value: 100 }],
      asset_ids: ["A"],
      weights_normalized: { A: 1 },
      correlation_matrix: [[1]],
      benchmark_series: {},
      synthetics: [],
      stress_scenarios: [stressScenario("COVID"), stressScenario("RATES_2022"), stressScenario("COMMON_HISTORY")],
      coverage: null,
      excluded_assets: [],
      warnings: []
    };
    const ok = parseBacktestResponse(raw);
    expect(ok.metrics.cagr).toBe(0.04);
    expect(ok.risk_free?.risk_free_rate).toBe(0.028);
    expect(ok.risk_free?.risk_free_rate_policy).toBe("WINDOW_AVERAGE");
    expect(ok.stress_scenarios[0].drawdown_pct).toBe(-21.5);
    expect(ok.stress_scenarios[0].coverage.weight_pct).toBe(100);

    const incompleteStress = { ...raw, stress_scenarios: raw.stress_scenarios.slice(0, 2) };
    expectBackendContractError(() => parseBacktestResponse(incompleteStress));
    const incoherentCoverage = {
      ...raw,
      stress_scenarios: raw.stress_scenarios.map((scenario, index) =>
        index === 0
          ? { ...scenario, coverage: { ...scenario.coverage, weight_pct: 59 }, representative: true }
          : scenario
      )
    };
    expectBackendContractError(() => parseBacktestResponse(incoherentCoverage));
    /* Decisión 58: las crisis conocen el motivo de la cuarentena de divisa, y uno desconocido se sigue rechazando. */
    const conMotivo = (reason: string) => ({
      ...raw,
      stress_scenarios: raw.stress_scenarios.map((scenario, index) => (index === 0 ? { ...scenario, excluded_assets: [{ asset_id: "A", reason }] } : scenario))
    });
    expect(parseBacktestResponse(conMotivo("FX_QUARANTINE")).stress_scenarios[0].excluded_assets[0].reason).toBe("FX_QUARANTINE");
    expectBackendContractError(() => parseBacktestResponse(conMotivo("MOTIVO_DESCONOCIDO")));
    /* P1-06 (21-11-2026): la serie parada y el escenario sin caída. Sin ellos, las Functions nuevas tumbaban la respuesta entera. */
    expect(parseBacktestResponse(conMotivo("SERIES_ENDS_EARLY")).stress_scenarios[0].excluded_assets[0].reason).toBe("SERIES_ENDS_EARLY");
    /* N03 (22-11-2026): la posición con un hueco dentro de la crisis. Sin el código, la respuesta entera se rechazaría. */
    expect(parseBacktestResponse(conMotivo("GAP_IN_WINDOW")).stress_scenarios[0].excluded_assets[0].reason).toBe("GAP_IN_WINDOW");
    const sinCaida = {
      ...raw,
      stress_scenarios: raw.stress_scenarios.map((scenario, index) => (index === 0
        ? { ...scenario, drawdown_pct: 0, recovery_status: "NO_DRAWDOWN", recovery_date: null, recovery_days: null, remaining_to_recover_pct: 0, worst_asset: null }
        : scenario))
    };
    expect(parseBacktestResponse(sinCaida).stress_scenarios[0].recovery_status).toBe("NO_DRAWDOWN");
    expect(parseBacktestResponse(sinCaida).stress_scenarios[0].worst_asset).toBeNull();

    expectBackendContractError(() => parseBacktestResponse({ schema_version: "backtest.v1", metrics: { cagr: "bad" } }));
  });

  test("analyze, weekly, calendars y macro lanzan BACKEND con detalle si no cuadran", () => {
    expect(parsePortfolioAnalysisResult({ analysis: null, source: "NOT_CONFIGURED", note: "x" }).source).toBe("NOT_CONFIGURED");
    expectBackendContractError(() => parsePortfolioAnalysisResult({ analysis: 12, source: "X" }));

    expect(parseWeeklyReportResponse({ report: null, source: "EMPTY" }).report).toBeNull();
    expectBackendContractError(() => parseWeeklyReportResponse({ report: { id: "r1" }, source: "FIRESTORE_LIVE" }));

    expect(parseDividendsCalendarResult({ items: [], source: "YAHOO_LIVE", from: "2026-07-02", to: "2026-09-30" }).items).toEqual([]);
    expectBackendContractError(() => parseDividendsCalendarResult({ items: {}, source: "YAHOO_LIVE" }));

    expect(parseEconomicCalendarResult({ events: [], source: "FOREXFACTORY_LIVE" }).events).toEqual([]);
    expectBackendContractError(() => parseEconomicCalendarResult({ events: [{ actual: { nested: true } }], source: "FOREXFACTORY_LIVE" }));

    expect(parseMacroReference({ inflation_annual_pct: null, inflation_total_pct: null, letras_avg_rate_pct: null, source: "INE", notes: "" }).source).toBe("INE");
    expectBackendContractError(() => parseMacroReference({ inflation_annual_pct: "3.2", source: "INE" }));
  });
});
