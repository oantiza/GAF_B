import { describe, expect, test } from "vitest";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

function makeAsset(overrides: Partial<BdbAssetDetail> & { asset_id: string }): BdbAssetDetail {
  return {
    display_name: overrides.asset_id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "OK",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {},
    description: "",
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    ...overrides
  } as BdbAssetDetail;
}

const entera = (asset: BdbAssetDetail) => computeEquityRegionAllocation([{ asset_id: asset.asset_id, weight_percent: 100 }], [asset]);

describe("la región de una acción: una empresa no se reparte, va entera a su zona (decisión 16)", () => {
  /* Sin desglose: es lo que trae una acción en la base nueva. Sin esto, «Europa ex-euro» caía en el reparto a ojo de «Europa». */
  test.each([
    ["Eurozona", "EUR", "eurozone"],
    ["Reino Unido", "GBX", "united_kingdom"],
    ["Europa ex-euro", "CHF", "europe_ex_euro"],
    ["EE.UU.", "USD", "united_states"],
    ["Canadá", "CAD", "canada"]
  ])("%s, en %s, va entera a su región", (region, currency, clave) => {
    const accion = { asset_id: "S", instrument_type: "STOCK", economic_asset_class: "EQUITY", currency, region } as BdbAssetDetail;
    const salida = entera(accion);
    expect(salida.rows).toEqual([{ key: clave, weight_percent: 100 }]);
    expect(salida.quality).toBe("lookthrough");
    expect(salida.unclassified_weight_percent).toBe(0);
  });

  /* Las de la base local traen el país, y ese país no se toma de la divisa: un ADR cotiza en dólares y su empresa no está en EE. UU. */
  test.each([
    ["Spain", "EUR", "eurozone"],
    ["Germany", "EUR", "eurozone"],
    ["Netherlands", "USD", "eurozone"],
    ["Ireland", "USD", "eurozone"],
    ["Switzerland", "CHF", "europe_ex_euro"],
    ["United Kingdom", "GBP", "united_kingdom"],
    ["Australia", "EUR", "australasia"],
    ["Singapore", "USD", "asia_developed"],
    ["Japón", "EUR", "japan"],
    /* IMP-8: dos que la base local trae y no se situaban. Iberia es España y Portugal, los dos del euro. */
    ["USA", "USD", "united_states"],
    ["Iberia", "EUR", "eurozone"]
  ])("%s, en %s: manda el país declarado, no la divisa", (region, currency, clave) => {
    expect(entera(makeAsset({ asset_id: "S", instrument_type: "STOCK", currency, region })).rows).toEqual([{ key: clave, weight_percent: 100 }]);
  });

  test.each([
    ["sin región, y en dólares", undefined, "USD"],
    ["sin región, y en euros", undefined, "EUR"],
    ["con una región que no se sabe situar", "Marte", "EUR"],
    /* «Europe» no dice si es del euro o de fuera: se queda sin zona, que es lo que se sabe. */
    ["con «Europe», que puede ser del euro o no", "Europe", "EUR"]
  ])("%s: no se deduce de la divisa, y se dice", (_caso, region, currency) => {
    const salida = entera(makeAsset({ asset_id: "S", instrument_type: "STOCK", currency, region }));
    expect(salida.rows).toEqual([]);
    expect(salida.quality).toBe("none");
    expect(salida.unclassified_weight_percent).toBe(100);
  });
});

describe("lo que no se declara no se reparte: era la misma regla de la decisión 11", () => {
  /* Hasta el 05-11-2026 estas cuatro etiquetas repartían por porcentajes escritos a mano: Global 55/20/8/6/5/6,
     Emergentes 58/25/17, Asia 45/45/10, Europa 78/22. Robeco Asian Stars, en la base local, salía con un 10 % en Japón. */
  test.each(["Global", "Emergentes", "Asia", "Europa", "Japón", "EE.UU."])("un fondo «%s» que no publica regiones no recibe ninguna", (region) => {
    const salida = entera(makeAsset({ asset_id: "F", region }));
    expect(salida.rows).toEqual([]);
    expect(salida.quality).toBe("none");
    expect(salida.unclassified_weight_percent).toBe(100);
  });

  /* Medido en la base nueva: GVC Gaesco Japón, JPMorgan India y BlackRock US Flexible Equity, en euros, salían 100 % zona euro. */
  test.each(["EUR", "USD", "JPY", "CAD", "GBP", "CHF", "AUD"])("la divisa de un fondo, %s, no es una región", (currency) => {
    const salida = entera(makeAsset({ asset_id: "F", currency }));
    expect(salida.rows).toEqual([]);
    expect(salida.unclassified_weight_percent).toBe(100);
  });

  test("un ETF tampoco: lo que no publica, no consta", () => {
    expect(entera(makeAsset({ asset_id: "E", instrument_type: "ETF", currency: "USD" })).rows).toEqual([]);
  });

  test("resultado conocido: lo declarado en % de toda la RV, lo demás aparte, y suman 100", () => {
    const conZonas = makeAsset({ asset_id: "A", region: "Global", exposure_detail: { equity_regions: { united_states: 70, japan: 30 } } });
    const sinZonas = makeAsset({ asset_id: "B", region: "Asia" });
    const accion = makeAsset({ asset_id: "C", instrument_type: "STOCK", region: "Eurozona" });
    const bono = makeAsset({ asset_id: "D", economic_asset_class: "FIXED_INCOME", pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 } });
    const out = computeEquityRegionAllocation(
      [
        { asset_id: "A", weight_percent: 40 },
        { asset_id: "B", weight_percent: 30 },
        { asset_id: "C", weight_percent: 10 },
        { asset_id: "D", weight_percent: 20 }
      ],
      [conZonas, sinZonas, accion, bono]
    );
    /* RV = 40 + 30 + 10 = 80. EE. UU. 28/80, Japón 12/80, zona euro 10/80; sin declarar, 30/80. */
    expect(out.rows).toEqual([
      { key: "united_states", weight_percent: 35 },
      { key: "japan", weight_percent: 15 },
      { key: "eurozone", weight_percent: 12.5 }
    ]);
    expect(out.unclassified_weight_percent).toBe(37.5);
    expect(out.quality).toBe("lookthrough");
    expect(out.rows.reduce((suma, fila) => suma + fila.weight_percent, 0) + out.unclassified_weight_percent).toBe(100);
  });

  test("pondera por exposición a RV: un mixto sin regiones cuenta por su parte", () => {
    const mixto = makeAsset({ asset_id: "M", currency: "USD", pms_exposure: { equity: 0.4, fixed_income: 0.6, cash: 0, alternative: 0, other: 0 } });
    const accion = makeAsset({ asset_id: "P", instrument_type: "STOCK", region: "Japón" });
    const out = computeEquityRegionAllocation(
      [
        { asset_id: "M", weight_percent: 50 },
        { asset_id: "P", weight_percent: 50 }
      ],
      [mixto, accion]
    );
    /* RV = 20 del mixto + 50 de la acción. */
    expect(out.rows).toEqual([{ key: "japan", weight_percent: (50 / 70) * 100 }]);
    expect(out.unclassified_weight_percent).toBeCloseTo((20 / 70) * 100, 10);
  });

  test("peso 0, posición sin ficha y cartera vacía no cuentan", () => {
    const accion = makeAsset({ asset_id: "S", instrument_type: "STOCK", region: "EE.UU." });
    const sinDato = makeAsset({ asset_id: "F" });
    const out = computeEquityRegionAllocation(
      [
        { asset_id: "S", weight_percent: 100 },
        { asset_id: "F", weight_percent: 0 },
        { asset_id: "NO_ESTA", weight_percent: 50 }
      ],
      [accion, sinDato]
    );
    expect(out.rows).toEqual([{ key: "united_states", weight_percent: 100 }]);
    expect(out.unclassified_weight_percent).toBe(0);
    expect(computeEquityRegionAllocation([], [])).toEqual({ rows: [], quality: "none", unclassified_weight_percent: 0 });
  });
});

describe("computeEquityRegionAllocation (A3.1)", () => {
  test("el look-through de regiones del backend manda y marca lookthrough", () => {
    const asset = makeAsset({
      asset_id: "F1",
      region: "Global",
      exposure_detail: { equity_regions: { united_states: 70, japan: 30 } }
    });
    const out = entera(asset);
    expect(out.quality).toBe("lookthrough");
    expect(out.rows.find((row) => row.key === "united_states")?.weight_percent).toBeCloseTo(70, 6);
  });

  test("sin RV devuelve none, sin filas ni nada que declarar", () => {
    const bono = makeAsset({
      asset_id: "B",
      economic_asset_class: "FIXED_INCOME",
      pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 }
    });
    expect(entera(bono)).toEqual({ rows: [], quality: "none", unclassified_weight_percent: 0 });
  });

  test("uno de renta fija que publica «bolsa en Estados Unidos» no reparte su peso: sin RV no hay región", () => {
    /* Protección que antes comprobaba la vista previa retirada (decisión 109): el reparto regional se pondera por
       la parte de renta variable, y un bono con `equity_regions` declarado no aporta nada. */
    const bono = makeAsset({
      asset_id: "B",
      economic_asset_class: "FIXED_INCOME",
      pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 },
      exposure_detail: { equity_regions: { united_states: 100 } }
    });
    const accionista = makeAsset({ asset_id: "A", exposure_detail: { equity_regions: { eurozone: 100 } } });
    const out = computeEquityRegionAllocation(
      [{ asset_id: "B", weight_percent: 20 }, { asset_id: "A", weight_percent: 80 }],
      [bono, accionista]
    );
    expect(out.rows).toEqual([{ key: "eurozone", weight_percent: 100 }]);
    expect(entera(bono)).toEqual({ rows: [], quality: "none", unclassified_weight_percent: 0 });
  });

  test("sin `pms_exposure`, un activo de RV cuenta por su clase en vez de desaparecer", () => {
    const accion = makeAsset({ asset_id: "U", instrument_type: "STOCK", region: "EE.UU.", pms_exposure: undefined });
    expect(entera(accion).rows).toEqual([{ key: "united_states", weight_percent: 100 }]);
    const fondo = makeAsset({ asset_id: "F", pms_exposure: undefined });
    expect(entera(fondo).unclassified_weight_percent).toBe(100);
  });

  test("sin «other» no hay nota de Canadá y África: el campo ni aparece", () => {
    const asset = makeAsset({ asset_id: "F1", exposure_detail: { equity_regions: { united_states: 70, japan: 30 } } });
    expect(entera(asset)).not.toHaveProperty("canadaYAfricaSinSeparar");
  });
});
