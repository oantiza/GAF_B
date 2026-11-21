import { beforeEach, describe, expect, test, vi } from "vitest";

const calls = vi.hoisted(() => ({
  compare_assets: 0,
  get_asset_detail: 0,
  search_assets: 0,
  failCompare: false,
  /** Mayor lote enviado a `compare_assets`: el backend rechaza más de 25. */
  maxCompareBatch: 0
}));

function rawAsset(assetId: string) {
  return {
    asset_id: assetId,
    identity: { display_name: assetId, currency: "EUR" },
    instrument_type: assetId === "B" ? "ETF" : "FUND",
    metrics: {}
  };
}

vi.mock("../src/firebase", () => ({ functions: {}, appCheckReady: Promise.resolve() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    const data = payload as { asset_ids?: string[]; asset_id?: string };
    if (name === "compare_assets") {
      calls.compare_assets += 1;
      calls.maxCompareBatch = Math.max(calls.maxCompareBatch, (data.asset_ids ?? []).length);
      if (calls.failCompare) throw new Error("compare failed");
      return {
        data: {
          assets: (data.asset_ids ?? [])
            .filter((assetId) => assetId !== "MISSING")
            .map(rawAsset)
        }
      };
    }
    if (name === "get_asset_detail") {
      calls.get_asset_detail += 1;
      return { data: data.asset_id === "MISSING" ? null : rawAsset(data.asset_id ?? "") };
    }
    if (name === "search_assets") {
      calls.search_assets += 1;
      return {
        data: {
          assets: [
            { asset_id: "A", display_name: "A", instrument_type: "FUND", currency: "EUR", metrics: {} }
          ]
        }
      };
    }
    return { data: {} };
  }
}));

describe("BBDD live API adapter cache", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    calls.compare_assets = 0;
    calls.get_asset_detail = 0;
    calls.search_assets = 0;
    calls.failCompare = false;
    calls.maxCompareBatch = 0;
  });

  test("deduplica peticiones concurrentes reordenadas y conserva el orden solicitado", async () => {
    const { getLiveApiComparableAssets } = await import("../src/adapters/bdbLiveApiAdapter");
    const [a, b, c] = await Promise.all([
      getLiveApiComparableAssets(["B", "A"]),
      getLiveApiComparableAssets(["A", "B"]),
      getLiveApiComparableAssets(["B", "A"])
    ]);

    expect(a.map((asset) => asset.asset_id)).toEqual(["B", "A"]);
    expect(b.map((asset) => asset.asset_id)).toEqual(["A", "B"]);
    expect(c.map((asset) => asset.asset_id)).toEqual(["B", "A"]);
    expect(calls.compare_assets).toBe(1);
  });

  test("una carga por lote alimenta la ficha individual sin una segunda llamada", async () => {
    const { getLiveApiAssetDetail, getLiveApiComparableAssets } = await import("../src/adapters/bdbLiveApiAdapter");

    await getLiveApiComparableAssets(["A", "B"]);
    const detail = await getLiveApiAssetDetail("A");

    expect(detail?.asset_id).toBe("A");
    expect(calls.compare_assets).toBe(1);
    expect(calls.get_asset_detail).toBe(0);
  });

  test("peticiones solapadas solo solicitan al batch los ids ausentes", async () => {
    const { getLiveApiAssetDetail, getLiveApiComparableAssets } = await import("../src/adapters/bdbLiveApiAdapter");

    const individual = getLiveApiAssetDetail("A");
    const batch = getLiveApiComparableAssets(["A", "B"]);
    await Promise.all([individual, batch]);

    expect(calls.get_asset_detail).toBe(1);
    expect(calls.compare_assets).toBe(1);
  });

  test("los errores no se cachean y los ausentes mantienen una respuesta estable", async () => {
    const { getLiveApiComparableAssets } = await import("../src/adapters/bdbLiveApiAdapter");
    calls.failCompare = true;
    await expect(getLiveApiComparableAssets(["A", "B"])).rejects.toThrow();
    calls.failCompare = false;
    await getLiveApiComparableAssets(["A", "B"]);
    expect(calls.compare_assets).toBe(2);

    expect(await getLiveApiComparableAssets(["MISSING"])).toEqual([]);
    expect(await getLiveApiComparableAssets(["MISSING"])).toEqual([]);
    expect(calls.compare_assets).toBe(3);
  });

  test("la ficha expira a los diez minutos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00Z"));
    const { getLiveApiAssetDetail } = await import("../src/adapters/bdbLiveApiAdapter");

    await getLiveApiAssetDetail("A");
    await getLiveApiAssetDetail("A");
    expect(calls.get_asset_detail).toBe(1);
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await getLiveApiAssetDetail("A");
    expect(calls.get_asset_detail).toBe(2);
  });

  test("el LRU de fichas conserva como máximo 250 resultados", async () => {
    const { bdbLiveApiAdapterTestHelpers, getLiveApiAssetDetail, getLiveApiComparableAssets } = await import("../src/adapters/bdbLiveApiAdapter");
    const ids = Array.from({ length: 251 }, (_, index) => `A${index}`);

    await getLiveApiComparableAssets(ids);
    // El backend rechaza `compare_assets` con más de 25 ids
    // («Maximo 25 activos por peticion»), así que 251 activos son 11 lotes.
    expect(calls.maxCompareBatch).toBeLessThanOrEqual(25);
    expect(calls.compare_assets).toBe(11);
    expect(bdbLiveApiAdapterTestHelpers.assetDetailCacheSize()).toBe(250);
    await getLiveApiAssetDetail("A0");
    expect(calls.get_asset_detail).toBe(1);
  });

  test("deduplica búsquedas normalizadas", async () => {
    const { searchLiveApiAssets } = await import("../src/adapters/bdbLiveApiAdapter");
    await searchLiveApiAssets({ query: "  ABC ", instrumentTypes: ["ETF", "FUND"] });
    await searchLiveApiAssets({ query: "abc", instrumentTypes: ["FUND", "ETF"] });

    expect(calls.search_assets).toBe(1);
  });

  test("cerrar sesión vacía las fichas, comparables y búsquedas en memoria (ALTA-21)", async () => {
    const { getLiveApiAssetDetail, getLiveApiComparableAssets, searchLiveApiAssets, bdbLiveApiAdapterTestHelpers } =
      await import("../src/adapters/bdbLiveApiAdapter");
    const { clearSessionCaches } = await import("../src/core/sessionCaches");

    await getLiveApiComparableAssets(["A", "B"]);
    await getLiveApiAssetDetail("C");
    await searchLiveApiAssets({ query: "abc" });
    expect(bdbLiveApiAdapterTestHelpers.assetDetailCacheSize()).toBe(3);

    clearSessionCaches();
    expect(bdbLiveApiAdapterTestHelpers.assetDetailCacheSize()).toBe(0);

    // La sesión siguiente vuelve a pedirlo todo al backend.
    await getLiveApiComparableAssets(["A", "B"]);
    await getLiveApiAssetDetail("C");
    await searchLiveApiAssets({ query: "abc" });
    expect(calls.compare_assets).toBe(2);
    expect(calls.get_asset_detail).toBe(2);
    expect(calls.search_assets).toBe(2);
  });

  test("una carga por lote que termina tras cerrar sesión no repuebla la caché de fichas", async () => {
    const { getLiveApiComparableAssets, bdbLiveApiAdapterTestHelpers } = await import("../src/adapters/bdbLiveApiAdapter");
    const { clearSessionCaches } = await import("../src/core/sessionCaches");

    const pending = getLiveApiComparableAssets(["A", "B"]);
    clearSessionCaches();
    expect((await pending).map((asset) => asset.asset_id)).toEqual(["A", "B"]);
    expect(bdbLiveApiAdapterTestHelpers.assetDetailCacheSize()).toBe(0);
  });
});
