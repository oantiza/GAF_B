import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Distintivo } from "../../src/components/ui/Distintivo";

/** La pieza Distintivo: una etiqueta corta con su palabra; el tono solo la refuerza. */
describe("la pieza Distintivo", () => {
  test("neutro por defecto", () => {
    expect(renderToStaticMarkup(<Distintivo>Acumulación</Distintivo>)).toBe('<span class="distintivo distintivo--neutro">Acumulación</span>');
  });

  test.each([
    ["marca", "Se puede proponer"],
    ["interno", "Interno"],
    ["aviso", "Datos parciales"]
  ] as const)("el tono %s pinta su clase y conserva la palabra", (tono, texto) => {
    expect(renderToStaticMarkup(<Distintivo tono={tono}>{texto}</Distintivo>)).toBe(
      `<span class="distintivo distintivo--${tono}">${texto}</span>`
    );
  });
});
