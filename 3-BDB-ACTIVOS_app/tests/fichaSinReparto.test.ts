import { describe, expect, test } from "vitest";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { NOTA_DEL_REPARTO_NETO } from "../src/core/repartoNeto";

/**
 * El fondo cuyo reparto no cuadra no enseña uno anterior, y lo dice (decisión 52 de Óscar, 05-11-2026). Son los fondos sin
 * `declared/exposure`, como este, que se sale más de un punto. Lazard Small Caps Euro, que fue el caso de esa decisión, ya entra:
 * se sale menos de un punto (decisión A-63), y por eso está en la última parte.
 */

function fondo(partes: Partial<InstrumentoDeLaBase> = {}, tipo = "FUND"): InstrumentoDeLaBase {
  return {
    isin: "IE00BDTYYP61",
    raiz: { instrument_type: tipo, identity: { name: "Un fondo sin reparto", currency: "EUR" } },
    tarjeta: { instrument_id: "IE00BDTYYP61" },
    calidad: {
      fitness: { RADIOGRAFIA_DE_CARTERA: { apt: false, missing: ["declared/exposure.asset_mix", "declared/exposure.confidence"] } },
      absences: [{ path: "declared/exposure.asset_mix.equity", reason: "NOT_PROVIDED" }]
    },
    bloques: {},
    ...partes
  };
}

const composicion = (instrumento: InstrumentoDeLaBase, modoCliente = false) =>
  componerFicha(instrumento, undefined, { modoCliente }).secciones.find((seccion) => seccion.id === "composicion");

describe("una ficha sin reparto lo dice", () => {
  test("una fila con «Falta el dato», y no una sección que desaparece", () => {
    const seccion = composicion(fondo());
    expect(seccion?.titulo).toBe("Composición");
    expect(seccion?.filas).toHaveLength(1);
    expect(seccion?.filas[0]).toMatchObject({ rotulo: "Reparto por clase de activo", valor: "Falta el dato", ausencia: "falta" });
    expect(seccion?.procedencia.map((trozo) => trozo.texto).join("")).toBe("Sin reparto que cuadre");
    expect(seccion?.nota).toBe("El proveedor no lo publica, o lo que declara no suma el 100 %. No se completa con ceros ni se enseña uno anterior.");
  });

  test("y «Entrar en una radiografía» dice lo mismo", () => {
    const ficha = componerFicha(fondo());
    const radiografia = JSON.stringify(ficha).match(/Entrar en una radiografía[^}]*/)?.[0] ?? "";
    expect(radiografia).toContain("Falta el dato");
  });

  test("en Modo cliente se queda el hueco y se va la explicación, que es cocina", () => {
    const seccion = composicion(fondo(), true);
    expect(seccion?.filas[0]?.valor).toBe("Falta el dato");
    expect(seccion?.nota).toBeUndefined();
  });

  test("un ETF también; una acción no, porque su composición se deriva del tipo", () => {
    expect(composicion(fondo({}, "ETF"))?.filas[0]?.valor).toBe("Falta el dato");
    expect(composicion(fondo({}, "STOCK"))).toBeUndefined();
  });

  test("con reparto, las clases de siempre y sin la fila del hueco", () => {
    const seccion = composicion(
      fondo({
        tarjeta: { instrument_id: "X", exposure: { asset_mix: { equity: 0.97, fixed_income: 0, cash: 0.03, other: 0 }, derivation: "DECLARED" } },
        bloques: { "declared/exposure": { as_of: "2026-09-30" } }
      })
    );
    expect(seccion?.filas.map((fila) => fila.rotulo)).not.toContain("Reparto por clase de activo");
    expect(seccion?.filas).toHaveLength(2);
    expect(seccion?.nota).toBeUndefined();
  });
});

describe("un reparto neto se enseña tal cual (decisión A-63)", () => {
  const conMezcla = (asset_mix: Record<string, number>, modoCliente = false) =>
    composicion(
      fondo({
        isin: "FR0000174310",
        tarjeta: { instrument_id: "FR0000174310", exposure: { asset_mix, derivation: "DECLARED" } },
        bloques: { "declared/exposure": { as_of: "2026-09-30" } }
      }),
      modoCliente
    );

  test("Lazard Small Caps Euro: la renta fija negativa sale con su cifra, y se dice por qué", () => {
    const seccion = conMezcla({ equity: 1.000401, fixed_income: -0.000844, cash: 0.000432, other: 0.000011 });
    /* Un reparto es un peso: un decimal (apartado 6). La liquidez, 0,04 %, a un decimal es cero y no se pinta (decisión 113). */
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([
      ["Renta variable", "100,0\u00a0%"],
      ["Renta fija", "−0,1\u00a0%"]
    ]);
    expect(seccion?.nota).toBe(NOTA_DEL_REPARTO_NETO);
  });

  test("lo que a dos decimales es cero no se pinta, sea del signo que sea, y la nota no habla de una fila que no sale (decisión 113)", () => {
    /* Robeco QI Emerging Markets: su única clase fuera es Otros −0,0033 %. */
    const seccion = conMezcla({ equity: 0.9992, fixed_income: 0.000004, cash: 0.0008, other: -0.000033 });
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([
      ["Renta variable", "99,9\u00a0%"],
      ["Liquidez", "0,1\u00a0%"]
    ]);
    expect(seccion?.nota).toBeUndefined();
  });

  /* Con el peso a un decimal (migración al formato único), el corte de la precisión escrita es la décima: los datos se escalan para
     seguir probando lo mismo, que sale lo que se escribe distinto de cero y no sale lo que se escribe cero. */
  test("el corte es lo que se escribe: un −0,1 % sale, con su nota, y un 0,04 % no", () => {
    const seccion = conMezcla({ equity: 1.0002, fixed_income: 0.0004, cash: 0, other: -0.0006 });
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([
      ["Renta variable", "100,0\u00a0%"],
      ["Otros", "−0,1\u00a0%"]
    ]);
    expect(seccion?.nota).toBe(NOTA_DEL_REPARTO_NETO);
  });

  test("un 100,00 % que por décimas de milésima pasa de 1 no sale de 0-100 en lo que se lee: sin nota", () => {
    const seccion = conMezcla({ equity: 1.00001, fixed_income: 0, cash: 0, other: -0.00001 });
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([["Renta variable", "100,0\u00a0%"]]);
    expect(seccion?.nota).toBeUndefined();
  });

  test("delante del cliente también: es una cifra de la ficha, no cocina", () => {
    /* Escalado como el de arriba: a un decimal, el −0,04 % de antes se escribiría cero y no saldría. */
    const seccion = conMezcla({ equity: 0.9975, fixed_income: 0, cash: 0.0062, other: -0.0037 }, true);
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([
      ["Renta variable", "99,8\u00a0%"],
      ["Liquidez", "0,6\u00a0%"],
      ["Otros", "−0,4\u00a0%"]
    ]);
    expect(seccion?.nota).toBe(NOTA_DEL_REPARTO_NETO);
  });

  test("C-29: el más apalancado del canónico sale tal cual, con su signo y la nota del reparto neto", () => {
    /* ES0137396000, canónico del 17-11-2026: 3,198089 + 0,115421 − 2,425742 + 0,112232 = 1. */
    const seccion = conMezcla({ equity: 3.198089, fixed_income: 0.115421, cash: -2.425742, other: 0.112232 });
    expect(seccion?.filas.map((fila) => [fila.rotulo, fila.valor])).toEqual([
      ["Renta variable", "319,8 %"],
      ["Renta fija", "11,5 %"],
      ["Liquidez", "−242,6 %"],
      ["Otros", "11,2 %"]
    ]);
    expect(seccion?.nota).toBe(NOTA_DEL_REPARTO_NETO);
  });

  test("una clase a cero no se pinta, y sin nada fuera de 0-100 no hay nota", () => {
    const seccion = conMezcla({ equity: 0.97, fixed_income: 0, cash: 0.03, other: 0 });
    expect(seccion?.filas.map((fila) => fila.rotulo)).toEqual(["Renta variable", "Liquidez"]);
    expect(seccion?.nota).toBeUndefined();
  });
});
