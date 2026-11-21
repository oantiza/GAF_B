import { describe, expect, test } from "vitest";
import { evaluatePortfolioHealth, PORTFOLIO_HEALTH_RULES } from "../src/core/portfolioHealth";
import { WEIGHT_TOLERANCE_PERCENT } from "../src/core/weightTolerance";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

function asset(id: string, options: { ter?: number; risk?: boolean } = {}): BdbAssetDetail {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY",
    currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE",
    quality_flags: [], warnings: [], description: "", metrics: options.risk === false ? {} : { volatility_3y: 0.12 },
    costs: options.ter === undefined ? undefined : { ongoing_charge: options.ter },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}
const positions = (rows: Array<[string, number]>): BdbManualPortfolioPosition[] => rows.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));

describe("evaluatePortfolioHealth", () => {
  test("posición >25 % avisa y >40 % falla; las fronteras exactas no disparan", () => {
    const assets = [asset("A"), asset("B"), asset("C"), asset("D")];
    expect(evaluatePortfolioHealth({ positions: positions([["A", 25], ["B", 25], ["C", 25], ["D", 25]]), assets }).status).toBe("OK");
    expect(evaluatePortfolioHealth({ positions: positions([["A", 26], ["B", 24], ["C", 25], ["D", 25]]), assets }).status).toBe("WARN");
    expect(evaluatePortfolioHealth({ positions: positions([["A", 41], ["B", 19], ["C", 20], ["D", 20]]), assets }).status).toBe("FAIL");
  });

  test("suma fuera de 100 ±0,05 avisa: la misma tolerancia que el constructor (MEDIA-15)", () => {
    const assets = [asset("A"), asset("B"), asset("C"), asset("D")];
    const sumWarns = (last: number) => evaluatePortfolioHealth({ positions: positions([["A", 25], ["B", 25], ["C", 25], ["D", last]]), assets })
      .violations.some((v) => v.rule === "WEIGHT_SUM");
    expect(sumWarns(25.04)).toBe(false);
    expect(sumWarns(24.96)).toBe(false);
    // Antes (±0,1) estas dos pasaban como cuadradas aunque el constructor las daba por descuadradas.
    expect(sumWarns(25.08)).toBe(true);
    expect(sumWarns(24.92)).toBe(true);
    expect(PORTFOLIO_HEALTH_RULES.WEIGHT_SUM_TOLERANCE_PCT).toBe(WEIGHT_TOLERANCE_PERCENT);
    const violation = evaluatePortfolioHealth({ positions: positions([["A", 25], ["B", 25], ["C", 25], ["D", 25.2]]), assets })
      .violations.find((v) => v.rule === "WEIGHT_SUM");
    expect(violation?.threshold).toBe("100 % ± 0,05\u00a0%");
  });

  test.each([
    [0.02, 0.0152, 0.0176],
    [0.02, 0.016, 0.018],
    [0.06, 0.04, 0.05],
  ])("TER elevado sigue siendo informativo y no cambia la salud (%s, %s)", (terA, terB, expected) => {
    const result = evaluatePortfolioHealth({
      positions: positions([["A", 25], ["B", 25], ["C", 25], ["D", 25]]),
      assets: [asset("A", { ter: terA }), asset("B", { ter: terB }), asset("C", { ter: terA }), asset("D", { ter: terB })],
    });
    expect(result.weighted_ter_rate).toBeCloseTo(expected);
    expect(result.ter_coverage_weight_pct).toBe(100);
    expect(result.status).toBe("OK");
    expect(result.violations).toEqual([]);
  });

  test("una acción cuenta a cero en el coste medio y como conocida; un fondo sin coste, no", () => {
    const stock = { ...asset("S"), instrument_type: "STOCK" as const };
    /* A mano: 70 % al 1 % + 30 % a cero = 0,70 %. */
    const conAccion = evaluatePortfolioHealth({ positions: positions([["A", 40], ["B", 30], ["S", 30]]), assets: [asset("A", { ter: 0.01 }), asset("B", { ter: 0.01 }), stock] });
    expect(conAccion.weighted_ter_rate).toBeCloseTo(0.007, 12);
    expect(conAccion.ter_coverage_weight_pct).toBe(100);
    const conFondoSinCoste = evaluatePortfolioHealth({ positions: positions([["A", 70], ["B", 30]]), assets: [asset("A", { ter: 0.01 }), asset("B")] });
    expect(conFondoSinCoste.weighted_ter_rate).toBeCloseTo(0.01, 12);
    expect(conFondoSinCoste.ter_coverage_weight_pct).toBe(70);
  });

  test("más del 20 % del peso sin métricas de riesgo avisa", () => {
    const result = evaluatePortfolioHealth({ positions: positions([["A", 79], ["B", 21]]), assets: [asset("A"), asset("B", { risk: false })] });
    expect(result.missing_risk_weight_pct).toBe(21);
    expect(result.violations.some((v) => v.rule === "MISSING_RISK_METRICS")).toBe(true);
  });

  test("RC positiva >40 % avisa; negativa o frontera exacta no", () => {
    const assets = [asset("A"), asset("B"), asset("C"), asset("D")];
    const result = evaluatePortfolioHealth({
      positions: positions([["A", 25], ["B", 25], ["C", 25], ["D", 25]]), assets,
      riskContributions: [{ asset_id: "A", weight_pct: 25, risk_pct: 41 }, { asset_id: "B", weight_pct: 25, risk_pct: -4 }, { asset_id: "C", weight_pct: 25, risk_pct: 40 }]
    });
    expect(result.violations.filter((v) => v.rule === "RISK_CONTRIBUTION")).toHaveLength(1);
    expect(PORTFOLIO_HEALTH_RULES.RISK_CONTRIBUTION_WARN_PCT).toBe(40);
  });
});

describe("el aprobado exige riesgo medido", () => {
  const entrada = {
    positions: [{ asset_id: "A", weight_percent: 10 }, { asset_id: "B", weight_percent: 10 }, { asset_id: "C", weight_percent: 10 },
      { asset_id: "D", weight_percent: 10 }, { asset_id: "E", weight_percent: 10 }, { asset_id: "F", weight_percent: 10 },
      { asset_id: "G", weight_percent: 10 }, { asset_id: "H", weight_percent: 10 }, { asset_id: "I", weight_percent: 10 },
      { asset_id: "J", weight_percent: 10 }],
    assets: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((asset_id) => ({ asset_id, display_name: asset_id, metrics: { volatility_3y: 0.1 } })) as never
  };

  test("sin riesgo medido no hay aprobado, y dice por qué", () => {
    const salud = evaluatePortfolioHealth({ ...entrada, riesgoMedido: false });
    expect(salud.status).toBe("WARN");
    expect(salud.violations.map((v) => v.rule)).toContain("RISK_NOT_MEASURED");
  });

  test("con riesgo medido, o sin decir nada, no añade nada", () => {
    expect(evaluatePortfolioHealth({ ...entrada, riesgoMedido: true }).status).toBe("OK");
    expect(evaluatePortfolioHealth(entrada).status).toBe("OK");
  });
});
