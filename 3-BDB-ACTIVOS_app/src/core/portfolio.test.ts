import { describe, it, expect } from "vitest";
import { buildSummaryFromAssets, isWeightBalanced } from "./portfolio";
import { RISK_FREE_RATE } from "./quantConfig";
import type { BdbAssetDetail, EconomicAssetClass } from "../types/bdbAssets";

function asset(
  assetId: string,
  economicAssetClass: EconomicAssetClass,
  annualizedReturn3y: number,
  volatility3y: number
): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: assetId,
    instrument_type: "FUND",
    economic_asset_class: economicAssetClass,
    isin: assetId,
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {
      // A1 (auditoría 29-09): la maestra mide las métricas de activo en semanal.
      metrics_frequency: "WEEKLY",
      annualized_return_3y: annualizedReturn3y,
      volatility_3y: volatility3y,
      sharpe_3y: 99
    },
    description: "",
    pms_exposure: {
      equity: economicAssetClass === "EQUITY" ? 1 : 0,
      fixed_income: economicAssetClass === "FIXED_INCOME" ? 1 : 0,
      cash: economicAssetClass === "MONEY_MARKET" ? 1 : 0,
      alternative: 0,
      real_asset: 0,
      other: 0
    }
  };
}

/**
 * Regresión 69A: el criterio de "cartera cuadrada" debe ser único y tolerar el
 * redondeo de pesos iguales (p.ej. 3 × 33.33% = 99.99%). El bug original usaba
 * una tolerancia de 0.01 que, por coma flotante, marcaba 99.99% como UNDER y
 * disparaba un falso "peso bajo" mientras el titular mostraba 100.0%.
 */
describe("isWeightBalanced", () => {
  it("acepta exactamente 100%", () => {
    expect(isWeightBalanced(100)).toBe(true);
  });

  it("acepta 99.99% (3 × 33.33%) — el caso del bug de coma flotante", () => {
    expect(isWeightBalanced(99.99)).toBe(true);
    expect(isWeightBalanced(33.33 + 33.33 + 33.33)).toBe(true);
  });

  it("acepta pequeñas desviaciones dentro de ±0.05", () => {
    expect(isWeightBalanced(100.01)).toBe(true);
    expect(isWeightBalanced(99.96)).toBe(true);
    expect(isWeightBalanced(100.04)).toBe(true);
  });

  it("rechaza desviaciones reales (peso bajo / pasado)", () => {
    expect(isWeightBalanced(99.9)).toBe(false);
    expect(isWeightBalanced(100.1)).toBe(false);
    expect(isWeightBalanced(95)).toBe(false);
    expect(isWeightBalanced(0)).toBe(false);
  });
});

describe("buildSummaryFromAssets — estado de validación de pesos", () => {
  const positions = (weights: number[]) =>
    weights.map((w, i) => ({ asset_id: `A${i}`, weight_percent: w }));

  it("3 × 33.33% (= 99.99%) se considera VALID y NO avisa de peso bajo", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: positions([33.33, 33.33, 33.33]),
      assets: [0, 1, 2].map((i) => asset(`A${i}`, "EQUITY", 0.05, 0.1))
    });
    expect(summary.total_weight_percent).toBe(99.99);
    expect(summary.validation_status).toBe("VALID");
    expect(summary.is_valid).toBe(true);
    expect(summary.warnings).not.toContain("La suma de pesos está por debajo de 100%.");
  });

  it("una cartera realmente incompleta (95%) sí marca UNDER_ALLOCATED y avisa", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: positions([50, 45]),
      assets: []
    });
    expect(summary.validation_status).toBe("UNDER_ALLOCATED");
    expect(summary.is_valid).toBe(false);
    expect(summary.warnings).toContain("La suma de pesos está por debajo de 100%.");
  });

  it("una cartera pasada de peso (105%) marca OVER_ALLOCATED y avisa", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: positions([60, 45]),
      assets: []
    });
    expect(summary.validation_status).toBe("OVER_ALLOCATED");
    expect(summary.warnings).toContain("La suma de pesos supera 100%.");
  });

  it("sin posiciones, el estado es EMPTY", () => {
    const summary = buildSummaryFromAssets({ source: "LOCAL_MOCK", manualPositions: [], assets: [] });
    expect(summary.validation_status).toBe("EMPTY");
  });
});

describe("buildSummaryFromAssets — métricas preview de riesgo", () => {
  it("estima volatilidad de cartera con covarianza asumida, no como media ponderada", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "EQ", weight_percent: 50 },
        { asset_id: "FI", weight_percent: 50 }
      ],
      assets: [asset("EQ", "EQUITY", 0.05, 0.1), asset("FI", "FIXED_INCOME", 0.05, 0.1)]
    });

    expect(summary.weighted_metrics.annualized_return_3y).toBe(0.05);
    expect(summary.weighted_metrics.volatility_3y).toBe(0.0725);
    expect(summary.weighted_metrics.volatility_3y).toBeLessThan(0.1);
    expect(summary.weighted_metrics.sharpe_3y).toBe(
      Number(((0.05 - RISK_FREE_RATE) / 0.0725).toFixed(4))
    );
  });

  it("respeta una correlación más alta entre activos de la misma clase", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "EQ1", weight_percent: 50 },
        { asset_id: "EQ2", weight_percent: 50 }
      ],
      assets: [asset("EQ1", "EQUITY", 0.05, 0.1), asset("EQ2", "EQUITY", 0.05, 0.1)]
    });

    expect(summary.weighted_metrics.volatility_3y).toBe(0.0935);
    expect(summary.weighted_metrics.volatility_3y).toBeGreaterThan(0.0725);
    expect(summary.weighted_metrics.volatility_3y).toBeLessThan(0.1);
  });
});

/**
 * Auditoría 29-09 (F-06): la rentabilidad 5A/10A ponderada se reescalaba a la
 * parte de la cartera con dato y `metric_coverage` solo miraba 3A. Con A 30 %
 * (5A 12 %) + B 70 % (sin 5A) salía «Rentabilidad 5A 12,00 %» con cobertura 100 %.
 */
describe("buildSummaryFromAssets — cobertura por ventana (F-06)", () => {
  it("separa la cobertura de rentabilidad 5A de una volatilidad ausente", () => {
    const a = asset("A", "EQUITY", 0.05, 0.1);
    a.metrics.annualized_return_5y = 0.12;
    const m = buildSummaryFromAssets({ source: "LOCAL_MOCK",
      manualPositions: [{ asset_id: "A", weight_percent: 100 }], assets: [a] }).weighted_metrics;
    expect(m.annualized_return_5y).toBe(0.12);
    expect(m.return_coverage_5y).toBe(1);
    expect(m.metric_coverage_5y).toBe(0);
    expect(m.volatility_5y).toBeUndefined();
    expect(m.sharpe_5y).toBeUndefined();
  });
  function conVentanas(id: string, metrics: Partial<BdbAssetDetail["metrics"]>): BdbAssetDetail {
    const base = asset(id, "EQUITY", 0.05, 0.1);
    return { ...base, metrics: { ...base.metrics, ...metrics } };
  }

  it("deja la 5A en N/D cuando solo el 30 % de la cartera tiene dato, y publica su cobertura", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 70 }
      ],
      assets: [
        conVentanas("A", { annualized_return_5y: 0.12, volatility_5y: 0.1, annualized_return_10y: 0.09 }),
        conVentanas("B", {})
      ]
    });
    const m = summary.weighted_metrics;
    expect(m.metric_coverage).toBe(1);
    expect(m.metric_coverage_5y).toBe(0.3);
    expect(m.metric_coverage_10y).toBe(0.3);
    expect(m.annualized_return_5y).toBeUndefined();
    expect(m.annualized_return_10y).toBeUndefined();
    expect(m.volatility_5y).toBeUndefined();
    expect(m.sharpe_5y).toBeUndefined();
  });

  /* MEDIA-05 (auditoría 16-10-2026): la máxima caída se reescalaba a la parte
     con dato y en Análisis salía como «media de activos» sin cobertura. */
  it("deja la máxima caída en N/D por debajo del umbral y la publica al alcanzarlo", () => {
    const caidas = { max_drawdown_5y: -0.2, max_drawdown_hist: { value: -0.35 } };
    const con30 = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 70 }
      ],
      assets: [conVentanas("A", caidas), conVentanas("B", {})]
    }).weighted_metrics;
    expect(con30.max_drawdown_5y).toBeUndefined();
    expect(con30.max_drawdown_hist?.value).toBeUndefined();

    const con80 = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "A", weight_percent: 80 },
        { asset_id: "B", weight_percent: 20 }
      ],
      assets: [conVentanas("A", caidas), conVentanas("B", {})]
    }).weighted_metrics;
    expect(con80.max_drawdown_5y).toBe(-0.2);
    expect(con80.max_drawdown_hist?.value).toBe(-0.35);
  });

  it("publica la 5A cuando la cobertura ponderada alcanza el umbral del 80 %", () => {
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [
        { asset_id: "A", weight_percent: 80 },
        { asset_id: "B", weight_percent: 20 }
      ],
      assets: [
        conVentanas("A", { annualized_return_5y: 0.12, volatility_5y: 0.1 }),
        conVentanas("B", {})
      ]
    });
    const m = summary.weighted_metrics;
    expect(m.metric_coverage_5y).toBe(0.8);
    expect(m.annualized_return_5y).toBe(0.12);
    expect(m.volatility_5y).toBeDefined();
  });
});
