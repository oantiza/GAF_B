import type { AssetDataSource } from "../types/assetDataSource";
import type { BdbAssetSearchResult, InstrumentType } from "../types/bdbAssets";

/** Recorre los cursores: filtrar solo los primeros 200 ocultaba alternativas válidas. */
export async function loadSwapUniverse(
  source: Pick<AssetDataSource, "searchAssets" | "searchAssetsPage">,
  instrumentTypes: InstrumentType[] = ["FUND", "ETF", "STOCK"]
): Promise<BdbAssetSearchResult[]> {
  if (!source.searchAssetsPage) return source.searchAssets({ instrumentTypes, limit: Number.MAX_SAFE_INTEGER });
  const byId = new Map<string, BdbAssetSearchResult>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await source.searchAssetsPage({ instrumentTypes, limit: 200, ...(cursor ? { cursor } : {}) });
    for (const asset of page.results) byId.set(asset.asset_id, asset);
    if (!page.nextCursor) break;
    if (cursors.has(page.nextCursor)) throw new Error("No se pudo completar el catálogo de alternativas. Vuelve a intentarlo.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return [...byId.values()];
}
