import { beforeEach, describe, expect, test, vi } from "vitest";
import { canPrefetchActivePortfolio } from "../src/core/activePortfolioPrefetchPolicy";
import { setAnalysisWindow } from "../src/core/analysisPreferences";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const mocks = vi.hoisted(() => ({
  getComparableAssets: vi.fn(),
  fetchPortfolioHorizon: vi.fn(),
  isRealFrontierEnabled: vi.fn()
}));

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: mocks.getComparableAssets })
}));

vi.mock("../src/adapters/optimizePortfolioBackend", () => ({
  isRealFrontierEnabled: mocks.isRealFrontierEnabled
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: mocks.fetchPortfolioHorizon }));

const positions = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 10 }
] as BdbManualPortfolioPosition[];

const assets = [
  { asset_id: "A", is_investable: true, metrics: { volatility_3y: 0.1, annualized_return_3y: 0.07 } },
  { asset_id: "B", is_investable: true, metrics: { volatility_3y: 0.08, annualized_return_3y: 0.05 } },
  { asset_id: "C", is_investable: true, metrics: { volatility_3y: null, annualized_return_3y: 0.03 } }
] as BdbAssetDetail[];

describe("precalentamiento exacto de la cartera activa", () => {
  beforeEach(() => {
    mocks.getComparableAssets.mockReset().mockResolvedValue(assets);
    mocks.fetchPortfolioHorizon.mockReset().mockResolvedValue(undefined);
    mocks.isRealFrontierEnabled.mockReset().mockReturnValue(true);
    setAnalysisWindow("3Y");
  });

  test("precalienta el horizonte seleccionado sin recortar activos por sus métricas", async () => {
    setAnalysisWindow("5Y");
    const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");
    await prefetchActivePortfolio("BBDD_LIVE_API", positions);

    expect(mocks.getComparableAssets).toHaveBeenCalledWith(["A", "B", "C"]);
    expect(mocks.fetchPortfolioHorizon).toHaveBeenCalledWith(positions, "5Y", undefined);
  });

  test("los fallos de precalentamiento son silenciosos", async () => {
    mocks.getComparableAssets.mockRejectedValueOnce(new Error("offline"));
    const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");

    await expect(prefetchActivePortfolio("BBDD_LIVE_API", positions)).resolves.toBeUndefined();
    expect(mocks.fetchPortfolioHorizon).toHaveBeenCalledTimes(1);
  });

  test("la lentitud de las fichas no retrasa el cálculo del horizonte", async () => {
    let finish!: (value: BdbAssetDetail[]) => void;
    mocks.getComparableAssets.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");
    const pending = prefetchActivePortfolio("BBDD_LIVE_API", positions);
    await vi.waitFor(() => expect(mocks.fetchPortfolioHorizon).toHaveBeenCalledTimes(1));
    finish(assets);
    await pending;
  });

  test("respeta el interruptor del análisis real", async () => {
    mocks.isRealFrontierEnabled.mockReturnValue(false);
    const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");
    await prefetchActivePortfolio("BBDD_LIVE_API", positions);
    expect(mocks.getComparableAssets).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPortfolioHorizon).not.toHaveBeenCalled();
  });

  test("cancela una precarga obsoleta antes de enviarla y transmite la señal a la cola", async () => {
    const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");
    const controller = new AbortController();
    controller.abort();
    await prefetchActivePortfolio("BBDD_LIVE_API", positions, controller.signal);
    expect(mocks.getComparableAssets).not.toHaveBeenCalled();
    expect(mocks.fetchPortfolioHorizon).not.toHaveBeenCalled();
    const live = new AbortController();
    await prefetchActivePortfolio("BBDD_LIVE_API", positions, live.signal);
    expect(mocks.fetchPortfolioHorizon).toHaveBeenCalledWith(positions, "3Y", live.signal);
  });

  test("la política evita fuente local, falta de sesión, pestaña oculta y cartera insuficiente", () => {
    expect(canPrefetchActivePortfolio("BBDD_LIVE_API", true, positions, false)).toBe(true);
    expect(canPrefetchActivePortfolio("LOCAL_MOCK", true, positions, false)).toBe(false);
    expect(canPrefetchActivePortfolio("BBDD_LIVE_API", false, positions, false)).toBe(false);
    expect(canPrefetchActivePortfolio("BBDD_LIVE_API", true, positions, true)).toBe(false);
    expect(canPrefetchActivePortfolio("BBDD_LIVE_API", true, positions.slice(0, 1), false)).toBe(false);
  });
});
