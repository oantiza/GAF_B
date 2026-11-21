import { describe, it, expect } from "vitest";
import { buildLocalPortfolioImport } from "./portfolioImport";
import { AppError } from "./appError";
import type { BdbAssetDetail } from "../types/bdbAssets";

function asset(assetId: string, displayName: string): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: displayName,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    isin: assetId,
    currency: "EUR",
    coverage_status: "COVERED",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  } as unknown as BdbAssetDetail;
}

/** Espejo de lo que hace el backend: NOT_FOUND para un id que no está en la maestra. */
function notFound(): AppError {
  return new AppError("BACKEND", "Activo no encontrado.", {
    cause: { code: "functions/not-found" }
  });
}

const TEXT = ["asset_id,weight", "LU0289214628,60", "ES0161560018,10", "LU2222028099,30"].join("\n");

describe("buildLocalPortfolioImport · activos ausentes", () => {
  it("un ISIN que el backend responde NOT_FOUND se rechaza, no tumba la importación", async () => {
    // Incidente 04-09-2026: la primera posición desconocida abortaba el import
    // entero y el usuario solo veía «Activo no encontrado.».
    const result = await buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: TEXT,
      resolveAsset: (assetId) => {
        if (assetId === "ES0161560018") throw notFound();
        return asset(assetId, `Fondo ${assetId}`);
      }
    });

    expect(result.imported_positions.map((p) => p.asset_id)).toEqual([
      "LU0289214628",
      "LU2222028099"
    ]);
    expect(result.rejected_positions).toHaveLength(1);
    expect(result.rejected_positions[0]).toMatchObject({
      asset_id: "ES0161560018",
      reason: "MISSING_ASSET"
    });
    expect(result.total_weight_percent).toBeCloseTo(90, 2);
  });

  it("un ticker con mercado que se encuentra sin él se carga, y se avisa con el nombre de lo cargado (IMP-3)", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: ["asset_id,weight", "SAN.PA,40", "LU0289214628,60"].join("\n"),
      resolveAsset: (assetId) => {
        if (assetId === "SAN") return asset("SAN", "Banco Santander");
        if (assetId === "LU0289214628") return asset(assetId, "Fondo");
        return null;
      }
    });
    expect(result.imported_positions.map((p) => p.asset_id)).toEqual(["SAN", "LU0289214628"]);
    expect(result.warnings).toContain(
      "«SAN.PA» no está en el catálogo con ese mercado: se ha cargado SAN · Banco Santander, que es el mismo ticker sin el mercado. Comprueba que es el mismo valor: en otro mercado puede ser otra empresa."
    );
  });

  it("lo que se encuentra tal como viene escrito no lleva ese aviso", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: ["asset_id,weight", "SAN.PA,100"].join("\n"),
      resolveAsset: (assetId) => (assetId === "SAN.PA" ? asset("SAN.PA", "Sanofi") : assetId === "SAN" ? asset("SAN", "Banco Santander") : null)
    });
    expect(result.imported_positions.map((p) => p.asset_id)).toEqual(["SAN.PA"]);
    expect(result.warnings.some((aviso) => aviso.includes("sin el mercado"))).toBe(false);
  });

  it("un resolver que devuelve null se sigue tratando igual", async () => {
    const result = await buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: TEXT,
      resolveAsset: (assetId) => (assetId === "ES0161560018" ? null : asset(assetId, assetId))
    });

    expect(result.imported_positions).toHaveLength(2);
    expect(result.rejected_positions[0].reason).toBe("MISSING_ASSET");
  });

  it("un fallo que NO es NOT_FOUND sí se propaga (red, permisos, backend caído)", async () => {
    await expect(
      buildLocalPortfolioImport({
        sourceKind: "BBDD_LIVE_API",
        text: TEXT,
        resolveAsset: () => {
          throw new AppError("NETWORK", "No hay conexión con el backend.");
        }
      })
    ).rejects.toThrow("No hay conexión con el backend.");
  });
});
