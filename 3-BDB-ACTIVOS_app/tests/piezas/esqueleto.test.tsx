import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Esqueleto } from "../../src/components/ui/Esqueleto";

/**
 * La pieza Esqueleto: dibuja el hueco de lo que carga, no dice nada al lector de pantalla (el anuncio es de quien la
 * usa) y se queda quieta si se ha pedido reducir el movimiento.
 */
describe("la pieza Esqueleto", () => {
  test("tres líneas por defecto, ocultas al lector de pantalla", () => {
    expect(renderToStaticMarkup(<Esqueleto />)).toBe(
      '<div aria-hidden="true" class="esqueleto"><span class="esqueleto__linea"></span><span class="esqueleto__linea"></span><span class="esqueleto__linea"></span></div>'
    );
  });

  test("las líneas que se pidan", () => {
    expect(renderToStaticMarkup(<Esqueleto lineas={5} />).match(/esqueleto__linea/g)).toHaveLength(5);
  });

  test("un bloque del alto pedido", () => {
    expect(renderToStaticMarkup(<Esqueleto alto={280} />)).toBe('<div aria-hidden="true" class="esqueleto esqueleto__bloque" style="height:280px"></div>');
  });

  test("su brillo se para con «reducir movimiento»", () => {
    const hoja = readFileSync(new UrlDeNode("../../src/styles/components.css", import.meta.url), "utf8");
    expect(hoja).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.esqueleto__linea,\s*\.esqueleto__bloque \{\s*animation: none;/);
  });
});
