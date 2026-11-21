/**
 * Decisión 76: la ficha del oro dice ETC, que no es ni un fondo ni un ETF, y lo que no le aplica no se pinta como cero. Medirlo lo
 * decide el servidor, con su lista: esto es solo lo que se lee. La columna Producto y el papel dicen ETF, y Óscar lo sabe.
 */
import { describe, expect, test } from "vitest";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";

const COSTES_DEL_ORO = { as_of: "2026-10-31", ongoing_charge: 0.0012, ongoing_charge_source: "PROVIDER", management_fee: 0, transaction_costs: 0, transaction_costs_source: "PROVIDER" };

function ficha(tipo: string, nombre: string, bloques: InstrumentoDeLaBase["bloques"] = { "declared/costs": COSTES_DEL_ORO }) {
  return componerFicha({
    isin: "IE00B4ND3602",
    raiz: { instrument_type: tipo, identity: { name: nombre, currency: "USD" }, identifiers: { ticker: "IGLN" } },
    tarjeta: { instrument_id: "IE00B4ND3602" },
    calidad: undefined,
    bloques
  } as InstrumentoDeLaBase);
}

const filaDe = (compuesta: ReturnType<typeof ficha>, rotulo: string) =>
  compuesta.secciones.find((seccion) => seccion.id === "coste")?.filas.find((fila) => fila.rotulo === rotulo);

describe("el tipo", () => {
  test("un OTHER cuyo nombre dice que es un ETC, dice ETC", () => {
    expect(ficha("OTHER", "iShares Physical Gold ETC").tipo).toBe("ETC");
  });

  test.each([
    ["OTHER", "Un producto", "OTRO PRODUCTO"],
    /* «ETC» tiene que ser una palabra: ni «Etcétera» ni unas siglas dentro de otra cosa. */
    ["OTHER", "Etcetera Metals", "OTRO PRODUCTO"],
    ["OTHER", "FETCH Gold", "OTRO PRODUCTO"],
    /* El tipo que dé la base manda sobre el nombre. */
    ["ETF", "Algo ETC", "ETF"],
    ["FUND", "Fondo ETC", "FONDO DE INVERSIÓN"]
  ])("%s «%s» sigue diciendo %s", (tipo, nombre, esperado) => {
    expect(ficha(tipo, nombre).tipo).toBe(esperado);
  });
});

describe("la comisión de gestión", () => {
  test("a un ETC no le aplica, y no se pinta como cero", () => {
    const compuesta = ficha("OTHER", "iShares Physical Gold ETC");
    expect(filaDe(compuesta, "Comisión de gestión")).toMatchObject({
      valor: "No aplica",
      ausencia: "no-aplica",
      glosa: "Un ETC no es un fondo: lo que cobra es su coste corriente."
    });
    expect(filaDe(compuesta, "Coste corriente")?.valor).toBe("0,12\u00a0%");
  });

  test("a un fondo con su cifra se le sigue enseñando, también si es cero: es lo que declara", () => {
    expect(filaDe(ficha("FUND", "Un fondo"), "Comisión de gestión")?.valor).toBe("0,00\u00a0%");
    const conCifra = ficha("FUND", "Un fondo", { "declared/costs": { ...COSTES_DEL_ORO, management_fee: 0.0065 } });
    expect(filaDe(conCifra, "Comisión de gestión")?.valor).toBe("0,65\u00a0%");
  });
});
