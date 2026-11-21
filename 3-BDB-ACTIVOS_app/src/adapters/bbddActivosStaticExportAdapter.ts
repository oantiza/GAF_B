import {
  bbddActivosStaticExportSample,
  BBDD_STATIC_EXPORT_SAMPLE_SOURCE
} from "../data/bbddActivosStaticExportSample";
import {
  findAssetByIdentifier,
  getComparableAssetsById,
  searchAssetDetails,
  warningsFromQualityFlags
} from "../core/assetMapping";
import { createPortfolioWorkspace } from "../core/portfolioWorkspace";
import { normalizeOfficialBenchmark } from "../core/officialBenchmark";
import { normalizeProductProfile, normalizeSustainabilityProfile } from "../core/assetProductMetadata";
import type { BbddActivosStaticExportSampleAsset } from "../data/bbddActivosStaticExportSample";
import type {
  BdbAssetDetail,
  BdbAssetHoldings,
  BdbAssetMetrics,
  BdbAssetSearchResult,
  BdbCoverageStatus,
  BdbOfficialMetricsEnvelope,
  BdbOptimizationInput,
  BdbPmsExposure,
  BdbPortfolioDraft,
  BdbQualityFlag,
  EconomicAssetClass
} from "../types/bdbAssets";
import type { PortfolioInputOptions, SearchAssetsOptions } from "./bdbAssetsAdapter";

const SOURCE = "BBDD_STATIC_EXPORT_SAMPLE";

function mapCoverageStatus(value: BbddActivosStaticExportSampleAsset["coverage_status"]): BdbCoverageStatus {
  if (value === "COVERED") {
    return "COMPLETE";
  }
  if (value === "UNCOVERED") {
    return "ROOT_ONLY";
  }

  return "PARTIAL";
}

function exposureForAssetClass(assetClass: EconomicAssetClass): BdbPmsExposure {
  if (assetClass === "FIXED_INCOME") {
    return { equity: 0, fixed_income: 0.92, cash: 0.06, alternative: 0, real_asset: 0, other: 0.02 };
  }
  if (assetClass === "MONEY_MARKET") {
    return { equity: 0, fixed_income: 0.1, cash: 0.9, alternative: 0, real_asset: 0, other: 0 };
  }
  if (assetClass === "MIXED") {
    return { equity: 0.45, fixed_income: 0.4, cash: 0.08, alternative: 0.05, real_asset: 0, other: 0.02 };
  }
  if (assetClass === "ALTERNATIVE") {
    return { equity: 0.15, fixed_income: 0.1, cash: 0.05, alternative: 0.65, real_asset: 0, other: 0.05 };
  }
  if (assetClass === "REAL_ASSET") {
    return { equity: 0, fixed_income: 0, cash: 0.03, alternative: 0, real_asset: 0.97, other: 0 };
  }
  if (assetClass === "UNKNOWN") {
    return { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 1 };
  }

  return { equity: 0.96, fixed_income: 0, cash: 0.03, alternative: 0, real_asset: 0, other: 0.01 };
}

function metricsForAsset(asset: BbddActivosStaticExportSampleAsset): BdbAssetMetrics {
  if (
    asset.risk_score !== undefined ||
    asset.volatility_3y !== undefined ||
    asset.annualized_return_3y !== undefined ||
    asset.sharpe_3y !== undefined ||
    asset.max_drawdown_5y !== undefined
  ) {
    return {
      risk_score: asset.risk_score,
      volatility_3y: asset.volatility_3y,
      annualized_return_3y: asset.annualized_return_3y ?? asset.ytd_return,
      sharpe_3y: asset.sharpe_3y,
      max_drawdown_5y: asset.max_drawdown_5y
    };
  }

  const absReturn = Math.abs(asset.ytd_return ?? 0);
  const volatilityByClass: Record<EconomicAssetClass, number> = {
    EQUITY: 0.18,
    FIXED_INCOME: 0.055,
    MIXED: 0.105,
    MONEY_MARKET: 0.012,
    ALTERNATIVE: 0.14,
    REAL_ASSET: 0.16,
    COMMODITIES: 0.16,
    OTHER: 0.12,
    UNKNOWN: 0.12
  };
  const volatility = volatilityByClass[asset.economic_asset_class] ?? 0.12;

  return {
    annualized_return_3y: asset.ytd_return,
    volatility_3y: volatility,
    sharpe_3y: Number(((asset.ytd_return ?? 0) / Math.max(volatility, 0.01)).toFixed(4)),
    max_drawdown_5y: Number((-Math.max(absReturn * 1.35, volatility * 0.75)).toFixed(4)),
    risk_score: Math.min(Math.max(Math.round(volatility * 35), 1), 7)
  };
}

function qualityFlagsForAsset(asset: BbddActivosStaticExportSampleAsset): BdbQualityFlag[] {
  if (asset.quality_flags?.length) {
    return asset.quality_flags;
  }

  const flags: BdbQualityFlag[] = [];

  if (asset.coverage_status !== "COVERED") {
    flags.push(asset.instrument_type === "INDEX" ? "MISSING_HISTORY" : "PARTIAL_COVERAGE");
  }
  if (asset.instrument_type === "INDEX") {
    flags.push("NON_INVESTABLE_BENCHMARK");
  }

  return flags;
}

function cloneOfficialMetricsEnvelope(
  envelope: BdbOfficialMetricsEnvelope | undefined
): BdbOfficialMetricsEnvelope | undefined {
  if (!envelope) {
    return undefined;
  }

  return {
    ...envelope,
    data_quality: {
      ...envelope.data_quality,
      flags: [...envelope.data_quality.flags],
      warnings: [...envelope.data_quality.warnings]
    },
    official_metrics: envelope.official_metrics ? { ...envelope.official_metrics } : undefined,
    official_performance: envelope.official_performance ? { ...envelope.official_performance } : undefined,
    official_risk: envelope.official_risk ? { ...envelope.official_risk } : undefined,
    official_costs: envelope.official_costs ? { ...envelope.official_costs } : undefined
  };
}

function mapStaticAssetToDetail(asset: BbddActivosStaticExportSampleAsset): BdbAssetDetail {
  const isBenchmark = asset.instrument_type === "INDEX";
  const costs =
    asset.instrument_type === "FUND" || asset.instrument_type === "ETF"
      ? { ongoing_charge: asset.ongoing_charge }
      : undefined;
  const detail: BdbAssetDetail = {
    asset_id: asset.asset_id,
    display_name: asset.name,
    instrument_type: asset.instrument_type,
    economic_asset_class: asset.economic_asset_class,
    isin: asset.isin,
    ticker: asset.ticker,
    provider: asset.provider,
    currency: asset.currency,
    coverage_status: mapCoverageStatus(asset.coverage_status),
    is_investable: asset.is_investable ?? !isBenchmark,
    role: asset.role ?? (isBenchmark ? "BENCHMARK" : "INVESTABLE"),
    quality_flags: qualityFlagsForAsset(asset),
    warnings: [],
    metrics: metricsForAsset(asset),
    description: `${asset.name}. Ficha construida sobre la muestra local de la base maestra (${BBDD_STATIC_EXPORT_SAMPLE_SOURCE.version}).`,
    region: asset.region,
    category: asset.category,
    sector: asset.sector,
    strategy: asset.strategy,
    official_benchmark: normalizeOfficialBenchmark(asset.benchmark, "BBDD_ACTIVOS"),
    product_profile: normalizeProductProfile(asset),
    sustainability_profile: normalizeSustainabilityProfile(asset.sustainability),
    costs,
    official_metrics_envelope: cloneOfficialMetricsEnvelope(asset.official_metrics_envelope),
    pms_exposure: asset.pms_exposure ?? exposureForAssetClass(asset.economic_asset_class),
    available_sections: asset.available_sections,
    performance_preview: asset.available_sections?.includes("performance_preview") ? {
      available: true,
      annualized_return_3y: asset.annualized_return_3y ?? asset.ytd_return,
      volatility_3y: asset.volatility_3y
    } : undefined,
    data_quality_summary: asset.quality_flags?.length 
      ? `Calidad: Parcial (${asset.quality_flags.join(", ")})` 
      : "Datos completos verificados"
  };

  return {
    ...detail,
    warnings: warningsFromQualityFlags(detail)
  };
}

export async function getAssetsFromBbddStaticExportSample(): Promise<BdbAssetDetail[]> {
  return bbddActivosStaticExportSample.map(mapStaticAssetToDetail);
}

export async function searchAssetsFromBbddStaticExportSample(
  options: SearchAssetsOptions = {}
): Promise<BdbAssetSearchResult[]> {
  const details = await getAssetsFromBbddStaticExportSample();

  return searchAssetDetails(details, {
    query: options.query,
    instrumentTypes: options.instrumentTypes,
    limit: options.limit ?? 50
  });
}

export async function getStaticExportAssetDetail(assetId: string): Promise<BdbAssetDetail | null> {
  const assets = await getAssetsFromBbddStaticExportSample();
  return findAssetByIdentifier(assets, assetId) ?? null;
}

export async function getStaticExportAssetHoldings(): Promise<BdbAssetHoldings | null> {
  return null;
}

export async function getStaticExportComparableAssets(assetIds: string[]): Promise<BdbAssetDetail[]> {
  const allAssets = await getAssetsFromBbddStaticExportSample();
  return getComparableAssetsById(allAssets, assetIds);
}

const staticExportPortfolioWorkspace = createPortfolioWorkspace({
  source: SOURCE,
  defaultPortfolioId: "static-export-sample-portfolio",
  manualPortfolioId: "static-export-sample-manual-portfolio",
  defaultPortfolioName: "Cartera export estatico BBDD local",
  getAssets: getAssetsFromBbddStaticExportSample,
  getComparableAssets: getStaticExportComparableAssets
});

export const getStaticExportPortfolioInputs: (
  options?: PortfolioInputOptions
) => Promise<BdbPortfolioDraft> = staticExportPortfolioWorkspace.getPortfolioInputs;
export const buildStaticExportOptimizationInput: (
  options?: PortfolioInputOptions
) => Promise<BdbOptimizationInput> = staticExportPortfolioWorkspace.buildOptimizationInput;
export const buildStaticExportManualPortfolioSummary = staticExportPortfolioWorkspace.buildManualPortfolioSummary;
export const buildStaticExportManualPortfolioOptimizationPreview =
  staticExportPortfolioWorkspace.buildManualPortfolioOptimizationPreview;
export const buildStaticExportManualPortfolioReport = staticExportPortfolioWorkspace.buildManualPortfolioReport;
