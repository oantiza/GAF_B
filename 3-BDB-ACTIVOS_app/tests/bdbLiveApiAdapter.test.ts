import { describe, expect, test } from "vitest";
import { bdbLiveApiAdapterTestHelpers } from "../src/adapters/bdbLiveApiAdapter";
import {
  parseLiveAssetDetailResponse,
  parseLiveCompareResponse,
  parseLiveResolvedPortfolio,
  parseLiveSearchResponse
} from "../src/adapters/bdbLiveApiContracts";
import { AppError } from "../src/core/appError";
import { buildReportFromAssets, computePmsExposureDistribution } from "../src/core/portfolio";
import { recuentoEnPantalla } from "../src/core/medidaDeLaCartera";

describe("a una acción no le aplica publicar cartera (decisiones 10 y 17)", () => {
  const resumen = (marcas: string[], avisos: number) => ({
    coverage_status: "COMPLETE", has_identity: true, has_metrics: true, has_pms_exposure: true, has_costs: false, has_holdings_summary: true,
    has_fundamentals: false, has_history_years: false, quality_flags: marcas, warnings_count: avisos
  });
  const crudo = (asset_id: string, instrument_type: string, marcas: string[]) => ({
    asset_id, instrument_type, identity: { display_name: asset_id, currency: "EUR" }, metrics: {}, is_investable: true, role: "INVESTABLE",
    quality_flags: marcas, data_quality_summary: resumen(marcas, marcas.length)
  }) as unknown as Parameters<typeof bdbLiveApiAdapterTestHelpers.mapDetail>[0];

  test("el servidor la marca igual, y en la acción deja de ser un aviso: ni marca, ni aviso, ni cuenta", () => {
    const accion = bdbLiveApiAdapterTestHelpers.mapDetail(crudo("ES0144580Y14", "STOCK", ["MISSING_HOLDINGS"]));
    expect(accion.quality_flags).toEqual([]);
    expect(accion.warnings).toEqual([]);
    expect(accion.data_quality_summary).toMatchObject({ quality_flags: [], warnings_count: 0 });
  });

  test("un fondo o un ETF sin cartera siguen avisando, y a una acción se le quita solo esa marca", () => {
    for (const tipo of ["FUND", "ETF"]) {
      const activo = bdbLiveApiAdapterTestHelpers.mapDetail(crudo("X", tipo, ["MISSING_HOLDINGS"]));
      expect(activo.quality_flags, tipo).toEqual(["MISSING_HOLDINGS"]);
      expect(activo.data_quality_summary, tipo).toMatchObject({ quality_flags: ["MISSING_HOLDINGS"], warnings_count: 1 });
    }
    const conOtra = bdbLiveApiAdapterTestHelpers.mapDetail(crudo("ES0144580Y14", "STOCK", ["MISSING_HOLDINGS", "MISSING_QUANT_METRICS"]));
    expect(conOtra.quality_flags).toEqual(["MISSING_QUANT_METRICS"]);
    expect(conOtra.data_quality_summary).toMatchObject({ quality_flags: ["MISSING_QUANT_METRICS"], warnings_count: 1 });
  });

  test("en el buscador tampoco", () => {
    const fila = (tipo: string) => ({ asset_id: "X", display_name: "X", instrument_type: tipo, quality_flags: ["MISSING_HOLDINGS"], is_investable: true, role: "INVESTABLE" }) as unknown as Parameters<typeof bdbLiveApiAdapterTestHelpers.mapSearch>[0];
    expect(bdbLiveApiAdapterTestHelpers.mapSearch(fila("STOCK")).quality_flags).toEqual([]);
    expect(bdbLiveApiAdapterTestHelpers.mapSearch(fila("ETF")).quality_flags).toEqual(["MISSING_HOLDINGS"]);
  });

  test("resultado conocido: un ETF sin cartera, un fondo y dos acciones dan un solo aviso, el del ETF, en el informe y en el recuento de pantalla", () => {
    const assets = [
      bdbLiveApiAdapterTestHelpers.mapDetail(crudo("ETF_SIN", "ETF", ["MISSING_HOLDINGS"])),
      bdbLiveApiAdapterTestHelpers.mapDetail(crudo("FONDO", "FUND", [])),
      bdbLiveApiAdapterTestHelpers.mapDetail(crudo("ACCION_1", "STOCK", ["MISSING_HOLDINGS"])),
      bdbLiveApiAdapterTestHelpers.mapDetail(crudo("ACCION_2", "STOCK", ["MISSING_HOLDINGS"]))
    ];
    const informe = buildReportFromAssets({
      source: "BBDD_LIVE_API", portfolioName: "Prueba", assets,
      manualPositions: assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 25 }))
    });
    expect(informe.warnings.filter((aviso) => aviso.includes("Sin cartera publicada"))).toEqual(["ETF_SIN · Sin cartera publicada."]);
    expect(recuentoEnPantalla(informe.positions, []).conAvisos).toBe(1);
  });
});

describe("el reparto por sectores llega con las claves de la casa", () => {
  test("los nombres del proveedor de un fondo de la base vieja no abren otra fila", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "LU0591059224", instrument_type: "FUND", identity: { display_name: "Robeco", currency: "EUR" },
      exposure_detail: { sectors: { Technology: 0.414, "Financial Services": 0.177 } }
    } as unknown as Parameters<typeof bdbLiveApiAdapterTestHelpers.mapDetail>[0]);
    expect(asset.exposure_detail?.sectors).toEqual({ technology: 0.414, financial_services: 0.177 });
  });
});

describe("BBDD live API adapter guards", () => {
  test("deja pasar los costes de operación y la entrada con su fuente (decisión 43), y una fuente que no conoce no se cree", () => {
    const raw = {
      asset_id: "LU1883318740", instrument_type: "FUND", identity: { display_name: "Un fondo", currency: "EUR" }, metrics: {}, quality_flags: [],
      costs: {
        ongoing_charge: 0.0208, management_fee: 0.015, transaction_costs: 0.0037, entry_charge: 0.045,
        document_url: "https://ejemplo.invalid/kid.pdf", document_date: "2026-08-19",
        ongoing_charge_source: "KID", transaction_costs_source: "PROVIDER", entry_charge_source: "OTRA"
      }
    };
    const { costs } = bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse(raw)!);
    expect(costs).toEqual({
      ongoing_charge: 0.0208, management_fee: 0.015, transaction_costs: 0.0037, entry_charge: 0.045,
      document_url: "https://ejemplo.invalid/kid.pdf", document_date: "2026-08-19",
      ongoing_charge_source: "KID", transaction_costs_source: "PROVIDER", entry_charge_source: undefined
    });
    /* Un activo sin costes sigue sin ellos: no se rellena nada. */
    expect(bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse({ ...raw, costs: null })!).costs).toBeUndefined();
  });
  test.each(["NON_INVESTABLE_DELISTED", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", "NON_INVESTABLE_NEVER_RESOLVED"])(
    "%s conserva el motivo y bloquea también respuestas incompletas o incoherentes", (flag) => {
      for (const isInvestable of [false, true, undefined]) {
        const raw = {
          asset_id: "RESTRICTED", instrument_type: "FUND", is_investable: isInvestable,
          identity: { display_name: "Restricted", currency: "EUR" },
          quality_flags: [flag], metrics: { annualized_return_3y: 0.04 }
        };
        const detail = bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse(raw)!);
        const search = bdbLiveApiAdapterTestHelpers.mapSearch(raw);
        for (const asset of [detail, search]) {
          expect(asset.is_investable).toBe(false);
          expect(asset.role).toBe("INVESTABLE");
          expect(asset.quality_flags).toContain(flag);
          expect(asset.quality_flags).not.toContain("NON_INVESTABLE_BENCHMARK");
          expect(asset.metrics.annualized_return_3y).toBe(0.04);
          expect(asset.warnings[0].message).not.toContain(flag);
        }
      }
    }
  );
  test("un fondo dado de baja conserva sus métricas y no se convierte en benchmark", () => {
    const raw = {
      asset_id: "ES0127097030", instrument_type: "FUND", is_investable: false,
      identity: { display_name: "DUX Rentinver", currency: "EUR" },
      quality_flags: ["NON_INVESTABLE_CORPORATE_ACTION"], metrics: { annualized_return_3y: 0.04 }
    };
    const detail = bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse(raw)!);
    expect(detail.is_investable).toBe(false);
    expect(detail.instrument_type).toBe("FUND");
    expect(detail.metrics.annualized_return_3y).toBe(0.04);
    expect(detail.quality_flags).toContain("NON_INVESTABLE_CORPORATE_ACTION");
    expect(detail.quality_flags).not.toContain("NON_INVESTABLE_BENCHMARK");
    const resolved = parseLiveResolvedPortfolio({ rows: [{ ...raw, role: "INVESTABLE" }] });
    expect(resolved.rows[0].is_investable).toBe(false);
  });
  test("preserves ten-year volatility and Sharpe from the live contract", () => {
    const parsed = parseLiveAssetDetailResponse({
      asset_id: "LIVE-TEN-YEARS",
      identity: { display_name: "Ten years", currency: "EUR" },
      instrument_type: "FUND",
      metrics: { volatility_10y: 0.19, sharpe_10y: 0.6 },
      pms_exposure: { equity: 1 }
    });
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail(parsed!);
    expect(asset.metrics.volatility_10y).toBe(0.19);
    expect(asset.metrics.sharpe_10y).toBe(0.6);
    expect(asset.performance_preview?.volatility_10y).toBe(0.19);
    expect(asset.performance_preview?.sharpe_10y).toBe(0.6);
  });

  test("derives investable defaults from role and supported instrument type", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "LIVE-STOCK-MISSING-FLAGS",
      identity: { display_name: "Live Stock", currency: "EUR" },
      instrument_type: "STOCK",
      economic_asset_class: "EQUITY",
      metrics: { annualized_return_3y: 0.05 },
      pms_exposure: { equity: 1 }
    });

    expect(asset.instrument_type).toBe("STOCK");
    expect(asset.role).toBe("INVESTABLE");
    expect(asset.is_investable).toBe(true);
    expect(asset.coverage_status).toBe("PARTIAL");
  });

  test("keeps live OTHER ETC payload instrument type from backend with warning", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "IE00B4ND3602",
      identity: { display_name: "iShares Physical Gold ETC", currency: "USD" },
      instrument_type: "OTHER",
      economic_asset_class: "OTHER",
      product: { product_type: "ETC" },
      quality_flags: [],
      pms_exposure: { other: 1 }
    });

    expect(asset.instrument_type).toBe("FUND");
    expect(asset.economic_asset_class).toBe("OTHER");
    expect(asset.is_investable).toBe(true);
    expect(asset.quality_flags).toEqual(expect.arrayContaining(["UNSUPPORTED_INSTRUMENT_TYPE", "PARTIAL_COVERAGE"]));
    expect(asset.warnings.some((warning) => warning.code === "UNSUPPORTED_INSTRUMENT_TYPE")).toBe(true);
  });

  test("keeps INDEX non-investable even if the live payload omits role fields", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapSearch({
      asset_id: "LIVE-INDEX",
      display_name: "Live Index",
      instrument_type: "INDEX",
      economic_asset_class: "EQUITY",
      currency: "EUR",
      quality_flags: []
    });

    expect(asset.role).toBe("BENCHMARK");
    expect(asset.is_investable).toBe(false);
  });

  test("passes official product benchmark through without changing investability", () => {
    const detail = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "LIVE-FUND-BENCHMARKED",
      identity: { display_name: "Live Fund With Benchmark", currency: "EUR" },
      instrument_type: "FUND",
      economic_asset_class: "EQUITY",
      product: {
        provider: "Live AM",
        benchmark: "MSCI World NR EUR"
      },
      metrics: { annualized_return_3y: 0.08 },
      pms_exposure: { equity: 1 }
    });
    const search = bdbLiveApiAdapterTestHelpers.mapSearch({
      asset_id: "LIVE-FUND-BENCHMARKED",
      display_name: "Live Fund With Benchmark",
      instrument_type: "FUND",
      economic_asset_class: "EQUITY",
      currency: "EUR",
      official_benchmark: { name: "MSCI World NR EUR", source: "factsheet" }
    });

    expect(detail.role).toBe("INVESTABLE");
    expect(detail.is_investable).toBe(true);
    expect(detail.official_benchmark).toMatchObject({
      name: "MSCI World NR EUR",
      source: "BBDD_ACTIVOS"
    });
    expect(search.official_benchmark).toMatchObject({
      name: "MSCI World NR EUR",
      source: "factsheet"
    });
  });

  test("la réplica del proveedor llega a product_profile desde compare_assets (12-11-2026, el ETF de bancos de Invesco)", () => {
    /* La forma que devuelve el servidor contra la base nueva: el ETF por swap trae la réplica y no tiene cartera guardada. */
    const [fila] = parseLiveCompareResponse({
      assets: [{
        asset_id: "IE00B3Q19T94",
        instrument_type: "ETF",
        economic_asset_class: "EQUITY",
        identity: { display_name: "Invesco EURO STOXX Optimised Banks UCITS ETF", isin: "IE00B3Q19T94", currency: "EUR" },
        holdings_summary: { has_holdings: false },
        product: { replication: "SYNTHETIC" }
      }]
    });
    expect(bdbLiveApiAdapterTestHelpers.mapDetail(fila).product_profile?.replication).toBe("SYNTHETIC");
  });

  test("maps descriptive product and sustainability fields when live payload includes them", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "LIVE-FUND-PROFILE",
      identity: { display_name: "Live Fund Profile", currency: "EUR" },
      instrument_type: "FUND",
      economic_asset_class: "MIXED",
      product: {
        provider: "Live AM",
        product_type: "UCITS Fund",
        domicile: "LU",
        share_class: "A Acc EUR",
        distribution_policy: "ACC",
        ucits: true
      },
      classification: {
        sector: "Technology",
        strategy: "Quality growth"
      },
      sustainability: {
        sfdr: "Article 8",
        esg_rating: "A",
        sustainability_rating: 4
      },
      pms_exposure: { equity: 0.5, fixed_income: 0.45, cash: 0.05 }
    });

    expect(asset.product_profile).toMatchObject({
      product_type: "UCITS Fund",
      domicile: "LU",
      share_class: "A Acc EUR",
      distribution_policy: "ACC",
      ucits: true
    });
    expect(asset.sector).toBe("Technology");
    expect(asset.strategy).toBe("Quality growth");
    expect(asset.sustainability_profile).toMatchObject({
      sfdr: "Article 8",
      esg_rating: "A",
      sustainability_rating: 4
    });
  });

  test("validates and exposes the compact EODHD fundamentals projection", () => {
    const parsed = parseLiveAssetDetailResponse({
      asset_id: "LIVE-STOCK-FUNDAMENTALS",
      instrument_type: "STOCK",
      identity: { display_name: "Live Stock", currency: "EUR" },
      pms_exposure: { equity: 1 },
      fundamentals_summary: {
        schema_version: "bdb.fundamentals-summary.v1",
        source: "eodhd",
        as_of_date: "2026-06-30",
        fetched_at: "2026-07-18T10:00:00+00:00",
        currency: "EUR",
        coverage_status: "COMPLETE",
        profile: { sector: "Financial Services" },
        valuation: { pe_trailing: 9.5 },
        profitability: { return_on_equity_ttm: 0.12 }
      }
    });

    expect(parsed).not.toBeNull();
    const mapped = bdbLiveApiAdapterTestHelpers.mapDetail(parsed!);
    expect(mapped.fundamentals_summary).toMatchObject({
      source: "eodhd",
      coverage_status: "COMPLETE",
      valuation: { pe_trailing: 9.5 },
      profitability: { return_on_equity_ttm: 0.12 }
    });
  });

  test("rejects malformed nested EODHD fundamentals metrics", () => {
    expect(() => parseLiveAssetDetailResponse({
      asset_id: "LIVE-STOCK-BAD-FUNDAMENTALS",
      instrument_type: "STOCK",
      pms_exposure: { equity: 1 },
      fundamentals_summary: {
        schema_version: "bdb.fundamentals-summary.v1",
        source: "eodhd",
        coverage_status: "PARTIAL",
        valuation: { pe_trailing: "9.5" }
      }
    })).toThrow(AppError);
  });

  test("requires the search result list instead of treating a malformed response as empty", () => {
    expect(() => parseLiveSearchResponse({ source: "BBDD_FIRESTORE_LIVE" })).toThrow(AppError);
    expect(() => parseLiveSearchResponse({ assets: "not-an-array" })).toThrow(AppError);
  });

  test("rejects non-numeric financial metrics before they reach calculations", () => {
    expect(() => parseLiveSearchResponse({
      assets: [{
        asset_id: "LIVE-FUND",
        instrument_type: "FUND",
        metrics: { annualized_return_3y: "0.08" }
      }]
    })).toThrow(AppError);

    expect(() => parseLiveSearchResponse({
      assets: [{
        asset_id: "LIVE-FUND",
        instrument_type: "FUND",
        is_investable: "true"
      }]
    })).toThrow(AppError);
  });

  test("normalizes nullable detail fields and the numeric historical drawdown shape", () => {
    const parsed = parseLiveAssetDetailResponse({
      asset_id: "LIVE-FUND",
      instrument_type: "FUND",
      identity: {
        display_name: "Live Fund",
        isin: null,
        ticker: null,
        currency: "EUR",
        region: null
      },
      metrics: {
        annualized_return_3y: 0.08,
        max_drawdown_hist: -0.31,
        max_drawdown_hist_date: "2020-03-16"
      },
      performance_preview: {
        available: true,
        annualized_return_3y: 0.08,
        max_drawdown_hist: -0.31,
        max_drawdown_hist_date: "2020-03-16",
        latest_value: null,
        latest_value_date: null,
        source: "METRICS_LATEST"
      },
      pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 },
      holdings_summary: {
        has_holdings: false,
        positions_count: null,
        top10_weight: null,
        as_of_date: null,
        full_holdings_loaded: false
      }
    });

    expect(parsed).not.toBeNull();
    const mapped = bdbLiveApiAdapterTestHelpers.mapDetail(parsed!);
    expect(mapped.isin).toBeUndefined();
    expect(mapped.holdings_summary?.positions_count).toBeUndefined();
    expect(mapped.performance_preview?.latest_value).toBeUndefined();
    expect(mapped.performance_preview?.max_drawdown_hist).toEqual({ value: -0.31, date: "2020-03-16" });
  });

  test("keeps the requested id of a resolved row (alias resuelto al sucesor)", () => {
    const result = parseLiveResolvedPortfolio({
      rows: [
        { asset_id: "LU3038481936", requested_asset_id: "ES0141116030", instrument_type: "FUND" },
        { asset_id: "LIVE-FUND", instrument_type: "FUND" }
      ]
    });
    expect(result.rows[0].requested_asset_id).toBe("ES0141116030");
    expect(result.rows[1].requested_asset_id).toBeUndefined();
    const invalid = parseLiveResolvedPortfolio({ rows: [{ asset_id: "X", requested_asset_id: 7, instrument_type: "FUND" }] });
    expect(invalid.rows).toEqual([]);
    expect(invalid.discarded_rows).toEqual([
      { index: 0, asset_id: "X", requested_asset_id: undefined, reason: expect.stringContaining("rows[0].requested_asset_id") }
    ]);
  });

  test("una fila de resolve_portfolio fuera de contrato se descarta sola y el resto se carga", () => {
    const result = parseLiveResolvedPortfolio({
      rows: [
        { asset_id: "GOOD", instrument_type: "FUND" },
        { asset_id: "BAD", instrument_type: "FUND", metrics: { volatility_3y: "alta" } },
        null,
        { asset_id: "", instrument_type: "FUND" }
      ]
    });
    expect(result.rows.map((row) => row.asset_id)).toEqual(["GOOD"]);
    expect(result.discarded_rows.map((row) => [row.index, row.asset_id])).toEqual([[1, "BAD"], [2, undefined], [3, ""]]);
    // La forma de la respuesta sigue siendo obligatoria.
    expect(() => parseLiveResolvedPortfolio({ rows: "ninguna" })).toThrow(AppError);
  });

  test("rejects duplicate compare rows and a resolve response without rows", () => {
    const detail = {
      asset_id: "LIVE-FUND",
      instrument_type: "FUND",
      pms_exposure: { equity: 1 }
    };
    expect(() => parseLiveCompareResponse({ assets: [detail, detail] })).toThrow(AppError);
    expect(() => parseLiveResolvedPortfolio({ warnings: [], positions: [] })).toThrow(AppError);
  });

  test("validates and preserves a well-formed portfolio resolution", () => {
    const result = parseLiveResolvedPortfolio({
      rows: [
        {
          asset_id: "LIVE-FUND",
          weight: 75,
          display_name: "Live Fund",
          instrument_type: "FUND",
          economic_asset_class: "EQUITY",
          coverage_status: "COMPLETE",
          metrics: { volatility_3y: 0.12 },
          pms_exposure: { equity: 1 }
        },
        {
          asset_id: "LIVE-FUND",
          weight: 25,
          display_name: "Live Fund",
          instrument_type: "FUND",
          economic_asset_class: "EQUITY",
          coverage_status: "COMPLETE",
          metrics: { volatility_3y: 0.12 },
          pms_exposure: { equity: 1 }
        }
      ],
      warnings: [],
      positions: [{ asset_id: "LIVE-FUND", weight: 75 }, { asset_id: "LIVE-FUND", weight: 25 }]
    });

    expect(result.rows[0]).toMatchObject({ asset_id: "LIVE-FUND", weight: 75 });
    expect(result.rows).toHaveLength(2);
    expect(result.positions).toHaveLength(2);
  });

  /* Ola A1 (A1.2). El bug real de producción: la fuente en vivo sin
     pms_exposure fabricaba { other: 1 }, que el core trataba como vector
     REAL — un fondo de renta variable sin cartera publicada salía como
     100 % «Otros» y la cobertura marcaba 100 %. El test anterior inyectaba
     null directamente al core y no podía cazarlo: este pasa por el adapter. */
  test("sin vector PMS en vivo, el activo cae al reparto por clase económica, no a «Otros»", () => {
    const asset = bdbLiveApiAdapterTestHelpers.mapDetail({
      asset_id: "LU0000000009",
      identity: { display_name: "Fondo RV sin cartera publicada", currency: "EUR" },
      instrument_type: "FUND",
      economic_asset_class: "EQUITY",
      quality_flags: ["MISSING_HOLDINGS"]
    });

    // El adapter ya no inventa exposición: vector vacío (suma 0) y real_asset presente.
    expect(asset.pms_exposure).toEqual({
      equity: 0,
      fixed_income: 0,
      cash: 0,
      alternative: 0,
      real_asset: 0,
      other: 0
    });

    // Y la vía canónica del core lo reparte por su clase, con cobertura 0.
    const distribution = computePmsExposureDistribution([
      {
        weight_percent: 100,
        pms_exposure: asset.pms_exposure,
        economic_asset_class: asset.economic_asset_class
      }
    ]);
    expect(distribution).not.toBeNull();
    expect(distribution!.percent.equity).toBeCloseTo(100, 6);
    expect(distribution!.percent.other).toBeCloseTo(0, 6);
    expect(distribution!.covered_weight_percent).toBeCloseTo(0, 6);
    expect(distribution!.fallback_weight_percent).toBeCloseTo(100, 6);
  });

  /* Plan «Mejorar cartera», fase 1: el readmodel publica fixed_income_profile
     (ya en fracción 0..1) y la ficha lo recibe tal cual. */
  describe("fixed_income_profile", () => {
    const base = {
      asset_id: "DE000A0X7541",
      identity: { display_name: "Fondo RF Flexible", currency: "EUR" },
      instrument_type: "FUND",
      economic_asset_class: "FIXED_INCOME",
      pms_exposure: { fixed_income: 0.78, cash: 0.22 }
    };

    test("fondo de renta fija con dato: duración, calidad, IG/HY y tipos de bono llegan a la ficha", () => {
      const parsed = parseLiveAssetDetailResponse({
        ...base,
        fixed_income_profile: {
          effective_duration: 3.79,
          modified_duration: 3.79,
          effective_maturity: 8.76,
          avg_credit_quality: "BBB+",
          yield_to_maturity: 0.0362,
          investment_grade_pct: 0.5449,
          high_yield_pct: 0.4183,
          bond_types: { corporate: 0.540825, cash: 0.22268, government: 0.236494 }
        }
      });
      const asset = bdbLiveApiAdapterTestHelpers.mapDetail(parsed!);
      expect(asset.fixed_income_profile).toEqual({
        effective_duration: 3.79,
        modified_duration: 3.79,
        effective_maturity: 8.76,
        avg_credit_quality: "BBB+",
        yield_to_maturity: 0.0362,
        investment_grade_pct: 0.5449,
        high_yield_pct: 0.4183,
        bond_types: { corporate: 0.540825, cash: 0.22268, government: 0.236494 }
      });
    });

    test("fondo de renta variable con tipos de bono a cero: el perfil no se fabrica", () => {
      const parsed = parseLiveAssetDetailResponse({
        ...base,
        economic_asset_class: "EQUITY",
        pms_exposure: { equity: 1 },
        fixed_income_profile: { bond_types: { government: 0, corporate: 0, cash: 0 } }
      });
      const asset = bdbLiveApiAdapterTestHelpers.mapDetail(parsed!);
      expect(asset.fixed_income_profile).toBeUndefined();
    });

    test("ausente o null: la ficha no lleva perfil de renta fija", () => {
      const missing = bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse(base)!);
      expect(missing.fixed_income_profile).toBeUndefined();
      const nulled = bdbLiveApiAdapterTestHelpers.mapDetail(
        parseLiveAssetDetailResponse({ ...base, fixed_income_profile: null })!
      );
      expect(nulled.fixed_income_profile).toBeUndefined();
    });

    test("un perfil mal formado rompe el contrato de lectura", () => {
      expect(() =>
        parseLiveAssetDetailResponse({ ...base, fixed_income_profile: { effective_duration: "3,79" } })
      ).toThrow(AppError);
      expect(() =>
        parseLiveAssetDetailResponse({ ...base, fixed_income_profile: { bond_types: { corporate: "alto" } } })
      ).toThrow(AppError);
    });
  });
});
