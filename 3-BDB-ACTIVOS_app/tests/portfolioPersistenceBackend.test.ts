import { describe, expect, test, vi } from "vitest";
import { AppError } from "../src/core/appError";
import {
  parseDeletePortfolioResponse,
  parsePortfolioListResponse,
  parsePortfolioListResult,
  parseSavePortfolioResponse,
  parseSavedPortfolio
} from "../src/adapters/portfolioBackend";

function portfolio(updatedAt = "2026-07-10T17:00:00+00:00") {
  return {
    portfolio_id: "portfolio-20260710",
    owner_uid: "user-1",
    name: "Cartera patrimonial",
    created_at: "2026-07-10T16:00:00+00:00",
    updated_at: updatedAt,
    source_kind: "BDB_APP_OWNED",
    total_capital: 250000,
    positions: [
      {
        asset_id: "ES0123456789",
        weight_percent: 60,
        label: "Fondo A",
        keep_euros: true,
        target_euros: 150000
      },
      {
        asset_id: "LU0123456789",
        weight_percent: 40
      }
    ]
  };
}

describe("saved portfolio backend contracts", () => {
  test("restores capital and euro locks from the app-owned document", () => {
    const parsed = parseSavedPortfolio(portfolio());

    expect(parsed.total_capital).toBe(250000);
    expect(parsed.positions[0]).toMatchObject({ keepEuros: true, targetEuros: 150000 });
    expect(parsed.sourceKind).toBe("BBDD_LIVE_API");
  });

  test("validates list count and sorts by most recent update", () => {
    const older = { ...portfolio("2026-07-09T10:00:00Z"), portfolio_id: "older" };
    const newer = { ...portfolio("2026-07-11T10:00:00Z"), portfolio_id: "newer" };
    const result = parsePortfolioListResponse({
      schema_version: "portfolios.v2",
      portfolios: [older, newer],
      count: 2
    });

    expect(result.map((item) => item.portfolio_id)).toEqual(["newer", "older"]);

    expect(() => parsePortfolioListResponse({ portfolios: [older], count: 2 })).toThrow(AppError);
  });

  test("validates save confirmation and warnings", () => {
    const result = parseSavePortfolioResponse({
      schema_version: "portfolios.v2",
      portfolio_id: "portfolio-20260710",
      portfolio: portfolio(),
      warnings: [
        { code: "WEIGHTS_NOT_100", severity: "MEDIUM", message: "Los pesos suman 90." }
      ]
    });

    expect(result.portfolio?.total_capital).toBe(250000);
    expect(result.warnings[0].code).toBe("WEIGHTS_NOT_100");

    expect(() => parseSavePortfolioResponse({
      portfolio_id: "different",
      portfolio: portfolio(),
      warnings: []
    })).toThrow(AppError);
  });

  test("validates delete confirmation", () => {
    expect(parseDeletePortfolioResponse({ schema_version: "portfolios.v2", ok: true }).ok).toBe(true);
    expect(() => parseDeletePortfolioResponse({ ok: "true" })).toThrow(AppError);
  });

  test("rejects malformed positions instead of converting them to zero", () => {
    const malformedWeight = portfolio();
    malformedWeight.positions[0].weight_percent = "60" as never;
    expect(() => parseSavedPortfolio(malformedWeight)).toThrow(AppError);

    const duplicate = portfolio();
    duplicate.positions[1].asset_id = duplicate.positions[0].asset_id;
    expect(() => parseSavedPortfolio(duplicate)).toThrow(AppError);

    const badTimestamp = portfolio();
    badTimestamp.updated_at = "today";
    expect(() => parseSavedPortfolio(badTimestamp)).toThrow(AppError);
  });

  /* H04 (auditoría 14-10-2026): un solo documento con una fecha ilegible tumbaba
     list_portfolios entero y el asesor se quedaba sin ninguna cartera guardada. */
  test("un documento con created_at inválido se descarta con aviso y el resto se carga", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const good = { ...portfolio("2026-07-11T10:00:00Z"), portfolio_id: "good" };
      const older = { ...portfolio("2026-07-09T10:00:00Z"), portfolio_id: "older" };
      const broken = { ...portfolio(), portfolio_id: "broken", created_at: "no es una fecha" };
      const response = { schema_version: "portfolios.v2", portfolios: [older, broken, good, null], count: 4 };

      const result = parsePortfolioListResult(response);
      expect(result.portfolios.map((item) => item.portfolio_id)).toEqual(["good", "older"]);
      expect(result.discarded).toEqual([
        { index: 1, portfolio_id: "broken", reason: expect.stringContaining("portfolios[1].created_at") },
        { index: 3, portfolio_id: undefined, reason: expect.stringContaining("portfolios[3]") }
      ]);

      expect(parsePortfolioListResponse(response).map((item) => item.portfolio_id)).toEqual(["good", "older"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 documentos descartados"), result.discarded);
    } finally {
      warn.mockRestore();
    }
  });

  test("la forma de la respuesta sigue siendo obligatoria", () => {
    expect(() => parsePortfolioListResponse(null)).toThrow(AppError);
    expect(() => parsePortfolioListResponse({ portfolios: "ninguna" })).toThrow(AppError);
    // `count` se contrasta con los documentos recibidos, no con los válidos.
    const broken = { ...portfolio(), created_at: "ayer" };
    expect(parsePortfolioListResult({ portfolios: [broken], count: 1 }).discarded).toHaveLength(1);
    expect(() => parsePortfolioListResult({ portfolios: [broken], count: 2 })).toThrow(AppError);
  });
});
