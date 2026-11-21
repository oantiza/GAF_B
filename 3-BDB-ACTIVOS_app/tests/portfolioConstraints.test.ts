import { describe, expect, test } from "vitest";
import {
  buildSuitabilityInformativePreview,
  canOptimizePortfolioWithConstraints,
  checkPortfolioFeasibility,
  createDefaultPortfolioConstraints,
  normalizeUnlockedPositions,
  pesosNormalizadosAlCien,
  redondearQueSume,
  resolvePortfolioBounds
} from "../src/core/portfolioConstraints";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import type { BdbAssetDetail, EconomicAssetClass, InstrumentType } from "../src/types/bdbAssets";

function asset(
  id: string,
  instrumentType: InstrumentType,
  economicAssetClass: EconomicAssetClass,
  exposure: Partial<BdbAssetDetail["pms_exposure"]> = {}
): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: id,
    instrument_type: instrumentType,
    economic_asset_class: economicAssetClass,
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: instrumentType !== "INDEX",
    role: instrumentType === "INDEX" ? "BENCHMARK" : "INVESTABLE",
    quality_flags: instrumentType === "INDEX" ? ["NON_INVESTABLE_BENCHMARK"] : [],
    warnings: [],
    metrics: {},
    pms_exposure: {
      equity: 0,
      fixed_income: 0,
      cash: 0,
      alternative: 0,
      real_asset: 0,
      other: 0,
      ...exposure
    },
    description: id
  };
}

describe("portfolio constraints core", () => {
  test("mantiene el contrato local portfolio-constraints.v1 por defecto", () => {
    const constraints = createDefaultPortfolioConstraints();

    expect(constraints.schema_version).toBe("portfolio-constraints.v1");
    expect(constraints.allow_non_investable_assets).toBe(false);
    expect(constraints.target_weight).toBe(1);
    expect(constraints.max_position_weight).toBe(1);
  });

  test("bloquea INDEX/benchmark como posicion invertible", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("IBEX", "INDEX", "EQUITY", { equity: 1 }), asset("FUND_A", "FUND", "EQUITY", { equity: 1 })],
      positions: [
        { asset_id: "IBEX", weight_percent: 50 },
        { asset_id: "FUND_A", weight_percent: 50 }
      ]
    });

    expect(feasibility.status).toBe("BLOCKED");
    expect(feasibility.blocking_issues.map((issue) => issue.code)).toContain("INDEX_NOT_INVESTABLE");
    expect(canOptimizePortfolioWithConstraints(feasibility, 2)).toBe(false);
  });

  test("acepta STOCK sin costes como activo invertible", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("AAPL", "STOCK", "EQUITY", { equity: 1 })],
      positions: [{ asset_id: "AAPL", weight_percent: 100 }]
    });

    expect(feasibility.status).toBe("FEASIBLE");
    expect(JSON.stringify(feasibility).toLowerCase()).not.toContain("cost");
  });

  test("avisa si la suma no llega al 100 sin bloquear posiciones libres", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 40 },
        { asset_id: "ETF_B", weight_percent: 50 }
      ]
    });

    expect(feasibility.status).toBe("WARNING");
    expect(feasibility.warnings.map((issue) => issue.code)).toContain("TOTAL_WEIGHT_OFF_TARGET");
    expect(canOptimizePortfolioWithConstraints(feasibility, 2)).toBe(true);
  });

  test("respeta candados compatibles y calcula presupuesto libre", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 40 },
        { asset_id: "ETF_B", weight_percent: 60 }
      ],
      lockedWeights: { FUND_A: 0.4 }
    });

    expect(feasibility.status).toBe("FEASIBLE");
    expect(feasibility.locked_weight).toBe(0.4);
    expect(feasibility.unlocked_budget).toBe(0.6);
  });

  test("bloquea candados incompatibles que superan el presupuesto", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 60 },
        { asset_id: "ETF_B", weight_percent: 50 }
      ],
      lockedWeights: { FUND_A: 0.6, ETF_B: 0.5 }
    });

    expect(feasibility.status).toBe("BLOCKED");
    expect(feasibility.blocking_issues.map((issue) => issue.code)).toContain("LOCKED_WEIGHT_EXCEEDS_TARGET");
  });

  test("bloquea limites por activo y los expone en bounds", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 70 },
        { asset_id: "ETF_B", weight_percent: 30 }
      ],
      constraints: {
        per_asset_bounds: { FUND_A: { max_weight: 0.5 } }
      }
    });

    expect(feasibility.status).toBe("BLOCKED");
    expect(feasibility.bounds.find((bound) => bound.asset_id === "FUND_A")?.max_weight).toBe(0.5);
    expect(feasibility.blocking_issues.map((issue) => issue.code)).toContain("POSITION_ABOVE_MAX");
  });

  test("bloquea limites por exposicion economica look-through", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 80 },
        { asset_id: "ETF_B", weight_percent: 20 }
      ],
      constraints: {
        exposure_bounds: { equity: { max_weight: 0.6 }, fixed_income: { min_weight: 0.2 } }
      }
    });

    expect(feasibility.status).toBe("BLOCKED");
    expect(feasibility.blocking_issues.map((issue) => issue.code)).toContain("EXPOSURE_ABOVE_MAX");
  });

  test("normaliza solo posiciones libres y conserva candados", () => {
    const normalized = normalizeUnlockedPositions({
      positions: [
        { asset_id: "FUND_A", weight_percent: 30 },
        { asset_id: "ETF_B", weight_percent: 30 },
        { asset_id: "STOCK_C", weight_percent: 30 }
      ],
      lockedWeights: { FUND_A: 0.3 }
    });

    expect(normalized).toEqual([
      { asset_id: "FUND_A", weight_percent: 30 },
      { asset_id: "ETF_B", weight_percent: 35 },
      { asset_id: "STOCK_C", weight_percent: 35 }
    ]);
  });

  describe("«Normalizar al 100 %» suma 100 de verdad: lo que se ve y lo que se guarda", () => {
    const enCentesimas = (pesos: number[]) => pesos.reduce((suma, peso) => suma + Math.round(peso * 100), 0);
    const posiciones = (pesos: number[]) => pesos.map((weight_percent, i) => ({ asset_id: `P${i}`, weight_percent }));

    /* Redondeando cada uno por su cuenta: 3 × 33,33 = 99,99; 7 × 14,29 = 100,03; 13 × 7,69 = 99,97. */
    test.each([
      [3, [33.34, 33.33, 33.33]],
      [7, [14.29, 14.29, 14.29, 14.29, 14.28, 14.28, 14.28]],
      [13, [7.70, 7.70, 7.70, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69]]
    ])("%i posiciones iguales: las centésimas que faltan van a las primeras", (n, esperado) => {
      const pesos = Object.values(pesosNormalizadosAlCien({ positions: posiciones(Array(n).fill(10)) }));
      expect(pesos).toEqual(esperado);
      expect(enCentesimas(pesos)).toBe(10000);
    });

    test("siete desiguales que redondeados uno a uno daban 99,99 %: la centésima va a la que más perdió", () => {
      /* 11, 20, 10, 9, 25, 18 y 20 de 113. Uno a uno: 9,73 + 17,70 + 8,85 + 7,96 + 22,12 + 15,93 + 17,70 = 99,99. Lo que pierde
         cada uno al redondear se mira a mano: 7,9646 es el que más centésima pierde de los que bajan. Calculado aparte con fracciones. */
      const pesos = Object.values(pesosNormalizadosAlCien({ positions: posiciones([11, 20, 10, 9, 25, 18, 20]) }));
      expect(pesos).toEqual([9.73, 17.7, 8.85, 7.97, 22.12, 15.93, 17.7]);
      expect(enCentesimas(pesos)).toBe(10000);
      expect(redondearQueSume([9.7345, 17.6991, 8.8496, 7.9646, 22.1239, 15.9292, 17.6991], 100)).toEqual(pesos);
    });

    test("en una cartera real la propuesta se mueve menos de una centésima de su valor exacto y conserva el orden", () => {
      const brutos = [24, 12, 10, 8, 20, 10, 9, 7].map((p) => p * 1.07);
      const pesos = Object.values(pesosNormalizadosAlCien({ positions: posiciones(brutos) }));
      const total = brutos.reduce((s, p) => s + p, 0);
      pesos.forEach((peso, i) => expect(Math.abs(peso - (brutos[i] / total) * 100)).toBeLessThan(0.01));
      expect(enCentesimas(pesos)).toBe(10000);
    });

    test("candados e importes fijos conservan su peso, y las libres suman lo que queda", () => {
      const pesos = pesosNormalizadosAlCien({
        positions: [{ asset_id: "F", weight_percent: 33.33 }, { asset_id: "A", weight_percent: 10 }, { asset_id: "B", weight_percent: 10 }, { asset_id: "C", weight_percent: 10 }],
        lockedWeights: { F: 0.3333 }
      });
      /* Quedan 66,67: 22,2233 cada una. */
      expect(pesos).toEqual({ F: 33.33, A: 22.23, B: 22.22, C: 22.22 });
      expect(enCentesimas(Object.values(pesos))).toBe(10000);
    });

    test("un peso cero se queda en cero, y una sola posición va al 100", () => {
      expect(pesosNormalizadosAlCien({ positions: posiciones([50, 0, 25]) })).toEqual({ P0: 66.67, P1: 0, P2: 33.33 });
      expect(pesosNormalizadosAlCien({ positions: posiciones([37]) })).toEqual({ P0: 100 });
    });

    test("sin nada que reescalar, cada una se queda con lo suyo", () => {
      expect(pesosNormalizadosAlCien({ positions: posiciones([0, 0]) })).toEqual({ P0: 0, P1: 0 });
      expect(pesosNormalizadosAlCien({ positions: posiciones([60, 60]), lockedWeights: { P0: 0.6, P1: 0.6 } })).toEqual({ P0: 60, P1: 60 });
    });

    test("cien carteras desordenadas, de 2 a 40 posiciones y con una fijada: siempre 100,00 %", () => {
      let semilla = 12345;
      const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
      for (let vuelta = 0; vuelta < 100; vuelta += 1) {
        const n = 2 + Math.floor(azar() * 39);
        const lista = posiciones(Array.from({ length: n }, () => Math.round(azar() * 500000) / 10000));
        const pesos = Object.values(pesosNormalizadosAlCien({ positions: lista, lockedWeights: vuelta % 2 ? { P0: Math.round(azar() * 5000) / 100000 } : {} }));
        expect(enCentesimas(pesos)).toBe(10000);
      }
    });
  });

  test("resuelve candados como bounds exactos sin perder el limite configurado", () => {
    const bounds = resolvePortfolioBounds({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 })],
      positions: [{ asset_id: "FUND_A", weight_percent: 45 }],
      lockedWeights: { FUND_A: 0.45 },
      constraints: { per_asset_bounds: { FUND_A: { max_weight: 0.4 } } }
    });

    expect(bounds[0]).toMatchObject({
      min_weight: 0.45,
      max_weight: 0.45,
      locked_weight: 0.45,
      configured_max_weight: 0.4
    });
  });

  test("bloquea un candado por encima del maximo configurado", () => {
    const feasibility = checkPortfolioFeasibility({
      assets: [asset("FUND_A", "FUND", "EQUITY", { equity: 1 }), asset("ETF_B", "ETF", "FIXED_INCOME", { fixed_income: 1 })],
      positions: [
        { asset_id: "FUND_A", weight_percent: 45 },
        { asset_id: "ETF_B", weight_percent: 55 }
      ],
      lockedWeights: { FUND_A: 0.45 },
      constraints: { per_asset_bounds: { FUND_A: { max_weight: 0.4 } } }
    });

    expect(feasibility.status).toBe("BLOCKED");
    expect(feasibility.blocking_issues.some((issue) => issue.message.includes("fijado"))).toBe(true);
  });

  test("mantiene suitability informativa PREVIEW_ONLY", () => {
    const preview = buildSuitabilityInformativePreview({
      selectedProfile: RISK_PROFILE_CONTRACTS[4],
      warningCount: 1
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.suitability_allowed).toBe(false);
    expect(preview.recommendation_allowed).toBe(false);
    expect(preview.optimization_allowed).toBe(false);
    expect(preview.signals.join(" ")).toContain("Perfil seleccionado");
  });
});
