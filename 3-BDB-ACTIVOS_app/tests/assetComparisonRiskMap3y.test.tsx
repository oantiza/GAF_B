/**
 * F-07 (auditoría 29-09): el mapa riesgo-retorno del comparador se rotula
 * «Ret / Vol 3A», pero un activo sin 3A entraba con su dato a 1 año, mezclado con los
 * demás sin avisar. Quedó fuera del mapa, y una nota dice cuál.
 *
 * El 03-11-2026 ese mapa lo sustituyó `PlanoRiesgoRetorno`, que dibuja un panel por
 * método. **La regla de F-07 se vino con él**, que es lo que estas pruebas siguen
 * fijando: lo que no se puede dibujar se NOMBRA. Cambian el texto y el dibujo; no cambia
 * que un instrumento no desaparezca en silencio ni se sustituya por la cifra de otra ventana.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AssetComparison } from "../src/components/AssetComparison";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

function asset(id: string, metrics: BdbAssetDetail["metrics"]): BdbAssetDetail {
  return {
    asset_id: id, display_name: `Fondo ${id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    metrics, costs: { ongoing_charge: 0.012 }, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

describe("F-07: el mapa riesgo-retorno del comparador no mezcla 1A con 3A", () => {
  test("el activo sin 3A queda fuera del mapa y la nota lo nombra", () => {
    const conTresAnos = asset("A", { annualized_return_3y: 0.06, volatility_3y: 0.1, annualized_return_1y: 0.2, volatility_1y: 0.3 });
    // Solo 1A: 25 % de retorno y 30 % de volatilidad, que antes se pintaban como si fueran 3A.
    const soloUnAno = asset("B", { annualized_return_1y: 0.25, volatility_1y: 0.3 });
    const html = renderToStaticMarkup(createElement(AssetComparison, {
      assets: [conTresAnos, soloUnAno], sourceKind: "BBDD_STATIC_EXPORT_SAMPLE", onRemove: () => undefined
    }));
    const plano = html.match(/<div class="plano__conjunto">[\s\S]*?<\/div><\/section>/)?.[0] ?? "";
    expect(plano, "el plano").not.toBe("");
    /* A sale con sus dos cifras, sin plano: solo no se sitúa frente a nadie. B no, aunque tenga cifras a un año. */
    expect(plano).toContain("<b>Fondo A</b>");
    expect(plano).toContain("Volatilidad 3 años 10,00\u00a0% · Rentabilidad 3 años +6,00\u00a0%");
    expect(plano).toContain("No se sitúa frente a los demás porque no tienen las dos cifras.");
    expect(plano).not.toContain("plano__lienzo");
    expect(plano).not.toContain("25,00\u00a0%");
    expect(html).toContain(
      "Fuera del plano por no tener las dos cifras a 3 años:</b> Fondo B"
    );
  });

  /* T12: Inmocemento empieza en noviembre de 2024 y no tiene cifras a 3 años; en la base nueva se llama «Inmocemento, S.A.» y la nota decía «S.A..». */
  test("un nombre que acaba en punto no deja dos en la nota", () => {
    const conTresAnos = asset("A", { annualized_return_3y: 0.06, volatility_3y: 0.1 });
    const inmocemento = { ...asset("ES0105836003", { annualized_return_1y: 0.0018, volatility_1y: 0.32 }), display_name: "Inmocemento, S.A.", instrument_type: "STOCK" as const };
    const html = renderToStaticMarkup(createElement(AssetComparison, {
      assets: [conTresAnos, inmocemento], sourceKind: "BBDD_STATIC_EXPORT_SAMPLE", onRemove: () => undefined
    })).replace(/<!-- -->/g, "");
    expect(html).toContain("Fuera del plano por no tener las dos cifras a 3 años:</b> Inmocemento, S.A. No se sustituyen por las de otra ventana.");
    expect(html).not.toContain("S.A..");
    /* Y un nombre que no acaba en punto sigue cerrando con el suyo. */
    const otro = renderToStaticMarkup(createElement(AssetComparison, {
      assets: [conTresAnos, asset("B", { annualized_return_1y: 0.25, volatility_1y: 0.3 })], sourceKind: "BBDD_STATIC_EXPORT_SAMPLE", onRemove: () => undefined
    })).replace(/<!-- -->/g, "");
    expect(otro).toContain("Fuera del plano por no tener las dos cifras a 3 años:</b> Fondo B. No se sustituyen por las de otra ventana.");
  });

  test("con todos los activos a 3A no hay nota de exclusión", () => {
    const html = renderToStaticMarkup(createElement(AssetComparison, {
      assets: [
        asset("A", { annualized_return_3y: 0.06, volatility_3y: 0.1 }),
        asset("B", { annualized_return_3y: 0.04, volatility_3y: 0.08 })
      ],
      sourceKind: "BBDD_STATIC_EXPORT_SAMPLE", onRemove: () => undefined
    }));
    expect(html).not.toContain("Fuera del plano");
    expect(html.match(/class="plano__etiqueta"/g) ?? []).toHaveLength(2);
    expect(html).toContain(">Fondo B<");
  });
});
