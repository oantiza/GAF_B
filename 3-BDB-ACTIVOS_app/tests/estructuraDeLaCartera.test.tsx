import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { buildManualPortfolioReport } from "../src/adapters/bdbAssetsAdapter";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioXray } from "../src/components/PortfolioXray";

/**
 * La tira de Estructura de la cartera dice hechos (decisión 18). «Concentración: Balanceada» era un adjetivo con los
 * umbrales sin ver, y al lado estaba la mayor posición con su cifra.
 */
const ACTIVOS = ["MOCK-FUND-MIXED", "MOCK-ETF-CASH", "MOCK-STOCK-TECH"];

async function estructura(pesos: number[], modoCliente: boolean) {
  const report = await buildManualPortfolioReport(pesos.map((weight_percent, indice) => ({ asset_id: ACTIVOS[indice], weight_percent })), "Cartera prueba");
  return renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(PortfolioXray, { xray: report.xray }) }));
}

describe("la tira de Estructura de la cartera", () => {
  /* Las tres bandas del umbral 25/40: el adjetivo no sale en ninguna. */
  test.each([
    [[25, 25, 50], "mayor posición por encima de 40"],
    [[34, 33, 33], "entre 25 y 40"],
    [[25, 25, 25], "justo en 25"]
  ])("no opina sobre la concentración: %j, %s", async (pesos) => {
    for (const modoCliente of [false, true]) {
      const html = await estructura(pesos, modoCliente);
      expect(html).toContain("Mayor posición");
      for (const adjetivo of ["Balanceada", "Vigilar", ">Alta<", ">Concentración<"]) expect(html).not.toContain(adjetivo);
    }
  });

  test("la cifra de la mayor posición se queda, y la lista de la concentración por posición también", async () => {
    const html = await estructura([50, 30, 20], false);
    /* Rediseño: la tira pasa a filas con filete (`dt`/`dd`), y la mayor posición se dice una sola vez, con su nombre (ANA-30).
       Desde el 14-11-2026 (Óscar: recuperar los datos de antes del rediseño) lleva otra vez debajo su producto y su clase: la segunda
       línea pequeña, que se comprueba en `colorEnPropuestasYAnalisis.test.tsx`. */
    expect(html).toMatch(/<dt>Mayor posición<small>[^<]+<\/small><small>.+?<\/small><\/dt><dd>50,0\s%/);
    expect(html).not.toContain("portfolio-xray-highlight");
    expect(html).toContain("Concentración por posición");
  });

  /* ANA-30: la concentración enseña las cinco mayores y dice cuántas hay; la lista entera ya está en la composición. */
  test("con ocho posiciones, la concentración enseña las cinco mayores y dice «Las 5 mayores de 8»", async () => {
    const report = await buildManualPortfolioReport([{ asset_id: ACTIVOS[0], weight_percent: 100 }], "Cartera prueba");
    const ocho = Array.from({ length: 8 }, (_, indice) => ({
      asset_id: `POS-${indice + 1}`,
      display_name: `Posición ${indice + 1}`,
      instrument_type: "FUND",
      economic_asset_class: "EQUITY",
      weight_percent: 20 - indice * 2
    }));
    const xray = { ...report.xray, investable_positions: 8, total_positions: 8, position_concentration: ocho } as typeof report.xray;
    const html = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: false, children: createElement(PortfolioXray, { xray }) }));
    const bloque = html.slice(html.indexOf("Concentración por posición"));
    const lista = bloque.slice(0, bloque.indexOf("</ul>"));
    expect(lista).toContain("Las 5 mayores de 8.");
    expect(lista.match(/class="xray-dist-label"/g)).toHaveLength(5);
    expect(lista).toContain("Posición 5");
    expect(lista).not.toContain("Posición 6");
  });

  test("con cinco o menos, la lista está entera y no dice «mayores»", async () => {
    const html = await estructura([50, 30, 20], false);
    expect(html).not.toContain("mayores de");
  });
});

/**
 * Revisión final (V6-3): Iberdrola 50, Apple 30 e iShares 20 en la base nueva, que no le pone categoría a una acción. Categoría decía «N/D 80,0 %», y el
 * informe de cliente y el interno de la misma cartera dicen «Acciones 80,0 %» (decisión 83). Un fondo sin categoría, «No declarado», como el papel.
 */
describe("la categoría de Estructura de la cartera dice lo mismo que el papel", () => {
  const posicion = (asset_id: string, instrument_type: string, weight_percent: number, category?: string) =>
    ({ asset_id, display_name: asset_id, instrument_type, is_investable: true, weight_percent, category, quality_flags: [] }) as never;

  async function categoria(byCategory: Array<{ key: string; weight_percent: number }>, posiciones: never[]) {
    const report = await buildManualPortfolioReport([{ asset_id: ACTIVOS[0], weight_percent: 100 }], "Cartera prueba");
    const html = renderToStaticMarkup(
      createElement(ClientModeProvider, { initialValue: false, children: createElement(PortfolioXray, { xray: { ...report.xray, by_category: byCategory }, posiciones }) })
    );
    const bloque = html.split("<h3>Categoría</h3>")[1].split("</ul>")[0];
    return [...bloque.matchAll(/title="([^"]+)"[^>]*>[^<]*<\/span><b>([^<]+)<\/b>/g)].map(([, rotulo, peso]) => `${rotulo} ${peso.replace(/\s/g, " ")}`);
  }

  test("dos acciones sin categoría son «Acciones», por peso, y no «N/D»", async () => {
    const filas = await categoria(
      [{ key: "N/D", weight_percent: 80 }, { key: "RV Global Cap. Grande Blend", weight_percent: 20 }],
      [posicion("IBE", "STOCK", 50), posicion("APL", "STOCK", 30), posicion("ISH", "ETF", 20, "RV Global Cap. Grande Blend")]
    );
    expect(filas).toEqual(["Acciones 80,0 %", "RV Global Cap. Grande Blend 20,0 %"]);
  });

  test("un fondo sin categoría es «No declarado», como en el papel", async () => {
    const filas = await categoria(
      [{ key: "N/D", weight_percent: 60 }, { key: "RV Global Cap. Grande Blend", weight_percent: 40 }],
      [posicion("F", "FUND", 60), posicion("ISH", "ETF", 40, "RV Global Cap. Grande Blend")]
    );
    expect(filas).toEqual(["No declarado 60,0 %", "RV Global Cap. Grande Blend 40,0 %"]);
  });
});
