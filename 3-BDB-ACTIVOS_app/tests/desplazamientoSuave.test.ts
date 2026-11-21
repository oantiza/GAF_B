import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * MAR-29 (auditoría del 13-11-2026). Las hojas ya quitan el desplazamiento suave a quien ha pedido «reducir
 * movimiento», pero un `scrollIntoView({ behavior: "smooth" })` pedido desde código no pasa por las hojas: tiene
 * que mirarlo él. Esta prueba lee el código y falla si aparece un desplazamiento suave que no lo mira.
 */
const RAIZ = join(__dirname, "..", "src");

function ficheros(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return ficheros(ruta);
    return /\.(ts|tsx)$/.test(entrada.name) ? [ruta] : [];
  });
}

describe("desplazamiento suave desde código", () => {
  test("todo desplazamiento suave mira antes si se ha pedido reducir el movimiento", () => {
    const sinMirar: string[] = [];
    for (const ruta of ficheros(RAIZ)) {
      const lineas = readFileSync(ruta, "utf8").split("\n");
      lineas.forEach((linea, indice) => {
        if (!/behavior:\s*["']smooth["']\s*[,}]/.test(linea)) return;
        const contexto = lineas.slice(Math.max(0, indice - 4), indice + 1).join("\n");
        if (!contexto.includes("prefers-reduced-motion")) sinMirar.push(`${ruta.slice(RAIZ.length + 1)}:${indice + 1}`);
      });
    }
    expect(sinMirar).toEqual([]);
  });
});
