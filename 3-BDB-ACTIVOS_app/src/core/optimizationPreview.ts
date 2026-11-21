import { bloqueadoPorCalidadDelDato, isInvestableAsset } from "./assetMapping";
import { ETIQUETAS_DE_CALIDAD } from "./glosarioDePantalla";
import { readableBackendLabel } from "./labels";
import { clampPercent, roundPercent } from "./portfolio";
import { clonePreviewMetricsBoundary } from "./previewMetricsBoundary";
import type {
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbAssetMetrics,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationPreview,
  BdbOptimizationPreviewAsset,
  BdbOptimizationPreviewExcludedAsset
} from "../types/bdbAssets";

const METRIC_KEYS: Array<keyof BdbAssetMetrics> = [
  "risk_score",
  "volatility_3y",
  "annualized_return_3y",
  "sharpe_3y",
  "max_drawdown_5y"
];

function getMetricsAvailable(metrics: BdbAssetMetrics): string[] {
  const keys = METRIC_KEYS.filter((metricKey) => typeof metrics[metricKey] === "number");
  if (typeof metrics.max_drawdown_hist?.value === "number") {
    keys.push("max_drawdown_hist");
  }
  return keys;
}

function getMetricsMissing(metrics: BdbAssetMetrics): string[] {
  const keys = METRIC_KEYS.filter((metricKey) => typeof metrics[metricKey] !== "number");
  if (typeof metrics.max_drawdown_hist?.value !== "number") {
    keys.push("max_drawdown_hist");
  }
  return keys;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function getQualityWarnings(asset: BdbAssetDetail): string[] {
  return asset.quality_flags
    .filter((flag) => flag !== "MOCK_DATA")
    /* D2.2: etiqueta del sistema, no el código crudo. */
    .map((flag) => `${asset.asset_id}: ${ETIQUETAS_DE_CALIDAD[flag] ?? readableBackendLabel(flag)}`);
}

export function buildLocalOptimizationPreview(options: {
  sourceKind: BdbAssetDataSourceKind;
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  summary: BdbManualPortfolioSummary;
}): BdbOptimizationPreview {
  const assetsById = new Map(options.assets.map((asset) => [asset.asset_id, asset]));
  const eligibleAssets: BdbOptimizationPreviewAsset[] = [];
  const excludedAssets: BdbOptimizationPreviewExcludedAsset[] = [];
  const portfolioWarnings = [...options.summary.warnings];

  for (const position of options.positions) {
    const asset = assetsById.get(position.asset_id);
    const weight = clampPercent(position.weight_percent);

    if (!asset) {
      excludedAssets.push({
        asset_id: position.asset_id,
        display_name: position.label ?? position.asset_id,
        weight_percent: weight,
        reason: "MISSING_ASSET"
      });
      continue;
    }

    if (weight <= 0) {
      excludedAssets.push({
        asset_id: asset.asset_id,
        display_name: asset.display_name,
        weight_percent: weight,
        reason: "INVALID_WEIGHT"
      });
      continue;
    }

    if (!isInvestableAsset(asset)) {
      excludedAssets.push({
        asset_id: asset.asset_id,
        display_name: asset.display_name,
        weight_percent: weight,
        reason: bloqueadoPorCalidadDelDato(asset) ? "QUALITY_BLOCKED" : "NON_INVESTABLE_BENCHMARK"
      });
      continue;
    }

    eligibleAssets.push({
      asset_id: asset.asset_id,
      display_name: asset.display_name,
      instrument_type: asset.instrument_type,
      economic_asset_class: asset.economic_asset_class,
      weight_percent: weight,
      metrics_available: getMetricsAvailable(asset.metrics),
      metrics_missing: getMetricsMissing(asset.metrics),
      quality_warnings: getQualityWarnings(asset)
    });
  }

  const qualityWarnings = eligibleAssets.flatMap((asset) => asset.quality_warnings);
  const metricsAvailable = unique(eligibleAssets.flatMap((asset) => asset.metrics_available));
  const metricsMissing = unique(eligibleAssets.flatMap((asset) => asset.metrics_missing));

  if (options.summary.validation_status !== "VALID") {
    portfolioWarnings.push("La suma de pesos no está validada al 100 %.");
  }
  if (excludedAssets.some((asset) => asset.reason === "INVALID_WEIGHT")) {
    portfolioWarnings.push("Hay posiciones excluidas por peso inválido o cero.");
  }
  if (excludedAssets.some((asset) => asset.reason === "NON_INVESTABLE_BENCHMARK")) {
    portfolioWarnings.push("Los índices y los activos no invertibles quedan fuera de la optimización.");
  }
  if (excludedAssets.some((asset) => asset.reason === "QUALITY_BLOCKED")) {
    portfolioWarnings.push("Lo que tiene una incidencia en su serie de precios queda fuera de la optimización.");
  }

  return {
    status: "PREVIEW_ONLY",
    sourceKind: options.sourceKind,
    metrics_boundary: clonePreviewMetricsBoundary(),
    total_weight_percent: roundPercent(options.summary.total_weight_percent),
    validation_status: options.summary.validation_status,
    eligible_assets: eligibleAssets,
    excluded_assets: excludedAssets,
    quality_warnings: qualityWarnings,
    metrics_available: metricsAvailable,
    metrics_missing: metricsMissing,
    portfolio_warnings: unique(portfolioWarnings),
    disclaimer:
      "No evalúa idoneidad ni es una recomendación personalizada."
  };
}
