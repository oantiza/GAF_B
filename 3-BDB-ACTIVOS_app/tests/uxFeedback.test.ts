import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { getAssetDetail, searchAssets } from "../src/adapters/bdbAssetsAdapter";
import { AssetSearchFilters } from "../src/components/AssetSearchFilters";
import { PortfolioImportPanel } from "../src/components/PortfolioImportPanel";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";

describe("minimal post-beta UX feedback", () => {
  test("search filters expose a clear action only when search criteria are active", () => {
    const inactiveHtml = renderToStaticMarkup(
      createElement(AssetSearchFilters, {
        activeFilter: "ALL",
        hasActiveCriteria: false,
        onClear: () => undefined,
        onFilterChange: () => undefined
      })
    );
    const activeHtml = renderToStaticMarkup(
      createElement(AssetSearchFilters, {
        activeFilter: "STOCK",
        hasActiveCriteria: true,
        onClear: () => undefined,
        onFilterChange: () => undefined
      })
    );

    expect(inactiveHtml).not.toContain("Limpiar búsqueda y filtros");
    expect(activeHtml).toContain("Limpiar búsqueda y filtros");
    expect(activeHtml).toContain("Acciones");
    expect(activeHtml).toContain("Todos");
    // Auditoría 14-10 (MEDIA-21): el filtro es la primitiva SegmentedControl, no chips a mano.
    expect(activeHtml).toContain("ui-segmented");
    expect(activeHtml).toMatch(/aria-pressed="true"[^>]*>Acciones</);
    expect(activeHtml).not.toContain("filter-chip");
  });

  test("portfolio import makes INDEX benchmark rejection visible while keeping STOCK accepted", async () => {
    const assets = await Promise.all([
      searchAssets({ instrumentTypes: ["STOCK"], limit: 1 }).then(([asset]) => asset),
      searchAssets({ instrumentTypes: ["INDEX"], limit: 1 }).then(([asset]) => asset)
    ]);
    const result = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: [
        "asset_id,weight",
        `${assets[0].asset_id},70`,
        `${assets[1].asset_id},30`
      ].join("\n"),
      resolveAsset: getAssetDetail
    });
    const html = renderToStaticMarkup(
      createElement(PortfolioImportPanel, {
        importResult: result,
        onImportText: async () => undefined
      })
    );

    expect(result.imported_positions).toEqual([
      { asset_id: assets[0].asset_id, weight_percent: 70, label: assets[0].display_name }
    ]);
    expect(result.rejected_positions).toEqual([
      {
        line_number: 3,
        raw_line: `${assets[1].asset_id},30`,
        asset_id: assets[1].asset_id,
        weight_percent: 30,
        reason: "NON_INVESTABLE_BENCHMARK",
        message: "Índice no invertible, excluido de la cartera importada."
      }
    ]);
    expect(assets[0].instrument_type).toBe("STOCK");
    expect(html).toContain("Líneas rechazadas");
    expect(html).toContain("1 índice rechazado por no ser invertible");
    expect(html).toContain(`${assets[1].asset_id}: Índice no invertible, excluido`);
  });
});
