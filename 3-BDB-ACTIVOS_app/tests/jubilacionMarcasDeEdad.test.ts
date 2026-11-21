import { describe, expect, test } from "vitest";
import { marcasDeEdad } from "../src/components/jubilacion/marcasDeEdad";

/**
 * Las marcas del eje de edades de los dos gráficos de Jubilación: los múltiplos de 5 dentro del tramo; la primera edad
 * entra si queda a 2 años o más de la primera marca, y la última, si queda a 2 o más de la última. Cada lista esperada
 * sale de esa regla contada a mano, no de ejecutar la función.
 */
const edades = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);

describe("las marcas del eje de edades", () => {
  test.each([
    /* 65 es múltiplo de 5; 94 − 90 = 4, entra. */
    [65, 94, [65, 70, 75, 80, 85, 90, 94]],
    /* Las dos puntas son múltiplos. */
    [65, 95, [65, 70, 75, 80, 85, 90, 95]],
    /* 70 − 67 = 3, la primera entra; 90 es múltiplo. */
    [67, 90, [67, 70, 75, 80, 85, 90]],
    /* 65 − 64 = 1: la primera no entra. */
    [64, 95, [65, 70, 75, 80, 85, 90, 95]],
    /* 70 − 68 = 2: entra; 91 − 90 = 1: la última no. */
    [68, 91, [68, 70, 75, 80, 85, 90]],
    /* 70 − 66 = 4 y 93 − 90 = 3: entran las dos. */
    [66, 93, [66, 70, 75, 80, 85, 90, 93]],
    /* Sin ningún múltiplo de 5 en el tramo: la primera y la última. */
    [71, 73, [71, 73]]
  ])("edades de %i a %i", (desde, hasta, esperadas) => {
    expect(marcasDeEdad(edades(desde, hasta))).toEqual(esperadas);
  });

  test("una sola edad es su propia marca, y sin edades no hay marcas", () => {
    expect(marcasDeEdad([70])).toEqual([70]);
    expect(marcasDeEdad([])).toEqual([]);
  });

  test("ninguna marca se repite y van en orden", () => {
    for (const [desde, hasta] of [[65, 94], [64, 95], [68, 91], [71, 73], [70, 70]]) {
      const marcas = marcasDeEdad(edades(desde, hasta));
      expect(new Set(marcas).size).toBe(marcas.length);
      expect([...marcas].sort((a, b) => a - b)).toEqual(marcas);
    }
  });
});
