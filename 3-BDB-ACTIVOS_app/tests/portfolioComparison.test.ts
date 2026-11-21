import { describe, expect, test, vi } from "vitest";
import { alignPortfolioComparison, comparisonMetrics, comparisonCoverage, comparisonAllocations, comparisonPositions } from "../src/core/portfolioComparison";
import { comparisonFixture, comparisonAssets, comparisonPortfolios } from "./support/portfolioComparisonFixtures";
import { fetchComparisonHistory } from "../src/adapters/portfolioComparisonHistory";

const backend = vi.hoisted(() => ({ backtest: vi.fn(), horizon: vi.fn() }));
vi.mock("../src/adapters/backtestPortfolioBackend", () => ({ fetchBacktest: backend.backtest }));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: backend.horizon }));

describe("comparación sobre el mismo histórico", () => {
  test("normaliza pesos, acumula duplicados y rechaza carteras vacías o pesos inválidos", () => {
    expect(comparisonPositions([{ asset_id: "A", weight_percent: 2 }, { asset_id: "A", weight_percent: 1 }, { asset_id: "B", weight_percent: 1 }, { asset_id: "C", weight_percent: 0 }])).toEqual([{ asset_id: "A", weight_percent: 75 }, { asset_id: "B", weight_percent: 25 }]);
    for (const value of [-1, NaN, Infinity]) expect(() => comparisonPositions([{ asset_id: "A", weight_percent: value }])).toThrow();
    expect(() => comparisonPositions([])).toThrow();
  });
  test("cruza fechas, ordena y rebasa ambas curvas a 100 en el mismo día", () => {
    const a = comparisonFixture(); const b = comparisonFixture("3Y", "B");
    a.backtest.portfolio_series = [{ date: "2023-01-01", value: 10 }, { date: "2023-01-02", value: 20 }, { date: "2023-01-03", value: 22 }];
    b.backtest.portfolio_series = [{ date: "2023-01-03", value: 80 }, { date: "2023-01-02", value: 40 }, { date: "2023-01-04", value: 90 }];
    const result = alignPortfolioComparison(a, b, "3Y");
    expect(result.seriesA.map((p) => p.value)).toEqual([100, 110.00000000000001]);
    expect(result.seriesB.map((p) => p.value)).toEqual([100, 200]);
    expect(result.metricsA.cumulative).toBeCloseTo(.1);
    expect(result.riskFree).toBeNull();
    expect(result.periodLabel).toBe("periodo disponible");
    expect(result.notes.join()).toContain("3 años");
  });
  test.each(["3Y", "5Y", "10Y"] as const)("%s mide la curva común y no las antiguas métricas de composición", (period) => {
    const a = comparisonFixture(period); const result = alignPortfolioComparison(a, comparisonFixture(period, "B"), period);
    expect(result.coversPeriod).toBe(true);
    expect(result.metricsA.cagr).not.toBe(a.backtest.metrics.cagr);
    const years = (Date.parse(result.lastDate) - Date.parse(result.firstDate)) / 86400000 / 365.2425;
    expect(result.metricsA.cagr).toBeCloseTo((result.seriesA.at(-1)!.value / 100) ** (1 / years) - 1, 12);
    expect(result.metricsA.sharpe).toBeCloseTo((result.metricsA.cagr! - .02) / result.metricsA.volatility!);
  });
  test("el riesgo usa la muestra semanal y la caída conserva el mínimo diario", () => {
    const points = [{ date: "2026-01-02", value: 100 }, { date: "2026-01-05", value: 50 }, { date: "2026-01-09", value: 110 }, { date: "2026-01-16", value: 99 }];
    const metrics = comparisonMetrics(points, .02);
    expect(metrics.volatility).toBeCloseTo(Math.sqrt(.02 * 52));
    expect(metrics.maxDrawdown).toBe(-.5);
    expect(metrics.cumulative).toBeCloseTo(-.01);
  });
  test("un hueco semanal no se anualiza como si fuera una sola semana", () => {
    const points = [{ date: "2026-01-02", value: 100 }, { date: "2026-01-09", value: 110 }, { date: "2026-02-20", value: 99 }];
    // MEDIA-05: la CAGR va por extremos; con huecos y sin semanas consecutivas suficientes, volatilidad y Sharpe N/D.
    const metrics = comparisonMetrics(points, .02);
    expect(metrics).toMatchObject({ volatility: null, sharpe: null });
    // 15-11-2026: 49 días no se anualizan (antes, 0,99^(365,2425/49) − 1). Queda la rentabilidad del periodo: 99/100 − 1.
    expect(metrics).toMatchObject({ cagr: null, annualized: false });
    expect(metrics.cumulative).toBeCloseTo(-.01, 12);
  });
  /* MEDIA-05 (auditoría 16-10-2026): una sola semana ISO sin fechas comunes en
     160 anulaba CAGR, volatilidad y Sharpe de toda la comparación. Segunda
     pasada (R-08): la volatilidad tiene que ser la de las semanas
     CONSECUTIVAS, no la de todos los pares (el del hueco son dos semanas). */
  const viernes = (week: number) => new Date(Date.parse("2023-01-06T00:00:00Z") + week * 7 * 86400000).toISOString().slice(0, 10);
  /** Una observación por semana, rentabilidades alternas +1,2 % / −0,8 %; sin las semanas de `huecos`. */
  const semanal = (semanas: number, huecos: number[] = []) => {
    let value = 100;
    return Array.from({ length: semanas }, (_, week) => {
      if (week > 0) value *= 1 + (week % 2 ? .012 : -.008);
      return { week, date: viernes(week), value };
    }).filter((point) => !huecos.includes(point.week)).map(({ date, value: v }) => ({ date, value: v }));
  };
  const volatilidadAnual = (returns: number[]) => {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    return Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1) * 52);
  };
  test("una semana ausente en 160 no anula la CAGR y la volatilidad solo usa semanas consecutivas", () => {
    const points = semanal(160, [80]);
    const metrics = comparisonMetrics(points, .02);
    const years = (Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)) / 86400000 / 365.2425;
    expect(metrics.cagr).toBeCloseTo((points.at(-1)!.value / points[0].value) ** (1 / years) - 1, 12);

    const pares = points.slice(1).map((point, index) => ({ r: point.value / points[index].value - 1, hueco: index + 1 === 80 }));
    const consecutivas = volatilidadAnual(pares.filter((par) => !par.hueco).map((par) => par.r));
    const todas = volatilidadAnual(pares.map((par) => par.r));
    expect(pares.filter((par) => par.hueco)).toHaveLength(1);
    expect(metrics.volatility).toBeCloseTo(consecutivas, 12);
    expect(Math.abs(consecutivas - todas)).toBeGreaterThan(1e-4);
    expect(metrics.sharpe).toBeCloseTo((metrics.cagr! - .02) / metrics.volatility!, 12);
  });
  test("con huecos, la volatilidad exige 26 rentabilidades entre semanas consecutivas", () => {
    // 27 semanas seguidas (26 rentabilidades), hueco y una semana suelta: llega al umbral.
    expect(comparisonMetrics(semanal(29, [27]), .02).volatility).not.toBeNull();
    // 26 semanas seguidas (25 rentabilidades), hueco y una semana suelta: no llega.
    // 15-11-2026: 28 semanas no llegan a los 330 días, así que tampoco hay CAGR, pero sí rentabilidad del periodo.
    const corta = comparisonMetrics(semanal(28, [26]), .02);
    expect(corta).toMatchObject({ cagr: null, annualized: false, volatility: null, sharpe: null });
    expect(Number.isFinite(corta.cumulative)).toBe(true);
    // Un hueco con 10 semanas consecutivas: volatilidad no (y, con 12 semanas, CAGR tampoco).
    const diez = comparisonMetrics(semanal(12, [6]), .02);
    expect(diez.cagr).toBeNull();
    expect(diez.volatility).toBeNull();
    // Sin huecos, las mismas 12 semanas sí tienen volatilidad (el mínimo sigue siendo 2).
    expect(comparisonMetrics(semanal(12), .02).volatility).not.toBeNull();
  });
  test("la volatilidad con huecos usa solo semanas consecutivas y la comparación lo dice", () => {
    const a = comparisonFixture(); const b = comparisonFixture("3Y", "B");
    const hueco = a.backtest.portfolio_series[Math.floor(a.backtest.portfolio_series.length / 2)].date;
    const semana = (date: string) => Math.floor((Date.parse(`${date}T00:00:00Z`) / 86400000 + 3) / 7);
    a.backtest.portfolio_series = a.backtest.portfolio_series.filter((p) => semana(p.date) !== semana(hueco));
    const result = alignPortfolioComparison(a, b, "3Y");
    expect(result.metricsA.cagr).not.toBeNull();
    expect(result.metricsA.volatility).not.toBeNull();
    expect(result.notes.join(" ")).toContain("solo entre semanas consecutivas");
  });
  test("no inventa un Sharpe cuando la volatilidad es cero o la tasa difiere", () => {
    const a = comparisonFixture(); const b = comparisonFixture();
    a.backtest.portfolio_series.forEach((p) => { p.value = 100; });
    expect(alignPortfolioComparison(a, b, "3Y").metricsA.sharpe).toBeNull();
    b.backtest.metrics.rf_rate = .03;
    expect(alignPortfolioComparison(comparisonFixture(), b, "3Y").metricsB.sharpe).toBeNull();
  });
  test("no combina periodos distintos, otra divisa ni fechas inválidas o repetidas", () => {
    expect(() => alignPortfolioComparison(comparisonFixture("3Y"), comparisonFixture("5Y"), "3Y")).toThrow();
    const bad = comparisonFixture(); bad.backtest.base_currency = "USD";
    expect(() => alignPortfolioComparison(bad, comparisonFixture(), "3Y")).toThrow();
    for (const point of [{ date: "2026-02-30", value: 10 }, { date: "2026-01-01", value: NaN }, { date: "2026-01-01", value: 0 }]) {
      const bad = comparisonFixture(); bad.backtest.portfolio_series.push(point);
      expect(() => alignPortfolioComparison(bad, comparisonFixture(), "3Y")).toThrow();
    }
    const duplicate = comparisonFixture(); duplicate.backtest.portfolio_series.push(duplicate.backtest.portfolio_series[0]);
    expect(() => alignPortfolioComparison(duplicate, comparisonFixture(), "3Y")).toThrow();
  });
  test("dice qué peso falta sin presentarlo como una cartera completa", () => {
    const history = comparisonFixture(); history.backtest.asset_ids = ["A"];
    history.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
    const coverage = comparisonCoverage(history, comparisonPortfolios[0].positions);
    expect(coverage).toMatchObject({ weight: 80, included: 1, total: 2 });
    expect(coverage.excluded[0]).toContain("histórico insuficiente");
    expect(coverage.note).toContain("normalizan al 100");
  });
  test("la asignación conserva los pesos sin ficha, con el nombre que se le diga", () => {
    const rows = comparisonAllocations(comparisonPortfolios[0].positions, comparisonPortfolios[1].positions, comparisonAssets.filter((a) => a.asset_id !== "A"), "region", () => "Falta el dato");
    expect(rows.reduce((sum, row) => sum + row.a, 0)).toBeCloseTo(100);
    expect(rows.find((r) => r.label === "Falta el dato")?.a).toBe(80);
  });
});

describe("fuentes históricas del comparador", () => {
  test.each(["3Y", "5Y"] as const)("%s usa las ampliaciones aprobadas del constructor", async (period) => {
    backend.horizon.mockResolvedValueOnce({ backtest: comparisonFixture(period).backtest, extensions: [{ assetId: "A", reference: "Referencia validada", estimatedFrom: "2021-01-01", estimatedUntil: "2023-01-01" }] });
    const result = await fetchComparisonHistory(comparisonPortfolios[0].positions, period);
    expect(backend.horizon).toHaveBeenLastCalledWith(comparisonPortfolios[0].positions, period);
    expect(result.extensionNotes[0]).toContain("Referencia validada");
  });
  test("10 años exige historia real suficiente y convierte pesos a fracciones", async () => {
    backend.backtest.mockResolvedValueOnce(comparisonFixture("10Y").backtest);
    await fetchComparisonHistory(comparisonPortfolios[0].positions, "10Y");
    expect(backend.backtest).toHaveBeenLastCalledWith([{ asset_id: "A", weight: .8 }, { asset_id: "cash", weight: .2 }], "10Y", "DAILY", "ENFORCE");
  });
});
