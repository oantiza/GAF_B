/* Revisión de la tercera pasada (N3-01), invertida en la cuarta: el
   Constructor con una posición en dos filas visuales (rowspan en el ISIN y en
   el importe). El importe de la fila de continuación no cuenta dos veces. */
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

it("R12b · importe con rowspan sobre dos cuentas: el fondo cuenta una vez y los pesos son 40/60", async () => {
  const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Cuenta</th><th>Títulos</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo A</td><td rowspan="2">LU1234567891</td><td>C1</td><td>60</td><td rowspan="2">80.000,00</td></tr>
<tr><td>C2</td><td>40</td></tr>
<tr><td>ETF B</td><td>IE0098765432</td><td>C1</td><td>50</td><td>120.000,00</td></tr>
</table>`;
  const r = await importa(html);
  const pesos = Object.fromEntries(r.imported_positions.map((p) => [p.asset_id, p.weight_percent]));
  expect(pesos).toEqual({ LU1234567891: 40, IE0098765432: 60 });
  expect(r.detected_capital).toBe(200000);
  expect(r.warnings).toEqual([]);
});

it("R12a · posición en dos filas visuales: el capital detectado es el de las posiciones", async () => {
  const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Detalle</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo A</td><td rowspan="2">LU1234567891</td><td>Títulos: 100</td><td rowspan="2">80.000,00</td></tr>
<tr><td>Precio: 800,00</td></tr>
<tr><td rowspan="2">ETF B</td><td rowspan="2">IE0098765432</td><td>Títulos: 50</td><td rowspan="2">7.512,09</td></tr>
<tr><td>Precio: 150,24</td></tr>
</table>`;
  const r = await importa(html);
  expect(r.detected_capital).toBe(87512.09);
  expect(r.warnings).toEqual([]);
});
