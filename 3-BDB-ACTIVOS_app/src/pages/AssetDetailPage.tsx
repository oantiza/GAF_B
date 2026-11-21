import { AssetDetail } from "../components/AssetDetail";
import type { BdbAssetDetail, BdbAssetHoldings, BdbAssetSearchResult } from "../types/bdbAssets";

interface AssetDetailPageProps {
  asset: BdbAssetDetail;
  loadHoldings?: (assetId: string) => Promise<BdbAssetHoldings | null>;
  // Auditoría 11-08 (F1.2): la página solo media — pasa a AssetDetail los
  // mismos handlers de cartera/comparación que AssetSearch da a las filas.
  onAddToPortfolio?: (asset: BdbAssetSearchResult) => void;
  onToggleCompare?: (assetId: string) => void;
  isInPortfolio?: boolean;
  isSelectedForComparison?: boolean;
  isCompareDisabled?: boolean;
}

export function AssetDetailPage({
  asset,
  loadHoldings,
  onAddToPortfolio,
  onToggleCompare,
  isInPortfolio,
  isSelectedForComparison,
  isCompareDisabled
}: AssetDetailPageProps) {
  return (
    <AssetDetail
      asset={asset}
      loadHoldings={loadHoldings}
      onAddToPortfolio={onAddToPortfolio}
      onToggleCompare={onToggleCompare}
      isInPortfolio={isInPortfolio}
      isSelectedForComparison={isSelectedForComparison}
      isCompareDisabled={isCompareDisabled}
    />
  );
}
