// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  fetchHistoricalFrontier,
  frontierRequestFingerprint,
  invalidateFrontierCache
} from "../src/adapters/optimizePortfolioBackend";
import { FrontierPanel } from "../src/components/FrontierPanel";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import type { PortfolioOptimizationRequest } from "../src/types/portfolioFrontier";

function validRaw(): Record<string, unknown> {
  return {
    schema_version: "portfolio-frontier.v1",
    as_of_date: "2026-06-20",
    units: "decimal",
    base_currency: "EUR",
    methodology: {
      window: "3Y",
      frequency: "WEEKLY",
      annualization_factor: 52,
      alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR",
      risk_free_rate: 0.0193,
      risk_free_rate_policy: "WINDOW_AVERAGE"
    },
    coverage: {
      requested_assets: 3,
      included_assets: 3,
      common_observations: 156,
      first_date: "2023-06-23",
      last_date: "2026-06-19"
    },
    min_volatility_portfolio: { expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } },
    max_sharpe_portfolio: { expected_return: 0.082, volatility: 0.12, sharpe_ratio: 0.52, weights: { A: 0.5, B: 0.5 } },
    frontier: [{ expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } }],
    excluded_assets: [],
    warnings: []
  };
}

function asset(id: string, ret: number, vol: number): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { annualized_return_3y: ret, volatility_3y: vol }
  } as unknown as BdbAssetDetail;
}

describe("optimize_portfolio wiring (C2)", () => {
  beforeEach(() => {
    invalidateFrontierCache();
  });

  test("flag real seguro por defecto y dependiente de Firebase Functions", async () => {
    vi.stubEnv("VITE_BDB_ENABLE_REAL_FRONTIER", "");
    vi.resetModules();

    try {
      const { ENABLE_REAL_FRONTIER, isRealFrontierEnabled } = await import("../src/adapters/optimizePortfolioBackend");

      expect(ENABLE_REAL_FRONTIER).toBe(false);
      expect(isRealFrontierEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  test("callable desactivada -> fallback (idle) y no se llama", async () => {
    let called = false;
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A", "B"] },
      {
        enabled: false,
        call: async () => {
          called = true;
          return validRaw();
        }
      }
    );
    expect(state).toEqual({ status: "idle" });
    expect(called).toBe(false);
  });

  test("menos de 2 activos -> idle aunque esté habilitado", async () => {
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A"] },
      { enabled: true, call: async () => validRaw() }
    );
    expect(state.status).toBe("idle");
  });

  test("respuesta válida -> estado histórico y request SIN series crudas", async () => {
    let captured: PortfolioOptimizationRequest | undefined;
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A", "B"], currentWeights: { A: 0.5, B: 0.5 }, objective: "MAX_SHARPE" },
      {
        enabled: true,
        call: async (req) => {
          captured = req;
          return validRaw();
        }
      }
    );
    expect(state.status).toBe("result");
    if (state.status === "result") {
      expect(state.model.label).toBe("Frontera histórica");
    }
    expect(captured?.schema_version).toBe("portfolio-optimization-request.v1");
    expect(captured?.base_currency).toBe("EUR");
    expect(captured?.asset_ids).toEqual(["A", "B"]);
    const json = JSON.stringify(captured);
    for (const banned of ['"series"', '"price_series"', '"prices"', '"returns"']) {
      expect(json.includes(banned)).toBe(false);
    }
  });

  test("la rotación máxima llega al servidor, y una rotación distinta es otra petición", async () => {
    let captured: PortfolioOptimizationRequest | undefined;
    const entrada = { assetIds: ["A", "B"], currentWeights: { A: 0.5, B: 0.5 }, objective: "TARGET_RISK" as const };
    await fetchHistoricalFrontier({ ...entrada, maxTurnover: 0.3 }, {
      enabled: true,
      call: async (req) => {
        captured = req;
        return validRaw();
      }
    });
    expect(captured?.constraints).toEqual({ long_only: true, fully_invested: true, min_weight: 0, max_weight: 1, max_turnover: 0.3 });
    expect(frontierRequestFingerprint({ ...entrada, maxTurnover: 0.3 })).not.toBe(frontierRequestFingerprint({ ...entrada, maxTurnover: 0.1 }));
    expect(frontierRequestFingerprint({ ...entrada, maxTurnover: 0.3 })).not.toBe(frontierRequestFingerprint(entrada));
  });

  test("UNAUTHENTICATED (código de Firebase) -> estado unauthenticated", async () => {
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A", "B"] },
      {
        enabled: true,
        call: async () => {
          throw Object.assign(new Error("no auth"), { code: "functions/unauthenticated" });
        }
      }
    );
    expect(state.status).toBe("unauthenticated");
  });

  test("error genérico -> estado error controlado (no rompe)", async () => {
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A", "B"] },
      {
        enabled: true,
        call: async () => {
          throw new Error("boom");
        }
      }
    );
    expect(state.status).toBe("error");
  });

  test("respuesta no válida -> error controlado", async () => {
    const state = await fetchHistoricalFrontier(
      { assetIds: ["A", "B"] },
      { enabled: true, call: async () => ({ schema_version: "wrong" }) }
    );
    expect(state.status).toBe("error");
  });

  test("fingerprint canónico ignora orden y normaliza pesos", () => {
    const left = frontierRequestFingerprint({
      assetIds: ["B", "A", "B"],
      currentWeights: { B: 0.40000001, A: 0.59999999 },
      lockedWeights: { B: 0.2, A: 0 },
      riskSlider: 5
    });
    const right = frontierRequestFingerprint({
      assetIds: ["A", "B"],
      currentWeights: { A: 0.6, B: 0.4 },
      lockedWeights: { A: -0, B: 0.2 },
      riskTargetMode: "FRONTIER_PERCENTILE"
    });

    expect(left).toBe(right);
  });

  test("fingerprint distingue un cambio de peso superior a 0,0001", () => {
    const base = frontierRequestFingerprint({ assetIds: ["A", "B"], currentWeights: { A: 0.5, B: 0.5 } });
    const changed = frontierRequestFingerprint({ assetIds: ["B", "A"], currentWeights: { B: 0.5, A: 0.50011 } });
    expect(changed).not.toBe(base);
  });

  test("fingerprint materializa defaults y solo conserva el selector de riesgo activo", () => {
    const implicit = frontierRequestFingerprint({ assetIds: ["A", "B"] });
    const zero = frontierRequestFingerprint({ assetIds: ["A", "B"], riskSlider: 0 });
    const explicit = frontierRequestFingerprint({
      assetIds: ["A", "B"],
      riskSlider: 5,
      riskTargetMode: "FRONTIER_PERCENTILE",
      minWeight: 0,
      maxWeight: 1,
      frontierPoints: 12,
      expectedReturnModel: "HISTORICAL_SHRINKAGE"
    });
    expect(implicit).toBe(zero);
    expect(zero).toBe(explicit);

    const absoluteLowSlider = frontierRequestFingerprint({
      assetIds: ["A", "B"],
      riskTargetMode: "ABSOLUTE_VOL",
      riskSlider: 1,
      targetVolatility: 0.1
    });
    const absoluteHighSlider = frontierRequestFingerprint({
      assetIds: ["A", "B"],
      riskTargetMode: "ABSOLUTE_VOL",
      riskSlider: 10,
      targetVolatility: 0.1
    });
    const absoluteDifferentTarget = frontierRequestFingerprint({
      assetIds: ["A", "B"],
      riskTargetMode: "ABSOLUTE_VOL",
      targetVolatility: 0.11
    });
    expect(absoluteLowSlider).toBe(absoluteHighSlider);
    expect(absoluteDifferentTarget).not.toBe(absoluteLowSlider);
  });

  test("single-flight comparte una sola llamada y envía el request canónico", async () => {
    let resolveCall: ((value: unknown) => void) | undefined;
    const call = vi.fn(() => new Promise<unknown>((resolve) => { resolveCall = resolve; }));
    const first = fetchHistoricalFrontier(
      { assetIds: ["B", "A"], currentWeights: { B: 0.499999, A: 0.500001 } },
      { enabled: true, call }
    );
    const second = fetchHistoricalFrontier(
      { assetIds: ["A", "B"], currentWeights: { A: 0.5, B: 0.5 }, riskSlider: 5 },
      { enabled: true, call }
    );

    expect(call).toHaveBeenCalledTimes(1);
    expect((call.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      asset_ids: ["A", "B"],
      current_weights: { A: 0.5, B: 0.5 },
      risk_slider: 5,
      risk_target_mode: "FRONTIER_PERCENTILE"
    });
    resolveCall?.(validRaw());
    const [firstState, secondState] = await Promise.all([first, second]);
    expect(firstState.status).toBe("result");
    expect(secondState).toBe(firstState);
  });

  test("errores no se cachean", async () => {
    const call = vi.fn(async () => ({ schema_version: "wrong" }));
    await fetchHistoricalFrontier({ assetIds: ["A", "B"] }, { enabled: true, call });
    await fetchHistoricalFrontier({ assetIds: ["B", "A"] }, { enabled: true, call });
    expect(call).toHaveBeenCalledTimes(2);
  });

  test("resultado expira después de 10 minutos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00Z"));
    try {
      const call = vi.fn(async () => validRaw());
      await fetchHistoricalFrontier({ assetIds: ["A", "B"] }, { enabled: true, call });
      await fetchHistoricalFrontier({ assetIds: ["B", "A"] }, { enabled: true, call });
      expect(call).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
      await fetchHistoricalFrontier({ assetIds: ["A", "B"] }, { enabled: true, call });
      expect(call).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("LRU conserva como máximo ocho resultados completados", async () => {
    const call = vi.fn(async () => validRaw());
    for (let index = 0; index < 9; index += 1) {
      await fetchHistoricalFrontier(
        { assetIds: [`A${index}`, `B${index}`] },
        { enabled: true, call }
      );
    }
    expect(call).toHaveBeenCalledTimes(9);

    await fetchHistoricalFrontier({ assetIds: ["A8", "B8"] }, { enabled: true, call });
    expect(call).toHaveBeenCalledTimes(9);
    await fetchHistoricalFrontier({ assetIds: ["A0", "B0"] }, { enabled: true, call });
    expect(call).toHaveBeenCalledTimes(10);
  });

  test("el panel aproximado sigue intacto (flag off, sin historical)", () => {
    const html = renderToStaticMarkup(
      createElement(FrontierPanel, {
        assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)],
        positions: [],
        /* El estado de «apagada» se da desde fuera: la prueba no apagaba la bandera, y donde está encendida el panel dice
           ahora que faltan los pesos (A-135). Así no depende del `.env.local` de quien la corra. */
        historical: { status: "idle" }
      })
    );
    expect(html).toContain("Estimación aproximada");
    expect(html).not.toContain("Frontera histórica");
  });

  test("shell y dos paneles comparten un horizonte válido sin lanzar el optimizador antiguo", async () => {
    vi.stubEnv("VITE_BDB_ENABLE_REAL_FRONTIER", "true");
    vi.doMock("../src/config/runtimeConfig", () => ({
      DEFAULT_DATA_SOURCE_KIND: "BBDD_LIVE_API",
      ENABLE_REAL_FRONTIER: true
    }));
    vi.doMock("../src/firebase", () => ({ functions: {} }));
    const networkCall = vi.fn(async (name: string, data: unknown) => {
      if (name === "compare_assets") {
        const assetIds = (data as { asset_ids: string[] }).asset_ids;
        return {
          assets: assetIds.map((assetId) => ({
            asset_id: assetId,
            identity: { display_name: assetId, currency: "EUR" },
            instrument_type: "FUND",
            is_investable: true,
            metrics: { annualized_return_3y: 0.08, volatility_3y: 0.12 }
          }))
        };
      }
      if (name === "backtest_portfolio") {
        const { demoResponse } = await import("../src/adapters/demoBackend");
        return demoResponse(name, data);
      }
      throw new Error(`Petición inesperada: ${name}`);
    });
    vi.doMock("../src/adapters/callableBackend", () => ({ callBackend: networkCall }));
    vi.resetModules();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      const commonPositions = [
        { asset_id: "A", weight_percent: 50 },
        { asset_id: "B", weight_percent: 50 }
      ];
      const { prefetchActivePortfolio } = await import("../src/adapters/prefetchActivePortfolio");
      await prefetchActivePortfolio("BBDD_LIVE_API", commonPositions);

      const { FrontierPanel: LiveFrontierPanel } = await import("../src/components/FrontierPanel");
      const commonProps = {
        assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)],
        positions: commonPositions
      };
      await act(async () => {
        root.render(createElement("div", null,
          createElement(LiveFrontierPanel, commonProps),
          createElement(LiveFrontierPanel, commonProps)
        ));
      });
      await vi.waitFor(() => {
        expect(networkCall.mock.calls.filter(([name]) => name === "compare_assets")).toHaveLength(1);
        expect(networkCall.mock.calls.filter(([name]) => name === "backtest_portfolio")).toHaveLength(1);
        expect(networkCall.mock.calls.filter(([name]) => name === "optimize_portfolio")).toHaveLength(0);
        expect(container.textContent).not.toContain("Calculando el periodo completo");
        expect(container.textContent).toContain("Datos de muestra");
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.doUnmock("../src/config/runtimeConfig");
      vi.doUnmock("../src/firebase");
      vi.doUnmock("../src/adapters/callableBackend");
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
