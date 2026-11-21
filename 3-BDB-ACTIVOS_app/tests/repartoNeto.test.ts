import { describe, expect, test } from "vitest";
import { cajaDeEstilo } from "../src/core/cajaDeEstilo";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import { perfilDeRentaFija } from "../src/core/perfilDeRentaFija";
import { assetPmsShares, computePmsExposureDistribution } from "../src/core/portfolio";
import { filasDeExposicion } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbPmsExposure } from "../src/types/bdbAssets";

/**
 * Decisión A-63 de Óscar (05-11-2026): el reparto del proveedor es neto de cortos, y una clase puede salirse de 0-100 hasta un punto.
 * La cifra se lee tal cual: ni se esconde, ni se reparte entre las demás, ni rompe una suma. Los resultados están hechos a mano
 * sobre los números del canónico de ese día, en porcentaje: 100,0401 − 0,0844 + 0,0432 + 0,0011 = 100.
 */

const LAZARD: BdbPmsExposure = { equity: 1.000401, fixed_income: -0.000844, cash: 0.000432, alternative: 0, real_asset: 0, other: 0.000011, source: "PORTFOLIO_EXPOSURE" };
const ISHARES: BdbPmsExposure = { equity: 0.996335, fixed_income: 0, cash: 0.003295, alternative: 0, real_asset: 0, other: 0.00037, source: "PORTFOLIO_EXPOSURE" };
/* El PIMCO de la base vieja: una clase al 165,5 % y otra al −65,5 %. Eso no se deja describir así, y no es lo que trae la nueva. */
const PIMCO_VIEJO: BdbPmsExposure = { equity: -0.000326, fixed_income: 1.655026, cash: -0.655327, alternative: 0, real_asset: 0, other: 0.000627 };
const VENTANA = 1e-9;

describe("assetPmsShares", () => {
  test("Lazard Small Caps Euro: cada clase tal cual, y sumando 1", () => {
    const { shares, source } = assetPmsShares({ pms_exposure: LAZARD });
    expect(source).toBe("vector");
    expect(shares.equity).toBeCloseTo(1.000401, 9);
    expect(shares.fixed_income).toBeCloseTo(-0.000844, 9);
    expect(shares.cash).toBeCloseTo(0.000432, 9);
    expect(shares.other).toBeCloseTo(0.000011, 9);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test("el límite entra, y lo que se pasa cuenta como siempre: lo positivo, normalizado", () => {
    const dentro = assetPmsShares({ pms_exposure: { equity: 1.01, fixed_income: 0, cash: -0.01, alternative: 0, other: 0 } }).shares;
    expect(dentro.equity).toBeCloseTo(1.01, 9);
    expect(dentro.cash).toBeCloseTo(-0.01, 9);
    const fuera = assetPmsShares({ pms_exposure: { equity: 1.0101, fixed_income: 0, cash: -0.0101, alternative: 0, other: 0 } }).shares;
    expect(fuera.equity).toBe(1);
    expect(fuera.cash).toBe(0);
  });

  test("un vector que no se deja describir así no cambia: el negativo pequeño de PIMCO tampoco se lee, porque el conjunto no vale", () => {
    const { shares } = assetPmsShares({ pms_exposure: PIMCO_VIEJO });
    expect(shares.equity).toBe(0);
    expect(shares.cash).toBe(0);
    expect(shares.fixed_income).toBeCloseTo(1.655026 / 1.655653, 9);
    expect(shares.other).toBeCloseTo(0.000627 / 1.655653, 9);
  });

  test("con la suma lejos de 1 tampoco se lee con signo: un negativo pequeño no infla lo demás", () => {
    const { shares } = assetPmsShares({ pms_exposure: { equity: 0.5, fixed_income: 0, cash: -0.005, alternative: 0, other: 0 } });
    expect(shares.equity).toBe(1);
    expect(shares.cash).toBe(0);
  });

  test("sin nada positivo cuenta su clase económica, como un vector a ceros", () => {
    const { shares, source } = assetPmsShares({ pms_exposure: { equity: 0, fixed_income: 0, cash: -0.005, alternative: 0, other: 0 }, economic_asset_class: "FIXED_INCOME" });
    expect(source).toBe("class");
    expect(shares.fixed_income).toBe(1);
  });
});

describe("computePmsExposureDistribution", () => {
  test("solo Lazard: bolsa 100,04, renta fija −0,08, y suma 100", () => {
    const { percent } = computePmsExposureDistribution([{ weight_percent: 100, pms_exposure: LAZARD }])!;
    expect(percent.equity).toBeCloseTo(100.0401, 6);
    expect(percent.fixed_income).toBeCloseTo(-0.0844, 6);
    expect(percent.cash).toBeCloseTo(0.0432, 6);
    expect(percent.other).toBeCloseTo(0.0011, 6);
    expect(Object.values(percent).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  test("con otro fondo, cada clase es la media ponderada con su signo", () => {
    const { percent } = computePmsExposureDistribution([
      { weight_percent: 50, pms_exposure: LAZARD },
      { weight_percent: 50, pms_exposure: ISHARES }
    ])!;
    /* (100,0401 + 99,6335) / 2 y (−0,0844 + 0) / 2. */
    expect(percent.equity).toBeCloseTo(99.8368, 6);
    expect(percent.fixed_income).toBeCloseTo(-0.0422, 6);
    expect(percent.cash).toBeCloseTo(0.18635, 6);
    expect(percent.other).toBeCloseTo(0.01905, 6);
    expect(Object.values(percent).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  test("lo positivo de otro fondo compensa lo negativo: la cartera no enseña un negativo que no tiene", () => {
    const { percent } = computePmsExposureDistribution([
      { weight_percent: 10, pms_exposure: LAZARD },
      { weight_percent: 90, pms_exposure: { equity: 0.5, fixed_income: 0.5, cash: 0, alternative: 0, real_asset: 0, other: 0 } }
    ])!;
    /* 10 × (−0,000844) + 90 × 0,5 = 44,99156. */
    expect(percent.fixed_income).toBeCloseTo(44.99156, 6);
  });
});

describe("filasDeExposicion", () => {
  const exposicion = (parte: Partial<BdbPmsExposure>): BdbPmsExposure => ({ equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, ...parte });

  test("un −0,08 % se pinta, con su signo y en su orden", () => {
    const filas = filasDeExposicion(exposicion({ equity: 100.0401, fixed_income: -0.0844, cash: 0.0432, other: 0.0011 }));
    expect(filas.map((fila) => [fila.rotulo, fila.peso])).toEqual([
      ["Renta variable", 100.0401],
      ["Renta fija", -0.0844]
    ]);
  });

  test("lo que al decimal es cero no se pinta, sea del signo que sea", () => {
    expect(filasDeExposicion(exposicion({ equity: 100.04, fixed_income: -0.04, cash: 0.04 })).map((fila) => fila.clave)).toEqual(["equity"]);
  });
});

describe("quien lee el reparto como un peso que no puede ser negativo", () => {
  const activo = (asset_id: string, pms_exposure: BdbPmsExposure, resto: Partial<BdbAssetDetail> = {}) =>
    ({ asset_id, display_name: asset_id, instrument_type: "FUND", economic_asset_class: "EQUITY", pms_exposure, ...resto }) as unknown as BdbAssetDetail;
  const NEGATIVO_EN_BOLSA: BdbPmsExposure = { equity: -0.009946, fixed_income: 0.689525, cash: 0.26446, alternative: 0, real_asset: 0, other: 0.055961 };
  const CELDAS = { large_value: 0, large_blend: 0, large_growth: 0, mid_value: 0.083836, mid_blend: 0.118581, mid_growth: 0, small_value: 0.291113, small_blend: 0.443874, small_growth: 0.062596 };

  test("la caja: un fondo con bolsa al −0,99 % no entra, y Lazard cuenta entero con sus celdas", () => {
    const assets = [
      activo("LAZARD", LAZARD, { exposure_detail: { equity_style_box: CELDAS } as never }),
      activo("DUNAS", NEGATIVO_EN_BOLSA)
    ];
    const caja = cajaDeEstilo(
      [
        { asset_id: "LAZARD", weight_percent: 50 },
        { asset_id: "DUNAS", weight_percent: 50 }
      ],
      assets
    )!;
    expect(caja.conCeldas).toBeCloseTo(100, VENTANA);
    expect(caja.noDeclarada).toBe(0);
    expect(caja.celdas.small_blend).toBeCloseTo(44.3874, 6);
  });

  test("las regiones: un peso negativo en bolsa no resta del total", () => {
    const salida = computeEquityRegionAllocation(
      [
        { asset_id: "LAZARD", weight_percent: 50 },
        { asset_id: "DUNAS", weight_percent: 50 }
      ],
      [
        activo("LAZARD", LAZARD, { exposure_detail: { equity_regions: { eurozone: 1 } } as never }),
        activo("DUNAS", NEGATIVO_EN_BOLSA, { exposure_detail: { equity_regions: { united_states: 1 } } as never })
      ]
    );
    expect(salida.rows.map((fila) => fila.key)).toEqual(["eurozone"]);
    expect(salida.rows[0]?.weight_percent).toBeCloseTo(100, 6);
    expect(salida.unclassified_weight_percent).toBe(0);
  });

  test("el perfil de renta fija: un fondo con renta fija al −0,08 % no pesa en la media", () => {
    const perfil = perfilDeRentaFija(
      [
        { asset_id: "LAZARD", weight_percent: 50 },
        { asset_id: "BONOS", weight_percent: 50 }
      ],
      [
        activo("LAZARD", LAZARD, { fixed_income_profile: { modified_duration: 40 } as never }),
        activo("BONOS", { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0 }, { fixed_income_profile: { modified_duration: 5 } as never })
      ]
    )!;
    expect(perfil.duracionModificada.valor).toBe(5);
    expect(perfil.duracionModificada.cobertura).toBe(100);
    expect(perfil.pesoEnLaCartera).toBe(50);
  });
});
