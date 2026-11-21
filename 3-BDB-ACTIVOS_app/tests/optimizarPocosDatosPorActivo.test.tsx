// @vitest-environment happy-dom

/**
 * Hallazgo 12 (decisión de Óscar, 15-11-2026): cuántos activos caben en Optimizar depende de las semanas de datos del
 * periodo. A 1 año son 53 retornos semanales y caben 13 (40 × 53 / 157 = 13,5, a la baja); a 3, 5 y 10 años, 40.
 * La pantalla lo dice antes de llamar; si lo dice el servidor, enseña su texto; y en los dos casos ofrece pasar a 3 años.
 * Que la tabla de la pantalla y la cuenta del servidor coinciden lo comprueba
 * functions_python/tests/test_optimizar_activos_por_ventana.py.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({
  fetchHistoricalFrontier: vi.fn(),
  isRealFrontierEnabled: vi.fn(() => true)
}));
vi.mock("../src/adapters/optimizePortfolioBackend", () => backend);

import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { frontierStateFromError, frontierStateFromRawResponse } from "../src/adapters/portfolioFrontierAdapter";
import { appErrorTitle, toAppError } from "../src/core/appError";
import { LIMITE_DE_ACTIVOS_POR_PERIODO } from "../src/core/historicalFrontierRequest";
import { clearSessionCaches } from "../src/core/sessionCaches";

/** El texto que escribe el servidor (`_mensaje_de_pocos_datos_por_activo`) con 14 activos a 1 año. */
const DEL_SERVIDOR =
  "El cálculo admite 13 activos como máximo y esta cartera tiene 14 con el periodo de 1 año: con 53 semanas de datos son pocos " +
  "datos por activo para estimar cómo se mueven juntos, y la propuesta sería sobre todo error de estimación. Pasa a 3 años, " +
  "que admite 40, o quita activos hasta dejar 13.";

function cartera(n: number): { assets: BdbAssetDetail[]; positions: BdbManualPortfolioPosition[] } {
  const positions = Array.from({ length: n }, (_, i) => ({ asset_id: `F${i}`, label: `Fondo ${i}`, weight_percent: 100 / n }));
  const assets = positions.map((p) => ({
    asset_id: p.asset_id,
    display_name: p.label,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { volatility_3y: 0.11, annualized_return_3y: 0.06 },
    description: "",
    pms_exposure: {}
  })) as unknown as BdbAssetDetail[];
  return { assets, positions };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  backend.fetchHistoricalFrontier.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;
const periodo = () => host.querySelector<HTMLSelectElement>('select[aria-describedby="optimizer-periodo-hint"]')!;
const pulsar = (b: HTMLButtonElement) => act(async () => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));

async function elegirPeriodo(valor: string) {
  const select = periodo();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(select, valor);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function pintar(n: number) {
  const { assets, positions } = cartera(n);
  await act(async () => {
    root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined }));
  });
}

describe("la tabla de la pantalla", () => {
  test("a 1 año caben 13; a 3, 5 y 10 años, 40", () => {
    expect(LIMITE_DE_ACTIVOS_POR_PERIODO).toEqual({
      "1Y": { semanas: 53, maximo: 13 },
      "3Y": { semanas: 157, maximo: 40 },
      "5Y": { semanas: 261, maximo: 40 },
      "10Y": { semanas: 522, maximo: 40 }
    });
  });
});

describe("antes de llamar", () => {
  test("15 activos a 1 año: lo dice con sus cifras, no deja optimizar y un clic pasa a 3 años", async () => {
    await pintar(15);
    await elegirPeriodo("1Y");
    expect(host.textContent).toContain(
      "El cálculo admite 13 activos como máximo y esta cartera tiene 15 con el periodo de 1 año: con 53 semanas de datos");
    expect(host.textContent).toContain("Pasa a 3 años, que admite 40, o quita activos hasta dejar 13.");
    expect(boton("Optimizar")?.disabled).toBe(true);

    await pulsar(boton("Pasar a 3 años")!);
    expect(periodo().value).toBe("3Y");
    expect(host.textContent).not.toContain("El cálculo admite 13 activos");
    expect(boton("Pasar a 3 años")).toBeUndefined();
    expect(boton("Optimizar")?.disabled).toBe(false);
    expect(backend.fetchHistoricalFrontier).not.toHaveBeenCalled();
  });

  test("13 activos a 1 año caben: sin aviso, se puede optimizar, y la pista del periodo dice el máximo", async () => {
    await pintar(13);
    await elegirPeriodo("1Y");
    expect(host.textContent).not.toContain("El cálculo admite 13 activos como máximo y esta cartera");
    expect(host.querySelector("#optimizer-periodo-hint")?.textContent)
      .toContain("Con 1 año hay 53 semanas de datos, y el cálculo admite 13 activos como máximo.");
    expect(boton("Optimizar")?.disabled).toBe(false);
  });

  test("a 3 años, 40 activos no tienen aviso del periodo ni pista de máximo", async () => {
    await pintar(40);
    await elegirPeriodo("3Y");
    expect(host.textContent).not.toContain("como máximo y esta cartera tiene");
    expect(host.querySelector("#optimizer-periodo-hint")?.textContent).not.toContain("activos como máximo");
    expect(boton("Optimizar")?.disabled).toBe(false);
  });
});

describe("lo que dice el servidor", () => {
  test("su texto se enseña una vez, sin «Histórica no disponible», y un clic pasa a 3 años", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "error", message: DEL_SERVIDOR, limiteDelPeriodo: { maximo: 13, activos: 14 } });
    await pintar(13);
    await elegirPeriodo("1Y");
    await pulsar(boton("Optimizar")!);
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].window).toBe("1Y");
    expect(host.textContent).toContain(DEL_SERVIDOR);
    expect(host.textContent!.split("El cálculo admite 13 activos").length - 1).toBe(1);
    expect(host.textContent).not.toContain("Histórica no disponible");

    await pulsar(boton("Pasar a 3 años")!);
    expect(periodo().value).toBe("3Y");
    expect(host.textContent).not.toContain(DEL_SERVIDOR);
  });

  test("cambiar el periodo a mano también lo retira", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "error", message: DEL_SERVIDOR, limiteDelPeriodo: { maximo: 13, activos: 14 } });
    await pintar(14);
    await elegirPeriodo("5Y");
    await pulsar(boton("Optimizar")!);
    expect(host.textContent).toContain(DEL_SERVIDOR);
    await elegirPeriodo("10Y");
    expect(host.textContent).not.toContain(DEL_SERVIDOR);
  });
});

describe("el adaptador", () => {
  test("reconoce el límite del periodo, venga del SDK o ya traducido, con o sin el estado HTTP al final", () => {
    const delSdk = { code: "functions/failed-precondition", message: DEL_SERVIDOR };
    const esperado = { status: "error", message: DEL_SERVIDOR, limiteDelPeriodo: { maximo: 13, activos: 14 } };
    expect(frontierStateFromError(delSdk)).toEqual(esperado);
    const traducido = toAppError(delSdk);
    expect(appErrorTitle(traducido)).toBe("Por encima del límite del cálculo");
    expect(frontierStateFromError(traducido)).toEqual(esperado);
    expect(frontierStateFromError({ ...delSdk, message: `${DEL_SERVIDOR} [400]` })).toEqual(esperado);
  });

  test("otro límite del cálculo no se toma por el del periodo", () => {
    const tope = frontierStateFromError({ code: "functions/invalid-argument", message: "Maximo 40 activos por peticion; llegan 47." });
    expect(tope.status === "error" && tope.limiteDelPeriodo).toBeFalsy();
  });

  test("lee el máximo de la respuesta, y una respuesta de un servidor anterior, sin él, sigue valiendo", () => {
    const raw = {
      schema_version: "portfolio-frontier.v1",
      as_of_date: "2026-10-30",
      units: "decimal",
      base_currency: "EUR",
      methodology: {
        window: "1Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES",
        risk_free_source: "ECB_ESTR", risk_free_rate: 0.021, risk_free_rate_policy: "WINDOW_AVERAGE",
        risk_free_first_date: "2025-10-24", risk_free_last_date: "2026-10-30", risk_free_observations: 260, risk_free_coverage_ratio: 1
      },
      coverage: { requested_assets: 2, included_assets: 2, common_observations: 54, first_date: "2025-10-24", last_date: "2026-10-30" },
      current_portfolio: { expected_return: 0.06, volatility: 0.11, sharpe_ratio: 0.36, weights: { A: 0.5, B: 0.5 } },
      min_volatility_portfolio: { expected_return: 0.045, volatility: 0.08, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } },
      max_sharpe_portfolio: { expected_return: 0.08, volatility: 0.12, sharpe_ratio: 0.52, weights: { A: 0.4, B: 0.6 } },
      frontier: [{ expected_return: 0.045, volatility: 0.08, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } }],
      excluded_assets: [],
      warnings: []
    };
    const anterior = frontierStateFromRawResponse(raw);
    expect(anterior.status).toBe("result");
    expect(anterior.status === "result" && anterior.model.limiteDeActivos).toBeUndefined();
    const nuevo = frontierStateFromRawResponse({
      ...raw,
      asset_limit: { window: "1Y", weekly_returns: 53, max_assets: 13, reference_window: "3Y", reference_weekly_returns: 157, reference_max_assets: 40 }
    });
    expect(nuevo.status === "result" && nuevo.model.limiteDeActivos).toEqual({ semanas: 53, maximo: 13 });
    const torcido = frontierStateFromRawResponse({ ...raw, asset_limit: { weekly_returns: "53" } });
    expect(torcido.status).toBe("result");
    expect(torcido.status === "result" && torcido.model.limiteDeActivos).toBeUndefined();
  });
});
