/**
 * Decisión 59, el cableado: de los documentos de la base nueva a la entrada de los avisos. Los documentos son SIMULADOS con
 * la forma del contrato `instrument-declared-target-market.v2`; la lectura se prueba con un lector falso, sin base.
 */
import { describe, expect, test } from "vitest";
import type { Documento } from "../src/adapters/baseNuevaLectura";
import { leerMercadoObjetivo, mercadoObjetivoDeLosDocumentos } from "../src/adapters/mercadoObjetivoDeLaCartera";

const MERCADO: Documento = {
  source: "issuer:ishares",
  target_market_as_of: "2026-09-30",
  investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
  knowledge: { basic: "NEUTRAL", informed: "YES", advanced: "YES" },
  loss_capacity: { no_loss: "NO", no_guarantee: "YES" },
  min_holding_period: { years: 5 }
};

describe("de los documentos a la entrada de las reglas", () => {
  test("el horizonte del KID manda sobre el del fabricante, como en la ficha", () => {
    expect(mercadoObjetivoDeLosDocumentos(MERCADO, { recommended_holding_years: 6 })).toEqual({
      estado: "documento",
      mercado: {
        emisor: "iShares",
        fecha: "2026-09-30",
        horizonte: { anos: 6, fuente: "KID" },
        minorista: "YES",
        conocimientoBasico: "NEUTRAL",
        sinPerdidas: "NO"
      }
    });
  });

  test("sin KID, los años del fabricante; con código, el código y no unos años", () => {
    expect(mercadoObjetivoDeLosDocumentos(MERCADO, undefined)).toMatchObject({ mercado: { horizonte: { anos: 5, fuente: "fabricante" } } });
    expect(mercadoObjetivoDeLosDocumentos({ ...MERCADO, min_holding_period: { code: "L" } }, {})).toMatchObject({
      mercado: { horizonte: { codigo: "L", fuente: "fabricante" } }
    });
  });

  test("lo que el documento no trae no llega, y sin documento no hay mercado", () => {
    const resultado = mercadoObjetivoDeLosDocumentos({ source: "issuer:vanguard", target_market_as_of: "2026-06-30" }, undefined);
    expect(resultado).toEqual({ estado: "documento", mercado: { emisor: "Vanguard", fecha: "2026-06-30" } });
    expect(mercadoObjetivoDeLosDocumentos(undefined, undefined)).toEqual({ estado: "sin-documento" });
  });

  test("decisión B-66: sin mercado objetivo, los años del KID llegan solos; sin años, nada", () => {
    expect(mercadoObjetivoDeLosDocumentos(undefined, { recommended_holding_years: 5 })).toEqual({
      estado: "solo-horizonte",
      horizonte: { anos: 5, fuente: "KID" }
    });
    expect(mercadoObjetivoDeLosDocumentos(undefined, { recommended_holding_years: "cinco" })).toEqual({ estado: "sin-documento" });
    expect(mercadoObjetivoDeLosDocumentos(undefined, {})).toEqual({ estado: "sin-documento" });
  });
});

describe("la lectura", () => {
  function lector(documentos: Record<string, Documento>) {
    const pedidas: string[] = [];
    const leer = async (ruta: string) => {
      pedidas.push(ruta);
      return documentos[ruta];
    };
    return { leer, pedidas };
  }

  test("lee la tarjeta y, si lo declara, el mercado objetivo y el regulatorio", async () => {
    const { leer, pedidas } = lector({
      "instruments/IE00B4L5Y983/read/card": { available_sections: ["regulatory", "target_market", "costs"] },
      "instruments/IE00B4L5Y983/declared/target_market": MERCADO,
      "instruments/IE00B4L5Y983/declared/regulatory": { recommended_holding_years: 5 }
    });
    const datos = await leerMercadoObjetivo("IE00B4L5Y983", leer, true);
    expect(datos).toMatchObject({ estado: "documento", mercado: { horizonte: { anos: 5, fuente: "KID" } } });
    expect(pedidas.sort()).toEqual([
      "instruments/IE00B4L5Y983/declared/regulatory",
      "instruments/IE00B4L5Y983/declared/target_market",
      "instruments/IE00B4L5Y983/read/card"
    ]);
  });

  test("si la tarjeta no declara ninguno de los dos, no los pide", async () => {
    const { leer, pedidas } = lector({ "instruments/X/read/card": { available_sections: ["costs"] } });
    expect(await leerMercadoObjetivo("X", leer, true)).toEqual({ estado: "sin-documento" });
    expect(pedidas).toEqual(["instruments/X/read/card"]);
  });

  test("decisión B-66: con el regulatorio y sin mercado objetivo, lee solo el regulatorio y trae el horizonte del KID", async () => {
    const { leer, pedidas } = lector({
      "instruments/X/read/card": { available_sections: ["regulatory"] },
      "instruments/X/declared/regulatory": { recommended_holding_years: 7 }
    });
    expect(await leerMercadoObjetivo("X", leer, true)).toEqual({ estado: "solo-horizonte", horizonte: { anos: 7, fuente: "KID" } });
    expect(pedidas.sort()).toEqual(["instruments/X/declared/regulatory", "instruments/X/read/card"]);
  });

  test("decisión B-66: con el regulatorio sin años, sin documento", async () => {
    const { leer } = lector({
      "instruments/X/read/card": { available_sections: ["regulatory"] },
      "instruments/X/declared/regulatory": { kid_date: "2026-01-01" }
    });
    expect(await leerMercadoObjetivo("X", leer, true)).toEqual({ estado: "sin-documento" });
  });

  test("un instrumento que la base no tiene es «sin documento»; una base que no contesta, «sin leer»", async () => {
    expect(await leerMercadoObjetivo("NO-ESTA", lector({}).leer, true)).toEqual({ estado: "sin-documento" });
    const falla = async () => {
      throw new Error("La base nueva respondió 503");
    };
    expect(await leerMercadoObjetivo("X", falla, true)).toEqual({ estado: "sin-leer" });
  });

  test("sin camino a la base no pregunta, y lo dice como «sin leer»", async () => {
    const { leer, pedidas } = lector({});
    expect(await leerMercadoObjetivo("X", leer, false)).toEqual({ estado: "sin-leer" });
    expect(pedidas).toEqual([]);
  });
});
