// @vitest-environment happy-dom

/**
 * MAR-16. `MenuButton`: con el menú abierto, Tab sacaba el foco y dejaba la lista abierta; Inicio y Fin no hacían
 * nada; la flecha abajo sobre el disparador no abría; y el Escape se escuchaba en el documento, así que dentro de un
 * diálogo se cerrarían a la vez el menú y el diálogo.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MenuButton } from "../src/components/ui/MenuButton";

let root: Root;
let host: HTMLDivElement;

const acciones = [
  { id: "a", label: "Duplicar", onSelect: vi.fn() },
  { id: "b", label: "Exportar", onSelect: vi.fn() },
  { id: "c", label: "Eliminar", onSelect: vi.fn(), danger: true }
];

const disparador = () => host.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
const elemento = (texto: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("[role='menuitem']")).find((b) => b.textContent === texto)!;
const abierto = () => host.querySelector("[role='menu']") !== null;

async function tecla(destino: HTMLElement, key: string) {
  const evento = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    destino.dispatchEvent(evento);
  });
  return evento;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(MenuButton, { label: "Más", actions: acciones }),
        createElement("button", { type: "button", id: "despues" }, "Siguiente control")
      )
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("MenuButton con el teclado", () => {
  test("la flecha abajo sobre el disparador abre el menú en la primera acción; la de arriba, en la última", async () => {
    disparador().focus();
    const abajo = await tecla(disparador(), "ArrowDown");
    expect(abajo.defaultPrevented).toBe(true);
    expect(abierto()).toBe(true);
    expect(document.activeElement).toBe(elemento("Duplicar"));

    await tecla(elemento("Duplicar"), "Escape");
    expect(abierto()).toBe(false);
    await tecla(disparador(), "ArrowUp");
    expect(abierto()).toBe(true);
    expect(document.activeElement).toBe(elemento("Eliminar"));
  });

  test("Inicio y Fin van a la primera y a la última acción", async () => {
    await act(async () => disparador().click());
    expect(document.activeElement).toBe(elemento("Duplicar"));
    await tecla(elemento("Duplicar"), "End");
    expect(document.activeElement).toBe(elemento("Eliminar"));
    await tecla(elemento("Eliminar"), "Home");
    expect(document.activeElement).toBe(elemento("Duplicar"));
  });

  test("si el foco sale del menú (Tab), el menú se cierra", async () => {
    await act(async () => disparador().click());
    expect(abierto()).toBe(true);
    const despues = host.querySelector<HTMLButtonElement>("#despues")!;
    await act(async () => {
      elemento("Duplicar").dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: despues }));
    });
    expect(abierto()).toBe(false);
  });

  test("Escape lo maneja el propio menú y no llega al documento", async () => {
    const enElDocumento = vi.fn();
    document.addEventListener("keydown", enElDocumento);
    try {
      await act(async () => disparador().click());
      // Un Escape pulsado en otra parte de la página no es del menú.
      await tecla(document.body, "Escape");
      expect(abierto()).toBe(true);
      enElDocumento.mockClear();

      await tecla(elemento("Exportar"), "Escape");
      expect(abierto()).toBe(false);
      expect(document.activeElement).toBe(disparador());
      expect(enElDocumento).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", enElDocumento);
    }
  });
});

describe("MenuButton: su nombre accesible", () => {
  test("sin nombre propio, lo nombra su rótulo: no lleva `aria-label`", () => {
    expect(disparador().getAttribute("aria-label")).toBeNull();
    expect(disparador().textContent).toBe("Más");
  });

  test("con nombre propio, el botón y su menú lo llevan, y empieza por el rótulo que se ve", async () => {
    /* En una tabla, «Más» se repite en cada fila: un lector de pantalla lo anunciaba igual en todas. */
    await act(async () =>
      root.render(createElement(MenuButton, { label: "Más", nombre: "Más acciones de Familia García", actions: acciones }))
    );
    expect(disparador().getAttribute("aria-label")).toBe("Más acciones de Familia García");
    expect(disparador().getAttribute("aria-label")!.startsWith(disparador().textContent!)).toBe(true);
    await act(async () => disparador().click());
    expect(host.querySelector("[role='menu']")?.getAttribute("aria-label")).toBe("Más acciones de Familia García");
  });

  test("por defecto se abre hacia abajo; con dirección «arriba», hacia arriba", async () => {
    /* Un menú pegado al borde inferior: abierto hacia abajo, su lista cae fuera de la ventana y el botón parece no hacer
       nada (pasó el 14-11-2026 con el selector de diseño, ya retirado). */
    await act(async () => disparador().click());
    expect(host.querySelector("[role='menu']")?.classList.contains("ui-menu__list--arriba")).toBe(false);
    await act(async () => root.render(createElement(MenuButton, { label: "Más", actions: acciones, direccion: "arriba" })));
    await act(async () => disparador().click());
    expect(host.querySelector("[role='menu']")?.classList.contains("ui-menu__list--arriba")).toBe(true);
  });
});
