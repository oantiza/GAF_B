import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Dos reglas de hoja que no se ven en una prueba de componente.
 *
 * MAR-08: al deslizador de rango se le quita el anillo y se le pone al pulgar, pero solo con el seudoelemento de
 * WebKit: en Firefox se quedaba sin ningún indicador de foco.
 *
 * MAR-27: con Ctrl+P se ocultaba `.ui-button`, pero no los `<button>` nativos ni un diálogo abierto, que vive en un
 * portal fuera de `.app-shell` y por tanto fuera de todas las reglas de la hoja de impresión.
 */

const leer = (ruta: string) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), "utf8");
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** El cuerpo de la primera regla cuyo selector (entero, normalizado) es `selector`. */
function cuerpoDe(css: string, selector: string): string | null {
  const normal = (texto: string) => texto.replace(/\s+/g, " ").trim();
  for (const coincidencia of sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectores = coincidencia[1].split(",").map(normal);
    if (selectores.includes(normal(selector))) return coincidencia[2];
  }
  return null;
}

describe("MAR-08 · el foco del deslizador en Firefox", () => {
  test("el pulgar de Firefox lleva el anillo de foco, como el de WebKit", () => {
    const css = leer("styles/components.css");
    expect(cuerpoDe(css, 'input[type="range"]:focus-visible::-webkit-slider-thumb')).toContain("var(--focus-ring)");
    expect(cuerpoDe(css, 'input[type="range"]:focus-visible::-moz-range-thumb')).toContain("var(--focus-ring)");
  });
});

describe("MAR-27 · lo que no se imprime", () => {
  const impresion = leer("styles/impresion.css");

  const reglaDeBotones = /\.app-shell \.app-content button:not\(:where\(([^)]*)\)\)\s*\{([^}]*)\}/;

  test("los botones nativos de la pantalla no salen en papel", () => {
    expect(impresion.match(reglaDeBotones)?.[2]).toMatch(/display:\s*none/);
  });

  test("un diálogo abierto no sale en papel", () => {
    expect(cuerpoDe(impresion, ".ui-dialog-backdrop")).toMatch(/display:\s*none/);
  });

  test("lo que en pantalla es un enlace con un nombre sigue saliendo, y el título de una columna también", () => {
    // Con `:where` la regla pesa (0,2,1) y la del título de columna, (0,2,2): gana la de la columna.
    const regla = impresion.match(reglaDeBotones)?.[1] ?? "";
    expect(regla).toContain(".enlace-a-ficha");
    expect(regla).toContain(".gestor-enlace");
    expect(cuerpoDe(impresion, ".app-shell .app-content th button")).toMatch(/display:\s*contents/);
  });
});
