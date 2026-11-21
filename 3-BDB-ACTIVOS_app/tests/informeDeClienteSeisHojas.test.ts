/**
 * El informe de cliente en seis hojas (decisión de Óscar del 10-11-2026, «Sí, con las cinco»). Cada prueba lee el TEXTO del PDF generado,
 * no el código: la frontera no sale; el solapamiento va en frases y con una matriz de los fondos medibles, reducida a los pares más altos
 * cuando la completa no cabe bajo las crisis; ningún coste, y la rentabilidad por dividendo de cada acción en la composición (A-143); la
 * hoja de cifras solo con el tipo sin riesgo debajo; la frase del riesgo de la referencia en los dos sentidos y en sus dos límites; sin
 * capital no hay importe ni valoración; el anexo en una línea al pie de la guía; y el perfil y el horizonte solo si llegan.
 *
 * Desde la plantilla única (paso 9 del rediseño, 14-11-2026) no hay hojas de alto fijo: las hojas fluyen y las secciones se numeran del 01
 * al 09 (10, el histórico ampliado). Las pruebas leen cada sección por su título (`support/seccionesDelInformeDeCliente`), no «la hoja 3»;
 * lo que afirman de las cifras y de lo que se enseña no cambia.
 *
 * Desde el 15-11-2026 (Óscar: en los informes, las métricas nunca van en la portada) las cifras que responden tienen su sección, «Cifras
 * de la cartera», tras el reparto y delante de la geografía, como en la hoja 03 del papel de antes; la portada solo presenta.
 *
 * Con `BDB_WRITE_PDF_PREVIEW=true` deja en `output/pdf/` los papeles de muestra (3, 10 y 25 posiciones; con y sin capital; con y sin
 * posiciones fuera; solo acciones) para mirarlos en imagen.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { referenceProfilesForDates } from "../src/core/benchmarkProfiles";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import { buildReportOverlap, FUERA_DE_LA_MATRIZ, loadReportOverlap, solapamientoEnFrases, type ReportOverlap } from "../src/core/reportOverlap";
import {
  COCIENTE_DE_RIESGO_MAXIMO,
  COCIENTE_DE_RIESGO_MINIMO,
  createInformeDeClientePdfBlob,
  fraseDelRiesgoDeLaReferencia,
  informeDeClienteMetricRows,
  lineaDelAlcance,
  nombreEnLineas,
  pasoDeLaMatriz,
  RAMPA_DE_LA_MATRIZ,
  rentabilidadPorDividendoDe,
  tintaSobreElPaso,
  type InformeDeClientePdfInput
} from "../src/reports/informeDeClientePdf";
import { prepararElCono } from "../src/reports/informeDeCliente/datos";
import type { BdbAssetDetail, BdbAssetHoldings, BdbPortfolioReport } from "../src/types/bdbAssets";
import { extractPdfPageTexts, extractPdfSizedRuns, extractPdfTextBaselines, lineasCon, lineasHuerfanasDeImpuestos } from "./support/pdfText";
import { SERIES_HASTA_20260928 } from "./support/referenciaDePrueba";
import { numeroDe, numerosDeSeccion, numerosSeguidos, seccion } from "./support/seccionesDelInformeDeCliente";
import { MEDIDAS } from "../src/reports/plantilla";

/* Los números esperados salen de `numerosSeguidos`: nueve secciones de siempre (las cifras tienen la suya desde el 15-11-2026), una más
   con el cono estadístico, que solo sale con cifra de la cartera, y otra con el histórico ampliado. */

/* ---------- Una cartera de prueba, con nombres largos y cortos, fondos, ETF y acciones, y dos divisas. ---------- */

const NOMBRES = [
  "Fondo internacional de renta fija flexible con cobertura en euros clase de acumulación",
  "Fondo de renta variable europea",
  "ETF de bolsa mundial de gran capitalización",
  "Fondo de renta fija corporativa a corto plazo",
  "Fondo mixto moderado global",
  "Fondo de renta variable de Estados Unidos con cobertura de divisa",
  "Fondo monetario en euros",
  "ETF de deuda pública de la zona euro",
  "Fondo de renta variable de mercados emergentes",
  "Fondo de renta variable temática de salud",
  "Fondo de renta fija de alto rendimiento",
  "ETF de oro físico",
  "Fondo de renta variable japonesa"
];
const CATEGORIAS = ["RF Flexible EUR", "RV Europa Cap. Grande", "RV Global Cap. Grande", "RF Corto Plazo EUR", "Mixtos Moderados EUR", "RV EEUU Cap. Grande", "Monetarios EUR", "RF Deuda Pública EUR"];

interface Opciones {
  acciones?: number;
  soloAcciones?: boolean;
  /** Cuántas posiciones no entran en la simulación, las últimas. */
  fuera?: number;
  /** Acciones sin rentabilidad por dividendo en su ficha. */
  sinDividendo?: string[];
  categorias?: number;
  /** Nombres de las posiciones, en orden, en vez de los de prueba. */
  nombres?: string[];
  /** Nombres de las categorías, en vez de las de prueba. */
  nombresDeCategoria?: string[];
  /** Cada posición fuera, con un motivo distinto: la nota de cobertura los dice uno a uno y se alarga. */
  motivosDistintos?: boolean;
}

function cartera(n: number, opciones: Opciones = {}) {
  const pesos = Array.from({ length: n }, (_, i) => n - i);
  const total = pesos.reduce((s, p) => s + p, 0);
  const filas = pesos.map((peso, i) => {
    const accion = opciones.soloAcciones || i >= n - (opciones.acciones ?? 0);
    const id = accion ? `ES00${String(1000000 + i)}0` : `LU0${String(900000000 + i)}`;
    return {
      asset_id: id,
      display_name: opciones.nombres?.[i] ?? (accion ? `Acción española ${i + 1} S.A.` : `${NOMBRES[i % NOMBRES.length]}${i >= NOMBRES.length ? ` ${i + 1}` : ""}`),
      instrument_type: accion ? "STOCK" : i % 4 === 2 ? "ETF" : "FUND",
      economic_asset_class: accion ? "EQUITY" : i % 2 ? "EQUITY" : "FIXED_INCOME",
      currency: i % 3 === 2 ? "USD" : "EUR",
      weight_percent: (peso / total) * 100
    };
  });
  const nCategorias = opciones.nombresDeCategoria?.length ?? opciones.categorias ?? Math.min(n, CATEGORIAS.length);
  const porCategoria = Array.from({ length: nCategorias }, (_, i) => ({
    key: opciones.nombresDeCategoria?.[i] ?? (i < CATEGORIAS.length ? CATEGORIAS[i] : `Categoría del proveedor número ${i + 1}`),
    weight_percent: 100 / nCategorias
  }));
  const report = {
    portfolio_name: "Prueba",
    mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: {
      source: "BBDD_STATIC_EXPORT_SAMPLE", position_count: n, total_weight_percent: 100, validation_status: "VALID", is_valid: true,
      by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 55 }, { key: "FIXED_INCOME", weight_percent: 45 }],
      non_investable_assets: [], warnings: [], weighted_metrics: { preview_boundary: { mode: "PREVIEW_ONLY", source_label: "test", limitations: [] } }
    },
    positions: filas.map((fila) => ({
      ...fila, coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [],
      pms_exposure: fila.economic_asset_class === "EQUITY" ? { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } : { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 }
    })),
    warnings: [],
    xray: {
      by_region: [{ key: "europe", weight_percent: 50 }, { key: "united_states", weight_percent: 35 }, { key: "japan", weight_percent: 15 }],
      by_category: opciones.soloAcciones ? [] : porCategoria,
      pms_exposure_percent: { equity: 55, fixed_income: 40, cash: 3, alternative: 2, real_asset: 0, other: 0 }
    },
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
  const sinDividendo = new Set(opciones.sinDividendo ?? []);
  /* Las acciones, con la rentabilidad por dividendo de su ficha (`fundamentals_summary.dividends.yield_ratio`, en tanto por uno). Los fondos
     llevan también un `yield_ratio`, como si el proveedor lo trajera: el papel no debe enseñarlo, porque a un fondo no le aplica. Y todos
     llevan coste corriente, que el papel tampoco debe enseñar. */
  const assets = filas.map((fila, i) => ({
    asset_id: fila.asset_id, display_name: fila.display_name, instrument_type: fila.instrument_type,
    costs: { ongoing_charge: 0.0085 },
    fundamentals_summary: sinDividendo.has(fila.asset_id) ? undefined : { schema_version: "test", source: "proveedor", coverage_status: "COMPLETE", dividends: { yield_ratio: fila.instrument_type === "STOCK" ? [0.0412, 0.0275, 0.0538][i % 3] : 0.0199 } }
  })) as unknown as BdbAssetDetail[];
  const ids = filas.map((fila) => fila.asset_id);
  const medidos = ids.slice(0, ids.length - (opciones.fuera ?? 0));
  return { report, assets, filas, ids, medidos };
}

const MOTIVOS = ["INSUFFICIENT_HISTORY", "QUALITY_BLOCKED", "NO_DATA_AT_WINDOW_START"];

function backtest(medidos: string[], todos: string[], volatilidad = 0.09, count = 158, motivosDistintos = false): BacktestResponse {
  const series = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2023, 7, 25) + i * 7 * 86_400_000).toISOString().slice(0, 10),
    value: 100 * Math.exp(i * 0.0018 + 0.025 * Math.sin(i * 0.7))
  }));
  const crisis = (id: string, inicio: string, fin: string, caida: number) => ({
    id, label: id, configured_start_date: inicio, configured_end_date: fin, start_date: inicio, end_date: fin, trough_date: fin,
    common_data_end_date: "2026-08-28", drawdown_pct: caida, duration_days: 33, recovery_date: "2020-11-24", recovery_days: 246,
    remaining_to_recover_pct: 0, recovery_status: "RECOVERED", worst_asset: null,
    coverage: { weight_pct: 100, included_assets: medidos.length, total_assets: todos.length }, representative: true, included_assets: medidos, excluded_assets: [], reason: null
  });
  return {
    schema_version: "backtest.v1", window: "3Y", frequency: "WEEKLY", asset_ids: medidos, portfolio_series: series,
    metrics: { cagr: 0.13, volatility: volatilidad, sharpe: 1.2, max_drawdown: -0.1, rf_rate: 0.02 }, benchmark_series: {},
    stress_scenarios: [crisis("COVID", "2020-02-19", "2020-03-23", -20.567835), crisis("RATES_2022", "2022-01-04", "2022-10-12", -14.865142)],
    synthetics: [], risk_free: { risk_free_source: "ECB_ESTR", risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: { requested_assets: todos.length, included_assets: medidos.length, common_observations: count, first_date: series[0].date, last_date: series.at(-1)!.date },
    excluded_assets: todos.filter((id) => !medidos.includes(id)).map((asset_id, i) => ({ asset_id, reason: motivosDistintos ? MOTIVOS[i % MOTIVOS.length] : "INSUFFICIENT_HISTORY" }))
  } as unknown as BacktestResponse;
}

function analisis(bt: BacktestResponse, coverageWeightPercent: number, extra: Partial<PortfolioHorizon> = {}): PortfolioHorizon {
  return { window: "3Y", years: 3, referenceVersion: "test", backtest: bt, frontier: null, equalWeight: bt, maxSharpe: null, coverageWeightPercent, extensions: [], methodology: "Estimación", ...extra } as PortfolioHorizon;
}

const holdings = (asset_id: string, lineas: Array<[string, number]>): BdbAssetHoldings => ({
  asset_id, storage_mode: "SINGLE_DOCUMENT", as_of_date: "2026-08-31", holdings: lineas.map(([name, weight_pct]) => ({ name, isin: name, weight_pct }))
});

/** Los tres primeros cruzan al 68 %, 58 % y 48 %. Los demás no comparten títulos y el cuarto publica solo el 20 %. */
function solapamiento(report: BdbPortfolioReport): ReportOverlap {
  const byId = new Map<string, BdbAssetHoldings>();
  report.positions.forEach((posicion, i) => {
    if (posicion.instrument_type === "STOCK") return;
    if (i === 0) byId.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN2", 20], ["PROPIO0", 32]]));
    else if (i === 1) byId.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN2", 20], ["COMUN3", 10], ["PROPIO1", 22]]));
    else if (i === 2) byId.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN3", 10], ["PROPIO2", 42]]));
    else if (i === 3) byId.set(posicion.asset_id, holdings(posicion.asset_id, [["PARCIAL", 20]]));
    else byId.set(posicion.asset_id, holdings(posicion.asset_id, [[`SOLO${i}`, 100]]));
  });
  return buildReportOverlap(report.positions, byId);
}

const FEASIBILITY = { status: "FEASIBLE", blocking_issues: [], warnings: [], locked_weight: 0, unlocked_budget: 1 } as unknown as PortfolioFeasibilityCheck;

function entrada(n: number, opciones: Opciones & { capital?: number; volatilidad?: number; perfil?: InformeDeClientePdfInput["perfilYHorizonte"]; sinDividendos?: boolean } = {}): InformeDeClientePdfInput {
  const { report, assets, filas, ids, medidos } = cartera(n, opciones);
  const pesoMedido = filas.filter((fila) => medidos.includes(fila.asset_id)).reduce((s, f) => s + f.weight_percent, 0);
  return {
    report,
    generadoEn: "2026-11-10T12:00:00Z",
    feasibility: FEASIBILITY,
    totalCapital: opciones.capital,
    clientName: "Cliente de ejemplo",
    analysis: analisis(backtest(medidos, ids, opciones.volatilidad, 158, opciones.motivosDistintos), pesoMedido),
    referencia: SERIES_HASTA_20260928,
    overlap: solapamiento(report),
    regionRows: [{ key: "europe", weight_percent: 50 }, { key: "united_states", weight_percent: 35 }, { key: "japan", weight_percent: 15 }],
    rentabilidadPorDividendo: opciones.sinDividendos ? undefined : rentabilidadPorDividendoDe(assets),
    perfilYHorizonte: opciones.perfil
  };
}

/**
 * La extracción de estas pruebas pierde las ligaduras «fi» y «fl» y parte las líneas: se compara sin ellas y con un solo espacio. Es
 * cosa del extractor de las pruebas: un lector de PDF de verdad las lee (comprobado con PyMuPDF sobre un informe generado, 14-11-2026).
 */
const plano = (texto: string) => texto.replace(/\s+/g, " ").replace(/fi|fl/g, "");

async function hojas(input: InformeDeClientePdfInput, guardarComo?: string): Promise<string[]> {
  const blob = await createInformeDeClientePdfBlob(input);
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (guardarComo && process.env.BDB_WRITE_PDF_PREVIEW === "true") {
    const outputDir = path.resolve("output/pdf");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `seis-hojas-${guardarComo}.pdf`), bytes);
  }
  return extractPdfPageTexts(bytes).map(plano);
}
const numeros = numerosDeSeccion;

describe("las secciones", () => {
  test("10 posiciones con capital: cada sección con su número y su título, y la matriz con el solapamiento", async () => {
    const paginas = await hojas(entrada(10, { capital: 250_000, perfil: { risk_profile_level: 5, horizon_years: 7 } }), "10-con-capital");
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    expect(seccion(paginas, "presentacion")).toContain("Informe de su cartera");
    expect(seccion(paginas, "cifras")).toContain("Cifras de la cartera");
    expect(seccion(paginas, "composicion")).toContain("Composición de la cartera");
    expect(seccion(paginas, "reparto")).toContain("Composición global");
    expect(seccion(paginas, "reparto")).toContain("Composición por categoría");
    expect(seccion(paginas, "geografia")).toContain("Distribución geográca");
    expect(seccion(paginas, "evolucion")).toContain("Evolución simulada de la composición actual");
    expect(seccion(paginas, "mapa")).toContain("Mapa riesgo-rentabilidad");
    expect(seccion(paginas, "crisis")).toContain("Crisis pasadas");
    expect(seccion(paginas, "solapamiento")).toContain("Matriz de solapamiento · 3 de 9 fondos comparables");
    expect(seccion(paginas, "guia")).toContain("Guía de interpretación");
    paginas.forEach((pagina, i) => expect(pagina).toContain(`Página ${i + 1} de ${paginas.length}`));
    /* Ya no hay «Optimización», ni un antetítulo que hable de lo que no se imprime. */
    expect(paginas.join(" ")).not.toMatch(/Optimización|Métricas y diversicación/);
  }, 30_000);

  test("3 posiciones sin capital y 25 con capital, con y sin posiciones fuera, y solo acciones: siempre la misma estructura", async () => {
    { const hojasDelCaso = await hojas(entrada(3), "3-sin-capital"); expect(numeros(hojasDelCaso)).toEqual(numerosSeguidos(hojasDelCaso)); }
    const veinticinco = await hojas(entrada(25, { capital: 1_000_000, acciones: 3, fuera: 4 }), "25-con-capital-y-fuera");
    /* La tabla fluye por las hojas que haga falta; el alcance, una línea al pie de la guía. */
    expect(numeros(veinticinco)).toEqual(numerosSeguidos(veinticinco));
    expect(seccion(veinticinco, "guia")).toMatch(/Cifras calculadas sobre el [0-9,]+ % de la cartera. Del [0-9,]+ % restante no hay datos/);
    expect(seccion(veinticinco, "reparto")).toContain("Composición por categoría");
    { const hojasDelCaso = await hojas(entrada(4, { soloAcciones: true }), "solo-acciones"); expect(numeros(hojasDelCaso)).toEqual(numerosSeguidos(hojasDelCaso)); }
    await hojas(entrada(10, { fuera: 2 }), "10-sin-capital-y-fuera");
    await hojas(entrada(15, { capital: 400_000 }), "15-con-capital");
  }, 60_000);
});

/* INF-02 (auditoría de frontend, 13-11-2026). Desde la plantilla única la tabla fluye y repite su cabecera, y la razón de estas pruebas
   (hojas de alto fijo que apretaban las filas) desaparece; se conservan por lo que siguen afirmando: ninguna fila se pierde, el total
   sale, nada se escribe en el hueco del pie, y cada fila tiene su alto. Lo que sigue es la cuenta de antes, que ya no gobierna: las hojas de la tabla eran de tamaño fijo y se repartían a 20 filas sin medirlas. Cuenta a mano
   con los estilos del informe: con más de 16 posiciones el nombre va a 7 pt y la fila mide 2 × 3,2 + 2 + 5,7 × 1,25 + 0,6 = 16,1 pt más
   8,4 pt por línea de nombre; con capital, el nombre tiene 505 − 50 − 70 − 66 − 50 − 8 = 261 pt, y un nombre de 110 letras ocupa
   110 × 7 × 0,46 / 261 ≈ 1,4 líneas, es decir, dos. Veinte filas de 32,9 pt son 658 pt; con la cabecera (61), la entradilla (26), la cabecera
   de la tabla (17) y el total (31), 793 pt, frente a los 841,9 − 50 − 40 = 751,9 pt útiles de la hoja: no caben en una. La auditoría
   suponía que se recortarían; la primera prueba dice que no se pierde nada, y la segunda, lo que pasaba de verdad. */
describe("la tabla de composición con veinte nombres largos (INF-02)", () => {
  const LARGOS = Array.from({ length: 20 }, (_, i) =>
    `Posición ${String(i + 1).padStart(2, "0")} de renta variable europea de gran capitalización con cobertura de divisa en euros, clase A de acumulación${process.env.INF02_EXTRA ?? ""}`);

  test("salen las veinte posiciones y la fila «Total cartera», y nada se escribe por debajo del pie", async () => {
    expect(LARGOS.every((nombre) => nombre.length > 80)).toBe(true);
    const bytes = await bytesDe(entrada(20, { capital: 500_000, nombres: LARGOS }), "20-nombres-largos");
    const paginas = extractPdfPageTexts(bytes).map(plano);
    const tabla = seccion(paginas, "composicion");
    for (let i = 1; i <= 20; i++) expect(tabla, `posición ${i}`).toContain(`Posición ${String(i).padStart(2, "0")} de renta variable`);
    expect(tabla).toContain("Total cartera");
    expect(lineasBajoElPie(bytes)).toEqual([]);
  }, 30_000);

  /* Medido el 13-11-2026: el PDF no recortaba, apretaba. Con la plantilla las filas no se aprietan: cada hoja con filas lleva la cabecera de
     la tabla, ninguna fila se parte ni se repite, y el paso entre dos filas es el de su alto (a 8,6 pt, una fila de dos líneas de nombre y su
     apunte mide unos 43 pt; una de tres, 11,2 más). */
  test.each([
    ["dos líneas", ""],
    ["tres líneas", " y con un tramo de nombre del gestor que lo lleva a tres líneas en la tabla"]
  ])("con nombres de %s, ninguna hoja de la tabla se aprieta", async (_caso, cola) => {
    const nombres = LARGOS.map((nombre) => `${nombre}${cola}`);
    const bytes = await bytesDe(entrada(20, { capital: 500_000, nombres }));
    const hojasDeLaTabla = extractPdfTextBaselines(bytes).filter((cadenas) => cadenas.some((cadena) => /^Posición \d\d /.test(cadena.texto)) && cadenas.some((cadena) => cadena.texto === "Importe"));
    expect(hojasDeLaTabla.length).toBeGreaterThan(1);
    const vistas = new Set<string>();
    for (const cadenas of hojasDeLaTabla) {
      expect(cadenas.some((cadena) => cadena.texto === "Fondo / estrategia")).toBe(true);
      const filas = cadenas.filter((cadena) => /^Posición \d\d /.test(cadena.texto));
      filas.forEach((fila) => {
        expect(vistas.has(fila.texto.slice(0, 11)), fila.texto.slice(0, 11)).toBe(false);
        vistas.add(fila.texto.slice(0, 11));
      });
      const paso = cola ? 50 : 40;
      for (let i = 1; i < filas.length; i++) expect(filas[i].y - filas[i - 1].y, filas[i].texto.slice(0, 11)).toBeGreaterThanOrEqual(paso);
    }
    expect(vistas.size).toBe(20);
    expect(extractPdfTextBaselines(bytes).some((cadenas) => cadenas.some((cadena) => cadena.texto === "Total cartera"))).toBe(true);
    expect(lineasBajoElPie(bytes)).toEqual([]);
  }, 30_000);
});

/* Los nombres de las dos carteras reales con las que se miró el 10-11-2026: diez fondos de una línea, uno largo, y nueve categorías,
   tres en dos líneas. Con las filas de categoría de 29 pt el reparto se iba a su hoja y el informe salía en siete u ocho. */
const NOMBRES_REALES = [
  "Neuberger Next Generation Connectivity Fund EUR A Accumulating Class - Unhedged",
  "Vanguard Global Stock Index Fund EUR Acc",
  "iShares Core MSCI World UCITS ETF USD (Acc)",
  "Fidelity Funds - Global Dividend Fund A-Acc-EUR",
  "Robeco Global Credits DH EUR",
  "Pictet - Water P EUR",
  "JPMorgan Funds - Global Bond Opportunities A (acc) EUR",
  "Carmignac Portfolio Patrimoine A EUR Acc",
  "Amundi Funds Euro Corporate Bond A EUR",
  "DWS Invest Global Infrastructure LC"
];
const CATEGORIAS_REALES = [
  "RV Global Cap. Grande Blend", "RV Europa Cap. Grande Blend", "RV Global Cap. Grande Growth", "RV Global Cap. Pequeña y Mediana",
  "RF Global", "RF Bonos Corporativos EUR", "Mixtos Flexibles EUR", "RV Sector Infraestructuras", "RV Sector Ecología"
];

describe("con nombres y categorías del largo de las carteras reales", () => {
  test("diez fondos sin capital y nueve categorías: todas las categorías en el reparto, y la matriz con el solapamiento", async () => {
    const paginas = await hojas(entrada(10, { nombres: NOMBRES_REALES, nombresDeCategoria: CATEGORIAS_REALES }), "10-reales");
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    expect(seccion(paginas, "reparto")).toContain("RV Global Cap. Pequeña y Mediana");
    expect(seccion(paginas, "reparto")).not.toMatch(/Otras \d+ categorías/);
    expect(seccion(paginas, "solapamiento")).toContain("Matriz de solapamiento · 3 de 9 fondos comparables");
  }, 30_000);

  test("ocho posiciones con capital y una fuera: sin anexo, y la matriz de siete fondos bajo las crisis", async () => {
    const paginas = await hojas(entrada(8, { nombres: NOMBRES_REALES, nombresDeCategoria: CATEGORIAS_REALES, capital: 300_000, fuera: 1 }), "8-reales");
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    const conLasCrisis = paginas.find((p) => /\d\d Crisis pasadas/.test(p))!;
    expect(conLasCrisis).toMatch(/\d\d Solapamiento entre fondos/);
    expect(conLasCrisis).toContain("Matriz de solapamiento · 3 de 7 fondos comparables");
  }, 30_000);

  test("la hoja 04 en el caso peor: la frase de la referencia, una nota de cobertura de tres líneas y la nota del mapa más larga", async () => {
    const paginas = await hojas(entrada(10, { nombres: NOMBRES_REALES, nombresDeCategoria: CATEGORIAS_REALES, fuera: 2, motivosDistintos: true, volatilidad: 0.3 }), "hoja4-peor");
    const hoja4 = `${seccion(paginas, "evolucion")} ${seccion(paginas, "mapa")}`;
    expect(hoja4).toContain("La referencia elegida oscila menos que esta composición");
    expect(hoja4).toMatch(/quedan fuera .+; y .+, por/);
    expect(hoja4).toContain("oscila más que todas las carteras de referencia");
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
  }, 30_000);
});

/**
 * **Óscar, 16-11-2026: «También la frontera».** Revisa el punto 1 de A-136, que la había sacado del papel el 10-11, y la devuelve con
 * las dos condiciones que faltaban entonces: **cifras en los dos ejes** —la curva de aquel papel no llevaba ninguna— y **la nota de que
 * la curva depende del periodo**, que era el argumento con el que se quitó. Lo que no entra en el cálculo se nombra bajo el gráfico, no
 * en un anexo propio: A-136.5 dejó un solo anexo.
 *
 * Los cortes de los ejes que esta prueba espera salen de una cuenta a mano sobre `ejeDelMapa`, con los puntos de la frontera de abajo:
 *
 * - Riesgo: va de 0,041 a 0,118 (el último de los doce puntos, 0,041 + 11 × 0,007). Bruto (0,118 − 0,041) / 4 = 0,01925; magnitud 0,01;
 *   el primer factor de [1, 2, 2.5, 3, 5, 10] que llega es el 2, así que el paso es 0,02. Aire 0,00308: el mínimo baja a 0,02 y el
 *   máximo sube a 0,14. Cortes: 2, 4, 6, 8, 10, 12 y 14 %.
 * - Rentabilidad: va de 0,038 a 0,0952 (0,038 + 11 × 0,0052). Bruto 0,0143; mismo paso de 0,02; aire 0,002288: de 0,02 a 0,10.
 *   Cortes: 2, 4, 6, 8 y 10 %.
 *
 * Así que «14 %» y «12 %» solo los escribe el eje del riesgo, y «2 %» lo escriben los dos, una vez cada uno: eso es lo que prueba que
 * los dos ejes llevan cifras, que es la condición de Óscar.
 */
describe("1 · la frontera eficiente vuelve al informe de cliente (Óscar, 16-11-2026)", () => {
  const base = entrada(10, { fuera: 2 });
  const punto = (volatility: number, expectedReturn: number) => ({ volatility, expectedReturn, sharpeRatio: 1, volatilityLabel: "", expectedReturnLabel: "", sharpeLabel: "", weights: [] });
  const frontier = {
    kind: "historical", label: "Frontera eficiente · 3 años", window: "3Y", asOfDate: "2026-08-28", riskFreeRateLabel: "2,00 %", riskFreeSource: "ECB_ESTR", riskFreeRatePolicy: "WINDOW_AVERAGE",
    coverage: { requested: 10, included: 8, commonObservations: 158, firstDate: "2023-08-25", lastDate: "2026-08-28" },
    portfolioCoverage: { requested: 10, included: 8, weightPercent: 90, excluded: [{ assetId: base.report.positions[9].asset_id, weightPercent: 2, reasonLabel: "Histórico insuficiente" }] },
    insufficientCoverage: false, current: punto(0.071, 0.064), minVolatility: punto(0.041, 0.038), maxSharpe: punto(0.082, 0.078),
    frontier: Array.from({ length: 12 }, (_, i) => punto(0.041 + i * 0.007, 0.038 + i * 0.0052)), excluded: [], warnings: []
  } as unknown as PortfolioHorizon["frontier"];
  const conFrontera = (guardarComo?: string) => hojas({ ...base, analysis: { ...base.analysis!, frontier } }, guardarComo);

  test("la sección sale con su calibración, su cobertura y lo que queda fuera, y va entre el mapa y el cono", async () => {
    const paginas = await conFrontera("frontera-con-curva");
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    /* El orden del papel del 02-11: la evolución y el mapa van juntos, y detrás la frontera y el cono. */
    expect(Number(numeroDe(paginas, "frontera"))).toBe(Number(numeroDe(paginas, "mapa")) + 1);
    expect(Number(numeroDe(paginas, "cono"))).toBe(Number(numeroDe(paginas, "frontera")) + 1);
    const texto = seccion(paginas, "frontera");
    expect(texto).toContain("Calibrada con 3 años de histórico, a 28/08/2026, sobre 158 fechas comunes.");
    expect(texto).toContain("Cubre el 90,0 % del peso: 8 de 10 posiciones.");
    /* La única posición que el servidor deja fuera, con su peso y su motivo, bajo el gráfico y no en un anexo. El peso es el de la
       composición de este informe —la décima de diez posiciones, 1,8 %—, no el 2 % que manda el servidor con la exclusión: el
       cliente no puede leer dos pesos distintos de la misma posición en el mismo documento. El motivo, sin código del servidor:
       esta exclusión no trae ninguno, así que sale el general. */
    expect(texto).toContain("Fuera de la frontera:");
    expect(plano(texto)).toContain(plano(`${base.report.positions[9].display_name} (1,8 %), por falta de datos en este periodo.`));
  }, 30_000);

  test("los dos ejes llevan cifras, que es lo que faltaba en el papel de antes", async () => {
    const texto = plano(seccion(await conFrontera(), "frontera"));
    expect(texto).toContain("Riesgo (volatilidad)");
    expect(texto).toContain("Rentabilidad");
    /* Solo el eje del riesgo llega a 12 y 14 %; el de la rentabilidad se queda en 10. */
    expect(texto).toContain("14 %");
    expect(texto).toContain("12 %");
    /* Un «2 %» por eje: si uno se quedara sin cortes, solo saldría una vez. */
    expect(texto.match(/(?<!\d)2 %/g)).toHaveLength(2);
  }, 30_000);

  test("dice de qué depende la curva y que no es una recomendación, y la guía la explica", async () => {
    const paginas = await conFrontera();
    const texto = seccion(paginas, "frontera");
    expect(texto).toContain("El punto granate es la parte cubierta");
    expect(texto).toContain("La curva sale del histórico de estos 3 años: con otro periodo sería otra");
    expect(texto).toContain("no es una previsión de lo que rendirá cada combinación");
    expect(texto).toContain("No es una recomendación de cambiar su cartera.");
    expect(plano(seccion(paginas, "guia"))).toContain("Frontera eciente");
  }, 30_000);

  test("con una sola acción no sale: no hay nada que combinar, y la guía no la explica", async () => {
    const soloUna = entrada(1, { soloAcciones: true });
    const paginas = await hojas({ ...soloUna, analysis: { ...soloUna.analysis!, frontier } });
    expect(numeroDe(paginas, "frontera")).toBeNull();
    expect(plano(seccion(paginas, "guia"))).not.toContain("Frontera eciente");
  }, 30_000);
});

describe("2 · el solapamiento, en frases (y desde el 12-11-2026, con la matriz debajo)", () => {
  test("los pares altos con su cifra, el que no llega, y cuántos fondos no publican lo bastante", () => {
    const { report } = cartera(6);
    const { frases, masDeCien } = solapamientoEnFrases(solapamiento(report));
    const nombres = report.positions.map((p) => p.display_name);
    expect(frases[0]).toBe("3 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(frases[1]).toBe(`${nombres[0]} y ${nombres[1]} comparten al menos el 68,0\u00a0% de su cartera publicada.`);
    expect(frases[2]).toBe(`${nombres[1]} y ${nombres[2]} comparten al menos el 58,0\u00a0% de su cartera publicada.`);
    expect(frases[3]).toBe(`${nombres[0]} y ${nombres[2]} comparten al menos el 48,0\u00a0% de su cartera publicada.`);
    expect(frases).toContain(`1 de los 6 fondos no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: ${nombres[3]}.`);
    expect(frases.join(" ")).not.toContain(nombres[2] + " y");
    expect(masDeCien).toBe(false);
  });

  test("sin ningún par alto, los que más comparten; y lo que pasa de 100 lleva su nota", () => {
    const filas = ["A", "B", "C"].map((id) => ({ asset_id: id, display_name: `Fondo ${id}`, weight_percent: 33, instrument_type: "FUND" }));
    const bajos = buildReportOverlap(filas, new Map([
      ["A", holdings("A", [["X", 3.21], ["R1", 96.79]])], ["B", holdings("B", [["X", 3.29], ["Y", 1], ["R2", 95.71]])], ["C", holdings("C", [["Y", 0.05], ["R3", 99.95]])]
    ]));
    expect(solapamientoEnFrases(bajos).frases).toEqual([
      "Ningún par de fondos llega al 40 % de lo que publican. Los que más comparten:",
      "Fondo A y Fondo B comparten al menos el 3,2\u00a0% de su cartera publicada.",
      "Fondo B y Fondo C comparten menos del 0,1\u00a0% de su cartera publicada."
    ]);
    const altos = buildReportOverlap(filas.slice(0, 2), new Map([
      ["A", holdings("A", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]])], ["B", holdings("B", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]])]
    ]));
    const { frases, masDeCien } = solapamientoEnFrases(altos);
    expect(frases[1]).toBe("Fondo A y Fondo B comparten más del 100\u00a0% de su cartera publicada.");
    expect(masDeCien).toBe(true);
  });

  test("si ninguno publica la mitad, una sola frase que lo dice", () => {
    const filas = ["A", "B", "C"].map((id) => ({ asset_id: id, display_name: `Fondo ${id}`, weight_percent: 33, instrument_type: "FUND" }));
    expect(solapamientoEnFrases(buildReportOverlap(filas, new Map([["A", holdings("A", [["X", 20]])]]))).frases).toEqual([
      "Ninguno de los 3 fondos publica al menos la mitad de su cartera: no se puede medir lo que comparten."
    ]);
  });

  test("solo acciones: no aplica; con un fondo solo, no hay pares", () => {
    const acciones = [{ asset_id: "S1", display_name: "Acción 1", weight_percent: 50, instrument_type: "STOCK" }, { asset_id: "S2", display_name: "Acción 2", weight_percent: 50, instrument_type: "STOCK" }];
    expect(solapamientoEnFrases(buildReportOverlap(acciones)).frases).toEqual(["Las 2 mayores posiciones son acciones, que no tienen subyacentes: el solapamiento no aplica."]);
    const uno = [{ asset_id: "F", display_name: "Fondo", weight_percent: 60, instrument_type: "FUND" }, acciones[0]];
    expect(solapamientoEnFrases(buildReportOverlap(uno, new Map([["F", holdings("F", [["X", 100]])]]))).frases).toEqual([
      "Entre ellas hay un solo fondo: no hay dos fondos que comparar.",
      "La acción no entra: no tiene subyacentes."
    ]);
  });

  test("en papel: las frases en la hoja 05, y la matriz sin «N/D» ni la leyenda de antes", async () => {
    const paginas = await hojas(entrada(6));
    const hoja = seccion(paginas, "solapamiento");
    expect(hoja).toContain("Solapamiento entre fondos");
    expect(hoja).toContain("comparten al menos el 48,0 % de su cartera publicada.");
    expect(hoja).toContain("1 de los 6 fondos no publica al menos la mitad de su cartera");
    expect(hoja).not.toMatch(/claro = bajo|N\/D|No aplica/);
  }, 30_000);
});

describe("3 · sin costes, con la rentabilidad por dividendo de las acciones (A-143, Óscar, 12-11-2026)", () => {
  test("la columna: el dato de cada acción, «No aplica» en fondos y ETF, y «Falta el dato» en la acción que no lo tiene, nunca un cero", async () => {
    const { report } = cartera(6, { acciones: 3 });
    const acciones = report.positions.filter((p) => p.instrument_type === "STOCK");
    const paginas = await hojas(entrada(6, { acciones: 3, sinDividendo: [acciones[1].asset_id] }), "dividendos");
    const tabla = seccion(paginas, "composicion");
    /* Es la prevista, y lo dice (A-143): lo pagado en doce meses no es fiable en el proveedor. */
    expect(tabla).toMatch(/Rent\.\s*dividendo\s*prevista/);
    expect(seccion(paginas, "guia")).toContain("Rentabilidad por dividendo prevista");
    expect(seccion(paginas, "guia")).toMatch(/Es una estimación del proveedor de datos, no un dividendo cobrado/);
    expect(tabla).not.toMatch(/[Cc]oste|[Cc]orriente/);
    expect(tabla).toContain("Divisa");
    /* Las acciones son las filas 4, 5 y 6 (i = 3, 4, 5): 0,0412 → «4,12 %», la quinta sin dato y la sexta 0,0538 → «5,38 %». */
    expect(tabla).toContain("4,12 %");
    expect(tabla).toContain("5,38 %");
    expect(tabla).not.toContain("2,75 %");
    expect(tabla.match(/Falta el dato/g)).toHaveLength(1);
    /* Tres fondos, «No aplica»: su `yield_ratio` no se lee, aunque esté. */
    expect(tabla.match(/No aplica/g)).toHaveLength(3);
    expect(tabla).not.toContain("1,99 %");
    expect(tabla).not.toContain("0,00 %");
    expect(tabla).not.toContain("0,85 %");
  }, 30_000);

  test("sin el mapa de dividendos no hay ninguna cifra inventada: la acción dice que falta, el fondo que no aplica", async () => {
    const paginas = await hojas(entrada(4, { acciones: 2, sinDividendos: true }));
    expect(seccion(paginas, "composicion").match(/Falta el dato/g)).toHaveLength(2);
    expect(seccion(paginas, "composicion").match(/No aplica/g)).toHaveLength(2);
    const soloAcciones = await hojas(entrada(3, { soloAcciones: true }), "solo-acciones-dividendos");
    expect(seccion(soloAcciones, "composicion")).toContain("4,12 %");
    expect(seccion(soloAcciones, "composicion")).toContain("2,75 %");
    expect(seccion(soloAcciones, "composicion")).toContain("5,38 %");
    expect(seccion(soloAcciones, "composicion")).not.toContain("No aplica");
    /* Sin acciones, la guía no explica una columna que solo dice «No aplica». */
    const soloFondos = await hojas(entrada(4), "solo-fondos-dividendos");
    expect(soloFondos.join(" ")).not.toContain("Rentabilidad por dividendo prevista");
  }, 30_000);

  test("rentabilidadPorDividendoDe: solo las acciones, el dato tal cual, y null donde no es un número", () => {
    const activos = [
      { asset_id: "A", instrument_type: "STOCK", fundamentals_summary: { dividends: { yield_ratio: 0.031 } } },
      { asset_id: "B", instrument_type: "STOCK", fundamentals_summary: { dividends: { yield_ratio: "0.031" } } },
      { asset_id: "C", instrument_type: "STOCK" },
      { asset_id: "D", instrument_type: "FUND", fundamentals_summary: { dividends: { yield_ratio: 0.02 } } },
      { asset_id: "E", instrument_type: "ETF", fundamentals_summary: { dividends: { yield_ratio: 0.02 } } },
      { asset_id: "F", instrument_type: "STOCK", fundamentals_summary: { dividends: { yield_ratio: Number.NaN } } }
    ] as unknown as BdbAssetDetail[];
    expect(rentabilidadPorDividendoDe(activos)).toEqual({ A: 0.031, B: null, C: null, F: null });
  });

  test("ningún coste en ninguna hoja: ni la columna, ni la media, ni las rentabilidades netas, ni la entrada de la guía", async () => {
    for (const [caso, input] of [
      ["fondos", entrada(5)],
      ["mixta con capital", entrada(8, { capital: 400_000, acciones: 2 })],
      ["solo acciones", entrada(3, { soloAcciones: true })],
      ["con fuera", entrada(10, { fuera: 4 })]
    ] as const) {
      const texto = (await hojas(input)).join(" ");
      expect(texto, caso).not.toMatch(/coste|gastos|netas|comisi|suscripción|reembolso|impuestos/i);
    }
  }, 60_000);
});

describe("4 · la referencia que no se parece en riesgo, junto al diferencial", () => {
  test("los límites: más de 1,25 o menos de 0,80, y en el límite justo no", () => {
    expect(COCIENTE_DE_RIESGO_MAXIMO).toBe(1.25);
    expect(COCIENTE_DE_RIESGO_MINIMO).toBe(0.8);
    expect(fraseDelRiesgoDeLaReferencia(0.125, 0.1)).toBeNull();
    expect(fraseDelRiesgoDeLaReferencia(0.1251, 0.1)).toBe("La referencia elegida oscila menos que esta composición (10,00\u00a0% frente a 12,51\u00a0%): parte de la diferencia es riesgo, no acierto.");
    expect(fraseDelRiesgoDeLaReferencia(0.08, 0.1)).toBeNull();
    expect(fraseDelRiesgoDeLaReferencia(0.0799, 0.1)).toBe("La referencia elegida oscila más que esta composición (10,00\u00a0% frente a 7,99\u00a0%): parte de la diferencia es el riesgo que esta composición no toma.");
    expect(fraseDelRiesgoDeLaReferencia(0.1, 0.1)).toBeNull();
    expect(fraseDelRiesgoDeLaReferencia(null, 0.1)).toBeNull();
    expect(fraseDelRiesgoDeLaReferencia(0.2, undefined)).toBeNull();
    expect(fraseDelRiesgoDeLaReferencia(Number.NaN, 0.1)).toBeNull();
  });

  /** La volatilidad de Equilibrado en las fechas de la simulación, como la mide el mapa. */
  function volatilidadDeEquilibrado(): number {
    const bt = backtest(["A"], ["A"]);
    const ventana = referenceProfilesForDates(bt.portfolio_series.map((p) => p.date), bt.portfolio_series.map((p) => p.value), SERIES_HASTA_20260928)!;
    expect(ventana.mismaVentana).toBe(true);
    return ventana.profiles.find((p) => p.id === "equilibrado")!.vol;
  }

  test("en papel, en los dos sentidos, en la hoja 04 y detrás del diferencial; parecidas, nada", async () => {
    const referencia = volatilidadDeEquilibrado();
    const hoja4 = async (volatilidad: number, guardarComo?: string) => seccion(await hojas(entrada(5, { volatilidad }), guardarComo), "evolucion");
    const mas = await hoja4(referencia * 1.3, "riesgo-de-la-referencia");
    expect(mas).toContain("Diferencial");
    expect(mas).toContain("La referencia elegida oscila menos que esta composición");
    expect(mas.indexOf("La referencia elegida")).toBeGreaterThan(mas.indexOf("Diferencial"));
    const menos = await hoja4(referencia * 0.7);
    expect(menos).toContain("La referencia elegida oscila más que esta composición");
    expect(menos).toContain("parte de la diferencia es el riesgo que esta composición no toma.");
    const parecida = await hoja4(referencia * 1.1);
    expect(parecida).toContain("Diferencial");
    expect(parecida).not.toContain("La referencia elegida");
  }, 60_000);

  test("sin la cartera de referencia no hay diferencial ni frase", async () => {
    const paginas = await hojas({ ...entrada(5, { volatilidad: 0.4 }), referencia: null });
    expect(paginas.join(" ")).not.toContain("La referencia elegida");
  }, 30_000);
});

describe("5 · los cambios menores", () => {
  test("sin capital: ni columna de importe ni «Valoración actual»; con capital, los dos", async () => {
    const sin = await hojas(entrada(5));
    expect(seccion(sin, "presentacion")).not.toMatch(/VALORACIÓN|Valoración|N\/D/);
    expect(seccion(sin, "composicion")).not.toMatch(/IMPORTE|Importe|CAPITAL|N\/D/);
    const con = await hojas(entrada(5, { capital: 100_000 }));
    /* La valoración, como cifra titular sin decimales; en la tabla, con los dos del formato común. */
    expect(seccion(con, "presentacion")).toMatch(/Valoración actual\s*100\.000 €/);
    expect(seccion(con, "composicion")).toMatch(/Importe/);
    expect(seccion(con, "composicion")).toContain("100.000,00 €");
  }, 30_000);

  test("la portada no lleva ninguna cifra de la cartera: van en su sección, delante de la geografía (Óscar, 15-11-2026)", async () => {
    const paginas = await hojas(entrada(10, { capital: 250_000, perfil: { risk_profile_level: 5, horizon_years: 7 } }));
    /* La portada presenta: ni las cuatro cifras, ni sus rótulos, ni la nota del tipo sin riesgo. */
    const portada = seccion(paginas, "presentacion");
    expect(portada).toContain("Informe de su cartera");
    expect(portada).not.toMatch(/Rentabilidad anualizada|Volatilidad|Sharpe|Caída máxima|Tipo sin riesgo/);
    expect(paginas[0]).not.toMatch(/Rentabilidad anualizada|Volatilidad 3 años|Sharpe 3 años|Caída máxima|Tipo sin riesgo/);
    /* Las cuatro, con su nota, en «Cifras de la cartera». */
    const cifras = seccion(paginas, "cifras");
    for (const rotulo of ["Rentabilidad anualizada 3 años", "Volatilidad 3 años", "Sharpe 3 años", "Caída máxima 3 años"]) expect(cifras, rotulo).toContain(rotulo);
    expect(cifras).toContain("Tipo sin riesgo a 3 años: 2,00 %, la referencia del ratio de Sharpe.");
    /* Y van tras el reparto y delante de la geografía, como en la hoja 03 del papel de antes; nunca en la primera hoja. */
    const todo = paginas.join(" ");
    const [reparto, lasCifras, geografia] = ["02 Reparto de la cartera", "03 Cifras de la cartera", "04 Distribución geogr"].map((titulo) => todo.indexOf(titulo));
    expect(reparto).toBeGreaterThan(0);
    expect(lasCifras).toBeGreaterThan(reparto);
    expect(geografia).toBeGreaterThan(lasCifras);
    expect(paginas.findIndex((pagina) => pagina.includes("03 Cifras de la cartera"))).toBeGreaterThan(0);
  }, 30_000);

  test("el título del reparto no se queda solo al pie de una hoja: va entero con su bloque (15-11-2026)", async () => {
    /* Con diez posiciones el bloque del reparto no cabe bajo la tabla: antes se iba a la hoja siguiente y dejaba atrás su título. */
    for (const caso of [entrada(10, { capital: 250_000 }), entrada(15, { capital: 250_000 }), entrada(3)]) {
      const paginas = await hojas(caso);
      const conElTitulo = paginas.filter((pagina) => /\d\d Reparto de la cartera/.test(pagina));
      expect(conElTitulo).toHaveLength(1);
      expect(conElTitulo[0]).toContain("Composición global");
      expect(conElTitulo[0]).toContain("Composición por categoría");
    }
  }, 60_000);

  test("el cono estadístico va justo detrás del mapa de riesgo, centrado en el tipo sin riesgo y con pérdidas a la vista (Óscar, 15-11-2026)", async () => {
    const paginas = await hojas(entrada(10, { capital: 250_000 }));
    /* Detrás de la frontera —que volvió al papel el 16-11 y se le puso delante— y delante de las crisis, numerado seguido; con esta
       cartera, en la misma hoja que la frontera, como en el papel del 02-11, donde las dos eran «Optimización y proyección». */
    expect(Number(numeroDe(paginas, "frontera"))).toBe(Number(numeroDe(paginas, "mapa")) + 1);
    expect(Number(numeroDe(paginas, "cono"))).toBe(Number(numeroDe(paginas, "frontera")) + 1);
    expect(Number(numeroDe(paginas, "crisis"))).toBe(Number(numeroDe(paginas, "cono")) + 1);
    /* El cono va entero en una hoja: la explicación, el gráfico y los tres casos sueltos no se entienden. Con qué lo comparte
       depende de la cartera —con curva de frontera, su hoja; sin ella, lo que quepa—, y la decisión del 15-11 dice «si cabe». */
    const hojasConElCono = paginas.filter((pagina) => /Cuánto podría oscilar su inversión|Caso desfavorable|La franja oscura recoge/.test(pagina));
    expect(hojasConElCono).toHaveLength(1);
    const cono = seccion(paginas, "cono");
    expect(cono).toContain("Cono estadístico a 3 años. No es una previsión.");
    expect(cono).toContain("Este gráco no es una previsión.");
    /* El centro no es la rentabilidad pasada (13 %), sino el tipo sin riesgo: 250.000 × 1,02³ = 250.000 × 1,061208 = 265.302 €, +6,12 %. */
    expect(cono).toContain("crece solo al tipo sin riesgo (2,00 % al año)");
    expect(cono).toMatch(/Caso central 265\.302 € \(\+6,12 %\)/);
    /* Lo que distingue este cono del que salió del papel el 04-11: el caso desfavorable pierde, y el favorable gana. */
    expect(cono).toMatch(/Caso desfavorable [\d.]+ € \(−\d+,\d\d %\)/);
    expect(cono).toMatch(/Caso favorable [\d.]+ € \(\+\d+,\d\d %\)/);
    expect(cono).toContain("Hoy · 250.000 €");
    /* Explicado para el cliente, y con lo que no es. */
    expect(cono).toContain("La franja oscura recoge la mitad de los resultados posibles, y la clara, nueve de cada diez.");
    expect(cono).toContain("las pérdidas pueden ser mayores que las del caso desfavorable");
    expect(cono).toContain(`Lo que esta composición cayó en crisis reales está en la sección ${numeroDe(paginas, "crisis")}.`);
    /* Ni las palabras del cono de antes, ni costes (A-143). */
    expect(cono).not.toMatch(/Monte Carlo|[Pp]royección|\bderiva\b|P5|percentil|coste|impuesto/);
  }, 30_000);

  test("el cono, sin capital o sin medir toda la cartera, va por cada 100 € invertidos; sin cifra de la cartera, no sale", async () => {
    const sinCapital = seccion(await hojas(entrada(3)), "cono");
    expect(sinCapital).toContain("el valor de cada 100 € invertidos");
    expect(sinCapital).toContain("Hoy · 100,0 €");
    /* 100 × 1,061208 = 106,1 €. */
    expect(sinCapital).toMatch(/Caso central 106,1 € \(\+6,12 %\)/);
    const { report, ids } = cartera(5);
    /* Con capital pero midiendo el 90 %: la serie no es de todo el capital, y no se escribe en euros del cliente. */
    const parcial = prepararElCono(analisis(backtest(ids, ids), 90), false, 250_000, null);
    expect(parcial?.base).toBe(100);
    expect(parcial?.hoy.replace(/\s/g, " ")).toBe("100,0 €");
    const entero = prepararElCono(analisis(backtest(ids, ids), 100), false, 250_000, null);
    expect(entero?.base).toBe(250_000);
    /* El caso central crece exactamente al tipo sin riesgo, y los casos van ordenados. */
    const ultimo = entero!.puntos.at(-1)!;
    expect(ultimo.p50).toBeCloseTo(250_000 * 1.02 ** 3, 6);
    expect(ultimo.p5).toBeLessThan(250_000);
    expect(ultimo.p5).toBeLessThan(ultimo.p25);
    expect(ultimo.p75).toBeLessThan(ultimo.p95);
    /* Sin cifra de la cartera no hay cono, y la sección no sale. */
    expect(prepararElCono(analisis(backtest(ids, ids), 100), true, 250_000, null)).toBeNull();
    expect(prepararElCono(undefined, false, 250_000, null)).toBeNull();
    expect(report.positions.length).toBe(5);
  }, 30_000);

  test("el tipo sin riesgo ya no es una casilla: la tira lleva cuatro cifras y el tipo va en la nota", async () => {
    const { report, ids } = cartera(5);
    const filas = informeDeClienteMetricRows(report, analisis(backtest(ids, ids), 100));
    expect(filas.map((f) => f.label)).toEqual(["Rentabilidad anualizada 3 años", "Volatilidad 3 años", "Sharpe 3 años", "Caída máxima 3 años"]);
    const hoja = seccion(await hojas(entrada(5)), "cifras");
    expect(hoja).toContain("Tipo sin riesgo a 3 años: 2,00 %, la referencia del ratio de Sharpe.");
    expect(hoja).not.toMatch(/TIPO SIN RIESGO 3/);
  }, 30_000);

  test("bajo las cifras, solo el tipo sin riesgo: ni la simulación, ni la parte medida, ni los tramos estimados (A-143)", async () => {
    const conReferencia = [{ assetId: "LU0900000000", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-25", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: 0.97, residualVolatility: 0.08, referenceHasBacktestedHistory: false }];
    const base = entrada(10, { fuera: 2 });
    const paginas = await hojas({ ...base, analysis: { ...base.analysis!, extensions: conReferencia } });
    const hoja = seccion(paginas, "cifras");
    expect(hoja).toContain("Tipo sin riesgo a 3 años: 2,00 %, la referencia del ratio de Sharpe.");
    expect(hoja).not.toMatch(/Simulación con los pesos de hoy|Mide el|quedan? fuera|tramos anteriores|anexo|Cifras ilustrativas/);
    /* Lo quitado de aquí sigue donde ya estaba: la simulación y su cobertura, bajo la curva de la hoja 04. */
    const hoja4 = seccion(paginas, "evolucion");
    expect(hoja4).toContain("Simulación con los pesos de hoy, sin aportaciones ni retiradas.");
    /* Una muestra lo sigue diciendo, porque no son cifras reales. */
    const muestra = await hojas({ ...base, analysis: { ...base.analysis!, referenceVersion: "demo-synthetic.v1" } });
    const hojaDeMuestra = seccion(muestra, "cifras");
    expect(hojaDeMuestra).toContain("Cifras ilustrativas, no operativas.");
    expect(hojaDeMuestra).not.toMatch(/Simulación con los pesos de hoy|tramos anteriores/);
  }, 40_000);

  test("todas las categorías cuando caben, sin «Otras»; si de verdad no caben, «Otras N» al final y dicho", async () => {
    const ocho = seccion(await hojas(entrada(8)), "reparto");
    for (const categoria of ["RF Flexible EUR", "RV Europa Cap. Grande", "Monetarios EUR", "RF Deuda Pública EUR"]) expect(ocho).toContain(categoria);
    expect(ocho).not.toMatch(/Otras( \d+)? categorías/);
    const muchas = await hojas(entrada(8, { categorias: 40 }), "40-categorias");
    const reparto = seccion(muchas, "reparto");
    expect(reparto).toMatch(/Otras \d+ categorías/);
    expect(reparto).toMatch(/es la suma de \d+ categorías que no caben en la hoja; la mayor de ellas pesa el 2,5 %/);
  }, 30_000);

  test("lineaDelAlcance: los dos porcentajes de la misma parte medida, que suman 100 con el mismo redondeo", () => {
    const parte = (weightPercent: number) => ({ requested: 10, included: 9, weightPercent, excluded: [{ assetId: "X", weightPercent: 100 - weightPercent, reason: null, reasonLabel: "" }] });
    expect(lineaDelAlcance(parte(93.6))).toBe("Cifras calculadas sobre el 93,6\u00a0% de la cartera. Del 6,4\u00a0% restante no hay datos suficientes para el periodo medido.");
    /* 93,64 se escribe 93,6, y el resto es 6,4 aunque el dato diga 6,36. */
    expect(lineaDelAlcance(parte(93.64))).toBe("Cifras calculadas sobre el 93,6\u00a0% de la cartera. Del 6,4\u00a0% restante no hay datos suficientes para el periodo medido.");
    /* Lo que no llega al 100 no se escribe como si llegara: dos decimales en las dos cifras. */
    expect(lineaDelAlcance(parte(99.96))).toBe("Cifras calculadas sobre el 99,96\u00a0% de la cartera. Del 0,04\u00a0% restante no hay datos suficientes para el periodo medido.");
    expect(lineaDelAlcance({ requested: 10, included: 10, weightPercent: 100, excluded: [] })).toBeNull();
    expect(lineaDelAlcance(null)).toBeNull();
  });

  test("el anexo es una línea al pie de la guía, sin nombres ni tabla, y solo si las cifras miden menos del 100 % (A-143)", async () => {
    for (const fuera of [1, 2, 4]) {
      const paginas = await hojas(entrada(10, { fuera }), `10-con-${fuera}-fuera`);
      expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
      const guia = seccion(paginas, "guia");
      expect(guia).toMatch(/^\d\d Guía de interpretación/);
      expect(guia).toContain("Alcance de las cifras");
      expect(guia).toMatch(/Cifras calculadas sobre el \d\d,\d % de la cartera\. Del \d+,\d % restante no hay datos sucientes para el periodo medido\./);
      const texto = paginas.join(" ");
      expect(texto).not.toMatch(/Qué queda fuera del cálculo|Estas posiciones no entran|Parte medida:|ACTIVO \/ MOTIVO|anexo/);
      /* Sin nombres: ninguna posición fuera se nombra en la guía. */
      const { filas } = cartera(10);
      for (const fila of filas.slice(10 - fuera)) expect(guia).not.toContain(plano(fila.display_name));
    }
    /* Cuatro fuera: 18,2 % del peso (4+3+2+1 de 55). */
    expect(seccion(await hojas(entrada(10, { fuera: 4 })), "guia")).toContain(plano("Cifras calculadas sobre el 81,8 % de la cartera. Del 18,2 % restante no hay datos suficientes para el periodo medido."));
    /* Sin nada fuera, no hay anexo. */
    expect((await hojas(entrada(10))).join(" ")).not.toContain("Alcance de las cifras");
  }, 60_000);

  test("la guía más larga (respaldo, histórico ampliado, solapamiento y siglas) lleva la línea en su hoja, y nada pasa del pie", async () => {
    const conReferencia = [{ assetId: "LU0900000000", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-25", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: 0.97, residualVolatility: 0.08, referenceHasBacktestedHistory: false }];
    const base = entrada(10, { fuera: 4 });
    const bt = { ...base.analysis!.backtest, risk_free: { risk_free_source: "STATIC", risk_free_rate: 0.02, risk_free_rate_policy: "STATIC_FALLBACK" } } as BacktestResponse;
    const bytes = await bytesDe({ ...base, analysis: { ...base.analysis!, backtest: bt, extensions: conReferencia } }, "guia-mas-larga");
    const paginas = extractPdfPageTexts(bytes).map(plano);
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas, { ampliado: true }));
    expect(seccion(paginas, "guia")).toContain("Un tipo jo de respaldo");
    expect(seccion(paginas, "guia")).toContain("Cifras calculadas sobre el 81,8 % de la cartera.");
    expect(lineasBajoElPie(bytes)).toEqual([]);
  }, 30_000);

  test("el histórico ampliado es la última, numerada seguida, con parte medida o sin ella", async () => {
    const conReferencia = [{ assetId: "LU0900000000", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-25", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: 0.97, residualVolatility: 0.08, referenceHasBacktestedHistory: false }];
    const ampliado = (input: InformeDeClientePdfInput) => ({ ...input, analysis: { ...input.analysis!, extensions: conReferencia } });
    for (const fuera of [0, 1, 4]) {
      const paginas = await hojas(ampliado(entrada(10, { fuera })));
      expect(numeros(paginas)).toEqual(numerosSeguidos(paginas, { ampliado: true }));
      expect(seccion(paginas, "ampliado")).toMatch(/^\d\d Histórico ampliado con referencias/);
      expect(numeroDe(paginas, "ampliado")).toBe(numeros(paginas).at(-1));
    }
  }, 40_000);

  test("la nota de Canadá y África no está en este papel, aunque alguien siga mandando la marca", async () => {
    /* El campo salió de la entrada; se manda a la fuerza, como lo mandaban los dos botones, para ver que el papel ya no lo lee. */
    const conLaMarca = { ...entrada(10), canadaYAfricaSinSeparar: true } as InformeDeClientePdfInput;
    expect((await hojas(conLaMarca)).join(" ")).not.toMatch(/Canadá|África aún/);
  }, 30_000);

  test("el perfil y el horizonte de la cartera, en la presentación solo si están puestos", async () => {
    /* La extracción pierde la ligadura «fi»: «Perfil» sale «Perl». */
    const ambos = seccion(await hojas(entrada(3, { perfil: { risk_profile_level: 5, horizon_years: 7 } })), "presentacion");
    expect(ambos).toMatch(/Perl de la cartera\s*5 · Equilibrado/);
    expect(ambos).toMatch(/Horizonte de la cartera\s*7 años/);
    const soloHorizonte = seccion(await hojas(entrada(3, { perfil: { horizon_years: 2.5 } })), "presentacion");
    expect(soloHorizonte).not.toContain("Perl de la cartera");
    expect(soloHorizonte).toMatch(/Horizonte de la cartera\s*2,5 años/);
    const ninguno = seccion(await hojas(entrada(3)), "presentacion");
    expect(ninguno).not.toMatch(/Perl de la cartera|Horizonte de la cartera|Sin denir/);
    const vacio = seccion(await hojas(entrada(3, { perfil: {} })), "presentacion");
    expect(vacio).not.toMatch(/Perl de la cartera|Horizonte de la cartera/);
  }, 40_000);
});

describe("las comisiones de entrada y salida salieron con los costes (A-143): ni ellas ni «impuestos» quedan en el papel", () => {
  test.each([
    ["10 con capital", () => entrada(10, { capital: 250_000 }), 6],
    ["3 sin capital", () => entrada(3), 6],
    ["5 sin capital", () => entrada(5), 6],
    ["8 con acciones", () => entrada(8, { capital: 400_000, acciones: 2 }), 6]
  ] as const)("%s: las secciones de siempre y ninguna línea de costes", async (_caso, input) => {
    const bytes = Buffer.from(await (await createInformeDeClientePdfBlob(input())).arrayBuffer());
    const paginas = extractPdfPageTexts(bytes).map(plano);
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    expect(paginas.join(" ")).not.toMatch(/comisiones|suscripción|reembolso|impuestos/);
    expect(lineasHuerfanasDeImpuestos(bytes)).toEqual([]);
    expect(lineasCon(bytes, "impuestos")).toEqual([]);
  }, 30_000);
});

/* La advertencia del pie la pone desde el paso 9 la plantilla, al cuerpo de su pie (7,9 pt; antes 7, Óscar, 11-11-2026): una vez por hoja,
   entera en una línea. Y el sello y «Página x de N», al mismo cuerpo. */
describe("la advertencia legal del pie, en cada hoja", () => {
  const ADVERTENCIA = "Rentabilidades pasadas no garantizan rentabilidades futuras";
  test.each([
    ["10 con capital", () => entrada(10, { capital: 250_000, perfil: { risk_profile_level: 5, horizon_years: 7 } })],
    ["3 sin capital", () => entrada(3)],
    ["solo acciones", () => entrada(4, { soloAcciones: true })],
    ["10 sin capital y dos fuera", () => entrada(10, { fuera: 2 })],
    ["25 con capital, acciones y fuera", () => entrada(25, { capital: 1_000_000, acciones: 3, fuera: 4 })]
  ] as const)("%s: en cada hoja, entera en una línea y al cuerpo del pie", async (_caso, input) => {
    const bytes = Buffer.from(await (await createInformeDeClientePdfBlob(input())).arrayBuffer());
    const paginas = extractPdfSizedRuns(bytes);
    for (const cadenas of paginas) {
      const advertencia = cadenas.filter((cadena) => cadena.texto.includes("Rentabilidades pasadas"));
      expect(advertencia.map((cadena) => [cadena.texto.trim(), cadena.puntos])).toEqual([[ADVERTENCIA, MEDIDAS.pie.letra]]);
    }
    const pie = paginas.flatMap((cadenas) => cadenas.filter((cadena) => /^Página \d+ de \d+$/.test(cadena.texto.trim())));
    expect(pie.length).toBe(paginas.length);
    expect(new Set(pie.map((cadena) => cadena.puntos))).toEqual(new Set([MEDIDAS.pie.letra]));
    expect(paginas.flat().find((cadena) => cadena.texto === "Fondo / estrategia")?.puntos).toBe(MEDIDAS.tabla.cabecera);
  }, 30_000);
});

/* ---------- La matriz de solapamiento vuelve al informe de cliente (Óscar, 12-11-2026) ---------- */

const PIE = new Set(["CONFIDENCIAL", "Rentabilidades pasadas no garantizan rentabilidades futuras"]);
/**
 * Lo que se escribe en el hueco del pie, sin el pie. Con la plantilla el cuerpo de cada hoja acaba a 60,5 pt del borde (841,89 − 60,5 ≈ 781):
 * una línea del cuerpo más abajo se montaría sobre el pie. Desde el 14-11-2026 (el aspecto de los informes de antes) el pie lleva a la
 * izquierda para quién es («Preparado para …»), delante del sello: también es pie.
 */
function lineasBajoElPie(bytes: Buffer): Array<{ hoja: number; texto: string; y: number }> {
  return extractPdfTextBaselines(bytes).flatMap((cadenas, hoja) => cadenas
    .filter((cadena) => !PIE.has(cadena.texto.trim()) && !/^Página \d+ de \d+$/.test(cadena.texto.trim()) && !cadena.texto.startsWith("Preparado para "))
    .filter((cadena) => cadena.y > 790)
    .map((cadena) => ({ hoja: hoja + 1, texto: cadena.texto, y: Math.round(cadena.y) })));
}
async function bytesDe(input: InformeDeClientePdfInput, guardarComo?: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await createInformeDeClientePdfBlob(input)).arrayBuffer());
  if (guardarComo && process.env.BDB_WRITE_PDF_PREVIEW === "true") {
    const outputDir = path.resolve("output/pdf");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `matriz-${guardarComo}.pdf`), bytes);
  }
  return bytes;
}
const hojaDelSolapamiento = (paginas: string[]) => seccion(paginas, "solapamiento");

describe("la matriz de solapamiento, en el papel de cliente (Óscar, 12-11-2026)", () => {
  test("mismo umbral del 40 % en las frases y en la matriz, qué es el blanco, el otro fondo comparable y «Fuera de la matriz:»", async () => {
    const input = entrada(6, { acciones: 1 });
    /* La extracción pierde a veces la ligadura «fl» de «flexible» (en las frases sí, en los nombres de la matriz no): se compara sin ella. */
    const nombres = input.report.positions.map((p) => plano(p.display_name).replace(/fl/g, ""));
    const hoja = hojaDelSolapamiento(extractPdfPageTexts(await bytesDe(input, "medibles-y-no")).map(plano)).replace(/fl/g, "");
    /* El 0, el 1, el 2 y el 4 publican su cartera entera; el 3, el 20 %; el 5 es una acción. */
    const frase = hoja.indexOf("comparten al menos el 48,0 % de su cartera publicada.");
    const matriz = hoja.indexOf("Matriz de solapamiento · 3 de 4 fondos comparables");
    const nota = hoja.indexOf("La matriz muestra los cruces del 40 % o más.");
    const otroComparable = hoja.indexOf(`El otro fondo comparable no comparte el 40 % o más con ningún otro: ${nombres[4]}.`);
    const fuera = hoja.indexOf(FUERA_DE_LA_MATRIZ);
    expect(frase).toBeGreaterThan(-1);
    expect(matriz).toBeGreaterThan(frase);
    expect(nota).toBeGreaterThan(matriz);
    expect(otroComparable).toBeGreaterThan(nota);
    expect(fuera).toBeGreaterThan(otroComparable);
    const casillas = hoja.slice(matriz, nota);
    expect(casillas).toContain("al menos 68,0 %");
    expect(casillas).toContain("al menos 58,0 %");
    expect(casillas).toContain("al menos 48,0 %");
    expect(casillas).not.toMatch(/sin comunes|100 %/);
    for (const i of [3, 4, 5]) expect(casillas).not.toContain(nombres[i]);
    for (const i of [0, 1, 2]) expect(casillas).toContain(nombres[i]);
    expect(hoja.slice(nota, otroComparable)).toContain("En blanco: la diagonal, y los cruces medidos por debajo del 40 %.");
    expect(hoja.slice(fuera)).toContain(`${nombres[3]}: publica el 20,0 % de su cartera.`);
    expect(hoja.slice(fuera)).toContain(`Acción en directo, que no tiene cartera propia: ${nombres[5]}.`);
    expect(hoja).not.toMatch(/N\/D|No aplica|Posiciones no comparables/);
  }, 30_000);

  test("con menos de dos fondos medibles no hay matriz: la frase común lo dice, y la lista de lo que queda fuera", async () => {
    const base = entrada(4);
    const [f0, f1, f2, f3] = base.report.positions;
    const nombre = (posicion: { display_name: string }) => plano(posicion.display_name);
    const overlap = buildReportOverlap(base.report.positions, new Map([
      [f0.asset_id, holdings(f0.asset_id, [["A", 60], ["B", 40]])],
      [f1.asset_id, holdings(f1.asset_id, [["A", 20]])]
    ]), new Set([f3.asset_id]));
    const paginas = extractPdfPageTexts(await bytesDe({ ...base, overlap }, "uno-medible")).map(plano);
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    const hoja = hojaDelSolapamiento(paginas);
    expect(hoja).not.toContain("Matriz de solapamiento");
    expect(hoja).toContain("No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y solo hay uno.");
    const fuera = hoja.slice(hoja.indexOf(FUERA_DE_LA_MATRIZ));
    expect(fuera).toContain(`${nombre(f1)}: publica el 20,0 % de su cartera.`);
    expect(fuera).toContain(`${nombre(f2)}: no publica su cartera.`);
    expect(fuera).toContain(`${nombre(f3)}: no se ha podido leer su cartera.`);

    /* Solo acciones: la frase ya lo dice, y no se repite; no hay nada fuera de una matriz que no hay. */
    const acciones = hojaDelSolapamiento(extractPdfPageTexts(await bytesDe(entrada(4, { soloAcciones: true }))).map(plano));
    expect(acciones.split("son acciones, que no tienen subyacentes: el solapamiento no aplica.").length).toBe(2);
    expect(acciones).not.toMatch(/Matriz de solapamiento|Fuera de la matriz/);
  }, 30_000);

  test("un ETF con solo sus diez mayores queda fuera con su porcentaje; medido con la cartera completa de su emisor, entra", async () => {
    const base = entrada(4);
    const [f0, f1, etf, f3] = base.report.positions;
    expect(etf.instrument_type).toBe("ETF");
    const diezMayores = holdings(etf.asset_id, Array.from({ length: 10 }, (_, i) => [`TOP${i}`, 2.73] as [string, number]));
    const delProveedor = new Map([
      [f0.asset_id, holdings(f0.asset_id, [["A", 65], ["B", 35]])],
      [f1.asset_id, holdings(f1.asset_id, [["A", 60], ["C", 40]])],
      [etf.asset_id, diezMayores],
      [f3.asset_id, holdings(f3.asset_id, [["D", 100]])]
    ]);
    /* Lo que carga el informe de cliente: la fuente del proveedor, con las diez mayores del ETF. */
    const cargado = await loadReportOverlap(base.report.positions, { getAssetHoldingsMany: async (ids) => new Map(ids.map((id) => [id, delProveedor.get(id) ?? null])) });
    const hoja = hojaDelSolapamiento(extractPdfPageTexts(await bytesDe({ ...base, overlap: cargado }, "etf-diez-mayores")).map(plano));
    expect(hoja).toContain("Matriz de solapamiento · 2 de 3 fondos comparables");
    expect(hoja).toContain(`El otro fondo comparable no comparte el 40 % o más con ningún otro: ${plano(f3.display_name)}.`);
    expect(hoja.slice(hoja.indexOf(FUERA_DE_LA_MATRIZ))).toContain(`${plano(etf.display_name)}: publica el 27,3 % de su cartera.`);

    /* 14-11-2026, decisión de Óscar («con respecto a los ETF, no los dejes fuera»): con el modelo que le da la pantalla, medido con la
       cartera completa del emisor, el ETF entra en la matriz. Hasta ese día el papel lo apartaba («no se ha podido leer su cartera») y
       esta prueba lo exigía. La cuenta: el emisor da A 40, B 35 y E 25; con f0 (A 65, B 35) comparte min(40, 65) + min(35, 35) = 75;
       con f1 (A 60, C 40), min(40, 60) = 40; f0 y f1, min(65, 60) = 60. Los tres pares llegan al 40 %; f3 (D 100) no comparte nada. */
    const delEmisor: BdbAssetHoldings = { ...holdings(etf.asset_id, [["A", 40], ["B", 35], ["E", 25]]), issuer_portfolio: { source: "ishares", as_of: "2026-10-31", weighting: "MARKET_VALUE" } };
    const conElEmisor = buildReportOverlap(base.report.positions, new Map([...delProveedor, [etf.asset_id, delEmisor]]));
    expect(conElEmisor.positions[2].status).toBe("available");
    expect([conElEmisor.values[0][2], conElEmisor.values[1][2], conElEmisor.values[0][1], conElEmisor.values[2][3]]).toEqual([75, 40, 60, 0]);
    const papel = extractPdfPageTexts(await bytesDe({ ...base, overlap: conElEmisor }, "etf-con-emisor")).map(plano);
    const hojaConEmisor = hojaDelSolapamiento(papel);
    expect(hojaConEmisor).toContain("3 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(hojaConEmisor).toContain("Matriz de solapamiento · 3 de 4 fondos comparables");
    expect(hojaConEmisor).toContain(`${plano(f0.display_name)} y ${plano(etf.display_name)} comparten al menos el 75,0 % de su cartera publicada.`);
    expect(hojaConEmisor).toContain(`El otro fondo comparable no comparte el 40 % o más con ningún otro: ${plano(f3.display_name)}.`);
    /* El ETF ya no está fuera de la matriz, y el papel no dice de quién es su cartera. */
    expect(hojaConEmisor).not.toContain(`${plano(etf.display_name)}: publica el 27,3 % de su cartera.`);
    expect(hojaConEmisor).not.toContain(`${plano(etf.display_name)}: no se ha podido leer su cartera.`);
    expect(papel.join(" ")).not.toMatch(/ishares|emisor/i);
  }, 30_000);

  /* Hasta el 14-11-2026 había aquí un filtro, `soloLaCarteraDelProveedor`, que dejaba sin cifra lo medido con la cartera del emisor
     antes de imprimirlo. Ya no existe: el modelo se imprime como llega. Lo que se sigue exigiendo es que el modelo diga qué posición se
     midió con la cartera de su emisor, porque el informe interno lo escribe. */
  test("el modelo conserva las cifras medidas con la cartera del emisor, y dice cuál es", () => {
    const filas = ["A", "B", "C"].map((id) => ({ asset_id: id, display_name: `Fondo ${id}`, weight_percent: 33, instrument_type: "FUND" }));
    const conEmisor = buildReportOverlap(filas, new Map([
      ["A", holdings("A", [["X", 60], ["Y", 40]])], ["B", holdings("B", [["X", 50], ["Z", 50]])],
      ["C", { ...holdings("C", [["X", 100]]), issuer_portfolio: { source: "vanguard", as_of: "2026-10-31", weighting: "DECLARED_WEIGHT" } }]
    ]));
    /* C es todo X: con A comparte min(100, 60) = 60 y con B, min(100, 50) = 50. A y B, min(60, 50) = 50. */
    expect(conEmisor.values[0][2]).toBe(60);
    expect(conEmisor.values[1][2]).toBe(50);
    expect(conEmisor.values[0][1]).toBe(50);
    expect(conEmisor.positions[2]).toMatchObject({ status: "available", issuerPortfolio: { source: "vanguard", as_of: "2026-10-31" } });
    expect(conEmisor.positions[0]).not.toHaveProperty("issuerPortfolio");
  });

  test.each([
    /* Desde cuatro posiciones, la cuarta publica el 20 % y va debajo de la matriz. */
    ["3 sin capital", () => entrada(3)],
    ["5 sin capital", () => entrada(5)],
    ["6 con una acción", () => entrada(6, { acciones: 1 })],
    ["8 reales con capital y una fuera", () => entrada(8, { nombres: NOMBRES_REALES, nombresDeCategoria: CATEGORIAS_REALES, capital: 300_000, fuera: 1 })],
    ["10 con capital", () => entrada(10, { capital: 250_000 })],
    ["15 con capital", () => entrada(15, { capital: 400_000 })],
    ["25 con capital, acciones y fuera", () => entrada(25, { capital: 1_000_000, acciones: 3, fuera: 4 })]
  ] as const)("%s: una matriz junto a las crisis y nada por debajo del pie", async (caso, input) => {
    const bytes = await bytesDe(input(), caso.replace(/[^a-z0-9]+/gi, "-"));
    const paginas = extractPdfPageTexts(bytes).map(plano);
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    expect(lineasBajoElPie(bytes)).toEqual([]);
    const conMatriz = paginas.filter((p) => p.includes("Matriz de solapamiento"));
    expect(conMatriz).toHaveLength(1);
    expect(conMatriz[0]).toContain("Cada título común suma el menor de sus dos pesos.");
    expect(conMatriz[0]).toContain("En blanco: la diagonal, y los cruces medidos por debajo del 40 %.");
    expect(conMatriz[0].includes(FUERA_DE_LA_MATRIZ)).toBe(caso !== "3 sin capital");
    if (caso === "10 con capital") {
      expect(conMatriz[0]).toContain("Los otros 6 fondos comparables no comparten el 40 % o más con ningún otro:");
    }
    /* Las crisis abren hoja, y el solapamiento con su matriz va debajo. */
    expect(conMatriz[0]).toMatch(/\d\d Crisis pasadas/);
    expect(conMatriz[0]).toContain("Cómo se habría comportado esta composición");
    expect(conMatriz[0]).toContain("3 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(conMatriz[0]).toContain("comparten al menos el 48,0 % de su cartera publicada.");
  }, 30_000);

  test("con 15 fondos de nombres largos se conservan los pares nombrados y la nota de más de 100 %", async () => {
    const nombres = Array.from({ length: 15 }, (_, i) => `Fondo ${i + 1} de renta variable internacional de gran capitalización con cobertura de divisa en euros clase de acumulación para inversores institucionales`);
    const input = entrada(15, { nombres });
    const carteras = new Map(input.report.positions.map(({ asset_id }, i) => [asset_id, holdings(asset_id, [[i < 5 ? "COMUN" : `SOLO${i}`, 102]])]));
    const overlap = buildReportOverlap(input.report.positions, carteras);
    const bytes = await bytesDe({ ...input, overlap }, "15-medibles-nombres-largos");
    const paginas = extractPdfPageTexts(bytes).map(plano);
    const texto = paginas.join(" ");
    expect(texto).toContain("10 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(texto.match(/comparten más del 100 % de su cartera publicada\./g)).toHaveLength(5);
    expect(texto).toContain("Y 5 pares más por encima del 40 %.");
    expect(texto).toContain("Matriz de solapamiento");
    expect(texto).toContain("Los otros 10 fondos comparables no comparten el 40 % o más con ningún otro:");
    expect(texto).toContain("con efectivo en negativo o con derivados");
    expect(lineasBajoElPie(bytes)).toEqual([]);
  }, 30_000);

  test("los tonos de la matriz: siete pasos, en la tinta índigo de la plantilla, y la cifra se lee en cada uno", () => {
    expect([0, 0.05, 9.99, 10, 19.9, 20, 39.9, 40, 60, 80, 100, 347].map(pasoDeLaMatriz)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 6, 6]);
    expect(RAMPA_DE_LA_MATRIZ).toHaveLength(7);
    const luminancia = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contraste = (a: string, b: string) => {
      const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    RAMPA_DE_LA_MATRIZ.forEach((tono, paso) => {
      expect(contraste(tono, tintaSobreElPaso(paso)), `${paso} ${tono}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  test("nombreEnLineas: corta entre palabras, nunca dentro, y si no cabe termina en la última palabra entera con «…»", () => {
    const mide = (texto: string) => texto.length;
    expect(nombreEnLineas("Fondo de renta variable europea", 20, 3, mide)).toEqual(["Fondo de renta", "variable europea"]);
    const largo = "Neuberger Next Generation Connectivity Fund EUR A Accumulating Class - Unhedged";
    const lineas = nombreEnLineas(largo, 20, 3, mide);
    expect(lineas).toEqual(["Neuberger Next", "Generation", "Connectivity Fund…"]);
    for (const linea of lineas) expect(mide(linea)).toBeLessThanOrEqual(20);
    /* Sin guion colgando antes del «…». */
    expect(nombreEnLineas("Accumulating Class - Unhedged", 20, 1, mide)).toEqual(["Accumulating Class…"]);
    /* Una palabra sola más larga que la línea se recorta, sin salirse. */
    expect(nombreEnLineas("Superanchísimamentelargo y más", 10, 1, mide)).toEqual(["Superanch…"]);
    expect(nombreEnLineas("Superanchísimamentelargo", 10, 3, mide)).toEqual(["Superanch…"]);
    expect(nombreEnLineas("Fondo Superanchísimamentelargo EUR", 10, 3, mide)).toEqual(["Fondo", "Superanch…"]);
    expect(nombreEnLineas("ABCDEFG😀XYZ", 9, 2, mide)).toEqual(["ABCDEFG…"]);
  });

  test("la matriz reducida muestra los pares más altos aunque sean los fondos de menor peso", async () => {
    const nombres = Array.from({ length: 15 }, (_, i) => `Fondo de ejemplo ${String.fromCharCode(65 + i)}`);
    const input = entrada(15, { nombres, capital: 400_000 });
    const pesosComunes = [51, 55, 59, 64, 80, 92];
    const carteras = new Map(input.report.positions.map(({ asset_id }, i) => {
      const par = Math.floor((i - 3) / 2);
      const peso = pesosComunes[par];
      return [asset_id, holdings(asset_id, peso ? [[`COMUN${par}`, peso], [`PROPIO${i}`, 100 - peso]] : [[`PROPIO${i}`, 100]])];
    }));
    const bytes = await bytesDe({ ...input, overlap: buildReportOverlap(input.report.positions, carteras) }, "pares-mas-altos");
    const hoja = extractPdfPageTexts(bytes).map(plano).join(" ");
    const titulo = "Matriz de solapamiento reducida · 4 de 12 fondos con cruces del 40 % o más";
    expect(hoja).toContain(titulo);
    expect(hoja).toContain("6 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(hoja).toContain("Fondo de ejemplo F y Fondo de ejemplo G comparten al menos el 55,0 % de su cartera publicada.");
    const matriz = hoja.slice(hoja.indexOf(titulo), hoja.indexOf("Se priorizan los pares"));
    for (const nombre of nombres.slice(11)) expect(matriz).toContain(nombre);
    for (const nombre of nombres.slice(0, 11)) expect(matriz).not.toContain(nombre);
    expect(matriz.indexOf(nombres[13])).toBeLessThan(matriz.indexOf(nombres[11]));
    for (const peso of [80, 92]) expect(matriz).toContain(`al menos ${peso},0 %`);
    expect(hoja).toContain("Los otros 3 fondos comparables no comparten el 40 % o más con ningún otro: Fondo de ejemplo A, Fondo de ejemplo B y Fondo de ejemplo C.");
    expect(matriz).not.toMatch(/sin comunes|100 %/);
    expect(lineasBajoElPie(bytes)).toEqual([]);
  }, 30_000);
});
