/* Revisión de la cuarta pasada: el Constructor (buildLocalPortfolioImport,
   el que aplica PortfolioBuilderPage) con los extractos de R4-01 a R4-04.
   Invertido en la quinta pasada (antes zz_review4_constructor): pesos y
   capital verdaderos, y el resumen de la importación siempre presente. */
import { expect, it } from "vitest";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

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

const importa = (text: string) =>
  buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: (id) => (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id) ? activo(id) : null) });
const pesos = (r: Awaited<ReturnType<typeof importa>>) => Object.fromEntries(r.imported_positions.map((p) => [p.asset_id, Math.round(p.weight_percent * 100) / 100]));

it("N27 · «Contravalor» con colspan sobre «Divisa | EUR»: pesos con el contravalor en EUR (91,42/8,58) y capital 87.512,09", async () => {
  const r = await importa(
    '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Contravalor</th></tr><tr><th>Divisa</th><th>EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>'
  );
  expect(pesos(r)).toEqual({ LU1234567891: 91.42, IE0098765432: 8.58 });
  expect(r.detected_capital).toBe(87512.09);
  expect(r.import_summary?.join(" ")).toContain("Importe: columna «Contravalor EUR»");
});

it("N31 · «Total Fondo A» con el ISIN repetido: el fondo no entra (no se sabe qué filas sumar) y el aviso lo nombra con sus importes", async () => {
  // Sexta pasada (B5): antes se descartaba solo la fila de total; ahora, con
  // un posible total entre las filas de un ISIN, ese ISIN no entra.
  const r = await importa(
    "Producto;ISIN;Cuenta;Contravalor EUR\nFondo A;LU1234567891;C1;50000\nFondo A;LU1234567891;C2;30000\nTotal Fondo A;LU1234567891;;80000\nETF B;IE0098765432;C1;120000"
  );
  expect(pesos(r)).toEqual({ IE0098765432: 100 });
  expect(r.detected_capital).toBe(120000);
  expect(r.warnings.join(" ")).toContain("LU1234567891 aparece en 3 filas");
  expect(r.import_summary?.join(" ")).toContain("identificador repetido con un posible total");
});

it("N51 · dos tablas HTML con columnas distintas: el bono entra por su contravalor (120.650 €), no por el cupón corrido", async () => {
  const r = await importa(
    "<table><tr><th>Producto</th><th>ISIN</th><th>Participaciones</th><th>Liquidativo</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Fondo A</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td></tr></table>\n" +
      "<table><tr><th>Producto</th><th>ISIN</th><th>Nominal</th><th>Precio</th><th>Cupón corrido</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Bono B</td><td>XS1234567891</td><td>120.000</td><td>99,50</td><td>1.250,00</td><td>120.650,00</td></tr></table>"
  );
  expect(pesos(r)).toEqual({ LU1234567891: 39.87, XS1234567891: 60.13 });
  expect(r.detected_capital).toBe(200650);
  expect(r.import_summary?.join(" ")).toContain("Leído: tabla 1, tabla 2");
});

it("N01 · CSV en inglés con «80,000»: LU entra por 80.000 € (91,42/8,58) y capital 87.512,09", async () => {
  const r = await importa('Security,ISIN,Currency,Quantity,Market value EUR\n"Fund A",LU1234567891,EUR,100,"80,000"\n"ETF B",IE0098765432,USD,50,"7,512.09"');
  expect(pesos(r)).toEqual({ LU1234567891: 91.42, IE0098765432: 8.58 });
  expect(r.detected_capital).toBe(87512.09);
  expect(r.warnings.join(" ")).not.toContain("ambiguo");
});

it("el formato simple «asset_id,peso» también deja su resumen, con cada activo y su peso para comprobar", async () => {
  const r = await importa("asset_id,weight\nLU1234567891,40\nIE0098765432,60");
  const lines = (r.import_summary ?? []).map((line) => line.replace(/\s/g, " "));
  expect(lines[0]).toBe("Formato «asset_id,peso»: 2 líneas con pesos, sin importes en euros; 2 posiciones leídas.");
  expect(lines[1]).toBe("Posiciones para comprobar (activo · nombre · peso):");
  expect(lines[2]).toMatch(/^LU1234567891 · .* · 40,0 %$/);
  expect(lines[3]).toMatch(/^IE0098765432 · .* · 60,0 %$/);
  // Sin importes no hay «euro_confirmation», pero la pantalla también pide confirmar (lo prueba portfolioImportEuroConfirmation).
  expect(r.euro_confirmation).toBeUndefined();
});
