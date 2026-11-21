// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { ClaseConColor } from "../../src/components/ui/ClaseConColor";
import { Distintivo } from "../../src/components/ui/Distintivo";
import { pintar } from "./pintar";

/**
 * Las dos piezas del color de categoría y de sentido (14-11-2026): el punto de color de una clase de activo, y los
 * distintivos favorable y desfavorable.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

/* happy-dom devuelve el color como se escribió. */
const fondo = (host: HTMLElement) => host.querySelector<HTMLElement>(".clase-con-color__punto")?.style.background.toUpperCase();

describe("la pieza ClaseConColor", () => {
  test("el punto lleva el color de la clase, y va oculto al lector de pantalla: el nombre lo dice todo", () => {
    const vista = pintar(<ClaseConColor clave="EQUITY">Renta variable</ClaseConColor>);
    quitar = vista.quitar;
    expect(fondo(vista.host)).toBe("#2F5D8A");
    expect(vista.host.querySelector(".clase-con-color__punto")?.getAttribute("aria-hidden")).toBe("true");
    expect(vista.host.textContent).toBe("Renta variable");
  });

  test("cada clase, su color; lo que no es una clase con nombre, gris", () => {
    const vista = pintar(<ClaseConColor clave="FIXED_INCOME">Renta fija</ClaseConColor>);
    quitar = vista.quitar;
    expect(fondo(vista.host)).toBe("#4E7D6A");
    vista.repintar(<ClaseConColor clave="OTHER">Otros</ClaseConColor>);
    expect(fondo(vista.host)).toBe("#B3AC9E");
  });

  test("un color dado a mano (una zona del mapa) manda sobre la clave", () => {
    const vista = pintar(
      <ClaseConColor clave="EQUITY" color="#4E7D6A">
        Asia
      </ClaseConColor>
    );
    quitar = vista.quitar;
    expect(fondo(vista.host)).toBe("#4E7D6A");
  });
});

describe("Distintivo: a favor y en contra", () => {
  test("favorable y desfavorable tienen su clase, y la palabra sigue siendo la señal", () => {
    const vista = pintar(
      <>
        <Distintivo tono="favorable">Positiva</Distintivo>
        <Distintivo tono="desfavorable">Negativa</Distintivo>
      </>
    );
    quitar = vista.quitar;
    expect([...vista.host.querySelectorAll(".distintivo")].map((d) => [d.className, d.textContent])).toEqual([
      ["distintivo distintivo--favorable", "Positiva"],
      ["distintivo distintivo--desfavorable", "Negativa"]
    ]);
  });
});
