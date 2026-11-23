import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";

/**
 * Los repartos con las cuatro clases a cero (Óscar, 21-11-2026), en la ficha. La plataforma no escribe esos ceros: un fondo
 * sin reparto conocido (Azvalor Lux Altum Faith, Oportunidad Bursátil) dice «Falta el dato»; el ETC de oro físico lleva
 * en la tarjeta un 100 % en «otros» deducido del tipo, y la ficha lo enseña como derivado, no como declarado.
 */
const composicion = (instrumento: InstrumentoDeLaBase) => componerFicha(instrumento).secciones.find((s) => s.id === "composicion");

describe("la composición con un reparto a cero", () => {
  test("un fondo sin reparto conocido: «Falta el dato», sin ningún 0 %", () => {
    const seccion = composicion({
      isin: "LU1814994353",
      raiz: { instrument_type: "FUND", identity: { name: "Azvalor Lux SICAV Altum Faith - Consistent Equity R", currency: "EUR" } },
      tarjeta: { instrument_id: "LU1814994353", identity: { name: "Azvalor" } },
      calidad: { absences: [{ path: "declared/exposure.asset_mix.equity", reason: "NOT_PROVIDED" }] },
      bloques: {}
    });
    expect(seccion?.filas).toEqual([expect.objectContaining({ rotulo: "Reparto por clase de activo", valor: "Falta el dato", ausencia: "falta" })]);
    expect(JSON.stringify(seccion)).not.toContain("0,0 %");
  });

  test("el ETC de oro: 100 % en «otros», derivado del tipo y con su nota", () => {
    const seccion = composicion({
      isin: "IE00B4ND3602",
      raiz: { instrument_type: "OTHER", identity: { name: "iShares Physical Gold ETC", currency: "USD" } },
      tarjeta: {
        instrument_id: "IE00B4ND3602",
        identity: { name: "iShares Physical Gold ETC" },
        exposure: { asset_mix: { equity: 0, fixed_income: 0, cash: 0, other: 1 }, confidence: 1, derivation: "BY_INSTRUMENT_TYPE" }
      },
      calidad: { absences: [] },
      bloques: {}
    });
    expect(seccion?.filas).toHaveLength(1);
    expect(seccion?.filas[0]?.valor.replace(/\s/g, " ")).toBe("100,0 %");
    expect(JSON.stringify(seccion?.procedencia)).toContain("Derivada del tipo");
    expect(seccion?.nota).toContain("materias primas");
    expect(seccion?.nota).not.toContain("acción");
  });
});
