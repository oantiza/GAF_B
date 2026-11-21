/**
 * F-02 (auditoría 29-09): el mapa riesgo-retorno ponía la cartera —medida a 3 o 5 años, en semanal y a fecha del
 * backtest— sobre perfiles medidos en otra ventana y sacaba de ahí una frase valorativa. Desde la decisión 2 los
 * perfiles se calculan con las series de sus dos fondos en las MISMAS fechas que la cartera. Si llegan menos
 * lejos, la cartera se mide también hasta ahí, y se escribe. Sin las series, se dice: no hay datos de repuesto.
 */
import { describe, expect, test } from "vitest";
import { referenceProfilesForDates } from "../src/core/benchmarkProfiles";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { extractPdfPageTexts } from "./support/pdfText";
import { diasLaborables, SERIES_HASTA_20260928 } from "./support/referenciaDePrueba";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";

/** La rejilla de una cartera a 5 años: días laborables, que acaba en un viernes con dato de los dos fondos. */
const cincoAnos = diasLaborables("2021-09-24", "2026-09-25");
/** Y una que llega un mes más lejos que las series, que acaban el 28-09-2026. */
const hastaOctubre = diasLaborables("2021-10-22", "2026-10-23");

const informe = {
  portfolio_name: "Cartera test",
  mode: "BBDD_STATIC_EXPORT_SAMPLE",
  summary: {
    source: "BBDD_STATIC_EXPORT_SAMPLE", position_count: 1, total_weight_percent: 100, validation_status: "VALID", is_valid: true,
    by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }],
    non_investable_assets: [], warnings: [],
    weighted_metrics: { preview_boundary: { mode: "PREVIEW_ONLY", source_label: "muestra", limitations: [] } }
  },
  positions: [{
    asset_id: "IE00B03HCZ61", display_name: "Fondo de renta variable global", instrument_type: "FUND", economic_asset_class: "EQUITY",
    currency: "EUR", weight_percent: 100, is_investable: true, coverage_status: "COMPLETE", role: "INVESTABLE", quality_flags: [],
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  }],
  warnings: [], xray: { by_region: [{ key: "global", weight_percent: 100 }] }, data_diagnostic: {}
} as unknown as BdbPortfolioReport;

function backtest(window: "3Y" | "5Y", dates: string[]): BacktestResponse {
  return {
    schema_version: "backtest.v1", window, frequency: "WEEKLY", asset_ids: ["IE00B03HCZ61"],
    metrics: { cagr: 0.085, volatility: 0.12, sharpe: 0.6, max_drawdown: -0.2, rf_rate: 0.025 },
    portfolio_series: dates.map((date, index) => ({ date, value: 100 * 1.0003 ** index + Math.sin(index / 3) })),
    benchmark_series: {}, synthetics: [], stress_scenarios: [],
    coverage: { first_date: dates[0], last_date: dates[dates.length - 1], common_observations: dates.length }
  } as unknown as BacktestResponse;
}

/** Análisis de 5 años tal como llega del backend (`analysis.years === 5`), el caso de la auditoría. */
function analisis5A(dates: string[]): PortfolioHorizon {
  const serie = backtest("5Y", dates);
  return {
    window: "5Y", years: 5, referenceVersion: "portfolio-horizon.v1", backtest: serie, frontier: null,
    equalWeight: serie, maxSharpe: null, coverageWeightPercent: 100, extensions: [], methodology: ""
  };
}

async function textoDelInforme(entrada: Partial<Parameters<typeof createInformeDeClientePdfBlob>[0]>): Promise<string> {
  const blob = await createInformeDeClientePdfBlob({
    report: informe,
    generadoEn: "2026-09-29T08:00:00.000Z",
    feasibility: { status: "OK", issues: [], summary: "" } as unknown as PortfolioFeasibilityCheck,
    totalCapital: 250000,
    ...entrada
  });
  return extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ").replace(/\s+/g, " ");
}

const es = (fecha: string) => fecha.split("-").reverse().join("/");
/** Un periodo como lo escribe el módulo común: «del 25/08/2023 al 28/08/2026». */
const del = (desde: string, hasta: string) => `del ${es(desde)} al ${es(hasta)}`;

/** La frase del mapa que compara con la línea de perfiles: «queda X puntos por encima», «por debajo» o «en línea». */
const COMPARA_CON_LA_LINEA = /la composición simulada (queda|oscila)/;

describe("PDF: el mapa riesgo-retorno rotula de qué fechas son los perfiles", () => {
  test("si cubren toda la ventana, es la misma ventana, y el mapa compara", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A(cincoAnos), referencia: SERIES_HASTA_20260928 });
    expect(texto).toContain("volatilidad a 5 años y rentabilidad a 5 años");
    expect(texto).toContain(`medidas en el mismo periodo que la composición simulada (semanal, ${del(cincoAnos[0], cincoAnos.at(-1)!)})`);
    expect(texto).toMatch(COMPARA_CON_LA_LINEA);
    /* El punto de la cartera es el de la tira de métricas. */
    expect(texto).toContain("una volatilidad del 12,00 %");
  }, 30_000);

  test("si llegan menos lejos que la cartera, nada dice «misma ventana» y la cartera se mide en las mismas fechas", async () => {
    const analisis = analisis5A(hastaOctubre);
    const ventana = referenceProfilesForDates(hastaOctubre, analisis.backtest.portfolio_series.map((p) => p.value), SERIES_HASTA_20260928)!;
    expect(ventana.mismaVentana).toBe(false);
    expect(ventana.lastDate).toBe("2026-09-28");
    const texto = await textoDelInforme({ analysis: analisis, referencia: SERIES_HASTA_20260928 });
    expect(texto).not.toContain("en el mismo periodo que la composición simulada");
    expect(texto).toContain(`medidas en las mismas fechas (semanal, ${del(ventana.firstDate, "2026-09-28")}, la última común)`);
    expect(texto).toContain("volatilidad del tramo común y rentabilidad del tramo común");
    /* El punto de la cartera ya no es la cifra del periodo (12,0 %), sino la del tramo. */
    expect(texto).not.toContain("una volatilidad del 12,00 %");
    expect(texto).toContain(`una volatilidad del ${(ventana.cartera.vol * 100).toFixed(2).replace(".", ",")} %`);
    expect(texto).toMatch(COMPARA_CON_LA_LINEA);
    /* Y la evolución lo escribe donde compara, en esa misma fecha. */
    expect(texto).toContain("Ambos parten de 100 el 22/10/2021 y se comparan en las mismas fechas hasta el 28/09/2026, la última común");
    expect(texto).toContain("Diferencial");
  }, 30_000);

  test("sin serie del backtest los perfiles son a 3 años hasta su último dato, y el mapa no compara", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A([]), referencia: SERIES_HASTA_20260928 });
    expect(texto).toContain("de referencia: 3 años, datos a 28/09/2026");
    expect(texto).not.toMatch(COMPARA_CON_LA_LINEA);
    expect(texto).toContain("no están medidas en el mismo periodo que la composición simulada");
  }, 30_000);

  test("sin las series se dice «Cartera de referencia: falta el dato», sin línea, sin perfiles y sin comparar nada", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A(cincoAnos), referencia: null });
    expect(texto).toContain("Cartera de referencia: falta el dato");
    expect(texto).not.toContain("en el mismo periodo que la composición simulada");
    expect(texto).not.toContain("Diferencial");
    expect(texto).not.toMatch(COMPARA_CON_LA_LINEA);
    /* La cartera sigue: su serie y su punto son suyos. */
    expect(texto).toContain("una volatilidad del 12,00 %");
  }, 30_000);

  test("sin solape suficiente no se compara y se dice", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A(diasLaborables("2010-01-04", "2014-12-26")), referencia: SERIES_HASTA_20260928 });
    /* La extracción pierde la ligadura «fi» de «suficientes». */
    expect(texto).toContain("Equilibrado no tienen fechas");
    expect(texto).toContain("no se comparan (hacen falta 26 semanas)");
    expect(texto).not.toContain("Diferencial");
    expect(texto).not.toMatch(COMPARA_CON_LA_LINEA);
  }, 30_000);
});

describe("PDF: la frase de la evolución (hallazgo 30)", () => {
  test("qué es la cartera de referencia elegida, hasta cuándo se compara y que la cartera no se reequilibra", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A(cincoAnos), referencia: SERIES_HASTA_20260928, benchmarkId: "equilibrado" });
    expect(texto).toContain("Cartera de referencia: Equilibrado (50 % renta ja global y 50 % renta variable global, con los pesos jados el primer día, sin reequilibrar).");
    expect(texto).toContain(`Ambos parten de 100 el ${es(cincoAnos[0])} y se comparan en las mismas fechas hasta el ${es(cincoAnos.at(-1)!)}, la última común.`);
    expect(texto).toContain("La composición simulada tampoco se reequilibra.");
    expect(texto).not.toContain("a diario");
    expect(texto).not.toContain("Cartera y benchmark en la misma ventana");
    expect(texto).toMatch(/Diferencial [+-]\d+,\d puntos \(ambos parten de 100\)/);
  }, 30_000);

  test("con un solo fondo no se habla de reequilibrio de la referencia", async () => {
    const texto = await textoDelInforme({ analysis: analisis5A(cincoAnos), referencia: SERIES_HASTA_20260928, benchmarkId: "agresivo" });
    expect(texto).toContain("Cartera de referencia: Agresivo (100 % renta variable global).");
    expect(texto).toContain("La composición simulada no se reequilibra.");
  }, 30_000);
});
