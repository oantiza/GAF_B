/**
 * Los euros de la Comparativa de carteras (decisión 42). Las cifras están hechas a mano:
 * 250.000 × 0,40 = 100.000 de resultado y 350.000 de final; 250.000 × 0,30 = 75.000 y 325.000; 100.000 × 0,30 = 30.000 y 130.000.
 */
import { describe, expect, test } from "vitest";
import { capitalDeLaComparativa, lecturaDelCapital } from "../src/core/capitalDeLaComparativa";

const sinEspaciosDuros = (texto: string) => texto.normalize("NFKC");
const plano = (lectura: ReturnType<typeof lecturaDelCapital>) => sinEspaciosDuros(JSON.stringify(lectura));

describe("capitalDeLaComparativa", () => {
  test("el mismo capital en las dos: sus euros y la diferencia", () => {
    expect(capitalDeLaComparativa(250_000, 250_000, 0.4, 0.3)).toEqual({
      a: { capital: 250_000, resultado: 100_000, final: 350_000 },
      b: { capital: 250_000, resultado: 75_000, final: 325_000 },
      diferencia: -25_000
    });
  });

  test("capitales distintos: cada una el suyo, y no se restan", () => {
    const { a, b, diferencia } = capitalDeLaComparativa(250_000, 100_000, 0.4, 0.3);
    expect(a?.final).toBe(350_000);
    expect(b?.final).toBe(130_000);
    expect(diferencia).toBeNull();
  });

  test("con un capital en una sola, la otra no lo toma prestado", () => {
    expect(capitalDeLaComparativa(250_000, undefined, 0.4, 0.3)).toEqual({ a: { capital: 250_000, resultado: 100_000, final: 350_000 }, b: null, diferencia: null });
    expect(capitalDeLaComparativa(undefined, 100_000, 0.4, 0.3)).toEqual({ a: null, b: { capital: 100_000, resultado: 30_000, final: 130_000 }, diferencia: null });
  });

  test("lo que no es un capital no da euros: vacío, cero, negativo, no finito", () => {
    for (const nada of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(capitalDeLaComparativa(nada, nada, 0.4, 0.3)).toEqual({ a: null, b: null, diferencia: null });
    }
  });

  test("sin rentabilidad acumulada tampoco hay importe: un cero creíble sería peor", () => {
    expect(capitalDeLaComparativa(250_000, 250_000, null, 0.3)).toEqual({ a: null, b: { capital: 250_000, resultado: 75_000, final: 325_000 }, diferencia: null });
  });

  test("una pérdida resta, y dos capitales a menos de medio céntimo son el mismo", () => {
    const { a, b, diferencia } = capitalDeLaComparativa(100_000, 100_000.004, -0.1, 0.1);
    expect(a?.resultado).toBeCloseTo(-10_000, 6);
    expect(a?.final).toBeCloseTo(90_000, 6);
    expect(b?.final).toBeCloseTo(110_000.0044, 6);
    expect(diferencia).toBeCloseTo(20_000.0044, 6);
    expect(capitalDeLaComparativa(100_000, 100_000.01, 0, 0).diferencia).toBeNull();
  });
});

describe("lecturaDelCapital con una cartera sin cifra (decisión 59)", () => {
  const FALTA = "Falta el dato";
  test("sin capital: esa columna y la resta faltan, y la otra sigue", () => {
    const lectura = lecturaDelCapital(undefined, undefined, 0.4035, null);
    expect(lectura.filas.map((fila) => fila.cells)).toEqual([
      ["Valor inicial", "100,00", FALTA, FALTA],
      ["Resultado acumulado", "+40,35", FALTA, FALTA],
      ["Valor final", "140,35", FALTA, FALTA]
    ]);
    expect(lectura.nota).toContain("No se ha fijado un capital");
    expect(lectura.nota).toContain("A termina en 140,35");
    expect(lectura.nota).toContain("De B falta el dato.");
    expect(plano(lectura)).not.toMatch(/N\/D|No aplica/);
  });

  test("también al revés", () => {
    const lectura = lecturaDelCapital(undefined, undefined, null, 0.3);
    expect(lectura.filas[1].cells).toEqual(["Resultado acumulado", FALTA, "+30,00", FALTA]);
    expect(lectura.nota).toContain("B termina en 130,00");
    expect(lectura.nota).toContain("De A falta el dato.");
  });

  test("con capital en las dos: su capital es un dato, y lo que saldría de él es lo que falta; no dice «Sin fijar»", () => {
    const lectura = lecturaDelCapital(250_000, 250_000, 0.4, null);
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))).toEqual([
      ["Capital inicial", "250.000,00 €", "250.000,00 €", FALTA],
      ["Resultado acumulado", "100.000,00 €", FALTA, FALTA],
      ["Capital final", "350.000,00 €", FALTA, FALTA]
    ]);
    expect(sinEspaciosDuros(lectura.nota)).toContain("parte de 250.000,00 € y termina en 350.000,00 €");
    expect(lectura.nota).toContain("De B falta el dato");
    expect(plano(lectura)).not.toContain("Sin fijar");
    expect(lectura.nota).not.toContain("la única que lo tiene");
  });

  test("capital solo en la que no tiene cifra: en porcentajes, sin decir que nadie lo fijó", () => {
    const lectura = lecturaDelCapital(undefined, 250_000, 0.4, null);
    expect(lectura.nota).not.toContain("No se ha fijado un capital");
    expect(lectura.nota).toContain("La cartera con capital fijado no da cifras");
    expect(lectura.filas[2].cells).toEqual(["Valor final", "140,00", FALTA, FALTA]);
    expect(plano(lectura)).not.toMatch(/€/);
  });

  test("capital solo en la que sí la tiene: la otra sigue «Sin fijar», y no falta el capital sino la cifra", () => {
    const lectura = lecturaDelCapital(250_000, undefined, 0.4, null);
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))).toEqual([
      ["Capital inicial", "250.000,00 €", "Sin fijar", "No aplica"],
      ["Resultado acumulado", "100.000,00 €", "Sin fijar", "No aplica"],
      ["Capital final", "350.000,00 €", "Sin fijar", "No aplica"]
    ]);
  });

  test("sin cifra en ninguna, lo dice", () => {
    expect(lecturaDelCapital(undefined, undefined, null, null).nota).toContain("Falta el dato de las dos.");
  });
});

describe("lecturaDelCapital", () => {
  test("sin capital en ninguna: en porcentajes y base 100, sin un solo euro", () => {
    const lectura = lecturaDelCapital(undefined, undefined, 0.4035, 0.4113);
    expect(lectura.tituloDeLaTabla).toBe("Qué representa sobre una base de 100");
    expect(lectura.tituloDeLaHoja).toBe("Rentabilidad y evolución");
    expect(lectura.enEuros).toBe(false);
    expect(lectura.filas.map((fila) => fila.cells)).toEqual([
      ["Valor inicial", "100,00", "100,00", "0,00"],
      ["Resultado acumulado", "+40,35", "+41,13", "+0,78"],
      ["Valor final", "140,35", "141,13", "+0,78"]
    ]);
    expect(lectura.nota).toContain("No se ha fijado un capital: este documento va en porcentajes, sin importes.");
    expect(lectura.nota).toContain("A termina en 140,35 y B en 141,13");
    expect(plano(lectura)).not.toMatch(/€|100\.000|ilustrativo|Ejemplo/);
  });

  test("una pérdida en base 100 lleva el menos del sistema, y una diferencia nula no lleva signo", () => {
    const { filas } = lecturaDelCapital(undefined, undefined, -0.1, -0.1);
    expect(filas[1].cells).toEqual(["Resultado acumulado", "−10,00", "−10,00", "0,00"]);
    expect(filas[2].cells).toEqual(["Valor final", "90,00", "90,00", "0,00"]);
  });

  test("con el mismo capital: esos euros, sobre esa cifra y no sobre otra", () => {
    const lectura = lecturaDelCapital(250_000, 250_000, 0.4, 0.3);
    expect(sinEspaciosDuros(lectura.tituloDeLaTabla)).toBe("Qué representa sobre 250.000,00 €");
    expect(lectura.tituloDeLaHoja).toBe("Rentabilidad y valor del capital");
    /* CMP-5: con euros, el papel enseña la tabla siempre. 250.000 × 1,4 = 350.000 de A y 250.000 × 1,3 = 325.000 de B. */
    expect(lectura.enEuros).toBe(true);
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))).toEqual([
      ["Capital inicial", "250.000,00 €", "250.000,00 €", "0,00 €"],
      ["Resultado acumulado", "100.000,00 €", "75.000,00 €", "−25.000,00 €"],
      ["Capital final", "350.000,00 €", "325.000,00 €", "−25.000,00 €"]
    ]);
    const nota = sinEspaciosDuros(lectura.nota);
    expect(nota).toContain("Ejemplo sobre 250.000,00 € iniciales, el capital fijado en las dos carteras: A termina en 350.000,00 € y B en 325.000,00 €. Diferencia: −25.000,00 €.");
    /* Es el capital de hoy puesto al principio del periodo: no es lo que ha ganado nadie. */
    expect(nota).toContain("Es una simulación");
  });

  test("con capitales distintos: cada una el suyo, sin restar, y lo dice", () => {
    const lectura = lecturaDelCapital(250_000, 100_000, 0.4, 0.3);
    expect(lectura.tituloDeLaTabla).toBe("Qué representa sobre el capital de cada cartera");
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))).toEqual([
      ["Capital inicial", "250.000,00 €", "100.000,00 €", "No aplica"],
      ["Resultado acumulado", "100.000,00 €", "30.000,00 €", "No aplica"],
      ["Capital final", "350.000,00 €", "130.000,00 €", "No aplica"]
    ]);
    const nota = sinEspaciosDuros(lectura.nota);
    expect(nota).toContain("A parte de 250.000,00 € y termina en 350.000,00 €; B parte de 100.000,00 € y termina en 130.000,00 €.");
    expect(nota).toContain("No se restan, porque parten de capitales distintos.");
  });

  test("con capital solo en A: la otra no toma prestado, y lo dice", () => {
    const lectura = lecturaDelCapital(250_000, undefined, 0.4, 0.3);
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))).toEqual([
      ["Capital inicial", "250.000,00 €", "Sin fijar", "No aplica"],
      ["Resultado acumulado", "100.000,00 €", "Sin fijar", "No aplica"],
      ["Capital final", "350.000,00 €", "Sin fijar", "No aplica"]
    ]);
    const nota = sinEspaciosDuros(lectura.nota);
    expect(nota).toContain("Ejemplo con el capital fijado en A, la única que lo tiene: parte de 250.000,00 € y termina en 350.000,00 €.");
    expect(nota).toContain("B no lo tiene y no toma prestado el de A: va en porcentajes.");
    expect(nota).not.toContain("325.000");
  });

  test("con capital solo en B: al revés, y ninguna cifra sale de otro capital", () => {
    const lectura = lecturaDelCapital(0, 100_000, 0.4, 0.3);
    expect(lectura.filas.map((fila) => fila.cells.map(sinEspaciosDuros))[2]).toEqual(["Capital final", "Sin fijar", "130.000,00 €", "No aplica"]);
    const nota = sinEspaciosDuros(lectura.nota);
    expect(nota).toContain("en B, la única que lo tiene: parte de 100.000,00 € y termina en 130.000,00 €.");
    expect(nota).toContain("A no lo tiene y no toma prestado el de B");
    expect(plano(lectura)).not.toContain("140.000");
  });
});

describe("la nota de los euros dice de qué parte son (decisión 80)", () => {
  test("A mide el 88,0 %: sus euros son de esa parte, llevada al 100 %", () => {
    const { nota } = lecturaDelCapital(250_000, 250_000, 0.4035, 0.3, { a: 88, b: 100 });
    expect(sinEspaciosDuros(nota)).toContain("A mide el 88,0 % de su peso: sus euros son de esa parte, llevada al 100 %.");
    expect(sinEspaciosDuros(nota)).not.toContain("B mide");
  });

  test("las dos, cada una con lo suyo", () => {
    const { nota } = lecturaDelCapital(250_000, 250_000, 0.4035, 0.3, { a: 88, b: 90 });
    expect(sinEspaciosDuros(nota)).toContain("A mide el 88,0 %");
    expect(sinEspaciosDuros(nota)).toContain("B mide el 90,0 %");
  });

  test("al 100 %, sin base 100 o de la que falta el dato, no se añade: lo primero no hace falta, y lo demás no es de euros", () => {
    expect(lecturaDelCapital(250_000, 250_000, 0.4035, 0.3, { a: 100, b: 100 }).nota).not.toContain("mide el");
    expect(lecturaDelCapital(undefined, undefined, 0.4035, 0.3, { a: 88, b: 100 }).nota).not.toContain("mide el");
    const conFalta = lecturaDelCapital(250_000, 250_000, 0.4035, null, { a: 88, b: 40 });
    expect(conFalta.nota).toContain("De B falta el dato");
    expect(sinEspaciosDuros(conFalta.nota)).toContain("A mide el 88,0 %");
    expect(sinEspaciosDuros(conFalta.nota)).not.toContain("B mide");
  });
});
