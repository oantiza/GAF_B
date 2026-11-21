import { describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/* INF-01: la cuenta con la que se ha entrado, de la que sale el responsable por defecto. */
const cuenta = vi.hoisted(() => ({
  auth: { currentUser: null as { displayName: string | null } | null },
  firestore: null,
  functions: null,
  appCheckReady: Promise.resolve()
}));
vi.mock("../src/firebase", () => cuenta);

import { responsableDeLaCuenta } from "../src/core/identidadDelInforme";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { FrontierViewModel } from "../src/types/portfolioFrontier";
import { horizonteDePrueba } from "./support/horizonteDePrueba";
import { extractPdfPageTexts } from "./support/pdfText";

const portfolioReport = {
  portfolio_name: "Cartera test",
  mode: "BBDD_STATIC_EXPORT_SAMPLE",
  summary: {
    source: "BBDD_STATIC_EXPORT_SAMPLE",
    position_count: 1,
    total_weight_percent: 100,
    validation_status: "VALID",
    is_valid: true,
    by_instrument_type: [{ key: "FUND", weight_percent: 100 }],
    by_economic_asset_class: [{ key: "FIXED_INCOME", weight_percent: 100 }],
    non_investable_assets: [],
    warnings: [],
    weighted_metrics: {
      preview_boundary: { mode: "PREVIEW_ONLY", source_label: "test", limitations: [] },
      annualized_return_3y: 0.02,
      volatility_3y: 0.071,
      sharpe_3y: 0.63,
      max_drawdown_5y: -0.05
    }
  },
  positions: [{
    asset_id: "LU0996182563",
    display_name: "Mock Global Aggregate Bond Fund",
    instrument_type: "FUND",
    economic_asset_class: "FIXED_INCOME",
    currency: "EUR",
    coverage_status: "COMPLETE",
    weight_percent: 100,
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 }
  }],
  warnings: [],
  xray: {
    by_region: [
      { key: "europe", weight_percent: 34.9 },
      { key: "united_states", weight_percent: 25.6 },
      { key: "asia_emerging", weight_percent: 21.4 },
      { key: "asia_developed", weight_percent: 9.5 },
      { key: "japan", weight_percent: 8.6 }
    ]
  },
  data_diagnostic: {}
} as unknown as BdbPortfolioReport;

/* Cartera de ejemplo con 12 posiciones (pesos redondeados que suman 100) y
   un nombre de cliente claramente ficticio: nada de datos reales en el repo. */
const informeDeClienteFixture = {
  ...portfolioReport,
  portfolio_name: "Cliente de ejemplo",
  summary: {
    ...portfolioReport.summary,
    position_count: 12,
    total_weight_percent: 100
  },
  positions: [16, 15, 15, 10, 9, 8, 8, 7, 5, 3, 2, 2].map((weight, index) => ({
    ...portfolioReport.positions[0],
    asset_id: `LU${String(996182563 + index).padStart(10, "0")}`,
    display_name: index % 3 === 0
      ? `Fondo internacional de estrategia diversificada ${index + 1}`
      : `Fondo de inversión ${index + 1}`,
    weight_percent: weight
  })),
  xray: {
    ...portfolioReport.xray,
    by_category: [
      { key: "Flexible", weight_percent: 58 },
      { key: "Mixto Moderado", weight_percent: 12 },
      { key: "Renta Variable Europea", weight_percent: 10 },
      { key: "Renta Variable Global", weight_percent: 7.5 },
      { key: "Renta Variable Temática", weight_percent: 7 },
      { key: "Otras Categorías", weight_percent: 5.5 }
    ],
    pms_exposure_percent: { equity: 40, fixed_income: 51, cash: 3.5, alternative: 2.5, real_asset: 0, other: 3 }
  }
} as BdbPortfolioReport;


const feasibility = {
  status: "FEASIBLE",
  blocking_issues: [],
  warnings: [],
  locked_weight: 0,
  unlocked_budget: 1
} as unknown as PortfolioFeasibilityCheck;

const portfolioBacktest = {
  schema_version: "backtest.v1",
  window: "3Y",
  frequency: "WEEKLY",
  /* Mide las doce posiciones de la cartera de ejemplo: con menos, el informe lo dice y añade su anexo. */
  asset_ids: informeDeClienteFixture.positions.map((position) => position.asset_id),
  metrics: { cagr: 0.064, volatility: 0.071, sharpe: 0.63, max_drawdown: -0.084, rf_rate: 0.019 },
  portfolio_series: Array.from({ length: 36 }, (_, index) => ({
    date: `202${3 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`,
    value: 100 * 1.005 ** index * (1 + Math.sin(index / 3) * 0.012)
  })),
  benchmark_series: {
    equilibrado: Array.from({ length: 36 }, (_, index) => ({
      date: `202${3 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`,
      value: 100 * 1.004 ** index
    }))
  },
  synthetics: [
    { label: "Conservador", volatility: 0.04, annual_return: 0.025 },
    { label: "Moderado", volatility: 0.065, annual_return: 0.052 },
    { label: "Equilibrado", volatility: 0.085, annual_return: 0.069 },
    { label: "Dinámico", volatility: 0.12, annual_return: 0.095 },
    { label: "Agresivo", volatility: 0.16, annual_return: 0.12 }
  ],
  stress_scenarios: [],
  correlation_matrix: [],
  benchmark_series_order: [],
  coverage: { first_date: "2023-01-01", last_date: "2025-12-01", common_observations: 36 }
} as unknown as BacktestResponse;

const historicalFrontier = {
  kind: "historical",
  label: "Frontera histórica",
  asOfDate: "2026-07-12",
  window: "3Y",
  riskFreeRateLabel: "1,90 %",
  riskFreeSource: "ECB_ESTR",
  riskFreeRatePolicy: "WINDOW_AVERAGE",
  coverage: { requested: 5, included: 5, commonObservations: 156, firstDate: "2023-07-12", lastDate: "2026-07-12" },
  insufficientCoverage: false,
  current: { expectedReturn: 0.064, volatility: 0.071, sharpeRatio: 0.63, expectedReturnLabel: "6,4 %", volatilityLabel: "7,1 %", sharpeLabel: "0,63", weights: [] },
  minVolatility: { expectedReturn: 0.038, volatility: 0.041, sharpeRatio: 0.46, expectedReturnLabel: "3,8 %", volatilityLabel: "4,1 %", sharpeLabel: "0,46", weights: [] },
  maxSharpe: { expectedReturn: 0.078, volatility: 0.082, sharpeRatio: 0.72, expectedReturnLabel: "7,8 %", volatilityLabel: "8,2 %", sharpeLabel: "0,72", weights: [] },
  frontier: Array.from({ length: 12 }, (_, index) => ({
    volatility: 0.041 + index * 0.007,
    expectedReturn: 0.038 + index * 0.0052,
    sharpeRatio: 0.46 + index * 0.02
  })),
  excluded: [],
  warnings: []
} as FrontierViewModel;

async function expectPdfBlob(blob: Blob): Promise<void> {
  expect(blob.type).toBe("application/pdf");
  expect(blob.size).toBeGreaterThan(1000);
  const header = await blob.slice(0, 5).text();
  expect(header).toBe("%PDF-");
}

describe("vector PDF reports", () => {
  test("renderiza el PDF de Mi Boutique", async () => {
    await expectPdfBlob(await createWeeklyReportPdfBlob(WEEKLY_REPORT_MOCK, "WEEKLY_REPORT"));
  }, 15_000);

  /* Desde la plantilla única (paso 9 del rediseño), sin portada: la primera hoja presenta y las demás fluyen. Sin marca de entidad. */
  test("renderiza el Informe de cliente con el nombre indicado, en hojas A4 y sin marca de entidad", async () => {
    const blob = await createInformeDeClientePdfBlob({
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier }),
      clientName: "Cliente de ejemplo"
    });
    await expectPdfBlob(blob);
    const source = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    const hojas = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).length;
    expect(hojas).toBeGreaterThanOrEqual(4);
    expect(source.match(/\/MediaBox \[0 0 595\.280029 841\.890015\]/g)).toHaveLength(hojas);
    expect(source).toContain("Informe de cartera - Cliente de ejemplo");
    expect(source).not.toContain("Independent Private Bankers");
    if (process.env.BDB_WRITE_PDF_PREVIEW === "true") {
      const outputDir = path.resolve("output/pdf");
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, "informe-cartera-preview.pdf"), Buffer.from(await blob.arrayBuffer()));
    }
  }, 15_000);

  test("ninguna página menciona a un banco, y sin responsable no firma nadie (texto extraído)", async () => {
    const blob = await createInformeDeClientePdfBlob({
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier }),
      clientName: "Cliente de prueba"
    });
    const paginas = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    expect(paginas.length).toBeGreaterThan(1);
    for (const [indice, texto] of paginas.entries()) {
      expect(texto.toLowerCase(), `página ${indice + 1} menciona al banco`).not.toContain("andbank");
    }
    expect(paginas[0].toLowerCase()).not.toContain("elaborado por");
  }, 20_000);

  /* 02-10-2026: «Elaborado por». Si el usuario lo borra, la portada sale sin nombre (ni etiqueta).
     INF-01 (13-11-2026): ningún nombre de persona escrito en el código. El diálogo lo propone con el nombre de la
     cuenta con la que se ha entrado; si la cuenta no tiene nombre, o el llamante no manda ninguno, no firma nadie. */
  test("el informe sale sin nombre si se vacía «Elaborado por», y sin firma si no se manda", async () => {
    const base = {
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier })
    };
    const vacio = await createInformeDeClientePdfBlob({ ...base, banker: { name: "   ", email: "" } });
    const portadaVacia = extractPdfPageTexts(Buffer.from(await vacio.arrayBuffer()))[0];
    expect(portadaVacia).not.toContain("Oscar Antiza Algar");
    expect(portadaVacia.toLowerCase()).not.toContain("elaborado por");
    expect(portadaVacia.toLowerCase()).not.toContain("responsable comercial");
    expect(portadaVacia).toContain("Rentabilidades pasadas");

    const tecleado = await createInformeDeClientePdfBlob({ ...base, banker: { name: "Marta López", email: "" } });
    const portadaTecleada = extractPdfPageTexts(Buffer.from(await tecleado.arrayBuffer()))[0];
    expect(portadaTecleada.toLowerCase()).toContain("elaborado por");
    expect(portadaTecleada).toContain("Marta López");

    const sinCampo = await createInformeDeClientePdfBlob(base);
    const portadaDefecto = extractPdfPageTexts(Buffer.from(await sinCampo.arrayBuffer()))[0];
    expect(portadaDefecto.toLowerCase()).not.toContain("elaborado por");
    expect(portadaDefecto).not.toContain("Antiza");
  }, 40_000);

  test("firma por defecto el nombre de la cuenta de la sesión cuando lo tiene, y nadie cuando no", async () => {
    const base = {
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier })
    };
    clearSessionCaches();
    cuenta.auth.currentUser = { displayName: "Ana Pérez Gil" };
    const conCuenta = await createInformeDeClientePdfBlob({ ...base, banker: responsableDeLaCuenta() });
    const portadaConCuenta = extractPdfPageTexts(Buffer.from(await conCuenta.arrayBuffer()))[0];
    expect(portadaConCuenta.toLowerCase()).toContain("elaborado por");
    expect(portadaConCuenta).toContain("Ana Pérez Gil");

    cuenta.auth.currentUser = { displayName: null };
    const sinNombre = await createInformeDeClientePdfBlob({ ...base, banker: responsableDeLaCuenta() });
    const portadaSinNombre = extractPdfPageTexts(Buffer.from(await sinNombre.arrayBuffer()))[0];
    expect(portadaSinNombre.toLowerCase()).not.toContain("elaborado por");
    cuenta.auth.currentUser = null;
  }, 40_000);

  test("el informe respeta el correo tecleado", async () => {
    const blob = await createInformeDeClientePdfBlob({
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier }),
      banker: { name: "Marta López", email: "marta@asesoria-independiente.es" }
    });
    const portada = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()))[0];
    expect(portada).toContain("marta@asesoria-independiente.es");
    expect(portada.toLowerCase()).not.toContain("andbank");
  }, 20_000);

  /* F-04 (auditoría 29-09): el shell ya no inventa 100.000 €. Desde el 10-11-2026, sin capital fijado ni siquiera hay campo de
     valoración en la portada ni columna de importe en la tabla: no se pinta nada, ni «N/D». */
  test("sin capital fijado el informe no pinta la valoración ni el importe, y no inventa 100.000 €", async () => {
    const blob = await createInformeDeClientePdfBlob({
      report: informeDeClienteFixture,
      feasibility,
      totalCapital: undefined,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier })
    });
    const texto = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ");
    expect(texto).not.toContain("Valoración actual");
    expect(texto).not.toContain("Importe");
    expect(texto).not.toContain("N/D");
    expect(texto).not.toContain("100.000");
    expect(texto).not.toContain("100.000 €");
  }, 20_000);

  /* Desde la plantilla única la tabla fluye: repite su cabecera en cada hoja, no parte filas ni pierde ninguna, y el total va con las últimas. */
  test.each([0, 20, 21, 39, 40, 41])("la tabla de composición fluye sin perder filas (%i activos)", async (count) => {
    const report = {
      ...informeDeClienteFixture,
      portfolio_name: "Prueba de paginación",
      summary: { ...informeDeClienteFixture.summary, position_count: count, total_weight_percent: count > 0 ? 100 : 0 },
      positions: Array.from({ length: count }, (_, index) => ({
        ...informeDeClienteFixture.positions[0],
        asset_id: `QA${String(index + 1).padStart(10, "0")}`,
        display_name: index % 3 === 0
          ? `Fondo internacional de estrategia diversificada con cobertura en euros y clase de acumulación ${index + 1}`
          : `Fondo de inversión de prueba ${index + 1}`,
        weight_percent: (count - index) * 100 / (count * (count + 1) / 2),
      })).reverse(),
    } as BdbPortfolioReport;
    const blob = await createInformeDeClientePdfBlob({
      report, generadoEn: "2026-09-05T12:00:00Z", feasibility,
      totalCapital: 100000, analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier }),
    });
    await expectPdfBlob(blob);
    const source = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    const paginas = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    expect(source.match(/\/MediaBox \[0 0 595\.280029 841\.890015\]/g)).toHaveLength(paginas.length);
    paginas.forEach((pagina, i) => expect(pagina).toContain(`Página ${i + 1} de ${paginas.length}`));
    /* Cada fila sale una vez (su ISIN va en el apunte), y cada hoja con filas lleva la cabecera de la tabla. */
    const vistas = paginas.flatMap((pagina) => [...pagina.matchAll(/· QA(\d{10})/g)].map((m) => Number(m[1])));
    expect([...vistas].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    for (const pagina of paginas.filter((p) => /· QA\d{10}/.test(p))) expect(pagina).toContain("Fondo / estrategia");
    const conElTotal = paginas.find((pagina) => pagina.includes("Total cartera"))!;
    if (count > 0) expect(conElTotal).toMatch(/· QA\d{10}/);
    expect(paginas.join(" ")).toContain("Composición por categoría");
    if (process.env.BDB_WRITE_PDF_PREVIEW === "true") {
      const outputDir = path.resolve("output/pdf");
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, `informe-cartera-${count}-posiciones.pdf`), Buffer.from(await blob.arrayBuffer()));
    }
  }, 15_000);

  /* La frontera volvió al informe de cliente el 16-11-2026, pero sin anexo propio: A-136.5 dejó un solo anexo, y lo que no entra en
     el cálculo se nombra bajo el gráfico, con las palabras del cliente y no con la etiqueta del servidor. */
  test.each([3, 21])("una frontera parcial no añade un anexo, y nombra lo que queda fuera bajo el gráfico (%i fuera)", async (excludedCount) => {
    const positions = Array.from({ length: 39 }, (_, index) => ({
      ...informeDeClienteFixture.positions[0], asset_id: `QA${String(index + 1).padStart(10, "0")}`,
      display_name: `Fondo internacional de estrategia diversificada y cobertura en euros ${index + 1}`,
      weight_percent: 100 / 39,
    }));
    const excluded = positions.slice(-excludedCount).map((position) => ({
      assetId: position.asset_id, weightPercent: position.weight_percent,
      reasonLabel: "Sin serie histórica de precios o de divisa con cobertura suficiente en la ventana solicitada"
    }));
    const blob = await createInformeDeClientePdfBlob({
      report: { ...informeDeClienteFixture, positions, summary: { ...informeDeClienteFixture.summary, position_count: 39 } },
      feasibility, totalCapital: 100000,
      analysis: horizonteDePrueba(portfolioBacktest, { frontier: { ...historicalFrontier, portfolioCoverage: {
        requested: 39, included: 39 - excludedCount, weightPercent: (39 - excludedCount) * 100 / 39, excluded
      } } }),
    });
    await expectPdfBlob(blob);
    const source = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    /* Sin portada ni hojas de tabla fijas: tantas hojas como el contenido pida, todas A4. */
    expect(source.match(/\/MediaBox \[0 0 595\.280029 841\.890015\]/g)).toHaveLength(extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).length);
    const texto = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ");
    expect(texto).toMatch(/Fuera de la frontera:/);
    /* La etiqueta del servidor no llega al papel: el cliente lee el motivo en sus palabras. */
    expect(texto).not.toContain("Sin serie histórica de precios");
    expect(texto).toContain("por falta de datos en este periodo.");
  }, 15_000);
});

/* La decisión 102 (05-11-2026) quitó del informe de cliente la frontera **estimada por composición**, y eso no ha cambiado: la que
   vuelve el 16-11-2026 por decisión de Óscar es la **histórica**, la de la simulación. Haya frontera o no, el papel dice lo que hay:
   la curva, o el motivo por el que no se puede dibujar. Se lee el TEXTO extraído de las páginas, no el código. La extracción pierde
   la ligadura «fi» (ver support/pdfText), así que se compara sin ella. */
describe("la frontera histórica, en el informe de cliente (texto extraído)", () => {
  const sinLigaduras = (text: string) => text.replace(/fi/g, "");
  const base = {
    report: informeDeClienteFixture,
    feasibility,
    totalCapital: 100000,
    clientName: "Cliente de ejemplo"
  };
  async function textoDe(input: Parameters<typeof createInformeDeClientePdfBlob>[0]): Promise<string> {
    const blob = await createInformeDeClientePdfBlob(input);
    return sinLigaduras(extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" "));
  }
  /* Nada de la estimada por composición, que sigue fuera desde la decisión 102: ni su tipo fijo del navegador, ni sus
     correlaciones supuestas, ni sus rótulos «Menor riesgo» / «Mayor riesgo» sin cifras en los ejes. */
  const NADA_DE_LA_ESTIMADA = /estimada por composición|tipo sin riesgo 1,9|correlaciones asumidas|Menor riesgo Mayor riesgo/;

  test("con frontera histórica, la curva con sus dos carteras y su explicación", async () => {
    const text = await textoDe({ ...base, analysis: horizonteDePrueba(portfolioBacktest, { frontier: historicalFrontier }) });
    expect(text).toContain(sinLigaduras("Frontera eficiente"));
    expect(text).toContain("Menor oscilación");
    expect(text).toContain("Mejor relación rentabilidad-riesgo");
    expect(text).toContain("con otro periodo sería otra");
    expect(text).not.toMatch(NADA_DE_LA_ESTIMADA);
    /* Las crisis siguen donde estaban: la frontera no las sustituye. */
    expect(text).toContain("Cómo se habría comportado esta composición en crisis pasadas");
  }, 20_000);

  test("sin frontera y con una sola posición medida de doce: la frase de la decisión 102, y nada de la estimada", async () => {
    const unaMedida = { ...portfolioBacktest, asset_ids: [informeDeClienteFixture.positions[0].asset_id] } as unknown as BacktestResponse;
    const text = await textoDe({ ...base, analysis: horizonteDePrueba(unaMedida, { frontierUnavailableReason: "La frontera necesita al menos dos activos." }) });
    expect(text).toContain("Hacen falta al menos dos posiciones medidas, y aquí se mide una.");
    expect(text).not.toMatch(NADA_DE_LA_ESTIMADA);
  }, 20_000);

  test("sin frontera con las doce medidas: el motivo que da el servidor, y no la frase de la posición única", async () => {
    const text = await textoDe({ ...base, analysis: horizonteDePrueba(portfolioBacktest, { frontierUnavailableReason: "No se ha podido resolver la frontera con estos datos." }) });
    expect(text).toContain("No se ha podido resolver la frontera con estos datos.");
    expect(text).not.toContain("Hacen falta al menos dos posiciones medidas");
    expect(text).not.toMatch(NADA_DE_LA_ESTIMADA);
  }, 20_000);
});
