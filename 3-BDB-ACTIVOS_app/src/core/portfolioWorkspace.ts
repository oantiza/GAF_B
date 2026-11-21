import { isInvestableAsset } from "./assetMapping";
import {
  buildOptimizationInputFromDraft,
  buildPortfolioDraft,
  buildReportFromAssets,
  buildSummaryFromAssets,
  toPortfolioPositions
} from "./portfolio";
import type {
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationInput,
  BdbPortfolioDraft,
  BdbPortfolioPosition,
  BdbPortfolioReport
} from "../types/bdbAssets";

export interface PortfolioWorkspaceInputOptions {
  portfolio_id?: string;
  base_currency?: string;
  positions?: BdbPortfolioPosition[];
}

export interface PortfolioWorkspace {
  getPortfolioInputs(options?: PortfolioWorkspaceInputOptions): Promise<BdbPortfolioDraft>;
  buildOptimizationInput(options?: PortfolioWorkspaceInputOptions): Promise<BdbOptimizationInput>;
  buildManualPortfolioSummary(positions: BdbManualPortfolioPosition[]): Promise<BdbManualPortfolioSummary>;
  buildManualPortfolioOptimizationPreview(
    positions: BdbManualPortfolioPosition[]
  ): Promise<BdbOptimizationInput>;
  buildManualPortfolioReport(
    positions: BdbManualPortfolioPosition[],
    portfolioName?: string
  ): Promise<BdbPortfolioReport>;
}

interface PortfolioWorkspaceConfig {
  source: BdbAssetDataSourceKind;
  defaultPortfolioId: string;
  manualPortfolioId: string;
  defaultPortfolioName: string;
  getAssets: () => Promise<BdbAssetDetail[]>;
  getComparableAssets: (assetIds: string[]) => Promise<BdbAssetDetail[]>;
  getDefaultPortfolioPositions?: () => Promise<BdbPortfolioPosition[]>;
}

async function getFirstInvestablePortfolioPositions(
  assets: BdbAssetDetail[]
): Promise<BdbPortfolioPosition[]> {
  return assets
    .filter(isInvestableAsset)
    .slice(0, 3)
    .map((asset, index) => ({
      asset_id: asset.asset_id,
      weight: [0.4, 0.3, 0.3][index] ?? 0,
      label: asset.display_name
    }));
}

export function createPortfolioWorkspace(config: PortfolioWorkspaceConfig): PortfolioWorkspace {
  async function resolvePortfolioInputs(
    options: PortfolioWorkspaceInputOptions = {}
  ): Promise<BdbPortfolioDraft> {
    const positions =
      options.positions ??
      (config.getDefaultPortfolioPositions
        ? await config.getDefaultPortfolioPositions()
        : await getFirstInvestablePortfolioPositions(await config.getAssets()));
    const selectedAssets = await config.getComparableAssets(positions.map((position) => position.asset_id));

    return buildPortfolioDraft({
      source: config.source,
      portfolioId: options.portfolio_id ?? config.defaultPortfolioId,
      baseCurrency: options.base_currency,
      positions,
      selectedAssets
    });
  }

  async function resolveOptimizationInput(
    options: PortfolioWorkspaceInputOptions = {}
  ): Promise<BdbOptimizationInput> {
    const portfolioDraft = await resolvePortfolioInputs(options);
    const selectedAssets = await config.getComparableAssets(
      portfolioDraft.positions.map((position) => position.asset_id)
    );

    return buildOptimizationInputFromDraft({
      source: config.source,
      draft: portfolioDraft,
      selectedAssets
    });
  }

  async function resolveManualPortfolioSummary(
    positions: BdbManualPortfolioPosition[]
  ): Promise<BdbManualPortfolioSummary> {
    const assets = await config.getComparableAssets(positions.map((position) => position.asset_id));

    return buildSummaryFromAssets({
      source: config.source,
      manualPositions: positions,
      assets
    });
  }

  async function resolveManualPortfolioOptimizationPreview(
    positions: BdbManualPortfolioPosition[]
  ): Promise<BdbOptimizationInput> {
    const assets = await config.getComparableAssets(positions.map((position) => position.asset_id));
    const investableAssetIds = new Set(assets.filter(isInvestableAsset).map((asset) => asset.asset_id));
    const investablePositions = toPortfolioPositions(
      positions.filter((position) => investableAssetIds.has(position.asset_id))
    );

    return resolveOptimizationInput({
      portfolio_id: config.manualPortfolioId,
      base_currency: "EUR",
      positions: investablePositions
    });
  }

  async function resolveManualPortfolioReport(
    positions: BdbManualPortfolioPosition[],
    portfolioName?: string
  ): Promise<BdbPortfolioReport> {
    // B6: el nombre por defecto de la fuente solo cuando de verdad no hay nombre.
    const reportName = portfolioName?.trim() || config.defaultPortfolioName;
    const assets = await config.getComparableAssets(positions.map((position) => position.asset_id));
    const summary = buildSummaryFromAssets({
      source: config.source,
      manualPositions: positions,
      assets
    });

    return buildReportFromAssets({
      source: config.source,
      portfolioName: reportName,
      manualPositions: positions,
      assets,
      summary
    });
  }

  return {
    getPortfolioInputs: resolvePortfolioInputs,
    buildOptimizationInput: resolveOptimizationInput,
    buildManualPortfolioSummary: resolveManualPortfolioSummary,
    buildManualPortfolioOptimizationPreview: resolveManualPortfolioOptimizationPreview,
    buildManualPortfolioReport: resolveManualPortfolioReport
  };
}
