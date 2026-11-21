/**
 * B6 (auditoría 29-09): el nombre real de la cartera activa (chip del shell) se
 * perdía en `getAssetDataSource("BBDD_LIVE_API").buildManualPortfolioReport`, que
 * solo reenviaba las posiciones, y el informe, el PDF de cliente y el X-Ray
 * imprimían el nombre por defecto de la fuente, hoy «Cartera sin nombre». Ese queda solo
 * para cuando de verdad no hay nombre.
 */
import { describe, expect, test, vi } from "vitest";

const buildLiveApiManualPortfolioReport = vi.fn(async (_positions: unknown, portfolioName?: string) => ({
  portfolio_name: portfolioName ?? "Cartera sin nombre"
}));

vi.mock("../src/adapters/bdbLiveApiAdapter", () => ({
  buildLiveApiManualPortfolioReport,
  searchLiveApiAssets: vi.fn(),
  searchLiveApiAssetsPage: vi.fn(),
  getLiveApiAssetDetail: vi.fn(),
  getLiveApiAssetHoldings: vi.fn(),
  getLiveApiAssetHoldingsMany: vi.fn(),
  getLiveApiComparableAssets: vi.fn(),
  resolveLiveApiPortfolioPositions: vi.fn(),
  getLiveApiPortfolioInputs: vi.fn(),
  buildLiveApiOptimizationInput: vi.fn(),
  buildLiveApiManualPortfolioSummary: vi.fn(),
  buildLiveApiManualPortfolioOptimizationPreview: vi.fn()
}));

const { getAssetDataSource } = await import("../src/adapters/assetDataSource");

const positions = [{ asset_id: "LU0996182563", weight_percent: 100 }];

describe("B6: el informe lleva el nombre real de la cartera", () => {
  test("la fuente en vivo reenvía el nombre de la cartera activa", async () => {
    const report = await getAssetDataSource("BBDD_LIVE_API").buildManualPortfolioReport(positions, "Carmen Ruiz · propuesta");
    expect(buildLiveApiManualPortfolioReport).toHaveBeenLastCalledWith(positions, "Carmen Ruiz · propuesta");
    expect(report.portfolio_name).toBe("Carmen Ruiz · propuesta");
  });

  test("la muestra estática usa el nombre dado y cae al suyo solo si no hay nombre", async () => {
    const dataSource = getAssetDataSource("BBDD_STATIC_EXPORT_SAMPLE");
    const conNombre = await dataSource.buildManualPortfolioReport(positions, "Carmen Ruiz · propuesta");
    expect(conNombre.portfolio_name).toBe("Carmen Ruiz · propuesta");
    const sinNombre = await dataSource.buildManualPortfolioReport(positions);
    const vacio = await dataSource.buildManualPortfolioReport(positions, "   ");
    expect(sinNombre.portfolio_name).toBe(vacio.portfolio_name);
    expect(sinNombre.portfolio_name.length).toBeGreaterThan(0);
    expect(sinNombre.portfolio_name).not.toBe("Carmen Ruiz · propuesta");
  });
});
