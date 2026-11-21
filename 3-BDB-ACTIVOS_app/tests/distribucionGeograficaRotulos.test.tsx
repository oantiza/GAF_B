/**
 * ANA-16: un nombre por cosa. El bloque se llama «Distribución geográfica», y la lista de zonas que lleva dentro, «Por
 * región» (antes «Desglose por regiones»).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { GeoDistributionMap } from "../src/charts/GeoDistributionMap";

describe("la distribución geográfica (ANA-16)", () => {
  test("la lista de zonas se rotula «Por región»", () => {
    const html = renderToStaticMarkup(
      createElement(GeoDistributionMap, {
        rows: [
          { key: "eurozone", weight_percent: 60 },
          { key: "united_states", weight_percent: 40 }
        ]
      })
    );
    expect(html).toContain('<h3 class="geo-map-column-title">Por región</h3>');
    expect(html).not.toContain("Desglose por regiones");
    expect(html).toContain('aria-label="Distribución geográfica"');
  });
});
