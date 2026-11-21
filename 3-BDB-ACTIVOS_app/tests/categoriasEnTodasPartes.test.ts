/**
 * La tabla de categorías donde se agrupa, se filtra, se compara y se imprime (decisiones 99, 100 y 101 de Óscar, 05-11-2026). Se traduce
 * solo al enseñar, y por eso lo que junta categorías lo hace por el nombre: «EAA Fund Asia ex-Japan Equity» y «RV Asia (ex-Japón)» son la
 * misma, y no pueden salir en dos filas, en dos opciones ni como un cambio de categoría.
 */
import { describe, expect, test } from "vitest";
import { filasDeComposicion } from "../src/adapters/tablaDeComposicion";
import { filterComparisonCatalog } from "../src/core/assetComparisonCatalog";
import { assessFundEquivalence } from "../src/core/fundEquivalence";
import { EMPTY_SWAP_FILTERS, filterSwapAlternatives, findSwapAlternatives } from "../src/core/fundSwapper";
import { buildReportFromAssets } from "../src/core/portfolio";
import { comparisonAllocations } from "../src/core/portfolioComparison";
import { createAssetComparisonPdfBlob, type AssetComparePdfAsset } from "../src/reports/assetComparePdf";
import { createInformeDeClientePdfBlob, SIGLAS_DE_LAS_CATEGORIAS } from "../src/reports/informeDeClientePdf";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioReport } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

const fondo = (asset_id: string, category: string | undefined, extra: Partial<BdbAssetDetail> = {}) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {},
    description: "",
    region: "Asia",
    category,
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" },
    ...extra
  }) as unknown as BdbAssetDetail;

const pos = (asset_id: string, weight_percent: number) => ({ asset_id, weight_percent }) as BdbManualPortfolioPosition;

/** La cartera de cinco fondos con la que se vio el error: Japón es el 20 %, y la hoja 3 imprimía tres filas «Renta variable Japón». */
const JAPON = [
  fondo("NORDEA", "EAA Fund Asia ex-Japan Equity"),
  fondo("FID_JAPON", "EAA Fund Japan Large-Cap Blend Equity"),
  fondo("FID_US", "EAA Fund US Large-Cap Blend Equity", { region: "USA" }),
  fondo("AB_US", "EAA Fund US Large-Cap Growth Equity", { region: "USA" }),
  fondo("FID_APAC", "EAA Fund Asia-Pacific ex-Japan Equity")
];
const POSICIONES_JAPON = [pos("NORDEA", 30), pos("FID_JAPON", 20), pos("FID_US", 20), pos("AB_US", 20), pos("FID_APAC", 10)];

/** Un fondo y un ETF de la misma categoría, cada uno en su idioma. */
const LOS_DOS_IDIOMAS = [fondo("FONDO", "EAA Fund Asia ex-Japan Equity"), fondo("ETF", "RV Asia (ex-Japón)", { instrument_type: "ETF" })];

describe("se agrupa por el nombre", () => {
  test("el reparto por categoría de la cartera (cliente, interno y Análisis): cada fila con su nombre, y lo que excluye Japón no es Japón", () => {
    const filas = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: POSICIONES_JAPON, assets: JAPON }).xray.by_category;
    expect(Object.fromEntries(filas.map((fila) => [fila.key, fila.weight_percent]))).toEqual({
      "RV Asia (ex-Japón)": 30,
      "RV Japón Cap. Grande Blend": 20,
      "RV USA Cap. Grande Blend": 20,
      "RV USA Cap. Grande Growth": 20,
      "RV Asia Pacífico (ex-Japón)": 10
    });
  });

  test("la misma categoría en los dos idiomas es una fila, con la suma de las dos: 30 + 20 = 50", () => {
    const filas = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: [pos("FONDO", 30), pos("ETF", 20), pos("FID_JAPON", 50)], assets: [...LOS_DOS_IDIOMAS, JAPON[1]] }).xray.by_category;
    expect(filas).toHaveLength(2);
    expect(filas.find((fila) => fila.key === "RV Asia (ex-Japón)")?.weight_percent).toBe(50);
  });

  test("Comparar carteras y la Comparativa de carteras: una fila por nombre, escrita como se lee", () => {
    const filas = comparisonAllocations([pos("FONDO", 60), pos("FID_JAPON", 40)], [pos("ETF", 100)], [...LOS_DOS_IDIOMAS, JAPON[1]], "category", () => "No declarado");
    expect(filas).toEqual([
      { key: "RV Asia (ex-Japón)", label: "RV Asia (ex-Japón)", a: 60, b: 100 },
      { key: "RV Japón Cap. Grande Blend", label: "RV Japón Cap. Grande Blend", a: 40, b: 0 }
    ]);
  });

  test("la composición de Análisis: una cabecera de grupo, y un nombre en mayúsculas no se estropea («RF DKK», no «Rf dkk»)", () => {
    const filas = filasDeComposicion({ positions: [pos("FONDO", 30), pos("ETF", 20)], assets: LOS_DOS_IDIOMAS });
    expect(filas.filter((fila) => fila.cabeceraDeGrupo).map((fila) => [fila.nombre, fila.pesoPct])).toEqual([["RV Asia (ex-Japón)", 50]]);
    const [dkk] = filasDeComposicion({ positions: [pos("DKK", 100)], assets: [fondo("DKK", "EAA Fund DKK Bond", { economic_asset_class: "FIXED_INCOME" })] });
    expect(dkk.apunte).toBe("DKK · RF DKK");
  });
});

describe("se filtra por el nombre, y una opción trae todos sus textos", () => {
  test("sustituir un fondo: el filtro por nombre trae el fondo y el ETF", () => {
    const alternativas = LOS_DOS_IDIOMAS.map((asset) => ({ asset, tier: 4 as const, score: 0 }));
    const filtradas = filterSwapAlternatives(alternativas, { ...EMPTY_SWAP_FILTERS, category: "RV Asia (ex-Japón)" });
    expect(filtradas.map(({ asset }) => asset.asset_id)).toEqual(["FONDO", "ETF"]);
  });

  test("el catálogo del Comparador: lo mismo", () => {
    const filtrados = filterComparisonCatalog(LOS_DOS_IDIOMAS, { region: "ALL", assetClass: "ALL", category: "RV Asia (ex-Japón)" });
    expect(filtrados.map((asset) => asset.asset_id)).toEqual(["FONDO", "ETF"]);
  });
});

describe("se compara por el nombre", () => {
  test("la equivalencia: la misma categoría en dos idiomas coincide, y nunca «Categoría distinta (X → X)»", () => {
    const resultado = assessFundEquivalence(fondo("A", "EAA Fund Asia ex-Japan Equity"), fondo("B", "RV Asia (ex-Japón)"));
    const categoria = resultado.criteria.find((criterio) => criterio.key === "category");
    expect(categoria).toMatchObject({ status: "MATCH", original: "RV Asia (ex-Japón)", candidate: "RV Asia (ex-Japón)" });
    expect(resultado.shared).toContain("Categoría: RV Asia (ex-Japón)");
    expect(JSON.stringify(resultado)).not.toContain("EAA Fund");
    const distinta = assessFundEquivalence(fondo("A", "EAA Fund Asia ex-Japan Equity"), fondo("C", "EAA Fund Japan Large-Cap Blend Equity"));
    expect(distinta.differing).toContain("Categoría: RV Asia (ex-Japón) → RV Japón Cap. Grande Blend");
  });

  test("las alternativas de un ETF: «Large Blend» y «RV USA Cap. Grande Blend» son la misma categoría, y pasan al nivel 1", () => {
    const spdr = { ...fondo("SPDR", "Large Blend", { instrument_type: "ETF", region: "USA" }), is_investable: true };
    const ishares = { ...fondo("CSPX", "RV USA Cap. Grande Blend", { instrument_type: "ETF", region: "USA" }), is_investable: true };
    const [alternativa] = findSwapAlternatives(spdr as never, [ishares as never]);
    expect(alternativa).toMatchObject({ tier: 1 });
  });
});

/* ---------------------------------------------------------------- papel */

function backtest(): BacktestResponse {
  const series = Array.from({ length: 158 }, (_, i) => ({
    date: new Date(Date.UTC(2023, 7, 25) + i * 7 * 86_400_000).toISOString().slice(0, 10),
    value: 100 * Math.exp(i * 0.0018 + 0.025 * Math.sin(i * 0.7))
  }));
  return {
    schema_version: "backtest.v1", window: "3Y", frequency: "WEEKLY", asset_ids: ["A", "B"], portfolio_series: series,
    metrics: { cagr: 0.13, volatility: 0.09, sharpe: 1.2, max_drawdown: -0.1, rf_rate: 0.02 }, benchmark_series: {}, stress_scenarios: [], synthetics: [],
    risk_free: { risk_free_source: "ECB_ESTR", risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: { requested_assets: 2, included_assets: 2, common_observations: 158, first_date: series[0].date, last_date: series.at(-1)!.date },
    excluded_assets: []
  } as unknown as BacktestResponse;
}

function informe(categorias: Array<{ key: string; weight_percent: number }>): BdbPortfolioReport {
  return {
    portfolio_name: "Prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: { source: "BBDD_STATIC_EXPORT_SAMPLE", position_count: 2, total_weight_percent: 100, validation_status: "VALID", is_valid: true,
      by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], non_investable_assets: [], warnings: [],
      weighted_metrics: { preview_boundary: { mode: "PREVIEW_ONLY", source_label: "test", limitations: [] } } },
    positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }].map((p) => ({ ...p, display_name: `Activo ${p.asset_id}`, instrument_type: "FUND",
      economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [],
      pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } })),
    warnings: [], xray: { by_region: [{ key: "europe", weight_percent: 100 }], by_category: categorias }, data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
}

/** La extracción pierde la ligadura «fi» («renta ja»): se compara sin ella y con un solo espacio. */
const plano = (texto: string) => texto.replace(/\s+/g, " ").replace(/fi/g, "");
const SIGLAS = plano(SIGLAS_DE_LAS_CATEGORIAS);

async function hojasDelCliente(categorias: Array<{ key: string; weight_percent: number }>): Promise<string[]> {
  const analysis = { window: "3Y", years: 3, referenceVersion: "test", backtest: backtest(), frontier: null, equalWeight: backtest(), maxSharpe: null,
    coverageWeightPercent: 100, extensions: [], methodology: "Estimación" } as unknown as PortfolioHorizon;
  const blob = await createInformeDeClientePdfBlob({
    report: informe(categorias), analysis, generadoEn: "2026-09-06T12:00:00Z", referencia: null,
    feasibility: { status: "FEASIBLE", blocking_issues: [], warnings: [], locked_weight: 0, unlocked_budget: 1 } as unknown as PortfolioFeasibilityCheck
  });
  return extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).map(plano);
}

describe("en papel", () => {
  test("informe de cliente: la hoja 3 con el nombre de la tabla, y la guía dice una vez qué es RV y RF", async () => {
    const hojas = await hojasDelCliente([{ key: "EAA Fund Asia ex-Japan Equity", weight_percent: 60 }, { key: "EAA Fund Global Diversified Bond - EUR Hedged", weight_percent: 40 }]);
    const todo = hojas.join(" ");
    expect(todo).toContain("RV Asia (ex-Japón)");
    expect(todo).toContain(plano("RF Diversificada Global - EUR Cubierto"));
    expect(todo).not.toContain("EAA Fund");
    expect(todo).not.toContain("Renta variable Japón");
    const guia = hojas.find((hoja) => hoja.includes("Guía de interpretación"))!;
    expect(SIGLAS_DE_LAS_CATEGORIAS).toBe("RV: renta variable. RF: renta fija.");
    expect(guia).toContain(SIGLAS);
    expect(todo.split(SIGLAS)).toHaveLength(2);
  }, 30_000);

  test("informe de cliente: sin RV ni RF en la hoja 3, la guía no explica unas siglas que no salen", async () => {
    const hojas = await hojasDelCliente([{ key: "EAA Fund EUR Moderate Allocation - Global", weight_percent: 100 }]);
    expect(hojas.join(" ")).toContain("Mixtos Moderados EUR - Global");
    expect(hojas.join(" ")).not.toContain(SIGLAS);
  }, 30_000);

  test("Comparativa de activos: el nombre entero, sin el corte a 22 letras", async () => {
    const activo = (name: string, category: string): AssetComparePdfAsset => ({ name, color: "#143D66", isin: name, instrumentType: "FUND", currency: "EUR", category, return3y: 0.05, volatility3y: 0.06, sharpe3y: 0.4, maxDrawdown: -0.1 });
    const blob = await createAssetComparisonPdfBlob({
      assets: [activo("IVO", "EAA Fund Global Emerging Markets Corporate Bond - EUR Hedged"), activo("NORDEA", "EAA Fund Asia ex-Japan Equity")],
      windowLabel: "01/09/2023 a 03/09/2026 · 3A · 157 obs. semanales", benchmarkName: null, maxDrawdownLabel: "Máx. caída 3A",
      methodologyFootnote: "Sharpe 3A calculado con €STR como activo sin riesgo.", salida: "cliente"
    } as never);
    const todo = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).map(plano).join(" ");
    expect(todo).toContain("RF Deuda Corporativa Global Emergente - EUR Cubierto");
    expect(todo).toContain("RV Asia (ex-Japón)");
    expect(todo).not.toContain("EAA Fund");
    expect(todo).not.toContain("…");
  }, 30_000);
});
