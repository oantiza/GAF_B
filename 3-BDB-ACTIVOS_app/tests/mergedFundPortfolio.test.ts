import { expect, test } from "vitest";
import { isInvestableAsset } from "../src/core/assetMapping";
import { buildOptimizationInputFromDraft, buildPortfolioDraft, buildReportFromAssets, createSavedLocalPortfolio, loadLocalPortfolio } from "../src/core/portfolio";
import type { BdbAssetDetail, BdbQualityFlag } from "../src/types/bdbAssets";

test.each([
  ["ES0127097030", "NON_INVESTABLE_CORPORATE_ACTION", "baja por fusión"],
  ["ES0125140A14", "NON_INVESTABLE_DELISTED", "excluido de cotización"],
  ["ES0143416115", "NON_INVESTABLE_DELISTED", "excluido de cotización"],
  ["LU1882457739", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", "clase cerrada a nuevas suscripciones"],
  ["LU1883319474", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", "clase cerrada a nuevas suscripciones"],
  ["LU1883342880", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", "clase cerrada a nuevas suscripciones"],
  /* Decisión 44: no se añade, y una cartera guardada que ya la lleve no la pierde. */
  ["ES0114400007", "NON_INVESTABLE_NEVER_RESOLVED", "sin precio ni métricas"],
])("%s conserva la posición al guardar y consultar, pero queda fuera de nuevas propuestas", (assetId, flag, label) => {
  const asset: BdbAssetDetail = {
    asset_id: assetId, display_name: assetId, instrument_type: flag === "NON_INVESTABLE_DELISTED" ? "STOCK" : "FUND",
    economic_asset_class: "FIXED_INCOME", currency: "EUR", coverage_status: "PARTIAL",
    is_investable: false, role: "INVESTABLE", quality_flags: [flag as BdbQualityFlag],
    warnings: [], metrics: { annualized_return_3y: 0.04 },
    pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    description: "Datos históricos"
  };
  const positions = [{ asset_id: asset.asset_id, weight_percent: 100, targetEuros: 4200 }];
  const saved = createSavedLocalPortfolio({ sourceKind: "BBDD_LIVE_API", name: "Histórica", positions, assets: [asset] });
  expect(loadLocalPortfolio(saved)).toEqual(positions);
  expect(isInvestableAsset(asset)).toBe(false);
  const report = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Histórica", manualPositions: positions, assets: [asset] });
  expect(report.positions).toHaveLength(1);
  expect(report.positions[0]).toMatchObject({ asset_id: asset.asset_id, weight_percent: 100, is_investable: false });
  expect(report.warnings.some((warning) => warning.includes(label))).toBe(true);
  expect(report.warnings.some((warning) => warning.includes("benchmark/no invertible"))).toBe(false);
  const draft = buildPortfolioDraft({ source: "BBDD_LIVE_API", portfolioId: "historic", positions: [{ asset_id: asset.asset_id, weight: 1 }], selectedAssets: [asset] });
  const input = buildOptimizationInputFromDraft({ source: "BBDD_LIVE_API", draft, selectedAssets: [asset] });
  expect(input.assets).toEqual([]);
  expect(input.positions).toEqual([]);
  expect(input.warnings.map((warning) => warning.code)).toContain(flag);
  expect(input.warnings.map((warning) => warning.code)).not.toContain("NON_INVESTABLE_BENCHMARK");
  expect(draft.positions).toEqual([{ asset_id: asset.asset_id, weight: 1 }]);
});
