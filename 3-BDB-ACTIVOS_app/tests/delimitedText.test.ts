/* Lector único de CSV/TSV (N3-04, cuarta pasada): respeta las comillas. */
import { describe, expect, it } from "vitest";
import { detectSeparator, parseDelimitedText, splitDelimitedLine } from "../src/core/delimitedText";

describe("parseDelimitedText", () => {
  it("un separador dentro de comillas es parte del campo", () => {
    const { rows, separator } = parseDelimitedText('Security,ISIN,Market value EUR\n"Fund A",LU1234567891,"80,000.00"');
    expect(separator).toBe(",");
    expect(rows).toEqual([
      ["Security", "ISIN", "Market value EUR"],
      ["Fund A", "LU1234567891", "80,000.00"]
    ]);
  });

  it("un salto de línea dentro de comillas es parte de la cabecera, y «\"\"» es una comilla", () => {
    const { rows } = parseDelimitedText('Producto;"Valor de\nmercado";"Nota ""A"""\nA;80000;x');
    expect(rows[0]).toEqual(["Producto", "Valor de\nmercado", 'Nota "A"']);
    expect(rows[1]).toEqual(["A", "80000", "x"]);
  });

  it("CRLF, líneas en blanco fuera y filas de solo separadores dentro", () => {
    expect(parseDelimitedText("a;b\r\n\r\n;;\r\nc;d").rows).toEqual([["a", "b"], ["", "", ""], ["c", "d"]]);
  });

  it("el separador lo decide lo que hay fuera de comillas, en cualquier línea", () => {
    expect(detectSeparator('Título\n"a;b",c,d')).toBe(",");
    expect(detectSeparator("Título\nA;B")).toBe(";");
    expect(detectSeparator("A\tB;C")).toBe("\t");
  });

  it("avisa de una comilla sin cerrar", () => {
    expect(parseDelimitedText('A;"B\nC;D').unclosedQuote).toBe(true);
    expect(parseDelimitedText('A;"B"\nC;D').unclosedQuote).toBe(false);
  });

  it("splitDelimitedLine parte una sola línea respetando las comillas", () => {
    expect(splitDelimitedLine('LU1234567891,"80,000.00"', ",")).toEqual(["LU1234567891", "80,000.00"]);
  });
});
