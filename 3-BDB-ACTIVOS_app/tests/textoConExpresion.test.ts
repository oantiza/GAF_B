import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Una expresión JSX dentro de una cadena no falla: se imprime.
 *
 * `titulo="… {periodo} …"` compila, pasa el typecheck, pasa el lint y pinta en
 * pantalla las llaves y el nombre de la variable. No hay error en ninguna capa;
 * solo lo ve quien mire la pantalla.
 *
 * Pasó el 03-11-2026, dos veces en el mismo día. La primera llegó a un commit y
 * estuvo publicada unas horas: el mapa riesgo-retorno de Análisis anunciaba
 * «volatilidad/retorno {period[0]}A». La segunda la cazó una prueba de
 * Retrocesiones que, por suerte, afirmaba sobre ese texto. Las dos salieron de
 * convertir cabeceras a la pieza `Panel`: el texto que vivía dentro de un `<p>`
 * —donde `{x}` ES una expresión— pasó a ser el valor de una propiedad —donde no
 * lo es—.
 *
 * Esta puerta cubre el caso entero, no solo las propiedades de `Panel`: cualquier
 * atributo de texto escrito con comillas que contenga `{` casi siempre es eso.
 * Si alguna vez hace falta una llave literal en un atributo, se escribe con
 * `{"{"}` o se declara aquí la excepción con su motivo.
 */
const RAIZ = fileURLToPath(new URL("../src", import.meta.url));

/** Atributos que llevan texto para leer, no identificadores ni expresiones. */
const ATRIBUTOS = [
  "titulo", "subtitulo", "rotulo", "estado",
  "label", "ariaLabel", "aria-label", "title", "placeholder", "helper", "description"
];

const PATRON = new RegExp(`\\b(${ATRIBUTOS.join("|")})="([^"]*\\{[^"]*)"`, "g");

function ficherosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return ficherosTsx(ruta);
    return ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("texto de interfaz con una expresión dentro", () => {
  test("ningún atributo de texto lleva llaves sin evaluar", () => {
    const hallazgos: string[] = [];
    for (const ruta of ficherosTsx(RAIZ)) {
      const lineas = readFileSync(ruta, "utf8").split("\n");
      lineas.forEach((linea, i) => {
        for (const encaje of linea.matchAll(PATRON)) {
          hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} · ${encaje[1]}="${encaje[2].slice(0, 70)}"`);
        }
      });
    }
    expect(hallazgos, `Atributos de texto que imprimirían las llaves:\n${hallazgos.join("\n")}`).toEqual([]);
  });
});
