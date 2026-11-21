import { beforeAll, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { createInternalPortfolioReportPdfBlob } from "../src/reports/internalPortfolioReportPdf";
import type { InternalReportInput } from "../src/core/internalPortfolioReport";
import type { StoredImprovement } from "../src/core/improvementResultStore";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

const positions = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_B", weight_percent: 40 }];
function asset(id: string, name: string, ter: number): BdbAssetDetail {
  return {
    asset_id: id, isin: id, display_name: name, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    category: "RV Global", region: "Global", metrics: { annualized_return_3y: 0.05, volatility_3y: 0.1, sharpe_3y: 0.4, metrics_method: "GEOMETRIC_CAGR" },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }, costs: { ongoing_charge: ter }
  };
}
const assets = [asset("DEMO_A", "Fondo Global Alfa A Acc", 0.015), asset("DEMO_B", "Fondo Bonos Beta", 0.01)];
const report = {
  portfolio_name: "Cartera con propuesta", mode: "BBDD_STATIC_EXPORT_SAMPLE",
  summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], weighted_metrics: {} },
  positions: positions.map((p, i) => ({ ...p, display_name: assets[i].display_name, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: assets[i].pms_exposure })),
  warnings: [], xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 100 }], by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] },
  data_diagnostic: {}
} as unknown as BdbPortfolioReport;

const metrics = (cagr: number, vol: number, mdd: number, weeks: number) => ({ cagr, volatility: vol, sharpe: (cagr - 0.02) / vol, max_drawdown: mdd, cumulative_return: cagr, weeks });
const response: ImprovementResponse = {
  schema_version: "portfolio-improvement.v1", status: "PROPOSAL", window: "3Y",
  original: { weights: { DEMO_A: 0.6, DEMO_B: 0.4 }, metrics: { selection: metrics(0.05, 0.12, -0.15, 104), confirmation: metrics(0.04, 0.12, -0.10, 52), full: metrics(0.05, 0.12, -0.15, 156) }, weighted_cost: 0.013 },
  windows: { frequency: "WEEKLY", full: { first_date: "2023-10-02", last_date: "2026-10-05", weeks: 156 }, selection: { first_date: "2023-10-02", last_date: "2025-10-06", weeks: 104 }, confirmation: { first_date: "2025-10-06", last_date: "2026-10-05", weeks: 52 } },
  proposals: [{
    substitutions: [{ from_asset_id: "DEMO_A", to_asset_id: "DEMO_A2", from_name: "Fondo Global Alfa A Acc", to_name: "Fondo Global Alfa I Acc", weight: 0.6, correlation: 0.99, tracking_error: 0.004, same_fund_class: true }],
    weights: { DEMO_A2: 0.6, DEMO_B: 0.4 },
    metrics: { selection: metrics(0.055, 0.12, -0.15, 104), confirmation: metrics(0.045, 0.12, -0.10, 52), full: metrics(0.055, 0.12, -0.15, 156) },
    deltas_confirmation: { cagr: 0.005, volatility: 0, sharpe: 0.04, max_drawdown: 0 },
    weighted_cost: 0.0094,
    validation: [{ key: "cost", label: "Coste corriente ponderado", status: "PASS", detail: "−0,36 pp" }],
    improvements: [{ key: "cost", label: "Coste corriente ponderado", delta: -0.0036 }],
    consistency: { windows: 26, wins: 26, share: 1, rolling_weeks: 52 },
    valid: true
  }],
  rejected_candidates: {}, excluded_assets: [], evaluated_combinations: 1, search: "EXHAUSTIVE", warnings: [],
  risk_free: { risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" }
};
const improvement: StoredImprovement = {
  schema_version: "improvement-result.v1", fingerprint: "DEMO_A:60.0000|DEMO_B:40.0000", savedAt: "2026-10-13T18:30:00Z",
  response, proposalIndex: 0,
  assets: { DEMO_A: { name: "Fondo Global Alfa A Acc", ongoingCharge: 0.015 }, DEMO_A2: { name: "Fondo Global Alfa I Acc", ongoingCharge: 0.006 }, DEMO_B: { name: "Fondo Bonos Beta", ongoingCharge: 0.01 } },
  equivalence: { "DEMO_A:DEMO_A2": { verdict: "SAME_FUND_CLASS", reason: "Otra clase del mismo fondo: misma estrategia, cambian costes, divisa o distribución.", shared: [], differing: ["Divisa de la clase: EUR → USD"], missing: [] } },
  skipped: [{ asset_id: "DEMO_B", reason: "Sin fondos de la misma categoría o región en el catálogo." }]
};

let h3: Awaited<ReturnType<typeof fetchPortfolioHorizon>>;
beforeAll(async () => { h3 = await fetchPortfolioHorizon(positions, "3Y"); });

function input(overrides: Partial<InternalReportInput> = {}): InternalReportInput {
  return {
    report, assets, positions, totalCapital: 100000, benchmarkId: "equilibrado", horizons: { "3Y": h3 }, horizonErrors: {},
    lookThrough: null, overlap: null, retro: { status: "denied", records: new Map() }, regionRows: [], feasibility: null,
    generatedAt: "2026-10-13T12:00:00Z", includeAssetSheets: false, ...overrides
  };
}

test("el informe interno incluye la propuesta de mejora cuando hay un cálculo para esta composición", async () => {
  const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input({ improvement }))).arrayBuffer()));
  const text = pages.join(" ");
  expect(text).toContain("Propuesta de mejora de fondos");
  expect(text).toContain("Propuesta que cumple las condiciones");
  expect(text).toContain("calculada el 13/10/2026");
  expect(text).toContain("Fondo Global Alfa I Acc");
  expect(text).toContain("Otra clase");
  expect(text).toContain("no cuentan en el máximo de sustituciones");
  /* El servidor escribe «ponderado» en el rótulo de su comprobación; el papel lo dice como la pantalla, «medio». */
  expect(text).toContain("Coste corriente medio");
  expect(text).not.toContain("ponderado");
  expect(text).toContain("Cumple");
  expect(text).toContain("Misma estrategia, otra clase");
  expect(text).toContain("Fondo Bonos Beta (Sin fondos de la misma categoría");
  expect(text).toContain("Solo fondos por fondos");
  // Auditoría 16-10: «→» y «Δ» no tienen glifo en Instrument Sans; salen en palabras.
  expect(text).toContain("Fondo Global Alfa A Acc por Fondo Global Alfa I Acc");
  expect(text).toContain("EUR a USD");
  expect(text).toContain("Dif. coste");
  /* El fondo que sale lleva el número de su posición, el mismo que en todas las tablas. */
  expect(text.replace(/\s+/g, " ")).toMatch(/# Fondo actual/);
}, 60000);

test("sin cálculo guardado, la sección lo dice y remite al Constructor", async () => {
  const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input())).arrayBuffer()));
  const text = pages.join(" ");
  expect(text).toContain("Propuesta de mejora de fondos");
  expect(text).toContain("No se ha calculado una propuesta");
  /* Manda al botón que hay (papel-3 de las puertas finales, 06-11-2026): «Mejorar cartera» no existe desde el 04-11. */
  expect(text.replace(/\s+/g, " ")).toContain("se calcula en Diseño de cartera › Optimizar › «Buscar sustituciones»");
  expect(text).not.toContain("Mejorar cartera");
  expect(text).not.toContain("Fondo Global Alfa I Acc");
  /* Una línea en su sección, no una hoja entera que dice que no hay nada. */
  expect(pages.find((page) => page.includes("No se ha calculado una propuesta"))).toContain("Frontera");
}, 60000);

test("con una acción, la sección de la propuesta dice lo que no incluye el coste, y sin ella no (decisiones 10 y 80)", async () => {
  const hojaDeLaPropuesta = async (activos: BdbAssetDetail[]) => {
    const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input({ improvement, assets: activos }))).arrayBuffer()));
    return pages.find((page) => page.includes("Propuesta que cumple las condiciones"))!.replace(/\s+/g, " ");
  };
  expect(await hojaDeLaPropuesta(assets)).not.toContain("custodia ni corretaje");
  const conAccion = await hojaDeLaPropuesta([assets[0], { ...assets[1], instrument_type: "STOCK", costs: undefined }]);
  expect(conAccion).toMatch(/la empeora\. \S/);
  expect(conAccion).toContain("No incluye custodia ni corretaje.");
}, 60000);
