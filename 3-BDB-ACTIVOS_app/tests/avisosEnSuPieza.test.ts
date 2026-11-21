import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * MAR-21: un aviso lo pinta la pieza `Aviso` (`src/components/ui/Aviso.tsx`), con su tono. Ninguna pantalla lo escribe a
 * mano con las clases viejas (`notice`, `notice--warn`, `notice__body`…).
 */
const SRC = join(__dirname, "..", "src");

function ficheros(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return ficheros(ruta);
    return entrada.name.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("los avisos, en su pieza", () => {
  test("ningún componente escribe a mano un aviso con className=\"notice…\"", () => {
    const amano = ficheros(SRC).flatMap((ruta) =>
      readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .map((linea, indice) => ({ linea, indice }))
        .filter(({ linea }) => /className=("|\{.)notice/.test(linea))
        .map(({ indice }) => `${relative(SRC, ruta)}:${indice + 1}`)
    );
    expect(amano).toEqual([]);
  });

  test("las partes de un aviso a mano (cuerpo, título, acciones) ya no las usa nadie", () => {
    const partes = ficheros(SRC).filter((ruta) => /notice__(body|title|actions)|notice--ok/.test(readFileSync(ruta, "utf8")));
    expect(partes.map((ruta) => relative(SRC, ruta))).toEqual([]);
  });
});
