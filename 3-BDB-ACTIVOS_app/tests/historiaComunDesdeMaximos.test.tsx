/**
 * Decisión 115 (06-11-2026): la historia común se mide de máximo a mínimo, y lo dicen la tarjeta de Simular, también en Modo
 * cliente, y el 6.2 del interno; las crisis siguen midiendo desde su primer día. El máximo llega del servidor en `peak_date`:
 * sin él, que es lo que mandan unas Functions anteriores, nada dice «desde máximos», porque no se midió así.
 *
 * Las cifras son las de la muestra en la base nueva, medidas a mano con su serie: la COVID, −22,171 % del 19-02-2020 al
 * 23-03-2020 con los pesos de hoy ese día; la historia común, que empieza el 27-11-2018, −23,252 % de su máximo del 19-02-2020
 * a su mínimo del 23-03-2020, y de vuelta al máximo el 27-11-2020. Antes decía −8,412 %, del 27-11-2018 al mínimo.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { parseBacktestResponse, type BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";
import { HistoricalStressCards } from "../src/components/HistoricalStressCards";
import { createInternalPortfolioReportPdfBlob } from "../src/reports/internalPortfolioReportPdf";
import type { InternalReportInput } from "../src/core/internalPortfolioReport";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

const comun = {
  common_data_end_date: "2026-11-02", recovery_status: "RECOVERED" as const, remaining_to_recover_pct: 0, worst_asset: null,
  coverage: { weight_pct: 100, included_assets: 2, total_assets: 2 }, representative: true, included_assets: ["DEMO_A", "DEMO_B"], excluded_assets: [], reason: null
};
const COVID: BacktestStressScenario = {
  ...comun, id: "COVID", label: "COVID-19", configured_start_date: "2020-02-19", configured_end_date: "2020-03-23", start_date: "2020-02-19",
  end_date: "2020-03-23", peak_date: null, trough_date: "2020-03-23", drawdown_pct: -22.171, duration_days: 33, recovery_date: "2020-11-24", recovery_days: 246
};
const TIPOS: BacktestStressScenario = {
  ...comun, id: "RATES_2022", label: "Tipos-2022", configured_start_date: "2022-01-01", configured_end_date: "2022-10-31", start_date: "2022-01-04",
  end_date: "2022-10-31", peak_date: null, trough_date: "2022-10-12", drawdown_pct: -14.512, duration_days: 281, recovery_date: "2024-02-07", recovery_days: 483
};
const HISTORIA: BacktestStressScenario = {
  ...comun, id: "COMMON_HISTORY", label: "Historia común", configured_start_date: "2018-11-27", configured_end_date: "2026-11-06", start_date: "2018-11-27",
  end_date: "2026-11-02", peak_date: "2020-02-19", trough_date: "2020-03-23", drawdown_pct: -23.252053, duration_days: 33, recovery_date: "2020-11-27", recovery_days: 249
};
/** Lo que mandan unas Functions anteriores a la 115: el escenario sin el campo. */
function sinMaximo(escenario: BacktestStressScenario): BacktestStressScenario {
  const copia = { ...escenario };
  delete copia.peak_date;
  return copia;
}
/** Y lo que medían en la historia común: del primer día al mínimo. */
const HISTORIA_ANTES = sinMaximo({ ...HISTORIA, drawdown_pct: -8.411652, duration_days: 482, recovery_date: "2020-04-07", recovery_days: 15 });

describe("el adaptador", () => {
  const respuesta = (escenarios: object[]) => ({
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", frequency: "DAILY", units: "decimal",
    metrics: { cagr: 0.04, volatility: 0.12, sharpe: 0.3, max_drawdown: -0.1, rf_rate: 0.02 },
    portfolio_series: [{ date: "2024-01-05", value: 100 }], asset_ids: ["DEMO_A"], weights_normalized: { DEMO_A: 1 }, correlation_matrix: [[1]],
    benchmark_series: {}, synthetics: [], stress_scenarios: escenarios, coverage: null, excluded_assets: [], warnings: []
  });

  test("lee el máximo de la historia común, y una crisis no tiene", () => {
    const leido = parseBacktestResponse(respuesta([COVID, TIPOS, HISTORIA])).stress_scenarios;
    expect(leido.map((e) => e.peak_date)).toEqual([null, null, "2020-02-19"]);
  });

  test("unas Functions anteriores no lo mandan: queda en null, y no se rechaza", () => {
    const leido = parseBacktestResponse(respuesta([COVID, TIPOS, HISTORIA_ANTES].map(sinMaximo))).stress_scenarios;
    expect(leido.map((e) => e.peak_date)).toEqual([null, null, null]);
  });
});

describe("la tarjeta de Simular", () => {
  const pinta = (escenarios: BacktestStressScenario[], cliente = false) => renderToStaticMarkup(
    <ClientModeProvider initialValue={cliente}><HistoricalStressCards scenarios={escenarios} /></ClientModeProvider>
  );

  test.each([false, true])("la historia común es una caída máxima, y dice desde qué máximo (Modo cliente: %s)", (cliente) => {
    const html = pinta([COVID, TIPOS, HISTORIA], cliente);
    expect((html.match(/Caída máxima/g) ?? [])).toHaveLength(1);
    /* Rediseño (14-11-2026): la caída con dos decimales (ANA-10) y las fechas como en el resto de la pantalla (ANA-26); antes
       «−23,3 %», «19 feb 2020». Lo que se comprueba no cambia: desde qué máximo cuenta, y solo la historia común lo dice. */
    expect(html).toMatch(/−23,25\s%/);
    expect(html).toContain("33 días · máximo 19/02/2020 · mínimo 23/03/2020");
    expect(html).toContain("249 días · 27/11/2020");
    /* La ventana de la historia común sigue arriba, y la COVID sigue desde su primer día, sin máximo. */
    expect(html).toContain("27/11/2018 – 02/11/2026");
    expect(html).toMatch(/−22,17\s%/);
    expect((html.match(/máximo \d/g) ?? [])).toHaveLength(1);
  });

  test("sin máximo, como manda un servidor anterior, no dice que mide desde máximos", () => {
    const html = pinta([COVID, TIPOS, HISTORIA_ANTES]);
    expect(html).not.toContain("Caída máxima");
    expect(html).not.toMatch(/máximo \d/);
    expect(html).toContain("482 días · mínimo 23/03/2020");
  });
});

describe("el 6.2 del interno", () => {
  const positions = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_B", weight_percent: 40 }];
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
    portfolio_name: "Cartera de la historia común", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 60 }, { key: "FIXED_INCOME", weight_percent: 40 }], weighted_metrics: {} },
    positions: positions.map((p, i) => ({ ...p, display_name: assets[i].display_name, instrument_type: "FUND", economic_asset_class: assets[i].economic_asset_class, currency: "EUR",
      coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: assets[i].pms_exposure })),
    warnings: [], xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 100 }], by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] },
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;

  let h3: Awaited<ReturnType<typeof fetchPortfolioHorizon>>;
  beforeAll(async () => { h3 = await fetchPortfolioHorizon(positions, "3Y"); });

  const texto = async (stress: BacktestStressScenario[]) => {
    const input: InternalReportInput = {
      report, assets, positions, totalCapital: 100000, benchmarkId: "equilibrado",
      horizons: { "3Y": { ...h3, backtest: { ...h3.backtest, stress_scenarios: stress } } }, horizonErrors: {},
      lookThrough: null, overlap: null, retro: { status: "denied", records: new Map() }, regionRows: [], feasibility: null,
      generatedAt: "2026-11-06T12:00:00Z", includeAssetSheets: false
    };
    return extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  };

  test("dice que la historia común es desde máximos, con las fechas de ese máximo y ese mínimo; las crisis, como estaban", async () => {
    const todo = await texto([COVID, TIPOS, HISTORIA]);
    const estres = todo.slice(todo.indexOf("Escenarios de estrés históricos"));
    /* 14-11-2026, plantilla única: la caída con dos decimales y el periodo «del … al …», del formato común. Antes, «−23,3 %» y «19/02/2020 – 23/03/2020». */
    expect(estres).toContain("Historia común, desde máximos −23,25 %");
    expect(estres).toContain("del 19/02/2020 al 23/03/2020 · recuperada en 249 días · cobertura 100 %");
    expect(estres).not.toContain("del 27/11/2018 al 23/03/2020");
    expect(estres).toContain("COVID-19 −22,17 % del 19/02/2020 al 23/03/2020 · recuperada en 246 días · cobertura 100 %");
    expect(estres).toContain("Tipos-2022 −14,51 % del 04/01/2022 al 12/10/2022 · recuperada en 483 días · cobertura 100 %");
    /* La frase de lectura ordena solo lo que se mide igual: la historia común, más honda, no entra en la cuenta de las crisis. */
    expect(todo).toContain("El escenario histórico más duro para esta composición es COVID-19: −22,17 %.");
    expect(todo).not.toContain("es Historia común");
  }, 60_000);

  test("sin máximo, lo de antes: el primer día y el mínimo, y la historia común compite como entonces", async () => {
    const todo = await texto([COVID, TIPOS, { ...HISTORIA_ANTES, drawdown_pct: -30 }]);
    const estres = todo.slice(todo.indexOf("Escenarios de estrés históricos"));
    expect(estres).not.toContain("desde máximos");
    expect(estres).toContain("del 27/11/2018 al 23/03/2020 · recuperada en 15 días");
    expect(todo).toContain("El escenario histórico más duro para esta composición es Historia común: −30,00 %.");
  }, 60_000);
});
