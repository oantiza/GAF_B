import { describe, expect, test } from "vitest";
import {
  canApplyRefreshAssetPrices,
  describeHistoryRebuild,
  parseAdminAssetDetail,
  parseAdminAssetsPage,
  parseAdminBackfillBatch,
  parseAdminBackfillCandidates,
  parseAdminDbStatus,
  parseAdminIngestAsset,
  parseAdminRecomputeMetric,
  parseAdminRefreshAllStale,
  parseAdminRefreshAssetPrices,
  refreshSampleRebuildLabel
} from "../src/adapters/adminBackend";
import { AppError } from "../src/core/appError";

function assetRow(assetId = "ES0123456789") {
  return {
    asset_id: assetId,
    name: "Fondo de prueba",
    type: "FUND",
    symbol: null,
    currency: "EUR",
    first_date: "2011-01-03",
    last_date: "2026-07-09",
    points: 3900,
    year_docs: 16,
    years: 15,
    has_vol: true,
    has_sharpe: true,
    has_srri: true,
    has_mdd: true,
    has_mdd_hist: true,
    flags: []
  };
}

function dbStatus() {
  return {
    generated_at: "2026-07-10T09:00:00Z",
    total_assets: 3,
    by_type: { FUND: 2, ETF: 1 },
    with_history: 2,
    without_history: 1,
    reach_2011: 1,
    not_reach_2011: 1,
    stale: 1,
    stale_days_threshold: 5,
    last_refresh_date: "2026-07-10",
    latest_data_date: "2026-07-09",
    latest_by_type: { FUND: "2026-07-09", ETF: "2026-07-08" },
    most_lagged: [
      { asset_id: "IE0123456789", name: "ETF de prueba", type: "ETF", last_date: "2026-06-30" }
    ],
    master_writes_enabled: false,
    master_writes_env: "BDB_ACTIVOS_ENABLE_MASTER_WRITES",
    master_writes_mode: "disabled",
    app_check_enforced: true,
    metrics_present: { vol: 2, sharpe: 2, srri: 2, mdd: 2, mdd_hist: 2 },
    start_year_histogram: { "2011": 1, "2020": 1 },
    anomalies: {
      sin_historico: 1,
      desactualizados: 1,
      no_llega_2011: 1,
      valle_reciente: 0,
      total_flagged: 2
    }
  };
}

function backfillResult() {
  return {
    asset_id: "ES0123456789",
    ok: true,
    applied: false,
    skipped: null,
    reason: null,
    resolution: "SEARCH_EXACT",
    symbol: "TEST.MC",
    currency: "EUR",
    points: 4200,
    first_date: "2010-01-04",
    last_date: "2026-07-09",
    years: 17,
    docs_created: 0,
    error: null
  };
}

describe("admin backend contracts", () => {
  test("accepts a reconciled database status and preserves operating gates", () => {
    const result = parseAdminDbStatus(dbStatus());

    expect(result.total_assets).toBe(3);
    expect(result.master_writes_mode).toBe("disabled");
    expect(result.app_check_enforced).toBe(true);
    expect(result.most_lagged?.[0].last_date).toBe("2026-06-30");
  });

  test("rejects inconsistent database totals and anomaly counts", () => {
    const badTypeTotal = dbStatus();
    badTypeTotal.by_type.FUND = 3;
    expect(() => parseAdminDbStatus(badTypeTotal)).toThrow(AppError);

    const badAnomaly = dbStatus();
    badAnomaly.anomalies.sin_historico = 0;
    expect(() => parseAdminDbStatus(badAnomaly)).toThrow(AppError);
  });

  test("validates paginated assets, duplicate ids and page bounds", () => {
    const page = parseAdminAssetsPage({ total: 2, offset: 0, limit: 2, items: [assetRow(), assetRow("LU0123456789")] });
    expect(page.items).toHaveLength(2);

    const unnamed = assetRow();
    unnamed.name = "";
    expect(parseAdminAssetsPage({ total: 1, offset: 0, limit: 1, items: [unnamed] }).items[0].name).toBe("");

    expect(() => parseAdminAssetsPage({ total: 2, offset: 0, limit: 2, items: [assetRow(), assetRow()] })).toThrow(AppError);
    expect(() => parseAdminAssetsPage({ total: 1, offset: 1, limit: 2, items: [assetRow()] })).toThrow(AppError);
  });

  test("validates asset detail series and included gap count", () => {
    const detail = {
      meta: assetRow(),
      identifiers: { isin: "ES0123456789" },
      classification: { asset_class: "FUND" },
      max_drawdown: { pct: -18.2, periodo: "5a" },
      max_drawdown_hist: { pct: -31.4, fecha: "2020-03-16" },
      series: {
        points: 3900,
        first_date: "2011-01-03",
        last_date: "2026-07-09",
        duplicates: 0,
        non_positive: 0,
        big_gaps: [{ from: "2025-12-19", to: "2026-01-02", days: 14 }],
        big_gaps_count: 1
      }
    };

    expect(parseAdminAssetDetail(detail).series.big_gaps_count).toBe(1);
    detail.series.big_gaps_count = 0;
    expect(() => parseAdminAssetDetail(detail)).toThrow(AppError);
  });

  test("reads the drawdowns in the metrics contract shape (value/date, decimal)", () => {
    const base = {
      meta: assetRow(),
      identifiers: { isin: "ES0123456789" },
      classification: { asset_class: "FUND" },
      series: {
        points: 10, first_date: "2011-01-03", last_date: "2026-07-09",
        duplicates: 0, non_positive: 0, big_gaps: [], big_gaps_count: 0
      }
    };
    const current = parseAdminAssetDetail({
      ...base,
      max_drawdown_5y: { value: -0.182 },
      max_drawdown_hist: { value: -0.314, date: "2020-03-16" }
    });
    expect(current.max_drawdown_5y).toEqual({ value: -0.182 });
    expect(current.max_drawdown_hist).toEqual({ value: -0.314, date: "2020-03-16" });

    // Backend anterior al cambio: metrics/latest tal cual o el root legado en porcentaje.
    const legacy = parseAdminAssetDetail({
      ...base,
      max_drawdown: { pct: -18.2, periodo: "5a" },
      max_drawdown_hist: { pct: -31.4, fecha: "2020-03-16" }
    });
    expect(legacy.max_drawdown_5y?.value).toBeCloseTo(-0.182, 10);
    expect(legacy.max_drawdown_hist).toEqual({ value: -0.314, date: "2020-03-16" });

    // Transición (14-10-2026): el backend manda también la clave antigua; manda la nueva.
    const both = parseAdminAssetDetail({
      ...base,
      max_drawdown_5y: { value: -0.153 },
      max_drawdown: { pct: -15.3, periodo: "5a" },
      max_drawdown_hist: { value: -0.284, date: "2026-10-05" }
    });
    expect(both.max_drawdown_5y).toEqual({ value: -0.153 });

    const empty = parseAdminAssetDetail({ ...base, max_drawdown_5y: null, max_drawdown: null, max_drawdown_hist: null });
    expect(empty.max_drawdown_5y).toBeNull();
    expect(empty.max_drawdown_hist).toBeNull();

    expect(() => parseAdminAssetDetail({ ...base, max_drawdown_hist: { value: "-0.3" } })).toThrow(AppError);
  });

  test("distinguishes preview and applied refresh batches", () => {
    const preview = {
      processed: 3,
      updated: 0,
      would_update: 2,
      applied: false,
      skipped: 1,
      errors: 0,
      sample: [{ asset_id: "ES0123456789", last_date: "2026-07-01", new_last: "2026-07-09", new_points: 6 }],
      ran_date: "2026-07-10",
      read_budget_max: 100,
      read_budget_used: 8
    };

    expect(parseAdminRefreshAllStale(preview).would_update).toBe(2);

    const impossible = { ...preview, updated: 1 };
    expect(() => parseAdminRefreshAllStale(impossible)).toThrow(AppError);

    const badTotal = { ...preview, processed: 4 };
    expect(() => parseAdminRefreshAllStale(badTotal)).toThrow(AppError);
  });

  test("reconciles the candidate inventory and rejects duplicate candidates", () => {
    const candidate = {
      asset_id: "ES0123456789",
      name: "Fondo de prueba",
      type: "FUND",
      eodhd_hint: null,
      currency_hint: "EUR"
    };
    const inventory = {
      generated_at: "2026-07-10T09:00:00Z",
      total_roots: 4,
      excluded: 1,
      with_series: 2,
      candidates: [candidate],
      by_type: { FUND: 1 }
    };

    expect(parseAdminBackfillCandidates(inventory).candidates).toHaveLength(1);
    expect(() => parseAdminBackfillCandidates({
      ...inventory,
      total_roots: 5,
      candidates: [candidate, candidate],
      by_type: { FUND: 2 }
    })).toThrow(AppError);
  });

  test("reconciles every backfill outcome with its summary", () => {
    const preview = {
      applied: false,
      requested: 1,
      processed: 1,
      loadable: 1,
      loaded: 0,
      skipped: 0,
      review: 0,
      errors: 0,
      results: [backfillResult()],
      ran_date: "2026-07-10"
    };

    expect(parseAdminBackfillBatch(preview).loadable).toBe(1);
    expect(() => parseAdminBackfillBatch({ ...preview, review: 1 })).toThrow(AppError);

    const impossibleResult = backfillResult();
    (impossibleResult as { error: string | null }).error = "fallo";
    expect(() => parseAdminBackfillBatch({ ...preview, results: [impossibleResult] })).toThrow(AppError);
  });

  test("preserves failed history reasons in an otherwise valid ingest preview", () => {
    const result = parseAdminIngestAsset({
      asset_id: "ES0123456789",
      ok: true,
      applied: false,
      preview: true,
      resolved: true,
      symbol: "TEST.MC",
      name: "Activo de prueba",
      asset_type: "ETF",
      provider: "MORNINGSTAR + EODHD",
      quality_status: "ACCEPTED",
      quality_score: 100,
      quality_warnings: [],
      fundamentals_source: null,
      exists_in_master: false,
      root_action: "CREATE",
      with_history: true,
      history: {
        loaded: false,
        error: "sin cobertura FX",
        symbol: "TEST.MC",
        interval: "1d",
        representation: "OBSERVED_DAILY_NAV"
      },
      root_preview: { schema_version: "asset-market.v1" }
    });

    expect(result.history?.error).toBe("sin cobertura FX");
    expect(result.history?.interval).toBe("1d");
    expect(result.provider).toBe("MORNINGSTAR + EODHD");
    expect(result.quality_score).toBe(100);
    expect(result.fundamentals_source).toBeNull();

    expect(() => parseAdminIngestAsset({
      asset_id: "ES0123456789",
      ok: true,
      applied: false,
      preview: false,
      resolved: true
    })).toThrow(AppError);
  });

  test("validates targeted metric and price previews", () => {
    const metric = parseAdminRecomputeMetric({
      asset_id: "ES0123456789",
      found: true,
      enough_data: true,
      applied: false,
      max_drawdown_hist: { value: -0.314, date: "2020-03-16" }
    });
    expect(metric.max_drawdown_hist?.value).toBe(-0.314);

    expect(() => parseAdminRecomputeMetric({
      asset_id: "ES0123456789",
      found: true,
      enough_data: false,
      max_drawdown_hist: { value: -0.314, date: "2020-03-16" }
    })).toThrow(AppError);

    const prices = parseAdminRefreshAssetPrices({
      asset_id: "ES0123456789",
      found: true,
      applied: false,
      new_points: 4,
      new_first: "2026-07-06",
      new_last: "2026-07-09",
      eodhd_symbol: "TEST.MC"
    });
    expect(prices.new_points).toBe(4);

    expect(() => parseAdminRefreshAssetPrices({
      asset_id: "ES0123456789",
      found: true,
      applied: true,
      new_points: 0
    })).toThrow(AppError);
  });

  // CRIT-03 (auditoría 16-10-2026): la reconstrucción del histórico ya escrita no es un error.
  test("accepts a history rebuild, applied or previewed, and explains it", () => {
    const applied = parseAdminRefreshAssetPrices({
      asset_id: "X",
      found: true,
      history_rebuilt: true,
      applied: true,
      first_date: "2010-01-04",
      last_date: "2026-10-15",
      points: 4100,
      revision: "abc123",
      history_documents: 17,
      write_count: 19
    });
    expect(applied.history_rebuilt).toBe(true);
    expect(applied.points).toBe(4100);
    expect(applied.first_date).toBe("2010-01-04");
    expect(canApplyRefreshAssetPrices(applied)).toBe(false);
    expect(describeHistoryRebuild(applied)).toContain("Histórico reconstruido");

    // El backend de hoy (sin new_*) y el corregido (con new_* coherentes) valen los dos.
    const preview = parseAdminRefreshAssetPrices({
      asset_id: "X",
      found: true,
      history_rebuilt: true,
      applied: false,
      first_date: "2010-01-04",
      last_date: "2026-10-15",
      points: 4100,
      new_points: 4100,
      new_first: "2010-01-04",
      new_last: "2026-10-15"
    });
    expect(canApplyRefreshAssetPrices(preview)).toBe(true);
    const aviso = describeHistoryRebuild(preview) ?? "";
    expect(aviso).toContain("reconstruirá el histórico entero");
    expect(aviso).toContain("4.100 puntos");
    expect(aviso).toContain("del 04/01/2010 al 15/10/2026");

    expect(() => parseAdminRefreshAssetPrices({
      asset_id: "X",
      found: true,
      history_rebuilt: true,
      applied: true,
      last_date: "2026-10-15",
      points: 4100
    })).toThrow(AppError);
  });

  // Segunda pasada (17-10-2026): en la muestra del refresco masivo, una reconstrucción trae
  // new_points = histórico entero; se etiqueta como tal y no como puntos nuevos.
  test("labels a rebuilt history in the bulk refresh sample", () => {
    const base = {
      processed: 2, updated: 2, would_update: 0, applied: true, skipped: 0, errors: 0,
      ran_date: "2026-10-16", error_sample: []
    };
    const result = parseAdminRefreshAllStale({
      ...base,
      sample: [
        { asset_id: "ES0105046009", history_rebuilt: true, applied: true, first_date: "2010-01-04",
          last_date: "2026-10-15", new_first: "2010-01-04", new_last: "2026-10-15", new_points: 4100, points: 4100 },
        { asset_id: "LU0000000001", last_date: "2026-10-14", new_last: "2026-10-15", new_points: 1 }
      ]
    });
    const [rebuilt, normal] = result.sample ?? [];
    expect(rebuilt.history_rebuilt).toBe(true);
    expect(refreshSampleRebuildLabel(rebuilt, true)).toBe("histórico reconstruido, 4.100 puntos hasta el 15/10/2026");
    // Tercera pasada (17-10-2026): en la vista previa no se ha escrito nada.
    expect(refreshSampleRebuildLabel(rebuilt, false)).toBe("se reconstruiría el histórico, 4.100 puntos hasta el 15/10/2026");
    expect(refreshSampleRebuildLabel(normal, true)).toBeNull();
    expect(refreshSampleRebuildLabel(normal, false)).toBeNull();
    expect(() => parseAdminRefreshAllStale({
      ...base,
      sample: [{ asset_id: "X", history_rebuilt: "sí" }]
    })).toThrow(AppError);
  });

  test("a normal price preview has no rebuild notice", () => {
    const prices = parseAdminRefreshAssetPrices({
      asset_id: "X",
      found: true,
      applied: false,
      new_points: 2,
      new_first: "2026-10-14",
      new_last: "2026-10-15"
    });
    expect(describeHistoryRebuild(prices)).toBeNull();
    expect(canApplyRefreshAssetPrices(prices)).toBe(true);
    expect(canApplyRefreshAssetPrices({ ...prices, new_points: 0 })).toBe(false);
  });
});
