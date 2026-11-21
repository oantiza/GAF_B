import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPortfolioOptimizationDiff, dineroQueSeMueve, importeAMover, totalesDeCambios } from "../src/core/portfolioOptimizationDiff";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { CambiosAplicados } from "../src/components/CambiosAplicados";

function asset(id: string, ter: number): BdbAssetDetail {
  return {
    asset_id: id, display_name: `Activo ${id}`, instrument_type: "FUND", economic_asset_class: "EQUITY",
    currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [],
    metrics: { volatility_3y: 0.1 }, description: "", costs: { ongoing_charge: ter },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

describe("cuánto dinero se mueve", () => {
  const fila = (asset_id: string, before_weight_pct: number, after_weight_pct: number) => {
    const delta_weight_pct = after_weight_pct - before_weight_pct;
    return {
      asset_id,
      label: asset_id,
      before_weight_pct,
      after_weight_pct,
      delta_weight_pct,
      change: (delta_weight_pct > 0.005 ? "INCREASED" : delta_weight_pct < -0.005 ? "DECREASED" : "UNCHANGED") as "INCREASED" | "DECREASED" | "UNCHANGED"
    };
  };

  test("con 200.000 €, pasar del 60 al 45 % son 30.000 € que se venden", () => {
    expect(importeAMover(fila("A", 60, 45), 200000)).toBe(-30000);
    expect(importeAMover(fila("B", 40, 55), 200000)).toBe(30000);
  });

  test("una fila sin cambio no mueve nada, aunque le quede un resto", () => {
    expect(importeAMover(fila("A", 25, 25.004), 1_000_000)).toBe(0);
  });

  test("el total cuadra con las filas: lo vendido y lo comprado, y lo que se mueve es uno de los dos", () => {
    const filas = [fila("A", 60, 45), fila("B", 40, 30), fila("C", 0, 25)];
    expect(dineroQueSeMueve(filas, 200000)).toEqual({ compras: 50000, ventas: 50000, movido: 50000 });
  });

  test("si la propuesta suma distinto, se mueve lo mayor, y no se finge que cuadra", () => {
    expect(dineroQueSeMueve([fila("A", 50, 40), fila("B", 45, 60)], 100000)).toEqual({ compras: 15000, ventas: 10000, movido: 15000 });
  });

  test("la fila Total suma las columnas de peso", () => {
    expect(totalesDeCambios([fila("A", 60, 45), fila("B", 40, 55)])).toEqual({ before_weight_pct: 100, after_weight_pct: 100, delta_weight_pct: 0 });
  });
});

describe("buildPortfolioOptimizationDiff", () => {
  test("clasifica nuevos, retirados y cambios de peso", () => {
    const result = buildPortfolioOptimizationDiff({
      source: "MAX_SHARPE",
      before: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      after: [{ asset_id: "A", weight_percent: 45 }, { asset_id: "B", weight_percent: 0 }, { asset_id: "C", weight_percent: 55 }],
      assets: [asset("A", 0.01), asset("B", 0.02), asset("C", 0.005)]
    });
    expect(Object.fromEntries(result.rows.map((row) => [row.asset_id, row.change]))).toEqual({ C: "NEW", B: "REMOVED", A: "DECREASED" });
    expect(result.rows.find((row) => row.asset_id === "C")?.delta_weight_pct).toBe(55);
  });

  test("calcula Δ TER y retro ponderados sobre datos cubiertos", () => {
    const result = buildPortfolioOptimizationDiff({
      source: "AUTO_COMPLETE",
      before: [{ asset_id: "A", weight_percent: 100 }],
      after: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }],
      assets: [asset("A", 0.02), asset("B", 0.01)],
      retroPctByAssetId: new Map([["A", 0.6], ["B", 0.2]])
    });
    expect(result.before_weighted_ter_rate).toBeCloseTo(0.02);
    expect(result.after_weighted_ter_rate).toBeCloseTo(0.015);
    expect(result.delta_weighted_ter_rate).toBeCloseTo(-0.005);
    expect(result.delta_weighted_retro_pct).toBeCloseTo(-0.2);
  });

  test("pasar un 30 % de un fondo a una acción baja el coste: la acción cuenta a cero, un fondo sin coste no", () => {
    const stock = { ...asset("S", 0), instrument_type: "STOCK" as const, costs: undefined };
    /* A mano: antes, 100 % al 1 %; después, 70 % al 1 % + 30 % a cero = 0,70 %. */
    const result = buildPortfolioOptimizationDiff({
      source: "MANUAL",
      before: [{ asset_id: "A", weight_percent: 100 }],
      after: [{ asset_id: "A", weight_percent: 70 }, { asset_id: "S", weight_percent: 30 }],
      assets: [asset("A", 0.01), stock]
    });
    expect(result.before_weighted_ter_rate).toBeCloseTo(0.01, 12);
    expect(result.after_weighted_ter_rate).toBeCloseTo(0.007, 12);
    expect(result.delta_weighted_ter_rate).toBeCloseTo(-0.003, 6);
    const sinCoste = { ...asset("B", 0), costs: undefined };
    const conFondoSinDato = buildPortfolioOptimizationDiff({
      source: "MANUAL",
      before: [{ asset_id: "A", weight_percent: 100 }],
      after: [{ asset_id: "A", weight_percent: 70 }, { asset_id: "B", weight_percent: 30 }],
      assets: [asset("A", 0.01), sinCoste]
    });
    /* Sobre el peso con dato: no se inventa un cero. */
    expect(conFondoSinDato.after_weighted_ter_rate).toBeCloseTo(0.01, 12);
  });

  test("calcula Δ retorno, volatilidad y Sharpe; mantiene N/D si falta un extremo", () => {
    const result = buildPortfolioOptimizationDiff({
      source: "OPTIMIZER",
      before: [], after: [], assets: [],
      beforeMetrics: { expected_return: 0.06, volatility: 0.12, sharpe: 0.5 },
      afterMetrics: { expected_return: 0.08, volatility: 0.1, sharpe: 0.8 }
    });
    expect(result.metric_deltas).toEqual({ expected_return: 0.02, volatility: -0.02, sharpe: 0.3 });
    expect(buildPortfolioOptimizationDiff({ source: "AUTO", before: [], after: [], assets: [] }).metric_deltas.sharpe).toBeNull();
  });

  test("«Cambios aplicados» muestra filas y deltas antes/después", () => {
    const assets = [asset("A", 0.02), asset("B", 0.01)];
    const comparison = buildPortfolioOptimizationDiff({
      source: "MAX_SHARPE", before: [{ asset_id: "A", weight_percent: 100 }],
      after: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }], assets,
      beforeMetrics: { sharpe: 0.4 }, afterMetrics: { sharpe: 0.7 }
    });
    const html = renderToStaticMarkup(createElement(CambiosAplicados, { comparacion: comparison }));
    expect(html).toContain("Antes / después");
    expect(html).toContain("Entra");
    expect(html).toContain("+0,3");
  });
});
