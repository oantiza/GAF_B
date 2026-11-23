// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { IBEX35_CODES } from "../src/core/ibex35";

/**
 * La lista del IBEX 35 vive escrita a mano en dos sitios que no se pueden importar el uno del otro, porque uno es
 * TypeScript y el otro Python: `src/core/ibex35.ts` (la agenda de Mercado) y `functions_python/spanish_calendar.py`
 * (el calendario de resultados y dividendos, que consulta a Yahoo valor a valor). Si el índice cambia y se actualiza
 * uno solo, la pantalla promete unos títulos y el calendario consulta otros, sin que nada falle.
 *
 * Una sola fuente de verdad cruzando los dos lenguajes habría exigido un fichero de datos que las Functions desplegadas
 * tuvieran que llevar consigo, y tocar código que corre en producción. Esta prueba es la salida de menor riesgo: no
 * toca ningún código de ejecución y falla el día que las dos listas difieran, nombrando qué sobra y qué falta.
 * Comprueba también que el diccionario de nombres del calendario cubre exactamente los mismos valores, porque un valor
 * sin nombre sale sin nombre en la pantalla.
 *
 * (El encargo situaba la lista en el extractor; está en las Functions, y el extractor no tiene ninguna copia.)
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const PYTHON = readFileSync(resolve(AQUI, "..", "functions_python", "spanish_calendar.py"), "utf-8");

function codigosDelBloque(patron: RegExp): string[] {
  const bloque = patron.exec(PYTHON)?.[1];
  if (bloque === undefined) throw new Error(`No se encontró el bloque ${patron} en spanish_calendar.py`);
  return [...bloque.matchAll(/"([A-Z0-9.]+\.MC)"/g)].map((coincidencia) => coincidencia[1] as string);
}

describe("la lista del IBEX 35 es la misma en TypeScript y en Python", () => {
  const python = codigosDelBloque(/^IBEX35 = \[([\s\S]*?)\]/m);
  const nombres = codigosDelBloque(/^NOMBRES_IBEX35 = \{([\s\S]*?)\}/m);

  test("hay valores en las dos y ninguno repetido", () => {
    expect(python.length).toBeGreaterThan(30);
    expect(new Set(python).size).toBe(python.length);
    expect(IBEX35_CODES.size).toBe(python.length);
  });

  test("los mismos códigos", () => {
    const sobranEnPython = python.filter((codigo) => !IBEX35_CODES.has(codigo)).sort();
    const faltanEnPython = [...IBEX35_CODES].filter((codigo) => !python.includes(codigo)).sort();
    expect({ sobranEnPython, faltanEnPython }).toEqual({ sobranEnPython: [], faltanEnPython: [] });
  });

  test("el diccionario de nombres del calendario cubre los mismos valores", () => {
    expect([...nombres].sort()).toEqual([...python].sort());
  });
});
