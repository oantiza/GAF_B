import { describe, expect, it } from "vitest";
import { parsePositionAmount, parsePositionLines } from "../src/core/positionImport";

describe("position import", () => {
  it("parses European amounts without splitting their decimal comma", () => {
    expect(parsePositionLines("IE00B4L5Y983; iShares Core MSCI World; 25.000,00")).toEqual([
      { id: "IE00B4L5Y983", amount: 25000 }
    ]);
  });

  it("accepts tab and comma separated rows", () => {
    expect(parsePositionLines("FUND-1\t1000.50\nFUND-2,2000.25")).toEqual([
      { id: "FUND-1", amount: 1000.5 },
      { id: "FUND-2", amount: 2000.25 }
    ]);
  });

  it("treats dot-only amounts in groups of three as European thousands (N2)", () => {
    expect(parsePositionAmount("20.000")).toBe(20000);
    expect(parsePositionAmount("8.000")).toBe(8000);
    expect(parsePositionAmount("1.234.567")).toBe(1234567);
    // los grupos que no son de tres siguen siendo decimales anglosajones
    expect(parsePositionAmount("1000.50")).toBe(1000.5);
    expect(parsePositionAmount("0.5")).toBe(0.5);
  });

  it("accepts the natural space-separated 'ISIN amount' format (N2)", () => {
    expect(parsePositionLines("IE00B4L5Y983 25.000,00\nLU0203975437 20.000\nLU1670722161 5.000")).toEqual([
      { id: "IE00B4L5Y983", amount: 25000 },
      { id: "LU0203975437", amount: 20000 },
      { id: "LU1670722161", amount: 5000 }
    ]);
    // con coma colgante tras el id, el id queda limpio
    expect(parsePositionLines("FUND-2, 2000.25")).toEqual([{ id: "FUND-2", amount: 2000.25 }]);
  });

  it("keeps text tokens (names, bare ISINs) as NaN after delegating to the single parser (T4c)", () => {
    // La guarda de letras evita que un ISIN suelto se reduzca a sus dígitos
    // y se importe como importe gigante.
    expect(Number.isNaN(parsePositionAmount("US0378331005"))).toBe(true);
    expect(Number.isNaN(parsePositionAmount("sin importe"))).toBe(true);
    expect(parsePositionLines("US0378331005\nLU0203975437")).toEqual([]);
  });

  it("ignores empty, invalid and non-positive rows", () => {
    expect(parsePositionLines("\nBAD;sin importe\nZERO;0\nOK;1.234,56")).toEqual([
      { id: "OK", amount: 1234.56 }
    ]);
    expect(Number.isNaN(parsePositionAmount(""))).toBe(true);
  });

  it("extracts ISIN and market value from an Andbank HTML .xls snapshot", () => {
    const html = `<table>
      <tr><td>Producto</td><td>ISIN</td><td>Valor de mercado</td><td>Contravalor en EUR</td></tr>
      <tr><td>Fund A</td><td>LU0289214628</td><td>80.098,46</td><td>80.098,46</td></tr>
      <tr><td>Fund B</td><td>LU2222028099</td><td>120000.00</td><td>120000.00</td></tr>
      <tr><td>TOTAL</td><td></td><td>200098.46</td><td>200098.46</td></tr>
    </table>`;

    expect(parsePositionLines(html)).toEqual([
      { id: "LU0289214628", amount: 80098.46 },
      { id: "LU2222028099", amount: 120000 }
    ]);
  });
});
