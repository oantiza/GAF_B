import { describe, expect, it } from "vitest";
import { buildLocalPortfolioImport } from "./portfolioImport";
import type { BdbAssetDetail } from "../types/bdbAssets";

/**
 * Un extracto de bróker trae el patrimonio y los pesos salen de repartirlo. Al
 * importarlo, el capital se quedaba en el valor por defecto (100.000 €), así que
 * una cartera de un millón se encogía a la décima parte y todos los importes por
 * posición salían falseados.
 */
const EXTRACTO = [
  "Producto;ISIN;Mercado;Div;Valor de mercado;Contravalor en EUR",
  "FONDO A;LU0232524495;FEX;EUR;14717,97;14717,97",
  "FONDO B;LU0524465548;FEX;EUR;24944,74;24944,74",
  "ACCION C;NL0011821202;AEX;EUR;9525;9525",
  // En otra divisa manda el contravalor, no el valor de mercado.
  "ETF D;IE000DR59CI3;AEX;USD;8736;7512,09"
].join("\n");

const TOTAL = 14717.97 + 24944.74 + 9525 + 7512.09;

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

describe("capital detectado al importar un extracto", () => {
  it("toma el patrimonio del extracto, no el capital por defecto", async () => {
    const out = await importa(EXTRACTO);

    expect(out.imported_positions).toHaveLength(4);
    expect(out.detected_capital).toBeCloseTo(TOTAL, 2);
    expect(out.detected_capital).not.toBe(100000);
  });

  it("aplicar ese capital devuelve a cada posición su importe original", async () => {
    // Es la propiedad que importa: peso = importe / total, luego
    // peso x total = importe. Sin el capital bueno, todos los euros mienten.
    const out = await importa(EXTRACTO);
    const capital = out.detected_capital!;
    const euros = Object.fromEntries(
      out.imported_positions.map((p) => [p.asset_id, (p.weight_percent / 100) * capital])
    );

    expect(euros["LU0232524495"]).toBeCloseTo(14717.97, 0);
    expect(euros["LU0524465548"]).toBeCloseTo(24944.74, 0);
    expect(euros["NL0011821202"]).toBeCloseTo(9525, 0);
    expect(euros["IE000DR59CI3"]).toBeCloseTo(7512.09, 0);
  });

  /* MEDIA-17 (auditoría 14-10-2026): cambio de contrato. Antes, con una línea
     rechazada, el capital era el total del FICHERO y los pesos sumaban menos del
     100 %; todo lo que renormaliza aguas abajo (costes, informe interno, edición
     proporcional) repartía ese total entre lo aceptado e inflaba los euros. Ahora
     el capital es el de lo aceptado, los pesos suman 100 % y lo rechazado se avisa. */
  async function importaSinLaAccion() {
    return buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: EXTRACTO,
      resolveAsset: (assetId) => (assetId === "NL0011821202" ? null : activo(assetId))
    });
  }

  it("con una línea rechazada, el capital es el de lo aceptado y cada posición conserva su importe", async () => {
    const out = await importaSinLaAccion();

    expect(out.rejected_positions).toHaveLength(1);
    expect(out.detected_capital).toBeCloseTo(TOTAL - 9525, 2);
    expect(out.total_weight_percent).toBeCloseTo(100, 3);
    const euros = Object.fromEntries(
      out.imported_positions.map((p) => [p.asset_id, (p.weight_percent / 100) * out.detected_capital!])
    );
    expect(euros["LU0232524495"]).toBeCloseTo(14717.97, 0);
    expect(euros["LU0524465548"]).toBeCloseTo(24944.74, 0);
    expect(euros["IE000DR59CI3"]).toBeCloseTo(7512.09, 0);
  });

  it("avisa de cuánto patrimonio del extracto queda fuera por lo rechazado", async () => {
    const out = await importaSinLaAccion();
    const aviso = out.warnings.find((warning) => warning.startsWith("Quedan fuera"));

    expect(aviso).toBeDefined();
    expect(aviso).toMatch(/9\.?525,00\s€/);
    expect(aviso).toContain("la suma de las posiciones aceptadas");
  });

  it("renormalizar aguas abajo ya no infla los importes en euros", async () => {
    // Lo que hacen costes, informe interno y la edición proporcional: repartir el
    // capital por peso relativo. Con el contrato anterior el fondo A salía con
    // 14.717,97 × TOTAL / (TOTAL − 9.525) ≈ 17.690 €.
    const out = await importaSinLaAccion();
    const capital = out.detected_capital!;
    const suma = out.imported_positions.reduce((total, p) => total + p.weight_percent, 0);
    const reparto = out.imported_positions.map((p) => ({ id: p.asset_id, euros: (p.weight_percent / suma) * capital }));

    expect(reparto.find((r) => r.id === "LU0232524495")!.euros).toBeCloseTo(14717.97, 0);
    expect(reparto.reduce((total, r) => total + r.euros, 0)).toBeCloseTo(capital, 2);
  });

  it("sin rechazos no hay aviso de patrimonio fuera", async () => {
    const out = await importa(EXTRACTO);
    expect(out.warnings.some((warning) => warning.startsWith("Quedan fuera"))).toBe(false);
    expect(out.detected_capital).toBeCloseTo(TOTAL, 2);
  });

  /* Revisión del 14-10-2026: dos ISIN que la maestra resuelve al mismo activo
     (un alias, una clase fusionada) se rechazaban como DUPLICATE_ASSET y su
     importe desaparecía; el Extracto externo los suma. Ahora también aquí. */
  it("dos ISIN que resuelven al mismo activo se suman en una posición, con aviso", async () => {
    const extracto = [
      "Producto;ISIN;Mercado;Div;Valor de mercado;Contravalor en EUR",
      "HAMCO FI;ES0141116030;FEX;EUR;10000;10000",
      "HAMCO SICAV;LU3038481936;FEX;EUR;30000;30000",
      "FONDO B;LU0524465548;FEX;EUR;60000;60000"
    ].join("\n");
    const out = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: extracto,
      resolveAsset: (assetId) => activo(assetId === "ES0141116030" ? "LU3038481936" : assetId)
    });

    expect(out.rejected_positions).toHaveLength(0);
    expect(out.imported_positions.map((p) => p.asset_id)).toEqual(["LU3038481936", "LU0524465548"]);
    expect(out.detected_capital).toBeCloseTo(100000, 2);
    expect(out.imported_positions[0].weight_percent).toBeCloseTo(40, 4);
    expect(out.imported_positions[1].weight_percent).toBeCloseTo(60, 4);
    expect(out.warnings).toContain(
      "ES0141116030 y LU3038481936 son el mismo activo («Activo LU3038481936»): se suman en una posición."
    );
  });

  it("el mismo id repetido en el formato simple también se suma, con aviso", async () => {
    const out = await importa("asset_id,weight\nLU0232524495,30\nLU0524465548,50\nLU0232524495,20");

    expect(out.rejected_positions).toHaveLength(0);
    expect(out.imported_positions).toEqual([
      expect.objectContaining({ asset_id: "LU0232524495", weight_percent: 50 }),
      expect.objectContaining({ asset_id: "LU0524465548", weight_percent: 50 })
    ]);
    expect(out.warnings).toContain("LU0232524495 aparece en 2 líneas: se suman en una posición.");
  });

  it("el formato simple asset_id,weight no declara capital", async () => {
    const out = await importa("asset_id,weight\nLU0232524495,60\nLU0524465548,40");

    expect(out.imported_positions).toHaveLength(2);
    expect(out.detected_capital).toBeUndefined();
  });
});

/* Tercera pasada (revisión del 17-10-2026): lo que el lector del extracto no
   adivina llega al Constructor como aviso, con las líneas rechazadas a la vista. */
describe("avisos del lector del extracto en el Constructor", () => {
  it("dos columnas de importe que no coinciden: ningún peso y el aviso lo explica", async () => {
    const out = await importa(
      ["Producto;ISIN;Importe EUR;Contravalor", "A;LU0232524495;80000;1", "B;LU0524465548;120000;1"].join("\n")
    );
    expect(out.imported_positions).toHaveLength(0);
    // Octava pasada (B1): no se elige en silencio; el asesor elige en el resumen.
    expect(out.warnings.join(" ")).toContain("(«Importe EUR» y «Contravalor») y no coinciden");
    expect(out.import_choices?.[0]?.chosen).toBeNull();
  });

  it("un identificador que no es ISIN se rechaza a la vista, no desaparece", async () => {
    const out = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["Producto;ISIN;Valor de mercado", "A;LU0232524495;80000", "Privado;PRIVADO-1;20000"].join("\n"),
      resolveAsset: (assetId) => (assetId === "PRIVADO-1" ? null : activo(assetId))
    });
    expect(out.imported_positions.map((p) => p.asset_id)).toEqual(["LU0232524495"]);
    expect(out.rejected_positions.map((p) => p.asset_id)).toEqual(["PRIVADO-1"]);
  });
});
