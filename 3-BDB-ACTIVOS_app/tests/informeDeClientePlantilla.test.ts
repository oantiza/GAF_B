/**
 * El informe de cliente de una propuesta en la plantilla única (paso 9 del rediseño): sobre el PDF generado, ninguna marca de entidad ni
 * texto roto, «CONFIDENCIAL» en la cabecera y en el pie de cada hoja, «Página x de N», la identidad del asesor cuando la hay y su
 * ausencia cuando no, y las cifras principales con el formato común y las mismas que da el cálculo. Y lo propio de este documento: la
 * primera hoja presenta y abre con las cifras, la tabla de posiciones repite su cabecera y no pierde filas, los importes suman el total
 * impreso, los colores del mapa y de la matriz con la cifra siempre escrita, y que no lleva costes ni nada del emisor.
 *
 * Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) el documento vuelve a abrir con la portada a página
 * completa, con la rejilla, y la tabla de posiciones empieza en la segunda. Las cifras que responden **no van en la portada** (Óscar,
 * 15-11-2026): tienen su sección, «Cifras de la cartera», tras el reparto y delante de la geografía.
 * El mapa vuelve a un color por zona y la matriz a la rampa de bronce del papel de cliente.
 *
 * Con `INFORMES_PDF=<carpeta>` deja los PDF en `<carpeta>/informe-de-cliente/`.
 */
import { describe, expect, test } from "vitest";
import type { BacktestResponse } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { importe, importeTitular, peso, porcentaje, ratio, rentabilidad } from "../src/core/formato";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import { buildReportOverlap, type ReportOverlap } from "../src/core/reportOverlap";
import {
  BLANCO_DESDE_EL_PASO,
  COLORES_DE_ZONA,
  colorDeLaCifra,
  createInformeDeClientePdfBlob,
  importesQueSuman,
  RAMPA_DE_LA_MATRIZ,
  rellenoDeLaZona,
  rentabilidadPorDividendoDe,
  tintaSobreElPaso,
  ZONA_SIN_PESO,
  type InformeDeClientePdfInput
} from "../src/reports/informeDeClientePdf";
import { RAMPA_DEL_TEMA, SIN_CLASIFICAR } from "../src/reports/plantilla";
import type { BdbAssetDetail, BdbAssetHoldings, BdbPortfolioReport } from "../src/types/bdbAssets";
import { comprobarPlantilla, guardarSiSePide, IDENTIDAD_DE_PRUEBA } from "./support/comprobarPlantilla";
import { extractPdfPageTexts, extractPdfTextBaselines, extractPdfTextRuns } from "./support/pdfText";
import { SERIES_HASTA_20260928 } from "./support/referenciaDePrueba";

const DOCUMENTO = "Informe de la propuesta";
const ESPACIO_DURO = " ";

/* ---------- Una cartera de prueba: fondos, ETF y acciones, dos divisas, y nombres de largo real. ---------- */

const NOMBRES = [
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

function cartera(n: number, { acciones = 0, nombres }: { acciones?: number; nombres?: (i: number) => string } = {}) {
  const pesos = Array.from({ length: n }, (_, i) => n - i);
  const total = pesos.reduce((s, p) => s + p, 0);
  const filas = pesos.map((p, i) => {
    const accion = i >= n - acciones;
    return {
      asset_id: accion ? `ES00${String(1000000 + i)}0` : `LU0${String(900000000 + i)}`,
      display_name: nombres?.(i) ?? (accion ? `Acción española ${i + 1} S.A.` : `${NOMBRES[i % NOMBRES.length]}${i >= NOMBRES.length ? ` ${i + 1}` : ""}`),
      instrument_type: accion ? "STOCK" : i % 4 === 2 ? "ETF" : "FUND",
      economic_asset_class: accion || i % 2 ? "EQUITY" : "FIXED_INCOME",
      currency: i % 3 === 2 ? "USD" : "EUR",
      weight_percent: (p / total) * 100
    };
  });
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
      by_category: [{ key: "RV Global Cap. Grande Blend", weight_percent: 40 }, { key: "RF Bonos Corporativos EUR", weight_percent: 35 }, { key: "Mixtos Flexibles EUR", weight_percent: 25 }],
      pms_exposure_percent: { equity: 55, fixed_income: 40, cash: 3, alternative: 2, real_asset: 0, other: 0 }
    },
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
  /* Los fondos llevan también rentabilidad por dividendo y coste corriente en su ficha: el papel no debe enseñar ninguna de las dos. */
  const activos = filas.map((fila, i) => ({
    asset_id: fila.asset_id, instrument_type: fila.instrument_type, costs: { ongoing_charge: 0.0085 },
    fundamentals_summary: { dividends: { yield_ratio: fila.instrument_type === "STOCK" ? [0.0412, 0.0275, 0.0538][i % 3] : 0.0199 } }
  })) as unknown as BdbAssetDetail[];
  return { report, activos, ids: filas.map((fila) => fila.asset_id) };
}

function backtest(medidos: string[], todos: string[]): BacktestResponse {
  const series = Array.from({ length: 158 }, (_, i) => ({
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
    metrics: { cagr: 0.13, volatility: 0.09, sharpe: 1.2, max_drawdown: -0.1, rf_rate: 0.02 }, benchmark_series: {},
    stress_scenarios: [crisis("COVID", "2020-02-19", "2020-03-23", -20.567835), crisis("RATES_2022", "2022-01-04", "2022-10-12", -14.865142)],
    synthetics: [], risk_free: { risk_free_source: "ECB_ESTR", risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: { requested_assets: todos.length, included_assets: medidos.length, common_observations: 158, first_date: series[0].date, last_date: series.at(-1)!.date },
    excluded_assets: todos.filter((id) => !medidos.includes(id)).map((asset_id) => ({ asset_id, reason: "INSUFFICIENT_HISTORY" }))
  } as unknown as BacktestResponse;
}

const holdings = (asset_id: string, lineas: Array<[string, number]>): BdbAssetHoldings => ({
  asset_id, storage_mode: "SINGLE_DOCUMENT", as_of_date: "2026-08-31", holdings: lineas.map(([name, weight_pct]) => ({ name, isin: name, weight_pct }))
});

/** Los tres primeros fondos cruzan al 68 %, 58 % y 48 %; los demás publican su cartera entera y no comparten nada. */
function solapamiento(report: BdbPortfolioReport): ReportOverlap {
  const carteras = new Map<string, BdbAssetHoldings>();
  report.positions.forEach((posicion, i) => {
    if (posicion.instrument_type === "STOCK") return;
    if (i === 0) carteras.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN2", 20], ["PROPIO0", 32]]));
    else if (i === 1) carteras.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN2", 20], ["COMUN3", 10], ["PROPIO1", 22]]));
    else if (i === 2) carteras.set(posicion.asset_id, holdings(posicion.asset_id, [["COMUN1", 48], ["COMUN3", 10], ["PROPIO2", 42]]));
    else carteras.set(posicion.asset_id, holdings(posicion.asset_id, [[`SOLO${i}`, 100]]));
  });
  return buildReportOverlap(report.positions, carteras);
}

function entrada(n: number, opciones: { capital?: number; acciones?: number; fuera?: number; identidad?: InformeDeClientePdfInput["identidad"]; nombres?: (i: number) => string } = {}): InformeDeClientePdfInput {
  const { report, activos, ids } = cartera(n, opciones);
  const medidos = ids.slice(0, ids.length - (opciones.fuera ?? 0));
  const pesoMedido = report.positions.filter((p) => medidos.includes(p.asset_id)).reduce((s, p) => s + p.weight_percent, 0);
  const analysis = { window: "3Y", years: 3, referenceVersion: "test", backtest: backtest(medidos, ids), frontier: null, equalWeight: null, maxSharpe: null, coverageWeightPercent: pesoMedido, extensions: [], methodology: "Estimación" } as unknown as PortfolioHorizon;
  return {
    report,
    analysis,
    generadoEn: "2026-11-13T12:00:00Z",
    feasibility: { status: "FEASIBLE", blocking_issues: [], warnings: [], locked_weight: 0, unlocked_budget: 1 } as unknown as PortfolioFeasibilityCheck,
    totalCapital: opciones.capital,
    clientName: "Familia García",
    referencia: SERIES_HASTA_20260928,
    overlap: solapamiento(report),
    regionRows: [{ key: "europe", weight_percent: 50 }, { key: "united_states", weight_percent: 35 }, { key: "japan", weight_percent: 15 }],
    rentabilidadPorDividendo: rentabilidadPorDividendoDe(activos),
    perfilYHorizonte: { risk_profile_level: 5, horizon_years: 7 },
    identidad: opciones.identidad
  };
}

async function generar(input: InformeDeClientePdfInput, nombre: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await createInformeDeClientePdfBlob(input)).arrayBuffer());
  guardarSiSePide(bytes, "informe-de-cliente", nombre);
  return bytes;
}

/** El texto de todo el documento, con un solo espacio y sin la ligadura «fi», que el lector pierde. */
const plano = (texto: string) => texto.replace(/\s+/g, " ").replace(/fi/g, "");
const todoElTexto = (bytes: Buffer) => extractPdfPageTexts(bytes).map(plano).join(" ");

describe("el informe de cliente en la plantilla única", () => {
  test("diez posiciones, con capital y con la identidad del asesor: lo común de la plantilla y las cifras del cálculo", async () => {
    const bytes = await generar(entrada(10, { capital: 250_000, identidad: IDENTIDAD_DE_PRUEBA }), "10-con-capital-e-identidad");
    comprobarPlantilla(bytes, { tema: "cliente", documento: DOCUMENTO, identidad: IDENTIDAD_DE_PRUEBA.nombre, portada: true });
    const hojas = extractPdfPageTexts(bytes).map(plano);
    for (const hoja of hojas) expect(hoja).toContain("Preparado para Familia García");
    /* La primera hoja es la portada: presenta, con la valoración en su rejilla, y no da ninguna cifra de la cartera. */
    const primera = hojas[0];
    expect(primera).toContain("Informe de su cartera");
    expect(primera).toContain("Elaborado por Marta Ruiz Alonso");
    expect(primera).toContain("Periodo de análisis del 25/08/2023 al ");
    expect(primera).toContain("Fecha de creación 13 de noviembre de 2026");
    expect(primera).toContain("Perl de la cartera 5 · Equilibrado");
    expect(primera).toContain("Horizonte de la cartera 7 años");
    const cadenasPorHoja = extractPdfTextRuns(bytes);
    const cadenas = cadenasPorHoja[0];
    expect(cadenas, importeTitular(250_000)!).toContain(importeTitular(250_000)!);
    expect(cadenas).toContain(`250.000${ESPACIO_DURO}€`);
    const CIFRAS = [rentabilidad(0.13)!, porcentaje(0.09)!, ratio(1.2)!, porcentaje(-0.1)!];
    for (const cifra of CIFRAS) expect(cadenas, cifra).not.toContain(cifra);
    expect(primera).not.toMatch(/Rentabilidad anualizada|Tipo sin riesgo/);
    /* Las cifras que responden, del cálculo y con el formato común, en su sección: la hoja que abre «Cifras de la cartera». */
    const hojaDeLasCifras = hojas.findIndex((hoja) => hoja.includes("03 Cifras de la cartera"));
    expect(hojaDeLasCifras).toBeGreaterThan(0);
    const cadenasDeLasCifras = cadenasPorHoja[hojaDeLasCifras];
    for (const cifra of CIFRAS) expect(cadenasDeLasCifras, cifra).toContain(cifra);
    expect(cadenasDeLasCifras).toContain(`+13,00${ESPACIO_DURO}%`);
    expect(cadenasDeLasCifras).toContain(`−10,00${ESPACIO_DURO}%`);
    /* Sin la nota del tipo sin riesgo (Óscar, 22-11-2026). */
    expect(hojas[hojaDeLasCifras]).not.toContain("Tipo sin riesgo");
    /* La portada es una hoja entera: la tabla de posiciones empieza en la segunda, con el título grande de la hoja. */
    expect(primera).not.toContain("01 Composición de la cartera");
    expect(hojas[1]).toContain("01 Composición de la cartera");
    /* Lo que no lleva: ni costes, ni nada del emisor, ni la marca de antes. */
    expect(hojas.join(" ")).not.toMatch(/coste|gastos|comisi|emisor|ishares.*cartera completa|Fraunces/i);
  }, 60_000);

  test("sin identidad ni capital: la cabecera sin membrete, sin «Elaborado por», sin importe y sin valoración", async () => {
    const bytes = await generar(entrada(3), "3-sin-capital-ni-identidad");
    comprobarPlantilla(bytes, { tema: "cliente", documento: DOCUMENTO, identidad: null, portada: true });
    const texto = todoElTexto(bytes);
    expect(texto).not.toContain("Elaborado por");
    expect(texto).not.toMatch(/Valoración actual|Importe/);
  }, 60_000);

  test("el «Elaborado por» del diálogo pasa por encima de la identidad guardada, y su correo va al membrete", async () => {
    const bytes = await generar({ ...entrada(3, { identidad: { nombre: "Nombre guardado", entidad: "Ruiz & Asociados" } }), banker: { name: "Marta López", email: "marta@ejemplo.es" } }, "3-con-banker");
    comprobarPlantilla(bytes, { tema: "cliente", documento: DOCUMENTO, identidad: "Marta López", portada: true });
    /* La cabecera de las hojas: la entidad en el granate del tema y, debajo, quién firma y su correo. La portada lo dice en «Elaborado por». */
    const cabecera = extractPdfTextBaselines(bytes)[1].filter((c) => c.y < 60).map((c) => c.texto.trim());
    expect(cabecera).toContain("Ruiz & Asociados");
    expect(cabecera).toContain("Marta López · marta@ejemplo.es");
    expect(todoElTexto(bytes)).toContain("Elaborado por Marta López Ruiz & Asociados · marta@ejemplo.es");
    expect(todoElTexto(bytes)).not.toContain("Nombre guardado");
  }, 60_000);

  test("el caso largo: 40 posiciones con nombres largos, acciones y posiciones fuera; la tabla repite su cabecera, no pierde filas y suma", async () => {
    const largo = (i: number) => `Posición ${String(i + 1).padStart(2, "0")} de renta variable europea de gran capitalización con cobertura de divisa en euros, clase A de acumulación`;
    const input = entrada(40, { capital: 1_000_000, acciones: 4, fuera: 6, nombres: largo, identidad: IDENTIDAD_DE_PRUEBA });
    const bytes = await generar(input, "40-nombres-largos");
    comprobarPlantilla(bytes, { tema: "cliente", documento: DOCUMENTO, identidad: IDENTIDAD_DE_PRUEBA.nombre, portada: true });
    const hojas = extractPdfPageTexts(bytes).map(plano);
    /* Una fila de la tabla es el nombre con su apunte detrás (clase · ISIN); el solapamiento nombra los fondos sin él. */
    const fila = /Posición (\d\d) de renta variable [^·]+? acumulación [^·]+ · (?:LU0|ES00)/g;
    const conLaTabla = hojas.filter((hoja) => hoja.match(fila) !== null);
    expect(conLaTabla.length).toBeGreaterThan(1);
    for (const hoja of conLaTabla) expect(hoja).toContain("Fondo / estrategia");
    const vistas = conLaTabla.flatMap((hoja) => [...hoja.matchAll(fila)].map((m) => Number(m[1])));
    expect(vistas).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    /* El total va con las últimas filas, y los importes impresos suman el total impreso. */
    const conElTotal = hojas.find((hoja) => hoja.includes("Total cartera"))!;
    expect(conElTotal).toContain("Posición 40 de renta variable");
    const importes = importesQueSuman(1_000_000, input.report.positions.map((p) => p.weight_percent).sort((a, b) => b - a));
    expect(importes.reduce((s, x) => s! + x!, 0)).toBe(1_000_000);
    const cadenas = extractPdfTextRuns(bytes).flat();
    for (const cifra of importes) expect(cadenas).toContain(importe(cifra));
    expect(cadenas).toContain(importe(1_000_000));
    expect(cadenas).toContain(peso(1));
    /* Nada se escribe en el hueco del pie: el cuerpo acaba antes. */
    extractPdfTextBaselines(bytes).forEach((hoja, i) => {
      const cuerpo = hoja.filter((c) => c.y > 60 && c.y < 841.89 - 40);
      for (const cadena of cuerpo) expect(cadena.y, `hoja ${i + 1}: ${cadena.texto}`).toBeLessThan(841.89 - 54);
    });
  }, 90_000);
});

/* Desde el 14-11-2026 el mapa y la matriz vuelven a los colores del papel de cliente de antes (decisión de Óscar): un color por zona, y la
   rampa de bronce. Antes de ese día eran una sola tinta índigo por tramos de peso. */
describe("los colores del mapa y de la matriz", () => {
  const luminancia = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a: string, b: string) => {
    const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  test("los siete pasos de la matriz van de claro a oscuro en la rampa de bronce, y la cifra se lee en cada uno (4,5:1)", () => {
    expect(RAMPA_DE_LA_MATRIZ).toEqual(RAMPA_DEL_TEMA.cliente);
    expect(RAMPA_DE_LA_MATRIZ).toEqual(["#F7F3EC", "#EFE7D8", "#E3D6BE", "#D0BD9A", "#B89D72", "#86694A", "#5F4A33"]);
    expect(BLANCO_DESDE_EL_PASO).toBe(5);
    for (let i = 1; i < RAMPA_DE_LA_MATRIZ.length; i++) expect(luminancia(RAMPA_DE_LA_MATRIZ[i])).toBeLessThan(luminancia(RAMPA_DE_LA_MATRIZ[i - 1]));
    RAMPA_DE_LA_MATRIZ.forEach((tono, paso) => expect(contraste(tono, tintaSobreElPaso(paso)), `paso ${paso}`).toBeGreaterThanOrEqual(4.5));
  });

  test("el mapa: cada zona con su color (al menos 3:1), la que va en «Resto» con el del resto, y el gris claro sin peso", () => {
    for (const [zona, color] of Object.entries(COLORES_DE_ZONA)) expect(contraste(color, "#FFFFFF"), zona).toBeGreaterThanOrEqual(3);
    expect(new Set(Object.values(COLORES_DE_ZONA)).size).toBe(Object.keys(COLORES_DE_ZONA).length);
    const cifras = [{ id: "europe" }, { id: "north_america" }, { id: "resto" }, { id: "unassigned", sinZona: true }];
    expect(rellenoDeLaZona("europe", 40, cifras)).toBe(COLORES_DE_ZONA.europe);
    expect(rellenoDeLaZona("north_america", 30, cifras)).toBe(COLORES_DE_ZONA.north_america);
    /* Japón no tiene cifra propia: va sumado en «Resto de zonas», y se pinta con su color, el que dice la tira. */
    expect(rellenoDeLaZona("japan", 5, cifras)).toBe(colorDeLaCifra({ id: "resto" }));
    expect(rellenoDeLaZona("japan", 0, cifras)).toBe(ZONA_SIN_PESO);
    expect(colorDeLaCifra({ id: "unassigned", sinZona: true })).toBe(SIN_CLASIFICAR);
  });

  test("en papel: la leyenda de las zonas del mapa y la cifra en cada casilla de la matriz", async () => {
    const texto = todoElTexto(await generar(entrada(6), "6-mapa-y-matriz"));
    /* La leyenda nombra las zonas de la tira, en su orden; y la tira da cada una con su cifra. */
    expect(texto).toContain("Europa Norteamérica Japón Europa 50,0 % Norteamérica 35,0 % Japón 15,0 %");
    expect(texto).toMatch(/Europa 50,0 %/);
    for (const cifra of ["68,0 %", "58,0 %", "48,0 %"]) expect(texto).toContain(`al menos ${cifra}`);
  }, 60_000);
});
