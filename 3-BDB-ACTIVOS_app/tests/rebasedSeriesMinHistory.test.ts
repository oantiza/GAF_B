/**
 * Politica de historico minimo y frecuencia en las series rebasadas.
 *
 * El grafico del X-Ray pide DAILY + ENFORCE: dibuja al detalle y deja fuera a los
 * activos que no llegan al minimo del motor, para no encoger la ventana comun de
 * toda la cartera. El comparador y la ficha de activo siguen con NONE.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const callBackend = vi.fn();
vi.mock("../src/adapters/callableBackend", () => ({
  callBackend: (...args: unknown[]) => callBackend(...args)
}));

const { fetchRebasedSeries, parseRebasedSeriesResponse } = await import("../src/adapters/priceSeriesBackend");

function respuesta(excluded: unknown[] = []) {
  return {
    schema_version: "price-series.v1",
    base_currency: "EUR",
    window: "3Y",
    frequency: "DAILY",
    rebased_to: 100,
    dates: ["2024-01-05"],
    series: [{ asset_id: "A", display_name: "Activo A", values: [100] }],
    coverage: {
      requested_assets: 2,
      included_assets: 1,
      common_observations: 1,
      first_date: "2024-01-05",
      last_date: "2024-01-05"
    },
    excluded_assets: excluded
  };
}

describe("series rebasadas · historico minimo", () => {
  beforeEach(() => {
    callBackend.mockReset();
  });

  test("conserva el detalle del excluido para poder avisar con cifras", () => {
    const parsed = parseRebasedSeriesResponse(
      respuesta([
        {
          asset_id: "LU1793346823",
          reason: "INSUFFICIENT_HISTORY",
          observations: 490,
          required: 1092,
          window: "3Y"
        }
      ])
    );
    const [excluido] = parsed.excluded_assets;
    expect(excluido.reason).toBe("INSUFFICIENT_HISTORY");
    expect(excluido.observations).toBe(490);
    expect(excluido.required).toBe(1092);
    expect(excluido.window).toBe("3Y");
  });

  test("tolera exclusiones sin detalle (backend antiguo)", () => {
    const parsed = parseRebasedSeriesResponse(
      respuesta([{ asset_id: "X", reason: "PRICE_SERIES_MISSING" }])
    );
    expect(parsed.excluded_assets[0].observations).toBeUndefined();
    expect(parsed.excluded_assets[0].required).toBeUndefined();
  });

  test("por defecto no fuerza el minimo: el comparador no cambia", async () => {
    callBackend.mockResolvedValue(respuesta());
    await fetchRebasedSeries(["A", "B"], "3Y");
    const [, payload] = callBackend.mock.calls[0];
    expect(payload).toMatchObject({ frequency: "WEEKLY", min_history: "NONE" });
  });

  test("el X-Ray puede pedir diario y forzar el minimo", async () => {
    callBackend.mockResolvedValue(respuesta());
    await fetchRebasedSeries(["A", "B"], "5Y", "DAILY", "ENFORCE");
    const [nombre, payload] = callBackend.mock.calls[0];
    expect(nombre).toBe("get_price_series");
    expect(payload).toMatchObject({
      asset_ids: ["A", "B"],
      window: "5Y",
      frequency: "DAILY",
      min_history: "ENFORCE",
      base_currency: "EUR"
    });
  });

  test("sin activos no llama al backend", async () => {
    expect(await fetchRebasedSeries([], "3Y", "DAILY", "ENFORCE")).toBeNull();
    expect(callBackend).not.toHaveBeenCalled();
  });
});