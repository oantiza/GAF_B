import { describe, expect, test } from "vitest";
import { buildLocalOptimizationPreview } from "../src/core/optimizationPreview";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { buildLocalRiskProfilePreview } from "../src/core/riskProfilePreview";
import {
  createSavedLocalPortfolio,
  deleteLocalPortfolio,
  loadLocalPortfolio,
  saveLocalPortfolio
} from "../src/core/portfolio";
import {
  CURRENT_PORTFOLIO_STORAGE_KEY,
  CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION,
  DEFAULT_DRAFT_TOTAL_CAPITAL,
  LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION,
  LOCAL_PORTFOLIOS_STORAGE_KEY,
  clearPortfolioStorage,
  parseCurrentPortfolioDraft,
  parseLocalPortfolios,
  readCurrentPortfolioDraftCapitalFromStorage,
  readCurrentPortfolioDraftFromStorage,
  readLocalPortfoliosFromStorage,
  serializeCurrentPortfolioDraft,
  serializeLocalPortfolios,
  writeCurrentPortfolioDraftCapitalToStorage,
  writeCurrentPortfolioDraftToStorage,
  writeLocalPortfoliosToStorage,
  type LocalPortfolioStorageLike
} from "../src/core/localPortfolioStorage";
import {
  buildManualPortfolioOptimizationPreview,
  buildManualPortfolioReport,
  buildManualPortfolioSummary,
  buildOptimizationInput,
  getAssetDetail,
  getComparableAssets,
  getPortfolioInputs,
  toPortfolioPositions,
  searchAssets
} from "../src/adapters/bdbAssetsAdapter";
import type { BdbManualPortfolioPosition, EconomicAssetClass, InstrumentType } from "../src/types/bdbAssets";

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
  ["std", "_perf_norm"].join("")
];

function expectNoForbiddenPayloadStrings(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const forbidden of forbiddenPayloadStrings) {
    expect(serialized).not.toContain(forbidden);
  }
}

class MemoryStorage implements LocalPortfolioStorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("BDB-ACTIVOS local multi-asset adapter", () => {
  test("searchAssets returns every supported instrument type", async () => {
    const results = await searchAssets();
    const instrumentTypes = new Set(results.map((asset) => asset.instrument_type));

    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK", "INDEX"]));
  });

  test("searchAssets without filters does not exclude ETFs or stocks", async () => {
    const results = await searchAssets();

    expect(results.some((asset) => asset.instrument_type === "ETF")).toBe(true);
    expect(results.some((asset) => asset.instrument_type === "STOCK")).toBe(true);
  });

  test("searchAssets supports each instrument filter", async () => {
    const funds = await searchAssets({ instrumentTypes: ["FUND"] });
    const etfs = await searchAssets({ instrumentTypes: ["ETF"] });
    const stocks = await searchAssets({ instrumentTypes: ["STOCK"] });
    const indexes = await searchAssets({ instrumentTypes: ["INDEX"] });

    expect(funds.length).toBeGreaterThan(0);
    expect(etfs.length).toBeGreaterThan(0);
    expect(stocks.length).toBeGreaterThan(0);
    expect(indexes.length).toBeGreaterThan(0);
    expect(funds.every((asset) => asset.instrument_type === "FUND")).toBe(true);
    expect(etfs.every((asset) => asset.instrument_type === "ETF")).toBe(true);
    expect(stocks.every((asset) => asset.instrument_type === "STOCK")).toBe(true);
    expect(indexes.every((asset) => asset.instrument_type === "INDEX")).toBe(true);
  });

  test("searchAssets finds results by text", async () => {
    const results = await searchAssets({ query: "water" });

    expect(results).toHaveLength(1);
    expect(results[0].asset_id).toBe("MOCK-ETF-WATER");
  });

  test("searchAssets keeps index benchmark visible", async () => {
    const indexes = await searchAssets({ instrumentTypes: ["INDEX"] });

    expect(indexes).toHaveLength(1);
    expect(indexes[0].role).toBe("BENCHMARK");
    expect(indexes[0].is_investable).toBe(false);
  });

  test("getAssetDetail works for each instrument type", async () => {
    const fund = await getAssetDetail("MOCK-FUND-GLOBAL-BOND");
    const etf = await getAssetDetail("MOCK-ETF-WATER");
    const stock = await getAssetDetail("MOCK-STOCK-TECH");
    const index = await getAssetDetail("MOCK-INDEX-GLOBAL");

    expect(fund?.instrument_type).toBe("FUND");
    expect(etf?.instrument_type).toBe("ETF");
    expect(stock?.instrument_type).toBe("STOCK");
    expect(index?.instrument_type).toBe("INDEX");
  });

  test("stock detail does not require fund or ETF costs", async () => {
    const stock = await getAssetDetail("MOCK-STOCK-TECH");

    expect(stock?.instrument_type).toBe("STOCK");
    expect(stock?.costs).toBeUndefined();
    expect(stock?.metrics.volatility_3y).toBeDefined();
  });

  test("fund and ETF details can expose optional costs without requiring them globally", async () => {
    const fund = await getAssetDetail("MOCK-FUND-GLOBAL-BOND");
    const etf = await getAssetDetail("MOCK-ETF-WATER");

    expect(fund?.costs?.ongoing_charge).toBeDefined();
    expect(etf?.costs?.ongoing_charge).toBeDefined();
  });

  test("index detail keeps benchmark and non-investable semantics", async () => {
    const index = await getAssetDetail("MOCK-INDEX-GLOBAL");

    expect(index?.instrument_type).toBe("INDEX");
    expect(index?.role).toBe("BENCHMARK");
    expect(index?.is_investable).toBe(false);
    expect(index?.quality_flags).toContain("NON_INVESTABLE_BENCHMARK");
  });

  test("getComparableAssets supports mixed asset comparisons", async () => {
    const results = await getComparableAssets([
      "MOCK-FUND-GLOBAL-BOND",
      "MOCK-ETF-WATER",
      "MOCK-STOCK-TECH"
    ]);

    expect(results.map((asset) => asset.instrument_type)).toEqual(["FUND", "ETF", "STOCK"]);
  });

  test("getComparableAssets admits every supported instrument type", async () => {
    const results = await getComparableAssets([
      "MOCK-FUND-GLOBAL-BOND",
      "MOCK-ETF-WATER",
      "MOCK-STOCK-TECH",
      "MOCK-INDEX-GLOBAL"
    ]);
    const instrumentTypes = new Set(results.map((asset) => asset.instrument_type));

    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK", "INDEX"]));
  });

  test("getComparableAssets keeps ETFs and stocks in comparison payloads", async () => {
    const results = await getComparableAssets(["MOCK-ETF-WATER", "MOCK-STOCK-TECH"]);

    expect(results).toHaveLength(2);
    expect(results.some((asset) => asset.instrument_type === "ETF")).toBe(true);
    expect(results.some((asset) => asset.instrument_type === "STOCK")).toBe(true);
  });

  test("stock comparison payload does not require costs or TER", async () => {
    const [stock] = await getComparableAssets(["MOCK-STOCK-TECH"]);

    expect(stock.instrument_type).toBe("STOCK");
    expect(stock.costs).toBeUndefined();
    expect(stock.metrics.risk_score).toBeDefined();
  });

  test("index comparison payload remains benchmark and non-investable", async () => {
    const [index] = await getComparableAssets(["MOCK-INDEX-GLOBAL"]);

    expect(index.instrument_type).toBe("INDEX");
    expect(index.role).toBe("BENCHMARK");
    expect(index.is_investable).toBe(false);
    expect(index.quality_flags).toContain("NON_INVESTABLE_BENCHMARK");
  });

  test("getComparableAssets supports a FUND ETF STOCK mix", async () => {
    const results = await getComparableAssets([
      "MOCK-FUND-MIXED",
      "MOCK-ETF-CASH",
      "MOCK-STOCK-HEALTH"
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((asset) => asset.instrument_type)).toEqual(["FUND", "ETF", "STOCK"]);
  });

  test("getComparableAssets deduplicates repeated identifiers", async () => {
    const results = await getComparableAssets(["MOCK-ETF-WATER", "IE0000000002", "WATR"]);

    expect(results).toHaveLength(1);
    expect(results[0].asset_id).toBe("MOCK-ETF-WATER");
  });

  test("getPortfolioInputs accepts multi-asset positions", async () => {
    const draft = await getPortfolioInputs({
      positions: [
        { asset_id: "MOCK-FUND-MIXED", weight: 0.4 },
        { asset_id: "MOCK-ETF-CASH", weight: 0.2 },
        { asset_id: "MOCK-STOCK-TECH", weight: 0.4 }
      ]
    });

    expect(draft.positions).toHaveLength(3);
    expect(draft.source).toBe("LOCAL_MOCK");
    expect(draft.warnings).toEqual([]);
  });

  test("manual portfolio accepts FUND ETF and STOCK positions", async () => {
    const summary = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const instrumentTypes = new Set(summary.by_instrument_type.map((bucket) => bucket.key));

    expect(summary.position_count).toBe(3);
    expect(summary.source).toBe("LOCAL_MOCK");
    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK"]));
  });

  test("manual portfolio does not add a non-investable INDEX to optimization positions", async () => {
    const input = await buildManualPortfolioOptimizationPreview([
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30, label: "Benchmark reference" }
    ]);

    expect(input.positions).toHaveLength(1);
    expect(input.source).toBe("LOCAL_MOCK");
    expect(input.positions[0].asset_id).toBe("MOCK-ETF-WATER");
    expect(input.assets.every((asset) => asset.is_investable)).toBe(true);
  });

  test("manual portfolio validates a 100 percent weight sum", async () => {
    const summary = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 50 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 50 }
    ]);

    expect(summary.total_weight_percent).toBe(100);
    expect(summary.validation_status).toBe("VALID");
    expect(summary.is_valid).toBe(true);
  });

  test("manual portfolio detects under and over allocation", async () => {
    const underAllocated = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const overAllocated = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 70 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);

    expect(underAllocated.validation_status).toBe("UNDER_ALLOCATED");
    expect(overAllocated.validation_status).toBe("OVER_ALLOCATED");
  });

  test("manual portfolio calculates distribution by instrument type", async () => {
    const summary = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const distribution = new Map(summary.by_instrument_type.map((bucket) => [bucket.key, bucket.weight_percent]));

    expect(distribution.get("FUND")).toBe(40);
    expect(distribution.get("ETF")).toBe(20);
    expect(distribution.get("STOCK")).toBe(40);
  });

  test("manual portfolio calculates distribution by economic asset class", async () => {
    const summary = await buildManualPortfolioSummary([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const distribution = new Map(
      summary.by_economic_asset_class.map((bucket) => [bucket.key, bucket.weight_percent])
    );

    expect(distribution.get("MIXED")).toBe(40);
    expect(distribution.get("MONEY_MARKET")).toBe(20);
    expect(distribution.get("EQUITY")).toBe(40);
    expect(new Set(summary.by_economic_asset_class.map((bucket) => bucket.key))).toEqual(
      new Set<EconomicAssetClass>(["MIXED", "MONEY_MARKET", "EQUITY"])
    );
  });

  test("manual portfolio converts percent weights to optimization weights", () => {
    const positions = toPortfolioPositions([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 25 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 75 }
    ]);

    expect(positions).toEqual([
      { asset_id: "MOCK-FUND-MIXED", weight: 0.25, label: undefined },
      { asset_id: "MOCK-STOCK-TECH", weight: 0.75, label: undefined }
    ]);
  });

  test("buildOptimizationInput accepts manual multi-asset positions", async () => {
    const input = await buildManualPortfolioOptimizationPreview([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const instrumentTypes = new Set(input.assets.map((asset) => asset.instrument_type));

    expect(input.positions).toHaveLength(3);
    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK"]));
  });

  test("local optimization preview marks FUND ETF and STOCK as eligible without computing new weights", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.eligible_assets).toHaveLength(3);
    expect(preview.excluded_assets).toHaveLength(0);
    expect(preview.eligible_assets.map((asset) => asset.weight_percent)).toEqual([40, 20, 40]);
    expect(new Set(preview.eligible_assets.map((asset) => asset.instrument_type))).toEqual(
      new Set<InstrumentType>(["FUND", "ETF", "STOCK"])
    );
    expect(preview.disclaimer).toContain("No evalúa idoneidad");
    expect(JSON.stringify(preview).toLowerCase()).not.toContain("recomendado");
    expect(JSON.stringify(preview).toLowerCase()).not.toContain("adecuado");
  });

  test("local optimization preview excludes INDEX benchmarks and zero weights", async () => {
    const positions = [
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 0 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.eligible_assets.map((asset) => asset.asset_id)).toEqual(["MOCK-ETF-WATER"]);
    expect(preview.excluded_assets).toEqual([
      {
        asset_id: "MOCK-INDEX-GLOBAL",
        display_name: "Mock Global Equity Index",
        weight_percent: 30,
        reason: "NON_INVESTABLE_BENCHMARK"
      },
      {
        asset_id: "MOCK-STOCK-TECH",
        display_name: "Mock Technology Company",
        weight_percent: 0,
        reason: "INVALID_WEIGHT"
      }
    ]);
    expect(preview.portfolio_warnings.some((warning) => warning.includes("no invertibles"))).toBe(true);
    expect(preview.portfolio_warnings.some((warning) => warning.includes("peso inválido"))).toBe(true);
  });

  test("local optimization preview surfaces quality warnings and missing metrics", async () => {
    const positions = [{ asset_id: "MOCK-STOCK-HEALTH", weight_percent: 100 }];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.eligible_assets).toHaveLength(1);
    expect(preview.quality_warnings).toEqual([
      "MOCK-STOCK-HEALTH: Métricas cuantitativas incompletas",
      "MOCK-STOCK-HEALTH: Datos parciales"
    ]);
    expect(preview.metrics_missing).toEqual([
      "annualized_return_3y",
      "max_drawdown_5y",
      "max_drawdown_hist",
      "risk_score",
      "sharpe_3y",
      "volatility_3y"
    ]);
  });

  test("local optimization preview flags invalid portfolio weights", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.validation_status).toBe("UNDER_ALLOCATED");
    expect(preview.total_weight_percent).toBe(80);
    expect(preview.portfolio_warnings.some((warning) => warning.includes("100 %"))).toBe(true);
  });

  test("local risk profile preview keeps selected profile as PREVIEW_ONLY", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_7",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.selected_profile.risk_profile_id).toBe("RISK_7");
    expect(preview.selected_profile.level).toBe(7);
    expect(preview.sourceKind).toBe("LOCAL_MOCK");
    expect(preview.investable_position_count).toBe(3);
    expect(preview.disclaimer).toContain("no evalúa idoneidad");
    expect(preview.disclaimer).toContain("recomendación personalizada");
  });

  test("local risk profile preview detects available and missing data", async () => {
    const positions = [{ asset_id: "MOCK-STOCK-HEALTH", weight_percent: 100 }];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_4",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.portfolio_metrics_available).toEqual([]);
    /* Es una acción: el indicador de riesgo no le falta, no le aplica (decisión 83). Y siendo la única, el Sharpe sería el suyo, que no se
       enseña: tampoco falta. */
    expect(preview.portfolio_metrics_missing).toEqual([
      "caída máxima histórica",
      "rentabilidad anualizada 3 años",
      "volatilidad 3 años"
    ]);
    /* D2.2: los avisos llegan en español con la etiqueta del sistema. */
    expect(preview.data_warnings).toEqual(
      expect.arrayContaining([
        "Aviso de datos: Métricas cuantitativas incompletas.",
        "Aviso de datos: Cobertura parcial.",
        "MOCK-STOCK-HEALTH: Métricas cuantitativas incompletas",
        "MOCK-STOCK-HEALTH: Datos parciales"
      ])
    );
    expect(preview.serious_evaluation_notice).toContain("Faltan datos");
    expect(preview.risk_signals.some((signal) => signal.includes("Faltan métricas"))).toBe(true);
  });

  test("local risk profile preview excludes INDEX benchmark from investable signals", async () => {
    const positions = [
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_5",
      positions,
      assets,
      summary
    });

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(preview.investable_position_count).toBe(1);
    expect(preview.excluded_assets).toEqual([
      {
        asset_id: "MOCK-INDEX-GLOBAL",
        display_name: "Mock Global Equity Index",
        weight_percent: 30,
        reason: "NON_INVESTABLE_BENCHMARK"
      }
    ]);
    expect(preview.risk_signals.some((signal) => signal.includes("Índices y activos no invertibles"))).toBe(true);
  });

  test("local risk profile preview does not generate recommendation or real suitability fields", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 50 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 50 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const preview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_6",
      positions,
      assets,
      summary
    });
    const serialized = JSON.stringify(preview).toLowerCase();
    const keys = Object.keys(preview);

    expect(preview.status).toBe("PREVIEW_ONLY");
    expect(keys).not.toContain("recommendation");
    expect(keys).not.toContain("suitability");
    expect(serialized).not.toContain("recommended_weight");
    expect(serialized).not.toContain("target_weight");
    expect(serialized).not.toContain("comprar");
    expect(serialized).not.toContain("vender");
    expect(serialized).not.toContain("mantener");
    expect(serialized).not.toContain("recomendado");
    expect(serialized).not.toContain("adecuado");
  });

  test("local portfolio import accepts valid FUND ETF and STOCK positions preserving weights", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-FUND-MIXED,40", "MOCK-ETF-CASH,30", "MOCK-STOCK-TECH,30"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions).toEqual([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40, label: "Mock Balanced Allocation Fund" },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 30, label: "Mock Treasury Bill ETF" },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 30, label: "Mock Technology Company" }
    ]);
    expect(result.rejected_positions).toEqual([]);
    expect(result.total_weight_percent).toBe(100);
    expect(result.warnings).toEqual([]);
    expect(result.local_only_notice).toContain("no guarda la cartera");
  });

  test("el CSV que escribe «Exportar a CSV» se vuelve a importar, con comas en el nombre y sin importes", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: [
        "asset_id,nombre,peso_percent,importe_eur",
        'MOCK-FUND-MIXED,"Mock, Balanced ""Allocation"" Fund",40,40000',
        'MOCK-ETF-CASH,"Mock Treasury Bill ETF",35.5,',
        "MOCK-STOCK-TECH,Mock Technology Company,24.5,24500"
      ].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.rejected_positions).toEqual([]);
    expect(result.imported_positions.map((posicion) => [posicion.asset_id, posicion.weight_percent])).toEqual([
      ["MOCK-FUND-MIXED", 40],
      ["MOCK-ETF-CASH", 35.5],
      ["MOCK-STOCK-TECH", 24.5]
    ]);
    expect(result.total_weight_percent).toBe(100);
  });

  test.each(["asset_id,peso", "asset_id;peso", "ASSET_ID,Peso_Percent", "asset_id,weight_percent"])(
    "la cabecera %s es una cabecera, no una posición rechazada",
    async (cabecera) => {
      const separador = cabecera.includes(";") ? ";" : ",";
      const result = await buildLocalPortfolioImport({
        sourceKind: "LOCAL_MOCK",
        text: [cabecera, `MOCK-FUND-MIXED${separador}60`, `MOCK-STOCK-TECH${separador}40`].join("\n"),
        resolveAsset: getAssetDetail
      });

      expect(result.rejected_positions).toEqual([]);
      expect(result.imported_positions).toHaveLength(2);
    }
  );

  test("local portfolio import warns when imported weights do not sum to 100", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-FUND-MIXED,40", "MOCK-STOCK-TECH,40"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions).toHaveLength(2);
    expect(result.total_weight_percent).toBe(80);
    expect(result.warnings.some((warning) => warning.includes("distinta de 100"))).toBe(true);
  });

  test("local portfolio import rejects unknown asset ids", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-FUND-MIXED,60", "UNKNOWN-ASSET,40"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions.map((position) => position.asset_id)).toEqual(["MOCK-FUND-MIXED"]);
    expect(result.rejected_positions).toEqual([
      {
        line_number: 3,
        raw_line: "UNKNOWN-ASSET,40",
        asset_id: "UNKNOWN-ASSET",
        weight_percent: 40,
        reason: "MISSING_ASSET",
        message: "Activo no encontrado en el catálogo."
      }
    ]);
  });

  test("local portfolio import rejects INDEX benchmark as non-investable", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-ETF-WATER,70", "MOCK-INDEX-GLOBAL,30"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions.map((position) => position.asset_id)).toEqual(["MOCK-ETF-WATER"]);
    expect(result.rejected_positions).toEqual([
      {
        line_number: 3,
        raw_line: "MOCK-INDEX-GLOBAL,30",
        asset_id: "MOCK-INDEX-GLOBAL",
        weight_percent: 30,
        reason: "NON_INVESTABLE_BENCHMARK",
        message: "Índice no invertible, excluido de la cartera importada."
      }
    ]);
  });

  test("local portfolio import rejects malformed lines and invalid weights", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-FUND-MIXED", "MOCK-STOCK-TECH,abc", ",20"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions).toEqual([]);
    expect(result.rejected_positions.map((rejection) => rejection.reason)).toEqual([
      "MALFORMED_LINE",
      "INVALID_WEIGHT",
      "INVALID_ASSET_ID"
    ]);
    expect(result.warnings).toContain("No hay posiciones válidas para cargar.");
  });

  test("local portfolio import supports market-suffixed tickers through the active source", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MTC.US,100"].join("\n"),
      resolveAsset: getAssetDetail
    });

    expect(result.imported_positions).toEqual([
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 100, label: "Mock Technology Company" }
    ]);
    expect(result.rejected_positions).toEqual([]);
  });

  test("imported positions continue feeding saved portfolios X-Ray optimization and risk preview", async () => {
    const importResult = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,weight", "MOCK-FUND-MIXED,40", "MOCK-ETF-CASH,20", "MOCK-STOCK-TECH,40"].join("\n"),
      resolveAsset: getAssetDetail
    });
    const assets = await getComparableAssets(importResult.imported_positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(importResult.imported_positions);
    const report = await buildManualPortfolioReport(importResult.imported_positions);
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: "Importada local",
      positions: importResult.imported_positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-imported"
    });
    const optimizationPreview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions: importResult.imported_positions,
      assets,
      summary
    });
    const riskPreview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_5",
      positions: importResult.imported_positions,
      assets,
      summary
    });

    expect(savedPortfolio.positions).toEqual(importResult.imported_positions);
    expect(report.xray.investable_positions).toBe(3);
    expect(report.xray.position_concentration).toHaveLength(3);
    expect(optimizationPreview.status).toBe("PREVIEW_ONLY");
    expect(optimizationPreview.metrics_boundary.mode).toBe("PREVIEW_ONLY");
    expect(optimizationPreview.metrics_boundary.limitations).toContain("No son métricas oficiales del catálogo.");
    expect(optimizationPreview.eligible_assets).toHaveLength(3);
    expect(riskPreview.status).toBe("PREVIEW_ONLY");
    expect(riskPreview.metrics_boundary.mode).toBe("PREVIEW_ONLY");
    expect(riskPreview.metrics_boundary.limitations).toContain("No sustituyen a una evaluación de idoneidad.");
    expect(riskPreview.investable_position_count).toBe(3);
  });

  test("las vistas previas de una cartera válida dicen sus límites", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const report = await buildManualPortfolioReport(positions);
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const optimizationPreview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });
    const riskPreview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_5",
      positions,
      assets,
      summary
    });
    expect(report.summary.weighted_metrics.preview_boundary.limitations).toContain(
      "No son aptas para la optimización en producción."
    );
    expect(optimizationPreview.metrics_boundary.limitations).toContain("No constituyen recomendación personalizada.");
    expect(riskPreview.metrics_boundary.limitations).toContain("No sustituyen a una evaluación de idoneidad.");
  });

  test("report export preview keeps reporting X-Ray diagnostic optimization and risk context", async () => {
    const positions = [
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30 }
    ];
    const report = await buildManualPortfolioReport(positions);
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const summary = await buildManualPortfolioSummary(positions);
    const optimizationPreview = buildLocalOptimizationPreview({
      sourceKind: "LOCAL_MOCK",
      positions,
      assets,
      summary
    });
    const riskPreview = buildLocalRiskProfilePreview({
      sourceKind: "LOCAL_MOCK",
      selectedProfileId: "RISK_5",
      positions,
      assets,
      summary
    });
    expect(report.xray.excluded_non_investable_positions).toBe(1);
    expect(report.data_diagnostic.excluded_non_investable_positions).toBe(1);
    expect(optimizationPreview.excluded_assets[0].reason).toBe("NON_INVESTABLE_BENCHMARK");
    expect(riskPreview.excluded_assets[0].reason).toBe("NON_INVESTABLE_BENCHMARK");
  });

  test("portfolio report summary accepts FUND ETF and STOCK positions", async () => {
    const report = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const instrumentTypes = new Set(report.positions.map((position) => position.instrument_type));

    expect(report.portfolio_name).toBe("Cartera local mock");
    expect(report.mode).toBe("LOCAL_MOCK");
    expect(report.summary.source).toBe("LOCAL_MOCK");
    expect(report.summary.validation_status).toBe("VALID");
    expect(instrumentTypes).toEqual(new Set<InstrumentType>(["FUND", "ETF", "STOCK"]));
  });

  test("portfolio report includes local X-Ray concentration and exposure", async () => {
    const report = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const byCurrency = new Map(report.xray.by_currency.map((bucket) => [bucket.key, bucket.weight_percent]));
    const byRegion = new Map(report.xray.by_region.map((bucket) => [bucket.key, bucket.weight_percent]));

    expect(report.xray.total_positions).toBe(3);
    expect(report.xray.investable_positions).toBe(3);
    expect(report.xray.excluded_non_investable_positions).toBe(0);
    expect(report.xray.top_position?.weight_percent).toBe(40);
    expect(report.xray.position_concentration).toHaveLength(3);
    expect(report.xray.concentration_level).toBe("WATCH");
    expect(report.xray.coverage_complete_positions).toBe(2);
    expect(byCurrency.get("EUR")).toBe(60);
    expect(byCurrency.get("USD")).toBe(40);
    expect(byRegion.get("Europe")).toBe(60);
    expect(byRegion.get("United States")).toBe(40);
    // S6a (P5): con vectores limpios (suman 1) y pesos al 100, el cálculo
    // canónico coincide con el histórico — estos valores NO cambian.
    expect(report.xray.pms_exposure_percent.equity).toBe(59.2);
    expect(report.xray.pms_exposure_percent.fixed_income).toBe(19.2);
    expect(report.xray.pms_exposure_coverage_percent).toBe(100);
    expect(report.xray.pms_exposure_fallback_percent).toBe(0);
  });

  test("local saved portfolio preserves name weights and source in memory", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 60, label: "Balanced" },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40, label: "Tech" }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: " Cartera prueba ",
      positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-test"
    });

    expect(savedPortfolio).toEqual({
      portfolio_id: "local-test",
      name: "Cartera prueba",
      positions,
      created_at: "2026-06-20T10:00:00.000Z",
      updated_at: "2026-06-20T10:00:00.000Z",
      sourceKind: "LOCAL_MOCK"
    });
  });

  test("local saved portfolio excludes non-investable benchmark positions", async () => {
    const positions = [
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: "Benchmark protected",
      positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-benchmark"
    });

    expect(savedPortfolio.positions).toEqual([{ asset_id: "MOCK-ETF-WATER", weight_percent: 70, label: undefined }]);
    expect(savedPortfolio.positions.some((position) => position.asset_id === "MOCK-INDEX-GLOBAL")).toBe(false);
  });

  test("local saved portfolios can be saved loaded deleted and still feed reporting X-Ray", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 55 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 45 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: "Reporte local",
      positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-report"
    });
    const savedPortfolios = saveLocalPortfolio([], savedPortfolio);
    const loadedPositions = loadLocalPortfolio(savedPortfolios[0]);
    const report = await buildManualPortfolioReport(loadedPositions);
    const afterDelete = deleteLocalPortfolio(savedPortfolios, "local-report");

    expect(savedPortfolios).toHaveLength(1);
    expect(loadedPositions).toEqual(savedPortfolio.positions);
    expect(report.summary.total_weight_percent).toBe(100);
    expect(report.xray.investable_positions).toBe(2);
    expect(report.xray.top_position?.weight_percent).toBe(55);
    expect(afterDelete).toEqual([]);
  });

  test("local portfolio storage serializes only app-owned ids weights and source metadata", async () => {
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 55, label: "Balanced" },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 45, label: "Tech" }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: "Persistencia segura",
      positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-safe"
    });
    const pollutedPortfolio = {
      ...savedPortfolio,
      official_metrics_envelope: { mode: "OFFICIAL_READ_MODEL" },
      suitability_inputs: { client: "real" },
      recommendation_input: { action: "buy" },
      optimization_input: { real: true },
      assets,
      positions: savedPortfolio.positions.map((position) => ({
        ...position,
        official_metrics: { risk_score: 1 },
        private_metrics: { secret: true }
      }))
    };
    const serialized = serializeLocalPortfolios([pollutedPortfolio], "2026-06-20T11:00:00.000Z");
    const parsed = JSON.parse(serialized);

    expect(parsed.schema_version).toBe(LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION);
    expect(parsed.saved_portfolios).toEqual([savedPortfolio]);
    expect(serialized).toContain("Guardado local en este navegador/dispositivo");
    expect(serialized).not.toContain("official_metrics_envelope");
    expect(serialized).not.toContain("official_metrics");
    expect(serialized).not.toContain("private_metrics");
    expect(serialized).not.toContain("suitability_inputs");
    expect(serialized).not.toContain("recommendation_input");
    expect(serialized).not.toContain("optimization_input");
    expect(serialized).not.toContain("Firestore");
    expect(serialized).not.toContain("Firebase");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("metrics");
    expect(serialized).not.toContain("pms_exposure");
  });

  test("local portfolio storage reads writes versions and deletes browser data safely", async () => {
    const storage = new MemoryStorage();
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const assets = await getComparableAssets(positions.map((position) => position.asset_id));
    const savedPortfolio = createSavedLocalPortfolio({
      sourceKind: "LOCAL_MOCK",
      name: "Storage local",
      positions,
      assets,
      now: "2026-06-20T10:00:00.000Z",
      portfolioId: "local-storage"
    });

    writeLocalPortfoliosToStorage(storage, [savedPortfolio]);
    expect(readLocalPortfoliosFromStorage(storage)).toEqual([savedPortfolio]);
    expect(parseLocalPortfolios(JSON.stringify({ schema_version: "legacy", saved_portfolios: [savedPortfolio] }))).toEqual([]);

    const afterDelete = deleteLocalPortfolio(readLocalPortfoliosFromStorage(storage), "local-storage");
    writeLocalPortfoliosToStorage(storage, afterDelete);

    expect(storage.getItem(LOCAL_PORTFOLIOS_STORAGE_KEY)).toContain(LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION);
    expect(readLocalPortfoliosFromStorage(storage)).toEqual([]);
  });

  test("current portfolio draft storage keeps only source asset ids and weights", () => {
    const storage = new MemoryStorage();
    const positions = [
      {
        asset_id: "MOCK-FUND-MIXED",
        weight_percent: 120,
        label: "Clamped",
        official_metrics_envelope: { mode: "OFFICIAL_READ_MODEL" }
      },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40, suitability_inputs: { client: "real" } }
    ];
    const serialized = serializeCurrentPortfolioDraft({
      sourceKind: "LOCAL_MOCK",
      positions,
      now: "2026-06-20T11:00:00.000Z"
    });

    expect(JSON.parse(serialized).schema_version).toBe(CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION);
    expect(parseCurrentPortfolioDraft(serialized)).toEqual({
      sourceKind: "LOCAL_MOCK",
      positions: [
        { asset_id: "MOCK-FUND-MIXED", weight_percent: 100, label: "Clamped" },
        { asset_id: "MOCK-STOCK-TECH", weight_percent: 40, label: undefined }
      ]
    });
    expect(serialized).not.toContain("official_metrics_envelope");
    expect(serialized).not.toContain("suitability_inputs");
    expect(serialized).not.toContain("recommendation_input");
    expect(serialized).not.toContain("optimization_input");

    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", positions);
    expect(storage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toContain(CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 100, label: "Clamped" },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40, label: undefined }
    ]);
    expect(readCurrentPortfolioDraftFromStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE")).toEqual([]);

    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", []);
    expect(storage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  // Auditoría 11-08 (F2.7): el capital forma parte del borrador activo de
  // forma retrocompatible — payload viejo sin capital → default; con capital
  // → se restaura; inválido (negativo/NaN) → default.
  test("current portfolio draft capital persists, hydrates and rejects invalid values", () => {
    const storage = new MemoryStorage();
    const positions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];

    // Payload viejo (sin capital): F-04, el capital queda sin fijar (undefined), no 100.000.
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", positions);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();

    // Capital persistido: se restaura y una re-escritura de posiciones lo conserva.
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 250000);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(250000);
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", positions);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(250000);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 60, label: undefined },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40, label: undefined }
    ]);

    // Otra fuente ni hereda el capital ni pisa el borrador existente.
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE")).toBeUndefined();
    writeCurrentPortfolioDraftCapitalToStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE", 999999);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(250000);

    // Capital inválido (negativo/NaN): la escritura se ignora en silencio.
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", -5);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", Number.NaN);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(250000);

    // Capital inválido ya en el payload (manipulado/corrupto): sin fijar al hidratar.
    const base = JSON.parse(serializeCurrentPortfolioDraft({ sourceKind: "LOCAL_MOCK", positions })) as Record<
      string,
      unknown
    >;
    storage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, JSON.stringify({ ...base, total_capital: -100 }));
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();
    storage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, JSON.stringify({ ...base, total_capital: "muchos euros" }));
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();

    // Vaciar la cartera conserva un borrador solo-capital (F5 no resetea el capital)…
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 42000);
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", []);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([]);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(42000);

    // …y sin borrador previo, «capital sin fijar» no ensucia el storage (F-04);
    // un 100.000 tecleado a propósito sí se persiste, como cualquier otro importe.
    storage.removeItem(CURRENT_PORTFOLIO_STORAGE_KEY);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", undefined);
    expect(storage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", DEFAULT_DRAFT_TOTAL_CAPITAL);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(DEFAULT_DRAFT_TOTAL_CAPITAL);
  });

  test("current portfolio draft storage accepts live source while keeping only app-owned fields", () => {
    const serialized = serializeCurrentPortfolioDraft({
      sourceKind: "BBDD_LIVE_API",
      positions: [
        {
          asset_id: "US0378331005",
          weight_percent: 50,
          label: "Apple",
          metrics: { annualized_return_3y: 0.2 },
          official_metrics_envelope: { mode: "OFFICIAL_READ_MODEL" }
        },
        {
          asset_id: "IE00B1XNHC34",
          weight_percent: 50,
          pms_exposure: { equity: 1 }
        }
      ] as unknown as BdbManualPortfolioPosition[],
      now: "2026-06-24T12:00:00.000Z"
    });

    expect(parseCurrentPortfolioDraft(serialized)).toEqual({
      sourceKind: "BBDD_LIVE_API",
      positions: [
        { asset_id: "US0378331005", weight_percent: 50, label: "Apple" },
        { asset_id: "IE00B1XNHC34", weight_percent: 50, label: undefined }
      ]
    });
    expect(serialized).not.toContain("metrics");
    expect(serialized).not.toContain("official_metrics_envelope");
    expect(serialized).not.toContain("pms_exposure");
  });

  test("empty current portfolio from another source does not erase a saved draft", () => {
    const storage = new MemoryStorage();
    const staticPositions = [
      { asset_id: "LU0996182563", weight_percent: 40 },
      { asset_id: "IE00B1XNHC34", weight_percent: 30 },
      { asset_id: "US0378331005", weight_percent: 30 }
    ];

    writeCurrentPortfolioDraftToStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE", staticPositions);
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", []);

    expect(readCurrentPortfolioDraftFromStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE")).toEqual(staticPositions);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([]);

    writeCurrentPortfolioDraftToStorage(storage, "BBDD_STATIC_EXPORT_SAMPLE", []);
    expect(storage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("logout cleanup removes saved portfolios and current drafts", () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, "saved");
    storage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "draft");

    clearPortfolioStorage(storage);

    expect(storage.getItem(LOCAL_PORTFOLIOS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("portfolio report distributions sum by instrument and economic class", async () => {
    const report = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const byInstrument = report.summary.by_instrument_type.reduce((sum, bucket) => sum + bucket.weight_percent, 0);
    const byEconomicClass = report.summary.by_economic_asset_class.reduce(
      (sum, bucket) => sum + bucket.weight_percent,
      0
    );

    expect(byInstrument).toBe(100);
    expect(byEconomicClass).toBe(100);
  });

  test("portfolio report surfaces under and over allocation warnings", async () => {
    const underAllocated = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);
    const overAllocated = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 70 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ]);

    expect(underAllocated.summary.validation_status).toBe("UNDER_ALLOCATED");
    expect(overAllocated.summary.validation_status).toBe("OVER_ALLOCATED");
    expect(underAllocated.warnings.some((warning) => warning.includes("debajo de 100"))).toBe(true);
    expect(overAllocated.warnings.some((warning) => warning.includes("supera 100"))).toBe(true);
  });

  test("portfolio report keeps stock without requiring costs", async () => {
    const report = await buildManualPortfolioReport([{ asset_id: "MOCK-STOCK-TECH", weight_percent: 100 }]);
    const stock = report.positions[0];

    expect(stock.instrument_type).toBe("STOCK");
    expect(stock.economic_asset_class).toBe("EQUITY");
    expect(report.summary.weighted_metrics.annualized_return_3y).toBeDefined();
  });

  test("portfolio report data diagnostic falls back without enriched fields", async () => {
    const report = await buildManualPortfolioReport([{ asset_id: "MOCK-STOCK-TECH", weight_percent: 100 }]);

    expect(report.data_diagnostic.total_positions).toBe(1);
    expect(report.data_diagnostic.investable_positions).toBe(1);
    expect(report.data_diagnostic.enriched_positions).toBe(0);
    expect(report.data_diagnostic.performance_preview_available).toBe(0);
    expect(report.data_diagnostic.data_quality_summary_available).toBe(0);
    expect(report.data_diagnostic.local_only_notice).toContain("no evalúa idoneidad");
  });

  test("portfolio report flags non-investable index as benchmark warning when present", async () => {
    const report = await buildManualPortfolioReport([
      { asset_id: "MOCK-ETF-WATER", weight_percent: 70 },
      { asset_id: "MOCK-INDEX-GLOBAL", weight_percent: 30 }
    ]);
    const index = report.positions.find((position) => position.instrument_type === "INDEX");

    expect(index?.role).toBe("BENCHMARK");
    expect(index?.is_investable).toBe(false);
    expect(report.summary.non_investable_assets).toContain("MOCK-INDEX-GLOBAL");
    expect(report.data_diagnostic.investable_positions).toBe(1);
    expect(report.data_diagnostic.excluded_non_investable_positions).toBe(1);
    expect(report.xray.investable_positions).toBe(1);
    expect(report.xray.excluded_non_investable_positions).toBe(1);
    expect(report.xray.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
    expect(report.xray.data_risk_signals.some((signal) => signal.includes("Índices y activos no invertibles"))).toBe(true);
    expect(report.summary.by_instrument_type.some((bucket) => bucket.key === "INDEX")).toBe(false);
    expect(report.summary.weighted_metrics.annualized_return_3y).toBe(0.061);
    expect(report.warnings.some((warning) => warning.includes("benchmark/no invertible"))).toBe(true);
  });

  test("portfolio report includes weighted mock max drawdown when available", async () => {
    const report = await buildManualPortfolioReport([
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 50 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 50 }
    ]);

    expect(report.summary.weighted_metrics.max_drawdown_5y).toBeDefined();
  });

  test("buildOptimizationInput does not filter ETFs or stocks by default", async () => {
    const input = await buildOptimizationInput();
    const instrumentTypes = new Set(input.assets.map((asset) => asset.instrument_type));

    expect(instrumentTypes.has("ETF")).toBe(true);
    expect(instrumentTypes.has("STOCK")).toBe(true);
    expect(input.assets.every((asset) => asset.instrument_type !== "INDEX")).toBe(true);
  });

  test("buildOptimizationInput excludes requested index benchmark from investable optimization input", async () => {
    const input = await buildOptimizationInput({
      positions: [
        { asset_id: "MOCK-ETF-WATER", weight: 0.7 },
        { asset_id: "MOCK-INDEX-GLOBAL", weight: 0.3, label: "Benchmark reference" }
      ]
    });
    const benchmark = input.assets.find((asset) => asset.instrument_type === "INDEX");

    expect(input.source).toBe("LOCAL_MOCK");
    expect(input.positions).toHaveLength(1);
    expect(input.positions[0].asset_id).toBe("MOCK-ETF-WATER");
    expect(benchmark).toBeUndefined();
    expect(input.warnings.some((warning) => warning.code === "NON_INVESTABLE_BENCHMARK")).toBe(true);
  });

  test("instrument_type and economic_asset_class remain separate concepts", async () => {
    const stock = await getAssetDetail("MOCK-STOCK-TECH");

    expect(stock?.instrument_type).toBe("STOCK");
    expect(stock?.economic_asset_class).toBe("EQUITY");
    expect(stock?.instrument_type).not.toBe(stock?.economic_asset_class);
  });

  test("serialized public payloads do not expose forbidden legacy or secret markers", async () => {
    const previewPositions = [
      { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
      { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
      { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
    ];
    const previewAssets = await getComparableAssets(previewPositions.map((position) => position.asset_id));
    const previewSummary = await buildManualPortfolioSummary(previewPositions);
    const payloads = [
      await searchAssets(),
      await getAssetDetail("MOCK-ETF-WATER"),
      await getComparableAssets(["MOCK-FUND-GLOBAL-BOND", "MOCK-ETF-WATER", "MOCK-STOCK-TECH", "MOCK-INDEX-GLOBAL"]),
      await buildManualPortfolioSummary([
        { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
        { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
        { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
      ]),
      await buildManualPortfolioOptimizationPreview([
        { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
        { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
        { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
      ]),
      await buildManualPortfolioReport([
        { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
        { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
        { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
      ]),
      buildLocalOptimizationPreview({
        sourceKind: "LOCAL_MOCK",
        positions: previewPositions,
        assets: previewAssets,
        summary: previewSummary
      }),
      buildLocalRiskProfilePreview({
        sourceKind: "LOCAL_MOCK",
        selectedProfileId: "RISK_5",
        positions: previewPositions,
        assets: previewAssets,
        summary: previewSummary
      }),
      await buildOptimizationInput()
    ];

    for (const payload of payloads) {
      expectNoForbiddenPayloadStrings(payload);
    }
  });
});
