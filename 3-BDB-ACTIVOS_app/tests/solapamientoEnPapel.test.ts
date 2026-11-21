/**
 * Decisión 47 en el informe de cliente: lo que dicen las frases del solapamiento y su nota. El cálculo lo prueba `src/core/overlap.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { buildReportOverlap, type OverlapPosition } from "../src/core/reportOverlap";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { extractPdfPageTexts } from "./support/pdfText";
import type { BdbAssetHoldings, BdbPortfolioReport } from "../src/types/bdbAssets";

const fondo = (asset_id: string, weight_percent: number, instrument_type = "FUND"): OverlapPosition => ({ asset_id, display_name: asset_id, weight_percent, instrument_type });
const cartera = (asset_id: string, lineas: Array<[string, number]>, as_of_date = "2026-08-31"): BdbAssetHoldings => ({
  asset_id,
  storage_mode: "SINGLE_DOCUMENT",
  as_of_date,
  holdings: lineas.map(([name, weight_pct]) => ({ name, isin: name, weight_pct }))
});

async function hojaDelSolapamiento(posiciones: OverlapPosition[], carteras: BdbAssetHoldings[]): Promise<string> {
  const report = {
    portfolio_name: "Prueba",
    mode: "BBDD_STATIC_EXPORT_SAMPLE",
    positions: posiciones.map((row) => ({ ...row, economic_asset_class: "EQUITY" })),
    summary: { total_weight_percent: 100, weighted_metrics: {}, by_economic_asset_class: [], by_instrument_type: [] },
    xray: { by_region: [] },
    warnings: [],
    data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
  const entrada = {
    report,
    overlap: buildReportOverlap(posiciones, new Map(carteras.map((c) => [c.asset_id, c]))),
    totalCapital: 100000,
    generadoEn: "2026-09-06T12:00:00Z",
    feasibility: {}
  } as unknown as Parameters<typeof createInformeDeClientePdfBlob>[0];
  const hojas = extractPdfPageTexts(Buffer.from(await (await createInformeDeClientePdfBlob(entrada)).arrayBuffer()));
  return hojas.find((hoja) => hoja.includes("Solapamiento entre fondos"))!.replace(/\s+/g, " ");
}

/* Desde el 10-11-2026 el informe de cliente lo dice en frases, y desde el 12-11-2026 también en la matriz: la misma cifra, con las mismas palabras de «al menos». */
describe("el solapamiento en el informe de cliente (decisión 47)", () => {
  test("una cifra dice «al menos», sin redondear hacia arriba, y la nota dice qué se suma; no dice que estén normalizadas", async () => {
    const hoja = await hojaDelSolapamiento(
      [fondo("A", 50), fondo("B", 50)],
      [cartera("A", [["X", 3.21], ["R1", 96.79]]), cartera("B", [["X", 3.29], ["R2", 96.71]])]
    );
    /* Lo común es min(3,21, 3,29) = 3,21. */
    expect(hoja).toContain("A y B comparten al menos el 3,2 % de su cartera publicada.");
    expect(hoja).toContain("Ningún par de fondos llega al 40 % de lo que publican.");
    expect(hoja).toContain("no cuentan los derivados ni el efectivo, cuando el dato los distingue.");
    expect(hoja).not.toContain("Matriz de solapamiento");
    expect(hoja).not.toContain("normalizadas");
    expect(hoja).not.toMatch(/[Mm]ás de(l)? 100 %/);
  }, 30_000);

  /* IMP-7 (17-11-2026): 30-jun → 31-jul son 31 días y no avisa; 30-jun → 1-ago son 32 y avisa, con las dos fechas. */
  test("con las carteras de fechas separadas por más de un mes, la hoja las nombra; a 31 días, no", async () => {
    const lineas: Array<[string, number]> = [["X", 3.21], ["R1", 96.79]];
    const lejos = (await hojaDelSolapamiento([fondo("A", 50), fondo("B", 50)], [cartera("A", lineas, "2026-06-30"), cartera("B", lineas, "2026-08-01")])).replace(/(\p{L})- (\p{L})/gu, "$1$2");
    expect(lejos).toContain("la de A, del 30/06/2026, y la de B, del 01/08/2026 (32 días)");
    const cerca = await hojaDelSolapamiento([fondo("A", 50), fondo("B", 50)], [cartera("A", lineas, "2026-06-30"), cartera("B", lineas, "2026-07-31")]);
    expect(cerca).not.toContain("fechas separadas");
    expect(cerca).not.toContain("No consta");
  }, 30_000);

  test.each([[39.95, false], [40, true]] as const)("umbral del 40 % o más antes de redondear: %s %%", async (peso, hayMatriz) => {
    const hoja = await hojaDelSolapamiento(
      [fondo("A", 50), fondo("B", 50)],
      [cartera("A", [["X", peso], ["R1", 100 - peso]]), cartera("B", [["X", peso], ["R2", 100 - peso]])]
    );
    expect(hoja).toContain(`A y B comparten al menos el ${hayMatriz ? "40,0" : "39,9"} % de su cartera publicada.`);
    expect(hoja.includes("Matriz de solapamiento · 2 de 2 fondos comparables")).toBe(hayMatriz);
    expect(hoja.includes("Ningún par de fondos llega al 40 % de lo que publican.")).toBe(!hayMatriz);
  }, 30_000);

  test("lo que pasa de 100 dice «más del 100 %» y por qué, sin el número", async () => {
    /* Sin código, el forward no se quita (decisión 87), y sigue pasando de 100. */
    const hoja = await hojaDelSolapamiento(
      [fondo("CLASE_A", 50), fondo("CLASE_B", 50)],
      [cartera("CLASE_A", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]]), cartera("CLASE_B", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]])]
    );
    expect(hoja).toContain("CLASE_A y CLASE_B comparten más del 100 % de su cartera publicada.");
    expect(hoja).toContain("«Más de 100 %»: lo común pasa del 100 % porque los dos fondos invierten más que su patrimonio, con efectivo en negativo o con derivados; no es una parte de la cartera.");
    expect(hoja).not.toContain("330");
  }, 30_000);

  test("decisión 88: nunca «al menos 0,0 %»; lo que no llega a una décima dice «menos del 0,1 %», y un par sin nada en común no se nombra", async () => {
    /* A y B no comparten nada; A y C comparten «X», min(0,05, 0,08) = 0,05; B y C, nada. */
    const hoja = await hojaDelSolapamiento(
      [fondo("A", 40), fondo("B", 30), fondo("C", 30)],
      [cartera("A", [["X", 0.05], ["R1", 99.95]]), cartera("B", [["R2", 100]]), cartera("C", [["X", 0.08], ["R3", 99.92]])]
    );
    expect(hoja).not.toContain("al menos el 0,0");
    expect(hoja).toContain("A y C comparten menos del 0,1 % de su cartera publicada.");
    expect(hoja).not.toMatch(/A y B comparten|B y C comparten/);
  }, 30_000);

  test("sin ningún par con cifra, ninguna cota «al menos el …»: dice por qué", async () => {
    const hoja = await hojaDelSolapamiento(
      [fondo("ES0144580Y14", 50, "STOCK"), fondo("CORTO", 50)],
      [cartera("CORTO", [["X", 30]])]
    );
    expect(hoja).not.toMatch(/al menos el \d|comparten/);
    expect(hoja).toContain("Entre ellas hay un solo fondo: no hay dos fondos que comparar.");
    expect(hoja).toContain("El fondo no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: CORTO.");
    expect(hoja).toContain("La acción no entra: no tiene subyacentes.");
  }, 30_000);
});
