import {
  buildManualPortfolioOptimizationPreview as buildLocalManualPortfolioOptimizationPreview,
  buildManualPortfolioReport as buildLocalManualPortfolioReport,
  buildManualPortfolioSummary as buildLocalManualPortfolioSummary,
  buildOptimizationInput as buildLocalOptimizationInput,
  getAssetDetail as getLocalAssetDetail,
  getAssetHoldings as getLocalAssetHoldings,
  getComparableAssets as getLocalComparableAssets,
  getPortfolioInputs as getLocalPortfolioInputs,
  searchAssets as searchLocalAssets
} from "./bdbAssetsAdapter";
import {
  buildStaticExportManualPortfolioOptimizationPreview,
  buildStaticExportManualPortfolioReport,
  buildStaticExportManualPortfolioSummary,
  buildStaticExportOptimizationInput,
  getStaticExportAssetDetail,
  getStaticExportAssetHoldings,
  getStaticExportComparableAssets,
  getStaticExportPortfolioInputs,
  searchAssetsFromBbddStaticExportSample
} from "./bbddActivosStaticExportAdapter";
import type {
  AssetDataSource,
  AssetDataSourceKind,
  AssetDataSourceMetadata
} from "../types/assetDataSource";
import { isExcludedBenchmarkIsin } from "../core/benchmarkProfiles";

const liveApiAdapter = () => import("./bdbLiveApiAdapter");

/**
 * Envuelve una fuente para EXCLUIR los indices base de los benchmarks
 * (IE00B18GC888 / IE00B03HCZ61) de toda busqueda/seleccion de activos.
 * Guard de frontend; el backend (search_assets) es la exclusion primaria.
 */
function withBenchmarkExclusion(source: AssetDataSource): AssetDataSource {
  const searchAssets = source.searchAssets;
  const searchAssetsPage = source.searchAssetsPage;
  const getAssetDetail = source.getAssetDetail;
  const getAssetHoldings = source.getAssetHoldings;
  const getAssetHoldingsMany = source.getAssetHoldingsMany;
  const getComparableAssets = source.getComparableAssets;
  const resolvePortfolioPositions = source.resolvePortfolioPositions;
  return {
    ...source,
    searchAssets: async (options) => {
      const results = await searchAssets(options);
      return results.filter(
        (a) => !isExcludedBenchmarkIsin(a.asset_id) && !isExcludedBenchmarkIsin(a.isin)
      );
    },
    searchAssetsPage: searchAssetsPage
      ? async (options) => {
          const page = await searchAssetsPage(options);
          return {
            ...page,
            results: page.results.filter(
              (a) => !isExcludedBenchmarkIsin(a.asset_id) && !isExcludedBenchmarkIsin(a.isin)
            )
          };
        }
      : undefined,
    getAssetDetail: async (assetId) => {
      if (isExcludedBenchmarkIsin(assetId)) {
        return null;
      }
      const result = await getAssetDetail(assetId);
      if (result && (isExcludedBenchmarkIsin(result.asset_id) || isExcludedBenchmarkIsin(result.isin))) {
        return null;
      }
      return result;
    },
    getAssetHoldings: getAssetHoldings
      ? async (assetId) => {
          if (isExcludedBenchmarkIsin(assetId)) {
            return null;
          }
          return getAssetHoldings(assetId);
        }
      : undefined,
    getAssetHoldingsMany: getAssetHoldingsMany
      ? async (assetIds) => {
          const safeIds = assetIds.filter((assetId) => !isExcludedBenchmarkIsin(assetId));
          const resolved = safeIds.length > 0 ? await getAssetHoldingsMany(safeIds) : new Map<string, null>();
          const out = new Map<string, Awaited<ReturnType<NonNullable<typeof getAssetHoldings>>>>();
          assetIds.forEach((assetId) => {
            out.set(assetId, isExcludedBenchmarkIsin(assetId) ? null : resolved.get(assetId) ?? null);
          });
          return out;
        }
      : undefined,
    getComparableAssets: async (assetIds) => {
      const safeIds = assetIds.filter((assetId) => !isExcludedBenchmarkIsin(assetId));
      const results = await getComparableAssets(safeIds);
      return results.filter(
        (a) => !isExcludedBenchmarkIsin(a.asset_id) && !isExcludedBenchmarkIsin(a.isin)
      );
    },
    resolvePortfolioPositions: resolvePortfolioPositions
      ? async (positions) => {
          const safePositions = positions.filter((position) => !isExcludedBenchmarkIsin(position.asset_id));
          const results = await resolvePortfolioPositions(safePositions);
          return results.filter(
            (row) => !row.asset || (!isExcludedBenchmarkIsin(row.asset.asset_id) && !isExcludedBenchmarkIsin(row.asset.isin))
          );
        }
      : undefined
  };
}

const SOURCE_METADATA: Record<AssetDataSourceKind, AssetDataSourceMetadata> = {
  LOCAL_MOCK: {
    kind: "LOCAL_MOCK",
    label: "Mock local",
    description: "Datos mock internos de BDB-ACTIVOS.",
    status: "ACTIVE_LOCAL",
    isRealConnection: false
  },
  BBDD_STATIC_EXPORT_SAMPLE: {
    kind: "BBDD_STATIC_EXPORT_SAMPLE",
    label: "Export estatico BBDD local",
    description: "Muestra estatica controlada derivada de un snapshot local de BBDD-ACTIVOS.",
    status: "STATIC_EXPORT_SAMPLE",
    isRealConnection: false
  },
  BBDD_LIVE_API: {
    kind: "BBDD_LIVE_API",
    label: "BBDD en vivo (API)",
    description: "Datos reales de BBDD-ACTIVOS via backend Cloud Functions (requiere login).",
    status: "LIVE_API",
    isRealConnection: true
  }
};

export function getAssetDataSource(kind: AssetDataSourceKind): AssetDataSource {
  if (kind === "BBDD_LIVE_API") {
    return withBenchmarkExclusion({
      metadata: SOURCE_METADATA.BBDD_LIVE_API,
      searchAssets: async (options) => (await liveApiAdapter()).searchLiveApiAssets(options),
      searchAssetsPage: async (options) => (await liveApiAdapter()).searchLiveApiAssetsPage(options),
      getAssetDetail: async (assetId) => (await liveApiAdapter()).getLiveApiAssetDetail(assetId),
      getAssetHoldings: async (assetId) => (await liveApiAdapter()).getLiveApiAssetHoldings(assetId),
      getAssetHoldingsMany: async (assetIds) => (await liveApiAdapter()).getLiveApiAssetHoldingsMany(assetIds),
      getComparableAssets: async (assetIds) => (await liveApiAdapter()).getLiveApiComparableAssets(assetIds),
      resolvePortfolioPositions: async (positions) => (await liveApiAdapter()).resolveLiveApiPortfolioPositions(positions),
      getPortfolioInputs: async (options) => (await liveApiAdapter()).getLiveApiPortfolioInputs(options),
      buildOptimizationInput: async (options) => (await liveApiAdapter()).buildLiveApiOptimizationInput(options),
      buildManualPortfolioSummary: async (positions) => (await liveApiAdapter()).buildLiveApiManualPortfolioSummary(positions),
      buildManualPortfolioOptimizationPreview: async (positions) =>
        (await liveApiAdapter()).buildLiveApiManualPortfolioOptimizationPreview(positions),
      // B6: el nombre real de la cartera viaja al informe; antes se descartaba aquí.
      buildManualPortfolioReport: async (positions, portfolioName) =>
        (await liveApiAdapter()).buildLiveApiManualPortfolioReport(positions, portfolioName)
    });
  }

  if (kind === "BBDD_STATIC_EXPORT_SAMPLE") {
    return withBenchmarkExclusion({
      metadata: SOURCE_METADATA.BBDD_STATIC_EXPORT_SAMPLE,
      searchAssets: searchAssetsFromBbddStaticExportSample,
      getAssetDetail: getStaticExportAssetDetail,
      getAssetHoldings: getStaticExportAssetHoldings,
      getComparableAssets: getStaticExportComparableAssets,
      getPortfolioInputs: getStaticExportPortfolioInputs,
      buildOptimizationInput: buildStaticExportOptimizationInput,
      buildManualPortfolioSummary: buildStaticExportManualPortfolioSummary,
      buildManualPortfolioOptimizationPreview: buildStaticExportManualPortfolioOptimizationPreview,
      buildManualPortfolioReport: buildStaticExportManualPortfolioReport
    });
  }

  return withBenchmarkExclusion({
    metadata: SOURCE_METADATA.LOCAL_MOCK,
    searchAssets: searchLocalAssets,
    getAssetDetail: getLocalAssetDetail,
    getAssetHoldings: getLocalAssetHoldings,
    getComparableAssets: getLocalComparableAssets,
    getPortfolioInputs: getLocalPortfolioInputs,
    buildOptimizationInput: buildLocalOptimizationInput,
    buildManualPortfolioSummary: buildLocalManualPortfolioSummary,
    buildManualPortfolioOptimizationPreview: buildLocalManualPortfolioOptimizationPreview,
    buildManualPortfolioReport: buildLocalManualPortfolioReport
  });
}

export function getAssetDataSourceMetadata(kind: AssetDataSourceKind): AssetDataSourceMetadata {
  return SOURCE_METADATA[kind];
}
