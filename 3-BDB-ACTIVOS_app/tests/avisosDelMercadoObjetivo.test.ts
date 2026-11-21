/**
 * Decisión 59: los avisos R1 a R4 que cruzan la cartera modelo con el mercado objetivo del fabricante
 * (`INFORME_EMT_EET_2026-11-09.md`, «Qué comprobaría la app»). Ejemplos con resultado conocido, escritos a mano.
 */
import { describe, expect, test } from "vitest";
import {
  aQuienNoLoPiensa,
  avisosDelMercadoObjetivo,
  caducado,
  type CarteraParaAvisos,
  type MercadoObjetivoDeUnaPosicion,
  type PosicionParaAvisos
} from "../src/core/avisosDelMercadoObjetivo";

const HOY = new Date("2026-11-09T10:00:00Z");

/** Lo que dicen los 23 ETF medidos: minorista, conocimiento básico, no para quien no puede perder, 5 años, de septiembre. */
const TIPICO: MercadoObjetivoDeUnaPosicion = {
  emisor: "iShares",
  fecha: "2026-09-30",
  horizonte: { anos: 5, fuente: "KID" },
  minorista: "YES",
  conocimientoBasico: "YES",
  sinPerdidas: "NO"
};

function posicion(assetId: string, pesoPercent: number, mercado?: Partial<MercadoObjetivoDeUnaPosicion> | "sin-documento" | "sin-leer"): PosicionParaAvisos {
  const datos =
    mercado === "sin-documento" || mercado === "sin-leer"
      ? { estado: mercado }
      : { estado: "documento" as const, mercado: { ...TIPICO, ...mercado } };
  return { assetId, nombre: `Fondo ${assetId}`, pesoPercent, datos };
}

const cartera = (posiciones: PosicionParaAvisos[], resto: Partial<CarteraParaAvisos> = {}): CarteraParaAvisos => ({ posiciones, ...resto });

const reglas = (resultado: ReturnType<typeof avisosDelMercadoObjetivo>, assetId: string) =>
  resultado.posiciones.find((p) => p.assetId === assetId)?.avisos.map((a) => a.regla) ?? [];

describe("R1: el horizonte de la cartera frente al del fondo", () => {
  test("3 años frente a 5 del KID avisa, con la frase de Óscar y la fuente", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 40)], { horizonteAnos: 3 }), HOY);
    expect(r.posiciones).toHaveLength(1);
    expect(r.posiciones[0].pesoPercent).toBe(40);
    expect(r.posiciones[0].avisos).toEqual([
      { regla: "R1", destacado: false, texto: "La cartera se ha definido a 3 años y este fondo recomienda 5 años, según su KID." }
    ]);
  });

  test("con los años del fabricante dice que son suyos", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 40, { horizonte: { anos: 5, fuente: "fabricante" } })], { horizonteAnos: 3 }), HOY);
    expect(r.posiciones[0].avisos[0].texto).toBe(
      "La cartera se ha definido a 3 años y este fondo recomienda 5 años, según el mercado objetivo de iShares."
    );
  });

  test("igual o mayor no avisa, y un decimal escrito de otra forma tampoco", () => {
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 40)], { horizonteAnos: 5 }), HOY).posiciones).toEqual([]);
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 40)], { horizonteAnos: 7 }), HOY).posiciones).toEqual([]);
    expect(
      avisosDelMercadoObjetivo(cartera([posicion("A", 40, { horizonte: { anos: 2.5, fuente: "KID" } })], { horizonteAnos: 2.499 }), HOY).posiciones
    ).toEqual([]);
  });

  test("un código de plazo (L) no dispara: convertirlo en años sería inventar la cifra", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 40, { horizonte: { codigo: "L", fuente: "fabricante" } })], { horizonteAnos: 1 }), HOY);
    expect(r.posiciones).toEqual([]);
    expect(r.sinHorizonteEnAnos).toBe(1);
  });

  test("sin horizonte en la cartera no hay R1, ni se cuentan posiciones sin años", () => {
    const r = avisosDelMercadoObjetivo(
      cartera([posicion("A", 40, { horizonte: { anos: 10, fuente: "KID" } }), posicion("B", 60, { horizonte: undefined })]),
      HOY
    );
    expect(r.posiciones).toEqual([]);
    expect(r.sinHorizonteEnAnos).toBe(0);
  });
});

describe("R2: el mercado objetivo negativo", () => {
  test("NO a minorista avisa destacado", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 10, { minorista: "NO" })]), HOY);
    expect(r.posiciones[0].avisos).toEqual([
      { regla: "R2", destacado: true, texto: "iShares no lo piensa para clientes minoristas: es su mercado objetivo negativo." }
    ]);
  });

  test("NO a los dos lo dice en una frase", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 10, { minorista: "NO", conocimientoBasico: "NO" })]), HOY);
    expect(r.posiciones[0].avisos[0].texto).toBe(
      "iShares no lo piensa para clientes minoristas ni para quien solo tiene conocimiento básico: es su mercado objetivo negativo."
    );
  });

  test("NEUTRAL no es NO, y ausente tampoco", () => {
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 10, { minorista: "NEUTRAL", conocimientoBasico: "NEUTRAL" })]), HOY).posiciones).toEqual([]);
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 10, { minorista: undefined, conocimientoBasico: undefined })]), HOY).posiciones).toEqual([]);
    expect(aQuienNoLoPiensa("NEUTRAL", undefined)).toEqual([]);
  });

  test("la posición con mercado objetivo negativo va primero, aunque pese menos", () => {
    const r = avisosDelMercadoObjetivo(
      cartera([posicion("Grande", 60), posicion("Complejo", 5, { conocimientoBasico: "NO" })], { horizonteAnos: 3 }),
      HOY
    );
    expect(r.posiciones.map((p) => p.assetId)).toEqual(["Complejo", "Grande"]);
    expect(reglas(r, "Complejo")).toEqual(["R2", "R1"]);
  });
});

describe("R3: el mercado objetivo caducado", () => {
  test("13 meses avisa, con la fecha", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 20, { fecha: "2025-10-09" })]), HOY);
    expect(r.posiciones[0].avisos).toHaveLength(1);
    expect(r.posiciones[0].avisos[0].regla).toBe("R3");
    expect(r.posiciones[0].avisos[0].texto).toMatch(/^Su mercado objetivo es del 09\/10\/2025: tiene más de 12 meses, y iShares puede haberlo revisado después\.$/);
  });

  test("11 meses no avisa", () => {
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 20, { fecha: "2025-12-09" })]), HOY).posiciones).toEqual([]);
  });

  test("12 meses justos todavía no; el día siguiente, sí", () => {
    expect(caducado("2025-11-09", HOY)).toBe(false);
    expect(caducado("2025-11-08", HOY)).toBe(true);
    expect(caducado("no es una fecha", HOY)).toBe(false);
  });
});

describe("R4: la nota de cartera de nivel 1", () => {
  const cinco = [
    posicion("A", 30, { sinPerdidas: "NO" }),
    posicion("B", 5, { sinPerdidas: "NO" }),
    posicion("C", 25, { sinPerdidas: "YES" }),
    posicion("D", 20, { sinPerdidas: "NEUTRAL" }),
    posicion("E", 20, { sinPerdidas: undefined })
  ];

  test("con nivel 1, 2 de 5 posiciones y su peso, en una sola nota y no por posición", () => {
    const r = avisosDelMercadoObjetivo(cartera(cinco, { nivel: 1 }), HOY);
    expect(r.notaDeLaCartera).toEqual({
      posiciones: 2,
      de: 5,
      pesoPercent: 35,
      texto:
        "La cartera es de nivel 1 (Preservación): 2 de 5 posiciones (35,0\u00a0% del peso) no son compatibles con un cliente que no pueda asumir pérdidas, según su fabricante."
    });
    expect(r.posiciones).toEqual([]);
  });

  test("con nivel 2, o sin nivel, nada", () => {
    expect(avisosDelMercadoObjetivo(cartera(cinco, { nivel: 2 }), HOY).notaDeLaCartera).toBeUndefined();
    expect(avisosDelMercadoObjetivo(cartera(cinco), HOY).notaDeLaCartera).toBeUndefined();
  });

  test("las posiciones sin mercado objetivo cuentan en el total y se dice que no se han podido mirar", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 50, { sinPerdidas: "NO" }), posicion("B", 50, "sin-documento")], { nivel: 1 }), HOY);
    expect(r.notaDeLaCartera?.texto).toBe(
      "La cartera es de nivel 1 (Preservación): 1 de 2 posiciones (50,0\u00a0% del peso) no es compatible con un cliente que no pueda asumir pérdidas, según su fabricante. De 1 posición no hay mercado objetivo, y no se cuentan."
    );
  });

  test("si ninguna dice NO, no hay nota", () => {
    expect(avisosDelMercadoObjetivo(cartera([posicion("A", 100, { sinPerdidas: "YES" })], { nivel: 1 }), HOY).notaDeLaCartera).toBeUndefined();
  });
});

describe("las posiciones sin datos", () => {
  test("no avisan y se cuentan aparte, distinguiendo lo que no se pudo leer", () => {
    const r = avisosDelMercadoObjetivo(
      cartera([posicion("A", 40, "sin-documento"), posicion("B", 30, "sin-leer"), posicion("C", 30)], { horizonteAnos: 1, nivel: 1 }),
      HOY
    );
    expect(r).toMatchObject({ total: 3, conDocumento: 1, soloHorizonte: 0, sinDocumento: 1, sinLeer: 1 });
    expect(r.posiciones.map((p) => p.assetId)).toEqual(["C"]);
  });

  test("una cartera vacía no avisa de nada", () => {
    expect(avisosDelMercadoObjetivo(cartera([], { horizonteAnos: 3, nivel: 1 }), HOY)).toEqual({
      posiciones: [],
      total: 0,
      conDocumento: 0,
      soloHorizonte: 0,
      sinDocumento: 0,
      sinLeer: 0,
      sinHorizonteEnAnos: 0
    });
  });
});

describe("decisión B-66: el horizonte del KID solo, sin mercado objetivo", () => {
  const soloKid = (assetId: string, pesoPercent: number, anos: number): PosicionParaAvisos => ({
    assetId,
    nombre: `Fondo ${assetId}`,
    pesoPercent,
    datos: { estado: "solo-horizonte", horizonte: { anos, fuente: "KID" } }
  });

  test("R1 salta, dice que es del KID, y la posición cuenta aparte, no como sin documento", () => {
    const r = avisosDelMercadoObjetivo(cartera([soloKid("A", 30, 5), posicion("B", 70, "sin-documento")], { horizonteAnos: 3 }), HOY);
    expect(r.posiciones).toEqual([
      {
        assetId: "A",
        nombre: "Fondo A",
        pesoPercent: 30,
        avisos: [{ regla: "R1", destacado: false, texto: "La cartera se ha definido a 3 años y este fondo recomienda 5 años, según su KID." }]
      }
    ]);
    expect(r).toMatchObject({ total: 2, conDocumento: 0, soloHorizonte: 1, sinDocumento: 1, sinLeer: 0, sinHorizonteEnAnos: 0 });
  });

  test("R2, R3 y R4 no saltan: no hay mercado objetivo que mirar, y la nota de nivel 1 lo cuenta como sin mercado objetivo", () => {
    const r = avisosDelMercadoObjetivo(
      cartera([soloKid("A", 50, 2), posicion("B", 50, { sinPerdidas: "NO", horizonte: { anos: 1, fuente: "KID" } })], { horizonteAnos: 3, nivel: 1 }),
      HOY
    );
    expect(r.posiciones).toEqual([]);
    expect(r.notaDeLaCartera?.texto).toBe(
      "La cartera es de nivel 1 (Preservación): 1 de 2 posiciones (50,0\u00a0% del peso) no es compatible con un cliente que no pueda asumir pérdidas, según su fabricante. De 1 posición no hay mercado objetivo, y no se cuentan."
    );
  });

  test("sin horizonte en la cartera, nada; igual o mayor, nada", () => {
    expect(avisosDelMercadoObjetivo(cartera([soloKid("A", 100, 5)]), HOY).posiciones).toEqual([]);
    expect(avisosDelMercadoObjetivo(cartera([soloKid("A", 100, 5)], { horizonteAnos: 5 }), HOY).posiciones).toEqual([]);
  });

  test("con mercado objetivo y solo un código de plazo, sigue sin R1", () => {
    const r = avisosDelMercadoObjetivo(cartera([posicion("A", 40, { horizonte: { codigo: "M", fuente: "fabricante" } })], { horizonteAnos: 1 }), HOY);
    expect(r.posiciones).toEqual([]);
    expect(r.sinHorizonteEnAnos).toBe(1);
  });
});
