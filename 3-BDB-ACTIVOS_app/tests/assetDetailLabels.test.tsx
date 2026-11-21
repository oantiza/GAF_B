import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AssetDetailWarnings } from "../src/components/AssetDetailWarnings";
import { ASSET_SECTION_LABELS, holdingTypeLabel } from "../src/core/labels";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/* Auditoría 14-10 (MEDIA-20a): la ficha enseñaba códigos del backend. */
describe("ficha del activo sin códigos internos", () => {
  test("los distintivos y avisos de calidad salen traducidos", () => {
    const asset = {
      asset_id: "LU0000000001",
      quality_flags: ["PARTIAL_COVERAGE", "MISSING_HOLDINGS", "UNSUPPORTED_INSTRUMENT_TYPE"],
      warnings: [
        { code: "MISSING_HISTORY", severity: "MEDIUM", message: "History is missing" },
        { code: "ASSET_NOT_IN_MASTER", severity: "HIGH", message: "Not in master" }
      ]
    } as unknown as BdbAssetDetail;
    const html = renderToStaticMarkup(createElement(AssetDetailWarnings, { asset }));
    for (const code of ["PARTIAL_COVERAGE", "MISSING_HOLDINGS", "UNSUPPORTED_INSTRUMENT_TYPE", "MISSING_HISTORY", "ASSET_NOT_IN_MASTER", "MEDIUM", "HIGH"]) {
      expect(html).not.toContain(code);
    }
    expect(html).toContain("Datos parciales");
    expect(html).toContain("Sin cartera publicada");
    expect(html).toContain("Histórico insuficiente");
    expect(html).toContain("Moderado");
  });

  test("secciones y tipo de posición tienen etiqueta en español", () => {
    for (const section of ["summary", "performance_preview", "risk_snapshot", "portfolio_summary", "cost_snapshot", "identity", "listing", "metrics", "holdings_summary", "fundamentals", "proxy_note"]) {
      expect(ASSET_SECTION_LABELS[section], section).toBeTruthy();
      expect(ASSET_SECTION_LABELS[section]).not.toMatch(/_/);
    }
    // Revisión 14-10: performance_preview son métricas medidas, no una estimación.
    expect(ASSET_SECTION_LABELS.performance_preview).toBe("Métricas de rentabilidad y riesgo");
    // Una posición subyacente es un título: «Acción», «Bono» (coherente con TYPE_LABELS).
    expect(holdingTypeLabel("Equity")).toBe("Acción");
    expect(holdingTypeLabel("bond")).toBe("Bono");
    expect(holdingTypeLabel("cash")).toBe("Liquidez");
  });
});
