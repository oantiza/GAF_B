/**
 * El informe interno, en tres cosas de la tanda del 05-11-2026: una crisis que mide menos del 60 % no da cifra (decisión 103), una posición
 * fuera del catálogo se llama así y no «Otros · Otros» (como el resto del papel desde la 85), y la nota del Máximo Sharpe dice lo que hace el
 * encogimiento solo donde es cierto (decisión 95). Resultados escritos a mano.
 */
import { beforeAll, describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";
import { createInternalPortfolioReportPdfBlob, encogimientoDelMaximoSharpe } from "../src/reports/internalPortfolioReportPdf";
import type { InternalHorizonModel, InternalReportInput, InternalReportModel } from "../src/core/internalPortfolioReport";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

const FRASE = "El modelo acerca lo que espera de la renta fija a lo que espera de la bolsa, y por eso esta cartera suele llevar más renta fija de lo que sugiere la serie.";

describe("decisión 95: la nota del Máximo Sharpe en el interno", () => {
  const activos = new Map(([["A", "EQUITY"], ["B", "EQUITY"], ["F", "EQUITY"], ["C", "FIXED_INCOME"], ["D", "FIXED_INCOME"], ["E", "MIXED"]] as const)
    .map(([asset_id, economic_asset_class]) => [asset_id, { asset_id, economic_asset_class } as unknown as BdbAssetDetail]));
  const m = { assetsById: activos } as unknown as Pick<InternalReportModel, "assetsById">;
  const ventana = (years: number, ids: string[], conMaximo = true) => ({
    horizon: { years, maxSharpe: conMaximo ? {} : null, frontier: { maxSharpe: { pesosCompletos: Object.fromEntries(ids.map((id) => [id, 1 / ids.length])) } } }
  }) as unknown as Pick<InternalHorizonModel, "horizon">;

  test("renta fija y bolsa, y más de tres activos, en las dos ventanas: la frase una vez", () => {
    expect(encogimientoDelMaximoSharpe([ventana(3, ["A", "B", "C", "D"]), ventana(5, ["A", "B", "C", "D"])], m)).toBe(` ${FRASE}`);
  });

  test("cierta en una ventana y no en la otra: dice en cuál", () => {
    expect(encogimientoDelMaximoSharpe([ventana(3, ["A", "B", "C", "D"]), ventana(5, ["A", "B", "C"])], m)).toBe(
      " A 3 años, el modelo acerca lo que espera de la renta fija a lo que espera de la bolsa, y por eso esta cartera suele llevar más renta fija de lo que sugiere la serie."
    );
  });

  test("donde no es cierta, no sale: solo bolsa, tres activos, bolsa y mixto, o sin Máximo Sharpe", () => {
    expect(encogimientoDelMaximoSharpe([ventana(3, ["A", "B", "F", "E"])], m)).toBe("");
    expect(encogimientoDelMaximoSharpe([ventana(3, ["A", "B", "C"])], m)).toBe("");
    expect(encogimientoDelMaximoSharpe([ventana(3, ["A", "B", "E", "C"], false)], m)).toBe("");
    expect(encogimientoDelMaximoSharpe([], m)).toBe("");
  });
});

describe("el papel interno: crisis por debajo del 60 % y una posición fuera del catálogo", () => {
  const positions = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_B", weight_percent: 30 }];
  function asset(id: string, name: string, clase: "EQUITY" | "FIXED_INCOME"): BdbAssetDetail {
    return {
      asset_id: id, isin: id, display_name: name, instrument_type: "FUND", economic_asset_class: clase, currency: "EUR",
      coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
      category: "RV Global", region: "Global", metrics: { annualized_return_3y: 0.05, volatility_3y: 0.1, sharpe_3y: 0.4, metrics_method: "GEOMETRIC_CAGR" },
      pms_exposure: { equity: clase === "EQUITY" ? 1 : 0, fixed_income: clase === "EQUITY" ? 0 : 1, cash: 0, alternative: 0, other: 0 }, costs: { ongoing_charge: 0.01 }
    };
  }
  const assets = [asset("DEMO_A", "Fondo Global Alfa", "EQUITY"), asset("DEMO_B", "Fondo Bonos Beta", "FIXED_INCOME")];
  const report = {
    portfolio_name: "Cartera con una fuera", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: {
      by_instrument_type: [{ key: "FUND", weight_percent: 90 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 60 }, { key: "FIXED_INCOME", weight_percent: 30 }], weighted_metrics: {},
      not_found_weight_percent: 10, not_found_positions: [{ asset_id: "XS0000000000", weight_percent: 10 }]
    },
    positions: positions.map((p, i) => ({ ...p, display_name: assets[i].display_name, instrument_type: "FUND", economic_asset_class: assets[i].economic_asset_class, currency: "EUR",
      coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: assets[i].pms_exposure })),
    warnings: [], xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 100 }], by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] },
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;

  const crisis = (id: BacktestStressScenario["id"], peso: number, cifra: number, fuera: string[] = []): BacktestStressScenario => ({
    id, label: id === "COVID" ? "COVID-19" : id === "RATES_2022" ? "Tipos-2022" : "Historia común", configured_start_date: "2020-02-19", configured_end_date: "2020-03-23",
    start_date: "2020-02-19", end_date: "2020-03-23", trough_date: "2020-03-18", common_data_end_date: "2026-10-30", drawdown_pct: cifra, duration_days: 28,
    recovery_date: "2020-10-12", recovery_days: 208, remaining_to_recover_pct: 0, recovery_status: "RECOVERED", worst_asset: null,
    coverage: { weight_pct: peso, included_assets: 1, total_assets: 3 }, representative: peso >= 60, included_assets: ["DEMO_A"],
    excluded_assets: fuera.map((asset_id) => ({ asset_id, reason: "NO_DATA_AT_WINDOW_START" as const })), reason: null
  });

  let h3: Awaited<ReturnType<typeof fetchPortfolioHorizon>>;
  beforeAll(async () => { h3 = await fetchPortfolioHorizon(positions, "3Y"); });

  function input(stress: BacktestStressScenario[]): InternalReportInput {
    return {
      report, assets, positions: [...positions, { asset_id: "XS0000000000", weight_percent: 10 }], totalCapital: 100000, benchmarkId: "equilibrado",
      horizons: { "3Y": { ...h3, backtest: { ...h3.backtest, stress_scenarios: stress } } }, horizonErrors: {},
      lookThrough: null, overlap: null, retro: { status: "denied", records: new Map() }, regionRows: [], feasibility: null,
      generatedAt: "2026-11-05T12:00:00Z", includeAssetSheets: true
    };
  }

  test("la crisis por debajo del 60 % dice que falta, cuánto mide y quién queda fuera; la de encima, su cifra", async () => {
    const texto = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input([
      crisis("COVID", 30, -6.38689, ["DEMO_B", "XS0000000000"]), crisis("RATES_2022", 60, -16.13), crisis("COMMON_HISTORY", 90, -11.1)
    ]))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    const estres = texto.slice(texto.indexOf("Escenarios de estrés históricos"));
    expect(estres).toContain("COVID-19 Falta el dato");
    expect(estres).toContain("Mide el 30,0 % de la cartera, y hace falta al menos el 60 %. Fuera: Fondo Bonos Beta (30,0 %) y XS0000000000 (10,0 %).");
    /* 14-11-2026, plantilla única: la caída, con dos decimales del formato común (antes «−6,4 %» y «−16,1 %»). */
    expect(estres).not.toContain("−6,39 %");
    expect(estres).toContain("−16,13 %");
    expect(estres).toContain("cobertura 60 %");
    /* La salvedad de antes pasa a ser el motivo: ni asterisco ni su nota. */
    expect(estres).not.toContain("Cobertura insuficiente para ser representativo de la cartera");
  }, 40_000);

  test("una posición fuera del catálogo dice «Fuera del catálogo», en la hoja de posiciones y en su ficha", async () => {
    const texto = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input([
      crisis("COVID", 90, -20), crisis("RATES_2022", 90, -14), crisis("COMMON_HISTORY", 90, -11)
    ]))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("XS0000000000 · Fuera del catálogo");
    expect(texto).not.toMatch(/Otros · Otros|Otros Otros/);
    expect(texto).toMatch(/XS0000000000 XS0000000000 Fuera del catálogo/);
  }, 40_000);
});
