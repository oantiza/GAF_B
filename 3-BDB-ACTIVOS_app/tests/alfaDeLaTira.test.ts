import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";

/**
 * «Medir su alfa» en la tira dice contra qué se midió.
 *
 * Hay dos comparadores y nunca se ordenan juntos: el nuestro, contra el índice que declara el fondo, y el del
 * proveedor, contra el índice de su categoría Morningstar. Un alfa sin decir contra cuál no lo puede defender un
 * asesor. Y si la referencia no es una de las conocidas, la cifra va sola: no se inventa contra qué.
 */

function conAlfa(relative: Record<string, unknown>, tipo = "FUND"): InstrumentoDeLaBase {
  return {
    isin: "X",
    raiz: { instrument_type: tipo, identity: { name: "Un producto", currency: "EUR" } },
    tarjeta: {
      instrument_id: "X",
      metrics: { relative: { jensen_alpha: { "1y": 0.012 }, ...relative } },
      quality: { fitness: { MOSTRAR_ALPHA: { apt: true } } }
    },
    calidad: undefined,
    bloques: {}
  };
}

const alfa = (relative: Record<string, unknown>, tipo?: string) =>
  componerFicha(conAlfa(relative, tipo)).aptitudes.find((a) => a.rotulo === "Medir su alfa")?.valor;

describe("la tira dice contra qué se midió el alfa", () => {
  test("el nuestro, contra el índice que declara el fondo", () => {
    expect(alfa({ source: "COMPUTED", reference: "DECLARED_BENCHMARK_PROXY" })).toBe("+1,20\u00a0% a 1 año · contra su índice");
  });
  test("medido contra un equivalente al que declara, no dice «su índice»", () => {
    expect(
      alfa({ source: "COMPUTED", reference: "DECLARED_BENCHMARK_PROXY", benchmark: { name: "Bloomberg Euro Corp", equivalent_of: "ICE BofA Euro Corporate" } })
    ).toBe("+1,20\u00a0% a 1 año · contra un índice equivalente al suyo");
  });
  test("el del proveedor, contra el índice de su categoría", () => {
    expect(alfa({ source: "PROVIDER", reference: "PROVIDER_CATEGORY_INDEX" })).toBe(
      "+1,20\u00a0% a 1 año · del proveedor, contra el índice de su categoría"
    );
  });
  test("una acción, contra el índice de su área o el de su plaza", () => {
    expect(alfa({ source: "COMPUTED", reference: "ASSIGNED_AREA_INDEX" }, "STOCK")).toBe("+1,20\u00a0% a 1 año · contra el índice de su área");
    expect(alfa({ source: "COMPUTED", reference: "ASSIGNED_MARKET_INDEX" }, "STOCK")).toBe("+1,20\u00a0% a 1 año · contra el índice de su plaza");
  });
  test("sin referencia, la cifra sola", () => {
    expect(alfa({})).toBe("+1,20\u00a0% a 1 año");
  });
  test("una pareja que no casa no se nombra: la cifra sola", () => {
    expect(alfa({ source: "PROVIDER", reference: "DECLARED_BENCHMARK_PROXY" })).toBe("+1,20\u00a0% a 1 año");
    expect(alfa({ source: "COMPUTED", reference: "OTRA_COSA" })).toBe("+1,20\u00a0% a 1 año");
  });
});
