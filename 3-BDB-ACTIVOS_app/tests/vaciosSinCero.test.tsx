/**
 * Hallazgos 11, 14 y 15 de la auditoría del backend (15-11-2026), del lado del navegador.
 *
 * 11 · Lo que no se puede calcular llega vacío y se escribe que falta, nunca como un 0: una correlación con una serie plana
 * y un Sharpe con volatilidad cero. Los adaptadores aceptan también un servidor todavía sin actualizar, que manda ceros: un
 * Sharpe 0 con volatilidad 0 se lee como lo que es (no existe); una correlación 0 de un servidor viejo no se puede distinguir
 * de una real y se acepta como 0. Un Sharpe vacío por volatilidad cero no es el tramo corto de la A-150: ahí la cifra está
 * anualizada.
 * 14 · La simulación suelta y el borrador esperan lo mismo que su función en el servidor.
 * 15 · El motivo nuevo de lo apartado tiene su texto en cada lista.
 */
import { describe, expect, test, vi } from "vitest";
const llamada = vi.hoisted(() => ({ callBackend: vi.fn() }));
vi.mock("../src/adapters/callableBackend", () => llamada);
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BACKTEST_TIMEOUT_MS, exigeAnualizado, fetchBacktest, parseBacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import { fetchBorradorDeCartera, GENERADOR_TIMEOUT_MS } from "../src/adapters/generadorBackend";
import { parsePortfolioHorizon, resolveHorizonMetrics } from "../src/adapters/portfolioHorizon";
import { buildFrontierViewModel, parsePortfolioFrontierResponse, reasonLabel } from "../src/adapters/portfolioFrontierAdapter";
import { parseImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import { demoResponse } from "../src/adapters/demoBackend";
import { HorizonMetrics } from "../src/components/PortfolioHorizonPanel";
import { TablaDeMetricasComparativas } from "../src/components/MetricasComparativas";
import { OaaCorrelationHeatmap } from "../src/charts/oaa/OaaCorrelationHeatmap";
import { backtestExclusionLabel } from "../src/core/backtestCoverage";
import { motivoParaElCliente } from "../src/core/parteMedida";
import { rejectionLabel } from "../src/core/portfolioImprovement";
import { correlationSummary } from "../src/core/internalPortfolioReport";

const FALTA = "Falta el dato";

type Tramo = Record<string, unknown>;
/** Lo justo de la respuesta de muestra de «Mejorar» que esta prueba cambia. */
type Demo = { original: { metrics: { confirmation: Tramo } }; proposals: { metrics: { selection: Tramo }; deltas_confirmation: Tramo }[] };

function respuesta(metrics: Record<string, unknown>, correlation_matrix: unknown = [[1, 0.4], [0.4, 1]]) {
  const series = [{ date: "2023-10-06", value: 100 }, { date: "2026-10-02", value: 100 }];
  return {
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", frequency: "WEEKLY", units: "decimal",
    metrics, portfolio_series: series, asset_ids: ["A", "B"], weights_normalized: { A: 0.5, B: 0.5 }, correlation_matrix,
    benchmark_series: {}, synthetics: [], coverage: null, excluded_assets: [], warnings: []
  };
}

const PLANA_NUEVA = { cagr: 0, volatility: 0, sharpe: null, max_drawdown: 0, rf_rate: 0.02,
  cumulative_return: 0, period_start: "2023-10-06", period_end: "2026-10-02", period_days: 1092, annualized: true };

describe("el Sharpe con volatilidad cero", () => {
  test("servidor nuevo: llega vacío, anualizado, y se lee vacío", () => {
    const m = parseBacktestResponse(respuesta(PLANA_NUEVA)).metrics;
    expect(m).toMatchObject({ cagr: 0, volatility: 0, sharpe: null, annualized: true });
  });

  test("servidor sin actualizar: manda un 0 con volatilidad 0, y se lee como lo que es, vacío", () => {
    const m = parseBacktestResponse(respuesta({ cagr: 0, volatility: 0, sharpe: 0, max_drawdown: 0, rf_rate: 0.02 })).metrics;
    expect(m.sharpe).toBeNull();
    const nuevo = parseBacktestResponse(respuesta({ ...PLANA_NUEVA, sharpe: 0 })).metrics;
    expect(nuevo.sharpe).toBeNull();
  });

  test("un Sharpe vacío con volatilidad y anualizado es contrato roto, en las dos formas de respuesta", () => {
    expect(() => parseBacktestResponse(respuesta({ ...PLANA_NUEVA, volatility: 0.1 }))).toThrow(/sharpe/);
    expect(() => parseBacktestResponse(respuesta({ cagr: 0.05, volatility: 0.1, sharpe: null, max_drawdown: 0, rf_rate: 0.02 }))).toThrow(/sharpe/);
  });

  test("con volatilidad el Sharpe es el de siempre", () => {
    expect(parseBacktestResponse(respuesta({ cagr: 0.05, volatility: 0.1, sharpe: 0.3, max_drawdown: -0.1, rf_rate: 0.02 })).metrics.sharpe).toBe(0.3);
  });

  test("el análisis de 3 y 5 años la acepta, y sigue rechazando el tramo sin anualizar", () => {
    const plana = exigeAnualizado(parseBacktestResponse(respuesta(PLANA_NUEVA)), "backtest");
    expect(plana.metrics).toMatchObject({ cagr: 0, sharpe: null });
    const corto = parseBacktestResponse(respuesta({ ...PLANA_NUEVA, cagr: null, period_days: 119, annualized: false }));
    expect(() => exigeAnualizado(corto, "backtest")).toThrow(/sin anualizar/);
  });
});

function horizonte() {
  const first = Date.UTC(2023, 8, 1);
  const portfolio_series = Array.from({ length: 3 * 52 + 2 }, (_, i) => ({ date: new Date(first + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 }));
  const backtest = { schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", units: "decimal", frequency: "WEEKLY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "WEEKLY",
    // El servidor de Simular no manda `annualized`, y uno sin actualizar manda un 0 de Sharpe.
    metrics: { cagr: 0, volatility: 0, sharpe: 0, max_drawdown: 0, rf_rate: 0.02 }, portfolio_series,
    asset_ids: ["A", "B"], weights_normalized: { A: 0.5, B: 0.5 }, correlation_matrix: [[1, null], [null, 1]], benchmark_series: {}, synthetics: [],
    coverage: { requested_assets: 2, included_assets: 2, common_observations: portfolio_series.length, first_date: portfolio_series[0].date, last_date: portfolio_series.at(-1)!.date },
    excluded_assets: [], warnings: [] };
  return { schema_version: "portfolio-horizon.v1", window: "3Y", horizon_years: 3, reference_version: "test", backtest, equal_weight: backtest,
    max_sharpe: null, frontier: null, coverage_weight_percent: 100, extensions: [], methodology: "Prueba" };
}

describe("lo que enseña la pantalla", () => {
  test("Simular: el Sharpe sin volatilidad dice que falta el dato y no 0,00", () => {
    const analysis = parsePortfolioHorizon(horizonte(), "3Y");
    expect(resolveHorizonMetrics(analysis).sharpe.value).toBeNull();
    const html = renderToStaticMarkup(createElement(HorizonMetrics, { analysis }));
    const sharpe = html.slice(html.indexOf("Sharpe 3 años"), html.indexOf("Caída máxima 3 años"));
    expect(sharpe).toContain(FALTA);
    expect(sharpe).not.toContain("0,00");
    expect(analysis.backtest.correlation_matrix).toEqual([[1, null], [null, 1]]);
  });

  test("la Comparativa: un Sharpe vacío no se resta, y la diferencia también falta", () => {
    const html = renderToStaticMarkup(createElement(TablaDeMetricasComparativas, {
      aria: "Prueba", rotuloA: "Actual", rotuloB: "Propuesta",
      a: { cagr: 0, volatility: 0, sharpe: null, max_drawdown: 0 }, b: { cagr: 0.05, volatility: 0.1, sharpe: 0.3, max_drawdown: -0.1 }
    }));
    const fila = html.slice(html.indexOf(">Sharpe<"), html.indexOf("Caída máxima"));
    expect(fila).toContain("Falta");
    expect(fila).toContain("0,30");
    expect(fila).not.toContain("+0,30"); // la diferencia contra un vacío no se escribe
  });

  test("el mapa de correlaciones distingue la casilla vacía de una correlación 0 real", () => {
    const items = [{ key: "A", label: "Fondo A" }, { key: "B", label: "Fondo B" }, { key: "C", label: "Fondo C" }];
    const valor = (i: number, j: number) => (i === j ? 1 : (i === 2 || j === 2) ? null : 0);
    const cells = items.flatMap((row, rowIndex) => items.map((col, columnIndex) => ({ rowKey: row.key, columnKey: col.key, rowLabel: row.label, columnLabel: col.label,
      rowIndex, columnIndex, value: valor(rowIndex, columnIndex) })));
    const html = renderToStaticMarkup(createElement(OaaCorrelationHeatmap, { items, cells }));
    expect(html).toContain("0,00"); // A con B: una correlación 0 de verdad
    expect(html).toContain("Falta"); // C con cualquiera: no se puede calcular
  });

  test("el resumen de correlaciones del informe completo solo cuenta las que se pueden calcular", () => {
    const resumen = correlationSummary(["A", "B", "C"], [[1, 0.6, null], [0.6, 1, null], [null, null, 1]]);
    expect(resumen?.average).toBe(0.6);
    expect(resumen?.highest).toEqual([{ a: "A", b: "B", value: 0.6 }]);
  });
});

describe("la frontera y «Mejorar»", () => {
  const frontera = () => ({
    schema_version: "portfolio-frontier.v1", as_of_date: "2026-06-20", units: "decimal", base_currency: "EUR",
    methodology: { window: "3Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES", risk_free_source: "ECB_ESTR",
      risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE", risk_free_first_date: "2023-06-23", risk_free_last_date: "2026-06-19",
      risk_free_observations: 760, risk_free_coverage_ratio: 1 },
    coverage: { requested_assets: 3, included_assets: 2, common_observations: 156, first_date: "2023-06-23", last_date: "2026-06-19" },
    current_portfolio: { expected_return: 0.0, volatility: 0, sharpe_ratio: null as number | null, weights: { A: 0.5, B: 0.5 } },
    min_volatility_portfolio: { expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } },
    max_sharpe_portfolio: { expected_return: 0.082, volatility: 0.12, sharpe_ratio: 0.52, weights: { A: 0.4, B: 0.6 } },
    frontier: [{ expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } }],
    excluded_assets: [{ asset_id: "C", reason: "REFERENCE_LINK_FAILED" }], warnings: []
  });

  test("el punto de una cartera sin volatilidad no tiene Sharpe, con el servidor nuevo y con el viejo", () => {
    const nuevo = buildFrontierViewModel(parsePortfolioFrontierResponse(frontera()));
    expect(nuevo.current?.sharpeRatio).toBeNull();
    expect(nuevo.current?.sharpeLabel).toBe(FALTA);
    const viejo = frontera(); viejo.current_portfolio.sharpe_ratio = 0;
    expect(buildFrontierViewModel(parsePortfolioFrontierResponse(viejo)).current?.sharpeRatio).toBeNull();
    expect(nuevo.maxSharpe.sharpeRatio).toBe(0.52);
  });

  test("lo apartado porque su referencia no enlaza llega con su motivo y su texto", () => {
    const vista = buildFrontierViewModel(parsePortfolioFrontierResponse(frontera()));
    expect(vista.excluded).toEqual([expect.objectContaining({ assetId: "C", reason: "REFERENCE_LINK_FAILED", reasonLabel: "Su historia no se pudo completar con su referencia" })]);
    expect(reasonLabel("REFERENCE_LINK_FAILED")).not.toMatch(/REFERENCE/);
    expect(backtestExclusionLabel("REFERENCE_LINK_FAILED")).toBe("su historia no se pudo completar con su referencia");
    expect(motivoParaElCliente("REFERENCE_LINK_FAILED")).toContain("referencia");
    expect(rejectionLabel("REFERENCE_LINK_FAILED")).toContain("referencia");
  });

  test("lo apartado porque su serie acaba antes del final del periodo llega con su motivo y su texto (A-161)", () => {
    const vista = buildFrontierViewModel(parsePortfolioFrontierResponse({ ...frontera(), excluded_assets: [{ asset_id: "C", reason: "SERIES_ENDS_EARLY" }] }));
    expect(vista.excluded).toEqual([expect.objectContaining({ assetId: "C", reason: "SERIES_ENDS_EARLY", reasonLabel: "Sus precios acaban antes del final del periodo" })]);
    expect(backtestExclusionLabel("SERIES_ENDS_EARLY")).toBe("sus precios acaban antes del final del periodo");
    /* En el papel va detrás de «por»: «Fuera del cálculo: X, por no tener precios hasta el final del periodo». */
    expect(motivoParaElCliente("SERIES_ENDS_EARLY")).toBe("no tener precios hasta el final del periodo");
    expect(rejectionLabel("SERIES_ENDS_EARLY")).toBe("Sus precios acaban antes del final del periodo");
  });

  test("«Mejorar»: el Sharpe de un tramo sin volatilidad y su diferencia llegan vacíos, también de un servidor viejo", async () => {
    const raw = await demoResponse("improve_portfolio", { positions: [{ asset_id: "A", weight: 0.6 }, { asset_id: "B", weight: 0.4 }], candidates: { B: ["B2"] }, window: "3Y" }) as Demo;
    raw.original.metrics.confirmation = { ...raw.original.metrics.confirmation, volatility: 0, sharpe: 0 };
    raw.proposals[0].metrics.selection = { ...raw.proposals[0].metrics.selection, volatility: 0, sharpe: null };
    raw.proposals[0].deltas_confirmation.sharpe = null;
    const parsed = parseImprovementResponse(raw);
    expect(parsed.original?.metrics.confirmation.sharpe).toBeNull();
    expect(parsed.proposals[0].metrics.selection.sharpe).toBeNull();
    expect(parsed.proposals[0].deltas_confirmation.sharpe).toBeNull();
    // Con volatilidad, un Sharpe vacío no se acepta.
    raw.proposals[0].metrics.selection = { ...raw.proposals[0].metrics.selection, volatility: 0.1, sharpe: null };
    expect(() => parseImprovementResponse(raw)).toThrow();
  });

  test("«Mejorar»: el candidato sin correlación calculable tiene su texto", () => {
    expect(rejectionLabel("CORRELATION_UNAVAILABLE")).toContain("correlación no calculable");
  });
});

describe("las esperas del navegador (hallazgo 14)", () => {
  test("la simulación suelta espera 300 s y el borrador 120 s, las mismas que el servidor", async () => {
    expect(BACKTEST_TIMEOUT_MS).toBe(300_000);
    expect(GENERADOR_TIMEOUT_MS).toBe(120_000);
    llamada.callBackend.mockResolvedValueOnce(respuesta({ cagr: 0.05, volatility: 0.1, sharpe: 0.3, max_drawdown: -0.1, rf_rate: 0.02 }));
    await fetchBacktest([{ asset_id: "A", weight: 1 }], "3Y");
    expect(llamada.callBackend).toHaveBeenLastCalledWith("backtest_portfolio", expect.anything(), expect.any(String), { timeout: 300_000 });
    llamada.callBackend.mockRejectedValueOnce(new Error("corte"));
    await expect(fetchBorradorDeCartera({ nivel: 5 } as never)).rejects.toThrow();
    expect(llamada.callBackend).toHaveBeenLastCalledWith("generate_portfolio_draft", expect.anything(), expect.any(String), { timeout: 120_000 });
  });
});
