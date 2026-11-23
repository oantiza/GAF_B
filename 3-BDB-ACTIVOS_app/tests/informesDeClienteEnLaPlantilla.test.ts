/**
 * Los cuatro documentos de cliente que se pasaron a la plantilla única el 14-11-2026 —la comparativa de propuestas, el
 * informe de costes, la propuesta de cambio y la simulación de jubilación—, leídos sobre el PDF generado: ninguna marca de
 * entidad ni hueco de código; el sello «CONFIDENCIAL» en la cabecera y en el pie de todas las hojas; «Página x de N» en
 * todas; la identidad del asesor cuando la hay y nada cuando no; y la cifra principal, la misma que da el cálculo y con el
 * formato común.
 *
 * Con `INFORMES_PDF=<carpeta>` escribe allí cada PDF, el normal y uno largo, para mirarlos.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { importeTitular, rentabilidad } from "../src/core/formato";
import { respuestaAlMes } from "../src/core/jubilacion/lectura";
import { calcular, DEFECTO, type ResultadoDisponible } from "../src/core/jubilacion/motor";
import { calculatePortfolioCosts, calculatePortfolioManagementFee } from "../src/core/portfolioCosts";
import { alignPortfolioComparison } from "../src/core/portfolioComparison";
import { comparisonPositionRows } from "../src/core/portfolioComparisonReport";
import { propuestaDeCambio, type EntradaDeLaPropuesta } from "../src/core/propuestaDeCambio";
import { createComparisonPdfBlob, type ComparePdfInput } from "../src/reports/comparePdf";
import { createCostsPdfBlob } from "../src/reports/costsPdf";
import { createJubilacionPdfBlob } from "../src/reports/jubilacionPdf";
import { createPropuestaDeCambioPdfBlob } from "../src/reports/propuestaDeCambioPdf";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { comparisonAssets, comparisonFixture } from "./support/portfolioComparisonFixtures";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines, extractPdfTextRuns } from "./support/pdfText";
import { ACTIVOS, ACTUAL, activo, crisisConCifra, escenario, historia, PROPUESTA, SERIE_ACTUAL, SERIE_PROPUESTA } from "./support/propuestaFixtures";

const ASESOR = { name: "Marta Ruiz Alonso", email: "marta.ruiz@ejemplo.invalid" };
const SIN_ASESOR = { name: "  ", email: "" };
const ESPACIO_DURO = String.fromCharCode(0xa0);

async function bytesDe(blob: Promise<Blob>, nombre: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await blob).arrayBuffer());
  const carpeta = process.env.INFORMES_PDF;
  if (carpeta) {
    mkdirSync(path.join(carpeta, nombre.split("/")[0]), { recursive: true });
    writeFileSync(path.join(carpeta, `${nombre}.pdf`), bytes);
  }
  return bytes;
}

/** El alto de cada hoja, de su MediaBox. */
const altos = (bytes: Buffer) => [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => Number(m[2]));

/** Lo que tiene que cumplir cualquier hoja de un documento de cliente de la plantilla. */
function comoDocumentoDeCliente(bytes: Buffer, documento: string) {
  const hojas = extractPdfPageTexts(bytes);
  const texto = hojas.join("\n");
  for (const prohibido of ["Independent", "Private Bankers", "INDEPENDENT", "N/D", "NaN", "undefined", "Fraunces", "Roboto"]) expect(texto, prohibido).not.toContain(prohibido);
  /* Las letras de la plantilla, Fraunces y Roboto Flex desde el 14-11-2026; ninguna de las retiradas. */
  expect(bytes.toString("latin1")).not.toMatch(/IBMPlexSans|SourceSerif4|Newsreader|InstrumentSans/);
  const alturas = altos(bytes);
  extractPdfTextBaselines(bytes).forEach((cadenas, i) => {
    const sellos = cadenas.filter((c) => c.texto.trim() === "CONFIDENCIAL");
    expect(sellos.some((c) => c.y < 60), `hoja ${i + 1}: sello en la cabecera`).toBe(true);
    expect(sellos.some((c) => c.y > alturas[i] - 40), `hoja ${i + 1}: sello en el pie`).toBe(true);
    expect(cadenas.filter((c) => c.y < 60).map((c) => c.texto.trim()), `hoja ${i + 1}: qué documento es`).toContain(documento);
    const pie = cadenas.find((c) => /^Página \d+ de \d+$/.test(c.texto.trim()));
    expect(pie?.texto.trim(), `hoja ${i + 1}`).toBe(`Página ${i + 1} de ${hojas.length}`);
  });
  return hojas;
}

/** La cabecera de la primera hoja: el membrete y lo de la derecha. */
const cabecera = (bytes: Buffer) => extractPdfTextBaselines(bytes)[0].filter((c) => c.y < 60).map((c) => c.texto.trim());
/** Las cadenas tal cual, con su espacio duro: el texto por hojas lo cambia por uno normal. */
const cadenas = (bytes: Buffer) => extractPdfTextRuns(bytes).flat().join("\n");

function comprobarIdentidad(con: Buffer, sin: Buffer) {
  expect(cabecera(con)).toContain(ASESOR.name);
  expect(cabecera(con)).toContain(ASESOR.email);
  expect(extractPdfMetadata(con, "Author")).toBe(ASESOR.name);
  expect(cabecera(sin).join(" ")).not.toContain(ASESOR.name);
  expect(extractPdfMetadata(sin, "Author")).toBeNull();
}

/* ------------------------------------------------------------------------------------------------ Comparativa */

function entradaDeLaComparativa(posiciones = 6): ComparePdfInput {
  const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
  const nombres = ["Global Quality EUR", "Europa Selección", "Tecnología Global", "Bonos Euro Flexible", "Crédito Global", "Liquidez EUR"];
  const assets = Array.from({ length: posiciones }, (_, i) => ({
    ...comparisonAssets[0],
    asset_id: `MUESTRA-${i + 1}`,
    display_name: posiciones > 6 ? `ÁGUILA ÍNDICE ÑOÑO ${i} · Fondo de inversión internacional de renta variable europea con selección activa de compañías` : nombres[i],
    economic_asset_class: i % 3 === 2 ? "FIXED_INCOME" : "EQUITY",
    category: i % 3 === 2 ? "Renta fija flexible EUR" : "Renta variable global",
    currency: i % 4 === 1 ? "USD" : "EUR"
  } as BdbAssetDetail));
  const pesos = (sesgo: number) => assets.map((a, i) => ({ asset_id: a.asset_id, weight_percent: 100 / posiciones + (i === 0 ? sesgo : i === 1 ? -sesgo : 0) }));
  const sesgo = posiciones > 6 ? 1 : 4;
  return {
    nameA: "Cartera Alfa · Equilibrada", nameB: "Cartera Beta · Crecimiento", periodLabel: result.periodLabel, riskFree: result.riskFree,
    a: { posiciones }, b: { posiciones }, history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    positions: comparisonPositionRows(pesos(sesgo), pesos(-sesgo), assets),
    classRows: [{ label: "Renta variable", a: 66.7, b: 70 }, { label: "Renta fija", a: 33.3, b: 30 }],
    coverage: { a: { weight: 100, included: posiciones, total: posiciones }, b: { weight: 100, included: posiciones, total: posiciones } },
    clientName: "Familia García"
  };
}

describe("la comparativa de propuestas", () => {
  test("en la plantilla, con su sello, sus páginas, la identidad y la rentabilidad del cálculo", async () => {
    const input = entradaDeLaComparativa();
    const con = await bytesDe(createComparisonPdfBlob({ ...input, banker: ASESOR }), "comparativa/comparativa");
    const sin = await bytesDe(createComparisonPdfBlob({ ...input, banker: SIN_ASESOR }), "comparativa/comparativa-sin-asesor");
    comoDocumentoDeCliente(con, "Comparativa de propuestas");
    comoDocumentoDeCliente(sin, "Comparativa de propuestas");
    comprobarIdentidad(con, sin);
    /* Desde el 14-11-2026 (el aspecto de los informes de antes) «Preparado para» va en el pie de cada hoja. */
    for (const hoja of extractPdfPageTexts(con)) expect(hoja).toContain("Preparado para Familia García");
    const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
    expect(cadenas(con)).toContain(rentabilidad(result.metricsA.cagr)!);
    expect(cadenas(con)).toContain(rentabilidad(result.metricsB.cagr)!);
    expect(rentabilidad(result.metricsA.cagr)).toContain(ESPACIO_DURO);
  }, 60_000);

  test("un caso largo: 29 posiciones de nombres largos, todas una vez y con la cabecera de su tabla", async () => {
    const bytes = await bytesDe(createComparisonPdfBlob(entradaDeLaComparativa(29)), "comparativa/comparativa-larga");
    const hojas = comoDocumentoDeCliente(bytes, "Comparativa de propuestas");
    const conFilas = hojas.filter((hoja) => /MUESTRA-\d+/.test(hoja));
    for (const hoja of conFilas) expect(hoja).toContain("Activo / identicador");
    const vistas = conFilas.flatMap((hoja) => [...hoja.matchAll(/MUESTRA-(\d+) ·/g)].map((m) => Number(m[1])));
    expect([...vistas].sort((x, y) => x - y)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  }, 60_000);
});

/* ------------------------------------------------------------------------------------------------ Costes */

describe("el informe de costes", () => {
  test("en la plantilla, con su sello, sus páginas, la identidad y la cifra del cálculo", async () => {
    const costs = calculatePortfolioCosts(costPositions, costAssets, 100000);
    const management = { enabled: true, unit: "percent" as const, input: "0.5" };
    const con = await bytesDe(createCostsPdfBlob({ costs, management, clientName: "Familia García", banker: ASESOR }), "costes/costes");
    const sin = await bytesDe(createCostsPdfBlob({ costs, management, banker: SIN_ASESOR }), "costes/costes-sin-asesor");
    comoDocumentoDeCliente(con, "Costes de la propuesta");
    comoDocumentoDeCliente(sin, "Costes de la propuesta");
    comprobarIdentidad(con, sin);
    /* 1.758,26 € de los productos y 500 € de la comisión: 2.258 €, en euros enteros porque es una estimación. */
    const fee = calculatePortfolioManagementFee(costs, 0.5, "percent");
    expect(cadenas(con)).toContain(importeTitular(fee.combinedAnnualEur)!);
    expect(importeTitular(fee.combinedAnnualEur)).toBe(`2.258${ESPACIO_DURO}€`);
  }, 60_000);

  test("un caso largo: 45 posiciones, todas una vez, con la cabecera de su tabla y el total junto a las últimas", async () => {
    const assets = Array.from({ length: 45 }, (_, i) => ({ ...costAssets[0], asset_id: `PRUEBA${String(i).padStart(2, "0")}`, isin: `PRUEBA${String(i).padStart(2, "0")}`, display_name: i % 3 ? `Fondo ${i}` : `Principal Global Investors Funds - Finisterre Unconstrained Emerging Market Fxd Inc Fd A Hdg Acc EUR ${i}`, costs: i % 7 ? costAssets[0].costs : {} }));
    const bytes = await bytesDe(createCostsPdfBlob({ costs: calculatePortfolioCosts(assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 45 })), assets, 100000), management: { enabled: false, unit: "percent", input: "" } }), "costes/costes-largo");
    const hojas = comoDocumentoDeCliente(bytes, "Costes de la propuesta");
    const conFilas = hojas.filter((hoja) => /PRUEBA\d\d/.test(hoja));
    for (const hoja of conFilas) expect(hoja).toContain("Activo / ISIN");
    const vistas = conFilas.flatMap((hoja) => [...new Set([...hoja.matchAll(/PRUEBA(\d\d)/g)].map((m) => Number(m[1])))]);
    expect(vistas).toEqual(Array.from({ length: 45 }, (_, i) => i));
    /* «identificado» pierde su ligadura «fi» al extraer el texto. */
    const conTotal = hojas.find((hoja) => /Coste corriente anual\s+identi/.test(hoja));
    expect(conTotal).toContain("PRUEBA44");
  }, 60_000);
});

/* ------------------------------------------------------------------------------------------------ Propuesta de cambio */

const entradaDeLaPropuesta = (cambios: Partial<EntradaDeLaPropuesta> = {}): EntradaDeLaPropuesta => ({
  actual: ACTUAL,
  propuesta: PROPUESTA,
  periodo: "3Y",
  historiaActual: historia(["LU0000000001", "LU0000000002"], SERIE_ACTUAL, { stress_scenarios: [crisisConCifra("COVID", -20.57), crisisConCifra("RATES_2022", -14.87), escenario("COMMON_HISTORY")] }),
  historiaPropuesta: historia(["LU0000000001", "LU0000000003", "ES0144580Y14"], SERIE_PROPUESTA, { stress_scenarios: [crisisConCifra("COVID", -24.1), crisisConCifra("RATES_2022", -11.2), escenario("COMMON_HISTORY")] }),
  assets: ACTIVOS,
  capital: 100000,
  cliente: "Familia García",
  motivo: "Bajar el coste corriente.",
  generadoEn: "2026-11-05T09:00:00Z",
  ...cambios
});

describe("la propuesta de cambio", () => {
  test("en la plantilla, con su sello, sus páginas, la identidad y las cifras del cálculo", async () => {
    const modelo = propuestaDeCambio(entradaDeLaPropuesta({ responsable: ASESOR }));
    const con = await bytesDe(createPropuestaDeCambioPdfBlob(modelo), "propuesta/propuesta");
    const sin = await bytesDe(createPropuestaDeCambioPdfBlob(propuestaDeCambio(entradaDeLaPropuesta({ responsable: SIN_ASESOR }))), "propuesta/propuesta-sin-asesor");
    comoDocumentoDeCliente(con, "Propuesta de cambio");
    comoDocumentoDeCliente(sin, "Propuesta de cambio");
    comprobarIdentidad(con, sin);
    /* Las cifras las escribe `core/propuestaDeCambio`: el papel las imprime tal cual. */
    const texto = cadenas(con);
    for (const fila of modelo.cifras.filas) {
      expect(texto).toContain(fila.actual);
      expect(texto).toContain(fila.propuesta);
    }
    expect(texto).toContain(modelo.totalActual);
  }, 60_000);

  test("un caso largo: 28 posiciones de nombres largos y un motivo largo, todas con la cabecera de su tabla", async () => {
    const muchos = Array.from({ length: 28 }, (_, i) => activo(`LU10000000${String(i).padStart(2, "0")}`, i % 3 === 0 ? `Un fondo de nombre muy largo con clase institucional acumulativa en euros cubierta número ${i}` : `Fondo global ${i}`, i % 5 ? 0.01 : null));
    const a = muchos.slice(0, 16).map((m, i) => ({ asset_id: m.asset_id, weight_percent: 100 / 16 + (i === 0 ? 1 : i === 1 ? -1 : 0) }));
    const b = muchos.slice(8).map((m) => ({ asset_id: m.asset_id, weight_percent: 5 }));
    const bytes = await bytesDe(createPropuestaDeCambioPdfBlob(propuestaDeCambio(entradaDeLaPropuesta({
      actual: { name: "Una cartera con un nombre bastante largo, para ver si se come el sitio de la tabla", positions: a },
      propuesta: { name: "Propuesta", positions: b },
      assets: muchos,
      historiaActual: historia(a.map((p) => p.asset_id), SERIE_ACTUAL),
      historiaPropuesta: historia(b.map((p) => p.asset_id), SERIE_PROPUESTA),
      motivo: "Un motivo largo. ".repeat(70).trim()
    }))), "propuesta/propuesta-larga");
    const hojas = comoDocumentoDeCliente(bytes, "Propuesta de cambio");
    hojas.forEach((hoja, i) => {
      if (/LU10000000\d\d/.test(hoja)) expect(hoja, `hoja ${i + 1}`).toMatch(/Posición/);
    });
  }, 60_000);
});

/* ------------------------------------------------------------------------------------------------ Jubilación */

function resultado(entrada = {}): ResultadoDisponible {
  const r = calcular(entrada);
  if (!r.disponible) throw new Error(r.mensaje);
  return r;
}

describe("la simulación de jubilación", () => {
  test("en la plantilla, con su sello, sus páginas, la identidad y la cifra del cálculo, y dice que es una simulación", async () => {
    const res = resultado();
    const base = { resultado: res, unidades: "hoy" as const, formas: null, supuestos: [], ejemplo: false, date: "13 de noviembre de 2026", clientName: "Familia García" };
    const con = await bytesDe(createJubilacionPdfBlob({ ...base, banker: ASESOR }), "jubilacion/jubilacion");
    const sin = await bytesDe(createJubilacionPdfBlob({ ...base, banker: SIN_ASESOR }), "jubilacion/jubilacion-sin-asesor");
    const hojas = comoDocumentoDeCliente(con, "Simulación de jubilación");
    comoDocumentoDeCliente(sin, "Simulación de jubilación");
    comprobarIdentidad(con, sin);
    /* La cifra es la de las líneas de la respuesta, que la suman: 2.576 € al mes en el caso de regresión del motor. */
    const neto = respuestaAlMes(res, "hoy").find((linea) => linea.clave === "neto")!.alMes;
    expect(cadenas(con)).toContain(importeTitular(neto)!);
    expect(importeTitular(neto)).toBe(`2.576${ESPACIO_DURO}€`);
    /* Junto a la cifra y en el pie de cada hoja. */
    expect(hojas[0]).toContain("Ingreso neto al mes · simulación");
    for (const hoja of hojas) expect(hoja).toContain("Simulación: no es una previsión");
  }, 60_000);

  test("un caso largo: de los 55 a los 105 años, con EPSV y lo supuesto", async () => {
    const entrada = { ...DEFECTO, edad: 55, edadJubilacion: 55, edadFin: 105, tieneEpsv: true, epsvPre: 200000, epsvPreRent: 80000, epsvPost: 30000, epsvPostRent: 5000, epsvRenta: "vitalicia" as const };
    const bytes = await bytesDe(createJubilacionPdfBlob({ resultado: resultado(entrada), unidades: "hoy", formas: null, supuestos: ["Falta el coste de adquisición de los fondos de inversión: se calcula con el coste igual al valor de hoy."], ejemplo: true, clientName: "Cliente con un nombre bastante largo para la primera hoja" }), "jubilacion/jubilacion-larga");
    const hojas = comoDocumentoDeCliente(bytes, "Simulación de jubilación · ejemplo");
    for (const hoja of hojas) expect(hoja).toContain("Ejemplo con cifras inventadas");
  }, 60_000);
});
