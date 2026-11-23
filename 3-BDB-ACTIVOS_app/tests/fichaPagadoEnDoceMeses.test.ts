import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";

/**
 * «Pagado en 12 meses» en la ficha de una acción, con la regla del 21-11-2026 de la plataforma: el cero que el proveedor
 * desmiente (rentabilidad o previsto positivos, o ex-dividendo del último año) ya no llega a la base, y su ausencia consta
 * como NOT_PROVIDED en `quality/latest`. La ficha no decide nada: lee el bloque y la ausencia, y con el campo ausente
 * dice «Falta el dato»; con el cero de una empresa que no paga, escribe el cero.
 */
function accion(dividendos: Record<string, unknown>, ausencias: { path: string; reason: string }[] = []): InstrumentoDeLaBase {
  return {
    isin: "CH0030170408",
    raiz: { instrument_type: "STOCK", identity: { name: "Roche Holding AG", currency: "CHF" }, listing_status: "LISTED" },
    tarjeta: { instrument_id: "CH0030170408", identity: { name: "Roche Holding AG" } },
    calidad: { absences: ausencias },
    bloques: { "declared/dividends": { source: "canonical:fondosdb", as_of: "2026-11-16", ...dividendos } }
  };
}

const pagado = (instrumento: InstrumentoDeLaBase) =>
  componerFicha(instrumento)
    .secciones.find((s) => s.id === "dividendos")
    ?.filas.find((f) => f.rotulo === "Pagado en 12 meses");

describe("«Pagado en 12 meses» con la regla del cero falso", () => {
  test("sin el importe y con su ausencia NOT_PROVIDED: «Falta el dato», no un cero", () => {
    const fila = pagado(
      accion(
        { currency: "CHF", yield_12m: 0.022, forward_amount_per_share: 12.9 },
        [{ path: "declared/dividends.trailing_amount_per_share", reason: "NOT_PROVIDED" }]
      )
    );
    expect(fila?.valor).toBe("Falta el dato");
    expect(fila?.ausencia).toBe("falta");
  });

  test("el cero de una empresa que no paga se escribe como cero", () => {
    const fila = pagado(accion({ currency: "USD", yield_12m: 0, trailing_amount_per_share: 0 }));
    expect(fila?.ausencia).toBeUndefined();
    expect(fila?.valor).toMatch(/^0,00/);
  });
});
