import { describe, expect, test } from "vitest";
import { perfilDeRentaFija } from "../src/core/perfilDeRentaFija";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const activo = (asset_id: string, extra: Partial<BdbAssetDetail>): BdbAssetDetail =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    economic_asset_class: "FIXED_INCOME",
    pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    ...extra
  }) as unknown as BdbAssetDetail;

describe("lo que la base publica de la renta fija, agregado a la cartera (decisión 11)", () => {
  test("media ponderada por el peso en renta fija, cada cifra con su cobertura", () => {
    /* A mano: pesos en RF 30, 20 y 10 (el mixto, 20 × 0,5), sobre 60.
       Grado de inversión: (30 × 0,90 + 20 × 0,50) / 50 = 0,74, declarado por 50 / 60.
       Duración efectiva: (30 × 6 + 10 × 2) / 40 = 5, declarada por 40 / 60. */
    const perfil = perfilDeRentaFija(
      [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 20 },
        { asset_id: "MIX", weight_percent: 20 },
        { asset_id: "RV", weight_percent: 30 }
      ],
      [
        activo("A", { fixed_income_profile: { investment_grade_pct: 0.9, high_yield_pct: 0.1, effective_duration: 6 } }),
        activo("B", { fixed_income_profile: { investment_grade_pct: 0.5, high_yield_pct: 0.5 } }),
        activo("MIX", { pms_exposure: { equity: 0.5, fixed_income: 0.5, cash: 0, alternative: 0, real_asset: 0, other: 0 }, fixed_income_profile: { effective_duration: 2 } } as Partial<BdbAssetDetail>),
        activo("RV", { economic_asset_class: "EQUITY", pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 } } as Partial<BdbAssetDetail>)
      ]
    );
    expect(perfil?.pesoEnLaCartera).toBeCloseTo(60, 6);
    expect(perfil?.gradoDeInversion.valor).toBeCloseTo(0.74, 10);
    expect(perfil?.gradoDeInversion.cobertura).toBeCloseTo((50 / 60) * 100, 6);
    expect(perfil?.altoRendimiento.valor).toBeCloseTo(0.26, 10);
    expect(perfil?.duracionEfectiva.valor).toBeCloseTo(5, 10);
    expect(perfil?.duracionEfectiva.cobertura).toBeCloseTo((40 / 60) * 100, 6);
  });

  test("la duración modificada y la efectiva no se mezclan", () => {
    const perfil = perfilDeRentaFija(
      [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }],
      [activo("A", { fixed_income_profile: { modified_duration: 3 } }), activo("B", { fixed_income_profile: { effective_duration: 7 } })]
    );
    expect(perfil?.duracionModificada).toEqual({ valor: 3, cobertura: 50 });
    expect(perfil?.duracionEfectiva).toEqual({ valor: 7, cobertura: 50 });
  });

  test("lo que nadie declara no es cero: no hay cifra", () => {
    const perfil = perfilDeRentaFija([{ asset_id: "A", weight_percent: 100 }], [activo("A", {})]);
    expect(perfil?.gradoDeInversion).toEqual({ valor: null, cobertura: 0 });
    expect(perfil?.duracionModificada).toEqual({ valor: null, cobertura: 0 });
  });

  test("un cero declarado es una cifra", () => {
    const perfil = perfilDeRentaFija([{ asset_id: "A", weight_percent: 100 }], [activo("A", { fixed_income_profile: { high_yield_pct: 0 } })]);
    expect(perfil?.altoRendimiento).toEqual({ valor: 0, cobertura: 100 });
  });

  test("sin renta fija no falta nada: no aplica", () => {
    expect(perfilDeRentaFija([{ asset_id: "RV", weight_percent: 100 }], [activo("RV", { economic_asset_class: "EQUITY", pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 } } as Partial<BdbAssetDetail>)])).toBeNull();
    expect(perfilDeRentaFija([], [])).toBeNull();
  });

  test("un monetario es liquidez: no cuenta como renta fija", () => {
    const perfil = perfilDeRentaFija(
      [{ asset_id: "A", weight_percent: 50 }, { asset_id: "MM", weight_percent: 50 }],
      [activo("A", { fixed_income_profile: { investment_grade_pct: 1 } }), activo("MM", { economic_asset_class: "MONEY_MARKET", pms_exposure: undefined })]
    );
    expect(perfil?.pesoEnLaCartera).toBeCloseTo(50, 6);
    expect(perfil?.gradoDeInversion.cobertura).toBeCloseTo(100, 6);
  });

  test("un fondo sin vector cuenta por su clase, y una posición fuera del catálogo no aporta", () => {
    const perfil = perfilDeRentaFija(
      [{ asset_id: "A", weight_percent: 40 }, { asset_id: "NO_ESTA", weight_percent: 60 }],
      [activo("A", { pms_exposure: undefined, fixed_income_profile: { investment_grade_pct: 0.8 } })]
    );
    expect(perfil?.pesoEnLaCartera).toBeCloseTo(40, 6);
    expect(perfil?.gradoDeInversion).toEqual({ valor: 0.8, cobertura: 100 });
  });

  test("un peso cero no aporta, y los pesos que no suman 100 no mueven la media", () => {
    const perfil = perfilDeRentaFija(
      [{ asset_id: "A", weight_percent: 0 }, { asset_id: "B", weight_percent: 10 }, { asset_id: "C", weight_percent: 30 }],
      [activo("A", { fixed_income_profile: { investment_grade_pct: 0 } }), activo("B", { fixed_income_profile: { investment_grade_pct: 1 } }), activo("C", { fixed_income_profile: { investment_grade_pct: 0.6 } })]
    );
    expect(perfil?.pesoEnLaCartera).toBeCloseTo(100, 6);
    expect(perfil?.gradoDeInversion.valor).toBeCloseTo(0.7, 10);
  });
});
