import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAssetDataSource, getAssetDataSourceMetadata } from "../src/adapters/assetDataSource";
import { AssetComparison } from "../src/components/AssetComparison";
import { buildLocalOptimizationPreview } from "../src/core/optimizationPreview";
import { buildReportFromAssets, buildSummaryFromAssets } from "../src/core/portfolio";
import { buildLocalRiskProfilePreview } from "../src/core/riskProfilePreview";
import type { AssetDataSourceKind } from "../src/types/assetDataSource";
import type {
  BdbAssetDetail,
  BdbMetricsMode,
  BdbOfficialMetricsEnvelope,
  InstrumentType
} from "../src/types/bdbAssets";

const sourceKinds: AssetDataSourceKind[] = ["LOCAL_MOCK", "BBDD_STATIC_EXPORT_SAMPLE"];
const officialEnvelopeSourceFixtures: Array<{ sourceKind: AssetDataSourceKind; assetId: string }> = [
  { sourceKind: "BBDD_STATIC_EXPORT_SAMPLE", assetId: "LU0996182563" }
];
const officialMetricsEnvelopeMarkers = [
  "official_metrics_envelope",
  "OFFICIAL_READ_MODEL",
  "FUTURE_API",
  "official_performance",
  "official_risk",
  "official_costs",
  "suitability_allowed",
  "optimization_allowed",
  "recommendation_allowed"
];

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

function expectNoOfficialMetricsEnvelope(payload: unknown): void {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);

  for (const marker of officialMetricsEnvelopeMarkers) {
    expect(serialized).not.toContain(marker);
  }
}

function withoutOfficialMetricsEnvelope(asset: BdbAssetDetail): BdbAssetDetail {
  const assetWithoutEnvelope = { ...asset };
  delete assetWithoutEnvelope.official_metrics_envelope;
  return assetWithoutEnvelope;
}

describe("asset data source selector", () => {
  test("exposes all local data sources without real connections", () => {
    for (const sourceKind of sourceKinds) {
      const metadata = getAssetDataSourceMetadata(sourceKind);

      expect(metadata.kind).toBe(sourceKind);
      expect(metadata.isRealConnection).toBe(false);
    }
  });

  test("keeps future official metrics envelopes separate from PREVIEW_ONLY metrics", async () => {
    const dataSource = getAssetDataSource("LOCAL_MOCK");
    const [asset] = await dataSource.searchAssets({ instrumentTypes: ["ETF"] });
    const previewSummary = await dataSource.buildManualPortfolioSummary([
      { asset_id: asset.asset_id, weight_percent: 100 }
    ]);
    const previewMode: BdbMetricsMode = previewSummary.weighted_metrics.preview_boundary.mode;
    const officialEnvelope = {
      mode: "OFFICIAL_READ_MODEL",
      source: "BBDD_ACTIVOS",
      as_of_date: "2026-06-20",
      calculation_policy: "BBDD_ACTIVOS_READ_MODEL_V1",
      data_quality: {
        status: "COMPLETE",
        flags: [],
        warnings: []
      },
      official_metrics: {
        risk_score: 4
      },
      official_performance: {
        annualized_return_3y: 0.041
      },
      official_risk: {
        volatility_3y: 0.094,
        sharpe_3y: 0.42,
        max_drawdown_5y: -0.118
      },
      official_costs: {
        ongoing_charge: 0.0035
      },
      suitability_allowed: false,
      optimization_allowed: false,
      recommendation_allowed: false
    } satisfies BdbOfficialMetricsEnvelope;
    const officialMode: BdbMetricsMode = officialEnvelope.mode;

    expect(previewMode).toBe("PREVIEW_ONLY");
    expect(previewSummary.weighted_metrics.preview_boundary.limitations).toContain("No sustituyen a una evaluación de idoneidad.");
    expect(officialMode).toBe("OFFICIAL_READ_MODEL");
    expect(officialEnvelope.mode).not.toBe(previewMode);
    expect(officialEnvelope.source).toBe("BBDD_ACTIVOS");
    expect(officialEnvelope.suitability_allowed).toBe(false);
    expect(officialEnvelope.optimization_allowed).toBe(false);
    expect(officialEnvelope.recommendation_allowed).toBe(false);
  });

  test("optional official metrics envelope on an asset does not feed current local calculations", async () => {
    const dataSource = getAssetDataSource("LOCAL_MOCK");
    const asset = await dataSource.getAssetDetail("MOCK-ETF-WATER");

    expect(asset).not.toBeNull();
    if (!asset) {
      throw new Error("Expected MOCK-ETF-WATER detail in local mock data source.");
    }

    const officialEnvelope = {
      mode: "OFFICIAL_READ_MODEL",
      source: "BBDD_ACTIVOS",
      as_of_date: "2026-06-20",
      calculation_policy: "BBDD_ACTIVOS_READ_MODEL_V1",
      data_quality: {
        status: "COMPLETE",
        flags: [],
        warnings: []
      },
      official_performance: {
        annualized_return_3y: 0.999
      },
      official_risk: {
        volatility_3y: 0.888,
        sharpe_3y: 0.777,
        max_drawdown_5y: -0.666
      },
      suitability_allowed: false,
      optimization_allowed: false,
      recommendation_allowed: false
    } satisfies BdbOfficialMetricsEnvelope;
    const assetWithOfficialEnvelope = {
      ...asset,
      official_metrics_envelope: officialEnvelope
    } satisfies BdbAssetDetail;
    const summary = buildSummaryFromAssets({
      source: "LOCAL_MOCK",
      manualPositions: [{ asset_id: assetWithOfficialEnvelope.asset_id, weight_percent: 100 }],
      assets: [assetWithOfficialEnvelope]
    });

    expect(assetWithOfficialEnvelope.official_metrics_envelope?.source).toBe("BBDD_ACTIVOS");
    expect(assetWithOfficialEnvelope.official_metrics_envelope?.suitability_allowed).toBe(false);
    expect(assetWithOfficialEnvelope.official_metrics_envelope?.optimization_allowed).toBe(false);
    expect(assetWithOfficialEnvelope.official_metrics_envelope?.recommendation_allowed).toBe(false);
    expect(summary.weighted_metrics.preview_boundary.mode).toBe("PREVIEW_ONLY");
    expect(summary.weighted_metrics.preview_boundary.limitations).toContain("No sustituyen a una evaluación de idoneidad.");
    expect(summary.weighted_metrics.annualized_return_3y).toBe(assetWithOfficialEnvelope.metrics.annualized_return_3y);
    expect(summary.weighted_metrics.annualized_return_3y).not.toBe(
      assetWithOfficialEnvelope.official_metrics_envelope?.official_performance?.annualized_return_3y
    );
  });

  test("local official metrics envelopes stay detail-only across fixture and static sources", async () => {
    for (const { sourceKind, assetId } of officialEnvelopeSourceFixtures) {
      const dataSource = getAssetDataSource(sourceKind);
      const positions = [{ asset_id: assetId, weight_percent: 100 }];
      const detail = await dataSource.getAssetDetail(assetId);

      expect(detail).not.toBeNull();
      if (!detail?.official_metrics_envelope) {
        throw new Error(`Expected ${sourceKind} ${assetId} detail to carry an official metrics envelope.`);
      }

      const envelope = detail.official_metrics_envelope;
      const detailWithoutEnvelope = withoutOfficialMetricsEnvelope(detail);
      const expectedSummary = buildSummaryFromAssets({
        source: sourceKind,
        manualPositions: positions,
        assets: [detailWithoutEnvelope]
      });
      const searchResults = await dataSource.searchAssets({ query: assetId });
      const searchResult = searchResults.find((asset) => asset.asset_id === assetId);
      const [stockSearchResult] = await dataSource.searchAssets({ instrumentTypes: ["STOCK"] });
      const comparisonAssets = await dataSource.getComparableAssets([assetId, stockSearchResult.asset_id]);
      const optimizationInput = await dataSource.buildOptimizationInput({
        positions: [{ asset_id: assetId, weight: 1 }]
      });
      const manualSummary = await dataSource.buildManualPortfolioSummary(positions);
      const report = await dataSource.buildManualPortfolioReport(positions);
      const expectedReport = buildReportFromAssets({
        source: sourceKind,
        portfolioName: report.portfolio_name,
        manualPositions: positions,
        assets: [detailWithoutEnvelope],
        summary: expectedSummary
      });
      const optimizationPreview = buildLocalOptimizationPreview({
        sourceKind,
        positions,
        assets: [detail],
        summary: manualSummary
      });
      const optimizationPreviewWithoutEnvelope = buildLocalOptimizationPreview({
        sourceKind,
        positions,
        assets: [detailWithoutEnvelope],
        summary: expectedSummary
      });
      const riskProfilePreview = buildLocalRiskProfilePreview({
        sourceKind,
        selectedProfileId: "RISK_5",
        positions,
        assets: [detail],
        summary: manualSummary
      });
      const riskProfilePreviewWithoutEnvelope = buildLocalRiskProfilePreview({
        sourceKind,
        selectedProfileId: "RISK_5",
        positions,
        assets: [detailWithoutEnvelope],
        summary: expectedSummary
      });

      if (!searchResult) {
        throw new Error(`Expected ${sourceKind} ${assetId} in search results.`);
      }

      const comparisonHtml = renderToStaticMarkup(
        createElement(AssetComparison, {
          assets: comparisonAssets,
          sourceKind: "LOCAL_MOCK",
          onRemove: () => undefined
        })
      );

      expect(envelope.source).toBe("BBDD_ACTIVOS");
      expect(envelope.mode).toBe("OFFICIAL_READ_MODEL");
      expect(envelope.mode).not.toBe("PREVIEW_ONLY");
      expect(envelope.suitability_allowed).toBe(false);
      expect(envelope.optimization_allowed).toBe(false);
      expect(envelope.recommendation_allowed).toBe(false);
      expect(searchResult).not.toHaveProperty("official_metrics_envelope");
      expect(comparisonAssets.some((asset) => Boolean(asset.official_metrics_envelope))).toBe(true);
      /* La tabla del comparador la sustituyo `TablaComparativa` el 03-11-2026: los
         instrumentos son columnas y los campos filas, asi que «Ret 3A» paso a ser
         «Rentabilidad 3 anos» como rotulo de fila. Lo que la prueba mira sigue siendo
         lo mismo: que la comparacion se pinta con los datos de la fuente. */
      expect(comparisonHtml).toContain("Rentabilidad 3 años");
      expect(optimizationInput.assets[0]).not.toHaveProperty("official_metrics_envelope");
      expect(JSON.stringify(optimizationInput)).not.toContain("official_metrics_envelope");
      expect(manualSummary).toEqual(expectedSummary);
      expect(report).toEqual(expectedReport);
      expect(report.summary.weighted_metrics).toEqual(manualSummary.weighted_metrics);
      expect(report.xray).toEqual(expectedReport.xray);
      expect(optimizationPreview).toEqual(optimizationPreviewWithoutEnvelope);
      expect(riskProfilePreview).toEqual(riskProfilePreviewWithoutEnvelope);
      expectNoOfficialMetricsEnvelope(searchResults);
      expectNoOfficialMetricsEnvelope(comparisonHtml);
      expectNoOfficialMetricsEnvelope(optimizationInput);
      expectNoOfficialMetricsEnvelope(manualSummary);
      expectNoOfficialMetricsEnvelope(manualSummary.weighted_metrics);
      expectNoOfficialMetricsEnvelope(report);
      expectNoOfficialMetricsEnvelope(report.positions);
      expectNoOfficialMetricsEnvelope(report.xray);
      expectNoOfficialMetricsEnvelope(optimizationPreview);
      expectNoOfficialMetricsEnvelope(riskProfilePreview);
      expect(manualSummary.weighted_metrics.preview_boundary.mode).toBe("PREVIEW_ONLY");
      expect(optimizationPreview.status).toBe("PREVIEW_ONLY");
      expect(optimizationPreview.metrics_boundary.mode).toBe("PREVIEW_ONLY");
      expect(riskProfilePreview.status).toBe("PREVIEW_ONLY");
      expect(riskProfilePreview.metrics_boundary.mode).toBe("PREVIEW_ONLY");
      expect(manualSummary.weighted_metrics.annualized_return_3y).toBe(detail.metrics.annualized_return_3y);
      expect(manualSummary.weighted_metrics.annualized_return_3y).not.toBe(
        envelope.official_performance?.annualized_return_3y
      );
      expect(report.xray.pms_exposure_percent).toEqual(expectedReport.xray.pms_exposure_percent);
    }
  });

  test("all sources support FUND ETF STOCK and INDEX in search", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const results = await dataSource.searchAssets();
      const instrumentTypes = new Set(results.map((asset) => asset.instrument_type));

      expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK", "INDEX"]));
    }
  });

  test("all sources keep instrument type separate from economic asset class", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const results = await dataSource.searchAssets({ instrumentTypes: ["STOCK"] });

      expect(results[0].instrument_type).toBe("STOCK");
      expect(results[0].economic_asset_class).toBe("EQUITY");
      expect(results[0].instrument_type).not.toBe(results[0].economic_asset_class);
    }
  });

  test("all sources provide a common interface for search detail comparison portfolio and reporting", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const results = await dataSource.searchAssets();
      const selectedAssetId = results[0].asset_id;
      const manualPositions = [
        { asset_id: selectedAssetId, weight_percent: 60 },
        { asset_id: (await dataSource.searchAssets({ instrumentTypes: ["STOCK"] }))[0].asset_id, weight_percent: 40 }
      ];
      const detail = await dataSource.getAssetDetail(selectedAssetId);
      const comparableAssets = await dataSource.getComparableAssets(manualPositions.map((position) => position.asset_id));
      const portfolioDraft = await dataSource.getPortfolioInputs();
      const optimizationInput = await dataSource.buildOptimizationInput();
      const manualSummary = await dataSource.buildManualPortfolioSummary(manualPositions);
      const manualOptimization = await dataSource.buildManualPortfolioOptimizationPreview(manualPositions);
      const report = await dataSource.buildManualPortfolioReport(manualPositions);

      expect(detail?.asset_id).toBe(selectedAssetId);
      expect(comparableAssets).toHaveLength(2);
      expect(portfolioDraft.source).toBe(sourceKind);
      expect(portfolioDraft.positions.length).toBeGreaterThan(0);
      expect(optimizationInput.source).toBe(sourceKind);
      expect(optimizationInput.assets.length).toBeGreaterThan(0);
      expect(manualSummary.source).toBe(sourceKind);
      expect(manualSummary.validation_status).toBe("VALID");
      expect(manualSummary.weighted_metrics.preview_boundary.mode).toBe("PREVIEW_ONLY");
      expect(manualSummary.weighted_metrics.preview_boundary.source_label).toContain("Métricas locales");
      expect(manualSummary.weighted_metrics.preview_boundary.limitations).toEqual(
        expect.arrayContaining([
          "No son métricas oficiales del catálogo.",
          "No sustituyen a una evaluación de idoneidad.",
          "No constituyen recomendación personalizada.",
          "No son aptas para la optimización en producción."
        ])
      );
      expect(manualOptimization.positions).toHaveLength(2);
      expect(manualOptimization.source).toBe(sourceKind);
      expect(report.mode).toBe(sourceKind);
      expect(report.summary.source).toBe(sourceKind);
      expect(report.summary).toEqual(manualSummary);
      expect(report.positions).toHaveLength(2);
      expect(report.data_diagnostic.total_positions).toBe(2);
      expect(report.data_diagnostic.investable_positions).toBe(2);
      expect(report.data_diagnostic.local_only_notice).toContain("no evalúa idoneidad");
      expect(report.xray.total_positions).toBe(2);
      expect(report.xray.investable_positions).toBe(2);
      expect(report.xray.position_concentration).toHaveLength(2);
      expect(report.xray.by_instrument_type.length).toBeGreaterThan(0);
      expect(report.xray.by_economic_asset_class.length).toBeGreaterThan(0);
      expect(report.xray.by_currency.length).toBeGreaterThan(0);
    }
  });

  test("all sources keep INDEX visible as benchmark and non-investable", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const indexes = await dataSource.searchAssets({ instrumentTypes: ["INDEX"] });
      const detail = await dataSource.getAssetDetail(indexes[0].asset_id);

      expect(indexes[0].role).toBe("BENCHMARK");
      expect(indexes[0].is_investable).toBe(false);
      expect(detail?.role).toBe("BENCHMARK");
      expect(detail?.is_investable).toBe(false);
    }
  });

  test("all sources exclude INDEX benchmark from investable allocation metrics and optimization", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const [etf] = await dataSource.searchAssets({ instrumentTypes: ["ETF"] });
      const [index] = await dataSource.searchAssets({ instrumentTypes: ["INDEX"] });
      const manualPositions = [
        { asset_id: etf.asset_id, weight_percent: 70 },
        { asset_id: index.asset_id, weight_percent: 30 }
      ];
      const summary = await dataSource.buildManualPortfolioSummary(manualPositions);
      const report = await dataSource.buildManualPortfolioReport(manualPositions);
      const optimizationInput = await dataSource.buildManualPortfolioOptimizationPreview(manualPositions);

      expect(summary.source).toBe(sourceKind);
      expect(summary.non_investable_assets).toContain(index.asset_id);
      expect(summary.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
      expect(report.positions.some((position) => position.asset_id === index.asset_id)).toBe(true);
      expect(report.mode).toBe(sourceKind);
      expect(report.xray.excluded_non_investable_positions).toBe(1);
      expect(report.xray.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
      expect(optimizationInput.source).toBe(sourceKind);
      expect(optimizationInput.assets.every((asset) => asset.instrument_type !== "INDEX")).toBe(true);
      expect(optimizationInput.positions.every((position) => position.asset_id !== index.asset_id)).toBe(true);
    }
  });

  test("selector payloads do not expose forbidden markers", async () => {
    for (const sourceKind of sourceKinds) {
      const dataSource = getAssetDataSource(sourceKind);
      const payloads = [
        dataSource.metadata,
        await dataSource.searchAssets(),
        await dataSource.getPortfolioInputs(),
        await dataSource.buildOptimizationInput(),
        await dataSource.buildManualPortfolioReport([
          { asset_id: (await dataSource.searchAssets())[0].asset_id, weight_percent: 100 }
        ])
      ];

      for (const payload of payloads) {
        expectNoForbiddenPayloadStrings(payload);
      }
    }
  });
});

describe("Perfil no cuenta como faltante lo que a una acción no le aplica (decisión 83)", () => {
  const ficha = (asset_id: string, instrument_type: string, risk_score?: number) =>
    ({ asset_id, display_name: asset_id, instrument_type, economic_asset_class: "EQUITY", currency: "EUR", is_investable: true, role: "INVESTABLE", coverage_status: "COMPLETE", quality_flags: [], warnings: [], metrics: { risk_score } }) as unknown as BdbAssetDetail;
  const previa = (activos: BdbAssetDetail[]) => {
    const positions = activos.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / activos.length }));
    return buildLocalRiskProfilePreview({
      sourceKind: "BBDD_LIVE_API",
      selectedProfileId: "RISK_5",
      positions,
      assets: activos,
      summary: buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: positions, assets: activos })
    });
  };
  const lista = (metrica: string[]) => metrica.join(" | ");

  test("una sola acción: ni está ni falta", () => {
    const vista = previa([ficha("IBE", "STOCK")]);
    expect(lista(vista.portfolio_metrics_missing)).not.toContain("riesgo");
    expect(lista(vista.portfolio_metrics_available)).not.toContain("riesgo");
  });

  test("una acción y un fondo con él: lo tiene quien le aplica", () => {
    const vista = previa([ficha("IBE", "STOCK"), ficha("F", "FUND", 3)]);
    expect(lista(vista.portfolio_metrics_missing)).not.toContain("riesgo");
    expect(lista(vista.portfolio_metrics_available)).toContain("riesgo");
  });

  test("un fondo sin él sí falta, haya o no una acción al lado", () => {
    expect(lista(previa([ficha("F", "FUND")]).portfolio_metrics_missing)).toContain("riesgo");
    expect(lista(previa([ficha("IBE", "STOCK"), ficha("F", "FUND")]).portfolio_metrics_missing)).toContain("riesgo");
  });
});
