import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BENCHMARK_PROFILES } from "../src/core/benchmarkProfiles";
import { distanciaALaReferencia, referenciaMasCercana, RENTA_VARIABLE_POR_NIVEL } from "../src/core/referenciaPorNivel";

/** Decisión C-26: la referencia más cercana en renta variable al nivel de la cartera. */

describe("la tabla de renta variable por nivel", () => {
  test("es la del generador de carteras: si una cambia, la otra tiene que cambiar", () => {
    const fuente = readFileSync(new URL("../functions_python/generador_de_carteras.py", import.meta.url), "utf-8");
    const bloque = /RENTA_VARIABLE_POR_NIVEL\s*=\s*\{([^}]*)\}/.exec(fuente);
    expect(bloque, "no se encuentra RENTA_VARIABLE_POR_NIVEL en generador_de_carteras.py").not.toBeNull();
    const delGenerador: Record<number, number> = {};
    for (const [, nivel, valor] of bloque![1]!.matchAll(/(\d+)\s*:\s*(\d+(?:\.\d+)?)/g)) delGenerador[Number(nivel)] = Number(valor);
    expect(RENTA_VARIABLE_POR_NIVEL).toEqual(delGenerador);
    expect(Object.keys(delGenerador)).toHaveLength(10);
  });
});

describe("la referencia más cercana a cada nivel", () => {
  const ESPERADA: Record<number, string> = {
    1: "conservador",
    2: "conservador",
    3: "moderado",
    4: "moderado",
    5: "equilibrado",
    6: "equilibrado",
    7: "equilibrado",
    8: "dinamico",
    9: "dinamico",
    10: "agresivo"
  };

  test.each(Object.entries(ESPERADA))("nivel %s: %s", (nivel, id) => {
    expect(referenciaMasCercana(Number(nivel))?.id).toBe(id);
  });

  test("nunca a más de 10 puntos de renta variable", () => {
    for (let nivel = 1; nivel <= 10; nivel += 1) {
      expect(distanciaALaReferencia(nivel), `nivel ${nivel}`).toBeLessThanOrEqual(10);
    }
    expect(distanciaALaReferencia(6)).toBe(0);
    expect(distanciaALaReferencia(7)).toBe(10);
    expect(distanciaALaReferencia(3)).toBe(5);
  });

  test("sin nivel, o con uno que no vale, no hay propuesta", () => {
    for (const nivel of [undefined, null, 0, 11, 2.5, -1, Number.NaN, "5"]) {
      expect(referenciaMasCercana(nivel), String(nivel)).toBeUndefined();
      expect(distanciaALaReferencia(nivel), String(nivel)).toBeUndefined();
    }
  });

  test("se calcula con los pesos de las referencias: devuelve una de las publicadas", () => {
    for (let nivel = 1; nivel <= 10; nivel += 1) {
      expect(BENCHMARK_PROFILES).toContain(referenciaMasCercana(nivel));
    }
  });
});
