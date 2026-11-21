import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { HorizonProvenance } from "../src/components/PortfolioHorizonPanel";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/*
 * El aviso «Fuera del cálculo» de Diseño y de Analítica avanzada (puertas finales del 06-11, pantalla-4). En Modo cliente se quita el motivo, y un
 * nombre que ya acaba en punto quedaba con dos: «Duro Felguera, S.A..». Es la errata que la decisión 80 quitó del papel. El caso es el del fichero
 * de 8 líneas de la puerta, en la base nueva.
 */
const analisis = {
  years: 3,
  extensions: [],
  coverageWeightPercent: 70,
  backtest: {
    asset_ids: ["IE00B4L5Y983"],
    excluded_assets: [
      { asset_id: "ES0162600003", reason: "QUALITY_BLOCKED" },
      { asset_id: "ES0125140A14", reason: "QUALITY_BLOCKED" }
    ],
    coverage: { first_date: "2023-10-27", last_date: "2026-10-30" }
  }
} as unknown as PortfolioHorizon;

const activos = [
  { asset_id: "ES0162600003", display_name: "Duro Felguera, S.A." },
  { asset_id: "ES0125140A14", display_name: "ERCROS" }
] as unknown as BdbAssetDetail[];

const avisos = (modoCliente: boolean) =>
  [...renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: modoCliente }, createElement(HorizonProvenance, { analysis: analisis, assets: activos, conPeriodo: false })))
    /* Cada uno lo pinta la pieza `Aviso` (MAR-21), en ocre; sin título, el lector oye delante «Aviso.». */
    .matchAll(/<div class="aviso aviso--aviso"><div class="aviso__texto"><span class="sr-only">Aviso\. <\/span>([\s\S]*?)<\/div><\/div>/g)]
    .map(([, aviso]) => aviso.replace(/<!-- -->/g, ""));

describe("«Fuera del cálculo» con un nombre que acaba en punto (pantalla-4)", () => {
  test("en Modo cliente, sin el motivo, un solo punto", () => {
    expect(avisos(true)).toEqual([
      "Fuera del cálculo: Duro Felguera, S.A. Las cifras y proyecciones corresponden a la parte medida.",
      "Fuera del cálculo: ERCROS. Las cifras y proyecciones corresponden a la parte medida."
    ]);
  });

  test("como asesor, con el motivo detrás del nombre, no cambia", () => {
    expect(avisos(false)).toEqual([
      "Fuera del cálculo: Duro Felguera, S.A. · bloqueado por calidad del dato. Las cifras y proyecciones corresponden a la parte medida.",
      "Fuera del cálculo: ERCROS · bloqueado por calidad del dato. Las cifras y proyecciones corresponden a la parte medida."
    ]);
  });
});
