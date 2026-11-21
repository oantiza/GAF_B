/**
 * El efecto de los costes con el tiempo (Óscar, 11-11-2026): cuánto menos tendría el cliente al cabo de 5 y 10 años por lo que
 * cuesta su cartera. Cada cifra se rehace con la fórmula escrita y se compara con una fija calculada aparte.
 */
import { describe, expect, test } from "vitest";
import { efectoDeLosCostes, RENTABILIDAD_SUPUESTA_POR_DEFECTO, rentabilidadSupuesta, valorFinal } from "../src/core/efectoDeLosCostes";
import { calculatePortfolioCosts, calculatePortfolioManagementFee } from "../src/core/portfolioCosts";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const fondo = (asset_id: string, ongoing_charge?: number): BdbAssetDetail => ({
  asset_id, isin: asset_id, display_name: asset_id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
  coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "", metrics: {},
  pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
  costs: ongoing_charge === undefined ? undefined : { ongoing_charge }
}) as unknown as BdbAssetDetail;
const accion = (asset_id: string): BdbAssetDetail => ({ ...fondo(asset_id), instrument_type: "STOCK", costs: undefined }) as BdbAssetDetail;

function costes(filas: Array<[BdbAssetDetail, number]>, capital = 100_000) {
  return calculatePortfolioCosts(filas.map(([a, w]) => ({ asset_id: a.asset_id, weight_percent: w })), filas.map(([a]) => a), capital);
}
const sinGestion = { enabled: false, fee: null };

describe("la fórmula", () => {
  test("sin costes K × (1 + r)^T; con costes K × ((1 + r) × (1 − c))^T", () => {
    expect(valorFinal(100_000, 0.05, 0, 10)).toBeCloseTo(100_000 * 1.05 ** 10, 8);
    expect(valorFinal(100_000, 0.05, 0.01, 10)).toBeCloseTo(100_000 * (1.05 * 0.99) ** 10, 8);
    expect(valorFinal(100_000, 0.05, 0.01, 0)).toBe(100_000);
  });

  test("la rentabilidad supuesta por defecto es el 5 %, y el campo admite del 0 % al 15 %", () => {
    expect(RENTABILIDAD_SUPUESTA_POR_DEFECTO).toBe(0.05);
    expect(rentabilidadSupuesta("5")).toBe(0.05);
    expect(rentabilidadSupuesta("3,5")).toBeCloseTo(0.035, 12);
    expect(rentabilidadSupuesta("0")).toBe(0);
    expect(rentabilidadSupuesta("15")).toBeCloseTo(0.15, 12);
    for (const malo of ["", " ", "abc", "-1", "15.01", "40"]) expect(rentabilidadSupuesta(malo)).toBeNull();
  });
});

describe("con resultados conocidos", () => {
  test("costes cero: las dos cifras coinciden y la diferencia es cero", () => {
    const efecto = efectoDeLosCostes({ costs: costes([[fondo("A", 0), 100]]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 });
    expect(efecto.estado).toBe("calculado");
    if (efecto.estado !== "calculado") return;
    for (const fila of efecto.filas) {
      expect(fila.conCostes).toBe(fila.sinCostes);
      expect(fila.diferencia).toBe(0);
      expect(fila.diferenciaPct).toBe(0);
    }
  });

  test("1 % al 5 % sobre 100.000 €: a 5 años 127.628,16 contra 121.373,11; a 10, 162.889,46 contra 147.314,31", () => {
    const efecto = efectoDeLosCostes({ costs: costes([[fondo("A", 0.01), 60], [fondo("B", 0.01), 40]]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 });
    expect(efecto.estado).toBe("calculado");
    if (efecto.estado !== "calculado") return;
    expect(efecto.coste).toBeCloseTo(0.01, 12);
    const [cinco, diez] = efecto.filas;
    expect(cinco.anos).toBe(5);
    expect(diez.anos).toBe(10);
    /* La fórmula escrita, aquí mismo. */
    expect(diez.sinCostes).toBeCloseTo(100_000 * 1.05 ** 10, 6);
    expect(diez.conCostes).toBeCloseTo(100_000 * (1.05 * 0.99) ** 10, 6);
    /* Y las cifras fijas, calculadas aparte. */
    expect(cinco.sinCostes).toBeCloseTo(127_628.1563, 3);
    expect(cinco.conCostes).toBeCloseTo(121_373.1067, 3);
    expect(cinco.diferencia).toBeCloseTo(6_255.0496, 3);
    expect(cinco.diferenciaPct).toBeCloseTo(0.04901, 5);
    expect(diez.sinCostes).toBeCloseTo(162_889.4627, 3);
    expect(diez.conCostes).toBeCloseTo(147_314.3103, 3);
    expect(diez.diferencia).toBeCloseTo(15_575.1524, 3);
    expect(diez.diferenciaPct).toBeCloseTo(0.095618, 6);
    /* El porcentaje es 1 − (1 − c)^T: no depende del capital ni de la rentabilidad. */
    expect(diez.diferenciaPct).toBeCloseTo(1 - 0.99 ** 10, 12);
  });

  test("con la comisión de gestión de la cartera: 1 % de los productos más 0,5 % de gestión", () => {
    const c = costes([[fondo("A", 0.01), 100]]);
    const efecto = efectoDeLosCostes({ costs: c, capital: 100_000, gestion: { enabled: true, fee: calculatePortfolioManagementFee(c, 0.5, "percent") }, rentabilidad: 0.05 });
    expect(efecto.estado).toBe("calculado");
    if (efecto.estado !== "calculado") return;
    expect(efecto.soloGestion).toBe(false);
    expect(efecto.costeDeLosProductos).toBeCloseTo(0.01, 12);
    expect(efecto.gestion).toBeCloseTo(0.005, 12);
    expect(efecto.coste).toBeCloseTo(0.015, 12);
    expect(efecto.filas[1].conCostes).toBeCloseTo(100_000 * (1.05 * 0.985) ** 10, 6);
    expect(efecto.filas[1].conCostes).toBeCloseTo(140_041.0298, 3);
    expect(efecto.filas[1].diferencia).toBeCloseTo(22_848.4329, 3);
    expect(efecto.filas[0].diferencia).toBeCloseTo(9_289.2236, 3);
    /* En euros sobre el capital declarado es la misma tasa: 500 € sobre 100.000 €. */
    const enEuros = efectoDeLosCostes({ costs: c, capital: 100_000, gestion: { enabled: true, fee: calculatePortfolioManagementFee(c, 500, "euros") }, rentabilidad: 0.05 });
    expect(enEuros.estado === "calculado" ? enEuros.coste : null).toBeCloseTo(0.015, 12);
  });

  test("la comisión activada pero sin importe válido: no se calcula, y se dice por qué", () => {
    const c = costes([[fondo("A", 0.01), 100]]);
    expect(efectoDeLosCostes({ costs: c, capital: 100_000, gestion: { enabled: true, fee: calculatePortfolioManagementFee(c, null, "percent") }, rentabilidad: 0.05 }))
      .toEqual({ estado: "falta", motivo: "La comisión de gestión de la cartera está activada pero su importe no es válido o está pendiente." });
  });

  test("el capital cambia los euros, no el porcentaje", () => {
    const c = costes([[fondo("A", 0.01), 100]]);
    const diez = efectoDeLosCostes({ costs: c, capital: 10_000, gestion: sinGestion, rentabilidad: 0.05 });
    const cien = efectoDeLosCostes({ costs: c, capital: 100_000, gestion: sinGestion, rentabilidad: 0.07 });
    if (diez.estado !== "calculado" || cien.estado !== "calculado") throw new Error("debía calcularse");
    expect(diez.filas[1].diferencia).toBeCloseTo(1_557.51524, 4);
    expect(diez.filas[1].diferenciaPct).toBeCloseTo(cien.filas[1].diferenciaPct, 12);
  });
});

describe("cuando no se calcula", () => {
  test("un fondo sin coste: no se calcula, y se dice cuántos faltan", () => {
    const efecto = efectoDeLosCostes({ costs: costes([[fondo("A", 0.01), 50], [fondo("B"), 30], [accion("ES1"), 20]]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 });
    expect(efecto).toEqual({
      estado: "falta",
      motivo: "Falta el coste corriente de 1 de las 3 posiciones, y sin él no se calcula: contarlo como cero diría que la cartera cuesta menos."
    });
  });

  test("solo acciones sin comisión de gestión: no aplica", () => {
    const efecto = efectoDeLosCostes({ costs: costes([[accion("ES1"), 50], [accion("ES2"), 50]]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 });
    expect(efecto).toEqual({ estado: "no-aplica", motivo: "Una acción no tiene coste corriente: no hay coste que proyectar." });
  });

  test("solo acciones con 0,5 % de gestión (Dirección, 11-11-2026): c es solo la gestión, al 5 % sobre 100.000 €", () => {
    const c = costes([[accion("ES1"), 50], [accion("ES2"), 50]]);
    const efecto = efectoDeLosCostes({ costs: c, capital: 100_000, gestion: { enabled: true, fee: calculatePortfolioManagementFee(c, 0.5, "percent") }, rentabilidad: 0.05 });
    expect(efecto.estado).toBe("calculado");
    if (efecto.estado !== "calculado") return;
    expect(efecto.soloGestion).toBe(true);
    expect(efecto.costeDeLosProductos).toBe(0);
    expect(efecto.coste).toBeCloseTo(0.005, 12);
    const [cinco, diez] = efecto.filas;
    expect(diez.sinCostes).toBeCloseTo(100_000 * 1.05 ** 10, 6);
    expect(diez.conCostes).toBeCloseTo(100_000 * (1.05 * (1 - 0.005)) ** 10, 6);
    expect(diez.conCostes).toBeCloseTo(154_925.8181, 3);
    expect(diez.diferencia).toBeCloseTo(7_963.6446, 3);
    expect(diez.diferenciaPct).toBeCloseTo(1 - 0.995 ** 10, 12);
    expect(cinco.conCostes).toBeCloseTo(124_469.2002, 3);
    expect(cinco.diferencia).toBeCloseTo(3_158.956, 3);
    /* Activada pero sin importe válido, no se calcula. */
    expect(efectoDeLosCostes({ costs: c, capital: 100_000, gestion: { enabled: true, fee: calculatePortfolioManagementFee(c, null, "percent") }, rentabilidad: 0.05 }).estado).toBe("falta");
  });

  test("con acciones y fondos, la acción cuenta a cero, como en la media", () => {
    const efecto = efectoDeLosCostes({ costs: costes([[fondo("A", 0.02), 50], [accion("ES1"), 50]]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 });
    expect(efecto.estado === "calculado" ? efecto.coste : null).toBeCloseTo(0.01, 12);
  });

  test("sin rentabilidad válida, o sin posiciones, tampoco", () => {
    const c = costes([[fondo("A", 0.01), 100]]);
    expect(efectoDeLosCostes({ costs: c, capital: 100_000, gestion: sinGestion, rentabilidad: null }))
      .toEqual({ estado: "falta", motivo: "Indica una rentabilidad supuesta entre el 0 % y el 15 % anual." });
    expect(efectoDeLosCostes({ costs: costes([]), capital: 100_000, gestion: sinGestion, rentabilidad: 0.05 }).estado).toBe("falta");
  });
});
