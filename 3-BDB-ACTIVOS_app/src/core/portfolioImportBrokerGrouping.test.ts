import { describe, expect, it } from "vitest";
import { buildLocalPortfolioImport } from "./portfolioImport";
import type { BdbAssetDetail } from "../types/bdbAssets";

/**
 * B8 (auditoría 29-09): el Constructor importaba extractos sin agrupar por
 * ISIN, así que la segunda cuenta con el mismo fondo se rechazaba como
 * DUPLICATE_ASSET y su importe desaparecía de la cartera; y las filas con
 * importe ilegible se saltaban sin que el usuario lo supiera.
 */
const EXTRACTO = [
  "Cliente;ISIN;Producto;Valor de mercado;Contravalor en EUR",
  "Cuenta 1;LU0232524495;FONDO A;10000;10000",
  "Cuenta 2;LU0232524495;FONDO A;30000;30000",
  "Cuenta 1;LU0524465548;FONDO B;60000;60000",
  "Cuenta 2;IE000DR59CI3;ETF sin importe;n/d;",
  "TOTAL;;;100000;100000"
].join("\n");

function activo(assetId: string): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: `Activo ${assetId}`,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  } as unknown as BdbAssetDetail;
}

async function importa(text: string) {
  return buildLocalPortfolioImport({
    sourceKind: "LOCAL_MOCK",
    text,
    resolveAsset: (assetId) => activo(assetId)
  });
}

describe("importar un extracto con ISIN repetido en el Constructor", () => {
  it("suma los importes del mismo ISIN en una sola posición, sin DUPLICATE_ASSET", async () => {
    const out = await importa(EXTRACTO);

    expect(out.imported_positions.map((p) => p.asset_id)).toEqual(["LU0232524495", "LU0524465548"]);
    expect(out.imported_positions[0].weight_percent).toBeCloseTo(40, 2);
    expect(out.imported_positions[1].weight_percent).toBeCloseTo(60, 2);
    expect(out.rejected_positions.filter((r) => r.reason === "DUPLICATE_ASSET")).toHaveLength(0);
    expect(out.total_weight_percent).toBeCloseTo(100, 2);
    expect(out.detected_capital).toBeCloseTo(100000, 2);
  });

  it("avisa de la fila que no se ha importado, con su ISIN", async () => {
    // Cuarta pasada: el contravalor en blanco no se sustituye a ciegas por el
    // valor de mercado (sin columna de divisa no consta que sea EUR).
    const out = await importa(EXTRACTO);
    expect(out.warnings.some((w) => w.includes("IE000DR59CI3") && w.includes("no se importa"))).toBe(true);
  });

  it("no avisa cuando todas las filas se han leído", async () => {
    const out = await importa(EXTRACTO.split("\n").filter((line) => !line.includes("IE000DR59CI3")).join("\n"));
    expect(out.warnings.some((w) => w.includes("no se importa"))).toBe(false);
  });
});
