import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  coincideConLoTecleado,
  esRespuestaExacta,
  NOMBRES_HABITUALES_POR_ISIN,
  plegar,
  VARIANTES_DE_GESTORA,
  type ActivoBuscable
} from "../src/core/busquedaDeActivos";
import { sortSwapAlternativesForPresentation } from "../src/core/fundSwapPresentation";
import { filterSwapAlternatives, EMPTY_SWAP_FILTERS } from "../src/core/fundSwapper";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";

/**
 * Las dos búsquedas responden igual (decisión 81 de Óscar). Lo que tienen que responder está escrito a mano en un fichero que también
 * lee la prueba del servidor, `functions_python/tests/test_busqueda_de_activos.py`, y la lista de nombres habituales tiene dos copias:
 * si alguien cambia una, esta prueba falla.
 */

interface Caso {
  tecleado: string;
  todos?: boolean;
  responden?: string[];
  exactos?: string[];
}

const raiz = join(process.cwd(), "functions_python");
const { activos, casos } = JSON.parse(readFileSync(join(raiz, "tests", "fixtures", "busqueda_de_activos.json"), "utf8")) as {
  activos: ActivoBuscable[];
  casos: Caso[];
};
const lista = JSON.parse(readFileSync(join(raiz, "readmodel", "nombres_habituales.json"), "utf8")) as {
  nombres_por_isin: Record<string, string[]>;
  variantes_de_gestora: Record<string, string>;
};

describe("la lista de nombres habituales", () => {
  test("es la misma en el sitio y en las Functions", () => {
    expect(NOMBRES_HABITUALES_POR_ISIN).toEqual(lista.nombres_por_isin);
    expect(VARIANTES_DE_GESTORA).toEqual(lista.variantes_de_gestora);
  });

  test("son los doce nombres que revisó Óscar, y no están los que dijo que añadiría él", () => {
    expect(Object.values(NOMBRES_HABITUALES_POR_ISIN).flat().sort()).toEqual(
      ["Duro Felguera", "Gas Natural", "Iberia", "Inditex", "Logista", "Mediaset", "Nextil", "PharmaMar", "Prisa", "Red Eléctrica", "Sanjose", "Zara"]
    );
    const escritos = plegar(JSON.stringify(NOMBRES_HABITUALES_POR_ISIN));
    for (const nombre of ["google", "facebook", "oreal"]) expect(escritos).not.toContain(nombre);
  });
});

describe("lo que responde cada búsqueda", () => {
  test.each(casos)("«$tecleado»", ({ tecleado, todos, responden, exactos }) => {
    const salen = activos.filter((activo) => coincideConLoTecleado(activo, tecleado)).map((activo) => activo.isin);
    expect(salen.sort()).toEqual(todos ? activos.map((activo) => activo.isin).sort() : [...(responden ?? [])].sort());
    expect(activos.filter((activo) => esRespuestaExacta(activo, tecleado)).map((activo) => activo.isin).sort()).toEqual([...(exactos ?? [])].sort());
  });

  test("un nombre habitual es de su ISIN: otro activo que se llamara igual no responde por él", () => {
    expect(coincideConLoTecleado({ isin: "XX0000000000", nombre: "Otra cosa" }, "Zara")).toBe(false);
    expect(coincideConLoTecleado({ isin: "ES0148396007", nombre: "Otra cosa" }, "Zara")).toBe(true);
  });

  test("un nombre habitual se teclea entero: un símbolo que esté dentro de él sigue dando lo mismo", () => {
    expect(coincideConLoTecleado({ isin: "ES0177542018", nombre: "International Consolidated Airlines Group S.A", ticker: "IAG" }, "IBE")).toBe(false);
  });

  test("palabras de varios nombres habituales, en cualquier orden", () => {
    const naturgy = { isin: "ES0116870314", nombre: "Naturgy Energy Group SA", ticker: "NTGY" };
    for (const tecleado of ["Gas Natural", "natural gas", "Gas", "Naturgy Gas"]) expect(coincideConLoTecleado(naturgy, tecleado)).toBe(true);
    expect(esRespuestaExacta(naturgy, "gas  natural")).toBe(true);
    expect(esRespuestaExacta(naturgy, "natural gas")).toBe(false);
  });
});

describe("una sola forma de plegar", () => {
  test("acentos, eñes y mayúsculas", () => {
    expect(plegar("Telefónica")).toBe("telefonica");
    expect(plegar("DISEÑO")).toBe("diseno");
    expect(plegar("Börse")).toBe("borse");
  });

  test("apóstrofos y puntos no cuentan, pero una palabra sigue siendo una palabra", () => {
    expect(plegar("L'Oréal")).toBe("l'oreal");
    const oreal = { isin: "FR0000120321", nombre: "L'Oréal S.A.", ticker: "OR" };
    for (const tecleado of ["Loreal", "L'Oreal", "L’Oreal", "L´Oreal", "l'oréal", "LOREAL SA", "L'Oréal S.A."]) expect(coincideConLoTecleado(oreal, tecleado)).toBe(true);
    /* Un punto no separa: «E.ON» es «eon» y no «e» y «on». */
    expect(coincideConLoTecleado({ isin: "DE000ENAG999", nombre: "E.ON SE", ticker: "EOAN" }, "EON")).toBe(true);
    expect(coincideConLoTecleado({ isin: "DE000ENAG999", nombre: "E.ON SE", ticker: "EOAN" }, "E.ON")).toBe(true);
    expect(coincideConLoTecleado(oreal, "L Oreal Pictet")).toBe(false);
  });

  test("lo exacto tampoco mira apóstrofos ni puntos: el símbolo y el ISIN siguen siendo los mismos", () => {
    expect(esRespuestaExacta({ isin: "US0846707026", nombre: "Berkshire Hathaway", ticker: "BRK.B" }, "BRKB")).toBe(true);
    expect(esRespuestaExacta({ isin: "US0846707026", nombre: "Berkshire Hathaway", ticker: "BRK.B" }, "brk.b")).toBe(true);
    expect(esRespuestaExacta({ isin: "US0846707026", nombre: "Berkshire Hathaway", ticker: "BRK.B" }, ".")).toBe(false);
  });
});

describe("«Elegir otro activo»", () => {
  const alternativa = (display_name: string, asset_id = "X", ticker?: string, tier: 1 | 2 | 3 | 4 = 4) => ({ asset: { asset_id, isin: asset_id, display_name, ticker } as BdbAssetSearchResult, tier, score: 0 });
  const busca = (lista: ReturnType<typeof alternativa>[], query: string) => filterSwapAlternatives(lista, { ...EMPTY_SWAP_FILTERS, query }).map((a) => a.asset.display_name);

  test("usa la regla de las otras dos: palabra a palabra, por nombre habitual, y sin mirar acentos, apóstrofos ni puntos", () => {
    const lista = [alternativa("Telefónica"), alternativa("Pictet-Water R EUR"), alternativa("Industria de Diseño Textil, S.A.", "ES0148396007", "ITX"), alternativa("L'Oréal S.A.")];
    expect(busca(lista, "telefonica")).toEqual(["Telefónica"]);
    expect(busca(lista, "Pictet Water")).toEqual(["Pictet-Water R EUR"]);
    expect(busca(lista, "Water Pictet")).toEqual(["Pictet-Water R EUR"]);
    expect(busca(lista, "Inditex")).toEqual(["Industria de Diseño Textil, S.A."]);
    expect(busca(lista, "ITX")).toEqual(["Industria de Diseño Textil, S.A."]);
    expect(busca(lista, "Loreal")).toEqual(["L'Oréal S.A."]);
    expect(busca(lista, "ES0148396007")).toEqual(["Industria de Diseño Textil, S.A."]);
    expect(busca(lista, "")).toHaveLength(4);
    expect(busca(lista, "Pictet Bonds")).toEqual([]);
  });

  test("lo que responde exactamente va delante, aunque otra tenga mejor afinidad", () => {
    const lista = [alternativa("Artisan Global Value", "IE00B4M6YD48", undefined, 1), alternativa("Banco Santander S.A.", "ES0113900J37", "SAN", 4), alternativa("Sanofi SA", "FR0000120578", "SAN", 4)];
    expect(sortSwapAlternativesForPresentation(lista, "SAN").map((a) => a.asset.display_name)).toEqual(["Banco Santander S.A.", "Sanofi SA", "Artisan Global Value"]);
    expect(sortSwapAlternativesForPresentation(lista).map((a) => a.asset.display_name)).toEqual(["Artisan Global Value", "Banco Santander S.A.", "Sanofi SA"]);
  });
});
