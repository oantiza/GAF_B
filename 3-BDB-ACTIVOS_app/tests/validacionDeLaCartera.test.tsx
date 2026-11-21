/**
 * DIS-22: Validación nombraba por ISIN lo que se quedaba fuera del cálculo, cuando el resto de la pantalla nombra por
 * nombre, y escribía «1 activos invertibles».
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PortfolioValidationPanel } from "../src/components/PortfolioValidationPanel";
import type { BdbAssetDetail, BdbManualPortfolioSummary } from "../src/types/bdbAssets";

const resumen = (cambios: Partial<BdbManualPortfolioSummary> = {}) =>
  ({
    validation_status: "VALID",
    is_valid: true,
    non_investable_assets: [],
    quality_blocked_assets: [],
    warnings: [],
    weighted_metrics: {},
    ...cambios
  }) as unknown as BdbManualPortfolioSummary;

const ficha = (asset_id: string, display_name: string) => ({ asset_id, display_name }) as unknown as BdbAssetDetail;

const texto = (html: string) => html.replace(/<[^>]+>/g, "");

describe("DIS-22 · Validación", () => {
  test("lo que queda fuera se nombra por su nombre, con el ISIN de apunte", () => {
    const html = renderToStaticMarkup(
      createElement(PortfolioValidationPanel, {
        summary: resumen({ non_investable_assets: ["IDX0000001", "XX000000002"], quality_blocked_assets: ["ES0000000003"] }),
        optimizationAssetCount: 3,
        assets: [ficha("IDX0000001", "MSCI World"), ficha("ES0000000003", "Deoleo")]
      })
    );
    expect(texto(html)).toContain("Fuera del cálculo por ser índices o activos no invertibles: MSCI World (IDX0000001), XX000000002");
    expect(texto(html)).toContain("Fuera del cálculo por una incidencia en su serie de precios: Deoleo (ES0000000003)");
  });

  test("uno es singular", () => {
    const html = renderToStaticMarkup(createElement(PortfolioValidationPanel, { summary: resumen(), optimizationAssetCount: 1 }));
    expect(texto(html)).toContain("1 activo invertible disponible para optimizar");
  });
});
