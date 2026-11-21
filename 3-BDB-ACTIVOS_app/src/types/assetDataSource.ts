import type {
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbAssetHoldings,
  BdbAssetSearchResult,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationInput,
  BdbPortfolioDraft,
  BdbPortfolioReport
} from "./bdbAssets";
import type { PortfolioInputOptions, SearchAssetsOptions } from "../adapters/bdbAssetsAdapter";
import type { ParteSinLeer } from "../core/appError";

export type AssetDataSourceKind = BdbAssetDataSourceKind;

export type AssetDataSourceStatus =
  | "ACTIVE_LOCAL"
  | "LOCAL_FIXTURE_ONLY"
  | "STATIC_EXPORT_SAMPLE"
  | "LIVE_API";

export interface AssetDataSourceMetadata {
  kind: AssetDataSourceKind;
  label: string;
  description: string;
  status: AssetDataSourceStatus;
  isRealConnection: boolean;
}

export interface AssetResolvePosition {
  asset_id: string;
  amount: number;
}

export interface AssetResolvedPosition {
  id: string;
  amount: number;
  asset: BdbAssetDetail | null;
  /** Lo que el servidor no pudo leer de esta posición (aviso `READ_FAILED`). Con «asset», `asset` es null porque no se
      leyó, no porque no exista. Ausente cuando todo se leyó, y siempre con un servidor sin actualizar. */
  sinLeer?: ParteSinLeer[];
}

export interface AssetSearchPage {
  results: BdbAssetSearchResult[];
  /** Total real de coincidencias en el universo; null si la fuente no lo conoce. */
  totalMatches: number | null;
  /** Cursor para pedir la página siguiente; null cuando no quedan más. */
  nextCursor: string | null;
}

export interface AssetDataSource {
  metadata: AssetDataSourceMetadata;
  searchAssets(options?: SearchAssetsOptions): Promise<BdbAssetSearchResult[]>;
  /** Paginación real del universo con total honesto (hoy solo BBDD_LIVE_API). */
  searchAssetsPage?(options?: SearchAssetsOptions): Promise<AssetSearchPage>;
  getAssetDetail(assetId: string): Promise<BdbAssetDetail | null>;
  getAssetHoldings?(assetId: string): Promise<BdbAssetHoldings | null>;
  /** Ola 3b: holdings de varios activos en una sola llamada (hoy solo BBDD_LIVE_API).
      El fan-out de n llamadas simultáneas provocaba cola y arranques en frío. */
  getAssetHoldingsMany?(assetIds: string[]): Promise<Map<string, BdbAssetHoldings | null>>;
  getComparableAssets(assetIds: string[]): Promise<BdbAssetDetail[]>;
  resolvePortfolioPositions?(positions: AssetResolvePosition[]): Promise<AssetResolvedPosition[]>;
  getPortfolioInputs(options?: PortfolioInputOptions): Promise<BdbPortfolioDraft>;
  buildOptimizationInput(options?: PortfolioInputOptions): Promise<BdbOptimizationInput>;
  buildManualPortfolioSummary(positions: BdbManualPortfolioPosition[]): Promise<BdbManualPortfolioSummary>;
  buildManualPortfolioOptimizationPreview(positions: BdbManualPortfolioPosition[]): Promise<BdbOptimizationInput>;
  /** B6 (auditoría 29-09): `portfolioName` es el nombre real de la cartera activa;
      sin él la fuente pone su nombre por defecto («Cartera sin nombre»). */
  buildManualPortfolioReport(positions: BdbManualPortfolioPosition[], portfolioName?: string): Promise<BdbPortfolioReport>;
}
