import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";

export function canPrefetchActivePortfolio(
  sourceKind: AssetDataSourceKind,
  authenticated: boolean,
  positions: BdbManualPortfolioPosition[],
  hidden: boolean
): boolean {
  return sourceKind === "BBDD_LIVE_API"
    && authenticated
    && !hidden
    && new Set(positions.map((position) => position.asset_id.trim()).filter(Boolean)).size >= 2
    && positions.reduce((total, position) => total + Math.max(0, position.weight_percent || 0), 0) > 0;
}
