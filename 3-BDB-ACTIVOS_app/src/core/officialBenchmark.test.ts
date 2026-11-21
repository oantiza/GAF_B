import { describe, expect, it } from "vitest";
import {
  cloneOfficialBenchmark,
  normalizeOfficialBenchmark,
  officialBenchmarkLine
} from "./officialBenchmark";

/**
 * El índice de referencia es el último tramo de la cadena que va de la ficha del extractor a la
 * ficha del cliente, y era el único sin prueba (31-10-2026). Lo que protege: que un hueco no se
 * convierta en una fila con algo escrito, porque la fila dice contra qué se mide el alpha.
 */
describe("normalizeOfficialBenchmark", () => {
  it("una cadena es el nombre, con la fuente que se le pase", () => {
    expect(normalizeOfficialBenchmark("MSCI World NR EUR", "BBDD_ACTIVOS")).toEqual({
      name: "MSCI World NR EUR",
      source: "BBDD_ACTIVOS"
    });
    expect(normalizeOfficialBenchmark("Euribor 6M")).toEqual({ name: "Euribor 6M" });
  });

  it("recorta los espacios y descarta lo que no deja nombre", () => {
    expect(normalizeOfficialBenchmark("  MSCI ACWI NR USD  ")).toEqual({ name: "MSCI ACWI NR USD" });
    for (const vacio of ["", "   ", null, undefined, 0, false, [], {}, { name: "" }, { name: 42 }]) {
      expect(normalizeOfficialBenchmark(vacio)).toBeUndefined();
    }
  });

  it("de un objeto acepta varios nombres para el nombre, en orden", () => {
    expect(normalizeOfficialBenchmark({ display_name: "A", label: "B" })?.name).toBe("A");
    expect(normalizeOfficialBenchmark({ label: "B", benchmark: "C" })?.name).toBe("B");
    expect(normalizeOfficialBenchmark({ reference_index: "D" })?.name).toBe("D");
    expect(normalizeOfficialBenchmark({ index_name: "E" })?.name).toBe("E");
  });

  it("arrastra identificadores y fuente cuando los hay", () => {
    expect(
      normalizeOfficialBenchmark(
        { name: "MSCI World NR EUR", isin: "IE00B0M62Q58", ticker: "MXWO", id: "idx-1", source: "morningstar" },
        "BBDD_ACTIVOS"
      )
    ).toEqual({
      name: "MSCI World NR EUR",
      asset_id: "idx-1",
      isin: "IE00B0M62Q58",
      ticker: "MXWO",
      source: "morningstar"
    });
  });
});

describe("officialBenchmarkLine", () => {
  it("sin índice no hay línea: la ficha no dibuja la fila", () => {
    expect(officialBenchmarkLine(undefined)).toBe("");
  });

  it("no inventa un hueco: nunca devuelve «N/D» ni un guion", () => {
    const linea = officialBenchmarkLine(undefined);
    expect(linea).not.toMatch(/N\/D|n\/d|-|—|\?/);
    expect(linea.length).toBe(0);
  });

  it("une nombre, ticker e ISIN, en ese orden y solo los que haya", () => {
    expect(officialBenchmarkLine({ name: "MSCI World NR EUR" })).toBe("MSCI World NR EUR");
    expect(officialBenchmarkLine({ name: "MSCI World NR EUR", ticker: "MXWO" })).toBe("MSCI World NR EUR · MXWO");
    expect(officialBenchmarkLine({ name: "MSCI World NR EUR", isin: "IE00B0M62Q58" })).toBe(
      "MSCI World NR EUR · IE00B0M62Q58"
    );
    expect(officialBenchmarkLine({ name: "N", ticker: "T", isin: "I" })).toBe("N · T · I");
  });

  it("un ticker o un ISIN en blanco no deja separadores sueltos", () => {
    expect(officialBenchmarkLine({ name: "Euribor 6M", ticker: "   ", isin: "" })).toBe("Euribor 6M");
    expect(officialBenchmarkLine({ name: "Euribor 6M", ticker: "", isin: "I" })).toBe("Euribor 6M · I");
  });
});

describe("cloneOfficialBenchmark", () => {
  it("copia, no comparte referencia; y undefined sigue siendo undefined", () => {
    const original = { name: "MSCI World NR EUR", ticker: "MXWO" };
    const copia = cloneOfficialBenchmark(original);
    expect(copia).toEqual(original);
    expect(copia).not.toBe(original);
    expect(cloneOfficialBenchmark(undefined)).toBeUndefined();
  });
});
