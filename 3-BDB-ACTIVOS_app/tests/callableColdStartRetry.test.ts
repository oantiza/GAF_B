/* Reintento de arranque (auditoría 29-09, BAJA): tras un despliegue la primera
   llamada a Cloud Run puede abortar («no available instance», HTTP 500 →
   `functions/internal`). Las callables de solo lectura se reintentan UNA vez
   tras ~1,5 s; las que mutan, nunca. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  attempts: [] as string[],
  outcomes: [] as (unknown | Error)[]
}));

vi.mock("../src/firebase", () => ({ functions: {}, appCheckReady: Promise.resolve() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async () => {
    state.attempts.push(name);
    const outcome = state.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return { data: outcome ?? { ok: true } };
  }
}));

import { callBackend, COLD_START_RETRY_DELAY_MS, isColdStartError, isReadOnlyOperation } from "../src/adapters/callableBackend";
import { AppError } from "../src/core/appError";

function functionsError(code: string): Error {
  const error = new Error(`Firebase: ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

describe("callBackend: reintento único tras un arranque en frío de Cloud Run", () => {
  beforeEach(() => {
    state.attempts = [];
    state.outcomes = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("clasifica las operaciones de solo lectura por prefijo", () => {
    for (const name of ["list_portfolios", "get_portfolio", "get_price_series", "search_assets", "compare_assets", "resolve_portfolio"]) {
      expect(isReadOnlyOperation(name), name).toBe(true);
    }
    for (const name of ["save_portfolio", "delete_portfolio", "admin_db_status", "admin_list_assets", "analyze_portfolio", "optimize_portfolio", "backtest_portfolio", "save_real_analysis"]) {
      expect(isReadOnlyOperation(name), name).toBe(false);
    }
  });

  test("solo functions/internal y functions/unavailable cuentan como arranque en frío", () => {
    expect(isColdStartError(functionsError("functions/internal"))).toBe(true);
    expect(isColdStartError(functionsError("functions/unavailable"))).toBe(true);
    expect(isColdStartError(functionsError("functions/not-found"))).toBe(false);
    expect(isColdStartError(functionsError("functions/permission-denied"))).toBe(false);
    expect(isColdStartError(new Error("Failed to fetch"))).toBe(false);
    expect(isColdStartError(null)).toBe(false);
  });

  test("list_portfolios: falla con functions/internal, espera ~1,5 s y la segunda llamada devuelve los datos", async () => {
    state.outcomes = [functionsError("functions/internal"), { portfolios: [{ id: "p1" }] }];
    const pending = callBackend<{ portfolios: { id: string }[] }>("list_portfolios", {});
    await vi.advanceTimersByTimeAsync(COLD_START_RETRY_DELAY_MS - 1);
    expect(state.attempts).toEqual(["list_portfolios"]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ portfolios: [{ id: "p1" }] });
    expect(state.attempts).toEqual(["list_portfolios", "list_portfolios"]);
  });

  test("functions/unavailable también se reintenta, pero solo una vez", async () => {
    state.outcomes = [functionsError("functions/unavailable"), functionsError("functions/unavailable"), { nunca: true }];
    const pending = callBackend("get_portfolio", { id: "p1" }, "No se pudo cargar la cartera.");
    const rejection = expect(pending).rejects.toBeInstanceOf(AppError);
    await vi.advanceTimersByTimeAsync(COLD_START_RETRY_DELAY_MS);
    await rejection;
    expect(state.attempts).toEqual(["get_portfolio", "get_portfolio"]);
  });

  test("una mutación (save_portfolio) nunca se reintenta aunque falle con functions/internal", async () => {
    state.outcomes = [functionsError("functions/internal"), { ok: true }];
    const pending = callBackend("save_portfolio", { name: "Cartera" }, "No se pudo guardar.");
    const rejection = expect(pending).rejects.toBeInstanceOf(AppError);
    await vi.advanceTimersByTimeAsync(COLD_START_RETRY_DELAY_MS * 2);
    await rejection;
    expect(state.attempts).toEqual(["save_portfolio"]);
  });

  test("admin_*, analyze_* y optimize_* tampoco se reintentan", async () => {
    for (const name of ["admin_db_status", "analyze_portfolio", "optimize_portfolio"]) {
      state.attempts = [];
      state.outcomes = [functionsError("functions/unavailable"), { ok: true }];
      const rejection = expect(callBackend(name, {})).rejects.toBeInstanceOf(AppError);
      await vi.advanceTimersByTimeAsync(COLD_START_RETRY_DELAY_MS * 2);
      await rejection;
      expect(state.attempts, name).toEqual([name]);
    }
  });

  test("un error de solo lectura que no es de arranque (permission-denied) sale a la primera", async () => {
    state.outcomes = [functionsError("functions/permission-denied"), { ok: true }];
    const rejection = expect(callBackend("list_portfolios", {})).rejects.toBeInstanceOf(AppError);
    await vi.advanceTimersByTimeAsync(COLD_START_RETRY_DELAY_MS * 2);
    await rejection;
    expect(state.attempts).toEqual(["list_portfolios"]);
  });
});
