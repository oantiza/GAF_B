import { describe, expect, test } from "vitest";
import {
  asignarObjetivosPorClase,
  fraseDeClaseQueNoCabe,
  repartirLoLibreAPartesIguales
} from "../src/core/asignacionTactica";

const RV = "Renta variable";
const RF = "Renta fija";
const CLASES: Record<string, string> = { A: "EQUITY", B: "EQUITY", D: "EQUITY", C: "FIXED_INCOME", E: "FIXED_INCOME" };
const claseDe = (id: string) => CLASES[id] ?? "UNKNOWN";
const espacios = (texto: string) => texto.replace(/\u00a0/g, " ");

describe("asignación táctica: lo fijado no se toca", () => {
  test("el caso del hallazgo: candado A 30 %, importe fijo B 30.000 € al 30 %, objetivo 40/60", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "B", weight_percent: 30, keepEuros: true },
        { asset_id: "C", weight_percent: 40 }
      ],
      claseDe,
      candados: { A: true },
      objetivos: { EQUITY: 40, FIXED_INCOME: 60 }
    });
    // Antes: A 20 %, B 20 % con 30.000 € fijos, C 60 %, y el aviso de que todo había ido bien.
    expect(resultado.pesos).toEqual({});
    expect(resultado.noCaben).toEqual([{ clase: "EQUITY", objetivo: 40, fijado: 60, sentido: "bajar" }]);
    expect(espacios(fraseDeClaseQueNoCabe(resultado.noCaben[0], RV))).toBe(
      "Renta variable no puede bajar al 40,0 %: el 60,0 % está fijado."
    );
  });

  test("reparte solo entre lo libre y la cartera sigue sumando 100", () => {
    const positions = [
      { asset_id: "A", weight_percent: 30 },
      { asset_id: "B", weight_percent: 30, keepEuros: true },
      { asset_id: "D", weight_percent: 10 },
      { asset_id: "C", weight_percent: 30 }
    ];
    const resultado = asignarObjetivosPorClase({
      positions,
      claseDe,
      candados: { A: true },
      objetivos: { EQUITY: 65, FIXED_INCOME: 35 }
    });
    expect(resultado.noCaben).toEqual([]);
    // A y B no aparecen: no se les cambia nada. D recibe lo que queda de la clase: 65 − 60.
    expect(resultado.pesos).toEqual({ D: 5, C: 35 });
    const suma = positions.reduce((total, p) => total + (resultado.pesos[p.asset_id] ?? p.weight_percent), 0);
    expect(suma).toBe(100);
  });

  test("dentro de lo libre se conserva la proporción", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 30 },
        { asset_id: "D", weight_percent: 10 },
        { asset_id: "C", weight_percent: 40 },
        { asset_id: "E", weight_percent: 20 }
      ],
      claseDe,
      candados: {},
      objetivos: { EQUITY: 60, FIXED_INCOME: 40 }
    });
    expect(resultado.pesos).toEqual({ A: 45, D: 15, C: 26.67, E: 13.33 });
  });

  test("una clase toda fijada no puede subir, y lo dice con la cifra", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 60 },
        { asset_id: "C", weight_percent: 40 }
      ],
      claseDe,
      candados: { A: true },
      objetivos: { EQUITY: 70, FIXED_INCOME: 30 }
    });
    expect(resultado.noCaben).toEqual([{ clase: "EQUITY", objetivo: 70, fijado: 60, sentido: "subir" }]);
    expect(espacios(fraseDeClaseQueNoCabe(resultado.noCaben[0], RV))).toBe(
      "Renta variable no puede subir al 70,0 %: todas sus posiciones están fijadas en el 60,0 %."
    );
  });

  test("una clase toda fijada que se queda donde está no es un problema", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 60 },
        { asset_id: "C", weight_percent: 40 }
      ],
      claseDe,
      candados: { A: true },
      objetivos: { EQUITY: 60, FIXED_INCOME: 40 }
    });
    expect(resultado.noCaben).toEqual([]);
    expect(resultado.pesos).toEqual({ C: 40 });
  });

  test("el objetivo redondeado de una clase intacta no se toma por una bajada", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 33.333 },
        { asset_id: "C", weight_percent: 66.667 }
      ],
      claseDe,
      candados: { A: true },
      objetivos: { EQUITY: 33.33, FIXED_INCOME: 66.67 }
    });
    expect(resultado.noCaben).toEqual([]);
    expect(resultado.pesos).toEqual({ C: 66.67 });
  });

  test("lo libre a 0 % recibe el objetivo a partes iguales, sin perder centésimas", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 0 },
        { asset_id: "D", weight_percent: 0 },
        { asset_id: "B", weight_percent: 0 },
        { asset_id: "C", weight_percent: 100 }
      ],
      claseDe,
      candados: {},
      objetivos: { EQUITY: 50, FIXED_INCOME: 50 }
    });
    const pesos = resultado.pesos;
    expect(Number((pesos.A + pesos.D + pesos.B).toFixed(2))).toBe(50);
    expect(pesos.C).toBe(50);
  });

  test("dos clases que no caben se dicen las dos, y no se aplica ninguna", () => {
    const resultado = asignarObjetivosPorClase({
      positions: [
        { asset_id: "A", weight_percent: 50 },
        { asset_id: "D", weight_percent: 10 },
        { asset_id: "C", weight_percent: 30 },
        { asset_id: "E", weight_percent: 10 }
      ],
      claseDe,
      candados: { A: true, C: true },
      objetivos: { EQUITY: 45, FIXED_INCOME: 25 }
    });
    expect(resultado.pesos).toEqual({});
    expect(resultado.noCaben.map((clase) => clase.clase)).toEqual(["EQUITY", "FIXED_INCOME"]);
    expect(espacios(fraseDeClaseQueNoCabe(resultado.noCaben[1], RF))).toBe(
      "Renta fija no puede bajar al 25,0 %: el 30,0 % está fijado."
    );
  });

  test("un peso se escribe con un decimal", () => {
    expect(
      espacios(fraseDeClaseQueNoCabe({ clase: "EQUITY", objetivo: 12.5, fijado: 33.333, sentido: "bajar" }, RV))
    ).toBe("Renta variable no puede bajar al 12,5 %: el 33,3 % está fijado.");
  });
});

describe("repartir lo libre a partes iguales", () => {
  test("tres al 0 % suman exactamente 100: el resto va a la última", () => {
    expect(
      repartirLoLibreAPartesIguales(
        [
          { asset_id: "A", weight_percent: 0 },
          { asset_id: "B", weight_percent: 0 },
          { asset_id: "C", weight_percent: 0 }
        ],
        {}
      )
    ).toEqual({ A: 33.33, B: 33.33, C: 33.34 });
  });

  test("un hueco más pequeño que las posiciones no da ningún peso negativo", () => {
    /* 99,95 % fijado y 7 libres: redondeando hacia arriba, la última salía con −0,01. */
    const libres = Array.from({ length: 7 }, (_, i) => ({ asset_id: `L${i}`, weight_percent: 0 }));
    const pesos = repartirLoLibreAPartesIguales([{ asset_id: "F", weight_percent: 99.95 }, ...libres], { F: true });
    expect(Object.values(pesos).every((peso) => peso >= 0)).toBe(true);
    expect(Number(Object.values(pesos).reduce((total, peso) => total + peso, 0).toFixed(6))).toBe(0.05);
  });

  test("cuadra exacto para cualquier número de posiciones", () => {
    for (let cuantas = 1; cuantas <= 40; cuantas += 1) {
      const positions = Array.from({ length: cuantas }, (_, i) => ({ asset_id: `P${i}`, weight_percent: 0 }));
      const suma = Object.values(repartirLoLibreAPartesIguales(positions, {})).reduce((total, peso) => total + peso, 0);
      expect(Number(suma.toFixed(6)), `${cuantas} posiciones`).toBe(100);
    }
  });

  test("candados e importes fijos conservan su peso: se reparte lo que dejan", () => {
    expect(
      repartirLoLibreAPartesIguales(
        [
          { asset_id: "A", weight_percent: 40 },
          { asset_id: "B", weight_percent: 20, keepEuros: true },
          { asset_id: "C", weight_percent: 0 },
          { asset_id: "D", weight_percent: 0 }
        ],
        { A: true }
      )
    ).toEqual({ C: 20, D: 20 });
  });

  test("sin hueco o sin posiciones libres no reparte nada", () => {
    expect(repartirLoLibreAPartesIguales([{ asset_id: "A", weight_percent: 100 }, { asset_id: "B", weight_percent: 0 }], { A: true })).toEqual({});
    expect(repartirLoLibreAPartesIguales([{ asset_id: "A", weight_percent: 50 }], { A: true })).toEqual({});
  });
});
