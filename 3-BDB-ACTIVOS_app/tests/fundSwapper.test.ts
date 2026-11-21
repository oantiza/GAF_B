import { describe, expect, test, vi } from "vitest";
import { EMPTY_SWAP_FILTERS, filterSwapAlternatives, findHomogeneousAlternatives, findSwapAlternatives, motivoSinAlternativas, sectorComparable, sectorLegible } from "../src/core/fundSwapper";
import { loadSwapUniverse } from "../src/core/swapUniverse";
import type { BdbAssetSearchResult, InstrumentType } from "../src/types/bdbAssets";

function asset(id: string, overrides: Partial<BdbAssetSearchResult> = {}): BdbAssetSearchResult {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY",
    currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE",
    region: "Europe", category: "Global Equity", quality_flags: [], warnings: [], metrics: { sharpe_3y: 0.5 }, ...overrides
  };
}

describe("MET-4: las alternativas se ordenan dentro de cada grupo de cifras comparables", () => {
  const con = (id: string, as_of: string, ret: number) => asset(id, { metrics: { annualized_return_3y: ret, metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY", as_of } });

  test("una rentabilidad alta con otro cierre no adelanta a las de la fecha más reciente, y cada una lleva su grupo", () => {
    const source = asset("source");
    /* Cierre del 13/11: 5 % y 7 %. Cierre del 30/09: 20 %. Antes, el 20 % iba primero; ahora, 7, 5 y después el otro grupo. */
    const universe = [con("a", "2026-11-13", 0.05), con("viejo", "2026-09-30", 0.20), con("b", "2026-11-13", 0.07)];
    const alternativas = findHomogeneousAlternatives(source, universe);
    expect(alternativas.map(({ asset }) => asset.asset_id)).toEqual(["b", "a", "viejo"]);
    expect(alternativas.map(({ grupo }) => grupo?.cierre)).toEqual(["2026-11-13", "2026-11-13", "2026-09-30"]);
  });

  test("las acciones siguen por nombre y sin grupo: el orden no mira cifras", () => {
    const accion = (id: string, as_of: string) => asset(id, { instrument_type: "STOCK", sector: "Utilities", region: "Iberia", metrics: { annualized_return_3y: 0.1, as_of } });
    const alternativas = findHomogeneousAlternatives(accion("source", "2026-11-13"), [accion("Zeta", "2026-11-13"), accion("Alfa", "2026-09-30")], [], 8);
    expect(alternativas.map(({ asset }) => asset.asset_id)).toEqual(["Alfa", "Zeta"]);
    expect(alternativas.every(({ grupo }) => grupo === undefined)).toBe(true);
  });
});

describe("alternativas homogéneas", () => {
  test.each<InstrumentType>(["FUND", "ETF", "STOCK"])("%s solo admite su mismo vehículo, aunque otro tenga mayor Sharpe", (type) => {
    const source = asset("source", { instrument_type: type, sector: "Utilities" });
    const universe = (["FUND", "ETF", "STOCK"] as const).map((instrument_type) => asset(instrument_type, { instrument_type, sector: "Utilities", metrics: { sharpe_3y: instrument_type === type ? 0.1 : 5 } }));
    expect(findHomogeneousAlternatives(source, universe).map(({ asset }) => asset.asset_id)).toEqual([type]);
  });

  test("mantiene clase, afinidad y exclusiones, sin relajar la regla cuando faltan candidatos", () => {
    const source = asset("source");
    const universe = [source, asset("held"), asset("bond", { economic_asset_class: "FIXED_INCOME" }),
      asset("benchmark", { role: "BENCHMARK" }), asset("blocked", { is_investable: false }),
      asset("far", { region: "Asia" }), asset("close"), asset("regional", { category: "Small Cap" })];
    expect(findHomogeneousAlternatives(source, universe, ["held"]).map(({ asset, tier }) => [asset.asset_id, tier]))
      .toEqual([["close", 1], ["regional", 2], ["far", 3]]);
    expect(findHomogeneousAlternatives(source, [asset("stock", { instrument_type: "STOCK" })])).toEqual([]);
  });

  test("la elección libre permite otros vehículos y clases, con filtros combinables", () => {
    const source = asset("source");
    const bond = asset("ES0000000001", { display_name: "Crédito Europeo", economic_asset_class: "FIXED_INCOME", category: "Corporate", region: "Europe" });
    const all = findSwapAlternatives(source, [source, bond, asset("stock", { instrument_type: "STOCK" }), asset("etf", { instrument_type: "ETF" }), asset("held")], ["held"], "custom", Infinity);
    expect(all).toHaveLength(3);
    expect(all.every(({ tier }) => tier === 4)).toBe(true);
    const filters = { ...EMPTY_SWAP_FILTERS, instrumentType: "FUND" as const, assetClass: "FIXED_INCOME" as const, category: "Corporate", region: "Europe", query: "credito" };
    expect(filterSwapAlternatives(all, filters).map(({ asset }) => asset.asset_id)).toEqual([bond.asset_id]);
    expect(filterSwapAlternatives(all, { ...filters, query: bond.asset_id })).toHaveLength(1);
    expect(filterSwapAlternatives(all, { ...filters, region: "Asia" })).toEqual([]);
    expect(filterSwapAlternatives(all, { ...EMPTY_SWAP_FILTERS, instrumentType: "ETF" })).toHaveLength(1);
  });
});

/**
 * Decisión 16. Los nombres son los de verdad: en la base local, las 8 alternativas de Iberdrola eran Indra, Unicaja, Sabadell, BBVA,
 * CaixaBank, Santander, IAG y ACS, todas «Muy afín» porque solo compartían «Iberia»; por el camino de la web, Siemens Energy, Micron,
 * GE Vernova y Palantir, ordenadas por lo que más ha subido.
 */
describe("las alternativas de una acción", () => {
  const accion = (nombre: string, sector: string | undefined, region: string | undefined, rentabilidad = 0.1) =>
    asset(nombre, { instrument_type: "STOCK", sector, region, category: undefined, metrics: { annualized_return_3y: rentabilidad } });
  const iberdrola = accion("Iberdrola", "Utilities", "Iberia");
  const nombresYNivel = (alternativas: { asset: BdbAssetSearchResult; tier: number }[]) => alternativas.map(({ asset, tier }) => [asset.display_name, tier]);

  test("«Muy afín» es mismo sector y región; «Afín», mismo sector; bancos y aerolíneas no salen", () => {
    const universo = [
      accion("Santander", "Financial Services", "Iberia"),
      accion("BBVA", "Financial Services", "Spain"),
      accion("IAG", "Industrials", "Iberia"),
      accion("Palantir", "Technology", "EE.UU.", 0.9),
      accion("NextEra", "Utilities", "EE.UU."),
      accion("Endesa", "Utilities", "Iberia"),
      accion("Audax", "Utilities", "Spain"),
      accion("E.ON", "Utilities", "Germany"),
      accion("Engie", "Utilities", "Europa")
    ];
    expect(nombresYNivel(findHomogeneousAlternatives(iberdrola, universo))).toEqual([
      ["Audax", 1],
      ["E.ON", 1],
      ["Endesa", 1],
      ["Engie", 1],
      ["NextEra", 2]
    ]);
  });

  test("con las etiquetas del camino de producción sale lo mismo", () => {
    const universo = [accion("Endesa", "Utilities", "Eurozona"), accion("National Grid", "Utilities", "Reino Unido"), accion("NextEra", "Utilities", "EE.UU."), accion("Santander", "Financial Services", "Eurozona")];
    expect(nombresYNivel(findHomogeneousAlternatives(accion("Iberdrola", "Utilities", "Eurozona"), universo))).toEqual([["Endesa", 1], ["National Grid", 1], ["NextEra", 2]]);
  });

  test("el orden es por nombre, nunca por lo que ha subido", () => {
    const universo = [accion("Zeta", "Utilities", "Iberia", 0.9), accion("Alfa", "Utilities", "Iberia", -0.2), accion("Ñu", "Utilities", "Iberia", 0.5)];
    expect(findHomogeneousAlternatives(iberdrola, universo).map(({ asset }) => asset.display_name)).toEqual(["Alfa", "Ñu", "Zeta"]);
  });

  test("no se recorta a 8: cortar por el abecedario dejaría fuera a Naturgy", () => {
    const universo = ["A", "B", "C", "D", "E", "F", "G", "H", "Naturgy", "Redeia"].map((nombre) => accion(nombre, "Utilities", "Iberia"));
    expect(findHomogeneousAlternatives(iberdrola, universo)).toHaveLength(10);
  });

  test("sin sector no hay equivalente, y lo dice; tampoco se empareja con otra acción sin sector", () => {
    const sinSector = accion("Sin sector", undefined, "Iberia");
    const universo = [accion("Otra sin sector", undefined, "Iberia"), accion("Endesa", "Utilities", "Iberia")];
    expect(findHomogeneousAlternatives(sinSector, universo)).toEqual([]);
    expect(motivoSinAlternativas(sinSector)).toBe("No se puede proponer un equivalente: no tenemos el sector de esta acción.");
    expect(motivoSinAlternativas(iberdrola)).toBe("No hay otras acciones de su sector (Utilities) en el catálogo.");
    expect(motivoSinAlternativas(asset("fondo"))).toBe("No hay alternativas del mismo producto y clase en el catálogo.");
  });

  test("una región que no se conoce se queda en «Afín»: no se da por buena", () => {
    expect(nombresYNivel(findHomogeneousAlternatives(accion("Sin región", "Utilities", undefined), [accion("Endesa", "Utilities", "Iberia")]))).toEqual([["Endesa", 2]]);
    expect(nombresYNivel(findHomogeneousAlternatives(iberdrola, [accion("Sin región", "Utilities", undefined)]))).toEqual([["Sin región", 2]]);
  });

  test("las dos bases no escriben igual el sector, y es el mismo", () => {
    expect(sectorComparable({ sector: "Banking" })).toBe(sectorComparable({ sector: "Financial Services" }));
    expect(sectorComparable({ sector: "Aerospace & Defense" })).toBe(sectorComparable({ sector: "Industrials" }));
    expect(sectorComparable({ sector: "Tobacco" })).toBe(sectorComparable({ sector: "Consumer Defensive" }));
    expect(sectorComparable({ sector: undefined })).toBeNull();
    expect(sectorLegible({ sector: "Financial Services" })).toBe("Financieras");
    /* Lo que no conocemos se enseña tal cual: inventar el nombre de un sector es inventar. */
    expect(sectorLegible({ sector: "Sector raro" })).toBe("Sector raro");
  });

  test("en «Elegir otro activo» sigue todo, y lo de otro sector es elección libre", () => {
    const universo = [accion("Santander", "Financial Services", "Iberia"), accion("Endesa", "Utilities", "Iberia"), asset("Un fondo")];
    expect(nombresYNivel(findSwapAlternatives(iberdrola, universo, [], "custom", Infinity))).toEqual([["Endesa", 1], ["Santander", 4], ["Un fondo", 4]]);
  });

  test("un fondo sigue con su lógica y su orden, aunque el catálogo traiga sectores", () => {
    const fondo = asset("Fondo", { metrics: { sharpe_3y: 0.5 } });
    const universo = [asset("Peor", { sector: "Utilities", metrics: { sharpe_3y: 0.1 } }), asset("Mejor", { sector: "Technology", metrics: { sharpe_3y: 2 } })];
    expect(nombresYNivel(findHomogeneousAlternatives(fondo, universo))).toEqual([["Mejor", 1], ["Peor", 1]]);
  });
});

describe("catálogo completo de sustitución", () => {
  test("sigue cursores y encuentra alternativas que están después de los primeros 200", async () => {
    const first = Array.from({ length: 200 }, (_, index) => asset(`bond-${index}`, { economic_asset_class: "FIXED_INCOME" }));
    const searchAssetsPage = vi.fn().mockResolvedValueOnce({ results: first, totalMatches: 201, nextCursor: "next-page" })
      .mockResolvedValueOnce({ results: [first[0], asset("match")], totalMatches: 201, nextCursor: null });
    const searchAssets = vi.fn();
    const universe = await loadSwapUniverse({ searchAssetsPage, searchAssets }, ["FUND"]);
    expect(universe).toHaveLength(201);
    expect(searchAssetsPage).toHaveBeenLastCalledWith({ instrumentTypes: ["FUND"], limit: 200, cursor: "next-page" });
    expect(findHomogeneousAlternatives(asset("source"), universe).map(({ asset }) => asset.asset_id)).toEqual(["match"]);
    expect(searchAssets).not.toHaveBeenCalled();
  });

  test("un cursor repetido o un fallo de página no se presentan como un catálogo completo", async () => {
    const searchAssetsPage = vi.fn().mockResolvedValue({ results: [asset("A")], totalMatches: null, nextCursor: "stuck" });
    await expect(loadSwapUniverse({ searchAssetsPage, searchAssets: vi.fn() })).rejects.toThrow("catálogo");
    expect(searchAssetsPage).toHaveBeenCalledTimes(2);
    searchAssetsPage.mockRejectedValueOnce(new Error("network"));
    await expect(loadSwapUniverse({ searchAssetsPage, searchAssets: vi.fn() })).rejects.toThrow("network");
  });
});
