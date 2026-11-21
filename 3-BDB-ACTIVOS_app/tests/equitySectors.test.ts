import { describe, expect, test } from "vitest";
import { computeEquitySectorAllocation, normalizeBackendSector, sectoresDeLaCasa } from "../src/core/equitySectors";
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

describe("normalizeBackendSector (A3.4)", () => {
  test("mapea los sectores GICS/Yahoo habituales a las claves de la casa", () => {
    expect(normalizeBackendSector("Technology")).toBe("technology");
    expect(normalizeBackendSector("Consumer Cyclical")).toBe("consumer_cyclical");
    expect(normalizeBackendSector("Consumer Staples")).toBe("consumer_defensive");
    expect(normalizeBackendSector("Financial Services")).toBe("financial_services");
    expect(normalizeBackendSector("Health Care")).toBe("healthcare");
    expect(normalizeBackendSector("Communication Services")).toBe("communication_services");
    expect(normalizeBackendSector("Real Estate")).toBe("real_estate");
    expect(normalizeBackendSector("Basic Materials")).toBe("basic_materials");
  });

  test("mapea industrias frecuentes de Finnhub", () => {
    expect(normalizeBackendSector("Semiconductors")).toBe("technology");
    expect(normalizeBackendSector("Pharmaceuticals")).toBe("healthcare");
    expect(normalizeBackendSector("Banking")).toBe("financial_services");
  });

  test("una distribuidora de gas es de servicios públicos, no de energía (IMP-8)", () => {
    /* GICS: «Gas Utilities», «Electric Utilities», «Multi-Utilities» y «Water Utilities» son industrias del sector Utilities. */
    expect(normalizeBackendSector("Gas Utilities")).toBe("utilities");
    expect(normalizeBackendSector("Electric Utilities")).toBe("utilities");
    expect(normalizeBackendSector("Multi-Utilities")).toBe("utilities");
    expect(normalizeBackendSector("Water Utilities")).toBe("utilities");
    /* Y el gas que sí es energía lo sigue siendo. */
    expect(normalizeBackendSector("Oil & Gas")).toBe("energy");
    expect(normalizeBackendSector("Oil, Gas & Consumable Fuels")).toBe("energy");
  });

  test("lo que viene junto se separa: «consumerDefensive»", () => {
    expect(normalizeBackendSector("consumerDefensive")).toBe("consumer_defensive");
    expect(normalizeBackendSector("financialServices")).toBe("financial_services");
    expect(normalizeBackendSector("basic_materials")).toBe("basic_materials");
  });

  test("texto desconocido o vacío ⇒ null (queda sin repartir)", () => {
    expect(normalizeBackendSector("Conglomerates")).toBeNull();
    expect(normalizeBackendSector("")).toBeNull();
    expect(normalizeBackendSector(undefined)).toBeNull();
  });
});

describe("sectoresDeLaCasa: cada sector, una fila", () => {
  test("los nombres del proveedor y los que vienen juntos pasan a la clave de la casa, y la de la casa no cambia", () => {
    /* Los dos fondos de la base vieja: LU0591059224 y LU1493953001. */
    expect(sectoresDeLaCasa({ Technology: 0.414, "Financial Services": 0.177, Utilities: 0.031, "Real Estate": 0.024, "Consumer Cyclical": 0.085 })).toEqual({
      technology: 0.414, financial_services: 0.177, utilities: 0.031, real_estate: 0.024, consumer_cyclical: 0.085
    });
    expect(sectoresDeLaCasa({ consumerDefensive: 0.028, financialServices: 0.21, communicationServices: 0.075, basicMaterials: 0.079, consumerCyclical: 0.043, healthcare: 0.115 })).toEqual({
      consumer_defensive: 0.028, financial_services: 0.21, communication_services: 0.075, basic_materials: 0.079, consumer_cyclical: 0.043, healthcare: 0.115
    });
    const casa = { basic_materials: 1, communication_services: 2, consumer_cyclical: 3, consumer_defensive: 4, energy: 5, financial_services: 6, healthcare: 7, industrials: 8, real_estate: 9, technology: 10, utilities: 11 };
    expect(sectoresDeLaCasa(casa)).toEqual(casa);
  });

  test("dos nombres del mismo sector en un reparto se suman; lo que no se reconoce se queda con su nombre; sin reparto, nada", () => {
    expect(sectoresDeLaCasa({ technology: 0.25, Technology: 0.25, "Sin sector": 0.5 })).toEqual({ technology: 0.5, "Sin sector": 0.5 });
    expect(sectoresDeLaCasa(undefined)).toBeUndefined();
    expect(sectoresDeLaCasa(null)).toBeUndefined();
    expect(sectoresDeLaCasa({})).toEqual({});
  });

  test("resultado conocido: 50 % en cada fondo, uno con las claves de la casa y otro con las del proveedor, suma una sola fila por sector", () => {
    const casa = makeAsset({ asset_id: "CASA", exposure_detail: { sectors: sectoresDeLaCasa({ technology: 0.4, utilities: 0.6 }) } });
    const proveedor = makeAsset({ asset_id: "PROV", exposure_detail: { sectors: sectoresDeLaCasa({ Technology: 0.5, "Financial Services": 0.5 }) } });
    const { rows, unclassified_weight_percent: sinDeclarar } = computeEquitySectorAllocation([{ asset_id: "CASA", weight_percent: 50 }, { asset_id: "PROV", weight_percent: 50 }], [casa, proveedor]);
    /* Tecnología: (40 + 50) / 2 = 45. Utilities: 60 / 2 = 30. Financieras: 50 / 2 = 25. Antes salían cuatro filas: 20, 25, 30 y 25. */
    expect(rows.map((r) => r.key).sort()).toEqual(["financial_services", "technology", "utilities"]);
    expect(rows.find((r) => r.key === "technology")?.weight_percent).toBeCloseTo(45, 6);
    expect(rows.find((r) => r.key === "utilities")?.weight_percent).toBeCloseTo(30, 6);
    expect(rows.find((r) => r.key === "financial_services")?.weight_percent).toBeCloseTo(25, 6);
    expect(sinDeclarar).toBe(0);
  });
});

describe("computeEquitySectorAllocation: solo lo publicado (decisión 11)", () => {
  test("el desglose look-through manda sobre el sector de ficha", () => {
    const asset = makeAsset({
      asset_id: "F1",
      sector: "Technology",
      display_name: "Fondo Salud Global",
      exposure_detail: { sectors: { healthcare: 60, technology: 40 } }
    });
    const out = computeEquitySectorAllocation([{ asset_id: "F1", weight_percent: 100 }], [asset]);
    expect(out.quality).toBe("lookthrough");
    expect(out.rows.find((r) => r.key === "healthcare")?.weight_percent).toBeCloseTo(60, 6);
  });

  test("sin look-through, el sector de ficha del backend cuenta como dato (no estimación)", () => {
    const apple = makeAsset({
      asset_id: "AAPL",
      instrument_type: "STOCK",
      display_name: "Apple Inc",
      sector: "Technology"
    });
    const out = computeEquitySectorAllocation([{ asset_id: "AAPL", weight_percent: 100 }], [apple]);
    expect(out.rows).toEqual([{ key: "technology", weight_percent: 100 }]);
    expect(out.quality).toBe("lookthrough");
  });

  test("el nombre o la categoría de un fondo no dicen su sector: queda sin repartir", () => {
    const fondo = makeAsset({
      asset_id: "F2",
      display_name: "Fondo Semiconductores Europa",
      category: "Sector Equity Technology",
      provider: "Global Index Funds"
    });
    const out = computeEquitySectorAllocation([{ asset_id: "F2", weight_percent: 100 }], [fondo]);
    expect(out.rows).toEqual([]);
    expect(out.quality).toBe("none");
    expect(out.unclassified_weight_percent).toBeCloseTo(100, 6);
  });

  test("con una posición que lo declara y otra que no, solo se reparte lo publicado", () => {
    const conFicha = makeAsset({ asset_id: "A", instrument_type: "STOCK", sector: "Banking" });
    const sinDato = makeAsset({ asset_id: "B", display_name: "Global Media Leaders" });
    const out = computeEquitySectorAllocation(
      [
        { asset_id: "A", weight_percent: 50 },
        { asset_id: "B", weight_percent: 50 }
      ],
      [conFicha, sinDato]
    );
    expect(out.quality).toBe("lookthrough");
    expect(out.rows).toEqual([{ key: "financial_services", weight_percent: 50 }]);
    expect(out.unclassified_weight_percent).toBeCloseTo(50, 6);
  });

  test("la exposición a equity pondera: un mixto 50% RV cuenta la mitad", () => {
    const mixto = makeAsset({
      asset_id: "MIX",
      sector: "Technology",
      pms_exposure: { equity: 0.5, fixed_income: 0.5, cash: 0, alternative: 0, other: 0 }
    });
    const puro = makeAsset({ asset_id: "PURO", sector: "Utilities" });
    const out = computeEquitySectorAllocation(
      [
        { asset_id: "MIX", weight_percent: 50 },
        { asset_id: "PURO", weight_percent: 50 }
      ],
      [mixto, puro]
    );
    // Pesos RV: 25 tech vs 50 utilities ⇒ 33,3% / 66,7%.
    expect(out.rows.find((r) => r.key === "utilities")?.weight_percent).toBeCloseTo(66.6667, 3);
    expect(out.rows.find((r) => r.key === "technology")?.weight_percent).toBeCloseTo(33.3333, 3);
  });

  test("sin renta variable ⇒ none y sin filas", () => {
    const bono = makeAsset({
      asset_id: "BOND",
      economic_asset_class: "FIXED_INCOME",
      pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 }
    });
    const out = computeEquitySectorAllocation([{ asset_id: "BOND", weight_percent: 100 }], [bono]);
    expect(out).toEqual({ rows: [], quality: "none", unclassified_weight_percent: 0 });
  });

  test("la RV sin sector se declara aparte; la calidad describe solo lo repartido (ALTA-15)", () => {
    const conDesglose = makeAsset({ asset_id: "LT", exposure_detail: { sectors: { technology: 60, healthcare: 40 } } });
    // Sin desglose ni sector de ficha: no se puede clasificar.
    const opaco = makeAsset({ asset_id: "OP", display_name: "Fondo Opaco", category: undefined, provider: undefined });
    const out = computeEquitySectorAllocation(
      [
        { asset_id: "LT", weight_percent: 75 },
        { asset_id: "OP", weight_percent: 25 }
      ],
      [conDesglose, opaco]
    );
    // Las filas son % de TODA la RV y, con lo no clasificado, cierran el 100 %.
    expect(out.rows.find((r) => r.key === "technology")?.weight_percent).toBeCloseTo(45, 6);
    expect(out.rows.find((r) => r.key === "healthcare")?.weight_percent).toBeCloseTo(30, 6);
    expect(out.unclassified_weight_percent).toBeCloseTo(25, 6);
    expect(out.rows.reduce((sum, r) => sum + r.weight_percent, 0) + out.unclassified_weight_percent).toBeCloseTo(100, 6);
    // Todo lo repartido es dato publicado: «lookthrough», sin fingir una estimación; el resto va aparte.
    expect(out.quality).toBe("lookthrough");
  });

  test("toda la RV con desglose publicado sigue siendo «look-through» y sin resto", () => {
    const a = makeAsset({ asset_id: "A", exposure_detail: { sectors: { technology: 100 } } });
    const b = makeAsset({ asset_id: "B", instrument_type: "STOCK", sector: "Utilities" });
    const out = computeEquitySectorAllocation([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }], [a, b]);
    expect(out.quality).toBe("lookthrough");
    expect(out.unclassified_weight_percent).toBe(0);
  });

  test("una acción sin `pms_exposure` cuenta entera por su clase RV (fallback defensivo)", () => {
    const sinVector = makeAsset({ asset_id: "S", instrument_type: "STOCK", sector: "Technology", pms_exposure: undefined });
    const out = computeEquitySectorAllocation([{ asset_id: "S", weight_percent: 100 }], [sinVector]);
    expect(out.rows).toEqual([{ key: "technology", weight_percent: 100 }]);
    expect(out.quality).toBe("lookthrough");
    // Un fondo de RF sin vector no aporta RV.
    const bonoSinVector = makeAsset({ asset_id: "RF", economic_asset_class: "FIXED_INCOME", sector: "Technology", pms_exposure: undefined });
    expect(computeEquitySectorAllocation([{ asset_id: "RF", weight_percent: 100 }], [bonoSinVector]).rows).toEqual([]);
  });
});
