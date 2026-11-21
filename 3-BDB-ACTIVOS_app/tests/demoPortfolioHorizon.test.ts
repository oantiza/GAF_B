import { describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon, resolveHorizonMetrics } from "../src/adapters/portfolioHorizon";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { fetchBacktest } from "../src/adapters/backtestPortfolioBackend";
import { canProjectReportBacktest } from "../src/core/reportMonteCarlo";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

const positions = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_B", weight_percent: 40 }];

describe("PDF de muestra con el contrato del análisis completo", () => {
  test.each([3, 5] as const)("genera el PDF a %i años por la misma ruta de la interfaz", async (years) => {
    const analysis = await fetchPortfolioHorizon(positions, `${years}Y`);
    const { backtest, equalWeight } = analysis;
    expect(backtest.window).toBe(`${years}Y`);
    expect(backtest.asset_ids).toEqual(["DEMO_A", "DEMO_B"]);
    expect(equalWeight.coverage).toEqual(backtest.coverage);
    expect(equalWeight.weights_normalized).toEqual({ DEMO_A: .5, DEMO_B: .5 });
    expect(analysis.coverageWeightPercent).toBe(100);
    expect(analysis.frontier).toBeNull();
    expect(analysis.frontierUnavailableReason).toContain("sintéticas");
    expect(resolveHorizonMetrics(analysis).sourceNote).toContain("Datos de muestra");
    const report = {
      portfolio_name: "Prueba muestra", mode: "BBDD_STATIC_EXPORT_SAMPLE",
      summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }],
        by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], weighted_metrics: {} },
      positions: positions.map((p) => ({ ...p, display_name: p.asset_id, instrument_type: "FUND", economic_asset_class: "EQUITY",
        pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } })),
      warnings: [], xray: { by_region: [] }, data_diagnostic: {}
    } as unknown as BdbPortfolioReport;
    const blob = await createInformeDeClientePdfBlob({ report, analysis, totalCapital: 100000,
      generadoEn: "2026-09-28T12:00:00Z",
      feasibility: {} as PortfolioFeasibilityCheck });
    const pages = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    const text = pages.join(" ");
    expect(pages.length).toBeGreaterThan(3);
    expect(text.toUpperCase().replace(/\s+/g, " ")).toContain(`RENTABILIDAD ANUALIZADA ${years} AÑOS`);
    expect(text).toContain("Datos de muestra");
    expect(text).toContain("Cifras ilustrativas, no operativas");
    expect(text).not.toContain("las métricas incluyen tramos anteriores al lanzamiento");
    expect(text).not.toContain("Monte Carlo");
    expect(text).toContain("Cómo se habría comportado esta composición en crisis pasadas");
  }, 20000);

  test("rechaza periodos ajenos al contrato y carteras vacías", async () => {
    await expect(demoResponse("backtest_portfolio", { analysis_bundle: true, window: "1Y", positions: [] })).rejects.toThrow("Periodo");
    await expect(demoResponse("backtest_portfolio", { analysis_bundle: true, window: "3Y", positions: [] })).rejects.toThrow("peso positivo");
  });

  test("conserva el contrato de backtest sin analysis_bundle", async () => {
    const result = await demoResponse("backtest_portfolio", { period: "3Y", positions: [{ asset_id: "DEMO_A", weight: 1 }] });
    expect(result).toMatchObject({ schema_version: "backtest.v1", window: "3Y" });
  });
});

/* ALTA-08 (auditoría 16-10-2026): la serie DAILY de la demo tenía como mucho 760
   días NATURALES (unos dos años): el remuestreo semanal daba 109 semanas y el
   Monte Carlo del PDF, que exige 156 rentabilidades semanales, no salía nunca
   en modo demo. Ahora cubre la ventana en sesiones hábiles. */
describe("serie DAILY de la demo (ALTA-08)", () => {
  const isWeekday = (iso: string) => {
    const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  };

  test.each([["3Y", 156], ["5Y", 260]] as const)("el backtest %s DAILY cubre la ventana en días hábiles y se puede proyectar", async (window, weeks) => {
    const backtest = await fetchBacktest([{ asset_id: "DEMO_A", weight: 0.6 }, { asset_id: "DEMO_B", weight: 0.4 }], window, "DAILY");
    expect(backtest?.portfolio_series).toHaveLength(weeks * 5 + 1);
    expect(backtest?.portfolio_series.every((point) => isWeekday(point.date))).toBe(true);
    expect(canProjectReportBacktest(backtest)).toBe(true);
  });

  test("get_price_series DAILY usa las mismas sesiones hábiles", async () => {
    const result = await demoResponse("get_price_series", { asset_ids: ["DEMO_A"], window: "3Y", frequency: "DAILY" }) as {
      dates: string[];
      series: Array<{ values: number[] }>;
    };
    expect(result.dates).toHaveLength(156 * 5 + 1);
    expect(result.dates.every(isWeekday)).toBe(true);
    expect(result.series[0].values).toHaveLength(result.dates.length);
  });
});
