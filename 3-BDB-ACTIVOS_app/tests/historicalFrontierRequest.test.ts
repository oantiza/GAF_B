import { describe, expect, test } from "vitest";
import { buildDisplayedHistoricalFrontierRequest } from "../src/core/historicalFrontierRequest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const assets = [
  { asset_id: "A", is_investable: true, metrics: { volatility_3y: 0.1, annualized_return_3y: 0.07 } },
  { asset_id: "B", is_investable: true, metrics: { volatility_3y: 0.08, annualized_return_3y: 0.05 } },
  { asset_id: "C", is_investable: true, metrics: { volatility_3y: null, annualized_return_3y: 0.03 } }
] as BdbAssetDetail[];

const positions = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 10 }
] as BdbManualPortfolioPosition[];

describe("petición de frontera histórica visible", () => {
  test("descarta activos sin métricas y renormaliza los pesos incluidos", () => {
    const request = buildDisplayedHistoricalFrontierRequest({ assets, positions });

    expect(request).toMatchObject({
      assetIds: ["A", "B"],
      window: "3Y",
      objective: "TARGET_RISK",
      riskSlider: 5,
      expectedReturnModel: "HISTORICAL_SHRINKAGE"
    });
    expect(request).not.toHaveProperty("groupConstraints");
    expect(request?.currentWeights?.A).toBeCloseTo(2 / 3);
    expect(request?.currentWeights?.B).toBeCloseTo(1 / 3);
  });

  test("no construye una frontera si no hay dos activos elegibles", () => {
    expect(buildDisplayedHistoricalFrontierRequest({ assets: assets.slice(0, 1), positions })).toBeNull();
  });
});
