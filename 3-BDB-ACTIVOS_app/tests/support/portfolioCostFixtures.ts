import type { BdbAssetDetail } from "../../src/types/bdbAssets";

const data = [
  ["IE00BYR8H148", 18.29, 1.59, 1.50],
  ["LU0289089384", 41.12, 1.71, 1.50],
  ["LU2092176515", 20.68, 2.48, 2.20],
  ["LU0918140210", 22.15, 1.72, 1.60],
  ["LU1164219682", 22.61, 1.16, .95],
  ["ES0138936036", 13.74, 1.88, 1.75],
  ["LU0232524495", 20.05, 1.74, 1.50],
  ["LU1883342377", 22.61, 1.90, 1.65]
] as const;

export const costPositions = data.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));
export const costAssets: BdbAssetDetail[] = data.map(([asset_id, , ongoing, management]) => ({
  asset_id, isin: asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY",
  currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [],
  description: "", metrics: {}, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
  costs: { ongoing_charge: ongoing / 100, management_fee: management / 100 }
}));
