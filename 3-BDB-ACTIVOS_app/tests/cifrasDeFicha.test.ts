/**
 * Las cifras de la ficha de un activo que llevan divisa: el precio y el patrimonio.
 *
 * Tres cosas que se fijaron al pasar la ficha al formato único (14-11-2026):
 * - el código de la divisa se escribe como llega: «GBp» son peniques, y en mayúsculas diría un precio cien veces mayor;
 * - sin divisa no se inventa el euro;
 * - el patrimonio y la capitalización van siempre en millones, también por encima del billón: la «B» que se usaba se
 *   confunde con el *billion* inglés, que son mil millones (FMT-07).
 */
import { describe, expect, test } from "vitest";
import { importeGrande, precio, precioConDivisa } from "../src/core/cifrasDeFicha";

describe("el precio de la ficha", () => {
  test("con su divisa detrás y espacio duro; el euro, con su símbolo", () => {
    expect(precioConDivisa(535.02, "EUR")).toBe("535,02 €");
    expect(precioConDivisa(3.556, "USD")).toBe("3,556 USD");
  });

  test("los peniques no se convierten en libras", () => {
    expect(precioConDivisa(4250.5, "GBp")).toBe("4.250,50 GBp");
    expect(precioConDivisa(4250.5, "GBX")).toBe("4.250,50 GBX");
  });

  test("sin divisa, la cifra sola: no se inventa el euro", () => {
    expect(precioConDivisa(99.55, undefined)).toBe("99,55");
    expect(precioConDivisa(99.55, "  ")).toBe("99,55");
    expect(precio(99.55)).toBe("99,55");
  });
});

describe("el patrimonio de la ficha", () => {
  test("en millones, con un decimal", () => {
    expect(importeGrande(1_007_800_000, "EUR")).toBe("1.007,8 M€");
    expect(importeGrande(14_500_000, "USD")).toBe("14,5 M USD");
  });

  test("también por encima del billón: sin «B»", () => {
    /* A mano: 3,5 billones son 3.500.000 millones. */
    expect(importeGrande(3_500_000_000_000, "USD")).toBe("3.500.000,0 M USD");
    expect(importeGrande(1_200_000_000_000, "EUR")).toBe("1.200.000,0 M€");
  });

  test("lee la cifra aunque llegue como texto, y lo que no es una cifra dice que falta", () => {
    expect(importeGrande("2304300000", "EUR")).toBe("2.304,3 M€");
    expect(importeGrande(null, "EUR")).toBe("Falta el dato");
    expect(importeGrande("", "EUR")).toBe("Falta el dato");
  });

  test("sin divisa, sin unidad de divisa", () => {
    expect(importeGrande(14_500_000, undefined)).toBe("14,5 M");
  });
});
