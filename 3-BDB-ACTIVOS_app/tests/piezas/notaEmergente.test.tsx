// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NotaEmergente } from "../../src/components/ui/NotaEmergente";
import { pintar, pulsar, teclear } from "./pintar";

/**
 * La pieza NotaEmergente: un botón con nombre que abre y cierra una nota que se anuncia; Escape la cierra y deja el
 * foco en el botón, y pulsar fuera o salir con el foco también la cierran (en una tableta no hay «quitar el ratón»).
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

function pintarNota() {
  const vista = pintar(
    <>
      <NotaEmergente termino="el SRI">El indicador de riesgo, de 1 a 7.</NotaEmergente>
      <button type="button">Otro control</button>
    </>
  );
  quitar = vista.quitar;
  const boton = vista.host.querySelector<HTMLButtonElement>(".nota-emergente__boton")!;
  const nota = vista.host.querySelector(".nota-emergente__nota")!;
  return { vista, boton, nota };
}

describe("la pieza NotaEmergente", () => {
  test("es un botón de verdad, con nombre, que dice si está abierta y qué controla", () => {
    const { boton, nota } = pintarNota();
    /* Un <button> se abre con Intro y con Espacio sin que la pieza haga nada: lo hace el navegador. */
    expect(boton.tagName).toBe("BUTTON");
    expect(boton.type).toBe("button");
    expect(boton.getAttribute("aria-label")).toBe("Qué es el SRI");
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(boton.getAttribute("aria-controls")).toBe(nota.id);
  });

  test("la nota se anuncia: es una región de estado que existe cerrada y se llena al abrir", () => {
    const { boton, nota } = pintarNota();
    expect(nota.getAttribute("role")).toBe("status");
    expect(nota.textContent).toBe("");
    pulsar(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    expect(nota.textContent).toBe("El indicador de riesgo, de 1 a 7.");
    pulsar(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(nota.textContent).toBe("");
  });

  test("Escape la cierra, deja el foco en el botón y no sube al diálogo que la contenga", () => {
    const { boton, nota } = pintarNota();
    /* El diálogo escucha Escape en el documento (`useAccessibleDialog`). */
    const delDialogo = vi.fn();
    document.addEventListener("keydown", delDialogo);
    act(() => boton.focus());
    pulsar(boton);
    teclear(boton, "Escape");
    expect(nota.textContent).toBe("");
    expect(document.activeElement).toBe(boton);
    expect(delDialogo).not.toHaveBeenCalled();
    /* Cerrada, Escape no es suyo: sigue su camino. */
    teclear(boton, "Escape");
    expect(delDialogo).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", delDialogo);
  });

  test("pulsar fuera la cierra, como en una tableta", () => {
    const { boton, nota } = pintarNota();
    pulsar(boton);
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(nota.textContent).toBe("");
  });

  test("salir con el foco la cierra", () => {
    const { vista, boton, nota } = pintarNota();
    act(() => boton.focus());
    pulsar(boton);
    act(() => vista.host.querySelectorAll("button")[1].focus());
    expect(nota.textContent).toBe("");
    expect(boton.getAttribute("aria-expanded")).toBe("false");
  });

  test("en la mitad derecha de la ventana, la nota crece hacia la izquierda para no salirse", () => {
    const { boton, nota } = pintarNota();
    pulsar(boton);
    expect(nota.className).toBe("nota-emergente__nota");
    pulsar(boton);
    boton.getBoundingClientRect = () => ({ left: window.innerWidth - 40, right: window.innerWidth - 16, top: 0, bottom: 24, width: 24, height: 24, x: window.innerWidth - 40, y: 0, toJSON: () => ({}) });
    pulsar(boton);
    expect(nota.className).toBe("nota-emergente__nota nota-emergente__nota--izquierda");
  });

  test("un nombre propio, si «Qué es …» no encaja", () => {
    const vista = pintar(
      <NotaEmergente nombre="Cómo se calcula la rentabilidad" termino="rentabilidad">
        Anualizada sobre tres años.
      </NotaEmergente>
    );
    quitar = vista.quitar;
    expect(vista.host.querySelector("button")!.getAttribute("aria-label")).toBe("Cómo se calcula la rentabilidad");
  });
});
