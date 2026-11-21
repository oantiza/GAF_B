// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { Aviso } from "../../src/components/ui/Aviso";
import { Button } from "../../src/components/ui/Button";
import { pintar, pulsar } from "./pintar";

/**
 * La pieza Aviso: tres tonos con su significado fijo, la palabra siempre (nunca solo el color) y el anuncio solo
 * donde toca: el error siempre, los demás si se pide.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

describe("la pieza Aviso", () => {
  test.each([
    ["aviso", "aviso aviso--aviso"],
    ["nota", "aviso aviso--nota"],
    ["error", "aviso aviso--error"]
  ] as const)("el tono %s pinta su clase", (tono, clase) => {
    const vista = pintar(<Aviso titulo="Título." tono={tono}>Texto.</Aviso>);
    quitar = vista.quitar;
    expect(vista.host.firstElementChild!.className).toBe(clase);
  });

  test("el título es la entrada en negrita, seguida del texto", () => {
    const vista = pintar(<Aviso titulo="Una posición sin medir.">Vanguard queda fuera de la simulación.</Aviso>);
    quitar = vista.quitar;
    expect(vista.host.querySelector(".aviso__titulo")?.tagName).toBe("STRONG");
    expect(vista.host.querySelector(".aviso__texto")?.textContent).toBe("Una posición sin medir. Vanguard queda fuera de la simulación.");
  });

  test("sin título, el lector de pantalla oye el tono: el color no es la única señal", () => {
    const vista = pintar(<Aviso tono="nota">Cuatro clases de activo.</Aviso>);
    quitar = vista.quitar;
    expect(vista.host.querySelector(".sr-only")?.textContent).toBe("Nota. ");
    expect(vista.host.textContent).toBe("Nota. Cuatro clases de activo.");
  });

  test("el error se anuncia; el aviso y la nota, solo si se pide", () => {
    const error = pintar(<Aviso tono="error">Falló.</Aviso>);
    expect(error.host.firstElementChild!.getAttribute("role")).toBe("alert");
    error.quitar();

    const callado = pintar(<Aviso tono="aviso">Ojo.</Aviso>);
    expect(callado.host.firstElementChild!.hasAttribute("role")).toBe(false);
    callado.quitar();

    const anunciado = pintar(
      <Aviso anunciar tono="nota">
        Guardado en el disco.
      </Aviso>
    );
    expect(anunciado.host.firstElementChild!.getAttribute("role")).toBe("status");
    anunciado.quitar();
  });

  test("la acción va a la derecha y se puede pulsar", () => {
    const reintentar = vi.fn();
    const vista = pintar(
      <Aviso accion={<Button onClick={reintentar}>Reintentar</Button>} titulo="No se pudo cargar." tono="error">
        El servidor no responde.
      </Aviso>
    );
    quitar = vista.quitar;
    const boton = vista.host.querySelector(".aviso__accion button")!;
    expect(boton.textContent).toBe("Reintentar");
    pulsar(boton);
    expect(reintentar).toHaveBeenCalledTimes(1);
  });
});
