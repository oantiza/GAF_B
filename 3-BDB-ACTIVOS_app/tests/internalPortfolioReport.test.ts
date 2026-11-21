import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { cargarSeriesDeReferencia } from "../src/adapters/seriesDeReferencia";
import { buildInternalReportModelWithLabels, createInternalPortfolioReportPdfBlob, enDosLineas, enOrdenDePosicion, escalaDeCaidas, mesLegible, pct, pctSigned, ratio, shorten } from "../src/reports/internalPortfolioReportPdf";
import { anioQueMasDifiere, avisosDeEstasCifras, barraDelIndicador, bucketsDeLaMezcla, filaDeCalidadDeDatos, filasDeAniosNaturales, loQueMide, notaDelMaximoSharpe, origenDeLasMetricas, origenDelRiesgo, topeDelModelo, versionDeLaReferencia, type InternalReportInput } from "../src/core/internalPortfolioReport";
import { buildReportOverlap } from "../src/core/reportOverlap";
import { buildReportFromAssets, computePmsExposureDistribution } from "../src/core/portfolio";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));


const ids = ["DEMO_A", "DEMO_B", "DEMO_C"] as const;
const positions = [
  { asset_id: "DEMO_A", weight_percent: 50 },
  { asset_id: "DEMO_B", weight_percent: 30 },
  { asset_id: "DEMO_C", weight_percent: 20 }
];

function asset(id: string, i: number, extra: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id: id, isin: id, display_name: `Fondo Ñandú ${i + 1}`, instrument_type: "FUND",
    economic_asset_class: i === 1 ? "FIXED_INCOME" : "EQUITY", currency: i === 2 ? "USD" : "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    category: i === 1 ? "RF Euro corto plazo" : "RV Global", region: "Global",
    metrics: { risk_score: i === 2 ? undefined : 3 + i, risk_score_source: "KID", annualized_return_1y: 0.05 + i / 100,
      annualized_return_3y: i === 2 ? undefined : 0.04, volatility_3y: i === 2 ? undefined : 0.08, sharpe_3y: 0.4,
      metrics_method: i === 0 ? "GEOMETRIC_CAGR" : "TRAILING_PROVIDER" },
    pms_exposure: i === 1 ? { equity: 0, fixed_income: 0.9, cash: 0.1, alternative: 0, other: 0 } : { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    costs: i === 2 ? {} : { ongoing_charge: 0.01 + i / 1000, management_fee: 0.008 },
    holdings_summary: { has_holdings: true, positions_count: 40 + i, top10_weight: 35, as_of_date: "2026-08-31" },
    ...extra
  };
}
const assets = ids.map((id, i) => asset(id, i));

const report = {
  portfolio_name: "Cartera Ávila interna", mode: "BBDD_STATIC_EXPORT_SAMPLE",
  summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }],
    by_economic_asset_class: [{ key: "EQUITY", weight_percent: 70 }, { key: "FIXED_INCOME", weight_percent: 30 }], weighted_metrics: {} },
  positions: positions.map((p, i) => ({ ...p, display_name: assets[i].display_name, instrument_type: "FUND",
    economic_asset_class: assets[i].economic_asset_class, currency: assets[i].currency, coverage_status: "COMPLETE",
    is_investable: true, role: "INVESTABLE", quality_flags: i === 2 ? ["MISSING_HOLDINGS"] : [], pms_exposure: assets[i].pms_exposure })),
  warnings: ["Aviso de prueba del informe"],
  xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 80 }, { key: "USD", weight_percent: 20 }],
    by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }],
    by_economic_asset_class: [{ key: "EQUITY", weight_percent: 70 }, { key: "FIXED_INCOME", weight_percent: 30 }] },
  data_diagnostic: {}
} as unknown as BdbPortfolioReport;

const retroRecords = new Map<string, CommercialRetroRecord>([
  /* Dentro de lo que cobra cada fondo (1,0 % y 1,1 % de gastos corrientes): una retrocesión mayor no se usa (RET-2). */
  ["DEMO_A", { isin: "DEMO_A", retro_pct: 0.9, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord],
  ["DEMO_B", { isin: "DEMO_B", retro_pct: 0.6, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord]
]);

// Los dos análisis se piden una vez y en secuencia (la ruta de la interfaz con el backend simulado).
let h3: Awaited<ReturnType<typeof fetchPortfolioHorizon>>;
let h5: Awaited<ReturnType<typeof fetchPortfolioHorizon>>;
let referencia: Awaited<ReturnType<typeof cargarSeriesDeReferencia>>;
// El simulador (demoBackend) genera las series desde «hoy» y salta sábados y domingos: sin reloj
// fijo, las mismas aserciones daban otro resultado según el día. Se fija al jueves 06-11-2026, el
// día en que se escribieron, para que el fixture sea siempre el mismo.
const RELOJ_FIJO = "2026-11-06T12:00:00Z";
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(RELOJ_FIJO));
  h3 = await fetchPortfolioHorizon(positions, "3Y");
  h5 = await fetchPortfolioHorizon(positions, "5Y");
  referencia = await cargarSeriesDeReferencia();
});
afterAll(() => { vi.useRealTimers(); });

async function baseInput(overrides: Partial<InternalReportInput> = {}): Promise<InternalReportInput> {
  return {
    report, assets, positions, totalCapital: 200000, benchmarkId: "equilibrado", referencia,
    horizons: { "3Y": h3, "5Y": h5 }, horizonErrors: {}, lookThrough: null, overlap: null,
    retro: { status: "ok", records: retroRecords }, regionRows: [{ key: "north_america", weight_percent: 60 }, { key: "europe", weight_percent: 40 }],
    feasibility: null, generatedAt: "2026-10-13T12:00:00Z", includeAssetSheets: true,
    ...overrides
  };
}

describe("110. Un fondo con cifras nuestras y del proveedor", () => {
  const conMetodos = (metrics: Partial<BdbAssetDetail["metrics"]>) => assets.map((a, i) => ({ ...a, metrics: { ...a.metrics, metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY", ...(i === 0 ? metrics : {}) } }));
  const mensual = { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" };
  const suyo = { method: "TRAILING_PROVIDER", frequency: "PROVIDER" };
  const mezcla = { metrics_method: "PROPIA_Y_PROVEEDOR", metrics_frequency: undefined };

  test("si solo es suya la de 10 años, sus 3 años cuentan como los de los demás, y su línea dice las dos", async () => {
    const modelo = buildInternalReportModelWithLabels(await baseInput({ assets: conMetodos({ ...mezcla, metrics_by_window: { "1y": mensual, "3y": mensual, "10y": suyo } }) }));
    expect(modelo.positions[0]!.metricsMethod).toBe("EXTRACTOR_MONTHLY_V2");
    expect(modelo.positions[0]!.metodoDeLaFicha).toBe("PROPIA_Y_PROVEEDOR");
    expect((modelo as { sharpeDeMetodosDistintos?: boolean }).sharpeDeMetodosDistintos ?? false).toBe(false);
  });

  test("la barra de la metodología de las métricas la cuenta como la hoja de calidad y el anexo: «propia y proveedor» (revisión final, V3-3)", async () => {
    /* Como Vanguard en la muestra: sus 3 años son nuestros y su 10 años del proveedor. DEMO_A pesa el 50 %. */
    const modelo = buildInternalReportModelWithLabels(await baseInput({ assets: conMetodos({ ...mezcla, metrics_by_window: { "1y": mensual, "3y": mensual, "10y": suyo } }) }));
    const barra = Object.fromEntries(modelo.allocation.byMetricsMethod.map((fila) => [fila.key, fila.weight]));
    expect(barra.PROPIA_Y_PROVEEDOR).toBeCloseTo(0.5, 10);
    expect(barra.EXTRACTOR_MONTHLY_V2).toBeCloseTo(0.5, 10);
    expect(modelo.allocation.byMetricsMethod.find((fila) => fila.key === "PROPIA_Y_PROVEEDOR")!.label).toBe("Calculada por nosotros y, donde no llega, cifra del proveedor");
    /* La regla del Sharpe sigue con sus 3 años: no hay métodos distintos. */
    expect((modelo as { sharpeDeMetodosDistintos?: boolean }).sharpeDeMetodosDistintos ?? false).toBe(false);
  });

  test("si es suya la de 3 años, esa posición es del proveedor en lo que compara la tabla", async () => {
    const modelo = buildInternalReportModelWithLabels(await baseInput({ assets: conMetodos({ ...mezcla, metrics_by_window: { "1y": mensual, "3y": suyo } }) }));
    expect(modelo.positions[0]!.metricsMethod).toBe("TRAILING_PROVIDER");
    expect(modelo.positions[0]!.metodoDeLaFicha).toBe("PROPIA_Y_PROVEEDOR");
    expect(modelo.positions[1]!.metodoDeLaFicha).toBe("EXTRACTOR_MONTHLY_V2");
  });
});

describe("modelo del informe interno", () => {
  test("retrocesión y TER ponderados solo sobre el peso con dato; lo que falta no es cero", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    expect(m.retro.coverage).toBeCloseTo(0.8, 10);
    expect(m.retro.weightedRetroPct).toBeCloseTo((0.5 * 0.9 + 0.3 * 0.6) / 0.8, 10);
    expect(m.retro.annualIncomeEur).toBeCloseTo(200000 * (0.5 * 0.009 + 0.3 * 0.006), 6);
    expect(m.costs.terCoverage).toBeCloseTo(0.8, 10);
    expect(m.positions.find((p) => p.assetId === "DEMO_C")!.ter).toBeNull();
    expect(m.positions.find((p) => p.assetId === "DEMO_C")!.retroPct).toBeNull();
  });

  test("una retrocesión mayor que lo que cobra el fondo no se usa, y se dice (RET-2)", async () => {
    /* DEMO_A cobra un 1,0 % de gastos corrientes. Un 46 guardado es un porcentaje de la comisión, no del patrimonio:
       usado tal cual, sus 100.000 € darían 46.000 € al año. Queda la de DEMO_B: 60.000 € × 0,6 % = 360 €. */
    const registros = new Map<string, CommercialRetroRecord>([
      ["DEMO_A", { isin: "DEMO_A", retro_pct: 46, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord],
      ["DEMO_B", { isin: "DEMO_B", retro_pct: 0.6, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord]
    ]);
    const m = buildInternalReportModelWithLabels(await baseInput({ retro: { status: "ok", records: registros } }));
    const fila = m.positions.find((p) => p.assetId === "DEMO_A")!;
    expect(fila).toMatchObject({ retroPct: null, retroAsOf: null, retroIncomeEur: null, retroDescartada: { pct: 46, frenteA: "gastos corrientes" } });
    expect(fila.retroDescartada!.topePct).toBeCloseTo(1, 10);
    expect(m.retro.annualIncomeEur).toBeCloseTo(360, 6);
    expect(m.retro.weightedRetroPct).toBeCloseTo(0.6, 10);
    expect(m.reviewPoints).toContainEqual({
      severity: "alta",
      area: "Comercial",
      text: "La retrocesión guardada de Fondo Ñandú 1 (46,00 %) supera sus gastos corrientes (1,00 %): no puede ser un porcentaje del patrimonio, y no se usa. Parece un porcentaje de la comisión; corrígela en Administración."
    });
    /* Una que cabe en lo que cobra el fondo se usa, y la que no tiene ficha con qué comparar, también. */
    expect(m.positions.find((p) => p.assetId === "DEMO_B")).toMatchObject({ retroPct: 0.6, retroDescartada: null });
  });

  test("70 % en fondos al 1 % y 30 % en una acción: 0,70 % y 700 €, que casan; en la fila «No aplica»", async () => {
    const posiciones = [{ asset_id: "DEMO_A", weight_percent: 40 }, { asset_id: "DEMO_B", weight_percent: 30 }, { asset_id: "DEMO_C", weight_percent: 30 }];
    const conAccion = [
      asset("DEMO_A", 0, { costs: { ongoing_charge: 0.01 } }),
      asset("DEMO_B", 1, { costs: { ongoing_charge: 0.01 } }),
      asset("DEMO_C", 2, { instrument_type: "STOCK", display_name: "Iberdrola S.A.", costs: undefined, holdings_summary: { has_holdings: false } })
    ];
    const entrada = await baseInput({ assets: conAccion, positions: posiciones, totalCapital: 100000, includeAssetSheets: true });
    const m = buildInternalReportModelWithLabels(entrada);
    expect(m.costs.weightedTer).toBeCloseTo(0.007, 12);
    expect(m.costs.annualCostEur).toBeCloseTo(700, 8);
    expect(m.costs.terCoverage).toBeCloseTo(1, 12);
    expect(m.costs.stocks).toBe(1);
    expect(m.costs.missing).toBe(0);
    expect(m.positions.find((p) => p.assetId === "DEMO_C")!.ter).toBeNull();
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).not.toContain("Sin TER");

    const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer()));
    const text = pages.join(" ");
    expect(text).toContain("coste corriente del 0,70 %");
    expect(text).toContain("700");
    expect(text).not.toContain("coste corriente del 1,00 %");
    expect(text).toContain("No incluye custodia ni corretaje");
    expect(text).toContain("No aplica");
  }, 60000);

  test("una acción en retrocesiones: «No aplica» por su tipo, no cuenta como dato que falta, y el ingreso no cambia", async () => {
    const posiciones = [{ asset_id: "DEMO_A", weight_percent: 40 }, { asset_id: "DEMO_B", weight_percent: 30 }, { asset_id: "DEMO_C", weight_percent: 30 }];
    /* Se llama como un fondo a propósito: decide el tipo de instrumento, nunca el nombre. */
    const conAccion = [
      asset("DEMO_A", 0, { costs: { ongoing_charge: 0.01 } }),
      asset("DEMO_B", 1, { costs: { ongoing_charge: 0.01 } }),
      asset("DEMO_C", 2, { instrument_type: "STOCK", display_name: "Fondo Iberdrola", costs: undefined, holdings_summary: { has_holdings: false } })
    ];
    const registros = new Map<string, CommercialRetroRecord>([["DEMO_A", { isin: "DEMO_A", retro_pct: 1, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord]]);
    const entrada = await baseInput({ assets: conAccion, positions: posiciones, totalCapital: 100000, retro: { status: "ok", records: registros }, includeAssetSheets: true });
    const m = buildInternalReportModelWithLabels(entrada);
    /* 40 de los 70 puntos de fondos y ETF tienen dato: 57,14 %. La media, sobre esos 40; el ingreso, 40.000 € × 1 %. */
    expect(m.retro.coverage).toBeCloseTo(40 / 70, 10);
    expect(m.retro.weightedRetroPct).toBeCloseTo(1, 10);
    expect(m.retro.annualIncomeEur).toBeCloseTo(400, 8);
    const puntos = m.reviewPoints.filter((p) => p.area === "Comercial").map((p) => p.text).join(" | ");
    expect(puntos).toContain("Sin retrocesión registrada (30,0\u00a0% del peso): Fondo Ñandú 2.");
    expect(puntos).not.toContain("Fondo Iberdrola");

    const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
    const costes = pages.find((p) => p.includes("Vigencia retro."))!;
    /* En la fila de la acción: TER, gestión, coste, retrocesión, vigencia e ingreso. */
    expect(costes).toMatch(/Fondo Iberdrola .*(No aplica.*){6}/);
    expect(costes).toContain("57 % del peso de fondos y ETF");
    expect(costes).toContain("A una acción no le aplica.");
    expect(pages.join(" ")).toContain("retrocesión No aplica");
  }, 60000);

  test("solo acciones: la retrocesión no aplica, y no se avisa de que falte", async () => {
    const posiciones = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_C", weight_percent: 40 }];
    const acciones = [asset("DEMO_A", 0, { instrument_type: "STOCK", costs: undefined }), asset("DEMO_C", 2, { instrument_type: "STOCK", costs: undefined })];
    const entrada = await baseInput({ assets: acciones, positions: posiciones, retro: { status: "ok", records: new Map() }, includeAssetSheets: false });
    const m = buildInternalReportModelWithLabels(entrada);
    expect(m.retro.weightedRetroPct).toBeNull();
    expect(m.reviewPoints.map((p) => p.area)).not.toContain("Comercial");
    /* Ni «sobre el 0 % del peso de fondos y ETF», que no significa nada si no hay ninguno. */
    const texto = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("A una acción no le aplica la retrocesión.");
    expect(texto).toContain("Una acción no tiene retrocesión");
    expect(texto).not.toMatch(/0 % del peso de fon/);
    /* Tampoco «unos 0 €»: sonaría a gratis, y no hay coste ni ingreso que traducir a euros (decisión 5). */
    expect(texto).not.toContain("0 € al año");
    expect(texto).toMatch(/Coste anual estimado No aplica/);
    expect(texto).toMatch(/Ingreso anual estimado No aplica/);
    /* Con solo acciones tampoco hay coste corriente que promediar: ni «0,00 %» (decisión 83). */
    /* 14-11-2026, plantilla única: el importe de la tabla, con dos decimales (antes «200.000 €»). */
    expect(texto).toMatch(/Total 100,0 % 200\.000,00 € No aplica No aplica No aplica/);
    expect(texto).not.toMatch(/(?<!\d)0,00 %/);
  }, 60000);

  test("un fondo sin TER: la frase dice de qué parte del peso es cada cifra, y sigue sin ser un cero", async () => {
    const posiciones = [{ asset_id: "DEMO_A", weight_percent: 70 }, { asset_id: "DEMO_C", weight_percent: 30 }];
    const fondos = [asset("DEMO_A", 0, { costs: { ongoing_charge: 0.01 } }), asset("DEMO_C", 2, { costs: {} })];
    const entrada = await baseInput({ assets: fondos, positions: posiciones, totalCapital: 100000, includeAssetSheets: false });
    const m = buildInternalReportModelWithLabels(entrada);
    expect(m.costs.missing).toBe(1);
    expect(m.costs.weightedTer).toBeCloseTo(0.01, 12);
    expect(m.costs.terCoverage).toBeCloseTo(0.7, 12);
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ");
    expect(text).toContain("Coste corriente conocido del 1,00 % sobre el 70 % del peso con dato");
    expect(text).not.toContain("soporta un coste corriente del 1,00 %");
    expect(text).not.toContain("custodia ni corretaje");
  }, 60000);

  test("solapamiento: sin el consejo de fundir, con el aviso y lo mirado de cada fondo sacado del dato", async () => {
    const posiciones = [
      { asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", weight_percent: 50, instrument_type: "FUND" as const },
      { asset_id: "DEMO_B", display_name: "Fondo Ñandú 2", weight_percent: 30, instrument_type: "FUND" as const },
      { asset_id: "DEMO_C", display_name: "Fondo Ñandú 3", weight_percent: 20, instrument_type: "ETF" as const }
    ];
    const lineas = (id: string, pesos: Array<[string, number]>) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31", holdings: pesos.map(([name, weight_pct]) => ({ name, isin: name, weight_pct })) });
    const overlap = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["X", 60], ["Y", 40]])],
      ["DEMO_B", lineas("DEMO_B", [["X", 60], ["Z", 40]])],
      ["DEMO_C", lineas("DEMO_C", [["X", 26.64]])]
    ]));
    const entrada = await baseInput({ overlap, includeAssetSheets: false });
    const m = buildInternalReportModelWithLabels(entrada);
    /* A y B: min(60, 60) = 60. Los dos pares con C, sin medir. */
    expect(m.highOverlapPairs).toEqual([{ a: "Fondo Ñandú 1", b: "Fondo Ñandú 2", value: 60 }]);
    expect(m.overlapPairs).toEqual({ measured: 1, unmeasured: 2, mayor: { a: "Fondo Ñandú 1", b: "Fondo Ñandú 2", value: 60 } });
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).toContain("Fondo Ñandú 1 y Fondo Ñandú 2 comparten al menos el 60,0\u00a0% de sus subyacentes publicados.");
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).toContain("2 de 3 pares de fondos sin medir");
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ");
    for (const fuera of ["se pueden fundir", "fundir en uno", "simplificar la cartera", "sin perder exposición"]) expect(text).not.toContain(fuera);
    expect(text).toContain("1 par supera el 40 %");
    expect(text).toContain("comparten al menos el 60,0 % de su cartera");
    expect(text).toContain("al menos 60,0 %");
    expect(text).toContain("2 de 3 pares quedan sin medir");
    expect(text).toContain("Qué se ha mirado de cada fondo");
    expect(text).toContain("26,6 %");
    expect(text).toContain("falta más de la mitad");
  }, 60000);

  /* IMP-7 (17-11-2026): 31-ago → 30-sep son 30 días y no avisa; 31-ago → 15-oct, 30 + 15 = 45, avisa con las dos fechas. */
  test("solapamiento: carteras de fechas separadas por más de un mes, con las dos fechas; a 30 días, nada", async () => {
    const posiciones = [
      { asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", weight_percent: 60, instrument_type: "FUND" as const },
      { asset_id: "DEMO_B", display_name: "Fondo Ñandú 2", weight_percent: 40, instrument_type: "FUND" as const }
    ];
    const lineas = (id: string, as_of_date: string) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date, holdings: [["X", 60], ["Y", 40]].map(([name, weight_pct]) => ({ name: String(name), isin: String(name), weight_pct: Number(weight_pct) })) });
    const textoCon = async (fechaB: string) => {
      const overlap = buildReportOverlap(posiciones, new Map([["DEMO_A", lineas("DEMO_A", "2026-08-31")], ["DEMO_B", lineas("DEMO_B", fechaB)]]));
      const entrada = await baseInput({ overlap, includeAssetSheets: false });
      return extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ").replace(/(\p{L})- (\p{L})/gu, "$1$2");
    };
    expect(await textoCon("2026-10-15")).toContain("la de Fondo Ñandú 1, del 31/08/2026, y la de Fondo Ñandú 2, del 15/10/2026 (45 días)");
    expect(await textoCon("2026-09-30")).not.toContain("fechas separadas");
  }, 60000);

  test("solapamiento bajo: dice lo que se puede afirmar, porque un mínimo no prueba que no se supere el 40 % (decisión 47)", async () => {
    const posiciones = [
      { asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", weight_percent: 50, instrument_type: "FUND" as const },
      { asset_id: "DEMO_B", display_name: "Fondo Ñandú 2", weight_percent: 30, instrument_type: "FUND" as const },
      { asset_id: "DEMO_C", display_name: "Fondo Ñandú 3", weight_percent: 20, instrument_type: "FUND" as const }
    ];
    const lineas = (id: string, pesos: Array<[string, number]>) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31", holdings: pesos.map(([name, weight_pct]) => ({ name, isin: name, weight_pct })) });
    /* A y B comparten 3,21 y A y C, 0,6. Ninguno llega al 40. */
    const overlap = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["X", 3.21], ["Y", 0.6], ["Z", 96.19]])],
      ["DEMO_B", lineas("DEMO_B", [["X", 3.21], ["P", 96.79]])],
      ["DEMO_C", lineas("DEMO_C", [["Y", 0.6], ["Q", 99.4]])]
    ]));
    const entrada = await baseInput({ overlap, includeAssetSheets: false });
    const m = buildInternalReportModelWithLabels(entrada);
    expect(m.highOverlapPairs).toEqual([]);
    expect(m.overlapPairs).toEqual({ measured: 3, unmeasured: 0, mayor: { a: "Fondo Ñandú 1", b: "Fondo Ñandú 2", value: 3.21 } });
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("En lo medido ningún par llega al 40 %: lo más alto es al menos 3,2 %, entre las posiciones 1 y 2. El real puede ser mayor.");
    expect(text).not.toContain("supera el 40 %");
    /* Sin nada en común tampoco se afirma que no se solapen. */
    const nada = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["X", 100]])],
      ["DEMO_B", lineas("DEMO_B", [["Y", 100]])],
      ["DEMO_C", lineas("DEMO_C", [["Z", 100]])]
    ]));
    const entradaSinNada = await baseInput({ overlap: nada, includeAssetSheets: false });
    expect(buildInternalReportModelWithLabels(entradaSinNada).overlapPairs).toEqual({ measured: 3, unmeasured: 0, mayor: null });
    const sinNada = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entradaSinNada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(sinNada).toContain("En lo medido no se ha visto ninguna línea común entre dos fondos. Solo se mira lo recibido: no prueba que no las haya.");
    /* Decisión 88: las casillas dicen «sin comunes», y al pie de la matriz va la frase de pantalla. */
    expect(sinNada).toContain("sin comunes");
    expect(sinNada).not.toContain("al menos 0,0");
    expect(sinNada).toContain("Sin comunes: ningún título publicado coincide, por ISIN o por nombre; no prueba que no compartan nada.");
    /* Lo que no llega a una décima: «comunes < 0,1», sin «%» como el resto de cifras de la matriz, y la lectura no dice «al menos 0,0 %». */
    const casiNada = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["X", 0.05], ["R1", 99.95]])],
      ["DEMO_B", lineas("DEMO_B", [["X", 0.08], ["R2", 99.92]])],
      ["DEMO_C", lineas("DEMO_C", [["Z", 100]])]
    ]));
    const conCasiNada = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ overlap: casiNada, includeAssetSheets: false }))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(conCasiNada).toContain("comunes < 0,1");
    expect(conCasiNada).not.toContain("comunes < 0,1 %");
    expect(conCasiNada).toContain("En lo medido ningún par llega al 40 %: lo más alto no llega al 0,1 %, entre las posiciones 1 y 2. El real puede ser mayor.");
    expect(conCasiNada).not.toContain("al menos 0,0");
    /* Sin ningún par con cifra no hay nada que decir de lo medido, y no se afirma que no se haya visto nada. */
    const sinPares = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["X", 100]])],
      ["DEMO_B", lineas("DEMO_B", [["X", 20]])],
      ["DEMO_C", lineas("DEMO_C", [["X", 20]])]
    ]));
    const entradaSinPares = await baseInput({ overlap: sinPares, includeAssetSheets: false });
    expect(buildInternalReportModelWithLabels(entradaSinPares).overlapPairs).toEqual({ measured: 0, unmeasured: 3, mayor: null });
    const textoSinPares = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entradaSinPares)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(textoSinPares).not.toContain("En lo medido");
    expect(textoSinPares).toContain("3 de 3 pares quedan sin medir");
    /* Y lo que pasa de 100 no dice su número. Sin código el forward no se quita (decisión 87), y la nota lo dice así. */
    const clases = buildReportOverlap(posiciones, new Map([
      ["DEMO_A", lineas("DEMO_A", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]])],
      ["DEMO_B", lineas("DEMO_B", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]])],
      ["DEMO_C", lineas("DEMO_C", [["Otra", 100]])]
    ]));
    const entradaConClases = await baseInput({ overlap: clases, includeAssetSheets: false });
    const conClases = buildInternalReportModelWithLabels(entradaConClases);
    expect(conClases.highOverlapPairs[0].value).toBeCloseTo(330, 10);
    expect(conClases.reviewPoints.map((p) => p.text).join(" | ")).toContain("comparten más del 100\u00a0% de sus subyacentes publicados");
    const enPapel = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entradaConClases)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(enPapel).toContain("comparten más del 100 % de su cartera");
    expect(enPapel).toContain("«Más de 100 %»: lo común pasa del 100 % porque los dos fondos invierten más que su patrimonio, con efectivo en negativo o con derivados; no es una parte de la cartera.");
    expect(enPapel).not.toContain("330");
  }, 60000);

  test("decisión 18: las medidas son las de Análisis, cada una con su cifra y su umbral, y sin radar ni barras", async () => {
    const entrada = await baseInput({ includeAssetSheets: false });
    const m = buildInternalReportModelWithLabels(entrada);
    expect(m.medidas.map((f) => f.rotulo)).toEqual(["Mayor posición", "Mayor aportación al riesgo", "Diversificación", "Volatilidad 3 años", "Peso medido", "Calidad de datos", "Restricciones"]);
    const mayor = m.medidas[0];
    expect(mayor.cifra).toBe("50,0\u00a0%");
    expect(mayor.nota).toBe("crítico: pasa del 40 %");
    expect(m.medidas[2].cifra).toBe("2 clases · 3 posiciones");
    /* «Con avisos» o «Correcta» no: hechos. */
    expect(m.salud.titular).not.toMatch(/saludable|correcta|con avisos/i);
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    for (const fuera of ["Más área", "más sana", "en verde", "Control operativo", "control operativo", "Salud de la cartera", "Correcta", "Con avisos", "10 mayores"]) expect(text).not.toContain(fuera);
    expect(text).toContain("Medidas y umbrales");
    expect(text).toContain("crítico: pasa del 40 %");
    expect(text).toContain("Calidad de datos");
  }, 60000);

  describe("hallazgo 43: el Máximo Sharpe del modelo", () => {
    /* Las cifras de la muestra: a 3 años queda por debajo y a 5 no. */
    const ventana = (years: 3 | 5, actual: number, maximo: number, tope?: number) => ({
      horizon: {
        years,
        backtest: { metrics: { sharpe: actual } },
        maxSharpe: { metrics: { sharpe: maximo } },
        frontier: { methodologyV2: { weightBounds: tope === undefined ? undefined : [0, tope] } }
      }
    }) as unknown as Parameters<typeof notaDelMaximoSharpe>[0][number];

    test("escribe el tope que ha aplicado el motor, y dice que puede quedar por debajo", () => {
      const inicio = "Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas";
      expect(notaDelMaximoSharpe([ventana(5, 0.41, 0.65, 0.35)])).toBe(`${inicio}, tope del 35,0\u00a0% por posición. Medida luego con la serie real puede quedar por debajo de la cartera actual.`);
      expect(notaDelMaximoSharpe([ventana(5, 0.41, 0.65, 0.6)])).toContain("tope del 60,0\u00a0% por posición");
      expect(notaDelMaximoSharpe([ventana(5, 0.41, 0.65, 0.25)])).toContain("tope del 25,0\u00a0% por posición");
    });

    test("solo dice «aquí» en la ventana donde pasa: no generaliza", () => {
      expect(notaDelMaximoSharpe([ventana(3, 1.18, 1.09, 0.35), ventana(5, 0.41, 0.65, 0.35)])).toBe(
        "Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, tope del 35,0\u00a0% por posición. Medida luego con la serie real puede quedar por debajo de la cartera actual: aquí, a 3 años, 1,09 frente a 1,18."
      );
    });

    test("si las dos ventanas tienen tope distinto dice cada uno, y si no lo trae no se lo inventa", () => {
      expect(notaDelMaximoSharpe([ventana(3, 1, 2, 0.35), ventana(5, 1, 2, 0.6)])).toContain("tope del 35,0\u00a0% por posición a 3 años y tope del 60,0\u00a0% por posición a 5 años");
      expect(notaDelMaximoSharpe([ventana(3, 1, 2)])).toContain("tope por posición no informado");
      expect(topeDelModelo(ventana(3, 1, 2).horizon)).toBeNull();
      expect(topeDelModelo(ventana(3, 1, 2, 0.2).horizon)).toBe(0.2);
    });
  });

  describe("hallazgo 114: lo que mide cada cifra", () => {
    const horizonte = (years: 3 | 5, primero: string, dentro: string[], fuera: string[], peso: number) => ({
      years, coverageWeightPercent: peso, extensions: [],
      backtest: {
        base_currency: "EUR", asset_ids: dentro, excluded_assets: fuera.map((asset_id) => ({ asset_id, reason: "QUALITY_BLOCKED" })),
        coverage: { requested_assets: dentro.length + fuera.length, first_date: primero }
      }
    }) as unknown as Parameters<typeof loQueMide>[0][number];
    const posiciones = [{ asset_id: "A", weight_percent: 88 }, { asset_id: "V", weight_percent: 12 }];
    const fichas = [{ asset_id: "A", display_name: "Fondo A" }, { asset_id: "V", display_name: "Vanguard S&P 500" }] as unknown as BdbAssetDetail[];

    test("una ventana: de qué parte es, qué se queda fuera y con qué pesos", () => {
      expect(loQueMide([horizonte(3, "2023-10-20", ["A"], ["V"], 88)], posiciones, fichas)).toBe(
        "Simulación en euros · 1 de 2 posiciones, 88,0\u00a0% del peso · fuera: Vanguard S&P 500 (12,0\u00a0%, bloqueado por calidad del dato) · pesos fijados el 20/10/2023, sin reequilibrar"
      );
    });

    test("dos ventanas que miden lo mismo lo dicen una vez, con sus dos fechas; si no, cada una lo suyo", () => {
      expect(loQueMide([horizonte(3, "2023-10-20", ["A"], ["V"], 88), horizonte(5, "2021-10-22", ["A"], ["V"], 88)], posiciones, fichas)).toBe(
        "Simulación en euros · 1 de 2 posiciones, 88,0\u00a0% del peso · fuera: Vanguard S&P 500 (12,0\u00a0%, bloqueado por calidad del dato) · pesos fijados el 20/10/2023 a 3 años y el 22/10/2021 a 5 años, sin reequilibrar"
      );
      const distintas = loQueMide([horizonte(3, "2023-10-20", ["A", "V"], [], 100), horizonte(5, "2021-10-22", ["A"], ["V"], 88)], posiciones, fichas);
      expect(distintas).toContain("a 3 años, 2 de 2 posiciones, 100,0\u00a0% del peso; a 5 años, 1 de 2 posiciones, 88,0\u00a0% del peso · fuera: Vanguard");
    });

    test("sin simulación no hay línea que escribir", () => {
      expect(loQueMide([], posiciones, fichas)).toBeNull();
    });

    test("los avisos de la estimación por composición no van con estas cifras; los demás se quedan", () => {
      expect(avisosDeEstasCifras(["Metricas parciales (0% de la cartera).", "Mezcla de divisas sin convertir.", "La suma de pesos supera 100%."])).toEqual(["La suma de pesos supera 100%."]);
    });

    test("el PDF lleva la línea, sin «> 1 es bueno», y la divisa que queda sin convertir donde está: en la tabla de posiciones", async () => {
      const provider = assets.map((a) => (a.asset_id === "DEMO_C" ? { ...a, metrics: { ...a.metrics, metrics_method: "TRAILING_PROVIDER" as const } } : a));
      const conAvisos = { ...report, warnings: ["Metricas parciales (0% de la cartera).", "Mezcla de divisas sin convertir.", "Aviso de prueba del informe"] } as BdbPortfolioReport;
      const entrada = await baseInput({ report: conAvisos, assets: provider, includeAssetSheets: false });
      const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
      const text = pages.join(" ");
      expect(pages.filter((p) => p.includes("Simulación en euros · 3 de 3 posiciones, 100,0 % del peso")).length).toBeGreaterThanOrEqual(4);
      expect(text).not.toContain("es bueno");
      expect(text).not.toContain("se considera bueno");
      expect(text).not.toContain("Metricas parciales");
      expect(text).not.toContain("Mezcla de divisas");
      expect(text).toContain("Aviso de prueba del informe");
      expect(pages.find((p) => p.includes("Coste corriente total"))).toContain("Cifras del proveedor en otra divisa, sin convertir: Fondo Ñandú 3 (USD).");
    }, 60000);
  });

  test("calidad de datos: cuenta lo que el dato deja fuera, con su nombre, y sin simulación dice que no lo sabe", () => {
    const fuera = [{ assetId: "V", nombre: "Vanguard", pesoPct: 12, motivo: "bloqueado por calidad del dato", porCalidad: true }];
    expect(filaDeCalidadDeDatos(fuera, 88)).toMatchObject({ cifra: "12,0\u00a0% fuera", nota: "Vanguard (12,0\u00a0%): bloqueado por calidad del dato" });
    expect(filaDeCalidadDeDatos([], 100)).toMatchObject({ cifra: "0,0\u00a0% fuera", nota: "Ninguna posición se queda fuera del análisis por el dato." });
    expect(filaDeCalidadDeDatos([], null)).toMatchObject({ ausencia: "falta" });
    expect(filaDeCalidadDeDatos([], null).cifra).toBeUndefined();
  });

  test("los dos periodos traen la analítica ampliada y los puntos a revisar señalan los huecos", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    expect(m.horizons.map((h) => h.window)).toEqual(["3Y", "5Y"]);
    for (const h of m.horizons) {
      expect(h.calendarYears.length).toBeGreaterThan(2);
      expect(h.tailRisk).toHaveLength(2);
      expect(h.relative).not.toBeNull();
      expect(h.episodes.length).toBeGreaterThan(0);
    }
    const text = m.reviewPoints.map((p) => p.text).join(" | ");
    expect(text).toContain("Sin indicador de riesgo: Fondo Ñandú 3");
    expect(text).toContain("Sin coste corriente para el 20,0\u00a0% del peso: la media solo cubre el resto.");
    expect(text).toContain("Sin retrocesión registrada");
    expect(text).toContain("dos metodologías");
    expect(m.reviewPoints[0].severity).not.toBe("info");
  });

  test("exposición subyacente: el cálculo canónico rellena por clase al activo sin vector (ALTA-17)", async () => {
    const sinVector = assets.map((a) => (a.asset_id === "DEMO_C" ? { ...a, pms_exposure: undefined } : a));
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: sinVector }));
    const mix = Object.fromEntries(m.allocation.underlyingMix.map((b) => [b.key, b.weight]));
    // DEMO_C (RV, 20 %) ya no desaparece: antes la RV salía 62,5 % (0,5 / 0,8) y ahora 70 %, como en el Resumen.
    expect(mix.equity).toBeCloseTo(0.7, 10);
    expect(mix.fixed_income).toBeCloseTo(0.27, 10);
    expect(mix.cash).toBeCloseTo(0.03, 10);
    expect(m.allocation.underlyingMix.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 10);
    // La cobertura sigue siendo la del vector real.
    expect(m.allocation.underlyingMixCoverage).toBeCloseTo(0.8, 10);
    const canonical = computePmsExposureDistribution(positions.map((p) => {
      const a = sinVector.find((x) => x.asset_id === p.asset_id)!;
      return { weight_percent: p.weight_percent, pms_exposure: a.pms_exposure, economic_asset_class: a.economic_asset_class };
    }))!;
    expect(mix.equity).toBeCloseTo(canonical.percent.equity / 100, 10);
  });

  test("sectores de la RV: la parte sin sector se enseña como «No declarado» y las barras cierran el 100 % (ALTA-15)", async () => {
    const withSectors = assets.map((a) => a.asset_id === "DEMO_A"
      ? { ...a, exposure_detail: { sectors: { technology: 100 } } }
      : a.asset_id === "DEMO_C" ? { ...a, display_name: "Fondo Opaco", category: "Otros" } : a);
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: withSectors }));
    const bars = Object.fromEntries(m.allocation.equitySectors.map((b) => [b.key, b]));
    expect(bars.technology.weight).toBeCloseTo(50 / 70, 10);
    expect(bars.unclassified).toMatchObject({ label: "No declarado" });
    expect(bars.unclassified.weight).toBeCloseTo(20 / 70, 10);
    expect(m.allocation.equitySectors.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 10);
    // DEMO_A con desglose publicado; DEMO_C sin sector (no estimado): lo repartido es todo dato.
    expect(m.allocation.equitySectorsQuality).toBe("lookthrough");
  });

  test("bloque relativo: con la ventana del backtest la rentabilidad de la cartera es su CAGR (ALTA-14)", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    for (const h of m.horizons) {
      const r = h.relative!;
      expect(r.portfolioReturn).toBe(h.horizon.backtest.metrics.cagr);
      expect(r.activeReturn).toBeCloseTo(r.portfolioReturn - r.benchmarkReturn, 12);
    }
  });

  test("decisión 1: el benchmark se compara en las mismas fechas, sin arrastrar, y el modelo dice hasta cuándo", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    expect(m.benchmarkAvailable).toBe(true);
    for (const h of m.horizons) {
      const fechas = h.horizon.backtest.portfolio_series.map((p) => p.date);
      expect(h.benchmarkValues).toHaveLength(fechas.length);
      expect(h.comparison?.last).toBe(fechas.at(-1));
      expect(h.comparison?.cut).toBe(false);
    }
  });

  test("decisión 1: si el benchmark acaba antes, se compara hasta ahí, con las dos series en las mismas dos fechas", async () => {
    const corte = h3.backtest.portfolio_series.at(-30)!.date;
    const corta = { rf: referencia.rf.filter((p) => p.date <= corte), rv: referencia.rv.filter((p) => p.date <= corte) };
    const m = buildInternalReportModelWithLabels(await baseInput({ referencia: corta }));
    const h = m.horizons.find((x) => x.window === "3Y")!;
    expect(h.comparison).toMatchObject({ first: h.horizon.backtest.portfolio_series[0].date, last: corte, cut: true });
    /* No hay ningún valor del benchmark después de la última fecha común: nada sigue plano. */
    const fechas = h.horizon.backtest.portfolio_series.map((p) => p.date);
    fechas.forEach((fecha, i) => {
      if (fecha > corte) expect(h.benchmarkValues?.[i]).toBeNull();
    });
    /* El CAGR del periodo ya no vale: la cartera se mide en el tramo común. */
    expect(h.relative?.portfolioReturn).not.toBe(h.horizon.backtest.metrics.cagr);
    /* Y el último año compara las dos hasta el mismo día. */
    expect(h.calendarYears.at(-1)?.to).toBe(corte);
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).toContain(`La referencia se compara hasta el ${corte.split("-").reverse().join("/")}`);
  });

  test("sin las series del benchmark lo dice, y no hay ninguna medida relativa ni un cero creíble", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ referencia: null }));
    expect(m.benchmarkAvailable).toBe(false);
    for (const h of m.horizons) {
      expect(h.relative).toBeNull();
      expect(h.benchmarkValues).toBeNull();
      expect(h.comparison).toBeNull();
      expect(h.calendarYears.every((y) => y.benchmark === null)).toBe(true);
    }
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).toContain("Cartera de referencia no disponible");
    const blob = await createInternalPortfolioReportPdfBlob(await baseInput({ referencia: null }));
    const text = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Cartera de referencia no disponible");
  }, 60000);

  test("el PDF dice qué es el benchmark y hasta cuándo se compara, donde se compara", async () => {
    const blob = await createInternalPortfolioReportPdfBlob(await baseInput());
    const pages = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    const conLaNota = pages.filter((page) => page.replace(/\s+/g, " ").includes("Cartera de referencia Equilibrado: 50 % IE00B18GC888 + 50 % IE00B03HCZ61, con los pesos jados el primer día, sin reequilibrar."));
    /* Resumen, rentabilidad y riesgo: donde se comparan. */
    expect(conLaNota.length).toBeGreaterThanOrEqual(3);
    expect(pages.join(" ").replace(/\s+/g, " ")).toContain("La cartera parte de los pesos de hoy y tampoco se reequilibra.");
    /* Decisión 86: cómo acaba el benchmark en cada ventana, calculado aquí aparte con sus dos series: el último valor de cada fondo en
       el primer día (o antes), y el del último día común. RV al final = 0,5 × RV(fin)/RV(inicio) ÷ [0,5 × RF(fin)/RF(inicio) + 0,5 × RV(fin)/RV(inicio)]. */
    const m = buildInternalReportModelWithLabels(await baseInput());
    const valorEn = (serie: Array<{ date: string; value: number }>, fecha: string) => [...serie].filter((p) => p.date <= fecha).at(-1)!.value;
    const exacta = (window: "3Y" | "5Y") => {
      const c = m.horizons.find((x) => x.window === window)!.comparison!;
      const rf = valorEn(referencia.rf, c.last) / valorEn(referencia.rf, c.first);
      const rv = valorEn(referencia.rv, c.last) / valorEn(referencia.rv, c.first);
      return (0.5 * rv) / (0.5 * rf + 0.5 * rv);
    };
    expect(m.horizons.find((x) => x.window === "3Y")!.comparison!.rentaVariableAlFinal).toBeCloseTo(exacta("3Y"), 12);
    expect(m.horizons.find((x) => x.window === "5Y")!.comparison!.rentaVariableAlFinal).toBeCloseTo(exacta("5Y"), 12);
    const enPorcentaje = (window: "3Y" | "5Y") => Math.round(100 * exacta(window));
    expect(pages.join(" ").replace(/\s+/g, " ")).toContain(`sin reequilibrar. 50/50 el primer día; al nal, ${enPorcentaje("3Y")} % renta variable a 3 años y ${enPorcentaje("5Y")} % a 5. Cartera y referencia en las mismas fechas`);
  }, 60000);

  test("sin acceso a retrocesiones lo dice y no inventa ingresos", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ retro: { status: "denied", records: new Map() } }));
    expect(m.retro.weightedRetroPct).toBeNull();
    expect(m.retro.annualIncomeEur).toBeNull();
    expect(m.reviewPoints.some((p) => p.text.includes("no tiene acceso"))).toBe(true);
  });
});

describe("decisión 42: lo que el papel escribe en palabras", () => {
  const legible = (codigo: string) => codigo.charAt(0).toUpperCase() + codigo.slice(1).toLowerCase();

  test("de dónde salen las métricas, también en las frecuencias de la base nueva; sin frecuencia, nada", () => {
    expect(origenDeLasMetricas("PROVIDER", legible)).toBe("Cifra del proveedor");
    expect(origenDeLasMetricas("WEEKLY", legible)).toBe("Serie semanal propia");
    expect(origenDeLasMetricas("DAILY", legible)).toBe("Serie diaria propia");
    expect(origenDeLasMetricas("MONTHLY", legible)).toBe("Serie mensual propia");
    expect(origenDeLasMetricas("weekly", legible)).toBe("Serie semanal propia");
    expect(origenDeLasMetricas(null, legible)).toBeNull();
    expect(origenDeLasMetricas("QUARTERLY", legible)).toBe("Frecuencia quarterly");
  });

  test("de dónde sale el riesgo: VOL_BUCKET es una estimación, no un SRRI", () => {
    expect(origenDelRiesgo("SRI_KID", legible)).toBe("SRI del KID");
    expect(origenDelRiesgo("SRRI", legible)).toBe("SRRI");
    expect(origenDelRiesgo("VOL_BUCKET", legible)).toBe("Estimado por volatilidad");
    expect(origenDelRiesgo(null, legible)).toBeNull();
  });

  test("la versión de la referencia, con la fecha del dato; sin fecha válida no se le pone otra", () => {
    expect(versionDeLaReferencia("eur-proxy-2026-09-06.1")).toBe("Versión de la referencia 06/09/2026");
    expect(versionDeLaReferencia("eur-proxy-2027-01-31.2")).toBe("Versión de la referencia 31/01/2027");
    expect(versionDeLaReferencia("demo-synthetic.v1")).toBe("Versión de la referencia sin fecha");
    expect(versionDeLaReferencia("eur-proxy-2026-13-45.1")).toBe("Versión de la referencia sin fecha");
    expect(versionDeLaReferencia(undefined)).toBe("Versión de la referencia sin fecha");
  });

  test("un mes del dato, legible, y sin un mes válido se dice que no está", () => {
    expect(mesLegible("2026-04")).toBe("abr 2026");
    expect(mesLegible("2022-09")).toMatch(/^sept? 2022$/);
    /* 14-11-2026, plantilla única: lo que falta se dice «Falta el dato», y no «N/D». */
    expect(mesLegible(undefined)).toBe("Falta el dato");
    expect(mesLegible("abril")).toBe("Falta el dato");
  });

  test("el eje de las caídas se cierra en 0: el peor punto, con su margen de siempre, abajo", () => {
    const abajo = (caidas: number[]) => escalaDeCaidas(caidas)[0];
    expect(abajo([0, -0.05, -0.1, 0])).toBeCloseTo(-0.108, 10);
    expect(abajo([-0.2])).toBeCloseTo(-0.216, 10);
    expect(abajo([Number.NaN, -0.1])).toBeCloseTo(-0.108, 10);
    for (const caidas of [[0, -0.05, -0.1, 0], [-0.2], [0, 0, 0], []]) expect(escalaDeCaidas(caidas)[1]).toBe(0);
    /* Sin ninguna caída también hay eje, y no llega al −116 % de la escala general. */
    expect(abajo([0, 0, 0])).toBe(-0.01);
    expect(abajo([])).toBe(-0.01);
  });

  test("lo que redondea a cero no lleva signo, y lo demás no cambia", () => {
    /* 14-11-2026, plantilla única: las cifras salen del módulo común, con espacio duro antes de «%», y lo que falta es «Falta el dato» (antes, espacio normal y «N/D»). */
    const D = "\u00a0";
    expect(pct(-0.004, 0)).toBe(`0${D}%`);
    expect(pct(-0.0004, 1)).toBe(`0,0${D}%`);
    expect(pct(-0.66, 0)).toBe(`−66${D}%`);
    expect(pct(-0.006, 0)).toBe(`−1${D}%`);
    expect(pct(null, 0)).toBe("Falta el dato");
    expect(pctSigned(0.0004, 1)).toBe(`0,0${D}%`);
    expect(pctSigned(-0.0004, 1)).toBe(`0,0${D}%`);
    expect(pctSigned(0.126, 1)).toBe(`+12,6${D}%`);
    expect(pctSigned(-0.126, 1)).toBe(`−12,6${D}%`);
    expect(ratio(-0.004)).toBe("0,00");
    expect(ratio(-0.03)).toBe("−0,03");
  });

  test("un nombre se corta por una palabra, nunca a media palabra, y sin dejar colgando un guion ni un paréntesis", () => {
    expect(shorten("PIMCO GIS Global", 50)).toBe("PIMCO GIS Global");
    expect(shorten("iShares Core MSCI World UCITS ETF USD (Acc)", 40)).toBe("iShares Core MSCI World UCITS ETF USD…");
    expect(shorten("Amundi Funds - Global Equity Responsible A EUR (C)", 16)).toBe("Amundi Funds…");
    expect(shorten("JPMorgan Funds - Euro Aggregate Bond Fund C (acc) EUR", 46)).toBe("JPMorgan Funds - Euro Aggregate Bond Fund C…");
    expect(shorten("Diversified", 6)).toBe("Diver…");
  });

  test("en dos líneas: partido por una palabra, y lo que no quepa en la segunda se corta también por una palabra", () => {
    expect(enDosLineas("R-co Valor Balanced C EUR", 40)).toEqual(["R-co Valor Balanced C EUR"]);
    expect(enDosLineas("PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation", 43)).toEqual(["PIMCO GIS Global Bond Fund E Class EUR", "(Hedged) Accumulation"]);
    expect(enDosLineas("Goldman Sachs Absolute Return Tracker Portfolio Other Currency Acc EUR-Hedged", 30)).toEqual(["Goldman Sachs Absolute Return", "Tracker Portfolio Other…"]);
    expect(enDosLineas("Supercalifragilisticoespialidoso", 10)).toEqual(["Supercali…"]);
  });
});

describe("decisión 41: el Sharpe de una acción no se imprime", () => {
  const accion = (id: string, i: number) => asset(id, i, {
    display_name: `Acción ${i + 1}`, instrument_type: "STOCK", economic_asset_class: "EQUITY", category: "accion", costs: undefined,
    holdings_summary: { has_holdings: false },
    metrics: { risk_score: 5, risk_score_source: "VOL_BUCKET", sharpe_1y: 1.61, sharpe_3y: 2.01, sharpe_5y: 1.05, sharpe_10y: 0.84, annualized_return_3y: 0.33, volatility_3y: 0.15, metrics_frequency: "WEEKLY", metrics_method: "GEOMETRIC_CAGR" }
  });
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ");

  test("por posición: «No aplica» en la tabla y en el anexo, por su tipo, sin raya y sin N/D; el fondo sigue con su cifra", async () => {
    const conAccion = [assets[0], assets[1], accion("DEMO_C", 2)];
    const texto = await textoDe(await baseInput({
      assets: conAccion,
      report: { ...report, xray: { ...report.xray, by_category: [{ key: "RV Global", weight_percent: 50 }, { key: "accion", weight_percent: 20 }] } } as BdbPortfolioReport
    }));
    /* Las cuatro ventanas de la acción. Un fondo cuyo Sharpe es 0,40 lo sigue imprimiendo. */
    for (const cifra of ["1,61", "2,01", "1,05", "0,84"]) expect(texto, cifra).not.toContain(cifra);
    expect(texto).toContain("0,40");
    expect(texto).toMatch(/Sharpe[^]*No aplica/);
    /* La categoría de una acción, «Acciones» (decisión 83), en la tabla, en la composición y en el anexo. */
    expect(texto).not.toMatch(/\baccion\b/);
    expect(texto).toContain("DEMO_C · Acciones");
    /* A una acción no le aplica el indicador, aunque la base vieja le traiga un 5 estimado (decisión 83). */
    expect(texto).toContain("Indicador de riesgo: No aplica");
    expect(texto).not.toContain("Estimado por volatilidad");
    expect(texto).not.toContain("VOL_BUCK");
  }, 60000);

  describe("la cartera: la misma regla que Análisis", () => {
    const soloEstos = (h: typeof h3, ids: string[]) => ({ ...h, backtest: { ...h.backtest, asset_ids: ids, metrics: { ...h.backtest.metrics, sharpe: 7.77 } }, maxSharpe: null, frontier: null }) as unknown as typeof h3;

    test("lo medido es una sola acción: sin Sharpe ni Sortino, y dice por qué", async () => {
      const entrada = await baseInput({ assets: [accion("DEMO_A", 0), assets[1], assets[2]], horizons: { "3Y": soloEstos(h3, ["DEMO_A"]), "5Y": soloEstos(h5, ["DEMO_A"]) } });
      expect(buildInternalReportModelWithLabels(entrada).horizons.map((h) => h.sharpeNoAplica)).toEqual([true, true]);
      const texto = await textoDe(entrada);
      expect(texto).not.toContain("7,77");
      expect(texto).toMatch(/Sharpe · 3 años\s*No aplica/);
      expect(texto).toMatch(/Sortino\s*No aplica\s*No aplica/);
      expect(texto).toContain("De un componente importa lo que aporta a la cartera");
      /* La fila del Máximo Sharpe no aplica: no es un dato que falte. */
      expect(texto).toMatch(/Máximo Sharpe\s*No aplica\s*No aplica\s*No aplica\s*No aplica/);
    }, 60000);

    test("con una sola posición, las frases en singular", async () => {
      const una = [{ asset_id: "DEMO_A", weight_percent: 100 }];
      const conUna = (h: typeof h3) => ({ ...soloEstos(h, ["DEMO_A"]), backtest: { ...soloEstos(h, ["DEMO_A"]).backtest, coverage: { ...h.backtest.coverage, included_assets: 1, requested_assets: 1 } } }) as unknown as typeof h3;
      const overlap = { positions: [{ asset_id: "DEMO_A", display_name: "Acción 1", weight_percent: 100, instrument_type: "STOCK" as const, status: "not_applicable" as const, asOfDate: null }], values: [[null]] };
      const lookThrough = { rows: [{ key: "k", name: "Acción 1", identifier: "DEMO_A", weight_percent: 100, fund_count: 0, direct_weight_percent: 100, source_asset_ids: [] }], fund_positions: 0, covered_funds: 0, direct_positions: 1, seen_weight_percent: 100, fund_portfolios: [], warnings: [] };
      const texto = await textoDe(await baseInput({ assets: [accion("DEMO_A", 0)], positions: una, horizons: { "3Y": conUna(h3), "5Y": conUna(h5) }, overlap, lookThrough } as unknown as Partial<InternalReportInput>));
      expect(texto).not.toContain("1 mayores");
      expect(texto).not.toContain("1 posiciones");
      expect(texto).toContain("La única posición es una acción");
      expect(texto).toContain("La única posición subyacente");
      expect(texto).toContain("1 de 1 posición");
      /* Sin fondos no hay fondos que publiquen o no su cartera. */
      expect(texto).not.toContain("publican cartera");
    }, 60000);

    test("un solo fondo, o dos acciones, siguen con su Sharpe, como en pantalla", async () => {
      const unFondo = await baseInput({ horizons: { "3Y": soloEstos(h3, ["DEMO_A"]) } });
      expect(buildInternalReportModelWithLabels(unFondo).horizons[0].sharpeNoAplica).toBe(false);
      const dosAcciones = await baseInput({ assets: [accion("DEMO_A", 0), accion("DEMO_B", 1), assets[2]], horizons: { "3Y": soloEstos(h3, ["DEMO_A", "DEMO_B"]) } });
      expect(buildInternalReportModelWithLabels(dosAcciones).horizons[0].sharpeNoAplica).toBe(false);
      expect(await textoDe(dosAcciones)).toContain("7,77");
    }, 60000);
  });
});

describe("hallazgo 151: las hojas no dicen más que lo que se mide", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ");

  test("«5 mayores» de cinco posiciones dice 100 % y no se imprime; con seis, sí", async () => {
    const carteraDe = (n: number) => {
      const ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
      return { assets: ids.map((id, i) => asset(id, i % 2)), positions: ids.map((asset_id) => ({ asset_id, weight_percent: 100 / n })) };
    };
    const cinco = await textoDe(await baseInput(carteraDe(5)));
    expect(cinco).not.toContain("5 mayores");
    expect(cinco).not.toContain("cinco mayores");
    const seis = await textoDe(await baseInput(carteraDe(6)));
    /* Las cinco mayores de seis a partes iguales: 5/6 = 83,3 %. */
    expect(seis).toContain("5 mayores: 83,3 %");
    expect(seis).toContain("las cinco mayores, el 83,3 %");
    expect(seis).toMatch(/5 mayores\s*83,3 %/);
  }, 90000);

  test("ninguna palabra de programador, una acción incluida, y lo demás en palabras", async () => {
    const conRiesgos = [
      /* Los dos métodos de la base nueva, que es la que lee la web. */
      asset("DEMO_A", 0, { metrics: { ...assets[0].metrics, risk_score_source: "SRI_KID", metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY" } }),
      asset("DEMO_B", 1, { metrics: { ...assets[1].metrics, risk_score_source: "SRRI", metrics_frequency: "PROVIDER" }, pms_exposure: { equity: -0.0004, fixed_income: 1.66, cash: -0.66, alternative: 0, other: 0 } }),
      asset("DEMO_C", 2, { instrument_type: "STOCK", category: "accion", metrics: { risk_score: 5, risk_score_source: "VOL_BUCKET", metrics_frequency: "WEEKLY" } })
    ];
    const conVersion = (h: typeof h3) => ({ ...h, referenceVersion: "eur-proxy-2026-09-06.1" });
    const texto = await textoDe(await baseInput({ assets: conRiesgos, horizons: { "3Y": conVersion(h3), "5Y": conVersion(h5) } }));
    for (const palabra of ["backend", "backtest_portfolio", "provider", "weekly", "monthly", "Extractor", "VOL_BUCK", "SRI_KID", "eur-proxy", "RV −0", "`"]) expect(texto, palabra).not.toContain(palabra);
    expect(texto).not.toMatch(/\baccion\b/);
    /* El lector de texto pierde la ligadura «fi»: «Cifra» sí se lee entera. */
    expect(texto).toContain("Cifra del proveedor");
    expect(texto).toContain("Serie semanal propia");
    expect(texto).toContain("Serie mensual propia");
    expect(texto).toContain("SRI del KID");
    expect(texto).toContain("SRRI");
    expect(texto).toContain("Versión de la referencia 06/09/2026");
    expect(texto).toContain("Simulación histórica de la aplicación");
    expect(texto).toContain("motor de optimización de la aplicación");
    expect(texto).toContain("RV 0 %");
    expect(texto).toContain("liquidez −66 %");
    /* El método de la base nueva en la lista de la composición, con mayúscula como los demás. */
    const metodos = buildInternalReportModelWithLabels(await baseInput({ assets: conRiesgos })).allocation.byMetricsMethod.map((fila) => fila.label);
    expect(metodos).toContain("Calculada por nosotros en euros, mensual");
  }, 60000);

  test("en una frase, el nombre entero: ni «Responsi…» ni «Accumula-»", async () => {
    const largos = ids.map((id, i) => asset(id, i, { display_name: ["Amundi Funds - Global Equity Responsible A EUR (C)", "PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation", "iShares Core MSCI World UCITS ETF USD (Acc)"][i] }));
    const conMatriz = (h: typeof h3) => ({ ...h, backtest: { ...h.backtest, asset_ids: [...ids], correlation_matrix: [[1, 0.8, 0.2], [0.8, 1, 0.3], [0.2, 0.3, 1]] } }) as unknown as typeof h3;
    const texto = (await textoDe(await baseInput({ assets: largos, horizons: { "3Y": conMatriz(h3), "5Y": conMatriz(h5) } }))).replace(/\s+/g, " ");
    expect(texto).toContain("El par que más se mueve junto es Amundi Funds - Global Equity Responsible A EUR (C) y PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation (0,80)");
    expect(texto).toContain("El par que más diversi");
    expect(texto).not.toContain("Accu-");
    /* La posición más cara, en la frase de costes, tampoco se corta. */
    expect(texto).not.toMatch(/(?:Hedged|Responsible A EUR)…/);
  }, 60000);
});

describe("decisión 59: por debajo del 80 % del peso medido no hay cifra de la cartera, tampoco en el interno", () => {
  const FALTA = "Falta el dato";
  /* Una simulación que solo mide DEMO_A: la serie sigue ahí, con sus cifras, y son las que no pueden salir. */
  const queMideLoQue = (horizonte: typeof h3, peso: number) => ({
    ...horizonte,
    coverageWeightPercent: peso,
    backtest: { ...horizonte.backtest, asset_ids: ["DEMO_A"], excluded_assets: [{ asset_id: "DEMO_B", reason: "INSUFFICIENT_HISTORY" as const }, { asset_id: "DEMO_C", reason: "QUALITY_BLOCKED" as const }] }
  });
  /* La suma ponderada que antes salía en el papel: si reaparece, «8,6 %» y «Volatilidad estimada» se van a ver. */
  const conSuma = { ...report, summary: { ...report.summary, weighted_metrics: { volatility_3y: 0.086, annualized_return_3y: 0.13, metric_coverage: 0.9 } } } as unknown as BdbPortfolioReport;
  const texto = async (entrada: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  const motivoA = (m: ReturnType<typeof buildInternalReportModelWithLabels>, ventana: "3Y" | "5Y") => m.horizons.find((h) => h.window === ventana)?.motivoSinCifra ?? null;

  test.each([[79.9], [79.99], [40]])("el corte, ventana a ventana: con el %d %% falta", async (peso) => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, peso), "5Y": h5 } }));
    expect(motivoA(m, "3Y")).toContain("para dar una cifra de la cartera hace falta al menos el 80 % del peso");
    expect(motivoA(m, "5Y")).toBeNull();
  });

  test.each([[80], [79.99999999999999], [90]])("con el %d %% hay cifra", async (peso) => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, peso) } }));
    expect(motivoA(m, "3Y")).toBeNull();
    expect(m.salud.titular).not.toContain("solo se ha medido");
  });

  test("el motivo tiene las palabras y las cifras de la pantalla", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, 50) } }));
    expect(motivoA(m, "3Y")).toBe("La simulación mide el 50,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se quedan fuera: Fondo Ñandú 2 (30,0\u00a0%), Fondo Ñandú 3 (20,0\u00a0%).");
  });

  test("una ventana sin cifra deja vacío lo que sale de su serie: nada puede llegar al papel por descuido", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, 50) } }));
    const h = m.horizons[0];
    expect([h.relative, h.sortino, h.calmar, h.benchmarkValues, h.comparison]).toEqual([null, null, null, null, null]);
    expect([h.calendarYears, h.tailRisk, h.episodes, h.rolling]).toEqual([[], [], [], []]);
  });

  test("los puntos a revisar leen el mismo corte: un 80 % en coma flotante no es «alta», y un 79,99 % sí, sin escribirse como 80,0 %", async () => {
    const punto = async (peso: number) => buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, peso) } })).reviewPoints.find((r) => r.area === "Análisis 3 años" && r.text.includes("histórico común"))!;
    expect((await punto(79.99999999999999)).severity).toBe("media");
    const bajo = await punto(79.99);
    expect(bajo.severity).toBe("alta");
    expect(bajo.text).toContain("cubre el 79,99\u00a0% del peso, y por debajo del 80 % no se da ninguna cifra de la cartera");
    /* Fuera de la comparación por lo que falta, no por las fechas: esa frase sería falsa. */
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": queMideLoQue(h3, 50) } }));
    expect(m.reviewPoints.map((r) => r.text).join(" ")).not.toContain("no tienen fechas suficientes en común");
  });

  test("sin simulación no hay aprobado por la suma ponderada: el riesgo no está medido", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ report: conSuma, horizons: {}, horizonErrors: { "3Y": "fallo", "5Y": "fallo" } }));
    expect(m.health.violations.map((v) => v.rule)).toContain("RISK_NOT_MEASURED");
    expect(m.salud.titular).toBe("A revisar · la simulación ha fallado");
    expect(m.salud.filas.find((f) => f.rotulo === "Volatilidad")).toMatchObject({ ausencia: "falta" });
    expect(JSON.stringify(m.salud)).not.toMatch(/estimad|8,6/i);
  });

  test("si el servidor dice que los datos no dan, no es un fallo: no ofrece reintentar", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: {}, horizonErrors: { "3Y": "sin datos", "5Y": "sin datos" }, sinSerie: true }));
    expect(m.salud.titular).toBe("A revisar · no se ha medido ninguna posición");
    expect(JSON.stringify(m.salud)).not.toContain("reintentar");
  });

  test("en papel, las dos ventanas por debajo: ni una cifra de la cartera, y cada sección dice por qué", async () => {
    const entrada = await baseInput({ report: conSuma, horizons: { "3Y": queMideLoQue(h3, 50), "5Y": queMideLoQue(h5, 50) }, includeAssetSheets: false });
    const todo = await texto(entrada);
    expect(todo).toContain(`${FALTA} de la cartera a 3 y 5 años. La simulación mide el 50,0 % del peso`);
    expect(todo).not.toContain("Volatilidad estimada");
    expect(todo).not.toContain("8,6 %");
    /* Las cifras de la simulación del 50 % no salen en ningún sitio. */
    for (const cifra of [pct(h3.backtest.metrics.volatility), pct(h5.backtest.metrics.volatility), pctSigned(h3.backtest.metrics.cagr), pct(h3.backtest.metrics.max_drawdown)]) {
      expect(todo).not.toContain(`${cifra.replace(/\s+/g, " ")} ·`);
    }
    expect(todo).not.toContain("la cartera rinde");
    expect(todo).not.toContain("Cono estadístico del capital declarado");
    expect(todo).not.toContain("VaR 95 % semanal");
    expect(todo).not.toContain("Cartera actual");
    expect(todo).not.toContain("Episodios de caída");
    expect(todo).not.toContain("Rentabilidad por años naturales");
    expect(todo).toContain("Sin cifras de la cartera no se compara con la referencia.");
    /* Lo que no es una cifra de la cartera se queda: los escenarios de estrés, con su propia cobertura. */
    expect(todo).toContain("Escenarios de estrés históricos");
    expect(todo).toContain("Cómo leer los escenarios");
    expect(todo).not.toContain("Cómo leer el riesgo de cola");
  }, 60000);

  test("en papel, una ventana sí y otra no: sale la que tiene cifra, y la otra dice que falta", async () => {
    const todo = await texto(await baseInput({ horizons: { "3Y": h3, "5Y": queMideLoQue(h5, 50) }, includeAssetSheets: false }));
    expect(todo).toContain(`${FALTA} de la cartera a 5 años.`);
    expect(todo).toContain("Rentabilidad · 3 años");
    expect(todo).toContain("Riesgo · 3 años");
    expect(todo).toContain("Cono estadístico del capital declarado a 3 años");
    expect(todo).not.toContain("Cono estadístico del capital declarado a 5 años");
    expect(todo).toContain("Cartera 3 años");
    expect(todo).not.toContain("Cartera 5 años");
    /* En la tabla del resumen, la columna de 5 años dice que falta y la de 3 sigue con su cifra. */
    expect(todo).toContain(`Volatilidad ${pct(h3.backtest.metrics.volatility).replace(/\s+/g, " ")} ${FALTA}`);
  }, 60000);

  test("en papel, con la de 3 años sin cifra el titular del resumen lo dice, y la de 5 sigue en su columna", async () => {
    const todo = await texto(await baseInput({ horizons: { "3Y": queMideLoQue(h3, 50), "5Y": h5 }, includeAssetSheets: false }));
    expect(todo).toContain("Rentabilidad anualizada · 3 años Falta el dato");
    expect(todo).toContain(`Volatilidad ${FALTA} ${pct(h5.backtest.metrics.volatility).replace(/\s+/g, " ")}`);
    expect(todo).toContain("Rentabilidad · 5 años");
    expect(todo).not.toContain("Cartera 3 años");
  }, 60000);

  /* La muestra de la base de demostración no trae frontera: la que se dibuja es una de resultado conocido. */
  const puntoDeFrontera = (volatility: number, expectedReturn: number) => ({ volatility, expectedReturn, sharpeRatio: 1, volatilityLabel: "", expectedReturnLabel: "", sharpeLabel: "", weights: [{ assetId: "DEMO_A", weight: 0.6 }, { assetId: "DEMO_B", weight: 0.4 }] });
  const frontera = {
    kind: "historical", label: "Frontera eficiente · 3 años", window: "3Y", asOfDate: "2026-08-28", riskFreeRateLabel: "2,00 %", riskFreeSource: "ECB_ESTR", riskFreeRatePolicy: "WINDOW_AVERAGE",
    coverage: { requested: 3, included: 2, commonObservations: 158, firstDate: "2023-08-25", lastDate: "2026-08-28" },
    insufficientCoverage: false, current: puntoDeFrontera(.071, .064), minVolatility: puntoDeFrontera(.041, .038), maxSharpe: puntoDeFrontera(.082, .078),
    frontier: Array.from({ length: 12 }, (_, i) => puntoDeFrontera(.041 + i * .007, .038 + i * .0052)), excluded: [], warnings: []
  } as unknown as NonNullable<typeof h3["frontier"]>;

  test("la frontera, por debajo del 80 %: la curva y sus dos carteras, sin la actual ni lo que se le compara", async () => {
    const mide = { ...queMideLoQue(h3, 50), frontier: frontera };
    const todo = await texto(await baseInput({ horizons: { "3Y": mide }, includeAssetSheets: false }));
    expect(todo).toContain("Máximo Sharpe ·");
    expect(todo).toContain("Mínima volatilidad ·");
    expect(todo).not.toContain("En el modelo de la frontera la cartera actual da");
    expect(todo).not.toContain("El mayor cambio de peso hacia la cartera de máximo Sharpe");
    expect(todo).toContain("A 3 años la cartera no se sitúa en la frontera, que es solo de los activos medidos.");
    expect(todo).not.toMatch(/\bActual\b/);
  }, 60000);

  test("la muestra con el 80 %: las hojas no cambian de forma", async () => {
    const todo = await texto(await baseInput({ horizons: { "3Y": { ...queMideLoQue(h3, 80), frontier: frontera }, "5Y": queMideLoQue(h5, 80) }, includeAssetSheets: false }));
    expect(todo).not.toContain(FALTA + " de la cartera");
    expect(todo).toContain("la cartera rinde");
    /* INF-19, segunda parte (14-11-2026): con el 80 % medido, el cono en euros es del capital medido, y lo dice. Antes, «del capital declarado». */
    expect(todo).toContain("Cono estadístico del capital medido a 3 años");
    expect(todo).toContain("Cartera actual ·");
    expect(todo).toContain("En el modelo de la frontera la cartera actual da");
  }, 60000);
});

describe("PDF del informe interno", () => {
  /** Diez posiciones con todas las secciones llenas: sale más largo, y sus secciones caen en otras hojas. */
  async function entradaRica(overrides: Partial<InternalReportInput> = {}) {
    const richIds = Array.from({ length: 10 }, (_, i) => `RICH_${String.fromCharCode(65 + i)}`);
    const richPositions = richIds.map((id, i) => ({ asset_id: id, weight_percent: [22, 15, 12, 10, 9, 8, 8, 6, 5, 5][i] }));
    const richAssets = richIds.map((id, i) => asset(id, i % 3, { display_name: `Fondo internacional de prueba número ${i + 1} clase A acumulación` }));
    const r3 = await fetchPortfolioHorizon(richPositions, "3Y");
    const r5 = await fetchPortfolioHorizon(richPositions, "5Y");
    const point = (ret: number, vol: number, weights: Record<string, number>) => ({
      expectedReturn: ret, volatility: vol, sharpeRatio: (ret - 0.02) / vol, expectedReturnLabel: "", volatilityLabel: "", sharpeLabel: "",
      weights: Object.entries(weights).map(([assetId, weight]) => ({ assetId, weight, weightLabel: "" }))
    });
    const even = Object.fromEntries(richIds.map((id) => [id, 0.1]));
    const frontier = {
      kind: "historical", label: "Frontera eficiente · 3 años", asOfDate: "2026-10-09", window: "3Y",
      frontier: Array.from({ length: 12 }, (_, i) => ({ volatility: 0.03 + i * 0.008, expectedReturn: 0.025 + Math.sqrt(i) * 0.012, sharpeRatio: 1 })),
      current: point(0.05, 0.07, Object.fromEntries(richPositions.map((p) => [p.asset_id, p.weight_percent / 100]))),
      minVolatility: point(0.026, 0.03, even), maxSharpe: point(0.055, 0.06, even), excluded: [],
      riskContributions: richPositions.map((p, i) => ({ asset_id: p.asset_id, weight_pct: p.weight_percent, risk_pct: i === 0 ? 34 : (66 * p.weight_percent) / 78 }))
    } as unknown as NonNullable<typeof r3.frontier>;
    const stress = [
      { id: "COVID", label: "Covid-19 (2020)", drawdown_pct: -14.2, start_date: "2020-02-19", trough_date: "2020-03-23", recovery_status: "RECOVERED", recovery_days: 160, remaining_to_recover_pct: null, coverage: { weight_pct: 92, included_assets: 9, total_assets: 10 }, representative: true, reason: null },
      { id: "RATES_2022", label: "Subida de tipos (2022)", drawdown_pct: -11.8, start_date: "2022-01-04", trough_date: "2022-10-12", recovery_status: "NOT_RECOVERED", recovery_days: null, remaining_to_recover_pct: 2.1, coverage: { weight_pct: 55, included_assets: 6, total_assets: 10 }, representative: false, reason: null }
    ] as unknown as typeof r3.backtest.stress_scenarios;
    const enrich = (h: typeof r3) => ({ ...h, frontier, backtest: { ...h.backtest, stress_scenarios: stress } });
    const lookThrough = { rows: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, name: `Empresa subyacente ${i + 1} SA`, identifier: `US00000000${i}`, weight_percent: 3 - i * 0.08, fund_count: 1 + (i % 4), source_asset_ids: [] })),
      fund_positions: 10, covered_funds: 7, direct_positions: 0, seen_weight_percent: 78, fund_portfolios: [], warnings: [] };
    const top = richPositions.slice(0, 8).map((p, i) => ({ asset_id: p.asset_id, display_name: richAssets[i].display_name, weight_percent: p.weight_percent, instrument_type: "FUND" as const, status: "available" as const, asOfDate: "2026-08-31" }));
    const overlap = { positions: top, values: top.map((_, i) => top.map((__, j) => (i === j ? 100 : i < 3 && j < 3 ? 62 : 12 + ((i + j) % 5) * 6))) };
    const richReport = { ...report, portfolio_name: "Cartera rica de prueba", positions: richPositions.map((p, i) => ({ ...report.positions[i % 3], ...p, display_name: richAssets[i].display_name })) } as BdbPortfolioReport;
    return baseInput({
      report: richReport, assets: richAssets, positions: richPositions, horizons: { "3Y": enrich(r3), "5Y": enrich(r5) },
      lookThrough, overlap, retro: { status: "ok", records: new Map(richIds.map((id, i) => [id, { isin: id, retro_pct: 0.4 + i / 10, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord])) },
      feasibility: { status: "WARNING", blocking_issues: [], warnings: [{ message: "Una posición supera su máximo." }], infos: [] } as unknown as InternalReportInput["feasibility"],
      ...overrides
    });
  }

  test("genera todas las secciones con acentos, paginación y marca de uso interno", async () => {
    const blob = await createInternalPortfolioReportPdfBlob(await baseInput());
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (process.env.INTERNAL_REPORT_QA_PATH) await writeFile(process.env.INTERNAL_REPORT_QA_PATH, bytes);
    const pages = extractPdfPageTexts(bytes);
    const text = pages.join(" ");
    expect(pages.length).toBeGreaterThan(10);
    // Portada con índice y guía de lectura, y una numeración única de secciones (rediseño 14-10).
    for (const heading of ["Informe interno del asesor", "Contenido", "Cómo leer este documento", "Resumen ejecutivo", "Cifras clave a 3 y 5 años",
      "Posiciones", "Composición", "Distribución geográ", "Posiciones subyacentes", "Solapamiento entre fondos",
      "Rentabilidad · 3 y 5 años", "Riesgo · medidas y umbrales", "Riesgo · 3 y 5 años",
      "Correlaciones entre posiciones", "Frontera e", "Propuesta de mejora de fondos", "Costes y comercial", "Calidad y trazabilidad",
      "Metodología y glosario", "Glosario", "Anexo · ", "Lectura rápida"]) {
      // El lector de texto pierde la ligadura «fi» («geográca», «eciente»): se buscan trozos sin ella.
      expect(text).toContain(heading);
    }
    // Sin campos de cliente ni de autor: el documento no los pide ni los imprime.
    expect(text).not.toContain("Elaborado por");
    expect(text).not.toContain("Cliente:");
    expect(text).toContain("Fondo Ñandú 1");
    expect(text).toContain("Cartera Ávila interna");
    expect(text).toContain("uso interno del asesor");
    /* Decisión 23, revisada el 14-11-2026 con la plantilla única: ninguna marca de entidad; el sello del tema interno y «No entregar al cliente» en cada hoja. */
    expect(text).not.toContain("Independent Private Bankers");
    for (const page of pages) {
      expect(page).toContain("USO INTERNO");
      expect(page).toContain("No entregar al cliente");
    }
    expect(text).not.toMatch(/BDB|BBDD/);
    expect(text).not.toContain("Fundamental Intelligence");
    expect(text).toContain("Tracking error");
    expect(text).toContain("VaR 95 % semanal");
    expect(text).toContain("Retrocesión");
    pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
  }, 60000);

  test("cartera de diez posiciones con todas las secciones llenas: medidas, correlaciones, frontera, estrés y subyacentes", async () => {
    const blob = await createInternalPortfolioReportPdfBlob(await entradaRica());
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (process.env.INTERNAL_REPORT_QA_RICH_PATH) await writeFile(process.env.INTERNAL_REPORT_QA_RICH_PATH, bytes);
    const pages = extractPdfPageTexts(bytes);
    const text = pages.join(" ");
    for (const piece of ["Medidas y umbrales", "Mayor posición", "Diversicación", "Restricciones", "Revisar", "Contribución al riesgo frente al peso",
      "Matriz de correlación", "Pares que más se mueven juntos", "Pares que más diversican", "Covid-19 (2020)", "Subida de tipos (2022)",
      "Empresa subyacente 1 SA", "Pares con solapamiento alto", "Máx. Sharpe", "Mín. vol."]) {
      expect(text).toContain(piece);
    }
    pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
    /* Una tabla en una hoja, con su nota, sin partirla en bloques iguales. */
    /* «Clase · tipo» desde el 14-11-2026: «vehículo» deja de decirse (vocabulario del sistema de diseño). */
    const conLaTabla = pages.filter((page) => page.includes("Clase · tipo"));
    expect(conLaTabla).toHaveLength(1);
    expect(conLaTabla[0]).toContain("Coste corriente total");
    expect(pages.filter((page) => page.includes("Vigencia retro."))).toHaveLength(1);
  }, 90000);

  test("decisión 9: la tabla de subyacentes dice que son pesos brutos, y no suma las patas", async () => {
    const lookThrough = {
      rows: [
        { key: "a", name: "EUROPEAN MONETARY UNION EURO Purchased", identifier: null, weight_percent: 6.23, fund_count: 1, source_asset_ids: [] },
        { key: "b", name: "NVIDIA Corp.", identifier: "US67066G1040", weight_percent: 2.57, fund_count: 3, source_asset_ids: [] }
      ],
      fund_positions: 3, covered_funds: 3, direct_positions: 0, seen_weight_percent: 74.9, fund_portfolios: [], warnings: []
    } as unknown as InternalReportInput["lookThrough"];
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ lookThrough, includeAssetSheets: false }))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Pesos brutos, incluye derivados");
    expect(text).toContain("Además, derivados y divisa de los fondos: no se suman porque son importes nominales, no inversión directa.");
    expect(text).not.toMatch(/mayores suman el/);
    expect(text).not.toContain("hay de verdad detrás");
    expect(text).toContain("EUROPEAN MONETARY UNION EURO Purchased");
  }, 60000);

  test("decisión 3: un cono estadístico con percentiles 5, 50 y 95 y su supuesto, sin Monte Carlo ni escenarios", async () => {
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ includeAssetSheets: false }))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
    for (const fuera of ["Monte Carlo", "Proyección", "adverso", "favorable", "central", "Mediana", "P25"]) expect(text).not.toContain(fuera);
    for (const dentro of ["Cono estadístico", "Percentil 5:", "Percentil 50:", "Percentil 95:", "Solo enseña la dispersión medida en el periodo; no es una simulación ni una previsión."]) expect(text).toContain(dentro);
  }, 60000);

  test("sin nombre de cartera dice «Cartera sin nombre», y el metadato lleva el sello", async () => {
    const sinNombre = { ...report, portfolio_name: "" } as BdbPortfolioReport;
    const bytes = Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ report: sinNombre, includeAssetSheets: false }))).arrayBuffer());
    expect(extractPdfPageTexts(bytes).join(" ")).toContain("Cartera sin nombre");
    expect(bytes.toString("latin1")).not.toContain("BDB-ACTIVOS");
  }, 60000);

  describe("decisión 33: 3 y 5 años fundidos", () => {
    test("lo que no depende de la ventana sale una vez, y lo que depende, con una columna o un gráfico por ventana", async () => {
      const pages = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ includeAssetSheets: false }))).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
      const text = pages.join(" ");
      const veces = (frase: string) => text.split(frase).length - 1;
      expect(veces("Cómo leer el riesgo de cola")).toBe(1);
      expect(veces("Escenarios de estrés históricos")).toBe(1);
      expect(veces("Solo enseña la dispersión medida en el periodo")).toBe(1);
      expect(veces("Cada punto es el resultado de las 52 semanas")).toBe(1);
      for (const dentro of ["del capital declarado a 3 años", "del capital declarado a 5 años", "Cartera 3 años", "Cartera 5 años", "Referencia 3 años", "Referencia 5 años", "Diferencia 3 años", "Diferencia 5 años", "Rent. 3 años", "Rent. 5 años",
        "Episodios de caída más profundos · 3 años", "Episodios de caída más profundos · 5 años"]) {
        expect(text).toContain(dentro);
      }
      /* El lector de texto pierde la ligadura «fi»: «fija» sale «ja» y «difiere», «diere». */
      /* Decisión 39: lo que dice la nota de la cartera vale también para el benchmark, y lo dice. */
      expect(text).toContain("Cartera y referencia jan sus pesos en el primer día de cada ventana, y por eso el mismo año");
      /* El Sharpe se define una vez, en el glosario. */
      expect(veces("Rentabilidad por encima del tipo sin riesgo")).toBe(1);
      expect(text).not.toContain("Cómo leerla");
      /* La columna de la tabla de riesgo; la frase de la metodología sí sigue. */
      for (const hoja of pages.filter((page) => page.includes("VaR 95 % semanal"))) expect(hoja).not.toContain("Cómo se calcula");
    }, 60000);

    test("sin capital: sin columnas en euros, y dicho una vez", async () => {
      const entrada = await baseInput({ totalCapital: undefined, includeAssetSheets: false });
      const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
      for (const fuera of ["Importe", "€/año", "Coste anual estimado", "Ingreso anual estimado", "Coste anual ="]) expect(text).not.toContain(fuera);
      expect(text.split("Sin capital declarado").length - 1).toBe(1);
      expect(text).toContain("Sin capital declarado, ninguna cifra va en euros.");
      /* Y con capital siguen. */
      const conCapital = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ includeAssetSheets: false }))).arrayBuffer())).join(" ");
      for (const dentro of ["Importe", "€/año", "Coste anual estimado", "Ingreso anual estimado"]) expect(conCapital).toContain(dentro);
      expect(conCapital).not.toContain("Sin capital declarado");
    }, 60000);

    test("cada posición lleva el mismo número en todas las tablas, también en las matrices", async () => {
      const m = buildInternalReportModelWithLabels(await baseInput());
      /* DEMO_A 50, DEMO_B 30, DEMO_C 20: la matriz llega en otro orden y se reordena fila y columna. */
      const matriz = enOrdenDePosicion(m, ["DEMO_C", "DEMO_A", "DEMO_B"], [[1, 0.2, 0.3], [0.2, 1, 0.5], [0.3, 0.5, 1]]);
      expect(matriz.ids).toEqual(["DEMO_A", "DEMO_B", "DEMO_C"]);
      expect(matriz.numeros).toEqual([1, 2, 3]);
      expect(matriz.values).toEqual([[1, 0.5, 0.2], [0.5, 1, 0.3], [0.2, 0.3, 1]]);
      expect(matriz.indices).toEqual([1, 2, 0]);
      /* Los pares de solapamiento alto, también. */
      const conPares = await baseInput({
        overlap: { positions: positions.map((p, i) => ({ asset_id: p.asset_id, display_name: assets[i].display_name, weight_percent: p.weight_percent, instrument_type: "FUND" as const, status: "available" as const, asOfDate: "2026-08-31" })), values: [[100, 62, 1], [62, 100, 1], [1, 1, 100]] },
        includeAssetSheets: false
      });
      const conParesEnPapel = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(conPares)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
      expect(conParesEnPapel).toContain("1 Fondo Ñandú 1 2 Fondo Ñandú 2 al menos 62,0 %");
      /* Una que no entra en la matriz deja hueco en la numeración: el número es el de la posición. */
      expect(enOrdenDePosicion(m, ["DEMO_C", "DEMO_A"], [[1, 0.2], [0.2, 1]]).numeros).toEqual([1, 3]);
      const anexo = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput())).arrayBuffer())).join(" ");
      expect(anexo).toContain("1 · Fondo Ñandú 1");
      expect(anexo).toContain("3 · Fondo Ñandú 3");
    }, 60000);

    test("años naturales: una fila por año, con lo de cada ventana, y el que más difiere sale del dato", () => {
      const anio = (year: number, portfolio: number, partial = false) => ({ year, portfolio, benchmark: portfolio - 0.01, partial, from: `${year}-01-01`, to: `${year}-12-31` });
      const filas = filasDeAniosNaturales([
        { window: "3Y", calendarYears: [anio(2023, 0.074, true), anio(2024, 0.136), anio(2025, 0.074), anio(2026, 0.071, true)] },
        { window: "5Y", calendarYears: [anio(2021, 0.024, true), anio(2022, -0.136), anio(2023, 0.113), anio(2024, 0.143), anio(2025, 0.076), anio(2026, 0.077, true)] }
      ]);
      expect(filas.map((f) => f.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
      expect(filas[0].porVentana["3Y"]).toBeUndefined();
      expect(filas[0].porVentana["5Y"]?.portfolio).toBe(0.024);
      /* 2023 y 2026 están incompletos en alguna ventana: no valen de ejemplo. 2024 difiere 0,7 puntos y 2025, 0,2. */
      expect(anioQueMasDifiere(filas)).toEqual({ year: 2024, a3: 0.136, a5: 0.143, benchmark: { a3: 0.136 - 0.01, a5: 0.143 - 0.01 } });
      /* Sin benchmark en una de las dos, no se da el suyo. */
      expect(anioQueMasDifiere(filasDeAniosNaturales([{ window: "3Y", calendarYears: [{ ...anio(2024, 0.136), benchmark: null }] }, { window: "5Y", calendarYears: [anio(2024, 0.143)] }]))).toEqual({ year: 2024, a3: 0.136, a5: 0.143, benchmark: null });
      /* Lo que no llega a verse a un decimal no es un ejemplo. */
      expect(anioQueMasDifiere(filasDeAniosNaturales([{ window: "3Y", calendarYears: [anio(2024, 0.1361)] }, { window: "5Y", calendarYears: [anio(2024, 0.1363)] }]))).toBeNull();
      expect(anioQueMasDifiere([])).toBeNull();
    });

    test("con una sola ventana también sale, sin columnas de la otra", async () => {
      const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ horizons: { "3Y": h3 }, horizonErrors: { "5Y": "sin histórico común" }, includeAssetSheets: false }))).arrayBuffer())).join(" ").replace(/\s+/g, " ");
      expect(text).toContain("Rentabilidad · 3 años");
      expect(text).toContain("Riesgo · 3 años");
      expect(text).toContain("Cartera 3 años");
      expect(text).not.toContain("Cartera 5 años");
      expect(text).not.toContain("Cada ventana fija sus pesos");
      expect(text).toContain("sin histórico común");
    }, 60000);
  });

  describe("hallazgo 116: el índice lleva el número de hoja, con enlaces y marcadores", () => {
    const ENTRADAS: Array<[string, string]> = [["1", "Resumen ejecutivo"], ["2", "Posiciones"], ["3", "Composición"], ["4", "Subyacentes y solapamiento"], ["5", "Rentabilidad"], ["6", "Riesgo"],
      ["7", "Correlaciones"], ["8", "Optimización y mejora"], ["9", "Costes y comercial"], ["10", "Calidad y trazabilidad"], ["11", "Metodología y glosario"], ["A", "Anexo · chas"]];

    /** Lo que se puede leer en el PDF: el índice, la franja de arriba de cada hoja, los enlaces y los marcadores. */
    async function leerElPdf(entrada: InternalReportInput) {
      const bytes = Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer());
      const raw = bytes.toString("latin1");
      const hojas = extractPdfPageTexts(bytes).map((page) => page.replace(/\s+/g, " "));
      /* Desde el 14-11-2026 (plantilla única) la franja de cada hoja es el rótulo fijo «Sección N · …» bajo la cabecera. */
      const franjas = hojas.map((page) => /Sección (\S+) · /.exec(page)?.[1] ?? null);
      /* La primera hoja cuya franja nombra la sección. Ninguna se ha calculado: es lo que está impreso arriba de cada hoja. */
      const dondeEmpieza = new Map<string, number>();
      franjas.forEach((franja, i) => {
        const seccion = franja?.split(".")[0];
        if (seccion && !dondeEmpieza.has(seccion)) dondeEmpieza.set(seccion, i + 1);
      });
      const indice = new Map<string, number>();
      for (const [n, titulo] of ENTRADAS) {
        const numero = new RegExp(`${titulo} Página (\\d+)`).exec(hojas[0])?.[1];
        if (numero) indice.set(n, Number(numero));
      }
      const paginas = /\/Type \/Pages\s+\/Count \d+\s+\/Kids \[([^\]]*)\]/.exec(raw)![1].match(/\d+ 0 R/g)!;
      const destinos = new Map([...raw.matchAll(/\(seccion-([^)]+)\) \[(\d+ 0 R) \/XYZ/g)].map(([, n, pagina]) => [n, paginas.indexOf(pagina) + 1]));
      const enlaces = [...raw.matchAll(/\/D \(seccion-([^)]+)\)/g)].map(([, n]) => n);
      const marcadores = [...raw.matchAll(/\/Dest \[(\d+ 0 R) \/Fit\]\s+\/Parent \d+ 0 R\s+\/Title \(([^)]*)\)/g)].map(([, pagina, titulo]) => ({
        titulo: titulo.startsWith("\xFE\xFF") ? Buffer.from(titulo.slice(2), "latin1").swap16().toString("utf16le") : titulo,
        pagina: paginas.indexOf(pagina) + 1
      }));
      return { hojas, franjas, dondeEmpieza, indice, destinos, enlaces, marcadores, abreConMarcadores: raw.includes("/PageMode /UseOutlines") };
    }

    test("cada entrada dice la página donde empieza su sección, y su enlace y su marcador llevan allí, aunque las hojas cambien", async () => {
      const corta = await leerElPdf(await baseInput());
      const larga = await leerElPdf(await entradaRica());
      const sinAnexo = await leerElPdf(await baseInput({ includeAssetSheets: false }));
      for (const pdf of [corta, larga, sinAnexo]) {
        expect([...pdf.indice.entries()]).toEqual([...pdf.dondeEmpieza.entries()]);
        expect(pdf.indice.size).toBe(pdf === sinAnexo ? 11 : 12);
        for (const n of pdf.enlaces) expect(pdf.destinos.get(n)).toBe(pdf.indice.get(n));
        expect(new Set(pdf.enlaces)).toEqual(new Set(pdf.indice.keys()));
        expect(pdf.abreConMarcadores).toBe(true);
        /* Un marcador por sección y subsección, en el orden del documento: cada uno a la hoja cuya franja dice lo mismo, y a la primera de ellas. */
        expect(pdf.marcadores[0]).toEqual({ titulo: "Presentación y contenido", pagina: 1 });
        for (const { titulo, pagina } of pdf.marcadores.slice(1)) {
          expect(pdf.hojas[pagina - 1]).toContain(`Sección ${titulo.split(" · ")[0]} ·`);
          expect(pdf.franjas[pagina - 2]).not.toBe(titulo.split(" · ")[0]);
        }
        expect(pdf.marcadores.map((m) => m.pagina)).toEqual([...pdf.marcadores.map((m) => m.pagina)].sort((a, b) => a - b));
      }
      /* Si la larga y la corta dijeran lo mismo, esta prueba no probaría nada. */
      expect(larga.indice.get("7")).toBeGreaterThan(corta.indice.get("7")!);
      expect(larga.hojas.length).toBeGreaterThan(corta.hojas.length);
      /* Las subsecciones sin entrada propia también tienen su marcador. */
      expect(larga.marcadores.map((m) => m.titulo)).toEqual(expect.arrayContaining(["4.1 · Posiciones subyacentes", "4.2 · Solapamiento", "6.1 · Riesgo · medidas y umbrales", "6.2 · Riesgo · 3 y 5 años"]));
      /* Con pocas líneas, la sección 4 va en una sola hoja. */
      expect(corta.marcadores.map((m) => m.titulo)).toContain("4 · Subyacentes y solapamiento");
    }, 120000);
  });

  test("sin análisis del periodo ni anexo: el documento sale y explica la causa", async () => {
    const blob = await createInternalPortfolioReportPdfBlob(await baseInput({
      horizons: {}, horizonErrors: { "3Y": "sin histórico común", "5Y": "sin histórico común" }, includeAssetSheets: false
    }));
    const text = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ");
    /* «Falta el dato», como la pantalla (decisión 59), y la causa de cada periodo, la que da el servidor. */
    expect(text).toContain("Falta el dato. Es un fallo al calcularla");
    expect(text).toContain("La causa de cada periodo está en la sección 10.");
    expect(text).toContain("no disponible (sin histórico común)");
    expect(text).not.toContain("Anexo · ");
  }, 60000);

  test("geografía: el papel lee la misma tabla que la pantalla, y dice lo que no separa (decisión 7)", async () => {
    /* Una acción con «Iberia» se caía del mapa del papel sin decirlo, y «other» se quedaba sin pintar. */
    const conRegiones = assets.map((a) => ({
      ...a,
      exposure_detail: { equity_regions: a.asset_id === "DEMO_A" ? { Iberia: 0.6, united_states: 0.4, other: 0.1, asia: 0.2, asia_emerging: 0.2 } : { united_states: 1 } }
    }) as unknown as BdbAssetDetail);
    const regiones = computeEquityRegionAllocation(positions, conRegiones);
    const input = await baseInput({
      assets: conRegiones, regionRows: regiones.rows,
      horizons: {}, horizonErrors: { "3Y": "sin histórico común", "5Y": "sin histórico común" }, includeAssetSheets: false
    });
    const modelo = buildInternalReportModelWithLabels(input);
    expect(modelo.allocation.canadaYAfricaSinSeparar).toBe(true);
    expect(modelo.allocation.equityRegions.map((r) => r.key)).not.toContain("other");
    expect(modelo.allocation.equityRegions.map((r) => r.key)).not.toContain("asia_emerging");
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ");
    expect(text).toContain("Canadá y África aún no se separan");
    expect(text).toContain("Zona Euro");
    expect(text).toContain("Asia, sin desglose");
    expect(text).not.toContain("Asia - Emergente");
  }, 60000);

  test("sectores: lo que no se declara no se pierde dentro de «Otros» aunque haya muchos (decisión 11)", async () => {
    const onceSectores = Object.fromEntries(["technology", "financial_services", "healthcare", "industrials", "consumer_cyclical", "consumer_defensive", "energy", "utilities", "basic_materials", "real_estate", "communication_services"].map((clave, i) => [clave, 11 - i]));
    const conSectores = assets.map((a) => a.asset_id === "DEMO_A" ? { ...a, exposure_detail: { sectors: onceSectores } } as unknown as BdbAssetDetail : a);
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({
      assets: conSectores, horizons: {}, horizonErrors: { "3Y": "sin histórico común", "5Y": "sin histórico común" }, includeAssetSheets: false
    }))).arrayBuffer())).join(" ");
    expect(text).toContain("No declarado");
    expect(text).toContain("Inmobiliario");
  }, 60000);

  test("geografía: lo no declarado sale del núcleo, como en pantalla, y no de «100 − suma» (rondas 2 y 3, 14-10)", async () => {
    // DEMO_A publica sus regiones; DEMO_C (20 % de la cartera, RV), no: 20 / 70 de la RV sin declarar.
    const opaque = assets.map((a) => (a.asset_id === "DEMO_A" ? { ...a, exposure_detail: { equity_regions: { united_states: 0.7, eurozone: 0.3 } } } as unknown as BdbAssetDetail : a));
    const regions = computeEquityRegionAllocation(positions, opaque);
    expect(regions.unclassified_weight_percent).toBeCloseTo((20 / 70) * 100, 6);
    const input = await baseInput({
      assets: opaque, regionRows: regions.rows,
      horizons: {}, horizonErrors: { "3Y": "sin histórico común", "5Y": "sin histórico común" }, includeAssetSheets: false
    });
    expect(buildInternalReportModelWithLabels(input).allocation.equityRegionsUnclassified).toBe(regions.unclassified_weight_percent);
    const text = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ");
    /* La misma palabra que los sectores de esa hoja y que la pantalla (decisión 66). */
    expect(text).toMatch(/No declarado\s*28,6 %/);
    /* El lector de texto pierde la ligadura «fi» («clasicar»): se busca sin ella. */
    expect(text).not.toMatch(/[Ss]in cla\S*car/);
    // El mapa y su leyenda por macro-zona salen en el PDF (bloque «Distribución geográfica»).
    expect(text).toMatch(/América\s+\d+,\d %/);
    expect(text).not.toContain("Sin reparto geográ");
  }, 60000);
});

describe("decisión 79: el SRI de un KID y el SRRI de un KIID son dos indicadores", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  /* A 50 % con SRI 2, B 30 % con SRRI 6 y C 20 % con SRI 6. El mismo número, con otro origen. */
  const conOrigen = [
    asset("DEMO_A", 0, { metrics: { ...assets[0].metrics, risk_score: 2, risk_score_source: "SRI_KID" } }),
    asset("DEMO_B", 1, { metrics: { ...assets[1].metrics, risk_score: 6, risk_score_source: "SRRI" } }),
    asset("DEMO_C", 2, { metrics: { ...assets[2].metrics, risk_score: 6, risk_score_source: "SRI_KID" } })
  ];

  test("cada origen en su barra, y la suma no cambia: 50 + 20 + 30, a mano", async () => {
    const { bySri } = buildInternalReportModelWithLabels(await baseInput({ assets: conOrigen })).allocation;
    expect(bySri.map((barra) => [barra.label, Number(barra.weight.toFixed(10))])).toEqual([["SRI del KID 2", 0.5], ["SRI del KID 6", 0.2], ["SRRI 6", 0.3]]);
    expect(bySri.reduce((suma, barra) => suma + barra.weight, 0)).toBeCloseTo(1, 12);
  });

  test("la barra de cada caso: sin indicador falta, y a una acción no le aplica", () => {
    expect(barraDelIndicador({ instrumentType: "FUND", sri: 3, sriSource: "SRI_KID" }).label).toBe("SRI del KID 3");
    expect(barraDelIndicador({ instrumentType: "ETF", sri: 6, sriSource: "SRRI" }).label).toBe("SRRI 6");
    expect(barraDelIndicador({ instrumentType: "FUND", sri: 4, sriSource: "VOL_BUCKET" }).label).toBe("Estimado por volatilidad 4");
    expect(barraDelIndicador({ instrumentType: "FUND", sri: null, sriSource: null }).label).toBe("Sin indicador");
    expect(barraDelIndicador({ instrumentType: "STOCK", sri: null, sriSource: null }).label).toBe("No aplica");
  });

  test("el papel: «Indicador de riesgo», «6 SRRI» en la tabla y las dos escalas en el glosario", async () => {
    const texto = await textoDe(await baseInput({ assets: conOrigen }));
    expect(texto).toContain("Indicador de riesgo SRI del KID 2");
    expect(texto).toContain("SRRI 6");
    expect(texto).toContain("6 SRRI");
    expect(texto).not.toContain("Indicador de riesgo (SRI)");
    expect(texto).not.toMatch(/\bSRI \d/);
    expect(texto).toContain("Indicador del KID de PRIIPs, de 1 a 7.");
    expect(texto).toContain("Indicador del antiguo KIID de UCITS, de 1 a 7. Otra escala: un 6 de SRRI no es un 6 de SRI.");
  }, 60000);

  test("«no ordenar entre sí» sale bajo el Sharpe solo si la columna mezcla métodos", async () => {
    const AVISO = "Métodos distintos: no ordenar entre sí.";
    expect(buildInternalReportModelWithLabels(await baseInput()).sharpeDeMetodosDistintos).toBe(true);
    expect(await textoDe(await baseInput())).toContain(AVISO);
    const unMetodo = assets.map((a) => ({ ...a, metrics: { ...a.metrics, metrics_method: "EXTRACTOR_MONTHLY_V2" } }));
    expect(buildInternalReportModelWithLabels(await baseInput({ assets: unMetodo })).sharpeDeMetodosDistintos).toBe(false);
    expect(await textoDe(await baseInput({ assets: unMetodo }))).not.toContain(AVISO);
  }, 60000);
});

describe("decisión 83: lo que a una acción no le aplica dice «No aplica», no falta y no avisa", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  const accion = (id: string, i: number) => asset(id, i, { display_name: `Acción ${i + 1}`, instrument_type: "STOCK", category: "accion", costs: undefined, holdings_summary: { has_holdings: false }, metrics: { risk_score: 5, risk_score_source: "VOL_BUCKET", annualized_return_3y: 0.33, volatility_3y: 0.15 } });
  const soloEstos = (h: typeof h3, ids: string[]) => ({ ...h, backtest: { ...h.backtest, asset_ids: ids }, maxSharpe: null, frontier: null }) as unknown as typeof h3;
  const SOLA = [{ asset_id: "DEMO_A", weight_percent: 100 }];

  test("una sola acción: Calmar, alfa, ratio de información, activa y tracking error; beta, volatilidad y caída se quedan", async () => {
    const texto = await textoDe(await baseInput({ assets: [accion("DEMO_A", 0)], positions: SOLA, horizons: { "3Y": soloEstos(h3, ["DEMO_A"]), "5Y": soloEstos(h5, ["DEMO_A"]) } }));
    for (const fila of ["Calmar", "Rentabilidad activa", "Ratio de información", "Alfa de Jensen", "Tracking error"]) expect(texto, fila).toMatch(new RegExp(`${fila} No aplica No aplica`));
    expect(texto).toMatch(/Beta frente a la referencia [−\d]/);
    expect(texto).toMatch(/Volatilidad anualizada \d/);
    /* «Caída máxima» desde el 14-11-2026: vocabulario del sistema de diseño (antes «Máxima caída»). */
    expect(texto).toMatch(/Caída máxima [−\d]/);
    expect(texto).not.toContain("tracking error del");
    expect(texto).not.toContain("al año a favor");
    expect(texto).not.toContain("al año en contra");
  }, 60000);

  test("dos acciones siguen siendo una cartera: sus cifras no se tocan", async () => {
    const dos = [accion("DEMO_A", 0), accion("DEMO_B", 1)];
    const texto = await textoDe(await baseInput({ assets: dos, positions: [{ asset_id: "DEMO_A", weight_percent: 50 }, { asset_id: "DEMO_B", weight_percent: 50 }], horizons: { "3Y": soloEstos(h3, ["DEMO_A", "DEMO_B"]), "5Y": soloEstos(h5, ["DEMO_A", "DEMO_B"]) } }));
    for (const fila of ["Calmar", "Rentabilidad activa", "Ratio de información", "Alfa de Jensen", "Tracking error"]) expect(texto, fila).not.toMatch(new RegExp(`${fila} No aplica`));
  }, 60000);

  test("el indicador: una acción no lo tiene, no avisa y cuenta en su fila; un fondo sin él sí avisa, y su barra lo dice", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: [assets[0], assets[1], accion("DEMO_C", 2)] }));
    expect(m.positions.find((p) => p.assetId === "DEMO_C")).toMatchObject({ sri: null, sriSource: null });
    expect(m.allocation.bySri.at(-1)).toMatchObject({ label: "No aplica" });
    expect(m.allocation.bySri.at(-1)!.weight).toBeCloseTo(0.2, 12);
    expect(m.reviewPoints.map((p) => p.text).join(" | ")).not.toContain("Sin indicador de riesgo");
    const conUnFondoSin = buildInternalReportModelWithLabels(await baseInput());
    expect(conUnFondoSin.reviewPoints.map((p) => p.text).join(" | ")).toContain("Sin indicador de riesgo: Fondo Ñandú 3.");
    expect(conUnFondoSin.allocation.bySri.at(-1)).toMatchObject({ label: "Sin indicador" });
  });

  test("un nombre que acaba en punto no deja dos en la frase", async () => {
    const conPunto = [asset("DEMO_A", 0), asset("DEMO_B", 1), asset("DEMO_C", 2, { display_name: "Gestión S.A." })];
    const puntos = buildInternalReportModelWithLabels(await baseInput({ assets: conPunto })).reviewPoints.map((p) => p.text);
    expect(puntos).toContain("Sin indicador de riesgo: Gestión S.A.");
    expect(puntos.join(" ")).not.toContain("..");
  });
});

describe("decisión 85: un reparto del papel es de toda la cartera, y lo que no entra lleva su fila", () => {
  const ISHARES = asset("DEMO_A", 0, { display_name: "iShares", pms_exposure: { equity: 0.994, fixed_income: 0, cash: 0.006, alternative: 0, other: 0 } });
  const JPMORGAN = asset("DEMO_B", 1, { display_name: "JPMorgan", pms_exposure: { equity: 0, fixed_income: 0.965, cash: 0.035, alternative: 0, other: 0 } });
  const CAM = asset("DEMO_C", 2, { display_name: "CAM, CUOTAS PARTICIPATIVAS", instrument_type: "STOCK", is_investable: false, quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED"], pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } });
  const CARTERA = [{ asset_id: "DEMO_C", weight_percent: 10 }, { asset_id: "DEMO_A", weight_percent: 50 }, { asset_id: "DEMO_B", weight_percent: 40 }];

  test("CAM 10, iShares 50 y JPMorgan 40: la clase y lo de dentro de los fondos, en % de toda la cartera, y suman 100", async () => {
    const informe = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: CARTERA, assets: [CAM, ISHARES, JPMORGAN] });
    const { allocation } = buildInternalReportModelWithLabels(await baseInput({ report: informe, assets: [CAM, ISHARES, JPMORGAN], positions: CARTERA }));
    const pesos = (filas: typeof allocation.byClass) => Object.fromEntries(filas.map((fila) => [fila.label, Number((fila.weight * 100).toFixed(1))]));
    expect(pesos(allocation.byClass)).toEqual({ "Renta variable": 50, "Renta fija": 40, "Fuera del reparto": 10 });
    /* A mano: 0,5 × 99,4 = 49,7; 0,4 × 96,5 = 38,6; 0,5 × 0,6 + 0,4 × 3,5 = 1,7. */
    expect(pesos(allocation.underlyingMix)).toEqual({ "Renta variable": 49.7, "Renta fija": 38.6, Liquidez: 1.7, "Fuera del reparto": 10 });
    for (const filas of [allocation.byClass, allocation.byCurrency, allocation.byRegion, allocation.underlyingMix]) {
      expect(filas.reduce((suma, fila) => suma + fila.weight, 0)).toBeCloseTo(1, 10);
      expect(filas.at(-1)?.label).toBe("Fuera del reparto");
    }
  });

  test("una cartera en la que entra todo: sin fila, y las cifras de siempre", async () => {
    const posiciones = [{ asset_id: "DEMO_A", weight_percent: 60 }, { asset_id: "DEMO_B", weight_percent: 40 }];
    const informe = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: posiciones, assets: [ISHARES, JPMORGAN] });
    const { allocation } = buildInternalReportModelWithLabels(await baseInput({ report: informe, assets: [ISHARES, JPMORGAN], positions: posiciones }));
    expect(allocation.byClass.map((fila) => [fila.label, Number((fila.weight * 100).toFixed(1))])).toEqual([["Renta variable", 60], ["Renta fija", 40]]);
    expect(allocation.underlyingMix.map((fila) => fila.label)).not.toContain("Fuera del reparto");
  });

  test("una clase negativa se lee, y una que redondea a −0,0 no: el reparto es neto de cortos", () => {
    const filas = bucketsDeLaMezcla({ equity: 100, fixed_income: 19.8, cash: -19.8, other: -0.04 }, { equity: "Renta variable", fixed_income: "Renta fija", cash: "Liquidez", other: "Otros" }, { parteInvertible: 1, pesoPct: 0 });
    expect(filas.map((fila) => fila.label)).toEqual(["Renta variable", "Renta fija", "Liquidez"]);
    expect(filas.at(-1)?.weight).toBeCloseTo(-0.198, 12);
  });
});

describe("decisión 80: las erratas y lo que afirmaba de más en el interno", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");

  test("«dos metodologías» reconoce los métodos de la base nueva: 50 % propio y 50 % del proveedor, a mano", async () => {
    const conMetodos = [
      asset("DEMO_A", 0, { metrics: { ...assets[0].metrics, metrics_method: "EXTRACTOR_MONTHLY_V2" } }),
      asset("DEMO_B", 1, { metrics: { ...assets[1].metrics, metrics_method: "TRAILING_PROVIDER" } }),
      asset("DEMO_C", 2, { metrics: { ...assets[2].metrics, metrics_method: "TRAILING_PROVIDER" } })
    ];
    const puntos = buildInternalReportModelWithLabels(await baseInput({ assets: conMetodos })).reviewPoints.map((p) => p.text);
    expect(puntos).toContain("Métricas por posición de dos metodologías: 50\u00a0% del peso calculado sobre serie propia y 50\u00a0% cifra del proveedor.");
    const todosPropios = conMetodos.map((a) => ({ ...a, metrics: { ...a.metrics, metrics_method: "EXTRACTOR_MONTHLY_V2" } }));
    expect(buildInternalReportModelWithLabels(await baseInput({ assets: todosPropios })).reviewPoints.map((p) => p.text).join(" ")).not.toContain("dos metodologías");
  });

  test("el estrés sin cobertura se dice una vez, aunque salga en las dos ventanas", async () => {
    const conEstres = (h: typeof h3) => ({ ...h, backtest: { ...h.backtest, stress_scenarios: [{ id: "COVID", label: "COVID-19", representative: false, reason: null, drawdown_pct: null }] } }) as unknown as typeof h3;
    const puntos = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": conEstres(h3), "5Y": conEstres(h5) } })).reviewPoints.filter((p) => p.area === "Estrés");
    expect(puntos.map((p) => p.text)).toEqual(["COVID-19: cobertura insuficiente para ser representativo."]);
  });

  test("el índice promete el cono solo si hay cifras de las que sale", async () => {
    expect(await textoDe(await baseInput())).toContain("Medidas con su umbral, estrés y cono estadístico.");
    const sinCifra = (h: typeof h3) => ({ ...h, coverageWeightPercent: 40 }) as typeof h3;
    const texto = await textoDe(await baseInput({ horizons: { "3Y": sinCifra(h3), "5Y": sinCifra(h5) } }));
    expect(texto).toContain("Medidas con su umbral y estrés.");
    expect(texto).not.toContain("cono estadístico");
  }, 60000);

  test("lo que no es invertible se dice sin «según el contrato local», y con su tilde lo demás", async () => {
    const feasibility = { status: "BLOCKED", blocking_issues: [{ code: "NON_INVESTABLE_ASSET", severity: "BLOCKING", message: "CAM no es invertible según el contrato local.", asset_id: "CAM" }], warnings: [{ code: "INVALID_BOUNDS", severity: "WARNING", message: "Fondo X tiene limites incompatibles.", asset_id: "X" }], locked_weight: 0, unlocked_budget: 1 } as unknown as InternalReportInput["feasibility"];
    const texto = await textoDe(await baseInput({ feasibility }));
    expect(texto).toContain("CAM no es invertible.");
    expect(texto).toContain("Fondo X tiene límites incompatibles.");
    expect(texto).not.toContain("contrato local");
  }, 60000);

  test("el oro dice dónde está su 100 %, y un fondo normal no añade nada", async () => {
    const conOro = [assets[0], assets[1], asset("DEMO_C", 2, { display_name: "Oro físico", economic_asset_class: "COMMODITIES", pms_exposure: { equity: 0, fixed_income: 0, cash: 0, alternative: 0, other: 1 } })];
    const texto = await textoDe(await baseInput({ assets: conOro }));
    expect(texto).toContain("Exposición: RV 0 % · RF 0 % · liquidez 0 % · materias primas 100 %");
    expect(texto).toContain("Exposición: RV 100 % · RF 0 % · liquidez 0 %");
    expect(texto).not.toContain("RV 100 % · RF 0 % · liquidez 0 % · materias primas");
  }, 60000);

  test("un fondo sin mezcla en la base, relleno por su clase en el servidor: no cubre, y su ficha no inventa tres cifras (revisión final, V3-1)", async () => {
    /* Como PIMCO en la base nueva: DEMO_B (30 %, renta fija) llega como 100 % renta fija con CLASSIFICATION_FALLBACK. */
    const porSuClase = [assets[0], asset("DEMO_B", 1, { pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0, source: "CLASSIFICATION_FALLBACK" } }), assets[2]];
    const entrada = await baseInput({ assets: porSuClase });
    const m = buildInternalReportModelWithLabels(entrada);
    /* 50 + 20 traen su vector; los 30 de DEMO_B, no. La mezcla no cambia: 70 % renta variable y 30 % renta fija. */
    expect(m.allocation.underlyingMixCoverage).toBeCloseTo(0.7, 10);
    const mix = Object.fromEntries(m.allocation.underlyingMix.map((b) => [b.key, b.weight]));
    expect(mix.equity).toBeCloseTo(0.7, 10);
    expect(mix.fixed_income).toBeCloseTo(0.3, 10);
    const texto = await textoDe(entrada);
    expect(texto).toContain("(cobertura 70 %)");
    expect(texto).toContain("Cobertura: 70 % del peso con vector de exposición; el resto se reparte por su clase económica.");
    /* El lector de texto pierde la ligadura «fi». */
    expect(texto).toMatch(/Exposición: por su clase \(Renta (fi)?ja\), sin dato declarado/);
    expect(texto).not.toContain("Exposición: RV 0 % · RF 100 % · liquidez 0 %");
    /* Los que sí la traen, como siempre. */
    expect(texto).toContain("Exposición: RV 100 % · RF 0 % · liquidez 0 %");
  }, 60000);

  test("TER ya no se escribe en ningún sitio: es el coste corriente", async () => {
    const texto = await textoDe(await baseInput());
    expect(texto).not.toMatch(/\bTER\b/);
    /* «Coste corriente medio», sin «ponderado», desde el 14-11-2026 (vocabulario del sistema de diseño). */
    expect(texto).toContain("Coste corriente medio");
    expect(texto).not.toContain("Coste corriente medio ponderado");
    expect(texto).toContain("Coste corriente total");
  }, 60000);

  test("el mismo motivo en las dos ventanas se dice una vez", async () => {
    const fuera = (h: typeof h3) => ({ ...h, backtest: { ...h.backtest, asset_ids: ["DEMO_A", "DEMO_B"], excluded_assets: [{ asset_id: "DEMO_C", reason: "INSUFFICIENT_HISTORY" }] } }) as unknown as typeof h3;
    const texto = await textoDe(await baseInput({ horizons: { "3Y": fuera(h3), "5Y": fuera(h5) } }));
    /* El lector de texto puede separar el «3» de la «A». */
    /* Las ventanas, con palabras desde el 14-11-2026 (antes «3A y 5A fuera»). */
    expect(texto).toMatch(/3 y 5 años fuera \([^)]+\)/);
    expect(texto).not.toMatch(/3 años fuera \([^)]+\) · 5 años fuera/);
  }, 60000);
});

describe("pantalla-1 de las puertas finales: la cuenta de posiciones del proveedor, solo si no la desmiente lo recibido", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  const posiciones = [
    { asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", weight_percent: 50, instrument_type: "FUND" as const },
    { asset_id: "DEMO_B", display_name: "Fondo Ñandú 2", weight_percent: 30, instrument_type: "FUND" as const },
    { asset_id: "DEMO_C", display_name: "Fondo Ñandú 3", weight_percent: 20, instrument_type: "FUND" as const }
  ];
  const lineas = (id: string, grupos: Array<[string | undefined, number]>) => ({
    asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31",
    holdings: grupos.flatMap(([codigo, cuantas]) => Array.from({ length: cuantas }, (_, i) => ({ name: `${id} ${codigo ?? "x"} ${i}`, weight_pct: 1, ...(codigo ? { holding_type_code: codigo } : {}) })))
  });
  /* DEMO_A declara 40 y llegan 45 acciones: falsa. DEMO_B declara 41 y llegan 41 bonos y 30 líneas de efectivo y divisa, como Amundi con sus
     49 acciones entre 182 líneas: cierta. DEMO_C declara 1 y llega una línea: «1 posición». */
  const conUna = [assets[0], assets[1], asset("DEMO_C", 2, { holdings_summary: { has_holdings: true, positions_count: 1, top10_weight: 100, as_of_date: "2026-08-31" } })];
  const overlap = buildReportOverlap(posiciones, new Map([
    ["DEMO_A", lineas("DEMO_A", [["E", 45]])],
    ["DEMO_B", lineas("DEMO_B", [["B", 41], ["C", 20], ["CU", 10]])],
    ["DEMO_C", lineas("DEMO_C", [["FO", 1]])]
  ]));

  test("con el solapamiento: la que desmienten sus títulos se queda sin cuenta, y las demás la conservan", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: conUna, overlap }));
    expect(Object.fromEntries(m.positions.map((p) => [p.assetId, p.holdingsCount]))).toEqual({ DEMO_A: null, DEMO_B: 41, DEMO_C: 1 });
  });

  test("con la composición subyacente, igual, también para un fondo que no entra en el solapamiento", async () => {
    const lookThrough = { rows: [], equities: { rows: [], identified_weight_percent: 0, equity_exposure_percent: 0, unclassified_funds: [] }, fund_positions: 3, covered_funds: 1, direct_positions: 0, seen_weight_percent: 50,
      fund_portfolios: [{ asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", lines: 45, security_lines: 45, published_weight_percent: 45, sufficient: false }], warnings: [] };
    const m = buildInternalReportModelWithLabels(await baseInput({ lookThrough }));
    expect(Object.fromEntries(m.positions.map((p) => [p.assetId, p.holdingsCount]))).toEqual({ DEMO_A: null, DEMO_B: 41, DEMO_C: 42 });
  });

  test("sin nada recibido, nada la desmiente: la del proveedor, como antes", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    expect(m.positions.map((p) => p.holdingsCount)).toEqual([40, 41, 42]);
  });

  test("en el papel: la hoja de calidad no la escribe, el anexo dice que no está, y «1 posición» en singular", async () => {
    const texto = await textoDe(await baseInput({ assets: conUna, overlap }));
    expect(texto).not.toContain("40 posiciones");
    /* «Falta el dato» desde el 14-11-2026 (antes «N/D posiciones»). */
    expect(texto).toContain("Cartera según la fuente: Falta el dato de posiciones · 10 mayores");
    expect(texto).toContain("Cartera según la fuente: 41 posiciones · 10 mayores");
    expect(texto).toContain("Cartera según la fuente: 1 posición · 10 mayores");
    expect(texto).not.toMatch(/\b1 posiciones\b/);
  }, 60000);
});

describe("T12 · G1: el «10 mayores» del anexo, con la regla de la ficha", () => {
  const textoDe = async (input: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  const posiciones = [
    { asset_id: "DEMO_A", display_name: "Fondo Ñandú 1", weight_percent: 50, instrument_type: "FUND" as const },
    { asset_id: "DEMO_B", display_name: "Fondo Ñandú 2", weight_percent: 30, instrument_type: "FUND" as const },
    { asset_id: "DEMO_C", display_name: "Fondo Ñandú 3", weight_percent: 20, instrument_type: "FUND" as const }
  ];
  const cartera = (id: string, pesos: Array<[string, number]>) => ({
    asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31",
    holdings: pesos.map(([codigo, weight_pct], i) => ({ name: `${id} línea ${i}`, weight_pct, holding_type_code: codigo }))
  });
  /* iShares Core MSCI World (IE00B4L5Y983) en la base nueva: diez acciones que suman 27,78, lo mismo que declara. */
  const ISHARES: Array<[string, number]> = Array.from({ length: 10 }, () => ["E", 2.778]);
  /* PIMCO GIS Global Bond (IE00B11XZ103), medido el 06-11-2026, igual en las dos bases: sus diez primeras líneas son un contrato de divisa, un
     bono y ocho derivados, y suman 151,75 (la undécima, 7,19, no cuenta). La base nueva declara 23,70682, que es del proveedor y no cuadra;
     la vieja guarda 151,75034, que es esa misma suma. */
  const PIMCO: Array<[string, number]> = [["CU", 30.3595], ["TG", 23.7325], ["SI", 15.2818], ["SJ", 15.0901], ["SR", 14.4714], ["SI", 13.6341], ["OS", 12.7038], ["TF", 10.8138], ["TF", 8.2934], ["CS", 7.37], ["TF", 7.18671]];
  const declarando = (diez: [number, number, number]) => assets.map((a, i) => ({ ...a, holdings_summary: { ...a.holdings_summary!, top10_weight: diez[i] } }));
  const conFilas = (b: Array<[string, number]>, c: Array<[string, number]>) => buildReportOverlap(posiciones, new Map([
    ["DEMO_A", cartera("DEMO_A", ISHARES)], ["DEMO_B", cartera("DEMO_B", b)], ["DEMO_C", cartera("DEMO_C", c)]
  ]));
  const diezMayores = (m: ReturnType<typeof buildInternalReportModelWithLabels>) => Object.fromEntries(m.positions.map((p) => [p.assetId, p.top10Weight]));

  test("se escribe la del proveedor solo si cuadra con sus diez primeras líneas: iShares sí, PIMCO no", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: declarando([27.78, 23.70682, 23.70682]), overlap: conFilas(PIMCO, PIMCO) }));
    expect(diezMayores(m)).toEqual({ DEMO_A: 27.78, DEMO_B: null, DEMO_C: null });
  });

  test("lo que guarda la base vieja de PIMCO y de Goldman cuadra con sus filas, porque es su suma, pero más del 100 % del fondo no lo pesan diez posiciones", async () => {
    /* Goldman Sachs Absolute Return Tracker (LU1103307408) en la base vieja: 114,02378, la suma de sus diez primeras líneas (dos contratos de
       divisa, una contrapartida, cinco derivados y dos fondos). */
    const GOLDMAN: Array<[string, number]> = [["CU", 28.0882], ["CQ", 20.256], ["TF", 14.0647], ["SI", 11.8569], ["OS", 8.7484], ["CU", 7.2735], ["OS", 6.5254], ["OS", 6.0813], ["FO", 5.6796], ["FO", 5.4499], ["FO", 5.1864]];
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: declarando([27.78, 151.75034, 114.02378]), overlap: conFilas(PIMCO, GOLDMAN) }));
    expect(diezMayores(m)).toEqual({ DEMO_A: 27.78, DEMO_B: null, DEMO_C: null });
  });

  test("con la tolerancia de la ficha, medio punto; y hasta 100,5 es el redondeo, no los derivados", async () => {
    const tres: Array<[string, number]> = [["BT", 50], ["BT", 30], ["BT", 20.4]];
    const m = buildInternalReportModelWithLabels(await baseInput({ assets: declarando([28.27, 28.29, 100.4]), overlap: buildReportOverlap(posiciones, new Map([
      ["DEMO_A", cartera("DEMO_A", ISHARES)], ["DEMO_B", cartera("DEMO_B", ISHARES)], ["DEMO_C", cartera("DEMO_C", tres)]
    ])) }));
    expect(diezMayores(m)).toEqual({ DEMO_A: 28.27, DEMO_B: null, DEMO_C: 100.4 });
  });

  test("sin líneas con las que comprobarla no se escribe, como en la ficha: no basta con que la declare el proveedor", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput());
    expect(m.positions.map((p) => p.top10Weight)).toEqual([null, null, null]);
  });

  test("en el papel: la que cuadra con su cifra, las demás «Falta el dato», y ni el 23,7 % ni el 151,8 %", async () => {
    const texto = await textoDe(await baseInput({ assets: declarando([27.78, 23.70682, 151.75034]), overlap: conFilas(PIMCO, PIMCO) }));
    expect(texto).toContain("Cartera según la fuente: 40 posiciones · 10 mayores 27,8 %");
    /* «Falta el dato» desde el 14-11-2026 (antes «N/D»). */
    expect(texto).toContain("Cartera según la fuente: 41 posiciones · 10 mayores Falta el dato");
    expect(texto).toContain("Cartera según la fuente: 42 posiciones · 10 mayores Falta el dato");
    expect(texto).not.toContain("23,7 %");
    expect(texto).not.toContain("151,8");
  }, 60000);

  test("la metodología no dice de cuántos puntos es la frontera: el motor pide 40, la curva dibujada lleva menos", async () => {
    const texto = await textoDe(await baseInput());
    /* El lector de texto pierde la ligadura «fi». */
    expect(texto).toMatch(/covarianza regularizada, frontera e(fi)?ciente y carteras de mínima volatilidad y máximo Sharpe/);
    expect(texto).not.toContain("40 puntos");
  }, 60000);
});

describe("A-132. La aportación al riesgo, con más activos medidos que el tope de la frontera", () => {
  type Aportaciones = NonNullable<typeof h3.riskContributions>;
  /** Lo que devuelve la medición por encima de 40 activos medidos: ninguna frontera, y la aportación aparte (misma covarianza). */
  const sinFronteraCon = (h: typeof h3, aportaciones: Aportaciones) => ({ ...h, frontier: null, riskContributions: aportaciones });
  const tres: Aportaciones = [{ asset_id: "DEMO_A", weight_pct: 50, risk_pct: 62 }, { asset_id: "DEMO_B", weight_pct: 30, risk_pct: 25 }, { asset_id: "DEMO_C", weight_pct: 20, risk_pct: 13 }];
  const paginasDe = async (entrada: InternalReportInput, ruta?: string) => {
    const bytes = Buffer.from(await (await createInternalPortfolioReportPdfBlob(entrada)).arrayBuffer());
    if (ruta) await writeFile(ruta, bytes);
    return extractPdfPageTexts(bytes);
  };
  const CABECERA = "Peso (gris)";

  test("las reglas de salud la leen aunque no haya frontera, como la pantalla de Análisis", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": sinFronteraCon(h3, tres), "5Y": h5 } }));
    const aviso = m.health.violations.find((v) => v.rule === "RISK_CONTRIBUTION");
    expect(aviso?.asset_id).toBe("DEMO_A");
    expect(aviso?.message).toBe("Fondo Ñandú 1 aporta 62,0\u00a0% del riesgo.");
    /* La medición de muestra no trae ni frontera ni aportación: sin ella no hay aviso. */
    const sin = buildInternalReportModelWithLabels(await baseInput());
    expect(sin.health.violations.map((v) => v.rule)).not.toContain("RISK_CONTRIBUTION");
  });

  test("si la de 3 años no la trae, vale la de 5, como antes con la frontera", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ horizons: { "3Y": h3, "5Y": sinFronteraCon(h5, tres) } }));
    expect(m.health.violations.map((v) => v.rule)).toContain("RISK_CONTRIBUTION");
  });

  test("en el papel, sin frontera: el bloque sale con sus filas y en una sola hoja", async () => {
    const paginas = await paginasDe(await baseInput({ horizons: { "3Y": sinFronteraCon(h3, tres), "5Y": h5 }, includeAssetSheets: false }));
    const conElBloque = paginas.filter((p) => p.includes(CABECERA));
    expect(conElBloque).toHaveLength(1);
    expect(conElBloque[0]).toContain("Contribución al riesgo frente al peso · 3 años");
    expect(conElBloque[0]).toContain("50,0 % / 62,0 %");
    expect(conElBloque[0]).toContain("20,0 % / 13,0 %");
  }, 60000);

  test("en el papel, sesenta posiciones: las sesenta filas, y la cabecera en cada hoja por la que sigue", async () => {
    const n = 60;
    const idsN = Array.from({ length: n }, (_, i) => `VAL_${String(i + 1).padStart(2, "0")}`);
    /* Cuarenta al 2 % y veinte al 1 %: suman 100. */
    const posicionesN = idsN.map((id, i) => ({ asset_id: id, weight_percent: i < 40 ? 2 : 1 }));
    const activosN = idsN.map((id, i) => asset(id, i % 3, { display_name: `Valor de prueba ${String(i + 1).padStart(2, "0")}` }));
    const informeN = { ...report, portfolio_name: "Cartera de sesenta", positions: posicionesN.map((p, i) => ({ ...report.positions[i % 3], ...p, display_name: activosN[i].display_name })) } as BdbPortfolioReport;
    const r3 = await fetchPortfolioHorizon(posicionesN, "3Y");
    expect(r3.backtest.asset_ids).toHaveLength(n);
    /* La primera aporta más de lo que pesa; el resto, algo menos. Suman 100. */
    const aportaciones: Aportaciones = posicionesN.map((p, i) => ({ asset_id: p.asset_id, weight_pct: p.weight_percent, risk_pct: i === 0 ? 100 - 0.9 * 98 : 0.9 * p.weight_percent }));
    const paginas = await paginasDe(await baseInput({
      report: informeN, assets: activosN, positions: posicionesN, horizons: { "3Y": sinFronteraCon(r3, aportaciones) },
      retro: { status: "ok", records: new Map() }, includeAssetSheets: false
    }), process.env.INTERNAL_REPORT_QA_A132_PATH);
    const conElBloque = paginas.filter((p) => p.includes(CABECERA));
    expect(conElBloque).toHaveLength(2);
    /* El título, una vez; la cabecera, en las dos. */
    expect(conElBloque.filter((p) => p.includes("Contribución al riesgo frente al peso · 3 años"))).toHaveLength(1);
    /* Cada fila lleva su par «peso / riesgo»: sesenta, ni una menos. */
    const filas = conElBloque.flatMap((p) => p.match(/\d,\d % \/ \d+,\d %/g) ?? []);
    expect(filas).toHaveLength(n);
    expect(filas.filter((f) => f === "2,0 % / 11,8 %")).toHaveLength(1);
    const nombres = new Set(conElBloque.flatMap((p) => p.match(/Valor de prueba \d\d/g) ?? []));
    expect(nombres.size).toBe(n);
    /* La nota va al final, tras la última fila. */
    expect(conElBloque[1]).toContain("En ocre, la posición aporta más riesgo del que pesa.");
    expect(conElBloque[1]).toContain("Valor de prueba 60");
    paginas.forEach((pagina, i) => expect(pagina).toContain(`Página ${i + 1} de ${paginas.length}`));
  }, 120000);

  test("sin reparto, el papel lo dice con las palabras de la pantalla y ya no pide una frontera", async () => {
    const texto = (await paginasDe(await baseInput({ includeAssetSheets: false }))).join(" ");
    expect(texto).toContain("La medición no ha traído el reparto del riesgo.");
    expect(texto).not.toContain("necesita una frontera calculada");
    const unSolo = { ...h3, backtest: { ...h3.backtest, asset_ids: ["DEMO_A"] } };
    const conUno = (await paginasDe(await baseInput({ horizons: { "3Y": unSolo }, includeAssetSheets: false }))).join(" ");
    expect(conUno).toContain("Con un solo activo medido no hay reparto del riesgo.");
  }, 60000);
});

describe("B-78. Una posición con la serie parada", () => {
  const paradas = new Map([["DEMO_B", "2025-11-28"]]);

  test("es un punto a revisar de severidad alta, con su nombre y su fecha, y su fila lleva la fecha", async () => {
    const m = buildInternalReportModelWithLabels(await baseInput({ seriesParadas: paradas }));
    const punto = m.reviewPoints.find((p) => p.text.includes("Serie parada"));
    expect(punto).toEqual({ severity: "alta", area: "Datos", text: "Fondo Ñandú 2 · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores." });
    expect(m.reviewPoints[0].severity).toBe("alta");
    expect(m.positions.find((p) => p.assetId === "DEMO_B")?.serieParadaDesde).toBe("2025-11-28");
    expect(m.positions.filter((p) => p.serieParadaDesde)).toHaveLength(1);
  });

  test("sin ninguna parada no hay punto ni fecha, y el papel tiene las mismas hojas", async () => {
    const sin = buildInternalReportModelWithLabels(await baseInput());
    expect(sin.reviewPoints.some((p) => /Serie parada|Series paradas/.test(p.text))).toBe(false);
    expect(sin.positions.every((p) => p.serieParadaDesde === undefined)).toBe(true);

    const hojasSin = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ includeAssetSheets: false }))).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
    const hojasCon = extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(await baseInput({ includeAssetSheets: false, seriesParadas: paradas }))).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
    expect(hojasCon).toHaveLength(hojasSin.length);
    expect(hojasSin.join(" ")).not.toContain("Serie parada");
    /* En la tabla de posiciones, bajo el ISIN de su fila; y en los puntos a revisar. */
    const posiciones = hojasCon.find((p) => p.includes("2 · Posiciones") && p.includes("DEMO_B"))!;
    expect(posiciones).toContain("DEMO_B · RF Euro corto plazo · Serie parada desde el 28/11/2025");
    expect(hojasCon.join(" ")).toContain("Fondo Ñandú 2 · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores.");
  }, 60_000);
});
