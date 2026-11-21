import { describe, expect, test } from "vitest";
import { cifraLeida, leerCifraTecleada } from "../src/core/cifraTecleada";
import { parseEuropeanNumber } from "../src/core/numberFormat";
import { leerCifra } from "../src/gestor/motor/decimal";

/**
 * FMT-20: una sola regla para la cifra que teclea una persona. El lector de la pantalla acepta y rechaza exactamente lo
 * mismo que `leerCifra`, el del Gestor de carteras; el de los ficheros del banco (`parseEuropeanNumber`) es otro, más
 * permisivo, y sus diferencias quedan escritas aquí.
 */

/** Entrada → lo que se lee (`undefined`: no es una cifra). Escrita a mano, no copiada de la salida. */
const TABLA: Array<[string, number | undefined]> = [
  ["12,5", 12.5],
  ["0,5", 0.5],
  ["1.234,56", 1234.56],
  ["1234,56", 1234.56],
  ["1.234", 1234],
  ["12.500", 12500],
  ["1.234.567", 1234567],
  ["1,234.56", 1234.56],
  ["1234.5678", 1234.5678],
  ["12.5", 12.5],
  ["0.125", 0.125],
  ["0.500", 0.5],
  ["1,234", 1.234],
  ["-12,5", -12.5],
  ["−12,5", -12.5],
  ["+5", 5],
  ["12 %", 12],
  ["25.000 €", 25000],
  ["1\u00a0234,5", 1234.5],
  [",5", 0.5],
  ["100", 100],
  ["", undefined],
  ["   ", undefined],
  ["1,234,567", undefined],
  ["1.500 EUR", undefined],
  ["5 eur", undefined],
  ["£5", undefined],
  ["1'234", undefined],
  ["+-5", undefined],
  ["25k", undefined],
  ["abc", undefined],
  ["1.234.5", undefined],
  ["1,2,3", undefined],
  ["(5)", undefined],
  ["1e3", undefined],
  ["--5", undefined],
  ["5-", undefined]
];

describe("el lector de la cifra tecleada", () => {
  test.each(TABLA)("«%s» se lee %s", (entrada, esperado) => {
    expect(leerCifraTecleada(entrada)).toBe(esperado);
  });

  test.each(TABLA)("«%s»: acepta y rechaza lo mismo que leerCifra, y lee la misma cifra", (entrada) => {
    const delMotor = leerCifra(entrada);
    expect(leerCifraTecleada(entrada)).toBe(delMotor === undefined ? undefined : Number(delMotor.toString()));
  });
});

describe("en qué difiere el lector de los ficheros del banco (parseEuropeanNumber, que no cambia)", () => {
  /** Entrada → [lo que lee el de teclear, lo que lee el de los ficheros]. */
  const DIFIEREN: Array<[string, number | undefined, number]> = [
    ["1,234,567", undefined, 1234567],
    ["1.500 EUR", undefined, 1500],
    ["5 eur", undefined, 5],
    ["£5", undefined, 5],
    ["1'234", undefined, 1234],
    ["+-5", undefined, -5]
  ];
  test.each(DIFIEREN)("«%s»: al teclear %s; en un fichero, %s", (entrada, tecleada, deFichero) => {
    expect(leerCifraTecleada(entrada)).toBe(tecleada);
    expect(parseEuropeanNumber(entrada)).toBe(deFichero);
  });

  test("en el resto de la tabla los dos leen lo mismo, o los dos la rechazan", () => {
    const distintas = new Set(DIFIEREN.map(([entrada]) => entrada));
    for (const [entrada, esperado] of TABLA) {
      if (distintas.has(entrada)) continue;
      const deFichero = parseEuropeanNumber(entrada);
      expect([entrada, Number.isNaN(deFichero) ? undefined : deFichero]).toEqual([entrada, esperado]);
    }
  });
});

describe("cómo se ha leído, en español", () => {
  test("punto de millar, coma decimal, sin ceros de relleno y con el menos tipográfico", () => {
    expect(cifraLeida(1234.5)).toBe("1.234,5");
    expect(cifraLeida(12500)).toBe("12.500");
    expect(cifraLeida(0.125)).toBe("0,125");
    expect(cifraLeida(5)).toBe("5");
    expect(cifraLeida(-3)).toBe("−3");
  });
});
