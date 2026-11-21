/**
 * Revisión final (V6-1): la Comparativa de activos con M&G (Lux) Asian Fund EUR A Acc. La pantalla dice «Falta el dato» a 10 años y, debajo de la tabla,
 * por qué: su serie solo vale desde el 26-10-2018 (decisión 112). El PDF, también en su salida para el cliente, imprimía «N/D» sin motivo, que es lo que
 * la 84 quitó del papel. La frase es la de la pantalla, sacada de la misma tarjeta, y va debajo de «Rentabilidad anualizada».
 */
import { describe, expect, test } from "vitest";
import { notasDeLaComparativa, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";
import { createAssetComparisonPdfBlob, type AssetComparePdfInput } from "../src/reports/assetComparePdf";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

const fuente = (asset_id: string, display_name: string, metrics: Record<string, unknown>): FuenteDeColumna =>
  ({ activo: { asset_id, display_name } as BdbAssetSearchResult, tarjeta: { instrument_id: asset_id, metrics } }) as unknown as FuenteDeColumna;

const MG_ASIAN = fuente("LU1670618187", "M&G (Lux) Asian Fund EUR A Acc", { series_valid_from: "2018-10-26", windows_before_series_valid_from: ["10y"] });
const ISHARES = fuente("IE00B4L5Y983", "iShares Core MSCI World UCITS ETF USD (Acc)", {});
const FRASE = "M&G (Lux) Asian Fund EUR A Acc. Falta el dato a 10 años: su serie solo vale desde el 26/10/2018, y ese periodo empieza antes.";

const entrada = (notasDeLaSerie: readonly string[], salida: AssetComparePdfInput["salida"]): AssetComparePdfInput => ({
  assets: [
    { name: "M&G (Lux) Asian Fund EUR A Acc", color: "#143D66", isin: "LU1670618187", instrumentType: "FUND", currency: "EUR", return1y: 0.187, return3y: 0.236, return5y: 0.122, volatility3y: 0.156, sharpe3y: 1.27, maxDrawdown: -0.182 },
    { name: "iShares Core MSCI World UCITS ETF USD (Acc)", color: "#B66A3C", isin: "IE00B4L5Y983", instrumentType: "ETF", currency: "USD", return1y: 0.16, return3y: 0.202, return5y: 0.114, return10y: 0.128, volatility3y: 0.119, sharpe3y: 1.39, maxDrawdown: -0.217 }
  ],
  windowLabel: "02/11/2023 a 03/11/2026 · 3A · 741 obs. diarias",
  benchmarkName: null,
  maxDrawdownLabel: "Máx. caída 3A",
  methodologyFootnote: "Sharpe 3A: calculado por nosotros en euros, mensual.",
  correlation: null,
  notasDeLaSerie,
  salida
});

const texto = async (input: AssetComparePdfInput) =>
  extractPdfPageTexts(Buffer.from(await (await createAssetComparisonPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");

describe("la Comparativa de activos dice por qué falta una ventana, como la pantalla (decisión 112)", () => {
  test("la frase sale de la tarjeta, la misma que pinta la pantalla, solo para quien la tiene", () => {
    expect(notasDeLaComparativa([MG_ASIAN, ISHARES])).toEqual([FRASE]);
  });

  test.each(["cliente", "interno"] as const)("en la salida %s, debajo de la rentabilidad y antes del riesgo", async (salida) => {
    const impreso = await texto(entrada(notasDeLaComparativa([MG_ASIAN, ISHARES]), salida));
    const posicion = impreso.indexOf(FRASE);
    expect(posicion).toBeGreaterThan(impreso.indexOf("Rentabilidad anualizada"));
    expect(posicion).toBeLessThan(impreso.indexOf("Riesgo"));
  }, 15_000);

  test("sin ventana fuera de la serie no hay frase", async () => {
    expect(notasDeLaComparativa([ISHARES])).toEqual([]);
    expect(await texto(entrada([], "cliente"))).not.toContain("su serie solo vale desde");
  }, 15_000);
});
