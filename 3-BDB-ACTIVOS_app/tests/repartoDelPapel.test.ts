/**
 * Decisión 85: un reparto del papel se da en % de toda la cartera y suma 100, y lo que no entra va en su propia fila, con su nombre.
 * Las cifras se han calculado a mano, con las exposiciones escritas aquí: nada sale de lo que da el código.
 */
import { describe, expect, test } from "vitest";
import { buildReportFromAssets } from "../src/core/portfolio";
import { CATEGORIA_DE_LAS_ACCIONES, categoriaDeUnReparto, conLaFilaDeFuera, fraseDeLoQueNoEntra, FUERA_DEL_REPARTO, fueraDelRepartoDelInforme } from "../src/core/repartoDelPapel";
import { filasDeExposicion } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

function activo(asset_id: string, display_name: string, pms: Partial<BdbAssetDetail["pms_exposure"]>, extra: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id, isin: asset_id, display_name, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE",
    quality_flags: [], warnings: [], description: "", metrics: {}, pms_exposure: { equity: 0, fixed_income: 0, cash: 0, alternative: 0, other: 0, ...pms }, ...extra
  } as BdbAssetDetail;
}

/* La cartera de la decisión. iShares: 99,4 % en bolsa y 0,6 % en liquidez. JPMorgan: 96,5 % en bonos y 3,5 % en liquidez. */
const ISHARES = activo("ISH", "iShares", { equity: 0.994, cash: 0.006 });
const JPM = activo("JPM", "JPMorgan", { fixed_income: 0.965, cash: 0.035 }, { economic_asset_class: "FIXED_INCOME" });
const CAM = activo("CAM", "CAM, CUOTAS PARTICIPATIVAS", { equity: 1 }, { is_investable: false, instrument_type: "STOCK", quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED"] });
const DEOLEO = activo("DEO", "Deoleo S.A", { equity: 1 }, { instrument_type: "STOCK", is_investable: false, quality_flags: ["QUALITY_BLOCKED"] });

const informe = (positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[]) =>
  buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: positions, assets });

describe("lo que no entra en el reparto", () => {
  test("una cartera en la que entra todo no cambia ni una cifra", () => {
    const report = informe([{ asset_id: "ISH", weight_percent: 60 }, { asset_id: "JPM", weight_percent: 40 }], [ISHARES, JPM]);
    const fuera = fueraDelRepartoDelInforme(report);
    expect(fuera).toEqual({ parteInvertible: 1, posiciones: [], peso: 0, pesoPct: 0 });
    expect(conLaFilaDeFuera(report.summary.by_economic_asset_class, fuera)).toEqual(report.summary.by_economic_asset_class);
    expect(fraseDeLoQueNoEntra(fuera)).toBeNull();
  });

  test("CAM 10, iShares 50 y JPMorgan 40: 49,7, 38,6, 1,6 y 10,0 fuera, como la pantalla", () => {
    const report = informe([{ asset_id: "CAM", weight_percent: 10 }, { asset_id: "ISH", weight_percent: 50 }, { asset_id: "JPM", weight_percent: 40 }], [CAM, ISHARES, JPM]);
    const fuera = fueraDelRepartoDelInforme(report);
    expect(fuera.parteInvertible).toBeCloseTo(0.9, 10);
    expect(fuera.pesoPct).toBeCloseTo(10, 10);
    expect(fuera.posiciones).toEqual([{ assetId: "CAM", nombre: "CAM, CUOTAS PARTICIPATIVAS", pesoPct: 10 }]);
    /* A mano: 0,5 × 99,4 = 49,7; 0,4 × 96,5 = 38,6; 0,5 × 0,6 + 0,4 × 3,5 = 1,7 → sobre el 90 % que entra, y de vuelta a toda la cartera. */
    const filas = Object.fromEntries(filasDeExposicion(report.xray.pms_exposure_percent, fuera.parteInvertible).map((f) => [f.clave, f.peso]));
    expect(filas.equity).toBeCloseTo(49.7, 1);
    expect(filas.fixed_income).toBeCloseTo(38.6, 1);
    expect(filas.cash).toBeCloseTo(1.7, 1);
    expect((filas.equity ?? 0) + (filas.fixed_income ?? 0) + (filas.cash ?? 0) + fuera.pesoPct).toBeCloseTo(100, 1);
  });

  test("la fila se llama «Fuera del reparto», va la última y suma lo que falta para llegar a la cartera", () => {
    const report = informe([{ asset_id: "CAM", weight_percent: 10 }, { asset_id: "ISH", weight_percent: 50 }, { asset_id: "JPM", weight_percent: 40 }], [CAM, ISHARES, JPM]);
    const filas = conLaFilaDeFuera(report.summary.by_economic_asset_class, fueraDelRepartoDelInforme(report));
    expect(filas.at(-1)).toEqual({ key: FUERA_DEL_REPARTO, weight_percent: 10 });
    expect(filas.reduce((suma, fila) => suma + fila.weight_percent, 0)).toBeCloseTo(100, 10);
    expect(FUERA_DEL_REPARTO).not.toMatch(/invertible/i);
  });

  test("lo que cotiza y tiene la serie bloqueada también se queda fuera, y no se llama «No invertible»", () => {
    const report = informe([{ asset_id: "DEO", weight_percent: 10 }, { asset_id: "ISH", weight_percent: 90 }], [DEOLEO, ISHARES]);
    const fuera = fueraDelRepartoDelInforme(report);
    expect(fuera.pesoPct).toBeCloseTo(10, 10);
    expect(fraseDeLoQueNoEntra(fuera)).toBe("Fuera del reparto: Deoleo S.A, 10,0\u00a0% de la cartera.");
  });

  test("una posición fuera del catálogo: el resumen la nombra, y sin nombre va su identificador", () => {
    const report = informe([{ asset_id: "XS0000000000", weight_percent: 10 }, { asset_id: "ISH", weight_percent: 50 }, { asset_id: "JPM", weight_percent: 40, label: "No se usa" }], [ISHARES, JPM]);
    expect(report.summary.not_found_positions).toEqual([{ asset_id: "XS0000000000", weight_percent: 10 }]);
    expect(report.positions.map((p) => p.asset_id)).toEqual(["ISH", "JPM"]);
    expect(fraseDeLoQueNoEntra(fueraDelRepartoDelInforme(report))).toBe("Fuera del reparto: XS0000000000, 10,0\u00a0% de la cartera.");
    const conNombre = informe([{ asset_id: "XS0000000000", weight_percent: 10, label: "Bono viejo" }, { asset_id: "ISH", weight_percent: 90 }], [ISHARES]);
    expect(conNombre.summary.not_found_positions).toEqual([{ asset_id: "XS0000000000", label: "Bono viejo", weight_percent: 10 }]);
    expect(fraseDeLoQueNoEntra(fueraDelRepartoDelInforme(conNombre))).toBe("Fuera del reparto: Bono viejo, 10,0\u00a0% de la cartera.");
  });

  test("sin ninguna fuera del catálogo el resumen no lleva el campo", () => {
    expect(informe([{ asset_id: "ISH", weight_percent: 100 }], [ISHARES]).summary).not.toHaveProperty("not_found_positions");
  });

  test("con pesos que no suman 100, el reparto sigue siendo de lo que suman las posiciones", () => {
    const report = informe([{ asset_id: "CAM", weight_percent: 10 }, { asset_id: "ISH", weight_percent: 40 }], [CAM, ISHARES]);
    const fuera = fueraDelRepartoDelInforme(report);
    /* 10 de los 50 que suman. */
    expect(fuera.pesoPct).toBeCloseTo(20, 10);
    expect(fuera.parteInvertible).toBeCloseTo(0.8, 10);
    expect(fuera.peso).toBeCloseTo(10, 10);
  });

  test("la frase: dos o tres nombres con su peso, y con más los cuenta y dice dónde están", () => {
    const pos = (nombre: string, pesoPct: number) => ({ assetId: nombre, nombre, pesoPct });
    const base = { parteInvertible: 0.8, peso: 20, pesoPct: 20 };
    expect(fraseDeLoQueNoEntra({ ...base, posiciones: [pos("A", 15), pos("B", 5)] })).toBe("Fuera del reparto: A (15,0\u00a0%) y B (5,0\u00a0%), 20,0\u00a0% de la cartera.");
    expect(fraseDeLoQueNoEntra({ ...base, posiciones: [pos("A", 8), pos("B", 7), pos("C", 5)] })).toBe("Fuera del reparto: A (8,0\u00a0%), B (7,0\u00a0%) y C (5,0\u00a0%), 20,0\u00a0% de la cartera.");
    expect(fraseDeLoQueNoEntra({ ...base, posiciones: [pos("A", 5), pos("B", 5), pos("C", 5), pos("D", 5)] })).toBe("Fuera del reparto: 4 posiciones, 20,0\u00a0% de la cartera, detalladas en el anexo.");
    expect(fraseDeLoQueNoEntra({ ...base, posiciones: [pos("A", 5), pos("B", 5), pos("C", 5), pos("D", 5)] }, "detalladas en la sección 10")).toContain("detalladas en la sección 10");
    expect(fraseDeLoQueNoEntra({ ...base, posiciones: [] })).toBe("Fuera del reparto: 20,0\u00a0% de la cartera.");
  });
});

describe("la categoría de un reparto (decisión 83)", () => {
  test.each(["accion", "Accion", "Acción", " ACCIÓN "])("«%s» es la fila de las acciones", (categoria) => {
    expect(categoriaDeUnReparto(categoria)).toBe(CATEGORIA_DE_LAS_ACCIONES);
  });
  test("lo demás, tal cual", () => {
    expect(categoriaDeUnReparto("EAA Fund Global Large-Cap Blend Equity")).toBe("EAA Fund Global Large-Cap Blend Equity");
    expect(categoriaDeUnReparto("Acciones")).toBe("Acciones");
  });
});
