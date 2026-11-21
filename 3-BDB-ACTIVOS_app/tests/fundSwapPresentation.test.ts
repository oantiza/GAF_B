import { describe, expect, test } from "vitest";
import { sortSwapAlternativesForPresentation } from "../src/core/fundSwapPresentation";
import type { SwapAlternative } from "../src/core/fundSwapper";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";

function asset(asset_id: string, display_name = asset_id): BdbAssetSearchResult {
  return {
    asset_id,
    display_name,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  };
}

function alt(asset_id: string, tier: 1 | 2 | 3, score: number): SwapAlternative {
  return { asset: asset(asset_id), tier, score };
}

describe("sortSwapAlternativesForPresentation", () => {
  test("ordena por afinidad, y dentro de ella por nota y por nombre", () => {
    const alternatives = [alt("tercero", 3, 9), alt("primero", 1, 2), alt("segundo", 2, 8), alt("primero-bis", 1, 2), alt("antes", 1, 5)];
    expect(sortSwapAlternativesForPresentation(alternatives).map((item) => item.asset.asset_id)).toEqual([
      "antes",
      "primero",
      "primero-bis",
      "segundo",
      "tercero"
    ]);
  });

  /* MET-4: la nota de uno no se pone contra la de otro de otro grupo. Grupo 1 (cierre 13/11): notas 1 y 2; grupo 2 (30/09): nota 9. */
  test("dentro de una afinidad, primero el grupo y después la nota; una nota alta de otro grupo no adelanta", () => {
    const nuevo = { metodo: "GEOMETRIC_CAGR", frecuencia: "WEEKLY", cierre: "2026-11-13" };
    const viejo = { ...nuevo, cierre: "2026-09-30" };
    const alternatives = [
      { ...alt("viejo-alto", 1, 9), grupo: viejo }, { ...alt("nuevo-bajo", 1, 1), grupo: nuevo }, { ...alt("nuevo-medio", 1, 2), grupo: nuevo }, { ...alt("otra-afinidad", 2, 50), grupo: nuevo }
    ];
    expect(sortSwapAlternativesForPresentation(alternatives).map((item) => item.asset.asset_id)).toEqual(["nuevo-medio", "nuevo-bajo", "viejo-alto", "otra-afinidad"]);
  });

  test("no recibe la retrocesión: la decisión 17 dice que el orden no la usa", () => {
    expect(sortSwapAlternativesForPresentation.length).toBe(1);
  });
});
