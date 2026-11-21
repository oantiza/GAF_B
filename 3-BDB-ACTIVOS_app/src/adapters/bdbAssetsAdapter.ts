import { mockAssets } from "../data/mockAssets";
import { mockHoldingsByAssetId } from "../data/mockHoldings";
import {
  findAssetByIdentifier,
  getComparableAssetsById,
  searchAssetDetails,
  warningsFromQualityFlags
} from "../core/assetMapping";
import { toPortfolioPositions } from "../core/portfolio";
import { createPortfolioWorkspace } from "../core/portfolioWorkspace";
import type {
  BdbAssetDetail,
  BdbAssetHoldings,
  BdbAssetSearchResult,
  BdbOptimizationInput,
  BdbPortfolioDraft,
  BdbPortfolioPosition,
  InstrumentType
} from "../types/bdbAssets";

export interface SearchAssetsOptions {
  query?: string;
  instrumentTypes?: InstrumentType[];
  limit?: number;
  /** Último asset_id servido: pide la página siguiente (solo fuentes con paginación real). */
  cursor?: string;
}

export interface PortfolioInputOptions {
  portfolio_id?: string;
  base_currency?: string;
  positions?: BdbPortfolioPosition[];
}

const SOURCE = "LOCAL_MOCK";

const DEFAULT_PORTFOLIO_POSITIONS: BdbPortfolioPosition[] = [
  { asset_id: "MOCK-ETF-WATER", weight: 0.25, label: "Crecimiento tematico" },
  { asset_id: "MOCK-STOCK-TECH", weight: 0.2, label: "Accion global" },
  { asset_id: "MOCK-FUND-GLOBAL-BOND", weight: 0.3, label: "Estabilidad" },
  { asset_id: "MOCK-FUND-MIXED", weight: 0.2, label: "Asignacion balanceada" },
  { asset_id: "MOCK-ETF-CASH", weight: 0.05, label: "Liquidez" }
];

function withWarnings(asset: BdbAssetDetail): BdbAssetDetail {
  return {
    ...asset,
    warnings: warningsFromQualityFlags(asset)
  };
}

function findAsset(assetId: string): BdbAssetDetail | undefined {
  return findAssetByIdentifier(mockAssets, assetId);
}

export async function searchAssets(options: SearchAssetsOptions = {}): Promise<BdbAssetSearchResult[]> {
  return searchAssetDetails(mockAssets.map(withWarnings), {
    query: options.query,
    instrumentTypes: options.instrumentTypes,
    limit: options.limit
  });
}

export async function getAssetDetail(assetId: string): Promise<BdbAssetDetail | null> {
  const asset = findAsset(assetId);
  return asset ? withWarnings(asset) : null;
}

export async function getAssetHoldings(assetId: string): Promise<BdbAssetHoldings | null> {
  return mockHoldingsByAssetId[assetId] ?? null;
}

export async function getComparableAssets(assetIds: string[]): Promise<BdbAssetDetail[]> {
  return getComparableAssetsById(mockAssets, assetIds).map(withWarnings);
}

export { toPortfolioPositions };

const portfolioWorkspace = createPortfolioWorkspace({
  source: SOURCE,
  defaultPortfolioId: "mock-multi-asset-portfolio",
  manualPortfolioId: "local-manual-portfolio",
  defaultPortfolioName: "Cartera local mock",
  getAssets: async () => mockAssets.map(withWarnings),
  getComparableAssets,
  getDefaultPortfolioPositions: async () => DEFAULT_PORTFOLIO_POSITIONS
});

export const getPortfolioInputs: (options?: PortfolioInputOptions) => Promise<BdbPortfolioDraft> =
  portfolioWorkspace.getPortfolioInputs;
export const buildOptimizationInput: (options?: PortfolioInputOptions) => Promise<BdbOptimizationInput> =
  portfolioWorkspace.buildOptimizationInput;
export const buildManualPortfolioSummary = portfolioWorkspace.buildManualPortfolioSummary;
export const buildManualPortfolioOptimizationPreview = portfolioWorkspace.buildManualPortfolioOptimizationPreview;
export const buildManualPortfolioReport = portfolioWorkspace.buildManualPortfolioReport;
