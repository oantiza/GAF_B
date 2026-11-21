import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { GeoDistributionMap } from "../src/charts/GeoDistributionMap";
import { RegionAllocation } from "../src/components/RegionAllocation";
import { XrayMetricsStyle } from "../src/components/XrayMetricsStyle";
import { sectorDonutSlices } from "../src/components/xrayBreakdownLabels";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import { computeEquitySectorAllocation } from "../src/core/equitySectors";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

/* Revisión 14-10, ronda 2: el núcleo publica `unclassified_weight_percent` en
   regiones y sectores (filas en % de TODA la RV). La interfaz lo dice en vez de
   repartir el 100 % entre filas que suman menos. */

function equity(id: string, extra: Partial<BdbAssetDetail>): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: id,
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    ...extra
  } as unknown as BdbAssetDetail;
}

// 60 % de la RV con región y sector conocidos; 40 % sin región, divisa ni sector reconocibles.
const assets = [
  equity("KNOWN", { region: "United States", currency: "USD", sector: "Technology" }),
  equity("OPAQUE", { region: undefined, currency: undefined, sector: undefined, category: undefined, display_name: "Zqx 77" })
];
const positions = [
  { asset_id: "KNOWN", weight_percent: 60 },
  { asset_id: "OPAQUE", weight_percent: 40 }
] as unknown as BdbManualPortfolioPosition[];

describe("lo no declarado se dice en regiones y sectores", () => {
  test("el núcleo deja el 40 % sin declarar en los dos desgloses (premisa de la prueba)", () => {
    expect(computeEquityRegionAllocation(positions, assets).unclassified_weight_percent).toBeCloseTo(40, 6);
    expect(computeEquitySectorAllocation(positions, assets).unclassified_weight_percent).toBeCloseTo(40, 6);
  });

  test("el mapa lo dice bajo su nota en el formato ancho, con la pieza de la ausencia, y solo si hay algo sin declarar", () => {
    const rows = [{ key: "united_states", weight_percent: 60 }];
    const withRest = renderToStaticMarkup(createElement(GeoDistributionMap, { rows, unclassifiedPercent: 40 }));
    /* Paso 2 del rediseño: el peso lo escribe el módulo común, con espacio duro antes de «%». Y desde el 14-11-2026 (decisión
       de Óscar) el mapa vuelve a dar un color a cada zona: su nota dice qué es el color y qué la intensidad. */
    expect(withRest).toContain('<span class="ausencia ausencia--falta">No declarado: 40,0\u00a0% de la renta variable</span>');
    expect(withRest).toContain("Un color por zona; más intenso, más peso.");
    const complete = renderToStaticMarkup(createElement(GeoDistributionMap, { rows, unclassifiedPercent: 0 }));
    expect(complete).not.toContain("No declarado");
  });

  test("RegionAllocation lo dice una sola vez: una fila con su cifra en la columna lateral, bajo el mapa en el resto", () => {
    const side = renderToStaticMarkup(createElement(RegionAllocation, { positions, assets, variant: "side" }));
    expect(side.match(/No declarado/g)).toHaveLength(1);
    expect(side).toMatch(/<span class="ausencia ausencia--falta">No declarado<\/span><\/span><strong>40,0\s%<\/strong>/);
    const framed = renderToStaticMarkup(createElement(RegionAllocation, { positions, assets }));
    expect(framed.match(/No declarado/g)).toHaveLength(1);
    expect(framed).toContain("No declarado: 40,0\u00a0% de la renta variable");
    for (const html of [side, framed]) {
      expect(html).not.toContain("sin clasificar");
      expect(html).not.toContain("estimado");
      expect(html).not.toContain("subyacente");
    }
  });

  test("si nadie declara nada no hay mapa que dibujar, y sin renta variable no es que falte: no aplica", () => {
    const fondo = equity("F", { instrument_type: "FUND", region: "Global", currency: "EUR" });
    const props = { positions: [{ asset_id: "F", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[], assets: [fondo] };
    for (const variant of ["default", "side"] as const) {
      const html = renderToStaticMarkup(createElement(RegionAllocation, { ...props, variant }));
      expect(html).toContain('<span class="ausencia ausencia--falta">No declarado: 100,0\u00a0% de la renta variable</span>');
      expect(html).not.toContain("geo-map-svg");
    }
    const bono = equity("B", { instrument_type: "FUND", economic_asset_class: "FIXED_INCOME", pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0 } } as Partial<BdbAssetDetail>);
    const sinRv = renderToStaticMarkup(createElement(RegionAllocation, { positions: [{ asset_id: "B", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[], assets: [bono] }));
    expect(sinRv).toContain('<span class="ausencia ausencia--no-aplica">Sin renta variable en esta cartera</span>');
    expect(sinRv).not.toContain("No declarado");
  });

  test("el aro de sectores cierra el 100 % con «No declarado», al final y sin color pasado a mano", () => {
    const sectors = computeEquitySectorAllocation(positions, assets);
    const slices = sectorDonutSlices(sectors.rows, sectors.unclassified_weight_percent);
    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(100, 6);
    const rest = slices.find((slice) => slice.label === "No declarado");
    expect(rest?.value).toBeCloseTo(40, 6);
    expect(slices.at(-1)).toBe(rest);
    // Sin nada clasificado no hay aro que cerrar.
    expect(sectorDonutSlices([], 100)).toEqual([]);
    /* Rediseño (14-11-2026): el color lo decide el aro por el papel de cada porción («No declarado» y «Otros», en gris) y
       agrupa él lo que pase de seis categorías. Antes se comprobaban aquí los colores que este fichero pintaba a mano. */
    const many = sectorDonutSlices(
      ["a", "b", "c", "d", "e", "f", "g"].map((key) => ({ key, weight_percent: 10 })),
      30
    );
    expect(many).toHaveLength(8);
    expect(many.every((slice) => !("color" in slice))).toBe(true);
    const complete = sectorDonutSlices(["a", "b", "c", "d"].map((key) => ({ key, weight_percent: 25 })), 0);
    expect(complete.map((slice) => slice.label)).not.toContain("No declarado");
  });

  test("renta fija: un fondo sin vector cuenta por su clase, no como 0, y dice lo que publica (ronda 3 y decisión 11)", () => {
    const bond = {
      asset_id: "RF-SIN-VECTOR", display_name: "Bonos Euro Gobierno", economic_asset_class: "FIXED_INCOME",
      instrument_type: "FUND", category: "RF Gobierno Euro", pms_exposure: undefined,
      fixed_income_profile: { investment_grade_pct: 0.9586, high_yield_pct: 0.0414, effective_duration: 6.2 }
    } as unknown as BdbAssetDetail;
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, {
      assets: [bond], positions: [{ asset_id: "RF-SIN-VECTOR", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[]
    }));
    const fixedIncome = html.slice(html.indexOf("<h3>Renta fija</h3>"));
    expect(fixedIncome).toContain("Sobre el 100,0\u00a0% de la cartera que es renta fija");
    expect(fixedIncome).toContain("Grado de inversión");
    expect(fixedIncome).toContain("95,9\u00a0%");
    expect(fixedIncome).toContain("Alto rendimiento");
    expect(fixedIncome).toContain("4,1\u00a0%");
    expect(fixedIncome).toContain("6,2 años");
    /* Lo que no se declara dice que falta: no es un cero ni un guion. */
    expect(fixedIncome).toContain("Ninguna posición la declara");
    expect(fixedIncome).toContain('ausencia ausencia--falta">Falta<');
    /* Ni el «tipo» ni la palabra del nombre. */
    expect(html).not.toContain("Tipo renta fija");
    expect(html).not.toContain("Gobierno<");
    expect(html).not.toContain("Estimado por el nombre");
  });

  test("un mixto declara parte: la cobertura se dice sobre la renta fija", () => {
    const declara = { asset_id: "A", economic_asset_class: "FIXED_INCOME", pms_exposure: undefined, fixed_income_profile: { investment_grade_pct: 1 } } as unknown as BdbAssetDetail;
    const noDeclara = { asset_id: "B", economic_asset_class: "FIXED_INCOME", pms_exposure: undefined } as unknown as BdbAssetDetail;
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, {
      assets: [declara, noDeclara],
      positions: [{ asset_id: "A", weight_percent: 75 }, { asset_id: "B", weight_percent: 25 }] as unknown as BdbManualPortfolioPosition[]
    }));
    expect(html).toContain("Declarado por el 75,0\u00a0% de la renta fija");
  });

  test("Análisis pinta «No declarado» en la leyenda del aro de sectores", () => {
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, { assets, positions }));
    expect(html).toContain("No declarado");
  });

  test("una acción no sale «86 % grande, 14 % mediana»: estilo y tamaño, no declarados (decisión 11)", () => {
    /* Toda acción caía en la estimación, con esos porcentajes escritos a mano. */
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, { assets, positions }));
    expect(html).toContain("No declarado: 100,0\u00a0% de la renta variable");
    expect(html).not.toContain("Grande");
    expect(html).not.toContain("86,0 %");
    expect(html).not.toContain("14,0 %");
    expect(html).not.toContain("Mixto");
  });

  test("un fondo sin estilo no se deduce de su nombre: solo se reparte lo publicado", () => {
    const publica = equity("PUBLICA", { exposure_detail: { equity_styles: { value: 50, growth: 50 }, market_caps: { large: 100 } } } as Partial<BdbAssetDetail>);
    /* «dividend» daba 65/35 valor, y «tech» 62/38 crecimiento. */
    const dividendo = equity("DIVIDENDO", { display_name: "Global Dividend Tech Index", instrument_type: "FUND" } as Partial<BdbAssetDetail>);
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, {
      assets: [publica, dividendo],
      positions: [{ asset_id: "PUBLICA", weight_percent: 60 }, { asset_id: "DIVIDENDO", weight_percent: 40 }] as unknown as BdbManualPortfolioPosition[]
    }));
    const estilo = html.slice(html.indexOf("<h3>Estilo</h3>"), html.indexOf("<h3>Tamaño</h3>"));
    expect(estilo).toContain("30,0\u00a0%");
    expect(estilo).toContain("No declarado: 40,0\u00a0% de la renta variable");
    const tamano = html.slice(html.indexOf("<h3>Tamaño</h3>"), html.indexOf("<h3>Renta fija</h3>"));
    expect(tamano).toContain("60,0\u00a0%");
    expect(tamano).toContain("No declarado: 40,0\u00a0% de la renta variable");
    /* La caja: la parte de PUBLICA es el producto de sus dos repartos, y la de DIVIDENDO no se reparte (decisión 51). */
    const caja = html.slice(html.indexOf("<h3>Estilo y tamaño</h3>"), html.indexOf("<h3>Sectores de la renta variable</h3>"));
    expect(caja).toContain("Aproximación: producto de los dos repartos");
    expect(caja).toContain("No declarado: 40,0\u00a0% de la renta variable");
    expect(html).not.toContain("estimación");
  });

  test("sin renta variable ni renta fija, no aplica: no se dice que falte", () => {
    const liquidez = { asset_id: "MM", economic_asset_class: "MONEY_MARKET", pms_exposure: undefined } as unknown as BdbAssetDetail;
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, {
      assets: [liquidez], positions: [{ asset_id: "MM", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[]
    }));
    expect(html).toContain("Sin renta variable en esta cartera");
    expect(html).toContain("Sin renta fija en esta cartera");
    expect(html).not.toContain("ausencia--falta");
  });

  test("clase, estilo, tamaño y renta fija son filas: ni una barra, y un solo origen por sección", () => {
    const conEstilo = equity("KNOWN", { exposure_detail: { sectors: { technology: 60, energy: 40 }, equity_styles: { value: 100 }, market_caps: { large: 100 } } } as Partial<BdbAssetDetail>);
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, {
      assets: [conEstilo], positions: [{ asset_id: "KNOWN", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[]
    }));
    /* Se quedan la caja y el aro, que no son barras. */
    expect(html.match(/recharts-responsive-container/g)).toHaveLength(2);
    /* Estilo y Tamaño se quedan: son el dato del que sale la caja. */
    expect(html).toContain("<h3>Estilo</h3>");
    expect(html).toContain("<h3>Tamaño</h3>");
    /* Los cinco sellos de la sección pasan a su línea de procedencia. */
    expect(html).not.toContain("oaa-data-pill");
    /* «Métricas parciales» y la mezcla de divisas no son de esta sección. */
    expect(html).not.toContain("Métricas parciales");
    expect(html).not.toContain("Mezcla de divisas");
  });

  test("el mapa no tapa la tabla, y ni el rótulo de aproximado ni un resto que no existe (decisión 7)", () => {
    const framed = renderToStaticMarkup(createElement(RegionAllocation, { positions, assets }));
    expect(framed).not.toContain("geo-map-table-wrap");
    const conSubyacente = equity("LOOK", { exposure_detail: { equity_regions: { united_states: 60, eurozone: 40 } } } as Partial<BdbAssetDetail>);
    const conDato = renderToStaticMarkup(createElement(RegionAllocation, {
      positions: [{ asset_id: "LOOK", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[],
      assets: [conSubyacente]
    }));
    expect(conDato).not.toContain("aproximado");
    expect(conDato).not.toContain("Sin asignar");
    expect(conDato).not.toContain("sin situar");
    expect(conDato).not.toContain("Canadá y África");
  });

  test("con el dato en la forma antigua, la nota una vez por panel y fuera «Otras», «Sin situar» y «Asia - Emergente»", () => {
    const antigua = equity("ANTIGUA", { exposure_detail: { equity_regions: { united_states: 0.6, other: 0.05, asia: 0.35, asia_emerging: 0.1 } } } as Partial<BdbAssetDetail>);
    const props = { positions: [{ asset_id: "ANTIGUA", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[], assets: [antigua] };
    const ancha = renderToStaticMarkup(createElement(RegionAllocation, props));
    expect(ancha.match(/Canadá y África aún no se separan/g)).toHaveLength(1);
    expect(ancha).toContain("Asia, sin desglose");
    expect(ancha).not.toContain("Asia - Emergente");
    expect(ancha).not.toContain("Sin situar");
    const lateral = renderToStaticMarkup(createElement(RegionAllocation, { ...props, variant: "side" }));
    expect(lateral.match(/Canadá y África aún no se separan/g)).toHaveLength(1);
    expect(lateral).not.toContain("Sin situar");
  });

  test("con el dato en la forma nueva, la nota desaparece sola", () => {
    const nueva = equity("NUEVA", { exposure_detail: { equity_regions: { united_states: 0.6, canada: 0.05, japan: 0.2, asia_emerging: 0.15 } } } as Partial<BdbAssetDetail>);
    const props = { positions: [{ asset_id: "NUEVA", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[], assets: [nueva] };
    const ancha = renderToStaticMarkup(createElement(RegionAllocation, props));
    expect(ancha).not.toContain("Canadá y África");
    expect(ancha).toContain("Canadá");
    expect(ancha).toContain("Japón");
    expect(ancha).toContain("Asia - Emergente");
  });

  test("lo que de verdad no tiene zona sí se dice", () => {
    const conResto = equity("RESTO", { exposure_detail: { equity_regions: { united_states: 0.6, canada: 0.1, other: 0.3 } } } as Partial<BdbAssetDetail>);
    const props = { positions: [{ asset_id: "RESTO", weight_percent: 100 }] as unknown as BdbManualPortfolioPosition[], assets: [conResto] };
    expect(renderToStaticMarkup(createElement(RegionAllocation, props))).toContain("No declarado: 30,0\u00a0% de la renta variable");
  });

});
