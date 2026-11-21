/* Batería de aceptación de la revisión independiente del 17-10-2026 (sobre la
   segunda pasada de ALTA-07): extractos SINTÉTICOS que master y la primera
   pasada leían bien y la segunda no. Cada test espera el resultado correcto. */
import { describe, expect, it } from "vitest";
import { brokerExportToPositionAmounts, brokerExportToCanonicalText } from "../src/core/brokerPortfolioImport";
import { parsePositionLines } from "../src/core/positionImport";

const OK = [
  { id: "LU1234567891", amount: 80000 },
  { id: "IE0098765432", amount: 120000 }
];

describe("importación de extractos: aceptación de la revisión del 17-10", () => {
  it("N-01 «Importe cupón corrido EUR» no manda sobre «Valor de mercado»", () => {
    const csv = "Producto;ISIN;Títulos;Valor de mercado;Importe cupón corrido EUR\nBono A;LU1234567891;100;80000;350\nBono B;IE0098765432;50;120000;910";
    expect(brokerExportToPositionAmounts(csv)).toEqual(OK);
  });

  it("N-01 «Importe dividendos (€)» no manda sobre «Valor de mercado»", () => {
    const csv = "Producto;ISIN;Div;Valor de mercado;Importe dividendos (€)\nA;LU1234567891;EUR;80000;1200\nB;IE0098765432;EUR;120000;40";
    expect(brokerExportToPositionAmounts(csv)).toEqual(OK);
  });

  it("N-02 una fila de sección con «Importe total» no sustituye a la cabecera", () => {
    const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Títulos</th><th>Valor de mercado</th></tr>
<tr><td>Renta variable</td><td>Importe total</td><td></td><td>200.000,00</td></tr>
<tr><td>A</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
  });

  it("N-02 una tabla de resumen encima no presta su cabecera", () => {
    // Quinta pasada (R4-12, decisión «Saldo»): «Saldo» sin la divisa EUR explícita
    // ya no se importa; con «Saldo EUR», sí. La tabla de resumen sigue sin prestar su cabecera.
    const html = `<table><tr><th>Divisa</th><th>Importe EUR</th></tr><tr><td>EUR</td><td>200.000,00</td></tr></table>
<table><tr><th>Producto</th><th>Código</th><th>Saldo EUR</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr></table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
    expect(brokerExportToPositionAmounts(html.replace("Saldo EUR", "Saldo"))).toEqual([]);
  });

  it("N-02 cabecera en dos filas con rowspan/colspan: nunca importes sacados del ISIN", () => {
    const html = `<table>
<tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th rowspan="2">Títulos</th><th colspan="2">Valoración</th></tr>
<tr><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr><td>ETF</td><td>IE00B4L5Y983</td><td>50</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>Fondo</td><td>LU1234567891</td><td>100</td><td>80.000,00</td><td>80.000,00</td></tr>
</table>`;
    const amounts = brokerExportToPositionAmounts(html).map((p) => p.amount);
    expect(amounts).not.toContain(45983);
    expect(amounts).not.toContain(1234567891);
  });

  it("N-03 una fila de título que nombra el ISIN no tapa la cabecera real", () => {
    const html = `<table>
<tr><td colspan="3">Posiciones valoradas (ISIN y contravalor)</td></tr>
<tr><th>Producto</th><th>ISIN</th><th>Valor de mercado</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr>
</table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
    expect(brokerExportToCanonicalText(html)).not.toBe(html);
  });

  it("N-04 «Activo;Importe» conserva los identificadores que no son ISIN", () => {
    expect(parsePositionLines("Activo;Importe\nLU1234567891;1000\nAAPL;500\nFUND-1;250")).toEqual([
      { id: "LU1234567891", amount: 1000 },
      { id: "AAPL", amount: 500 },
      { id: "FUND-1", amount: 250 }
    ]);
  });
});
