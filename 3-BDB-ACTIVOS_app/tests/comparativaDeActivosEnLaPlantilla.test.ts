/**
 * La comparativa de activos en la plantilla única: el tema lo decide la salida (cliente o interno), la cabecera lleva la
 * identidad del asesor, el coste corriente de la pantalla tiene su columna (ACT-09) y las cifras salen con el formato
 * común. Se lee el PDF generado.
 */
import { describe, expect, test } from "vitest";
import { porcentaje, ratio, rentabilidad } from "../src/core/formato";
import { createAssetComparisonPdfBlob, type AssetComparePdfAsset, type AssetComparePdfInput } from "../src/reports/assetComparePdf";
import { IDENTIDAD_DE_PRUEBA, comprobarPlantilla, guardarSiSePide } from "./support/comprobarPlantilla";
import { extractPdfPageTexts, extractPdfTextRuns } from "./support/pdfText";

const FONDO: AssetComparePdfAsset = {
  name: "MFS European Research A1 EUR",
  isin: "LU0094557526",
  instrumentType: "FUND",
  currency: "EUR",
  category: "RV Europa Cap. Grande Blend",
  morningstarRating: 4,
  return1y: 0.184,
  return3y: 0.121,
  return5y: 0.098,
  return10y: -0.0074,
  volatility1y: 0.112,
  volatility3y: 0.128,
  sharpe3y: 0.82,
  maxDrawdown: -0.243,
  maxDrawdownLabel: "Máx. caída 3A",
  costeCorriente: 0.0159,
  retro: 0.0055,
  base100: 141.2
};

const ACCION: AssetComparePdfAsset = {
  name: "Iberdrola",
  isin: "ES0144580Y14",
  instrumentType: "STOCK",
  currency: "EUR",
  sector: "Utilities",
  return1y: 0.21,
  return3y: 0.15,
  volatility1y: 0.17,
  volatility3y: 0.19,
  maxDrawdown: -0.18,
  maxDrawdownLabel: "Máx. caída 3A",
  costeCorriente: "no-aplica",
  retro: "no-aplica",
  base100: 150.3
};

const BASE: AssetComparePdfInput = {
  assets: [FONDO, ACCION, { ...FONDO, name: "Un fondo sin el coste", isin: "LU0000000003", costeCorriente: null, retro: undefined, base100: 120.4 }],
  windowLabel: "Del 01/09/2023 al 03/09/2026 · 157 datos semanales",
  benchmarkName: "Equilibrado",
  benchmarkBase100: 123.4,
  maxDrawdownLabel: "Máx. caída 3A",
  methodologyFootnote: "Sharpe 3A calculado con €STR como activo sin riesgo.",
  correlation: {
    labels: ["MFS European Research A1 EUR", "Iberdrola", "Un fondo sin el coste"],
    matrix: [[1, 0.42, 0.91], [0.42, 1, null], [0.91, null, 1]]
  },
  salida: "cliente",
  generado: new Date(2026, 10, 14, 10, 0)
};

async function generar(input: AssetComparePdfInput, nombre?: string) {
  const bytes = Buffer.from(await (await createAssetComparisonPdfBlob(input)).arrayBuffer());
  if (nombre) guardarSiSePide(bytes, "comparativa-de-activos", nombre);
  const hojas = extractPdfPageTexts(bytes);
  return { bytes, hojas, texto: hojas.join(" ").replace(/\s+/g, " "), cadenas: extractPdfTextRuns(bytes).flat().join("\n") };
}

describe("la comparativa de activos en la plantilla", () => {
  test("salida para el cliente: tema de cliente, la identidad del asesor y ni rastro de la retrocesión", async () => {
    const { bytes, texto } = await generar({ ...BASE, identidad: IDENTIDAD_DE_PRUEBA }, "cliente");
    comprobarPlantilla(bytes, { tema: "cliente", documento: "Comparativa de activos", identidad: "Marta Ruiz Alonso" });
    expect(texto).not.toMatch(/retroces|Retro/);
    expect(texto).not.toContain("0,55 %");
  }, 30_000);

  test("salida interna: tema interno, «No entregar al cliente» y la columna de la retrocesión", async () => {
    const { bytes, texto } = await generar({ ...BASE, salida: "interno", identidad: IDENTIDAD_DE_PRUEBA }, "interno");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Comparativa de activos", identidad: "Marta Ruiz Alonso" });
    const riesgo = texto.split("Riesgo y coste")[1];
    expect(riesgo).toContain("Retrocesión");
    expect(riesgo).toContain("0,55 %");
  }, 30_000);

  test("sin identidad guardada, la cabecera queda sin membrete y el documento sin autor", async () => {
    const { bytes } = await generar({ ...BASE, identidad: {} }, "sin-identidad");
    comprobarPlantilla(bytes, { tema: "cliente", documento: "Comparativa de activos", identidad: null });
  }, 30_000);

  test("las cifras son las de la entrada, con el formato común: espacio duro, menos tipográfico, signo en la rentabilidad", async () => {
    const { cadenas } = await generar({ ...BASE, identidad: {} });
    for (const esperada of [
      rentabilidad(0.184),
      rentabilidad(-0.0074),
      porcentaje(0.112),
      porcentaje(-0.243),
      ratio(0.82),
      porcentaje(0.0159)
    ]) expect(cadenas, esperada!).toContain(esperada!);
    /* A mano: 0,184 → «+18,40 %»; −0,0074 → «−0,74 %»; −0,243 → «−24,30 %». */
    expect(cadenas).toContain("+18,40 %");
    expect(cadenas).toContain("−24,30 %");
    expect(cadenas).not.toMatch(/(^|[\s(])-\d/);
    /* Ninguna ventana abreviada: «1 año», «3 años», nunca «1A» ni «3A» (revisión del 14-11-2026). */
    expect(cadenas).not.toMatch(/\b\d+A\b/);
    expect(cadenas).toContain("Sharpe a 3 años calculado");
  }, 30_000);

  test("el coste corriente de la pantalla (ACT-09): la cifra, «No aplica» en una acción y «Falta el dato» sin él", async () => {
    const { texto } = await generar({ ...BASE, identidad: {} });
    const riesgo = texto.split("Riesgo y coste")[1].split("Evolución comparada")[0];
    expect(riesgo).toContain("Coste corriente");
    const fila = (nombre: string) => riesgo.split(nombre)[1].split(/\d\. /)[0];
    expect(fila("MFS European Research A1 EUR")).toContain("1,59 %");
    expect(fila("Iberdrola")).toContain("No aplica");
    expect(fila("Un fondo sin el coste")).toContain("Falta el dato");
  }, 30_000);

  test("si la pantalla no pasa el coste, no hay columna: el papel no dice que falta lo que no se le ha dado", async () => {
    const { texto } = await generar({ ...BASE, identidad: {}, assets: BASE.assets.map((activo) => ({ ...activo, costeCorriente: undefined })) });
    expect(texto).not.toContain("Coste corriente");
    expect(texto).toContain("Riesgo");
    expect(texto).not.toContain("Riesgo y coste");
  }, 30_000);

  test("un caso largo: cinco activos con nombres largos y datos que faltan, sin hojas vacías", async () => {
    const largo = (i: number): AssetComparePdfAsset => ({
      name: `Fondo de inversión con un nombre muy largo número ${i} Global Sustainable Opportunities Equity I Acc EUR Hedged`,
      isin: `LU00000000${i}0`,
      instrumentType: "FUND",
      currency: i % 2 ? "USD" : "EUR",
      category: "EAA Fund Global Emerging Markets Corporate Bond - EUR Hedged",
      return3y: i % 2 ? 0.05 : undefined,
      volatility3y: 0.08,
      maxDrawdown: i === 3 ? undefined : -0.12,
      costeCorriente: i === 2 ? null : 0.012,
      base100: 110 + i
    });
    const { bytes, hojas } = await generar(
      {
        ...BASE,
        identidad: IDENTIDAD_DE_PRUEBA,
        salida: "interno",
        assets: [1, 2, 3, 4, 5].map(largo),
        correlation: { labels: [1, 2, 3, 4, 5].map((i) => largo(i).name), matrix: [1, 2, 3, 4, 5].map((f) => [1, 2, 3, 4, 5].map((c) => (f === c ? 1 : f === 4 || c === 4 ? null : -0.3 + 0.2 * c))) },
        noComparable: { columnas: ["annualized_return-3y"], sinDeclarar: false }
      },
      "largo"
    );
    comprobarPlantilla(bytes, { tema: "interno", documento: "Comparativa de activos", identidad: "Marta Ruiz Alonso" });
    for (const hoja of hojas) expect(hoja.length).toBeGreaterThan(400);
    expect(hojas.join(" ")).toContain("Matriz de correlación");
  }, 30_000);
});
