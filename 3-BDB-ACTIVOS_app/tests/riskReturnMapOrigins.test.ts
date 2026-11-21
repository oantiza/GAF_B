/**
 * Segunda revisión de Astra (06-09-2026), punto 1: la resolución compartida devolvía
 * bien `null` y origen `missing`, pero el mapa riesgo-retorno volvía a decidir por su
 * cuenta con `?? 0`: la tabla decía N/D y el gráfico situaba la cartera en el origen,
 * afirmando que «asume un riesgo del 0,0 % y renta un 0,0 % anual» y sacando de ahí una
 * conclusión.
 *
 * Desde la decisión 59 el mapa tiene un solo origen, la simulación: sin ella, o sin que
 * mida el 80 % del peso, no hay cartera en el mapa. Ya no hay estimación por composición
 * que poner en un eje ni en el otro. Estas pruebas leen el TEXTO del PDF generado.
 */
import { describe, expect, test } from "vitest";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { extractPdfPageTexts } from "./support/pdfText";
import { horizonteDePrueba } from "./support/horizonteDePrueba";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";

/* Una suma ponderada creíble: si reaparece en el mapa, 7,1 % y 2,0 % se van a ver. */
const SUMA_PONDERADA = { annualized_return_3y: 0.02, volatility_3y: 0.071, sharpe_3y: 0.5, max_drawdown_5y: -0.2 };

function report(): BdbPortfolioReport {
  return {
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
      weighted_metrics: {
        preview_boundary: { mode: "PREVIEW_ONLY", source_label: "muestra", limitations: [] },
        ...SUMA_PONDERADA
      }
    },
    positions: [{
      asset_id: "IE00B03HCZ61",
      display_name: "Fondo de renta variable global",
      instrument_type: "FUND",
      economic_asset_class: "EQUITY",
      currency: "EUR",
      weight_percent: 100,
      is_investable: true,
      coverage_status: "COMPLETE",
      role: "INVESTABLE",
      quality_flags: [],
      pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
    }],
    warnings: [],
    xray: { by_region: [{ key: "global", weight_percent: 100 }] },
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
}


const feasibility = { status: "OK", issues: [], summary: "" } as unknown as PortfolioFeasibilityCheck;

const backtest = {
  schema_version: "backtest.v1",
  window: "3Y",
  frequency: "WEEKLY",
  asset_ids: ["IE00B03HCZ61"],
  metrics: { cagr: 0.185, volatility: 0.109, sharpe: 1.43, max_drawdown: -0.147, rf_rate: 0.029 },
  portfolio_series: [],
  benchmark_series: {},
  synthetics: [],
  stress_scenarios: [],
  coverage: { first_date: "2023-08-01", last_date: "2026-08-31", common_observations: 160 }
} as unknown as BacktestResponse;

async function textoDelInforme(analysis?: Parameters<typeof createInformeDeClientePdfBlob>[0]["analysis"]): Promise<string> {
  const blob = await createInformeDeClientePdfBlob({
    report: report(),
    generadoEn: "2026-09-06T08:00:00.000Z",
    feasibility,
    totalCapital: 250000,
    analysis,
    clientName: "Cliente de prueba"
  });
  return extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ").replace(/\s+/g, " ");
}

describe("mapa riesgo-retorno: los datos ausentes no se convierten en ceros, ni en una suma ponderada", () => {
  test("sin simulación: no se sitúa la cartera ni se concluye nada", async () => {
    const texto = await textoDelInforme();
    expect(texto).toContain("No hay datos para situar la cartera en el mapa");
    // Ni el punto, ni la afirmación, ni la comparación con los perfiles.
    expect(texto).not.toContain("volatilidad del 0,0 %");
    expect(texto).not.toContain("rentabilidad anualizada del 0,0 %");
    expect(texto).not.toContain("puntos por");
    // La suma ponderada tampoco ocupa su sitio, ni en el mapa ni en la tira.
    expect(texto).not.toContain("7,1 %");
    expect(texto).not.toContain("estimado por composición");
    expect(texto).not.toContain("Estimación por composición");
    expect(texto).toContain("Falta el dato");
  }, 30_000);

  test("con la simulación por debajo del 80 %: tampoco, aunque sus cifras estén ahí", async () => {
    const texto = await textoDelInforme(horizonteDePrueba(backtest, { coverageWeightPercent: 79.9 }));
    expect(texto).toContain("No hay datos para situar la cartera en el mapa");
    expect(texto).not.toContain("10,9 %");
    expect(texto).not.toContain("18,5 %");
    expect(texto).not.toContain("10,90 %");
    expect(texto).not.toContain("18,50 %");
  }, 30_000);

  test("con la simulación: el mapa habla de 3 años, sin marcas de estimación", async () => {
    const texto = await textoDelInforme(horizonteDePrueba(backtest));
    expect(texto).toContain("volatilidad a 3 años y rentabilidad a 3 años");
    expect(texto).toContain("una volatilidad del 10,90 %");
    expect(texto).not.toContain("7,1 %");
  }, 30_000);

  test("con tramos estimados, dice que los lleva", async () => {
    const extensions = [{ assetId: "IE00B03HCZ61", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-01", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: .97, residualVolatility: .08, referenceHasBacktestedHistory: false }];
    const texto = await textoDelInforme(horizonteDePrueba(backtest, { extensions }));
    expect(texto).toContain("volatilidad a 3 años con tramos estimados y rentabilidad a 3 años con tramos estimados");
  }, 30_000);
});
