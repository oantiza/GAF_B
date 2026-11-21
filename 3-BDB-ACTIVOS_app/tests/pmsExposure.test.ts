import { describe, expect, test } from "vitest";
import { computePmsExposureDistribution } from "../src/core/portfolio";

/**
 * S6a (P5, decisión 27-07): reparto por clases CANÓNICO — normalizado al 100%
 * de lo invertido, con relleno por clase económica para activos sin vector.
 * Antes había cuatro copias (core, Resumen, dos PDF) que divergían justo en
 * estos casos degenerados.
 */
describe("computePmsExposureDistribution", () => {
  test("un vector que no suma 1 se normaliza por su propia suma", () => {
    const result = computePmsExposureDistribution([
      // Vector defectuoso: suma 2.0 — debe contar como 50/50, no como 200%.
      { weight_percent: 100, pms_exposure: { equity: 1, fixed_income: 1, cash: 0, alternative: 0, other: 0 } }
    ]);
    expect(result).not.toBeNull();
    expect(result!.percent.equity).toBeCloseTo(50, 6);
    expect(result!.percent.fixed_income).toBeCloseTo(50, 6);
    expect(result!.covered_weight_percent).toBeCloseTo(100, 6);
  });

  test("sin vector, el activo cuenta por su clase económica (relleno)", () => {
    const result = computePmsExposureDistribution([
      { weight_percent: 60, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } },
      { weight_percent: 20, pms_exposure: null, economic_asset_class: "FIXED_INCOME" },
      { weight_percent: 20, pms_exposure: null, economic_asset_class: "MONEY_MARKET" }
    ]);
    expect(result).not.toBeNull();
    expect(result!.percent.equity).toBeCloseTo(60, 6);
    expect(result!.percent.fixed_income).toBeCloseTo(20, 6);
    expect(result!.percent.cash).toBeCloseTo(20, 6);
    expect(result!.covered_weight_percent).toBeCloseTo(60, 6);
    expect(result!.fallback_weight_percent).toBeCloseTo(40, 6);
  });

  test("con pesos que no suman 100, el reparto se normaliza igualmente a 100", () => {
    const result = computePmsExposureDistribution([
      { weight_percent: 60, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } },
      { weight_percent: 20, pms_exposure: null, economic_asset_class: "FIXED_INCOME" }
      // 20% sin asignar: NO entra en el reparto (es hueco, no una clase).
    ]);
    expect(result).not.toBeNull();
    expect(result!.percent.equity).toBeCloseTo(75, 6);
    expect(result!.percent.fixed_income).toBeCloseTo(25, 6);
    const sum = Object.values(result!.percent).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  test("clase económica desconocida o ausente cae a Otros", () => {
    const result = computePmsExposureDistribution([
      { weight_percent: 50, pms_exposure: undefined, economic_asset_class: "UNKNOWN" },
      { weight_percent: 50, pms_exposure: { equity: 0, fixed_income: 0, cash: 0, alternative: 0, other: 0 } }
    ]);
    expect(result).not.toBeNull();
    // El segundo tiene vector pero TODO a cero: también cae al relleno.
    expect(result!.percent.other).toBeCloseTo(100, 6);
    expect(result!.fallback_weight_percent).toBeCloseTo(100, 6);
  });

  test("expone qué parte del peso cubierto es look-through real", () => {
    const result = computePmsExposureDistribution([
      {
        weight_percent: 30,
        pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0, source: "PORTFOLIO_EXPOSURE" }
      },
      { weight_percent: 30, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } }
    ]);
    expect(result).not.toBeNull();
    expect(result!.real_lookthrough_weight_percent).toBeCloseTo(50, 6);
  });

  test("el relleno por clase que manda el servidor reparte igual, pero no cubre: la cobertura es solo de quien trae su mezcla (revisión final, V3-1)", () => {
    /* La muestra en la base nueva: PIMCO (20 %) no trae mezcla, y el servidor la manda como 100 % renta fija con CLASSIFICATION_FALLBACK. */
    const muestra = computePmsExposureDistribution([
      { weight_percent: 80, pms_exposure: { equity: 0.7, fixed_income: 0.25, cash: 0.05, alternative: 0, other: 0, source: "PORTFOLIO_EXPOSURE" } },
      { weight_percent: 20, pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0, source: "CLASSIFICATION_FALLBACK" }, economic_asset_class: "FIXED_INCOME" }
    ]);
    /* 0,8 × 0,7 = 56; 0,8 × 0,25 + 0,2 = 40; 0,8 × 0,05 = 4: las mismas cifras de antes. */
    expect(muestra!.percent.equity).toBeCloseTo(56, 6);
    expect(muestra!.percent.fixed_income).toBeCloseTo(40, 6);
    expect(muestra!.percent.cash).toBeCloseTo(4, 6);
    expect(muestra!.covered_weight_percent).toBeCloseTo(80, 6);
    expect(muestra!.fallback_weight_percent).toBeCloseTo(20, 6);
    expect(muestra!.real_lookthrough_weight_percent).toBeCloseTo(100, 6);

    /* JPMorgan India y Global Brands, 50/50, ninguno con mezcla: 100 % renta variable por su clase, y 0 % cubierto. */
    const porClase = { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0, source: "CLASSIFICATION_FALLBACK" };
    const india = computePmsExposureDistribution([
      { weight_percent: 50, pms_exposure: porClase, economic_asset_class: "EQUITY" },
      { weight_percent: 50, pms_exposure: porClase, economic_asset_class: "EQUITY" }
    ]);
    expect(india!.percent.equity).toBeCloseTo(100, 6);
    expect(india!.covered_weight_percent).toBeCloseTo(0, 6);
    expect(india!.fallback_weight_percent).toBeCloseTo(100, 6);
  });

  test("sin peso invertido devuelve null", () => {
    expect(computePmsExposureDistribution([])).toBeNull();
    expect(
      computePmsExposureDistribution([{ weight_percent: 0, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } }])
    ).toBeNull();
  });
});
