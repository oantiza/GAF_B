import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_INPUT_PATH = "intake/static-export-sample/example-input.json";
export const DEFAULT_OUTPUT_PATH = "src/data/bbddActivosStaticExportSample.generated.ts";
export const DEFAULT_PROMOTED_SAMPLE_PATH = "src/data/bbddActivosStaticExportSample.ts";
export const MAX_INPUT_BYTES = 250_000;
export const MAX_INPUT_ASSETS = 250;
export const DEFAULT_SAMPLE_SIZE = 16;
export const TARGET_COUNTS_BY_TYPE = {
  FUND: 5,
  ETF: 5,
  STOCK: 4,
  INDEX: 2
};

const INSTRUMENT_TYPES = ["FUND", "ETF", "STOCK", "INDEX"];
const ECONOMIC_ASSET_CLASSES = ["EQUITY", "FIXED_INCOME", "MIXED", "MONEY_MARKET", "ALTERNATIVE", "OTHER"];
const COVERAGE_STATUSES = ["COVERED", "UNCOVERED", "UNKNOWN"];
const ASSET_FOR_BDB_SCHEMA_VERSION = "asset-for-bdb.v1";
const ASSET_ROLES = ["INVESTABLE", "BENCHMARK"];
const QUALITY_FLAGS = [
  "MOCK_DATA",
  "MISSING_HOLDINGS",
  "MISSING_HISTORY",
  "MISSING_METRICS",
  "MISSING_QUANT_METRICS",
  "PARTIAL_COVERAGE",
  "NON_INVESTABLE_BENCHMARK",
  "MISSING_ASSET"
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function asArrayOfStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function normalizeInstrumentType(value) {
  if (INSTRUMENT_TYPES.includes(value)) {
    return value;
  }

  throw new Error(`Unsupported instrument type: ${String(value)}`);
}

function normalizeEconomicAssetClass(value) {
  if (ECONOMIC_ASSET_CLASSES.includes(value)) {
    return value;
  }

  return "OTHER";
}

function normalizeCoverageStatus(value, instrumentType) {
  if (COVERAGE_STATUSES.includes(value)) {
    return value;
  }
  if (value === "COMPLETE") {
    return "COVERED";
  }
  if (value === "MISSING" || value === "ROOT_ONLY") {
    return "UNCOVERED";
  }
  if (value === "PARTIAL" || value === "COMPLETE_LATER") {
    return "UNKNOWN";
  }
  if (instrumentType === "INDEX") {
    return "UNKNOWN";
  }

  return "COVERED";
}

function normalizeReturn(value) {
  const numericValue = asNumber(value);

  if (typeof numericValue !== "number") {
    return undefined;
  }

  return Math.abs(numericValue) > 1 ? Number((numericValue / 100).toFixed(6)) : numericValue;
}

function normalizeOngoingCharge(value) {
  const numericValue = asNumber(value);

  if (typeof numericValue !== "number") {
    return undefined;
  }

  return numericValue > 0.2 ? Number((numericValue / 100).toFixed(6)) : numericValue;
}

function normalizeSections(value, instrumentType) {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...new Set(value)];
  }

  return instrumentType === "INDEX" ? ["summary", "proxy_note"] : ["summary"];
}

function normalizeRole(value, instrumentType) {
  if (ASSET_ROLES.includes(value)) {
    return value;
  }

  return instrumentType === "INDEX" ? "BENCHMARK" : "INVESTABLE";
}

function normalizeQualityFlags(value, instrumentType, role) {
  const flags = asArrayOfStrings(value)
    ? value
        .map((flag) => (flag === "MISSING_QUANT_METRICS" ? "MISSING_METRICS" : flag))
        .filter((flag) => QUALITY_FLAGS.includes(flag))
    : [];
  const normalizedFlags = new Set(flags);

  if (instrumentType === "INDEX" || role === "BENCHMARK") {
    normalizedFlags.add("NON_INVESTABLE_BENCHMARK");
  }

  return [...normalizedFlags];
}

function normalizePmsExposure(value) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    equity: asNumber(value.equity) ?? 0,
    fixed_income: asNumber(value.fixed_income) ?? 0,
    cash: asNumber(value.cash) ?? 0,
    alternative: asNumber(value.alternative) ?? 0,
    other: Number(((asNumber(value.other) ?? 0) + (asNumber(value.real_asset) ?? 0)).toFixed(6))
  };
}

function cloneStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function normalizeOfficialMetricsEnvelope(value) {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.suitability_allowed !== false
    || value.optimization_allowed !== false
    || value.recommendation_allowed !== false
  ) {
    throw new Error("official_metrics_envelope canary must keep suitability, optimization and recommendation disabled.");
  }

  const dataQuality = isRecord(value.data_quality) ? value.data_quality : {};
  const officialMetrics = isRecord(value.official_metrics) ? value.official_metrics : undefined;
  const officialPerformance = isRecord(value.official_performance) ? value.official_performance : undefined;
  const officialRisk = isRecord(value.official_risk) ? value.official_risk : undefined;
  const officialCosts = isRecord(value.official_costs) ? value.official_costs : undefined;

  return {
    mode: asString(value.mode),
    source: asString(value.source),
    as_of_date: asString(value.as_of_date),
    calculation_policy: asString(value.calculation_policy),
    data_quality: {
      status: asString(dataQuality.status),
      flags: cloneStringArray(dataQuality.flags),
      warnings: cloneStringArray(dataQuality.warnings)
    },
    official_metrics: officialMetrics ? {
      risk_score: asNumber(officialMetrics.risk_score)
    } : undefined,
    official_performance: officialPerformance ? {
      annualized_return_3y: asNumber(officialPerformance.annualized_return_3y),
      ytd_return: asNumber(officialPerformance.ytd_return)
    } : undefined,
    official_risk: officialRisk ? {
      volatility_3y: asNumber(officialRisk.volatility_3y),
      sharpe_3y: asNumber(officialRisk.sharpe_3y),
      max_drawdown_5y: asNumber(officialRisk.max_drawdown_5y)
    } : undefined,
    official_costs: officialCosts ? {
      ongoing_charge: asNumber(officialCosts.ongoing_charge),
      management_fee: asNumber(officialCosts.management_fee)
    } : undefined,
    suitability_allowed: false,
    optimization_allowed: false,
    recommendation_allowed: false
  };
}

function normalizeAsset(rawAsset) {
  if (!isRecord(rawAsset)) {
    throw new Error("Every asset must be an object.");
  }

  const classification = isRecord(rawAsset.classification) ? rawAsset.classification : {};
  const summary = isRecord(rawAsset.summary) ? rawAsset.summary : {};
  const metrics = isRecord(rawAsset.mock_metrics) ? rawAsset.mock_metrics : {};
  const assetForBdbMetrics = isRecord(rawAsset.metrics) ? rawAsset.metrics : {};
  const performancePreview = isRecord(rawAsset.performance_preview) ? rawAsset.performance_preview : {};
  const identity = isRecord(rawAsset.identity) ? rawAsset.identity : {};
  const product = isRecord(rawAsset.product) ? rawAsset.product : {};
  const costs = isRecord(rawAsset.costs) ? rawAsset.costs : {};
  const instrumentType = normalizeInstrumentType(rawAsset.instrument_type ?? rawAsset.asset_type);
  const assetId = asString(rawAsset.asset_id);
  const displayName = asString(rawAsset.display_name, asString(rawAsset.name, asString(identity.display_name)));
  const currency = asString(rawAsset.currency, asString(identity.currency, asString(classification.currency, "EUR")));
  const role = normalizeRole(rawAsset.role, instrumentType);
  const isInvestable = asBoolean(rawAsset.is_investable) ?? role !== "BENCHMARK";
  const qualityFlags = normalizeQualityFlags(rawAsset.quality_flags, instrumentType, role);

  if (!assetId || !displayName) {
    throw new Error("Every asset must include asset_id and display_name or name.");
  }

  return {
    asset_id: assetId,
    name: displayName,
    instrument_type: instrumentType,
    economic_asset_class: normalizeEconomicAssetClass(rawAsset.economic_asset_class ?? classification.asset_class),
    isin: asString(rawAsset.isin, asString(identity.isin)),
    ticker: asString(rawAsset.ticker, asString(identity.ticker)),
    provider: asString(rawAsset.provider, asString(summary.provider, asString(product.provider))),
    currency,
    coverage_status: normalizeCoverageStatus(rawAsset.coverage_status, instrumentType),
    region: asString(rawAsset.region, asString(classification.region)),
    market: asString(rawAsset.market, asString(classification.market)),
    category: asString(rawAsset.category, asString(summary.category, instrumentType === "INDEX" ? "Benchmark" : undefined)),
    benchmark: asString(rawAsset.benchmark, asString(summary.benchmark)),
    ongoing_charge: normalizeOngoingCharge(rawAsset.ongoing_charge ?? summary.ongoing_charge ?? summary.ter_pct ?? costs.ongoing_charge),
    latest_value: asNumber(rawAsset.latest_value ?? metrics.latest_value ?? metrics.price_today ?? performancePreview.latest_value),
    ytd_return: normalizeReturn(
      rawAsset.ytd_return ?? metrics.ytd_return ?? performancePreview.ytd_return ?? assetForBdbMetrics.annualized_return_3y
    ),
    latest_value_date: asString(rawAsset.latest_value_date, asString(metrics.latest_value_date, asString(performancePreview.latest_value_date))),
    volatility_3y: asNumber(assetForBdbMetrics.volatility_3y ?? performancePreview.volatility_3y),
    sharpe_3y: asNumber(assetForBdbMetrics.sharpe_3y ?? performancePreview.sharpe_3y),
    annualized_return_3y: normalizeReturn(assetForBdbMetrics.annualized_return_3y ?? performancePreview.annualized_return_3y),
    max_drawdown_5y: normalizeReturn(assetForBdbMetrics.max_drawdown_5y ?? performancePreview.max_drawdown_5y),
    risk_score: asNumber(assetForBdbMetrics.risk_score ?? performancePreview.risk_score),
    official_metrics_envelope: normalizeOfficialMetricsEnvelope(rawAsset.official_metrics_envelope),
    pms_exposure: normalizePmsExposure(rawAsset.pms_exposure),
    is_investable: isInvestable,
    role,
    quality_flags: qualityFlags,
    available_sections: normalizeSections(rawAsset.available_sections, instrumentType),
    source_note: rawAsset.metrics ? "asset_for_bdb_static_export_intake" : "static_snapshot_intake"
  };
}

function assertInputLimits({ bytes, assetsLength }, options) {
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const maxInputAssets = options.maxInputAssets ?? MAX_INPUT_ASSETS;

  if (bytes > maxInputBytes) {
    throw new Error(`Input JSON is too large: ${bytes} bytes, max ${maxInputBytes}.`);
  }
  if (assetsLength > maxInputAssets) {
    throw new Error(`Input JSON has too many assets: ${assetsLength}, max ${maxInputAssets}.`);
  }
}

function parseSnapshot(rawSnapshot) {
  if (!isRecord(rawSnapshot)) {
    throw new Error("Input JSON must be an object.");
  }
  if (!Array.isArray(rawSnapshot.assets)) {
    throw new Error("Input JSON must include an assets array.");
  }

  return rawSnapshot.assets;
}

function getAssetForBdbManifest(rawSnapshot) {
  if (!isRecord(rawSnapshot.manifest)) {
    return undefined;
  }
  if (rawSnapshot.manifest.schema_version !== ASSET_FOR_BDB_SCHEMA_VERSION) {
    return undefined;
  }

  return rawSnapshot.manifest;
}

function assertAssetForBdbManifest(rawSnapshot, options) {
  const manifest = getAssetForBdbManifest(rawSnapshot);
  if (!manifest) {
    return;
  }

  const rawAssets = parseSnapshot(rawSnapshot);
  const maxInputAssets = options.maxInputAssets ?? MAX_INPUT_ASSETS;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;

  if (manifest.total_assets !== rawAssets.length) {
    throw new Error("AssetForBdb manifest total_assets does not match assets length.");
  }
  if (manifest.total_assets > maxInputAssets) {
    throw new Error(`AssetForBdb manifest total_assets is too large: ${manifest.total_assets}, max ${maxInputAssets}.`);
  }
  if (!isRecord(manifest.counts_by_instrument_type)) {
    throw new Error("AssetForBdb manifest must include counts_by_instrument_type.");
  }
  for (const instrumentType of INSTRUMENT_TYPES) {
    const count = rawAssets.filter((asset) => asset.instrument_type === instrumentType).length;
    if (manifest.counts_by_instrument_type[instrumentType] !== count) {
      throw new Error(`AssetForBdb manifest count mismatch for ${instrumentType}.`);
    }
  }

  const maxSizePolicy = isRecord(manifest.max_size_policy) ? manifest.max_size_policy : {};
  if (maxSizePolicy.max_bytes && maxSizePolicy.max_bytes > maxInputBytes) {
    throw new Error("AssetForBdb manifest max_size_policy exceeds this intake byte limit.");
  }
  if (maxSizePolicy.max_assets && maxSizePolicy.max_assets > maxInputAssets) {
    throw new Error("AssetForBdb manifest max_size_policy exceeds this intake asset limit.");
  }
  if (maxSizePolicy.holdings !== "SUMMARY_ONLY" || maxSizePolicy.history !== "EXCLUDED") {
    throw new Error("AssetForBdb manifest must declare summary-only holdings and excluded history.");
  }
  if (maxSizePolicy.runtime_imports !== "NONE" || maxSizePolicy.external_reads !== 0 || maxSizePolicy.external_writes !== 0) {
    throw new Error("AssetForBdb manifest must declare no runtime imports and no external reads/writes.");
  }
}

function selectSample(normalizedAssets, sampleSize) {
  const selected = [];
  const selectedIds = new Set();

  for (const instrumentType of INSTRUMENT_TYPES) {
    const targetCount = TARGET_COUNTS_BY_TYPE[instrumentType] ?? 1;
    const typedAssets = normalizedAssets.filter((asset) => asset.instrument_type === instrumentType);

    for (const asset of typedAssets.slice(0, targetCount)) {
      if (selected.length >= sampleSize || selectedIds.has(asset.asset_id)) {
        continue;
      }

      selected.push(asset);
      selectedIds.add(asset.asset_id);
    }
  }

  for (const asset of normalizedAssets) {
    if (selected.length >= sampleSize) {
      break;
    }
    if (!selectedIds.has(asset.asset_id)) {
      selected.push(asset);
      selectedIds.add(asset.asset_id);
    }
  }

  return selected;
}

function countByInstrumentType(assets) {
  return assets.reduce((counts, asset) => {
    counts[asset.instrument_type] = (counts[asset.instrument_type] ?? 0) + 1;
    return counts;
  }, {});
}

function safeSourcePath(inputPath, cwd) {
  const relativePath = path.relative(cwd, inputPath).replaceAll("\\", "/");

  return relativePath.startsWith("..") ? "external-local-json" : relativePath;
}

function resolvePathInsideCwd(cwd, requestedPath, label) {
  const resolvedPath = path.resolve(cwd, requestedPath);
  const relativePath = path.relative(cwd, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the current workspace.`);
  }

  return resolvedPath;
}

export function buildStaticExportSampleFromSnapshot(rawSnapshot, options = {}) {
  const sampleSize = Math.min(options.sampleSize ?? DEFAULT_SAMPLE_SIZE, DEFAULT_SAMPLE_SIZE);
  const rawAssets = parseSnapshot(rawSnapshot);
  const assetForBdbManifest = getAssetForBdbManifest(rawSnapshot);

  assertInputLimits(
    {
      bytes: options.inputBytes ?? JSON.stringify(rawSnapshot).length,
      assetsLength: rawAssets.length
    },
    options
  );
  assertAssetForBdbManifest(rawSnapshot, options);

  const normalizedAssets = rawAssets.map(normalizeAsset);
  const sample = selectSample(normalizedAssets, sampleSize);
  const availableTypes = new Set(normalizedAssets.map((asset) => asset.instrument_type));
  const sampleTypes = new Set(sample.map((asset) => asset.instrument_type));

  for (const instrumentType of INSTRUMENT_TYPES) {
    if (availableTypes.has(instrumentType) && !sampleTypes.has(instrumentType)) {
      throw new Error(`Sample lost available instrument type: ${instrumentType}`);
    }
  }

  return {
    source: {
      dataset_id: `${asString(rawSnapshot.dataset_id, asString(assetForBdbManifest?.source, "unknown-static-snapshot"))}.sample`,
      version: asString(rawSnapshot.version, asString(assetForBdbManifest?.generated_at, "unknown")),
      schema_version: asString(assetForBdbManifest?.schema_version),
      source_path: options.sourcePath ?? "local-json",
      source_total_assets: rawAssets.length,
      sample_size: sample.length,
      sample_note: "Muestra estatica controlada preparada por intake local dry-run por defecto."
    },
    sample,
    summary: {
      source_total_assets: rawAssets.length,
      sample_size: sample.length,
      input_counts_by_type: countByInstrumentType(normalizedAssets),
      sample_counts_by_type: countByInstrumentType(sample)
    }
  };
}

function renderTypeScriptModule(result) {
  return `import type {
  BdbOfficialMetricsEnvelope,
  BdbPmsExposure,
  BdbQualityFlag,
  EconomicAssetClass,
  InstrumentType
} from "../types/bdbAssets";

export interface BbddActivosStaticExportSampleAsset {
  asset_id: string;
  name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  isin?: string;
  ticker?: string;
  provider?: string;
  currency: string;
  coverage_status: "COVERED" | "UNCOVERED" | "UNKNOWN";
  region?: string;
  market?: string;
  category?: string;
  benchmark?: string;
  ongoing_charge?: number;
  latest_value?: number;
  ytd_return?: number;
  latest_value_date?: string;
  volatility_3y?: number;
  sharpe_3y?: number;
  annualized_return_3y?: number;
  max_drawdown_5y?: number;
  risk_score?: number;
  official_metrics_envelope?: BdbOfficialMetricsEnvelope;
  pms_exposure?: BdbPmsExposure;
  is_investable?: boolean;
  role?: "INVESTABLE" | "BENCHMARK";
  quality_flags?: BdbQualityFlag[];
  available_sections: string[];
  source_note: string;
}

export const BBDD_STATIC_EXPORT_SAMPLE_SOURCE = ${JSON.stringify(result.source, null, 2)} as const;

export const bbddActivosStaticExportSample: BbddActivosStaticExportSampleAsset[] = ${JSON.stringify(result.sample, null, 2)};
`;
}

function extractJsonAssignment(moduleText, exportName, suffix) {
  const marker = `export const ${exportName}`;
  const markerIndex = moduleText.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error(`Generated module is missing ${exportName}.`);
  }

  const assignmentIndex = moduleText.indexOf("=", markerIndex);
  const suffixIndex = moduleText.indexOf(suffix, assignmentIndex);

  if (assignmentIndex < 0 || suffixIndex < 0) {
    throw new Error(`Generated module has invalid ${exportName} syntax.`);
  }

  return moduleText.slice(assignmentIndex + 1, suffixIndex).trim();
}

export function parseStaticExportGeneratedModule(moduleText) {
  return {
    source: JSON.parse(
      extractJsonAssignment(moduleText, "BBDD_STATIC_EXPORT_SAMPLE_SOURCE", " as const;")
    ),
    sample: JSON.parse(
      extractJsonAssignment(
        moduleText,
        "bbddActivosStaticExportSample: BbddActivosStaticExportSampleAsset[]",
        ";\n"
      )
    )
  };
}

export function validateStaticExportGeneratedModule(moduleText, options = {}) {
  const maxInputAssets = options.maxInputAssets ?? MAX_INPUT_ASSETS;
  const maxSampleSize = options.maxSampleSize ?? DEFAULT_SAMPLE_SIZE;
  const { source, sample } = parseStaticExportGeneratedModule(moduleText);

  if (!isRecord(source)) {
    throw new Error("Generated module source must be an object.");
  }
  if (!Array.isArray(sample)) {
    throw new Error("Generated module sample must be an array.");
  }
  if (sample.length > maxSampleSize) {
    throw new Error(`Generated sample is too large: ${sample.length}, max ${maxSampleSize}.`);
  }
  if (typeof source.source_total_assets !== "number" || source.source_total_assets > maxInputAssets) {
    throw new Error("Generated source_total_assets exceeds the allowed intake limit.");
  }

  const sampleTypes = new Set();

  for (const asset of sample) {
    if (!isRecord(asset)) {
      throw new Error("Every generated sample asset must be an object.");
    }
    if (!asString(asset.asset_id) || !asString(asset.name)) {
      throw new Error("Every generated sample asset must include asset_id and name.");
    }
    normalizeInstrumentType(asset.instrument_type);
    normalizeEconomicAssetClass(asset.economic_asset_class);
    normalizeCoverageStatus(asset.coverage_status, asset.instrument_type);

    if (!asString(asset.currency)) {
      throw new Error("Every generated sample asset must include currency.");
    }
    if (!Array.isArray(asset.available_sections)) {
      throw new Error("Every generated sample asset must include available_sections.");
    }
    if (!asString(asset.source_note)) {
      throw new Error("Every generated sample asset must include source_note.");
    }
    if (asset.instrument_type === "INDEX") {
      if (
        asset.category !== "Benchmark"
        || !asset.available_sections.includes("proxy_note")
        || asset.is_investable !== false
        || asset.role !== "BENCHMARK"
        || !Array.isArray(asset.quality_flags)
        || !asset.quality_flags.includes("NON_INVESTABLE_BENCHMARK")
      ) {
        throw new Error("Generated INDEX assets must remain benchmark-shaped references.");
      }
    }

    sampleTypes.add(asset.instrument_type);
  }

  for (const instrumentType of INSTRUMENT_TYPES) {
    if (!sampleTypes.has(instrumentType)) {
      throw new Error(`Generated sample is missing required instrument type: ${instrumentType}`);
    }
  }

  return { source, sample };
}

export function runStaticExportSampleIntake(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = path.resolve(cwd, options.inputPath ?? DEFAULT_INPUT_PATH);
  const outputPath = path.resolve(cwd, options.outputPath ?? DEFAULT_OUTPUT_PATH);
  const inputStat = fs.statSync(inputPath);
  const rawSnapshot = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const result = buildStaticExportSampleFromSnapshot(rawSnapshot, {
    inputBytes: inputStat.size,
    sampleSize: options.sampleSize,
    sourcePath: safeSourcePath(inputPath, cwd),
    maxInputBytes: options.maxInputBytes,
    maxInputAssets: options.maxInputAssets
  });

  if (options.write) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, renderTypeScriptModule(result));
  }

  return {
    ...result,
    input_path: safeSourcePath(inputPath, cwd),
    output_path: safeSourcePath(outputPath, cwd),
    wrote: Boolean(options.write)
  };
}

export function runStaticExportSamplePromotion(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const generatedPath = resolvePathInsideCwd(
    cwd,
    options.generatedPath ?? DEFAULT_OUTPUT_PATH,
    "Generated sample path"
  );
  const targetPath = resolvePathInsideCwd(
    cwd,
    options.targetPath ?? DEFAULT_PROMOTED_SAMPLE_PATH,
    "Promoted sample path"
  );

  if (generatedPath === targetPath) {
    throw new Error("Generated sample path and promoted sample path must be different.");
  }
  if (!fs.existsSync(generatedPath)) {
    throw new Error(`Generated sample does not exist: ${safeSourcePath(generatedPath, cwd)}.`);
  }

  const generatedText = fs.readFileSync(generatedPath, "utf8");
  const validation = validateStaticExportGeneratedModule(generatedText, {
    maxInputAssets: options.maxInputAssets,
    maxSampleSize: options.maxSampleSize
  });

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, generatedText);

  return {
    generated_path: safeSourcePath(generatedPath, cwd),
    promoted_path: safeSourcePath(targetPath, cwd),
    promoted: true,
    source: validation.source,
    summary: {
      source_total_assets: validation.source.source_total_assets,
      sample_size: validation.sample.length,
      sample_counts_by_type: countByInstrumentType(validation.sample)
    }
  };
}

function readCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--promote") {
      options.promote = true;
    } else if (arg === "--input") {
      options.inputPath = argv[index + 1];
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = argv[index + 1];
      index += 1;
    } else if (arg === "--generated") {
      options.generatedPath = argv[index + 1];
      index += 1;
    } else if (arg === "--target") {
      options.targetPath = argv[index + 1];
      index += 1;
    } else if (arg === "--sample-size") {
      options.sampleSize = Number(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function printPreview(result) {
  console.log(
    JSON.stringify(
      {
        mode: result.wrote ? "WRITE" : "DRY_RUN",
        input_path: result.input_path,
        output_path: result.output_path,
        wrote: result.wrote,
        source: result.source,
        summary: result.summary
      },
      null,
      2
    )
  );
}

function printPromotion(result) {
  console.log(
    JSON.stringify(
      {
        mode: "PROMOTE",
        generated_path: result.generated_path,
        promoted_path: result.promoted_path,
        promoted: result.promoted,
        source: result.source,
        summary: result.summary
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = readCliOptions(process.argv.slice(2));

    if (options.promote) {
      printPromotion(runStaticExportSamplePromotion(options));
    } else {
      printPreview(runStaticExportSampleIntake(options));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
