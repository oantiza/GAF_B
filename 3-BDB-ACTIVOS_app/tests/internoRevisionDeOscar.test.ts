/**
 * Los cinco cambios que Óscar aprobó el 11-11-2026 sobre el informe completo de cartera: el cono centrado en el tipo sin riesgo, el aviso de una
 * referencia de otro riesgo, las retrocesiones parciales, las hojas casi vacías y los menores. Lo que se afirma es lo impreso.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { cargarSeriesDeReferencia } from "../src/adapters/seriesDeReferencia";
import { avisoDeRentaVariableDistinta, cualesSonLasAlertas, PUNTOS_DE_RENTA_VARIABLE_PARA_AVISAR, type InternalReportInput } from "../src/core/internalPortfolioReport";
import { buildMonteCarloProjection, centrarEnElTipoSinRiesgo } from "../src/core/monteCarloProjection";
import { buildReportOverlap } from "../src/core/reportOverlap";
import { buildInternalReportModelWithLabels, createInternalPortfolioReportPdfBlob } from "../src/reports/internalPortfolioReportPdf";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";
import { extractPdfPageTexts } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-06T12:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

type Clase = "EQUITY" | "FIXED_INCOME";
interface Opciones { n: number; clases?: (i: number) => Clase; acciones?: number; retroDe?: (i: number) => number | null; rf?: number | null; capital?: number; sinVector?: boolean; referencia?: boolean; benchmarkId?: string; frontera?: boolean; estatico?: boolean }

const idDe = (i: number) => `LU${String(1000000000 + i)}`;
const nombreDe = (i: number) => `Fondo internacional de prueba número ${i + 1} de nombre largo clase A acumulación EUR`;

async function entrada({ n, clases = () => "EQUITY", acciones = 0, retroDe = () => null, rf = 0.0275, capital = 250000, sinVector = false, referencia = true, benchmarkId = "equilibrado", frontera = false, estatico = false }: Opciones): Promise<InternalReportInput> {
  const ids = Array.from({ length: n }, (_, i) => idDe(i));
  const peso = Math.round(10000 / n) / 100;
  /* El simulador pide que sumen 100: lo que falta por el redondeo, en la primera. */
  const positions = ids.map((asset_id, i) => ({ asset_id, weight_percent: i === 0 ? Math.round((100 - peso * (n - 1)) * 100) / 100 : peso }));
  const esAccion = (i: number) => i >= n - acciones;
  const assets = ids.map((id, i) => ({
    asset_id: id, isin: id, display_name: nombreDe(i), instrument_type: esAccion(i) ? "STOCK" : "FUND", economic_asset_class: clases(i), currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    category: "RV Global Cap. Grande Growth", region: "Global",
    metrics: { risk_score: 3, risk_score_source: "SRI_KID", annualized_return_1y: 0.05, annualized_return_3y: 0.04, volatility_3y: 0.08, sharpe_3y: 0.4, metrics_method: "EXTRACTOR_MONTHLY_V2" },
    pms_exposure: sinVector ? undefined : clases(i) === "EQUITY" ? { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } : { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 },
    costs: esAccion(i) ? undefined : { ongoing_charge: 0.01, management_fee: 0.008 },
    holdings_summary: { has_holdings: !esAccion(i), positions_count: 40, top10_weight: 35, as_of_date: "2026-08-31" }
  })) as unknown as BdbAssetDetail[];
  const report = {
    portfolio_name: "Cartera de prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], weighted_metrics: {} },
    positions: positions.map((p, i) => ({ ...p, display_name: nombreDe(i), instrument_type: assets[i].instrument_type, economic_asset_class: clases(i), currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: assets[i].pms_exposure })),
    warnings: [], xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 100 }], by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] }, data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
  /* En secuencia, como las demás pruebas: a la vez, el import dinámico del backend se salta el mock. */
  const h3 = await fetchPortfolioHorizon(positions, "3Y");
  const h5 = await fetchPortfolioHorizon(positions, "5Y");
  const punto = (ret: number, vol: number) => ({ expectedReturn: ret, volatility: vol, sharpeRatio: 1, expectedReturnLabel: "", volatilityLabel: "", sharpeLabel: "", weights: ids.map((assetId) => ({ assetId, weight: 1 / n, weightLabel: "" })) });
  const curva = { kind: "historical", label: "Frontera", asOfDate: "2026-10-09", window: "3Y", frontier: Array.from({ length: 12 }, (_, i) => ({ volatility: 0.03 + i * 0.008, expectedReturn: 0.025 + i * 0.004, sharpeRatio: 1 })), current: punto(0.05, 0.07), minVolatility: punto(0.026, 0.03), maxSharpe: punto(0.055, 0.06), excluded: [] };
  const conTipo = (h: typeof h3, tipo: number | null) => ({ ...h, ...(frontera ? { frontier: curva as unknown as NonNullable<typeof h3["frontier"]> } : {}), backtest: { ...h.backtest, metrics: { ...h.backtest.metrics, rf_rate: tipo as number }, risk_free: { ...h.backtest.risk_free!, risk_free_rate_policy: estatico ? "STATIC_FALLBACK" as const : "WINDOW_AVERAGE" as const } } });
  const retro = new Map(ids.flatMap((id, i) => { const pct = retroDe(i); return pct === null ? [] : [[id, { isin: id, retro_pct: pct, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord] as const]; }));
  return {
    report, assets, positions, totalCapital: capital, benchmarkId, referencia: referencia ? await cargarSeriesDeReferencia() : null,
    horizons: { "3Y": conTipo(h3, rf), "5Y": conTipo(h5, rf === 0.0275 ? 0.0212 : rf) }, horizonErrors: {}, lookThrough: null, overlap: null,
    retro: { status: "ok", records: retro }, feasibility: null, generatedAt: "2026-11-11T12:00:00Z", includeAssetSheets: true, improvement: null
  };
}

const paginasDe = async (e: InternalReportInput) => extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(e)).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));
const modeloDe = buildInternalReportModelWithLabels;

describe("1. El cono, centrado en el tipo sin riesgo", () => {
  /* Rendimientos logarítmicos que alternan +a y −a: media 0 y desviación muestral conocida. */
  const a = 0.01;
  const serie = Array.from({ length: 261 }, (_, i) => ({ date: `2021-${String(i).padStart(3, "0")}`, value: 100 * Math.exp(i % 2 ? a : 0) }));

  test("resultado conocido: P50 = último × (1 + tipo)^años, y P5 y P95 guardan su proporción con él", () => {
    const original = buildMonteCarloProjection(serie, "WEEKLY", 5)!;
    const centrada = centrarEnElTipoSinRiesgo(original, 0.03)!;
    const ultimo = centrada.points.at(-1)!;
    const n = 260;
    const sigma = Math.sqrt((n * a ** 2) / (n - 1));
    expect(ultimo.p50).toBeCloseTo(original.lastValue * 1.03 ** 5, 8);
    expect(ultimo.p5 / ultimo.p50).toBeCloseTo(Math.exp(-1.645 * sigma * Math.sqrt(260)), 10);
    expect(ultimo.p95 / ultimo.p50).toBeCloseTo(Math.exp(1.645 * sigma * Math.sqrt(260)), 10);
    /* A mitad de camino, también; y el primer punto es el capital. */
    expect(centrada.points[130].p50).toBeCloseTo(original.lastValue * 1.03 ** 2.5, 8);
    expect(centrada.points[0].p50).toBeCloseTo(original.lastValue, 10);
  });

  test("las cifras de la revisión: 250.000 € a 3 y 5 años, con las proporciones de hoy", () => {
    const conProporcion = (anos: number, hoy: { p5: number; p50: number; p95: number }) => ({ lastValue: 250000, stepsPerYear: 52, horizonYears: anos, points: [{ step: anos * 52, p25: hoy.p50, p75: hoy.p50, ...hoy }] });
    /* El P5 de hoy es el de la muestra; P50 y P95, cualesquiera con la proporción que dicta la dispersión. */
    const a3 = centrarEnElTipoSinRiesgo(conProporcion(3, { p5: 305387, p50: 305387 / (180607 / 271197), p95: (305387 / (180607 / 271197)) * (407226 / 271197) }), 0.0275)!.points[0];
    expect(a3.p50).toBeCloseTo(250000 * 1.0275 ** 3, 6);
    expect(Math.round(a3.p50)).toBe(271197);
    expect(Math.abs(a3.p5 - 180607)).toBeLessThan(2);
    expect(Math.abs(a3.p95 - 407226)).toBeLessThan(2);
    expect(Math.abs(250000 * 1.0212 ** 5 - 277648)).toBeLessThan(2);
  });

  test("lo que no es este informe sigue dando lo mismo: centrar no toca la proyección de la que parte", () => {
    const original = buildMonteCarloProjection(serie, "WEEKLY", 3)!;
    const copia = JSON.parse(JSON.stringify(original));
    centrarEnElTipoSinRiesgo(original, 0.05);
    expect(original).toEqual(copia);
    expect(buildMonteCarloProjection(serie, "WEEKLY", 3)).toEqual(copia);
  });

  test.each([[null], [undefined], [Number.NaN], [-1]])("sin un tipo válido (%s) no hay cono", (tipo) => {
    expect(centrarEnElTipoSinRiesgo(buildMonteCarloProjection(serie, "WEEKLY", 3)!, tipo)).toBeNull();
  });

  test("un tipo cero es un tipo: la mediana se queda en el capital", () => {
    expect(centrarEnElTipoSinRiesgo(buildMonteCarloProjection(serie, "WEEKLY", 3)!, 0)!.points.at(-1)!.p50).toBeCloseTo(100 * Math.exp(a * 0), 8);
  });

  test("en papel: el centro con su cifra, lo que enseña y lo que no es; nada de la deriva", async () => {
    const texto = (await paginasDe(await entrada({ n: 4 }))).join(" ");
    expect(texto).toContain("Percentil 50: 271.197 €");
    expect(texto).toContain("Percentil 50: 277.648 €");
    expect(texto).toContain("Centrado en el tipo sin riesgo de cada ventana (2,75 % a 3 años y 2,12 % a 5 años)");
    expect(texto).toContain("Solo enseña la dispersión medida en el periodo; no es una simulación ni una previsión.");
    expect(texto).toContain("la mediana crece al tipo sin riesgo de la ventana");
    expect(texto).not.toMatch(/se repite|repiten la deriva/);
  }, 60000);

  test("si el BCE no responde, se centra en el tipo estático, y lo dice como la tabla de 6.2", async () => {
    const texto = (await paginasDe(await entrada({ n: 4, rf: 0.0193, estatico: true }))).join(" ");
    expect(texto).toContain("(1,93 %, estático, a 3 años y 1,93 %, estático, a 5 años)");
    expect(texto).toContain("Percentil 50: 264.");
  }, 60000);

  test("basta el aviso del servidor, sin la política, para decir que el tipo es el estático (INF-6)", async () => {
    const e = await entrada({ n: 4, rf: 0.0193, estatico: false });
    for (const ventana of ["3Y", "5Y"] as const) {
      const backtest = e.horizons[ventana].backtest;
      expect(backtest.risk_free!.risk_free_rate_policy).toBe("WINDOW_AVERAGE");
      backtest.warnings = [...backtest.warnings, "RISK_FREE_RATE_STATIC_FALLBACK"];
    }
    const texto = (await paginasDe(e)).join(" ");
    expect(texto).toContain("(1,93 %, estático, a 3 años y 1,93 %, estático, a 5 años)");
    /* Y en la tabla de 6.2 no se rotula «€STR». */
    expect(texto).toContain("1,93 %, estático");
    expect(texto).not.toContain("1,93 %, €STR");
  }, 60000);

  test("sin el tipo de la ventana no se pinta, lo dice, y el índice no lo promete", async () => {
    const texto = (await paginasDe(await entrada({ n: 4, rf: null }))).join(" ");
    expect(texto).toContain("Cono estadístico a 3 años no disponible: falta el tipo sin riesgo de esa ventana.");
    expect(texto).toContain("Cono estadístico a 5 años no disponible: falta el tipo sin riesgo de esa ventana.");
    expect(texto).not.toContain("Percentil 50:");
    expect(texto).not.toContain("Centrado en el tipo sin riesgo");
    expect(texto).not.toContain("estrés y cono estadístico");
  }, 60000);
});

describe("2. Una referencia de otro riesgo", () => {
  test("el umbral: 20 puntos exactos no avisa, y con algo más sí; en los dos sentidos y sin decimales", () => {
    expect(PUNTOS_DE_RENTA_VARIABLE_PARA_AVISAR).toBe(20);
    expect(avisoDeRentaVariableDistinta(70, 50)).toBeNull();
    expect(avisoDeRentaVariableDistinta(30, 50)).toBeNull();
    expect(avisoDeRentaVariableDistinta(70.00000000001, 50)).toBeNull();
    expect(avisoDeRentaVariableDistinta(70.5, 50)).toContain("un 70,5\u00a0% de renta variable y la referencia, un 50,0\u00a0%");
    expect(avisoDeRentaVariableDistinta(98.2, 50)).toBe("La cartera tiene un 98,2\u00a0% de renta variable y la referencia, un 50,0\u00a0%: estas cifras comparan riesgos distintos.");
    expect(avisoDeRentaVariableDistinta(10, 50)).toContain("un 10,0\u00a0% de renta variable");
    expect(avisoDeRentaVariableDistinta(null, 50)).toBeNull();
    expect(avisoDeRentaVariableDistinta(90, undefined)).toBeNull();
  });

  const FRASE = "La cartera tiene un 100,0\u00a0% de renta variable y la referencia, un 50,0\u00a0%: estas cifras comparan riesgos distintos.";
  const FRASE_EN_PAPEL = FRASE.replace(/\u00a0/g, " ");

  test("por encima del umbral: un punto a revisar medio, junto a la tabla de 6.2 y en la nota del resumen", async () => {
    const e = await entrada({ n: 4 });
    expect(modeloDe(e).reviewPoints).toContainEqual({ severity: "media", area: "Referencia", text: FRASE });
    const paginas = await paginasDe(e);
    expect(paginas.filter((p) => p.includes("1 · Resumen ejecutivo") && p.includes(FRASE_EN_PAPEL)).length).toBeGreaterThanOrEqual(1);
    expect(paginas.find((p) => p.includes("Frente a la referencia Beta"))).toContain(FRASE_EN_PAPEL);
  }, 60000);

  test("en el umbral: tres de cuatro fondos en bolsa frente a una referencia del 50 % pasan de 20 y, frente al 75 %, no avisa", async () => {
    const clases = (i: number): Clase => (i < 3 ? "EQUITY" : "FIXED_INCOME");
    expect(modeloDe(await entrada({ n: 4, clases, benchmarkId: "dinamico" })).avisoDeRiesgoDistinto).toBeNull();
    expect(modeloDe(await entrada({ n: 4, clases, benchmarkId: "moderado" })).avisoDeRiesgoDistinto).toContain("un 75,0\u00a0% de renta variable y la referencia, un 25,0\u00a0%");
  });

  test("sin referencia, o sin saber qué hay dentro de los fondos, no se avisa de nada", async () => {
    const sinReferencia = modeloDe(await entrada({ n: 4, referencia: false }));
    expect(sinReferencia.avisoDeRiesgoDistinto).toBeNull();
    expect(sinReferencia.reviewPoints.map((p) => p.text).join(" ")).not.toContain("riesgos distintos");
    expect(modeloDe(await entrada({ n: 4, sinVector: true })).avisoDeRiesgoDistinto).toBeNull();
  });
});

/* Auditoría integral del 16-11-2026, hallazgos INF-2 e INF-3. Con un fondo sin coste corriente, la media y el coste anual son de
   la parte con dato. La frase de lectura lo decía; el indicador del resumen y la fila de total, no, y junto a «100 %» de peso
   se leían como los de toda la cartera. */
describe("Costes con un fondo sin dato: la media y el coste anual dicen que son parciales", () => {
  test("cuatro fondos al 25 %, uno sin coste: 1,00 % sobre el 75 % del peso y 1.875 € al año, marcados como parciales", async () => {
    const e = await entrada({ n: 4 });
    e.assets[1] = { ...e.assets[1], costs: undefined };
    const m = modeloDe(e);
    expect(m.costs.missing).toBe(1);
    expect(m.costs.terCoverage).toBeCloseTo(0.75, 12);
    /* 1 % sobre los tres fondos con dato, que son 187.500 € de los 250.000: 1.875 € al año. */
    expect(m.costs.annualCostEur).toBeCloseTo(1875, 6);
    const paginas = await paginasDe(e);
    const costes = paginas.find((p) => p.includes("Vigencia retro."))!;
    expect(costes).toMatch(/Total 100,0 % 250\.000,00 € 1,00 % parcial 1\.875,00 € parcial/);
    expect(costes).toContain("El coste corriente y el coste anual son parciales, no de toda la cartera: 1,00 % medio sobre el 75 % del peso con dato; el resto falta.");
    const resumen = paginas.filter((p) => p.includes("1 · Resumen ejecutivo")).join(" ");
    expect(resumen).toMatch(/Coste corriente medio 1,00 % Parcial: sobre el 75 % del peso con dato/);
    expect(resumen).toMatch(/Coste anual estimado 1\.875 € Parcial: solo el 75 % del peso con dato/);
  }, 60000);

  test("con el coste de todos, nada se marca: la media es la de la cartera", async () => {
    const paginas = await paginasDe(await entrada({ n: 4 }));
    const costes = paginas.find((p) => p.includes("Vigencia retro."))!;
    expect(costes).toMatch(/Total 100,0 % 250\.000,00 € 1,00 % 2\.500,00 €/);
    expect(costes).not.toContain("El coste corriente y el coste anual son parciales");
    expect(paginas.filter((p) => p.includes("1 · Resumen ejecutivo")).join(" ")).toMatch(/Coste corriente medio 1,00 % Cobertura 100 % del peso/);
  }, 60000);
});

describe("3. Las retrocesiones", () => {
  /* 4 posiciones al 25 %: una con retrocesión del 1 %. Sobre la cartera, un 0,25 %: 625 € de 250.000. */
  const parcial = { n: 4, retroDe: (i: number) => (i === 0 ? 1 : null) };

  test("ya no se resta lo que recibe quien distribuye de lo que paga el cliente", async () => {
    expect((await paginasDe(await entrada(parcial))).join(" ")).not.toMatch(/neto frente al coste/);
    expect(readFileSync("src/reports/internalPortfolioReportPdf.tsx", "utf8")).not.toContain("const net =");
  }, 60000);

  test("cobertura parcial: dice que lo es, sobre qué, y lo que supone en toda la cartera", async () => {
    const e = await entrada(parcial);
    const m = modeloDe(e);
    expect(m.retro.parcial).toBe(true);
    expect(m.retro.sobreLaCartera).toBeCloseTo(0.0025, 12);
    const paginas = await paginasDe(e);
    const costes = paginas.find((p) => p.includes("Vigencia retro."))!;
    /* 14-11-2026, plantilla única: los importes de la tabla, con dos decimales del formato común (antes «250.000 €», «2.500 €» y «625 €»). */
    expect(costes).toMatch(/Total 100,0 % 250\.000,00 € 1,00 % 2\.500,00 € 1,00 % parcial 625,00 € parcial/);
    expect(costes).toContain("Retrocesión e ingreso son parciales, no de toda la cartera: 1,00 % medio sobre el 25 % del peso con dato; 625 €, un 0,25 % de toda la cartera.");
    expect(costes).toContain("Retrocesión estimada, parcial: 625 € al año (1,00 % medio sobre el 25 % del peso con dato; un 0,25 % de toda la cartera)");
    const resumen = paginas.filter((p) => p.includes("1 · Resumen ejecutivo")).join(" ");
    expect(resumen).toContain("625 € de retrocesión anual estimada (parcial: 1,00 % medio sobre el 25 % del peso con dato; un 0,25 % de toda la cartera)");
    expect(resumen).toMatch(/Retrocesión media 1,00 % Parcial: sobre el 25 % del peso con dato; un 0,25 % de toda la cartera/);
    expect(resumen).toMatch(/Ingreso anual estimado 625 € Parcial: sobre el 25 %/);
  }, 60000);

  test("sin ninguna retrocesión registrada el ingreso es que falta el dato, no 0 €", async () => {
    const costes = (await paginasDe(await entrada({ n: 4 }))).find((p) => p.includes("Vigencia retro."))!;
    /* 14-11-2026, plantilla única: lo que falta se dice «Falta el dato», y no «N/D»; los importes de la tabla, con dos decimales. */
    expect(costes).toMatch(/Total 100,0 % 250\.000,00 € 1,00 % 2\.500,00 € Falta el dato Falta el dato/);
    expect(costes).not.toMatch(/Retrocesión estimada/);
  }, 60000);

  test("con acciones, la parte es la de fondos y ETF", async () => {
    const texto = (await paginasDe(await entrada({ n: 4, acciones: 1, retroDe: (i) => (i === 0 ? 0.9 : null) }))).join(" ");
    expect(texto).toContain("0,90 % medio sobre el 33 % del peso de fondos y ETF");
  }, 60000);

  test("cobertura completa: sin la marca de parcial", async () => {
    const e = await entrada({ n: 4, retroDe: () => 1 });
    expect(modeloDe(e).retro.parcial).toBe(false);
    const texto = (await paginasDe(e)).join(" ");
    expect(texto).not.toMatch(/[Pp]arcial/);
    expect(texto).toMatch(/1,00 % 2\.500,00 € 1,00 % 2\.500,00 €/);
  }, 60000);
});

describe("4. Ninguna hoja con una fila o una nota", () => {
  const seccion = (paginas: string[], rotulo: string) => paginas.filter((p) => p.includes(rotulo));
  const cuantasPosiciones = (pagina: string) => (pagina.match(/LU1000000\d{3}/g) ?? []).length;
  const nombresEn = (pagina: string) => (pagina.match(/Fondo internacional de prueba número/g) ?? []).length;

  test.each([10, 12, 28, 37, 38, 40, 41])("con %i posiciones, la última hoja de Posiciones, Costes y Calidad lleva varias filas, y están todas", async (n) => {
    const paginas = await paginasDe(await entrada({ n, retroDe: (i) => (i % 3 === 0 ? 0.8 : null) }));
    for (const rotulo of ["2 · Posiciones", "9 · Costes y comercial", "10 · Calidad y trazabilidad"]) {
      const hojas = seccion(paginas, rotulo);
      expect(hojas.reduce((suma, h) => suma + nombresEn(h.replace(/.*?(?=#)/, "")), 0), rotulo).toBeGreaterThanOrEqual(n);
      if (hojas.length > 1) expect(nombresEn(hojas.at(-1)!), `${rotulo}: última hoja`).toBeGreaterThanOrEqual(Math.min(4, Math.ceil(n / 3)));
    }
    expect(cuantasPosiciones(seccion(paginas, "2 · Posiciones").join(" "))).toBeGreaterThanOrEqual(n);
  }, 120000);

  test("la nota de lo parcial va con la cola de la tabla, y los puntos a revisar no dejan su leyenda sola", async () => {
    const paginas = await paginasDe(await entrada({ n: 40, retroDe: (i) => (i % 3 === 0 ? 0.8 : null) }));
    const conLaNota = paginas.find((p) => p.includes("Retrocesión e ingreso son parciales"))!;
    expect(nombresEn(conLaNota)).toBeGreaterThanOrEqual(4);
    const conLaLeyenda = paginas.find((p) => p.includes("Alta: resolver antes de usar"))!;
    expect(conLaLeyenda).toMatch(/(Alta|Media|Info) \S+/);
  }, 120000);

  test("los pares de correlación y lo mirado de cada fondo van antes que su matriz, que es la que salta si no cabe", () => {
    const fuente = readFileSync("src/reports/internalPortfolioReportPdf.tsx", "utf8");
    expect(fuente.indexOf("Pares que más se mueven juntos")).toBeLessThan(fuente.indexOf("Matriz de correlación"));
    expect(fuente.indexOf("Qué se ha mirado de cada fondo")).toBeLessThan(fuente.indexOf("Matriz de solapamiento"));
  });

  test("no quedan saltos forzados tras la tabla del resumen, la nota de rentabilidad ni la del riesgo", () => {
    const fuente = readFileSync("src/reports/internalPortfolioReportPdf.tsx", "utf8");
    expect(fuente).not.toMatch(/<View break>\s*<H2>Negocio y estructura/);
    expect(fuente).not.toMatch(/break>\s*<H2>Caída desde el último máximo/);
    expect(fuente).not.toContain("break={ventanas.length === m.horizons.length}");
  });

  test("con 37 posiciones los pesos de la frontera siguen en otra hoja, enteros, en vez de aplastarse sobre lo de arriba", async () => {
    const paginas = await paginasDe(await entrada({ n: 37, frontera: true }));
    const hojas = seccion(paginas, "8.1 · Frontera");
    expect(hojas.length).toBeGreaterThan(1);
    expect(hojas.reduce((suma, h) => suma + nombresEn(h), 0)).toBeGreaterThanOrEqual(37);
  }, 120000);
});

describe("5. Cambios menores", () => {
  test("en el papel, referencia: ni una vez «benchmark»", async () => {
    const paginas = await paginasDe(await entrada({ n: 6, retroDe: (i) => (i ? null : 1) }));
    const texto = paginas.join(" ");
    expect(texto).not.toMatch(/benchmark/i);
    for (const dentro of ["Beta frente a la referencia", "Frente a la referencia", "Referencia 3 años", "Medidas frente a la referencia", "Cartera de referencia Equilibrado"]) expect(texto).toContain(dentro);
    expect(paginas[0]).toContain("Cartera de referencia");
  }, 60000);

  test("los puntos a revisar tampoco lo dicen, y sin series lo dicen con su palabra", async () => {
    const puntos = modeloDe(await entrada({ n: 4, referencia: false })).reviewPoints;
    expect(puntos.map((p) => `${p.area} ${p.text}`).join(" ")).not.toMatch(/benchmark/i);
    expect(puntos.find((p) => p.area === "Referencia")?.text).toContain("Cartera de referencia no disponible");
  });

  test("los pesos de las posiciones van con un decimal en Posiciones, Costes y el anexo", async () => {
    const paginas = await paginasDe(await entrada({ n: 4 }));
    const posiciones = paginas.find((p) => p.includes("2 · Posiciones"))!;
    expect(posiciones).toContain("25,0 %");
    expect(posiciones).not.toContain("25,00 %");
    expect(posiciones).toMatch(/Total 100,0 %/);
    expect(paginas.find((p) => p.includes("Vigencia retro."))).toMatch(/Total 100,0 %/);
    expect(paginas.find((p) => p.includes("A · Anexo"))).toContain("Peso 25,0 %");
  }, 60000);

  test("«No aplica» cabe en su columna de Riesgo: el ancho lo aparta de la que no daba", () => {
    /* 14-11-2026, plantilla única: la columna se escribe como las de la tabla con cola, con su ancho en puntos. */
    const [, ancho] = /titulo: "Riesgo", ancho: (\d+), cifra: true, celda: riesgoEnLaTabla/.exec(readFileSync("src/reports/internalPortfolioReportPdf.tsx", "utf8")) ?? [];
    expect(Number(ancho)).toBeGreaterThanOrEqual(44);
  });

  test("en la matriz de solapamiento, una acción no entra: va debajo, en su línea, y la nota ya no habla de casillas grises", async () => {
    const e = await entrada({ n: 3, acciones: 1 });
    const fondos = e.positions.map((p, i) => ({ ...p, display_name: nombreDe(i), instrument_type: (i === 2 ? "STOCK" : "FUND") as "FUND" }));
    const lineas = (id: string) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31", holdings: [{ name: "X", isin: "X", weight_pct: 60 }, { name: "Y", isin: "Y", weight_pct: 40 }] });
    const overlap = buildReportOverlap(fondos, new Map([[idDe(0), lineas(idDe(0))], [idDe(1), lineas(idDe(1))]]));
    const paginas = await paginasDe({ ...e, overlap });
    const pagina = paginas.find((p) => p.includes("Matriz de solapamiento"))!;
    expect(pagina).toContain("Matriz de solapamiento · 2 fondos de las 3 mayores posiciones");
    expect(pagina).toContain(`Fuera de la matriz: Acción en directo, que no tiene cartera propia: ${nombreDe(2)}.`);
    expect(pagina).not.toContain("Casilla gris");
    /* Las tres de la acción en «Qué se ha mirado», y ninguna en la matriz. */
    expect((pagina.match(/No aplica/g) ?? []).length).toBe(3);
    /* Las mismas hojas que con la matriz de antes, medido el 11-11-2026 con el código anterior (22). Con la plantilla única, sin hoja de
       portada, son 21: medido el 14-11-2026. Con el aspecto de los informes de antes (Roboto Flex, más estrecha, y los márgenes de antes),
       20: medido el mismo día. */
    expect(paginas).toHaveLength(20);
  }, 60000);

  /* Óscar, 11-11-2026: la matriz solo lleva los fondos que se pueden medir. Seis fondos, dos de ellos con solo diez líneas: antes, 9 de 15 pares en N/D. */
  test("en la matriz de solapamiento solo entran los fondos medibles; los cortos van debajo con lo que publican, y la lectura sigue contando los pares sin medir", async () => {
    const e = await entrada({ n: 6 });
    const fondos = e.positions.map((p, i) => ({ ...p, display_name: nombreDe(i), instrument_type: "FUND" as const }));
    const lineas = (id: string, peso: number) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31", holdings: [{ name: "X", isin: "X", weight_pct: peso * 0.6 }, { name: `Y${id}`, isin: `Y${id}`, weight_pct: peso * 0.4 }] });
    const pesos = [100, 100, 100, 100, 27, 42];
    const overlap = buildReportOverlap(fondos, new Map(pesos.map((peso, i) => [idDe(i), lineas(idDe(i), peso)])));
    const paginas = await paginasDe({ ...e, overlap });
    const texto = paginas.join(" ");
    const pagina = paginas.find((p) => p.includes("Matriz de solapamiento"))!;
    expect(pagina).toContain("Matriz de solapamiento · 4 fondos de las 6 mayores posiciones");
    expect(pagina).toContain(`Fuera de la matriz: ${nombreDe(4)}: publica el 27,0 % de su cartera. ${nombreDe(5)}: publica el 42,0 % de su cartera.`);
    expect(pagina).toContain("Solo entran los fondos de los que se ha recibido al menos la mitad de su cartera.");
    /* Ni un N/D en la matriz: los de la página son los de «Qué se ha mirado», si cae en la misma. */
    const matriz = pagina.slice(pagina.indexOf("Matriz de solapamiento"), pagina.indexOf("Fuera de la matriz"));
    expect(matriz).not.toContain("N/D");
    expect(matriz).toContain("al menos 60,0");
    /* Ninguna cifra cambia: la lectura y los puntos a revisar cuentan los mismos pares. */
    expect(texto).toContain("9 de 15 pares quedan sin medir");
    expect(modeloDe({ ...e, overlap }).overlapPairs).toMatchObject({ measured: 6, unmeasured: 9 });
    /* 22 desde el 14-11-2026, con el aspecto de los informes de antes (antes, 23): la letra es más estrecha. */
    expect(paginas).toHaveLength(22);
  }, 60000);

  test("con un solo fondo medible no hay matriz: lo dice una frase, y debajo lo que no entra", async () => {
    const e = await entrada({ n: 4, acciones: 1 });
    const fondos = e.positions.map((p, i) => ({ ...p, display_name: nombreDe(i), instrument_type: (i === 3 ? "STOCK" : "FUND") as "FUND" }));
    const lineas = (id: string, peso: number) => ({ asset_id: id, storage_mode: "SINGLE_DOCUMENT" as const, as_of_date: "2026-08-31", holdings: [{ name: "X", isin: "X", weight_pct: peso }] });
    const overlap = buildReportOverlap(fondos, new Map([[idDe(0), lineas(idDe(0), 100)], [idDe(1), lineas(idDe(1), 30)]]));
    const paginas = await paginasDe({ ...e, overlap });
    const texto = paginas.join(" ");
    expect(texto).not.toContain("Matriz de solapamiento");
    expect(texto).toContain("No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y solo hay uno.");
    expect(texto).toContain(`Fuera de la matriz: ${nombreDe(1)}: publica el 30,0 % de su cartera. ${nombreDe(2)}: no publica su cartera. Acción en directo, que no tiene cartera propia: ${nombreDe(3)}.`);
    expect(texto).toContain("3 de 3 pares quedan sin medir");
    /* 21 desde el 14-11-2026, con el aspecto de los informes de antes (antes, 22): la letra es más estrecha. */
    expect(paginas).toHaveLength(21);
  }, 60000);

  test("«Alertas: 1» dice cuál es, y la alerta entra en los puntos a revisar", async () => {
    const e = await entrada({ n: 4 });
    const m = modeloDe(e);
    expect(m.reviewPoints).toContainEqual({ severity: "media", area: "Umbrales", text: "Diversificación: 1 clase · 4 posiciones; vigilar con menos de 2 clases." });
    expect((await paginasDe(e)).join(" ")).toMatch(/Alertas 1 Diversi.*?cación: 1 clase · 4 posiciones\. 1 alerta en lo medido/);
  }, 60000);

  test("con varias alertas nombra la primera y cuenta las demás; sin ninguna, nada", () => {
    const fila = (rotulo: string, cifra: string) => ({ rotulo, cifra, revisar: true, cuentaEnElTitular: true });
    const alerta = { clave: "a", palabra: "Crítico" as const, texto: "Un fondo concentra 45 % de la cartera.", umbral: "" };
    expect(cualesSonLasAlertas({ alertas: [alerta], filas: [fila("Restricciones", "1 aviso")] })).toBe("Un fondo concentra 45 % de la cartera; y 1 más, en los puntos a revisar");
    expect(cualesSonLasAlertas({ alertas: [], filas: [{ rotulo: "Volatilidad", revisar: false }] })).toBeNull();
  });

  test("unas restricciones bloqueadas son un punto de severidad alta, con su detalle", async () => {
    const e = { ...(await entrada({ n: 4, clases: (i) => (i ? "EQUITY" : "FIXED_INCOME") })), feasibility: { status: "BLOCKED", blocking_issues: [{ message: "Un activo no es invertible." }], warnings: [], infos: [] } as unknown as InternalReportInput["feasibility"] };
    expect(modeloDe(e).reviewPoints).toContainEqual({ severity: "alta", area: "Umbrales", text: "Restricciones: 1 bloqueo. Un activo no es invertible." });
  });
});
