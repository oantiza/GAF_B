// P3.2 (ola 2, auditoría 11-08 N4): el PDF del informe de cliente imprime las cifras del
// feed, resueltas por la misma función que antes pintaba su vista previa. Fixtures al estilo de pdfReports.test.ts, con
// las magnitudes reales del hallazgo (pantalla 16,3/10,7/1,35/−33,7 vs PDF
// 18,5/10,9/1,43/−14,7 con rf €STR 2,9 %).
import { describe, expect, test } from "vitest";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import { aggregateToAreas } from "../src/charts/worldMapGeo";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import { buildRegionTable } from "../src/core/regionTaxonomy";
import {
  informeDeClienteMetricRows,
  createInformeDeClientePdfBlob
} from "../src/reports/informeDeClientePdf";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import { horizonteDePrueba } from "./support/horizonteDePrueba";

/* La estimación local ponderada que enseñaba la pantalla (divergente). */
const weightedMetrics = {
  preview_boundary: { mode: "PREVIEW_ONLY", source_label: "test", limitations: [] },
  annualized_return_3y: 0.163,
  volatility_3y: 0.107,
  sharpe_3y: 1.35,
  max_drawdown_5y: -0.337
} as BdbPortfolioReport["summary"]["weighted_metrics"];

const report = {
  portfolio_name: "Cartera test",
  mode: "BBDD_STATIC_EXPORT_SAMPLE",
  summary: {
    source: "BBDD_STATIC_EXPORT_SAMPLE",
    position_count: 1,
    total_weight_percent: 100,
    validation_status: "VALID",
    is_valid: true,
    by_instrument_type: [{ key: "FUND", weight_percent: 100 }],
    by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }],
    non_investable_assets: [],
    warnings: [],
    weighted_metrics: weightedMetrics
  },
  positions: [{
    asset_id: "LU0996182563",
    display_name: "Mock Global Equity Fund",
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    weight_percent: 100,
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  }],
  warnings: [],
  // Desglose crudo con un fondo «Global»: el mapeo antiguo lo imprimía como
  // «No declarado»; con regionRows canónicas este bucket ya no manda.
  xray: { by_region: [{ key: "global", weight_percent: 100 }] },
  data_diagnostic: {}
} as unknown as BdbPortfolioReport;

/* El feed compuesto que imprime el PDF (cifras del hallazgo N4). */
const backtest3y = {
  schema_version: "backtest.v1",
  window: "3Y",
  frequency: "WEEKLY",
  asset_ids: ["A", "B"],
  metrics: { cagr: 0.185, volatility: 0.109, sharpe: 1.43, max_drawdown: -0.102, rf_rate: 0.029 },
  portfolio_series: Array.from({ length: 157 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 0, 1) + index * 7 * 86_400_000).toISOString().slice(0, 10),
    value: 100 * 1.005 ** index
  })),
  benchmark_series: {},
  synthetics: [],
  stress_scenarios: [],
  coverage: { first_date: "2023-01-01", last_date: "2025-12-01", common_observations: 36 }
} as unknown as BacktestResponse;

describe("feed único del informe", () => {
  test("con simulación, el papel imprime sus cifras y sus rótulos, y la suma ponderada no aparece", () => {
    const filas = informeDeClienteMetricRows(report, horizonteDePrueba(backtest3y));
    /* Auditoría 14-10 (MEDIA-18a): el PDF formatea con core/format.ts, así que escribe el menos
       tipográfico U+2212. Se compara el texto tal cual, sin normalizar el signo. */
    /* Desde la plantilla única, con el formato común: rentabilidad con signo y dos decimales, volatilidad y caída con dos, y espacio duro. */
    expect(filas.map((fila) => fila.value)).toEqual(["+18,50\u00a0%", "10,90\u00a0%", "1,43", "−10,20\u00a0%"]);
    expect(filas.map((fila) => fila.label)).toEqual(["Rentabilidad anualizada 3 años", "Volatilidad 3 años", "Sharpe 3 años", "Caída máxima 3 años"]);
    // La estimación ponderada divergente (16,3 / −33,7) no sale nunca.
    const impreso = filas.map((fila) => `${fila.label} ${fila.value}`).join(" ");
    expect(impreso).not.toContain("16,3");
    expect(impreso).not.toContain("33,7");
  });

  test("sin simulación, «Falta el dato» en cada cifra: ya no hay estimación local que poner en su sitio (decisión 59)", () => {
    const filas = informeDeClienteMetricRows(report);
    expect(filas.map((fila) => fila.value)).toEqual(["Falta el dato", "Falta el dato", "Falta el dato", "Falta el dato"]);
    expect(filas.map((fila) => fila.label).join(" ")).not.toContain("estimad");
  });
});

describe("taxonomía geográfica única", () => {
  const globalAsset = {
    asset_id: "LU0996182563",
    display_name: "Mock Global Equity Fund",
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "USD",
    region: "Global",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {},
    exposure_detail: { equity_regions: { united_states: 60, eurozone: 25, japan: 15 } },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  } as unknown as BdbAssetDetail;

  test("un fondo «Global» que no publica regiones no se reparte: al papel llega sin filas, y el resto es «No declarado»", () => {
    const sinRegiones = { ...globalAsset, exposure_detail: undefined } as unknown as BdbAssetDetail;
    const salida = computeEquityRegionAllocation([{ asset_id: "LU0996182563", weight_percent: 100 }], [sinRegiones]);
    expect(salida.rows).toEqual([]);
    expect(salida.unclassified_weight_percent).toBe(100);
  });

  test("la distribución canónica reparte un fondo «Global» sin residuo — el mismo residuo (cero) que el X-Ray", () => {
    const { rows } = computeEquityRegionAllocation([{ asset_id: "LU0996182563", weight_percent: 100 }], [globalAsset]);
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((sum, row) => sum + row.weight_percent, 0);
    const mapped = Object.values(aggregateToAreas(rows)).reduce((sum, value) => sum + value, 0);
    // Todo el peso cae en áreas del mapa: el «Sin asignar 37,5 %» era del mapeo antiguo.
    expect(mapped).toBeCloseTo(total, 5);
    // Y el residuo de la taxonomía Morningstar (el que usa el X-Ray) es cero.
    expect(buildRegionTable(rows).other).toBeCloseTo(0, 5);
  });

  test("el PDF del informe de cliente renderiza con las regionRows canónicas en la entrada", async () => {
    const { rows } = computeEquityRegionAllocation([{ asset_id: "LU0996182563", weight_percent: 100 }], [globalAsset]);
    const blob = await createInformeDeClientePdfBlob({
      report,
      feasibility: {
        status: "FEASIBLE", blocking_issues: [], warnings: [], locked_weight: 0, unlocked_budget: 1
      } as unknown as PortfolioFeasibilityCheck,
      totalCapital: 100_000,
      analysis: horizonteDePrueba(backtest3y),
      regionRows: rows,
      clientName: "Cartera test"
    });
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
    const header = await blob.slice(0, 5).text();
    expect(header).toBe("%PDF-");
  }, 15_000);
});
