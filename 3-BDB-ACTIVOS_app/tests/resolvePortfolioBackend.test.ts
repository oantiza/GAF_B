import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { summarizeCoveredRate } from "../src/core/coveredFinancialMetrics";

const calls = vi.hoisted(() => ({ resolve_portfolio: 0, sizes: [] as number[], failAt: 0 }));

vi.mock("../src/firebase", () => ({ functions: {}, appCheckReady: Promise.resolve() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    if (name !== "resolve_portfolio") {
      return { data: {} };
    }
    calls.resolve_portfolio += 1;
    const positions = (payload as { positions?: { asset_id: string; weight: number }[] }).positions ?? [];
    calls.sizes.push(positions.length);
    if (positions.length > 200) throw new Error("Maximo 200 posiciones por peticion.");
    if (calls.resolve_portfolio === calls.failAt) throw new Error("Fallo de conexión");
    return {
      data: {
        rows: positions
          .filter((position) => position.asset_id !== "MISSING")
          .map((position) => ({
            // "OLD-ISIN" simula un identificador sustituido que el backend resuelve al sucesor.
            asset_id: position.asset_id === "OLD-ISIN" ? "NEW-ISIN" : position.asset_id,
            requested_asset_id: position.asset_id === "OLD-ISIN" ? "OLD-ISIN" : undefined,
            is_investable: position.asset_id !== "MERGED",
            display_name: `Asset ${position.asset_id}`,
            instrument_type: "FUND",
            economic_asset_class: "EQUITY",
            coverage_status: "COMPLETE",
            currency: "EUR",
            metrics: { annualized_return_3y: 0.05 },
            pms_exposure: { equity: 1 },
            quality_flags: position.asset_id.startsWith("MERGED") ? ["NON_INVESTABLE_CORPORATE_ACTION"]
              : position.asset_id === "DELISTED" ? ["NON_INVESTABLE_DELISTED"]
                : position.asset_id === "CLOSED" ? ["NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"] : [],
            // "BROKEN" simula una fila fuera de contrato (métrica no numérica).
            ...(position.asset_id === "BROKEN" ? { metrics: { annualized_return_3y: "n/d" } } : {})
          }))
      }
    };
  }
}));

describe("resolvePortfolioBackend", () => {
  test.each([["DELISTED", "Excluido de cotización"], ["CLOSED", "Clase cerrada"]])(
    "%s conserva ISIN e importe sin habilitar nuevas selecciones", async (assetId, label) => {
      const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
      const rows = await resolvePortfolioBatch([{ asset_id: assetId, amount: 4200 }]);
      expect(rows[0].amount).toBe(4200);
      expect(rows[0].asset?.asset_id).toBe(assetId);
      expect(rows[0].asset?.is_investable).toBe(false);
      expect(rows[0].asset?.warnings[0].message).toContain(label);
    }
  );
  test("conserva el importe de un fondo fusionado sin habilitar nuevas selecciones", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    const rows = await resolvePortfolioBatch([{ asset_id: "MERGED", amount: 4200 }]);
    expect(rows[0].amount).toBe(4200);
    expect(rows[0].asset?.is_investable).toBe(false);
    expect(rows[0].asset?.quality_flags).toContain("NON_INVESTABLE_CORPORATE_ACTION");
    expect(rows[0].asset?.warnings[0].message).toContain("Baja por fusión");
  });
  /* CRIT-02.3 y MEDIA-11 (auditoría 14-10-2026): el adaptador en vivo indexaba las
     filas solo por `asset_id` (el canónico) y perdía la posición pedida con un ISIN
     sustituido. Ahora hay una sola implementación y las dos entradas son la misma. */
  test("el Extracto externo y la fuente en vivo comparten una sola implementación", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    const { resolveLiveApiPortfolioPositions } = await import("../src/adapters/bdbLiveApiAdapter");
    expect(resolvePortfolioBatch).toBe(resolveLiveApiPortfolioPositions);
  });
  test("la fuente en vivo casa un ISIN sustituido con la posición pedida (CRIT-02.3)", async () => {
    const { resolveLiveApiPortfolioPositions } = await import("../src/adapters/bdbLiveApiAdapter");
    const rows = await resolveLiveApiPortfolioPositions([
      { asset_id: "OLD-ISIN", amount: 0 },
      { asset_id: "FUND-1", amount: 0 },
      { asset_id: "MISSING", amount: 0 }
    ]);
    expect(rows.map((row) => [row.id, row.asset?.asset_id ?? null])).toEqual([
      ["OLD-ISIN", "NEW-ISIN"],
      ["FUND-1", "FUND-1"],
      ["MISSING", null]
    ]);
    expect(rows[0].asset?.display_name).toBe("Asset OLD-ISIN");
    expect(rows[0].asset?.is_investable).toBe(true);
  });
  test("una fila fuera de contrato no tumba el Extracto externo: se descarta con aviso y el resto se carga", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
      const rows = await resolvePortfolioBatch([
        { asset_id: "FUND-1", amount: 100 },
        { asset_id: "BROKEN", amount: 50 },
        { asset_id: "FUND-2", amount: 25 }
      ]);
      expect(rows.map((row) => [row.id, row.amount, row.asset?.asset_id ?? null])).toEqual([
        ["FUND-1", 100, "FUND-1"],
        ["BROKEN", 50, null],
        ["FUND-2", 25, "FUND-2"]
      ]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 fila descartada"), [
        expect.objectContaining({ index: 1, asset_id: "BROKEN" })
      ]);
    } finally {
      warn.mockRestore();
    }
  });
  test("un fondo dado de baja no es seleccionable aunque el backend lo marque invertible", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    const rows = await resolvePortfolioBatch([{ asset_id: "MERGED-FLAGGED", amount: 10 }]);
    expect(rows[0].asset?.quality_flags).toContain("NON_INVESTABLE_CORPORATE_ACTION");
    expect(rows[0].asset?.is_investable).toBe(false);
  });
  test("un ISIN sustituido se casa con la línea pedida y queda con el asset_id del sucesor", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    const rows = await resolvePortfolioBatch([{ asset_id: "OLD-ISIN", amount: 1000 }, { asset_id: "MISSING", amount: 5 }]);
    expect(rows[0].id).toBe("OLD-ISIN");
    expect(rows[0].asset?.asset_id).toBe("NEW-ISIN");
    expect(rows[0].amount).toBe(1000);
    expect(rows[1].asset).toBeNull();
  });
  beforeEach(() => {
    calls.resolve_portfolio = 0;
    calls.sizes = [];
    calls.failAt = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  test.each([0, 200, 201, 601, 6201])("conserva todas las posiciones e importes al cargar %i filas", async (count) => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    const positions = Array.from({ length: count }, (_, i) => ({
      asset_id: i % 17 === 0 ? "MISSING" : `FUND-${i % 231}`,
      amount: 1000 + i * 0.25
    }));
    const pending = resolvePortfolioBatch(positions);
    await vi.runAllTimersAsync();
    const rows = await pending;
    expect(calls.resolve_portfolio).toBe(Math.ceil(count / 200));
    expect(calls.sizes.every((size) => size <= 200)).toBe(true);
    expect(rows.map(({ id, amount }) => ({ asset_id: id, amount }))).toEqual(positions);
    expect(rows.every((row) => row.id === "MISSING" ? row.asset === null : row.asset?.asset_id === row.id)).toBe(true);
    const summary = summarizeCoveredRate(rows.map((row) => ({ amount: row.amount, rate: row.asset ? 0.5 : null })));
    expect(summary.totalAmount).toBe(positions.reduce((sum, p) => sum + p.amount, 0));
    expect(summary.weightedTotal / 100).toBeCloseTo(positions.reduce((sum, p) => sum + (p.asset_id === "MISSING" ? 0 : p.amount * 0.005), 0));
  });

  test("un fallo en un lote impide devolver una cartera parcial", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");
    calls.failAt = 2;
    const pending = resolvePortfolioBatch(Array.from({ length: 450 }, (_, i) => ({ asset_id: `A${i}`, amount: 100 })));
    const rejected = expect(pending).rejects.toThrow();
    await vi.runAllTimersAsync();
    await rejected;
    expect(calls.resolve_portfolio).toBe(2);
  });

  test("resolves all positions through one callable batch", async () => {
    const { resolvePortfolioBatch } = await import("../src/adapters/resolvePortfolioBackend");

    const rows = await resolvePortfolioBatch([
      { asset_id: "A", amount: 1000 },
      { asset_id: "B", amount: 2000 },
      { asset_id: "MISSING", amount: 3000 }
    ]);

    expect(calls.resolve_portfolio).toBe(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: "A", amount: 1000, asset: { display_name: "Asset A" } });
    expect(rows[1].asset?.metrics.annualized_return_3y).toBe(0.05);
    expect(rows[2]).toMatchObject({ id: "MISSING", amount: 3000, asset: null });
  });
});
