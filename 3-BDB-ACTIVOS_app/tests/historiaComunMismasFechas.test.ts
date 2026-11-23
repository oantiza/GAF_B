/**
 * La frase de la tarjeta «Historia común» cuando cae en las mismas fechas que una crisis (Óscar, 20-11-2026). La fecha sale del dato: el primer día de
 * la historia común. Escenarios escritos a mano.
 */
import { describe, expect, test } from "vitest";
import type { BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";
import { mismasFechasQueUnaCrisis } from "../src/core/crisisPasadas";

const base = (cambios: Partial<BacktestStressScenario>): BacktestStressScenario => ({
  id: "COVID", label: "COVID-19", configured_start_date: "2020-02-19", configured_end_date: "2020-03-23",
  start_date: "2020-02-19", end_date: "2020-03-23", peak_date: null, trough_date: "2020-03-23", common_data_end_date: "2026-11-06",
  drawdown_pct: -22.2, duration_days: 33, recovery_date: "2020-11-27", recovery_days: 249, remaining_to_recover_pct: 0,
  recovery_status: "RECOVERED", worst_asset: null, coverage: { weight_pct: 100, included_assets: 2, total_assets: 2 },
  representative: true, included_assets: ["A", "B"], excluded_assets: [], reason: null,
  ...cambios
});
const covid = base({});
const comun = base({ id: "COMMON_HISTORY", label: "Historia común", configured_start_date: "2016-11-07", start_date: "2016-11-07", peak_date: "2020-02-19", drawdown_pct: -23.3 });
const cifra = (e: BacktestStressScenario) => (e.drawdown_pct === null ? null : `${e.drawdown_pct.toFixed(2)} %`);

describe("las mismas fechas que una crisis, con otra cifra", () => {
  test("mismo máximo y mismo mínimo que la COVID, mismas posiciones y otra cifra: se dice, con la fecha de inicio de la historia común", () => {
    expect(mismasFechasQueUnaCrisis([covid, comun], cifra)).toBe(
      "Las mismas fechas que COVID-19, con otra cifra: allí la cartera parte ese día con los pesos de hoy; aquí los lleva puestos desde el 07/11/2016, sin reequilibrar."
    );
  });
  test("con otro máximo, no", () => {
    expect(mismasFechasQueUnaCrisis([covid, { ...comun, peak_date: "2020-01-17" }], cifra)).toBeNull();
  });
  test("con otro mínimo, no", () => {
    expect(mismasFechasQueUnaCrisis([covid, { ...comun, trough_date: "2020-03-18" }], cifra)).toBeNull();
  });
  test("si entran otras posiciones, la diferencia no es solo de los pesos: no", () => {
    expect(mismasFechasQueUnaCrisis([{ ...covid, included_assets: ["A"] }, comun], cifra)).toBeNull();
  });
  test("si la cifra se escribe igual, no hay nada que explicar", () => {
    expect(mismasFechasQueUnaCrisis([covid, { ...comun, drawdown_pct: -22.2 }], cifra)).toBeNull();
  });
  test("si una de las dos mide menos del 60 % y no da cifra, no", () => {
    expect(mismasFechasQueUnaCrisis([{ ...covid, representative: false }, comun], cifra)).toBeNull();
    expect(mismasFechasQueUnaCrisis([covid, { ...comun, representative: false }], cifra)).toBeNull();
  });
  test("con unas Functions que no mandan el máximo, no", () => {
    expect(mismasFechasQueUnaCrisis([covid, { ...comun, peak_date: undefined }], cifra)).toBeNull();
  });
});
