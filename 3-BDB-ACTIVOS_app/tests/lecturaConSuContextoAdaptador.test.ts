/**
 * Hallazgos 16, 17, 18 y 20 de la auditoría del backend (15-11-2026), en el adaptador: el servidor nuevo manda con cada cifra de cuándo
 * es y qué mide, la divisa del último valor y el alcance de las posiciones. Un servidor sin actualizar no manda nada de eso, y entonces
 * el adaptador da lo de siempre, con esos campos vacíos: no supone ninguno.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const servidor = vi.hoisted(() => ({ modo: "antiguo" as "antiguo" | "nuevo" }));

function detalle(assetId: string) {
  const nuevo = servidor.modo === "nuevo";
  return {
    asset_id: assetId,
    instrument_type: "ETF",
    identity: { display_name: "ETF en dólares", currency: "USD" },
    metrics: {
      source: "METRICS_LATEST",
      metrics_source: "COMPUTED",
      metrics_method: "EXTRACTOR_MONTHLY_V2",
      metrics_frequency: "MONTHLY",
      annualized_return_1y: 0.12,
      ...(nuevo
        ? { as_of: "2026-10-31", return_basis: "TOTAL_RETURN", series_class: "MARKET_PRICE", returns_as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30" } }
        : {})
    },
    performance_preview: {
      available: true,
      annualized_return_1y: 0.12,
      latest_value: 98.4,
      latest_value_date: "2026-11-12",
      ...(nuevo ? { latest_value_currency: "EUR" } : {}),
      source: "COMPUTED",
      data_quality: "COMPUTED"
    },
    holdings_summary: {
      has_holdings: true,
      positions_count: 155,
      full_holdings_loaded: false,
      ...(nuevo ? { securities_count: 243, coverage: 0.301148, list_scope: "TOP" } : {})
    },
    quality_flags: [],
    coverage_status: "COMPLETE"
  };
}

function posiciones(assetId: string) {
  return {
    asset_id: assetId,
    storage_mode: "SINGLE_DOCUMENT",
    holdings_count: 155,
    holdings: [{ holding_name: "Bono", holding_weight: 7, holding_weight_unit: "percent" }],
    ...(servidor.modo === "nuevo" ? { securities_count: 243, coverage: 0.301148, list_scope: "TOP" } : {})
  };
}

vi.mock("../src/firebase", () => ({ functions: {}, appCheckReady: Promise.resolve() }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: { asset_id?: string; asset_ids?: string[] }) => {
    if (name === "get_asset_detail") return { data: detalle(payload.asset_id ?? "") };
    if (name === "compare_assets") return { data: { assets: (payload.asset_ids ?? []).map(detalle) } };
    if (name === "get_asset_holdings") return { data: posiciones(payload.asset_id ?? "") };
    return { data: {} };
  }
}));

async function adaptador() {
  return import("../src/adapters/bdbLiveApiAdapter");
}

beforeEach(() => {
  vi.resetModules();
  servidor.modo = "antiguo";
});

describe("un servidor al día", () => {
  test("las métricas llegan con su fecha de corte, su base y la fecha de cada rentabilidad", async () => {
    servidor.modo = "nuevo";
    const ficha = await (await adaptador()).getLiveApiAssetDetail("IE0002PG6CA6");
    expect(ficha?.metrics).toMatchObject({
      annualized_return_1y: 0.12,
      as_of: "2026-10-31",
      return_basis: "TOTAL_RETURN",
      series_class: "MARKET_PRICE",
      returns_as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30" }
    });
    const comparados = await (await adaptador()).getLiveApiComparableAssets(["IE0002PG6CA6"]);
    expect(comparados[0]?.metrics.return_basis).toBe("TOTAL_RETURN");
  });

  test("el último valor lleva la divisa de su precio, no la de la clase", async () => {
    servidor.modo = "nuevo";
    const ficha = await (await adaptador()).getLiveApiAssetDetail("IE0002PG6CA6");
    expect(ficha?.currency).toBe("USD");
    expect(ficha?.performance_preview?.latest_value_currency).toBe("EUR");
  });

  test("las posiciones dicen cuántas son, cuánto cubren y que la lista está cortada", async () => {
    servidor.modo = "nuevo";
    const a = await adaptador();
    expect((await a.getLiveApiAssetDetail("IE0002PG6CA6"))?.holdings_summary).toMatchObject({ securities_count: 243, coverage: 0.301148, list_scope: "TOP" });
    expect(await a.getLiveApiAssetHoldings("IE0002PG6CA6")).toMatchObject({ securities_count: 243, coverage: 0.301148, list_scope: "TOP", holdings_count: 1 });
  });
});

describe("un servidor sin actualizar", () => {
  test("da lo de siempre, con lo nuevo vacío", async () => {
    const a = await adaptador();
    const ficha = await a.getLiveApiAssetDetail("IE0002PG6CA6");
    expect(ficha?.metrics.annualized_return_1y).toBe(0.12);
    for (const campo of ["as_of", "return_basis", "series_class", "returns_as_of_by_window", "provider"] as const) {
      expect(ficha?.metrics[campo]).toBeUndefined();
    }
    expect(ficha?.performance_preview?.latest_value).toBe(98.4);
    expect(ficha?.performance_preview?.latest_value_currency).toBeUndefined();
    expect(ficha?.holdings_summary?.securities_count).toBeUndefined();
    const lista = await a.getLiveApiAssetHoldings("IE0002PG6CA6");
    expect(lista?.list_scope).toBeUndefined();
    expect(lista?.holdings).toHaveLength(1);
  });
});
