import { describe, expect, test } from "vitest";
import { porcentaje as escribirPorcentaje } from "../src/core/formato";
import { assetRateForAverage, BASE_DE_LECTURA_EUR, calculatePortfolioCosts, calculatePortfolioManagementFee, comisionIndicada, detalleDeLaOperacion, esSoloDeAcciones, fraseDelCoste, fuenteDeLaFila, LO_QUE_NO_INCLUYE_EL_COSTE, operacionEnUnaCasilla } from "../src/core/portfolioCosts";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";

describe("coste corriente ponderado de cartera", () => {
  test("regresión de la captura: 181,25 % de pesos no convierte 100.000 euros en 181.250", () => {
    const before = structuredClone(costPositions);
    const result = calculatePortfolioCosts(costPositions, costAssets, 100000);
    expect(result.inputWeight).toBe(181.25);
    expect(result.normalized).toBe(true);
    expect(result.totalWeight).toBe(100);
    expect(result.rows.reduce((sum, row) => sum + row.capital!, 0)).toBeCloseTo(100000, 8);
    expect(result.avgCostPct).toBeCloseTo(.01758264827586207, 12);
    expect(result.totalCostEur).toBeCloseTo(1758.264827586207, 8);
    expect(costPositions).toEqual(before);
  });
  test("gestión no se suma y multiplicar todos los pesos por el mismo factor no cambia el coste", () => {
    const expected = calculatePortfolioCosts(costPositions, costAssets, 100000);
    for (const factor of [.25, 2]) {
      const result = calculatePortfolioCosts(costPositions.map((p) => ({ ...p, weight_percent: p.weight_percent * factor })),
        costAssets.map((asset) => ({ ...asset, costs: { ...asset.costs, management_fee: .50 } })), 100000);
      expect(result.avgCostPct).toBeCloseTo(expected.avgCostPct!, 12);
      expect(result.totalCostEur).toBeCloseTo(expected.totalCostEur!, 8);
    }
  });
  test("pesos al 100 % mantienen el resultado y no generan aviso de normalización", () => {
    const result = calculatePortfolioCosts([{ asset_id: costAssets[0].asset_id, weight_percent: 100 }], costAssets, 100000);
    expect(result.normalized).toBe(false);
    expect(result.avgCostPct).toBe(.0159);
    expect(result.totalCostEur).toBeCloseTo(1590);
  });
  test("sin costes no inventa ceros; cobertura parcial no publica una media de toda la cartera", () => {
    const positions = costPositions.slice(0, 2).map((p) => ({ ...p, weight_percent: 50 }));
    const assets = costAssets.map((a, i) => i === 1 ? { ...a, costs: undefined } : a);
    const partial = calculatePortfolioCosts(positions, assets, 100000);
    expect(partial.coveragePct).toBe(.5);
    expect(partial.avgCostPct).toBeNull();
    expect(partial.totalCostEur).toBeCloseTo(795);
    const missing = calculatePortfolioCosts(positions, [], 100000);
    expect(missing.coveragePct).toBe(0);
    expect(missing.avgCostPct).toBeNull();
    expect(missing.totalCostEur).toBeNull();
  });
  test("un coste cero real es válido; un coste infinito o negativo no", () => {
    const positions = [{ ...costPositions[0], weight_percent: 100 }];
    for (const rate of [0, Infinity, NaN, -.01]) {
      const result = calculatePortfolioCosts(positions, [{ ...costAssets[0], costs: { ongoing_charge: rate } }], 100000);
      expect(result.avgCostPct).toBe(rate === 0 ? 0 : null);
      expect(result.totalCostEur).toBe(rate === 0 ? 0 : null);
    }
  });
  test("la media no depende del capital y sin capital no se inventan importes", () => {
    for (const capital of [0, -100, NaN, Infinity]) {
      const result = calculatePortfolioCosts(costPositions, costAssets, capital);
      expect(result.avgCostPct).toBeCloseTo(.01758264827586207, 12);
      expect(result.totalCapital).toBeNull();
      expect(result.totalCostEur).toBeNull();
      expect(result.rows.every((row) => row.capital == null)).toBe(true);
    }
  });
  test("cartera vacía y pesos inválidos no generan coste ni capital ficticio", () => {
    for (const positions of [[], [0, -1, NaN, Infinity].map((weight_percent) => ({ asset_id: costAssets[0].asset_id, weight_percent }))]) {
      const result = calculatePortfolioCosts(positions, costAssets, 100000);
      expect(result.rows).toEqual([]);
      expect(result.avgCostPct).toBeNull();
      expect(result.totalCostEur).toBeNull();
    }
  });
});

describe("comisión adicional de gestión de la cartera", () => {
  const costs = calculatePortfolioCosts(costPositions, costAssets, 100000);
  test("0,50 % anual y 500 euros anuales dan el mismo coste adicional, sin duplicar la gestión de los fondos", () => {
    const percentage = calculatePortfolioManagementFee(costs, .5, "percent");
    const euros = calculatePortfolioManagementFee(costs, 500, "euros");
    expect(percentage).toEqual(euros);
    expect(percentage.annualEur).toBe(500);
    expect(percentage.combinedRate).toBeCloseTo(.02258264827586207, 12);
    expect(percentage.combinedAnnualEur).toBeCloseTo(2258.264827586207, 8);
    expect(costs.totalCostEur).toBeCloseTo(1758.264827586207, 8);
  });
  test("una comisión cero mantiene el coste corriente; vacíos, negativos y porcentajes fuera de rango no publican total", () => {
    expect(calculatePortfolioManagementFee(costs, 0, "percent").combinedAnnualEur).toBe(costs.totalCostEur);
    for (const value of [null, -1, NaN, Infinity, 101]) {
      const result = calculatePortfolioManagementFee(costs, value, "percent");
      expect(result.valid).toBe(false);
      expect(result.annualEur).toBeNull();
      expect(result.combinedAnnualEur).toBeNull();
    }
  });
  test("capital y comisión se aplican una sola vez aunque los pesos sumen más del 100 %", () => {
    const larger = calculatePortfolioCosts(costPositions, costAssets, 200000);
    expect(calculatePortfolioManagementFee(larger, .5, "percent").annualEur).toBe(1000);
    expect(calculatePortfolioManagementFee(larger, 500, "euros").annualEur).toBe(500);
    expect(calculatePortfolioManagementFee(larger, 500, "euros").rate).toBe(.0025);
  });
  test("con costes incompletos se conoce la comisión, pero no el coste conjunto de la cartera", () => {
    const incomplete = calculatePortfolioCosts(costPositions, costAssets.slice(0, 1), 100000);
    const fee = calculatePortfolioManagementFee(incomplete, .5, "percent");
    expect(fee.annualEur).toBe(500);
    expect(fee.combinedAnnualEur).toBeNull();
    expect(fee.combinedRate).toBeNull();
  });
  test("sin capital una comisión en euros sigue conocida, pero su porcentaje no se inventa", () => {
    const noCapital = calculatePortfolioCosts(costPositions, costAssets, 0);
    const fixed = calculatePortfolioManagementFee(noCapital, 500, "euros");
    expect(fixed.annualEur).toBe(500);
    expect(fixed.rate).toBeNull();
    expect(fixed.combinedAnnualEur).toBeNull();
    expect(calculatePortfolioManagementFee(noCapital, .5, "percent").annualEur).toBeNull();
  });
});

describe("una acción en los costes (decisión 10)", () => {
  const fondo = (asset_id: string, ongoing_charge?: number) =>
    ({ ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, instrument_type: "FUND", costs: ongoing_charge === undefined ? undefined : { ongoing_charge, management_fee: .008 } }) as BdbAssetDetail;
  const accion = (asset_id = "ES0144580Y14", extra: Partial<BdbAssetDetail> = {}) =>
    ({ ...costAssets[0], asset_id, isin: asset_id, display_name: "Iberdrola S.A.", instrument_type: "STOCK", costs: undefined, ...extra }) as BdbAssetDetail;

  test("70 % en fondos al 1 % y 30 % en una acción: 0,70 % y, con 100.000 €, 700 € al año", () => {
    const result = calculatePortfolioCosts(
      [{ asset_id: "F1", weight_percent: 40 }, { asset_id: "F2", weight_percent: 30 }, { asset_id: "ES0144580Y14", weight_percent: 30 }],
      [fondo("F1", .01), fondo("F2", .01), accion()],
      100000
    );
    expect(result.avgCostPct).toBeCloseTo(.007, 12);
    expect(result.totalCostEur).toBeCloseTo(700, 8);
    /* Las dos cifras casan: 0,70 % de 100.000 € son 700 €. */
    expect(result.avgCostPct! * 100000).toBeCloseTo(result.totalCostEur!, 8);
    expect(result.missing).toBe(0);
    expect(result.acciones).toBe(1);
    expect(result.coveragePct).toBeCloseTo(1, 12);
  });

  test("en su fila no hay un 0 %: no aplica", () => {
    const fila = calculatePortfolioCosts([{ asset_id: "ES0144580Y14", weight_percent: 100 }], [accion()], 100000).rows[0];
    expect(fila).toMatchObject({ aplicaCoste: false, ongoingPct: null, mgmtPct: null, costEur: null, capital: 100000 });
  });

  test("con un 1 % en Iberdrola la media deja de ser N/D", () => {
    const result = calculatePortfolioCosts(
      [{ asset_id: "F1", weight_percent: 99 }, { asset_id: "ES0144580Y14", weight_percent: 1 }],
      [fondo("F1", .01), accion()],
      100000
    );
    expect(result.avgCostPct).toBeCloseTo(.0099, 12);
    expect(result.totalCostEur).toBeCloseTo(990, 8);
    expect(result.missing).toBe(0);
    expect(calculatePortfolioManagementFee(result, .5, "percent").combinedRate).toBeCloseTo(.0149, 12);
  });

  test("un fondo o un ETF sin coste sigue siendo un dato que falta, también junto a una acción", () => {
    const result = calculatePortfolioCosts(
      [{ asset_id: "F1", weight_percent: 40 }, { asset_id: "F2", weight_percent: 30 }, { asset_id: "ES0144580Y14", weight_percent: 30 }],
      [fondo("F1", .01), fondo("F2"), accion()],
      100000
    );
    expect(result.missing).toBe(1);
    expect(result.acciones).toBe(1);
    expect(result.avgCostPct).toBeNull();
    /* Lo identificado: el fondo con dato. */
    expect(result.totalCostEur).toBeCloseTo(400, 8);
    expect(result.coveragePct).toBeCloseTo(.7, 12);
  });

  test("una acción y un fondo sin dato no suman 0 €: se desconoce", () => {
    const result = calculatePortfolioCosts(
      [{ asset_id: "F2", weight_percent: 50 }, { asset_id: "ES0144580Y14", weight_percent: 50 }],
      [fondo("F2"), accion()],
      100000
    );
    expect(result.avgCostPct).toBeNull();
    expect(result.totalCostEur).toBeNull();
  });

  test("solo acciones: 0 % y 0 €, porque no falta ningún dato; sin capital, sin euros", () => {
    const positions = [{ asset_id: "ES0144580Y14", weight_percent: 100 }];
    const result = calculatePortfolioCosts(positions, [accion()], 100000);
    expect(result.avgCostPct).toBe(0);
    expect(result.totalCostEur).toBe(0);
    expect(result.acciones).toBe(1);
    const sinCapital = calculatePortfolioCosts(positions, [accion()], 0);
    expect(sinCapital.avgCostPct).toBe(0);
    expect(sinCapital.totalCostEur).toBeNull();
  });

  test("una acción que trae un coste no lo cuenta: un campo presente donde no aplica es un error", () => {
    const conCampo = accion("ES0144580Y14", { costs: { ongoing_charge: .02, management_fee: .01 } });
    const result = calculatePortfolioCosts([{ asset_id: "ES0144580Y14", weight_percent: 100 }], [conCampo], 100000);
    expect(result.avgCostPct).toBe(0);
    expect(result.rows[0]).toMatchObject({ ongoingPct: null, mgmtPct: null, costEur: null });
    expect(assetRateForAverage(conCampo)).toBe(0);
  });

  test("el cero es solo para una acción: un índice, un tipo desconocido o un activo que no llega siguen faltando", () => {
    expect(assetRateForAverage(accion())).toBe(0);
    expect(assetRateForAverage(fondo("F1", .01))).toBe(.01);
    expect(assetRateForAverage(fondo("F2"))).toBeNull();
    expect(assetRateForAverage({ ...fondo("I"), instrument_type: "INDEX" })).toBeNull();
    expect(assetRateForAverage({ ...fondo("X"), instrument_type: "ETF" })).toBeNull();
    expect(assetRateForAverage(undefined)).toBeNull();
    expect(calculatePortfolioCosts([{ asset_id: "NO-LLEGA", weight_percent: 100 }], [], 100000).missing).toBe(1);
  });

  test("los pesos que no suman 100 se normalizan también con una acción", () => {
    const result = calculatePortfolioCosts(
      [{ asset_id: "F1", weight_percent: 70 }, { asset_id: "ES0144580Y14", weight_percent: 30 }].map((p) => ({ ...p, weight_percent: p.weight_percent * 2 })),
      [fondo("F1", .01), accion()],
      100000
    );
    expect(result.normalized).toBe(true);
    expect(result.avgCostPct).toBeCloseTo(.007, 12);
    expect(result.totalCostEur).toBeCloseTo(700, 8);
  });
});

describe("la frase del coste, sin capital declarado (decisión 5)", () => {
  /* El espacio de duro de `fmtEur` no es lo que se prueba aquí. */
  const frase = (...args: Parameters<typeof fraseDelCoste>) => fraseDelCoste(...args).replace(/\u00a0/g, " ");
  const fondo = (asset_id: string, ongoing_charge?: number): BdbAssetDetail => ({
    ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, costs: ongoing_charge === undefined ? undefined : { ongoing_charge }
  });
  const accion = (asset_id = "ES0144580Y14"): BdbAssetDetail => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, instrument_type: "STOCK", costs: undefined });
  const costes = (filas: [BdbAssetDetail, number][]) => calculatePortfolioCosts(filas.map(([a, weight_percent]) => ({ asset_id: a.asset_id, weight_percent })), filas.map(([a]) => a), 0);

  test("resultado conocido: los pesos y costes de la cartera de muestra, a mano, dan 0,9489 %: 0,95 % y unos 95 €", () => {
    /* 24 × 0,20 + 12 × 0,07 + 10 × 2,08 + 8 × 1,52 + 20 × 1,39 + 10 × 0,50 + 9 × 1,42 + 7 × 1,53 = 94,89, y entre 100 es 0,9489 %. */
    const muestra = costes([
      [fondo("A", .002), 24], [fondo("B", .0007), 12], [fondo("C", .0208), 10], [fondo("D", .0152), 8],
      [fondo("E", .0139), 20], [fondo("F", .005), 10], [fondo("G", .0142), 9], [fondo("H", .0153), 7]
    ]);
    expect(muestra.avgCostPct).toBeCloseTo(.009489, 10);
    expect(frase(muestra)).toBe("0,95 % al año, unos 95 € por cada 10.000 €");
  });

  test("las dos cifras son la misma: una centésima de punto sobre 10.000 € es justo un euro", () => {
    const una = costes([[fondo("A", .0125), 100]]);
    expect(frase(una)).toBe("1,25 % al año, unos 125 € por cada 10.000 €");
    expect(frase(una, .1234)).toBe("12,34 % al año, unos 1.234 € por cada 10.000 €");
    expect(frase(una, .0049)).toBe("0,49 % al año, unos 49 € por cada 10.000 €");
    expect(BASE_DE_LECTURA_EUR).toBe(10000);
    /* Y con todas las tasas, también justo a la mitad, el porcentaje es el que escribe `porcentaje` en el resto del papel. */
    for (let milesimas = 1; milesimas <= 6000; milesimas += 1) {
      const tasa = milesimas / 1_000_000;
      const texto = frase(una, tasa);
      if (tasa < .00005) continue;
      const [, porcentaje, euros] = /^([\d,]+) % al año, unos ([\d.]+) €/.exec(texto) ?? [];
      expect(`${porcentaje} %`).toBe(escribirPorcentaje(tasa)?.replace(/\u00a0/g, " "));
      expect(Number(euros.replace(".", ""))).toBe(Number(porcentaje.replace(",", "")));
    }
  });

  test("coste desconocido: no hay cifra, se dice cuánto falta; un dato ausente no es un cero", () => {
    expect(frase(costes([[fondo("A", .01), 50], [fondo("B"), 50]]))).toBe("No disponible: falta el coste de 1 de las 2 posiciones");
    expect(frase(costes([[fondo("A"), 50], [fondo("B"), 50]]))).toBe("No disponible: falta el coste de 2 de las 2 posiciones");
    expect(frase(costes([[fondo("A"), 100]]))).toBe("No disponible: falta el coste de la única posición");
    /* Una acción junto a un fondo sin dato tampoco da 0 %. */
    expect(frase(costes([[fondo("A"), 70], [accion(), 30]]))).toBe("No disponible: falta el coste de 1 de las 2 posiciones");
    /* Aunque se pase una tasa: sin el coste de los productos, una comisión sola no es el coste. */
    expect(frase(costes([[fondo("A"), 100]]), .005)).toBe("No disponible: falta el coste de la única posición");
    /* Ni una comisión a medias ni una tasa inválida se convierten en cifra. */
    const completa = costes([[fondo("A", .01), 100]]);
    for (const tasa of [null, Number.NaN, Number.POSITIVE_INFINITY, -.01]) expect(frase(completa, tasa)).toBe("No disponible");
    expect(frase(calculatePortfolioCosts([], [], 0))).toBe("No disponible");
  });

  test("solo acciones: «No aplica», como la pantalla, nunca un 0,00 % ni «unos 0 €» (decisión A-65), y una comisión sí se traduce", () => {
    const dos = costes([[accion("X1"), 50], [accion("X2"), 50]]);
    expect(frase(dos)).toBe("No aplica");
    const una = costes([[accion(), 100]]);
    expect(frase(una)).toBe("No aplica");
    expect(frase(dos, .005)).toBe("0,50 % al año, unos 50 € por cada 10.000 €");
    /* El cálculo no cambia: cuenta como cero, y eso es lo que lee la diferencia de la Propuesta de cambio. */
    expect(dos.avgCostPct).toBe(0);
  });

  test("solo son acciones las que lo son todas: un fondo al 0 % o una cartera vacía no", () => {
    expect(esSoloDeAcciones(costes([[accion("X1"), 50], [accion("X2"), 50]]))).toBe(true);
    expect(esSoloDeAcciones(costes([[fondo("A", 0), 50], [accion(), 50]]))).toBe(false);
    expect(esSoloDeAcciones(costes([[fondo("A", 0), 100]]))).toBe(false);
    expect(esSoloDeAcciones(calculatePortfolioCosts([], [], 0))).toBe(false);
  });

  test("con acciones y fondos, la acción cuenta como cero: 70 % al 1 % y 30 % en acción es 0,70 %", () => {
    expect(frase(costes([[fondo("A", .01), 70], [accion(), 30]]))).toBe("0,70 % al año, unos 70 € por cada 10.000 €");
  });

  test("una sola posición: es su coste", () => {
    expect(frase(costes([[fondo("A", .0139), 100]]))).toBe("1,39 % al año, unos 139 € por cada 10.000 €");
  });

  test("los pesos que no suman 100 se normalizan: la frase no depende de la escala", () => {
    expect(frase(costes([[fondo("A", .01), 140], [accion(), 60]]))).toBe("0,70 % al año, unos 70 € por cada 10.000 €");
  });

  test("lo que no llega a una centésima no se redondea a gratis, y un 0 % de un fondo es lo que dice el dato", () => {
    expect(frase(costes([[fondo("A", .0004), 10], [accion(), 90]]))).toBe("Menos de 0,01 % al año, menos de 1 € por cada 10.000 €");
    expect(frase(costes([[fondo("A", 0), 100]]))).toBe("0,00 % al año");
    expect(frase(costes([[fondo("A", 0), 50], [accion(), 50]]))).toBe("0,00 % al año");
  });

  test("lo que no incluye: la línea que dictó Óscar (decisión A-65), con las comisiones de entrada (suscripción) y salida (reembolso)", () => {
    /* La denominación es la de Óscar del 11-11-2026; los tres últimos términos, con espacios duros (decisión 80). */
    expect(LO_QUE_NO_INCLUYE_EL_COSTE).toBe("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
  });

  test("la comisión se escribe como se ha indicado: sin decimales de más, y sin redondear lo que ha escrito el asesor (decisión A-65)", () => {
    const escrita = (cantidad: number, unidad: "percent" | "euros", capital = 100000) =>
      comisionIndicada(calculatePortfolioManagementFee(calculatePortfolioCosts([{ asset_id: "A", weight_percent: 100 }], [fondo("A", .01)], capital), cantidad, unidad), unidad).replace(/\u00a0/g, " ");
    expect(escrita(.5, "percent")).toBe("Comisión indicada: 0,50 % anual.");
    expect(escrita(1, "percent")).toBe("Comisión indicada: 1,00 % anual.");
    expect(escrita(.125, "percent")).toBe("Comisión indicada: 0,125 % anual.");
    expect(escrita(.1234, "percent")).toBe("Comisión indicada: 0,1234 % anual.");
    expect(escrita(0, "percent")).toBe("Comisión indicada: 0,00 % anual.");
    expect(escrita(500, "euros")).toBe("Comisión indicada: 500,00 € anual.");
    expect(escrita(1234.5, "euros")).toBe("Comisión indicada: 1.234,50 € anual.");
    /* Sin capital, el porcentaje se escribe igual. */
    expect(escrita(.5, "percent", 0)).toBe("Comisión indicada: 0,50 % anual.");
  });

  test("no depende del capital: es la misma frase se haya declarado o no", () => {
    const filas = [{ asset_id: "A", weight_percent: 100 }];
    expect(frase(calculatePortfolioCosts(filas, [fondo("A", .0095)], 0))).toBe(frase(calculatePortfolioCosts(filas, [fondo("A", .0095)], 250000)));
  });
});

describe("operación, entrada y fuente de cada cifra (decisión 43 de Óscar)", () => {
  const base = costAssets[0];
  const activo = (asset_id: string, costs: BdbAssetDetail["costs"], instrument_type: BdbAssetDetail["instrument_type"] = "FUND"): BdbAssetDetail =>
    ({ ...base, asset_id, isin: asset_id, display_name: asset_id, instrument_type, costs });
  const kid = (ongoing: number, operacion: number, entrada: number | undefined, fecha = "2026-08-19"): BdbAssetDetail["costs"] => ({
    ongoing_charge: ongoing, ongoing_charge_source: "KID", transaction_costs: operacion, transaction_costs_source: "KID",
    ...(entrada === undefined ? {} : { entry_charge: entrada, entry_charge_source: "KID" as const }),
    document_url: "https://ejemplo.invalid/kid.pdf", document_date: fecha
  });
  const proveedor = (ongoing: number, operacion: number): BdbAssetDetail["costs"] => ({
    ongoing_charge: ongoing, ongoing_charge_source: "PROVIDER", transaction_costs: operacion, transaction_costs_source: "PROVIDER"
  });
  const posiciones = (pesos: Record<string, number>) => Object.entries(pesos).map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));

  /* La muestra en la base nueva, leída de sus KID uno a uno:
     Amundi 10 × 0,37 + Robeco 8 × 0,26 + PIMCO 20 × 0,21 + JPMorgan 10 × 0,22 + R-co 9 × 0,05 + Goldman 7 × 0,22 = 14,17, sobre el 64 % del peso.
     Los dos ETF no tienen KID: iShares 24 × 0,00263 + Vanguard 12 × 0,001 = 0,07512, sobre el 36 %.
     Coste corriente: 24 × 0,20 + 12 × 0,07 + 10 × 2,08 + 8 × 1,52 + 20 × 1,39 + 10 × 0,50 + 9 × 1,42 + 7 × 1,53 = 94,89. */
  const MUESTRA = posiciones({ ISHARES: 24, VANGUARD: 12, AMUNDI: 10, ROBECO: 8, PIMCO: 20, JPM: 10, RCO: 9, GS: 7 });
  const ACTIVOS_NUEVA = [
    activo("ISHARES", proveedor(.002, .0000263)), activo("VANGUARD", proveedor(.0007, .00001)),
    activo("AMUNDI", kid(.0208, .0037, .045)), activo("ROBECO", kid(.0152, .0026, .05)),
    activo("PIMCO", { ...kid(.0139, .0021, undefined, "2026-04-29"), entry_charge: .05, entry_charge_source: "PROVIDER" }),
    activo("JPM", kid(.005, .0022, 0)), activo("RCO", kid(.0142, .0005, .03)), activo("GS", kid(.0153, .0022, .055))
  ];

  test("la muestra: 0,14 % del KID sobre el 64 %, menos de una centésima del proveedor sobre el 36 %, y 1,09 % con el corriente", () => {
    const costes = calculatePortfolioCosts(MUESTRA, ACTIVOS_NUEVA, 100000);
    expect(costes.avgCostPct! * 100).toBeCloseTo(.9489, 10);
    expect(costes.operacion.delKid * 100).toBeCloseTo(.1417, 10);
    expect(costes.operacion.pesoKid).toBeCloseTo(.64, 10);
    expect(costes.operacion.delProveedor * 100).toBeCloseTo(.0007512, 10);
    expect(costes.operacion.pesoProveedor).toBeCloseTo(.36, 10);
    expect(costes.operacion.tasa! * 100).toBeCloseTo(.1424512, 10);
    expect(costes.corrienteMasOperacionPct! * 100).toBeCloseTo(1.0913512, 10);
    expect(costes.totalCostEur).toBeCloseTo(948.9, 8);
    expect(detalleDeLaOperacion(costes.operacion)).toBe("Del KID, 0,14\u00a0% de la cartera, medido sobre el 64,0\u00a0% del peso; del proveedor, menos de 0,01\u00a0%, sobre el 36,0\u00a0%.");
  });

  test("la muestra en la base vieja, sin operación de proveedor: 0,14 % sobre el 64 %, y no hay total", () => {
    /* JPMorgan lleva allí un KID anterior: 0,20. 3,7 + 2,08 + 4,2 + 2,0 + 0,45 + 1,54 = 13,97. */
    const vieja = ACTIVOS_NUEVA.map((a) => a.asset_id === "ISHARES" || a.asset_id === "VANGUARD"
      ? activo(a.asset_id, { ongoing_charge: a.costs!.ongoing_charge, ongoing_charge_source: "PROVIDER" })
      : a.asset_id === "JPM" ? activo("JPM", kid(.005, .002, undefined)) : a);
    const costes = calculatePortfolioCosts(MUESTRA, vieja, 100000);
    expect(costes.operacion.delKid * 100).toBeCloseTo(.1397, 10);
    expect(costes.operacion.pesoKid).toBeCloseTo(.64, 10);
    expect(costes.operacion.sinDato).toBe(2);
    expect(costes.operacion.pesoSinDato).toBeCloseTo(.36, 10);
    expect(costes.operacion.tasa).toBeNull();
    expect(costes.corrienteMasOperacionPct).toBeNull();
    expect(detalleDeLaOperacion(costes.operacion)).toBe("Del KID, 0,14\u00a0% de la cartera, medido sobre el 64,0\u00a0% del peso. El 36,0\u00a0% del peso no tiene el dato: la cifra solo cuenta lo medido, y por eso no se da un total.");
  });

  test("una acción no entra: en su fila no aplica, y lo que no tiene un fondo falta, no es un cero", () => {
    /* 50 × 0,40 = 20, es decir 0,20 %, sobre el 50 %. Falta el 30 %. El 20 % son acciones. */
    const costes = calculatePortfolioCosts(posiciones({ F1: 50, F2: 30, ACCION: 20 }),
      [activo("F1", kid(.01, .004, .03)), activo("F2", { ongoing_charge: .01, ongoing_charge_source: "PROVIDER" }), activo("ACCION", undefined, "STOCK")], 0);
    expect(costes.operacion.delKid * 100).toBeCloseTo(.2, 10);
    expect(costes.operacion.pesoKid).toBeCloseTo(.5, 10);
    expect(costes.operacion.pesoSinDato).toBeCloseTo(.3, 10);
    expect(costes.operacion.pesoAcciones).toBeCloseTo(.2, 10);
    expect(costes.operacion.tasa).toBeNull();
    const accion = costes.rows.find((fila) => fila.assetId === "ACCION")!;
    expect(accion.aplicaCoste).toBe(false);
    expect(accion.operacionPct).toBeNull();
    expect(accion.entradaPct).toBeNull();
    expect(detalleDeLaOperacion(costes.operacion)).toBe("Del KID, 0,20\u00a0% de la cartera, medido sobre el 50,0\u00a0% del peso. El 30,0\u00a0% del peso no tiene el dato: la cifra solo cuenta lo medido, y por eso no se da un total. El 20,0\u00a0% son acciones, y a una acción no le aplica.");
  });

  test("una acción y un fondo con el dato: el total se sostiene, porque la acción no tiene operación que falte", () => {
    /* 90 × 0,30 = 27, 0,27 %; corriente 90 × 1,00 = 90, 0,90 %; juntos 1,17 %. */
    const costes = calculatePortfolioCosts(posiciones({ F1: 90, ACCION: 10 }), [activo("F1", kid(.01, .003, .05)), activo("ACCION", undefined, "STOCK")], 0);
    expect(costes.operacion.tasa! * 100).toBeCloseTo(.27, 10);
    expect(costes.corrienteMasOperacionPct! * 100).toBeCloseTo(1.17, 10);
  });

  test("solo acciones: no hay nada que medir, y no es un cero", () => {
    const costes = calculatePortfolioCosts(posiciones({ ACCION: 100 }), [activo("ACCION", undefined, "STOCK")], 100000);
    expect(costes.operacion.tasa).toBeNull();
    expect(costes.corrienteMasOperacionPct).toBeNull();
    expect(detalleDeLaOperacion(costes.operacion)).toBe("A una acción no le aplica: no tiene costes de operación de fondo.");
  });

  test("ningún fondo con el dato: no se inventa nada", () => {
    const costes = calculatePortfolioCosts(posiciones({ F1: 100 }), [activo("F1", { ongoing_charge: .01 })], 100000);
    expect(costes.operacion.tasa).toBeNull();
    expect(costes.operacion.medido).toBe(0);
    expect(detalleDeLaOperacion(costes.operacion)).toBe("Ningún fondo tiene el dato.");
  });

  test("pesos que no suman 100 y una posición al 0 %: se reparte como el coste corriente", () => {
    /* 200 de peso: 150 y 50, o sea 75 % y 25 %. 75 × 0,40 + 25 × 0,20 = 35, 0,35 %. La del 0 % no cuenta. */
    const costes = calculatePortfolioCosts(posiciones({ F1: 150, F2: 50, F3: 0 }),
      [activo("F1", kid(.01, .004, .03)), activo("F2", proveedor(.01, .002)), activo("F3", kid(.01, .09, .03))], 0);
    expect(costes.operacion.tasa! * 100).toBeCloseTo(.35, 10);
    expect(costes.operacion.pesoKid + costes.operacion.pesoProveedor).toBeCloseTo(1, 10);
  });

  test("una cifra con su fuente: sin fuente no se enseña, y una acción con costes no se cree", () => {
    const sinFuente = calculatePortfolioCosts(posiciones({ F1: 100 }), [activo("F1", { ongoing_charge: .01, transaction_costs: .003, entry_charge: .05 })], 0);
    expect(sinFuente.rows[0].operacionPct).toBeNull();
    expect(sinFuente.rows[0].entradaPct).toBeNull();
    expect(sinFuente.rows[0].ongoingPct).toBe(.01);
    const accion = calculatePortfolioCosts(posiciones({ A: 100 }), [activo("A", kid(.01, .003, .05), "STOCK")], 0);
    expect(accion.rows[0].operacionPct).toBeNull();
    expect(accion.rows[0].entradaPct).toBeNull();
    expect(accion.operacion.medido).toBe(0);
  });

  test("la entrada máxima es un pago único: no entra en el coste corriente ni en el total", () => {
    const sin = calculatePortfolioCosts(posiciones({ F1: 100 }), [activo("F1", kid(.01, .003, undefined))], 100000);
    const con = calculatePortfolioCosts(posiciones({ F1: 100 }), [activo("F1", kid(.01, .003, .05))], 100000);
    expect(con.avgCostPct).toBe(sin.avgCostPct);
    expect(con.totalCostEur).toBe(sin.totalCostEur);
    expect(con.corrienteMasOperacionPct).toBe(sin.corrienteMasOperacionPct);
    expect(con.rows[0].entradaPct).toBe(.05);
  });

  test("en una casilla, una cifra minúscula no es un cero, y un cero sí; lo que falta, falta", () => {
    expect(operacionEnUnaCasilla(.0000263)).toBe("< 0,01\u00a0%");
    expect(operacionEnUnaCasilla(.00004999)).toBe("< 0,01\u00a0%");
    expect(operacionEnUnaCasilla(.00005)).toBe("0,01\u00a0%");
    expect(operacionEnUnaCasilla(0)).toBe("0,00\u00a0%");
    expect(operacionEnUnaCasilla(.0037)).toBe("0,37\u00a0%");
    expect(operacionEnUnaCasilla(null)).toBe("Falta el dato");
  });

  describe("lo que dice la columna Fuente", () => {
    const fuentes = (corriente: "KID" | "PROVIDER" | null, operacion: "KID" | "PROVIDER" | null, entrada: "KID" | "PROVIDER" | null, hayKid = true, fechaDelKid: string | null = "2026-08-19") =>
      ({ corriente, operacion, entrada, hayKid, fechaDelKid });
    test("las tres del KID: con la fecha del propio documento", () => {
      expect(fuenteDeLaFila(fuentes("KID", "KID", "KID"))).toBe("KID 19/08/2026");
    });
    test("un KID sin fecha legible lo dice: no se le pone otra", () => {
      expect(fuenteDeLaFila(fuentes("KID", "KID", "KID", true, null))).toBe("KID, sin fecha");
    });
    test("sin KID, las que haya son del proveedor", () => {
      expect(fuenteDeLaFila(fuentes("PROVIDER", "PROVIDER", null, false, null))).toBe("Proveedor, sin KID");
    });
    test("con KID, una cifra que no da se nombra (PIMCO, la entrada)", () => {
      expect(fuenteDeLaFila(fuentes("KID", "KID", "PROVIDER", true, "2026-04-29"))).toBe("KID 29/04/2026; entrada: proveedor");
      expect(fuenteDeLaFila(fuentes("KID", "PROVIDER", "PROVIDER"))).toBe("KID 19/08/2026; operación y entrada: proveedor");
    });
    test("con KID y ninguna de las tres sale de él, no se dice que no lo haya", () => {
      expect(fuenteDeLaFila(fuentes("PROVIDER", "PROVIDER", "PROVIDER", true))).toBe("Proveedor");
    });
    test("una cifra que falta no se nombra: ya lo dice su columna", () => {
      expect(fuenteDeLaFila(fuentes("KID", null, null))).toBe("KID 19/08/2026");
    });
    test("sin ninguna cifra con fuente, no hay fuente que decir", () => {
      expect(fuenteDeLaFila(fuentes(null, null, null, false, null))).toBe("Falta el dato");
    });
  });
});
