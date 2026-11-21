import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssetComparison } from "../src/components/AssetComparison";
import { AssetComparisonCatalogContent } from "../src/components/AssetComparisonCatalogModal";
import { AssetPickerErrorFeedback } from "../src/components/AssetPicker";
import {
  avisoDeCatalogoLimitado,
  buildComparisonCatalogRows,
  COMPARISON_CATALOG_LIMIT,
  filterComparisonCatalog,
  loadAssetPickerResults,
  loadComparisonCatalogDetails,
  materializeComparisonCatalogSelection,
  ordenarCatalogoPorNombre,
  rotuloDelCatalogo,
  toggleComparisonCatalogSelection,
  type ComparisonCatalogRow
} from "../src/core/assetComparisonCatalog";
import type { BdbAssetDetail, BdbAssetSearchResult, InstrumentType } from "../src/types/bdbAssets";
import type { AssetDataSource } from "../src/types/assetDataSource";

function asset(
  assetId: string,
  instrumentType: InstrumentType = "FUND",
  overrides: Partial<BdbAssetSearchResult> = {}
): BdbAssetSearchResult {
  return {
    asset_id: assetId,
    display_name: `Activo ${assetId}`,
    instrument_type: instrumentType,
    economic_asset_class: "EQUITY",
    isin: assetId.startsWith("LU") ? assetId : undefined,
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: instrumentType !== "INDEX",
    role: instrumentType === "INDEX" ? "BENCHMARK" : "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { annualized_return_1y: 0.05 },
    ...overrides
  };
}

function detail(source: BdbAssetSearchResult, ongoingCharge = 0.01): BdbAssetDetail {
  return {
    ...source,
    description: source.display_name,
    costs: { ongoing_charge: ongoingCharge },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

describe("catálogo Ver todos del comparador", () => {
  it("aplica tipo, región, clase y categoría sin depender del texto de búsqueda", () => {
    const assets = [
      asset("LU0000000001", "FUND", { region: "Europa", category: "Global" }),
      asset("LU0000000002", "FUND", { region: "EE. UU.", category: "Global" }),
      asset("US-STOCK", "STOCK", { region: "Europa", economic_asset_class: "EQUITY" })
    ];

    expect(filterComparisonCatalog(assets, {
      instrumentTypes: ["FUND"],
      region: "Europa",
      assetClass: "EQUITY",
      category: "Global"
    }).map((item) => item.asset_id)).toEqual(["LU0000000001"]);

    expect(filterComparisonCatalog(assets, {
      instrumentTypes: ["STOCK"],
      region: "ALL",
      assetClass: "FIXED_INCOME",
      category: "Categoría anterior"
    }).map((item) => item.asset_id)).toEqual(["US-STOCK"]);
  });

  it("une el coste corriente, la retro comercial validada y 1A; abre por nombre y no por lo que cobra la casa", () => {
    const first = asset("LU0000000001", "FUND", { display_name: "Zeta" });
    const second = asset("LU0000000002", "FUND", { display_name: "Alfa" });
    const missing = asset("LU0000000003", "FUND", { display_name: "Beta" });
    const rows = buildComparisonCatalogRows(
      [first, second, missing],
      new Map([
        [first.asset_id, detail(first, 0.0125)],
        [second.asset_id, detail(second, 0.008)]
      ]),
      [
        { isin: first.asset_id, retro_pct: 1.2, as_of_date: "2026-07-12", source: "ADMIN_UI" },
        { isin: second.asset_id, retro_pct: 0, as_of_date: "2026-07-12", source: "ADMIN_UI" },
        { isin: missing.asset_id, retro_pct: 120, as_of_date: "2026-07-12", source: "ADMIN_UI" }
      ]
    );

    expect(rows[0]).toMatchObject({ ongoingCharge: 0.0125, retroRate: 0.012, annualizedReturn1y: 0.05 });
    /* El que más retrocesión paga (Zeta) no va el primero: decisión 17 de Óscar. */
    expect(ordenarCatalogoPorNombre(rows).map((row) => row.asset.display_name)).toEqual(["Alfa", "Beta", "Zeta"]);
  });

  it("el botón dice de cuántos son los que enseña", () => {
    expect(rotuloDelCatalogo(200, 200, 1095)).toBe("Ver catálogo (200 de 1.095)");
    expect(rotuloDelCatalogo(37, 200, 1095)).toBe("Ver catálogo (37 de los 200 primeros)");
    expect(rotuloDelCatalogo(18, 18, 18)).toBe("Ver catálogo (18)");
    /* Sin el total del servidor no se inventa. */
    expect(rotuloDelCatalogo(0, 0, null)).toBe("Ver catálogo (0)");
    expect(rotuloDelCatalogo(200, 200, null)).toBe("Ver catálogo (200)");
  });

  it("el aviso de recorte dice que faltan los LU solo si es cierto", () => {
    const hasta = (tipo: InstrumentType, isin: (indice: number) => string) =>
      Array.from({ length: COMPARISON_CATALOG_LIMIT }, (_, indice) =>
        asset(`ID${indice}`, tipo, { isin: isin(indice) })
      );
    const sinLU = hasta("FUND", (indice) => `ES${indice}`);
    expect(avisoDeCatalogoLimitado(sinLU)).toContain("los 200 primeros por ISIN: no incluye los fondos con ISIN LU");
    expect(avisoDeCatalogoLimitado(sinLU, ["FUND"])).toContain("no incluye los fondos con ISIN LU");
    /* Con el filtro de acciones sería falso: ahí no se piden fondos. */
    expect(avisoDeCatalogoLimitado(hasta("STOCK", (indice) => `ES${indice}`), ["STOCK"])).not.toContain("ISIN LU");
    expect(avisoDeCatalogoLimitado(hasta("STOCK", (indice) => `ES${indice}`), ["STOCK"])).toContain("los 200 primeros por ISIN");
    /* Si los hay entre lo leído, tampoco. */
    expect(avisoDeCatalogoLimitado(hasta("FUND", (indice) => `LU${indice}`))).not.toContain("ISIN LU");
    /* Sin llegar al tope no hay nada que avisar. */
    expect(avisoDeCatalogoLimitado(sinLU.slice(0, 18))).toBeNull();
  });

  it("mantiene selección staged, permite desmarcar al máximo y nunca supera cinco", () => {
    const full = ["A", "B", "C", "D", "E"];
    expect(toggleComparisonCatalogSelection(full, "F", 5)).toEqual(full);
    expect(toggleComparisonCatalogSelection(full, "C", 5)).toEqual(["A", "B", "D", "E"]);
    expect(toggleComparisonCatalogSelection(["A", "B", "D", "E"], "F", 5)).toEqual(["A", "B", "D", "E", "F"]);
  });

  it("conserva o elimina selecciones fuera del filtro según el staging aplicado", () => {
    const outside = asset("OUTSIDE", "STOCK");
    const inside = asset("INSIDE", "FUND");

    expect(materializeComparisonCatalogSelection(
      [outside.asset_id, inside.asset_id],
      [outside],
      [inside],
      new Map()
    ).map((item) => item.asset_id)).toEqual([outside.asset_id, inside.asset_id]);

    expect(materializeComparisonCatalogSelection(
      [inside.asset_id],
      [outside],
      [inside],
      new Map()
    ).map((item) => item.asset_id)).toEqual([inside.asset_id]);
  });

  it("convierte un rechazo del AssetPicker en feedback y una lista vacía", async () => {
    const searchAssets = vi.fn().mockRejectedValue(new Error("Búsqueda no disponible"));

    const result = await loadAssetPickerResults(
      { searchAssets },
      { query: "texto", instrumentTypes: ["ETF"], limit: 60 }
    );

    expect(searchAssets).toHaveBeenCalledWith({ query: "texto", instrumentTypes: ["ETF"], limit: 60 });
    expect(result).toEqual({ results: [], error: "Búsqueda no disponible" });
    expect(renderToStaticMarkup(<AssetPickerErrorFeedback message={result.error} />)).toContain('role="alert"');
  });

  it("hidrata en un batch de resolución y limita el fallback a lotes de 25", async () => {
    const assets = Array.from({ length: 60 }, (_, index) => asset(`ASSET-${index}`, "ETF"));
    const resolvePortfolioPositions = vi.fn(async () =>
      assets.slice(0, 10).map((item) => ({ id: item.asset_id, amount: 0, asset: detail(item) }))
    );
    const getComparableAssets = vi.fn(async (ids: string[]) =>
      ids.map((id) => detail(assets.find((item) => item.asset_id === id)!))
    );
    const dataSource = { resolvePortfolioPositions, getComparableAssets } as unknown as AssetDataSource;

    const result = await loadComparisonCatalogDetails(dataSource, assets);

    expect(resolvePortfolioPositions).toHaveBeenCalledTimes(1);
    const resolvedPositions = (resolvePortfolioPositions.mock.calls as unknown as Array<[Array<{ amount: number }>]>)[0][0];
    expect(resolvedPositions).toHaveLength(60);
    expect(resolvedPositions.every((position) => position.amount === 0)).toBe(true);
    expect((getComparableAssets.mock.calls as Array<[string[]]>).map(([ids]) => ids.length)).toEqual([25, 25]);
    expect(result.detailsByAssetId).toHaveLength(60);
    expect(result.partial).toBe(false);
  });

  it("renderiza el contrato visual del modal y el lanzador exacto", () => {
    const rows: ComparisonCatalogRow[] = [{
      asset: asset("LU0000000001"),
      ongoingCharge: 0.01,
      retroRate: 0.005,
      annualizedReturn1y: 0.04
    }];
    const contentHtml = renderToStaticMarkup(
      <AssetComparisonCatalogContent
        rows={rows}
        stagedIds={["OUTSIDE"]}
        max={5}
        avisoDeLimite="Catálogo limitado a los 200 primeros por ISIN."
        outsideSelected={[asset("OUTSIDE", "STOCK", { display_name: "Activo fuera del filtro" })]}
        onToggle={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />
    );
    const comparisonHtml = renderToStaticMarkup(
      <AssetComparison
        assets={[detail(asset("LU0000000001")), detail(asset("LU0000000002"))]}
        sourceKind="LOCAL_MOCK"
        onRemove={() => undefined}
      />
    );

    expect(contentHtml).toContain("Coste corriente");
    expect(contentHtml).toContain("Retrocesión");
    /* ACT-14: «Producto», como en el Buscador, y no «Tipo». Desde el 17-11-2026 la cabecera va corta, «Rent. 1A» (Óscar), y el
       nombre entero sigue en ella para quien no la ve y al pasar el ratón. */
    expect(contentHtml).toContain("Rent. 1A");
    expect(contentHtml).toContain("Rentabilidad 1 año");
    expect(contentHtml).toMatch(/<button[^>]*>Producto<\/button>/);
    expect(contentHtml).not.toMatch(/>Tipo</);
    expect(contentHtml).toContain("Catálogo limitado a los 200 primeros por ISIN.");
    expect(contentHtml).toContain("Seleccionados fuera del filtro");
    expect(contentHtml).toContain("Activo fuera del filtro");
    /* El botón aplica lo marcado y lo desmarcado: no dice «Añadir», que solo cuenta la mitad. */
    expect(contentHtml).toContain("Aplicar la selección");
    expect(contentHtml).not.toContain("Añadir a la comparación");
    /* La retrocesión es un dato en su columna: no tiene botón de ordenar. Coste, rentabilidad y nombre, sí. */
    expect(contentHtml).toMatch(/<span class="tabla__titulo-fijo">Retrocesión<\/span>/);
    expect(contentHtml).toMatch(/<button[^>]*>Coste<span class="sr-only"> \(Coste corriente\)<\/span><\/button>/);
    expect(contentHtml).toMatch(/<button[^>]*>Rent. 1A<span class="sr-only"> \(Rentabilidad 1 año\)<\/span><\/button>/);
    expect(contentHtml).toMatch(/<button[^>]*>Activo<\/button>/);
    expect(comparisonHtml).toContain("Ver catálogo (0)");
    expect(comparisonHtml).toContain('aria-haspopup="dialog"');
  });

  it("una acción dice No aplica en el coste y la retrocesión, y lo que falta en un fondo dice Falta", () => {
    const rows: ComparisonCatalogRow[] = [
      { asset: asset("ACCION", "STOCK"), annualizedReturn1y: 0.1 },
      { asset: asset("FONDO", "FUND"), ongoingCharge: undefined, retroRate: undefined, annualizedReturn1y: 0.04 }
    ];
    const html = renderToStaticMarkup(
      <AssetComparisonCatalogContent
        rows={rows}
        stagedIds={[]}
        max={5}
        onToggle={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />
    );
    expect(html.match(/>No aplica</g) ?? []).toHaveLength(2);
    expect(html.match(/>Falta</g) ?? []).toHaveLength(2);
    expect(html).not.toContain("N/D");
  });

  it("la fila elegida se ve elegida entera, no solo por su casilla", () => {
    const rows: ComparisonCatalogRow[] = [
      { asset: asset("ELEGIDO"), annualizedReturn1y: 0.04 },
      { asset: asset("OTRO"), annualizedReturn1y: 0.05 }
    ];
    const html = renderToStaticMarkup(
      <AssetComparisonCatalogContent
        rows={rows}
        stagedIds={["ELEGIDO"]}
        max={5}
        onToggle={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />
    );
    const marcadas = html.split('<tr class="is-selected">').slice(1).map((resto) => resto.split("</tr>")[0]);
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toContain("Activo ELEGIDO");
    expect(marcadas[0]).not.toContain("Activo OTRO");
  });
});
