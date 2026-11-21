import { describe, expect, test } from "vitest";
import { aPartesIguales } from "../src/core/repartoDePesos";

/**
 * El reparto de pesos.
 *
 * El caso que lo motiva es el más simple: tres posiciones a partes iguales son 33,33 %
 * cada una y suman 99,99 %. La tolerancia del proyecto lo da por cuadrado y hace bien,
 * pero un reparto que el asesor pide explícitamente debe cuadrar de verdad: el céntimo
 * que falta existe y tiene que estar en algún sitio.
 */

const suma = (pesos: number[]) => Number(pesos.reduce((t, p) => t + p, 0).toFixed(10));

describe("a partes iguales", () => {
  test("tres posiciones suman 100 exacto, no 99,99", () => {
    const pesos = aPartesIguales(3);
    expect(pesos).toEqual([33.33, 33.33, 33.34]);
    expect(suma(pesos)).toBe(100);
  });

  test("cuadra exacto para cualquier número de posiciones, no dentro de tolerancia", () => {
    for (let cuantas = 1; cuantas <= 40; cuantas += 1) {
      expect(suma(aPartesIguales(cuantas)), `${cuantas} posiciones`).toBe(100);
    }
  });

  test("siete posiciones: el resto va a la última y se ve", () => {
    const pesos = aPartesIguales(7);
    expect(pesos.slice(0, 6).every((peso) => peso === 14.29)).toBe(true);
    expect(pesos[6]).toBeCloseTo(14.26, 10);
    expect(suma(pesos)).toBe(100);
  });

  test("sin posiciones no hay reparto", () => {
    expect(aPartesIguales(0)).toEqual([]);
  });
});
