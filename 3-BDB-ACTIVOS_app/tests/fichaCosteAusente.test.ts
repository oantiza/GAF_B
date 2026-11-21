import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";

/**
 * Ficha (auditoría de frontend, FMT-14): la base guarda una ausencia como `null`, y `Number(null)` es 0.
 * La aptitud «Comparar su coste» escribía entonces «0,00 %»: un coste inventado. Un coste que falta se
 * dice que falta, con el texto común, y una cifra ausente en las demás pruebas de aptitud no se vuelve cero.
 */
function conTarjeta(tarjeta: Record<string, unknown>): InstrumentoDeLaBase {
  return {
    isin: "LU0011889846",
    raiz: { identity: { name: "Un fondo", currency: "EUR" }, listing_status: "LISTED" },
    tarjeta: { instrument_id: "LU0011889846", identity: { name: "Un fondo" }, ...tarjeta },
    calidad: undefined,
    bloques: {}
  };
}
const aptitud = (instrumento: InstrumentoDeLaBase, rotulo: string) =>
  componerFicha(instrumento).aptitudes.find((a) => a.rotulo === rotulo);

describe("FMT-14: una cifra ausente en la tira de aptitudes no es un cero", () => {
  test("«Comparar su coste» con el coste a null dice que falta el dato, no «0,00 %»", () => {
    const fila = aptitud(
      conTarjeta({ costs: { ongoing_charge: null }, quality: { fitness: { COMPARAR_COSTE: { apt: true } } } }),
      "Comparar su coste"
    );
    expect(fila?.valor).not.toContain("0,00");
    expect(fila?.valor).toContain("falta el dato");
    expect(fila?.estado).toBe("si");
  });

  test("con el coste, se escribe el coste", () => {
    /* 0,0185 es un 1,85 %. */
    const fila = aptitud(
      conTarjeta({ costs: { ongoing_charge: 0.0185 }, quality: { fitness: { COMPARAR_COSTE: { apt: true } } } }),
      "Comparar su coste"
    );
    expect(fila?.valor.replace(/\s/g, " ")).toBe("1,85 %");
  });

  test("«Comparar su rentabilidad» con la rentabilidad a null no escribe «0,00 %»", () => {
    const fila = aptitud(
      conTarjeta({ metrics: { annualized_return: { "1y": null } }, quality: { fitness: { COMPARAR_RENTABILIDAD: { apt: true } } } }),
      "Comparar su rentabilidad"
    );
    expect(fila?.valor).not.toContain("0,00");
  });
});
