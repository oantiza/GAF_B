import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildStaticExportSampleFromSnapshot,
  runStaticExportSampleIntake,
  runStaticExportSamplePromotion,
  validateStaticExportGeneratedModule
} from "../scripts/buildStaticExportSample.mjs";
import { bbddActivosStaticExportSample } from "../src/data/bbddActivosStaticExportSample";

const instrumentTypes = ["FUND", "ETF", "STOCK", "INDEX"] as const;
const blockedAssetForBdbPublicFragments = [
  '"holdings"',
  '"holdings_summary"',
  '"history"',
  '"points"',
  '"positions"',
  '"suitability_inputs"',
  '"recommendation_input"',
  '"recommendation_inputs"',
  '"optimization_allowed":true',
  '"optimization_allowed": true',
  '"suitability_allowed":true',
  '"suitability_allowed": true',
  '"recommendation_allowed":true',
  '"recommendation_allowed": true'
];

function expectNoBlockedAssetForBdbPublicFragments(payload: unknown): void {
  const serialized = JSON.stringify(payload);

  for (const blocked of blockedAssetForBdbPublicFragments) {
    expect(serialized).not.toContain(blocked);
  }
}

function makeAsset(assetId: string, instrumentType: (typeof instrumentTypes)[number]) {
  return {
    asset_id: assetId,
    display_name: `${instrumentType} ${assetId}`,
    asset_type: instrumentType,
    coverage_status: instrumentType === "INDEX" ? "UNKNOWN" : "COVERED",
    classification: {
      asset_class: instrumentType === "ETF" ? "FIXED_INCOME" : "EQUITY",
      region: instrumentType === "INDEX" ? "Global" : "Europe",
      currency: instrumentType === "STOCK" ? "USD" : "EUR",
      market: instrumentType === "INDEX" ? "INDX" : "XETR"
    },
    available_sections: instrumentType === "INDEX" ? ["summary", "proxy_note"] : ["summary"],
    summary: {
      provider: instrumentType === "INDEX" ? undefined : "Example",
      benchmark: instrumentType === "INDEX" ? "Example Index" : "Example Benchmark",
      category: instrumentType === "INDEX" ? undefined : "Example Category",
      ter_pct: instrumentType === "FUND" || instrumentType === "ETF" ? 0.2 : undefined
    },
    mock_metrics: {
      latest_value: 100,
      ytd_return: instrumentType === "STOCK" ? 0.04 : 4,
      latest_value_date: "2026-06-18"
    }
  };
}

function makeSnapshot(assetCountByType = { FUND: 5, ETF: 5, STOCK: 4, INDEX: 2 }) {
  return {
    dataset_id: "test-static-snapshot",
    version: "2026-06-18",
    assets: instrumentTypes.flatMap((instrumentType) =>
      Array.from({ length: assetCountByType[instrumentType] }, (_, index) =>
        makeAsset(`${instrumentType.toLowerCase()}_${index + 1}`, instrumentType)
      )
    )
  };
}

function makeAssetForBdbSnapshot() {
  return {
    manifest: {
      schema_version: "asset-for-bdb.v1",
      generated_at: "2026-06-20T00:00:00.000Z",
      source: "BDB_ACL_MOCK_PREVIEW",
      total_assets: 4,
      counts_by_instrument_type: {
        FUND: 1,
        ETF: 1,
        STOCK: 1,
        INDEX: 1
      },
      max_size_policy: {
        max_assets: 250,
        max_bytes: 250000,
        holdings: "SUMMARY_ONLY",
        history: "EXCLUDED",
        runtime_imports: "NONE",
        external_reads: 0,
        external_writes: 0
      },
      warnings: []
    },
    assets: [
      {
        asset_id: "asset_for_bdb_fund",
        instrument_type: "FUND",
        economic_asset_class: "FIXED_INCOME",
        identity: {
          display_name: "AssetForBdb Bond Fund",
          isin: "LU0000000001",
          currency: "EUR"
        },
        product: {
          provider: "Mock AM",
          product_type: "Mutual Fund"
        },
        classification: {
          asset_class: "FIXED_INCOME",
          category: "Global Bonds",
          region: "Global"
        },
        costs: {
          ongoing_charge: 0.008
        },
        performance_preview: {
          latest_value: 101.25,
          ytd_return: 0.019,
          latest_value_date: "2026-06-20",
          annualized_return_3y: 0.024,
          volatility_3y: 0.061,
          sharpe_3y: 0.31,
          max_drawdown_5y: -0.092,
          risk_score: 3,
          source: "MOCK",
          data_quality: "MOCK_PROXY"
        },
        metrics: {
          annualized_return_3y: 0.024,
          volatility_3y: 0.061,
          sharpe_3y: 0.31,
          max_drawdown_5y: -0.092,
          risk_score: 3,
          source: "MOCK"
        },
        official_metrics_envelope: {
          mode: "OFFICIAL_READ_MODEL",
          source: "BBDD_ACTIVOS",
          as_of_date: "2026-06-20",
          calculation_policy: "BBDD_ACTIVOS_OFFICIAL_METRICS_CANARY_V1",
          data_quality: {
            status: "PARTIAL",
            flags: ["CANARY_ONLY"],
            warnings: ["Official metrics canary for BDB-ACTIVOS contract validation only"]
          },
          official_metrics: {
            risk_score: 2
          },
          official_performance: {
            annualized_return_3y: 0.999,
            ytd_return: 0.888
          },
          official_risk: {
            volatility_3y: 0.777,
            sharpe_3y: 0.666,
            max_drawdown_5y: -0.555
          },
          official_costs: {
            ongoing_charge: 0.004,
            management_fee: 0.003
          },
          suitability_allowed: false,
          optimization_allowed: false,
          recommendation_allowed: false
        },
        pms_exposure: {
          equity: 0,
          fixed_income: 0.92,
          cash: 0.05,
          alternative: 0,
          real_asset: 0,
          other: 0.03,
          source: "MOCK"
        },
        holdings_summary: {
          has_holdings: false,
          full_holdings_loaded: false
        },
        holdings: [{ name: "Should not be exported", weight: 1 }],
        history_available_years: [2025, 2026],
        history: {
          points: [{ date: "2026-01-01", value: 100 }]
        },
        available_sections: ["summary", "performance_preview", "risk_snapshot", "portfolio_summary"],
        data_quality_summary: {
          has_metrics: true,
          has_pms_exposure: true
        },
        suitability_inputs: {
          risk_score: 3
        },
        recommendation_input: {
          allowed: true
        },
        optimization_allowed: true,
        coverage_status: "PARTIAL",
        is_investable: true,
        role: "INVESTABLE",
        quality_flags: ["MOCK_DATA", "MISSING_HOLDINGS", "PARTIAL_COVERAGE"]
      },
      {
        asset_id: "asset_for_bdb_etf",
        instrument_type: "ETF",
        economic_asset_class: "EQUITY",
        identity: {
          display_name: "AssetForBdb Equity ETF",
          isin: "IE0000000002",
          ticker: "XBDB",
          currency: "EUR"
        },
        product: {
          provider: "Mock ETF",
          product_type: "UCITS ETF"
        },
        classification: {
          asset_class: "EQUITY",
          category: "Global Equity",
          region: "Global"
        },
        costs: {
          ongoing_charge: 0.0015
        },
        performance_preview: {
          latest_value: 55.5,
          ytd_return: 0.058,
          latest_value_date: "2026-06-20",
          sharpe_3y: 0.45,
          max_drawdown_5y: -0.12,
          source: "MOCK",
          data_quality: "MOCK_PROXY"
        },
        metrics: {
          annualized_return_3y: 0.061,
          volatility_3y: 0.142,
          risk_score: 5,
          source: "MOCK"
        },
        pms_exposure: {
          equity: 0.96,
          fixed_income: 0,
          cash: 0.04,
          alternative: 0,
          real_asset: 0,
          other: 0,
          source: "MOCK"
        },
        holdings_summary: {
          has_holdings: true,
          positions_count: 58,
          full_holdings_loaded: false
        },
        available_sections: ["summary", "performance_preview", "risk_snapshot"],
        history_available_years: [2024, 2025, 2026],
        coverage_status: "COMPLETE",
        is_investable: true,
        role: "INVESTABLE",
        quality_flags: ["MOCK_DATA"]
      },
      {
        asset_id: "asset_for_bdb_stock",
        instrument_type: "STOCK",
        economic_asset_class: "EQUITY",
        identity: {
          display_name: "AssetForBdb Stock",
          isin: "US0000000003",
          ticker: "BDB",
          currency: "USD"
        },
        product: {
          provider: "NASDAQ",
          product_type: "Listed Equity"
        },
        classification: {
          asset_class: "EQUITY",
          category: "Technology",
          region: "United States"
        },
        metrics: {
          annualized_return_3y: 0.129,
          volatility_3y: 0.241,
          risk_score: 6,
          source: "MOCK"
        },
        performance_preview: {
          latest_value: 42.5,
          ytd_return: 0.071,
          latest_value_date: "2026-06-20",
          source: "MOCK",
          data_quality: "MOCK_PROXY"
        },
        pms_exposure: {
          equity: 1,
          fixed_income: 0,
          cash: 0,
          alternative: 0,
          real_asset: 0,
          other: 0,
          source: "MOCK"
        },
        holdings_summary: {
          has_holdings: false,
          full_holdings_loaded: false
        },
        available_sections: ["summary", "performance_preview", "identity", "listing", "metrics"],
        history_available_years: [2025, 2026],
        coverage_status: "PARTIAL",
        is_investable: true,
        role: "INVESTABLE",
        quality_flags: ["MOCK_DATA", "MISSING_HOLDINGS", "PARTIAL_COVERAGE"]
      },
      {
        asset_id: "asset_for_bdb_index",
        instrument_type: "INDEX",
        economic_asset_class: "EQUITY",
        identity: {
          display_name: "AssetForBdb Index Benchmark",
          ticker: "BDBI",
          currency: "USD"
        },
        product: {
          provider: "Mock Index Provider",
          product_type: "Benchmark Index"
        },
        classification: {
          asset_class: "EQUITY",
          category: "Large Cap Equity Index",
          region: "United States"
        },
        metrics: {
          annualized_return_3y: 0.108,
          volatility_3y: 0.158,
          risk_score: 5,
          source: "MOCK"
        },
        performance_preview: {
          latest_value: 5100,
          ytd_return: 0.108,
          latest_value_date: "2026-06-20",
          source: "MOCK",
          data_quality: "MOCK_PROXY"
        },
        pms_exposure: {
          equity: 1,
          fixed_income: 0,
          cash: 0,
          alternative: 0,
          real_asset: 0,
          other: 0,
          source: "MOCK"
        },
        holdings_summary: {
          has_holdings: false,
          full_holdings_loaded: false
        },
        available_sections: ["summary", "performance_preview", "risk_snapshot", "proxy_note"],
        history_available_years: [],
        coverage_status: "ROOT_ONLY",
        is_investable: false,
        role: "BENCHMARK",
        quality_flags: ["MOCK_DATA", "NON_INVESTABLE_BENCHMARK", "MISSING_HISTORY", "PARTIAL_COVERAGE"]
      }
    ]
  };
}

describe("static export sample intake", () => {
  test("builds a small deterministic multi-asset sample", () => {
    const result = buildStaticExportSampleFromSnapshot(makeSnapshot(), { sampleSize: 16 });
    const sampleTypes = new Set(result.sample.map((asset) => asset.instrument_type));

    expect(result.sample).toHaveLength(16);
    expect(sampleTypes).toEqual(new Set(instrumentTypes));
    expect(result.summary.sample_counts_by_type).toEqual({
      FUND: 5,
      ETF: 5,
      STOCK: 4,
      INDEX: 2
    });
  });

  test("keeps INDEX as benchmark-shaped input for the app adapter", () => {
    const result = buildStaticExportSampleFromSnapshot(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 }));
    const indexAsset = result.sample.find((asset) => asset.instrument_type === "INDEX");

    expect(indexAsset?.coverage_status).toBe("UNKNOWN");
    expect(indexAsset?.category).toBe("Benchmark");
    expect(indexAsset?.available_sections).toContain("proxy_note");
  });

  test("accepts official AssetForBdb static export v1 without runtime imports", () => {
    const result = buildStaticExportSampleFromSnapshot(makeAssetForBdbSnapshot(), { sampleSize: 4 });
    const indexAsset = result.sample.find((asset) => asset.instrument_type === "INDEX");
    const stockAsset = result.sample.find((asset) => asset.instrument_type === "STOCK");
    const etfAsset = result.sample.find((asset) => asset.instrument_type === "ETF");
    const officialEnvelopeAssets = result.sample.filter((asset) => asset.official_metrics_envelope);

    expect(result.source.schema_version).toBe("asset-for-bdb.v1");
    expect(result.source.version).toBe("2026-06-20T00:00:00.000Z");
    expect(result.source.source_total_assets).toBe(4);
    expect(result.source.sample_size).toBe(4);
    expect(result.summary.input_counts_by_type).toEqual({
      FUND: 1,
      ETF: 1,
      STOCK: 1,
      INDEX: 1
    });
    expect(result.summary.sample_counts_by_type).toEqual({
      FUND: 1,
      ETF: 1,
      STOCK: 1,
      INDEX: 1
    });
    expect(indexAsset?.role).toBe("BENCHMARK");
    expect(indexAsset?.is_investable).toBe(false);
    expect(indexAsset?.category).toBe("Benchmark");
    expect(indexAsset?.available_sections).toContain("proxy_note");
    expect(indexAsset?.quality_flags).toContain("NON_INVESTABLE_BENCHMARK");
    expect(stockAsset?.ongoing_charge).toBeUndefined();
    expect(stockAsset?.latest_value).toBe(42.5);
    expect(stockAsset?.ytd_return).toBe(0.071);
    expect(stockAsset?.latest_value_date).toBe("2026-06-20");
    expect(stockAsset?.risk_score).toBe(6);
    expect(stockAsset?.pms_exposure?.equity).toBe(1);
    expect(etfAsset?.latest_value).toBe(55.5);
    expect(etfAsset?.sharpe_3y).toBe(0.45);
    expect(etfAsset?.max_drawdown_5y).toBe(-0.12);
    expect(etfAsset?.available_sections).toContain("performance_preview");
    expect(officialEnvelopeAssets.map((asset) => asset.asset_id)).toEqual(["asset_for_bdb_fund"]);
    expect(officialEnvelopeAssets[0].official_metrics_envelope).toMatchObject({
      mode: "OFFICIAL_READ_MODEL",
      source: "BBDD_ACTIVOS",
      calculation_policy: "BBDD_ACTIVOS_OFFICIAL_METRICS_CANARY_V1",
      suitability_allowed: false,
      optimization_allowed: false,
      recommendation_allowed: false
    });
    expectNoBlockedAssetForBdbPublicFragments(result);
  });

  test("rejects invalid AssetForBdb manifest counts and unsafe policy", () => {
    const invalidCounts = makeAssetForBdbSnapshot();
    invalidCounts.manifest.counts_by_instrument_type.STOCK = 2;

    expect(() => buildStaticExportSampleFromSnapshot(invalidCounts, { sampleSize: 4 })).toThrow("count mismatch");

    const invalidPolicy = makeAssetForBdbSnapshot();
    invalidPolicy.manifest.max_size_policy.runtime_imports = "BDB-ACTIVOS";

    expect(() => buildStaticExportSampleFromSnapshot(invalidPolicy, { sampleSize: 4 })).toThrow("no runtime imports");

    const unsafeHoldingsPolicy = makeAssetForBdbSnapshot();
    unsafeHoldingsPolicy.manifest.max_size_policy.holdings = "FULL";

    expect(() => buildStaticExportSampleFromSnapshot(unsafeHoldingsPolicy, { sampleSize: 4 })).toThrow(
      "summary-only holdings"
    );

    const unsafeHistoryPolicy = makeAssetForBdbSnapshot();
    unsafeHistoryPolicy.manifest.max_size_policy.history = "INCLUDED";

    expect(() => buildStaticExportSampleFromSnapshot(unsafeHistoryPolicy, { sampleSize: 4 })).toThrow(
      "excluded history"
    );

    const unsafeReadsPolicy = makeAssetForBdbSnapshot();
    unsafeReadsPolicy.manifest.max_size_policy.external_reads = 1;

    expect(() => buildStaticExportSampleFromSnapshot(unsafeReadsPolicy, { sampleSize: 4 })).toThrow(
      "no runtime imports"
    );

    const unsafeWritesPolicy = makeAssetForBdbSnapshot();
    unsafeWritesPolicy.manifest.max_size_policy.external_writes = 1;

    expect(() => buildStaticExportSampleFromSnapshot(unsafeWritesPolicy, { sampleSize: 4 })).toThrow(
      "no runtime imports"
    );

    const unsafeOfficialMetricsPolicy = makeAssetForBdbSnapshot();
    unsafeOfficialMetricsPolicy.assets[0].official_metrics_envelope!.optimization_allowed = true;

    expect(() => buildStaticExportSampleFromSnapshot(unsafeOfficialMetricsPolicy, { sampleSize: 4 })).toThrow(
      "official_metrics_envelope canary"
    );
  });

  test("the consumed static sample keeps FUND ETF STOCK and INDEX importable", () => {
    const sampleTypes = new Set(bbddActivosStaticExportSample.map((asset) => asset.instrument_type));
    const indexAsset = bbddActivosStaticExportSample.find((asset) => asset.instrument_type === "INDEX");

    expect(sampleTypes).toEqual(new Set(instrumentTypes));
    expect(indexAsset?.category).toBe("Benchmark");
    expect(indexAsset?.available_sections).toContain("proxy_note");
  });

  test("rejects invalid input structure", () => {
    expect(() => buildStaticExportSampleFromSnapshot({ dataset_id: "invalid" })).toThrow("assets array");
  });

  test("rejects inputs with too many assets", () => {
    expect(() =>
      buildStaticExportSampleFromSnapshot(makeSnapshot({ FUND: 251, ETF: 0, STOCK: 0, INDEX: 0 }), {
        maxInputAssets: 250
      })
    ).toThrow("too many assets");
  });

  test("rejects inputs that exceed byte limits", () => {
    expect(() =>
      buildStaticExportSampleFromSnapshot(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 }), {
        inputBytes: 1_001,
        maxInputBytes: 1_000
      })
    ).toThrow("too large");
  });

  test("dry-run does not write output files by default", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-static-intake-"));
    const inputPath = path.join(tempDir, "input.json");
    const outputPath = path.join(tempDir, "generated.ts");

    fs.writeFileSync(inputPath, JSON.stringify(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 })));

    const result = runStaticExportSampleIntake({
      cwd: tempDir,
      inputPath,
      outputPath
    });

    expect(result.wrote).toBe(false);
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(result.sample).toHaveLength(4);
  });

  test("write creates generated output without touching the promoted sample", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-static-intake-"));
    const inputPath = path.join(tempDir, "input.json");
    const generatedPath = path.join(tempDir, "generated.ts");
    const promotedPath = path.join(tempDir, "stable.ts");

    fs.writeFileSync(inputPath, JSON.stringify(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 })));
    fs.writeFileSync(promotedPath, "stable sample");

    const result = runStaticExportSampleIntake({
      cwd: tempDir,
      inputPath,
      outputPath: generatedPath,
      write: true
    });

    expect(result.wrote).toBe(true);
    expect(fs.existsSync(generatedPath)).toBe(true);
    expect(fs.readFileSync(promotedPath, "utf8")).toBe("stable sample");
    expect(validateStaticExportGeneratedModule(fs.readFileSync(generatedPath, "utf8")).sample).toHaveLength(4);
  });

  test("write supports AssetForBdb export without touching the promoted sample", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-asset-for-bdb-intake-"));
    const inputPath = path.join(tempDir, "asset-for-bdb.json");
    const generatedPath = path.join(tempDir, "generated.ts");
    const promotedPath = path.join(tempDir, "stable.ts");

    fs.writeFileSync(inputPath, JSON.stringify(makeAssetForBdbSnapshot()));
    fs.writeFileSync(promotedPath, "stable sample");

    const result = runStaticExportSampleIntake({
      cwd: tempDir,
      inputPath,
      outputPath: generatedPath,
      write: true,
      sampleSize: 4
    });
    const generated = validateStaticExportGeneratedModule(fs.readFileSync(generatedPath, "utf8"));
    const indexAsset = generated.sample.find((asset) => asset.instrument_type === "INDEX");

    expect(result.wrote).toBe(true);
    expect(fs.readFileSync(promotedPath, "utf8")).toBe("stable sample");
    expect(indexAsset?.role).toBe("BENCHMARK");
    expect(indexAsset?.is_investable).toBe(false);
    expect(indexAsset?.quality_flags).toContain("NON_INVESTABLE_BENCHMARK");
    expect(generated.sample.find((asset) => asset.instrument_type === "STOCK")?.latest_value).toBe(42.5);
    expect(generated.sample.filter((asset) => asset.official_metrics_envelope)).toHaveLength(1);
    expectNoBlockedAssetForBdbPublicFragments(generated);
  });

  test("promote copies a valid generated sample over an explicit target", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-static-promote-"));
    const inputPath = path.join(tempDir, "input.json");
    const generatedPath = path.join(tempDir, "generated.ts");
    const promotedPath = path.join(tempDir, "stable.ts");

    fs.writeFileSync(inputPath, JSON.stringify(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 })));
    runStaticExportSampleIntake({
      cwd: tempDir,
      inputPath,
      outputPath: generatedPath,
      write: true
    });

    const result = runStaticExportSamplePromotion({
      cwd: tempDir,
      generatedPath,
      targetPath: promotedPath
    });

    expect(result.promoted).toBe(true);
    expect(fs.readFileSync(promotedPath, "utf8")).toBe(fs.readFileSync(generatedPath, "utf8"));
    expect(result.summary.sample_counts_by_type).toEqual({
      FUND: 1,
      ETF: 1,
      STOCK: 1,
      INDEX: 1
    });
  });

  test("promote requires an existing valid generated sample", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-static-promote-"));
    const generatedPath = path.join(tempDir, "missing.ts");
    const promotedPath = path.join(tempDir, "stable.ts");

    expect(() =>
      runStaticExportSamplePromotion({
        cwd: tempDir,
        generatedPath,
        targetPath: promotedPath
      })
    ).toThrow("does not exist");

    fs.writeFileSync(generatedPath, "export const invalid = true;");

    expect(() =>
      runStaticExportSamplePromotion({
        cwd: tempDir,
        generatedPath,
        targetPath: promotedPath
      })
    ).toThrow("missing BBDD_STATIC_EXPORT_SAMPLE_SOURCE");
    expect(fs.existsSync(promotedPath)).toBe(false);
  });

  test("promote rejects generated samples that exceed intake limits", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdb-static-promote-"));
    const inputPath = path.join(tempDir, "input.json");
    const generatedPath = path.join(tempDir, "generated.ts");
    const promotedPath = path.join(tempDir, "stable.ts");

    fs.writeFileSync(inputPath, JSON.stringify(makeSnapshot({ FUND: 1, ETF: 1, STOCK: 1, INDEX: 1 })));
    runStaticExportSampleIntake({
      cwd: tempDir,
      inputPath,
      outputPath: generatedPath,
      write: true
    });
    fs.writeFileSync(
      generatedPath,
      fs.readFileSync(generatedPath, "utf8").replace('"source_total_assets": 4', '"source_total_assets": 251')
    );

    expect(() =>
      runStaticExportSamplePromotion({
        cwd: tempDir,
        generatedPath,
        targetPath: promotedPath
      })
    ).toThrow("source_total_assets");
    expect(fs.existsSync(promotedPath)).toBe(false);
  });
});
