import { describe, expect, test } from "vitest";
import {
  buildStaticExportManualPortfolioSummary,
  buildStaticExportManualPortfolioReport,
  buildStaticExportOptimizationInput,
  getAssetsFromBbddStaticExportSample,
  getStaticExportAssetDetail,
  getStaticExportComparableAssets,
  getStaticExportPortfolioInputs,
  searchAssetsFromBbddStaticExportSample
} from "../src/adapters/bbddActivosStaticExportAdapter";
import {
  bbddActivosStaticExportSample,
  BBDD_STATIC_EXPORT_SAMPLE_SOURCE
} from "../src/data/bbddActivosStaticExportSample";
import type { InstrumentType } from "../src/types/bdbAssets";

const sampleIds = {
  fund: "LU0996182563",
  etf: "IE00B1XNHC34",
  stock: "US0378331005",
  index: "GSPC_INDEX"
} as const;

const forbiddenPayloadStrings = [
  ["funds", "_v3"].join(""),
  ["historico", "_vl_v2"].join(""),
  ["Fire", "store"].join(""),
  ["Fire", "base"].join(""),
  ["service", "Account"].join(""),
  ["private", "_key"].join(""),
  ["creden", "tial"].join(""),
  ["retro", "cession"].join(""),
  ["std", "_perf"].join(""),
  ["std", "_perf_norm"].join(""),
  ["local", "Storage"].join(""),
  ["session", "Storage"].join("")
];

function expectNoForbiddenPayloadStrings(payload: unknown): void {
  const serialized = JSON.stringify(payload);

  for (const forbidden of forbiddenPayloadStrings) {
    expect(serialized).not.toContain(forbidden);
  }
}

describe("BBDD-ACTIVOS static export sample adapter", () => {
  test("keeps a small controlled sample from the read-only static snapshot", () => {
    expect(BBDD_STATIC_EXPORT_SAMPLE_SOURCE.source_total_assets).toBe(16);
    expect(BBDD_STATIC_EXPORT_SAMPLE_SOURCE.schema_version).toBe("asset-for-bdb.v1");
    expect(BBDD_STATIC_EXPORT_SAMPLE_SOURCE.sample_size).toBe(16);
    expect(bbddActivosStaticExportSample).toHaveLength(16);
  });

  test("contains FUND ETF STOCK and INDEX assets", async () => {
    const assets = await getAssetsFromBbddStaticExportSample();
    const instrumentTypes = new Set(assets.map((asset) => asset.instrument_type));

    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK", "INDEX"]));
  });

  test("search supports text and instrument filters", async () => {
    const searchByText = await searchAssetsFromBbddStaticExportSample({ query: "Vanguard" });
    const stocks = await searchAssetsFromBbddStaticExportSample({ instrumentTypes: ["STOCK"] });
    const indexes = await searchAssetsFromBbddStaticExportSample({ instrumentTypes: ["INDEX"] });

    expect(searchByText.length).toBeGreaterThan(0);
    expect(stocks).toHaveLength(4);
    expect(stocks.every((asset) => asset.instrument_type === "STOCK")).toBe(true);
    expect(indexes).toHaveLength(2);
  });

  test("detail keeps STOCK without requiring costs", async () => {
    const stock = await getStaticExportAssetDetail(sampleIds.stock);

    expect(stock?.instrument_type).toBe("STOCK");
    expect(stock?.economic_asset_class).toBe("EQUITY");
    expect(stock?.costs).toBeUndefined();
    expect(stock?.metrics.annualized_return_3y).toBeDefined();
  });

  test("keeps AssetForBdb pms real asset channel separate from other exposure", async () => {
    const assets = await getAssetsFromBbddStaticExportSample();

    expect(assets.every((asset) => asset.economic_asset_class !== "REAL_ASSET" || asset.pms_exposure.real_asset !== undefined)).toBe(true);
  });

  test("maps optional official metrics envelope to detail without feeding current calculations", async () => {
    const detail = await getStaticExportAssetDetail(sampleIds.fund);
    const searchResults = await searchAssetsFromBbddStaticExportSample({ query: sampleIds.fund });
    const optimizationInput = await buildStaticExportOptimizationInput({
      positions: [{ asset_id: sampleIds.fund, weight: 1 }]
    });
    const summary = await buildStaticExportManualPortfolioSummary([
      { asset_id: sampleIds.fund, weight_percent: 100 }
    ]);

    expect(detail).not.toBeNull();
    if (!detail?.official_metrics_envelope) {
      throw new Error("Expected sample fund detail to carry an official metrics envelope fixture.");
    }

    const envelope = detail.official_metrics_envelope;

    expect(envelope.source).toBe("BBDD_ACTIVOS");
    expect(["OFFICIAL_READ_MODEL", "FUTURE_API"]).toContain(envelope.mode);
    expect(envelope.mode).toBe("OFFICIAL_READ_MODEL");
    expect(envelope.suitability_allowed).toBe(false);
    expect(envelope.optimization_allowed).toBe(false);
    expect(envelope.recommendation_allowed).toBe(false);
    expect("official_metrics_envelope" in searchResults[0]).toBe(false);
    expect(optimizationInput.assets[0]).not.toHaveProperty("official_metrics_envelope");
    expect(summary.weighted_metrics.preview_boundary.mode).toBe("PREVIEW_ONLY");
    expect(summary.weighted_metrics.annualized_return_3y).toBe(detail.metrics.annualized_return_3y);
    expect(summary.weighted_metrics.annualized_return_3y).not.toBe(
      envelope.official_performance?.annualized_return_3y
    );
  });

  test("INDEX remains benchmark and non-investable", async () => {
    const index = await getStaticExportAssetDetail(sampleIds.index);

    expect(index?.instrument_type).toBe("INDEX");
    expect(index?.role).toBe("BENCHMARK");
    expect(index?.is_investable).toBe(false);
    expect(index?.quality_flags).toContain("NON_INVESTABLE_BENCHMARK");
  });

  test("comparison and portfolio inputs work with static sample assets", async () => {
    const comparableAssets = await getStaticExportComparableAssets([
      sampleIds.fund,
      sampleIds.etf,
      sampleIds.stock,
      sampleIds.index
    ]);
    const portfolioDraft = await getStaticExportPortfolioInputs({
      positions: [
        { asset_id: sampleIds.fund, weight: 0.4 },
        { asset_id: sampleIds.etf, weight: 0.3 },
        { asset_id: sampleIds.stock, weight: 0.3 }
      ]
    });

    expect(comparableAssets).toHaveLength(4);
    expect(portfolioDraft.positions).toHaveLength(3);
    expect(portfolioDraft.warnings).toEqual([]);
  });

  test("buildOptimizationInput excludes non-investable INDEX positions", async () => {
    const input = await buildStaticExportOptimizationInput({
      positions: [
        { asset_id: sampleIds.etf, weight: 0.7 },
        { asset_id: sampleIds.index, weight: 0.3 }
      ]
    });

    expect(input.positions).toHaveLength(1);
    expect(input.source).toBe("BBDD_STATIC_EXPORT_SAMPLE");
    expect(input.positions[0].asset_id).toBe(sampleIds.etf);
    expect(input.assets.every((asset) => asset.is_investable)).toBe(true);
    expect(input.warnings.some((warning) => warning.code === "NON_INVESTABLE_BENCHMARK")).toBe(true);
  });

  test("portfolio report works without persistence", async () => {
    const report = await buildStaticExportManualPortfolioReport([
      { asset_id: sampleIds.fund, weight_percent: 40 },
      { asset_id: sampleIds.etf, weight_percent: 30 },
      { asset_id: sampleIds.stock, weight_percent: 30 }
    ]);

    expect(report.positions).toHaveLength(3);
    expect(report.mode).toBe("BBDD_STATIC_EXPORT_SAMPLE");
    expect(report.summary.source).toBe("BBDD_STATIC_EXPORT_SAMPLE");
    expect(report.summary.validation_status).toBe("VALID");
    expect(report.portfolio_name).toContain("export estatico");
  });

  test("portfolio report includes local data diagnostic for enriched positions", async () => {
    const report = await buildStaticExportManualPortfolioReport([
      { asset_id: sampleIds.fund, weight_percent: 40 },
      { asset_id: sampleIds.etf, weight_percent: 30 },
      { asset_id: sampleIds.stock, weight_percent: 30 }
    ]);

    expect(report.data_diagnostic.investable_positions).toBe(3);
    expect(report.data_diagnostic.excluded_non_investable_positions).toBe(0);
    expect(report.data_diagnostic.enriched_positions).toBe(3);
    expect(report.data_diagnostic.performance_preview_available).toBe(3);
    expect(report.data_diagnostic.data_quality_summary_available).toBe(3);
    expect(report.data_diagnostic.partial_or_warning_positions).toBeGreaterThan(0);
    expect(report.data_diagnostic.quality_flags.some((item) => item.flag === "MISSING_HOLDINGS")).toBe(true);
    expect(report.data_diagnostic.local_only_notice).toContain("no evalúa idoneidad");
  });

  test("portfolio report includes enriched local X-Ray for the static sample", async () => {
    const report = await buildStaticExportManualPortfolioReport([
      { asset_id: sampleIds.fund, weight_percent: 40 },
      { asset_id: sampleIds.etf, weight_percent: 30 },
      { asset_id: sampleIds.stock, weight_percent: 30 }
    ]);
    const byInstrument = new Map(report.xray.by_instrument_type.map((bucket) => [bucket.key, bucket.weight_percent]));
    const byCurrency = new Map(report.xray.by_currency.map((bucket) => [bucket.key, bucket.weight_percent]));
    const byCategory = new Map(report.xray.by_category.map((bucket) => [bucket.key, bucket.weight_percent]));

    expect(report.xray.total_positions).toBe(3);
    expect(report.xray.investable_positions).toBe(3);
    expect(report.xray.performance_preview_available).toBe(3);
    expect(report.xray.data_quality_summary_available).toBe(3);
    expect(report.xray.coverage_complete_positions).toBeGreaterThan(0);
    expect(report.xray.position_concentration).toHaveLength(3);
    expect(report.xray.top_position?.weight_percent).toBe(40);
    expect(report.xray.concentration_level).toBe("WATCH");
    expect(byInstrument.get("FUND")).toBe(40);
    expect(byInstrument.get("ETF")).toBe(30);
    expect(byInstrument.get("STOCK")).toBe(30);
    expect(byCurrency.get("EUR")).toBe(70);
    expect(byCurrency.get("USD")).toBe(30);
    expect(byCategory.size).toBeGreaterThan(0);
    expect(report.xray.pms_exposure_percent.equity).toBeGreaterThan(0);
    expect(report.xray.data_risk_signals.some((signal) => signal.includes("avisos de calidad"))).toBe(true);
    // Ronda 3 (14-10): ninguna señal en inglés; la etiqueta es la de la ficha.
    expect(report.xray.data_risk_signals.join(" ")).not.toContain("performance preview");
  });

  test("portfolio report keeps INDEX as reference without adding it to investable allocation", async () => {
    const report = await buildStaticExportManualPortfolioReport([
      { asset_id: sampleIds.etf, weight_percent: 70 },
      { asset_id: sampleIds.index, weight_percent: 30 }
    ]);

    expect(report.positions.some((position) => position.asset_id === sampleIds.index)).toBe(true);
    expect(report.summary.non_investable_assets).toContain(sampleIds.index);
    expect(report.data_diagnostic.investable_positions).toBe(1);
    expect(report.data_diagnostic.excluded_non_investable_positions).toBe(1);
    expect(report.data_diagnostic.performance_preview_available).toBe(1);
    expect(report.xray.investable_positions).toBe(1);
    expect(report.xray.excluded_non_investable_positions).toBe(1);
    expect(report.xray.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
    expect(report.xray.performance_preview_available).toBe(1);
    expect(report.summary.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
    expect(report.warnings.some((warning) => warning.includes("benchmark/no invertible"))).toBe(true);
  });

  test("serialized payloads do not expose forbidden markers", async () => {
    const payloads = [
      BBDD_STATIC_EXPORT_SAMPLE_SOURCE,
      bbddActivosStaticExportSample,
      await getAssetsFromBbddStaticExportSample(),
      await searchAssetsFromBbddStaticExportSample(),
      await getStaticExportPortfolioInputs(),
      await buildStaticExportOptimizationInput(),
      await buildStaticExportManualPortfolioReport([{ asset_id: sampleIds.etf, weight_percent: 100 }])
    ];

    for (const payload of payloads) {
      expectNoForbiddenPayloadStrings(payload);
    }
  });
});
