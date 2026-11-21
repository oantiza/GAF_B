import { getAnalysisWindow } from "../core/analysisPreferences";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import { getAssetDataSource } from "./assetDataSource";

/**
 * Comparte la petición de horizonte que usan ahora los paneles visibles. Las fichas
 * y el análisis son independientes: ninguno espera al otro para empezar.
 */
export async function prefetchActivePortfolio(
  sourceKind: AssetDataSourceKind,
  positions: BdbManualPortfolioPosition[],
  signal?: AbortSignal
): Promise<void> {
  try {
    const assetIds = [...new Set(
      positions
        .map((position) => position.asset_id.trim())
        .filter(Boolean)
    )];
    if (assetIds.length < 2 || signal?.aborted) return;
    const [{ fetchPortfolioHorizon }, { isRealFrontierEnabled }] = await Promise.all([
      import("./portfolioHorizon"), import("./optimizePortfolioBackend")
    ]);
    if (signal?.aborted) return;
    await Promise.allSettled([
      getAssetDataSource(sourceKind).getComparableAssets(assetIds),
      ...(isRealFrontierEnabled() ? [fetchPortfolioHorizon(positions, getAnalysisWindow(), signal)] : [])
    ]);
  } catch {
    // Prefetch best-effort: la pantalla volverá a intentar sus cargas normalmente.
  }
}
