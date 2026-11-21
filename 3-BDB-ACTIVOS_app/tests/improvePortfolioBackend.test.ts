import { describe, expect, test, vi } from "vitest";
const llamada = vi.hoisted(() => ({ callBackend: vi.fn() }));
vi.mock("../src/adapters/callableBackend", () => llamada);
import { fetchPortfolioImprovement, IMPROVEMENT_TIMEOUT_MS, parseImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import { demoResponse } from "../src/adapters/demoBackend";

describe("contrato portfolio-improvement.v1", () => {
  test("la respuesta de muestra cumple el contrato y conserva la sustitución", async () => {
    const raw = await demoResponse("improve_portfolio", {
      positions: [{ asset_id: "A", weight: 0.6 }, { asset_id: "B", weight: 0.4 }],
      candidates: { B: ["B2"] }, window: "3Y"
    });
    const parsed = parseImprovementResponse(raw);
    expect(parsed.status).toBe("PROPOSAL");
    expect(parsed.window).toBe("3Y");
    expect(parsed.proposals[0].substitutions).toEqual([expect.objectContaining({ from_asset_id: "B", to_asset_id: "B2", weight: 0.4 })]);
    expect(parsed.proposals[0].weights).toEqual({ A: 0.6, B2: 0.4 });
    expect(parsed.proposals[0].validation.every((check) => check.status === "PASS")).toBe(true);
    expect(parsed.windows?.selection.weeks).toBe(104);
    expect(parsed.original?.metrics.confirmation.weeks).toBe(52);
  });

  test("sin candidatos la muestra devuelve «restricciones incompatibles» y el contrato sigue válido", async () => {
    const parsed = parseImprovementResponse(await demoResponse("improve_portfolio", { positions: [{ asset_id: "A", weight: 1 }], candidates: {} }));
    expect(parsed.status).toBe("INFEASIBLE");
    expect(parsed.proposals).toEqual([]);
    expect(parsed.reason).toMatch(/candidatos/);
  });

  test("estados mínimos y campos inválidos", () => {
    expect(parseImprovementResponse({ schema_version: "portfolio-improvement.v1", status: "INSUFFICIENT_DATA", proposals: [], missing_assets: ["B"] }))
      .toMatchObject({ status: "INSUFFICIENT_DATA", missing_assets: ["B"], proposals: [], warnings: [], evaluated_combinations: 0 });
    expect(() => parseImprovementResponse({ schema_version: "x", status: "WHATEVER", proposals: [] })).toThrow();
    expect(() => parseImprovementResponse({ schema_version: "x", status: "PROPOSAL", proposals: [{ substitutions: [] }] })).toThrow();
  });
});

/* 15-11-2026: «Mejorar» mide con el periodo de Simular. La respuesta trae campos nuevos y el adaptador acepta las dos formas,
   porque el sitio se publica antes que el servidor. */
describe("periodo de Simular en «Mejorar cartera»", () => {
  const ventanas = {
    frequency: "WEEKLY",
    full: { first_date: "2023-11-03", last_date: "2026-11-06", weeks: 157, days: 1099 },
    selection: { first_date: "2023-11-03", last_date: "2025-11-07", weeks: 105, days: 735 },
    confirmation: { first_date: "2025-11-07", last_date: "2026-11-06", weeks: 52, days: 364 }
  };

  test("lee las posiciones apartadas y completadas, el recorte, el €STR de cada tramo y los candidatos no evaluables", () => {
    const parsed = parseImprovementResponse({
      schema_version: "portfolio-improvement.v1", status: "INFEASIBLE", proposals: [], windows: ventanas,
      rejected_candidates: { A: [{ asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY", detail: "Su serie empieza el 08/10/2025", not_evaluable: true, series_first_date: "2025-10-08" }] },
      excluded_assets: [{ asset_id: "C", reason: "INSUFFICIENT_HISTORY", covers_window: "3Y" }, { asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY" }],
      excluded_positions: [{ asset_id: "C", reason: "INSUFFICIENT_HISTORY", weight: 0.4, covers_window: "3Y" }],
      extensions: [{ asset_id: "E", reference: "STOXX Europe 600", url: "", estimated_from: "2021-11-05", observed_from: "2022-03-04" }],
      coverage_weight_percent: 60,
      candidates_per_position: { requested: 5, evaluated: 3, trimmed: true, max_assets: 80 },
      risk_free: { risk_free_rate: 0.0273, risk_free_rate_policy: "WINDOW_AVERAGE" },
      risk_free_by_window: {
        selection: { risk_free_rate: 0.0306, risk_free_rate_policy: "WINDOW_AVERAGE" },
        confirmation: { risk_free_rate: 0.0207, risk_free_rate_policy: "WINDOW_AVERAGE" },
        full: { risk_free_rate: 0.0273, risk_free_rate_policy: "WINDOW_AVERAGE" }
      }
    });
    expect(parsed.windows?.confirmation.days).toBe(364);
    expect(parsed.excluded_positions).toEqual([{ asset_id: "C", reason: "INSUFFICIENT_HISTORY", weight: 0.4, covers_window: "3Y" }]);
    expect(parsed.extensions).toEqual([{ asset_id: "E", reference: "STOXX Europe 600", estimated_from: "2021-11-05", observed_from: "2022-03-04" }]);
    expect(parsed.coverage_weight_percent).toBe(60);
    expect(parsed.candidates_per_position).toEqual({ requested: 5, evaluated: 3, trimmed: true, max_assets: 80 });
    expect(parsed.risk_free_by_window?.confirmation?.risk_free_rate).toBe(0.0207);
    expect(parsed.rejected_candidates.A[0]).toEqual({ asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY", detail: "Su serie empieza el 08/10/2025", not_evaluable: true });
  });

  test("el tramo demasiado corto es un estado, con sus días", () => {
    const parsed = parseImprovementResponse({
      schema_version: "portfolio-improvement.v1", status: "WINDOW_TOO_SHORT", proposals: [], windows: ventanas, min_days: 330,
      short_windows: [{ window: "confirmation", first_date: "2026-07-17", last_date: "2026-11-06", days: 112 }],
      reason: "El tramo de confirmación tiene 112 días, del 17/07/2026 al 06/11/2026, y con menos de 330 no se anualiza: no se calcula una propuesta.",
      rejected_candidates: {}, evaluated_combinations: 0, warnings: []
    });
    expect(parsed.status).toBe("WINDOW_TOO_SHORT");
    expect(parsed.short_windows).toEqual([{ window: "confirmation", first_date: "2026-07-17", last_date: "2026-11-06", days: 112 }]);
    expect(parsed.min_days).toBe(330);
  });

  test("una respuesta de un servidor anterior se sigue leyendo, sin los campos nuevos", () => {
    const parsed = parseImprovementResponse({
      schema_version: "portfolio-improvement.v1", status: "INSUFFICIENT_DATA", proposals: [], missing_assets: ["C"],
      windows: { frequency: "WEEKLY", full: { first_date: "2023-11-13", last_date: "2026-11-02", weeks: 155 }, selection: { first_date: "2023-11-13", last_date: "2025-11-03", weeks: 103 }, confirmation: { first_date: "2025-11-03", last_date: "2026-11-02", weeks: 52 } },
      excluded_assets: [{ asset_id: "C", reason: "INSUFFICIENT_HISTORY" }],
      rejected_candidates: { A: [{ asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY", detail: "Sin serie que cubra la ventana común." }] },
      risk_free: { risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" }
    });
    expect(parsed.windows?.full).toEqual({ first_date: "2023-11-13", last_date: "2026-11-02", weeks: 155 });
    for (const campo of ["excluded_positions", "extensions", "coverage_weight_percent", "candidates_per_position", "risk_free_by_window", "short_windows", "min_days"] as const) {
      expect(parsed[campo]).toBeUndefined();
    }
    expect(parsed.rejected_candidates.A[0].not_evaluable).toBeUndefined();
  });

  test("espera lo mismo que el servidor: 300 segundos", async () => {
    llamada.callBackend.mockResolvedValueOnce({ schema_version: "portfolio-improvement.v1", status: "INFEASIBLE", proposals: [] });
    await fetchPortfolioImprovement({ positions: [{ asset_id: "A", weight: 1 }], candidates: {}, window: "3Y" });
    expect(IMPROVEMENT_TIMEOUT_MS).toBe(300_000);
    expect(llamada.callBackend).toHaveBeenCalledWith("improve_portfolio", expect.anything(), expect.any(String), { timeout: 300_000 });
  });
});
