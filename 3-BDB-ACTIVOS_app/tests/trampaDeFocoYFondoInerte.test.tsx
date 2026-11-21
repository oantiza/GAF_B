// @vitest-environment happy-dom

/**
 * MAR-03. Un clic en un párrafo del diálogo le da el foco al propio contenedor (`tabIndex={-1}`), y desde ahí
 * Mayús+Tab no lo atrapaba: el foco saltaba al último control de la página, detrás del velo. Y lo de detrás no
 * quedaba inerte, así que un lector en modo lectura podía recorrer el fondo.
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DialogHeader, ModalDialog } from "../src/components/ui/ModalDialog";

let root: Root;
let host: HTMLDivElement;
let abiertos: { abajo: (valor: boolean) => void; arriba: (valor: boolean) => void };

function Dialogo({ id, onClose }: { id: string; onClose: () => void }) {
  return createElement(
    ModalDialog,
    { labelledBy: id, onClose },
    createElement(DialogHeader, { title: id, titleId: id }),
    createElement("p", null, "Cambio mediante enlace seguro"),
    createElement("button", { type: "button" }, `Primero de ${id}`),
    createElement("button", { type: "button" }, `Último de ${id}`)
  );
}

function Banco() {
  const [abajo, setAbajo] = useState(false);
  const [arriba, setArriba] = useState(false);
  useEffect(() => {
    abiertos = { abajo: setAbajo, arriba: setArriba };
  }, []);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", id: "de-la-pagina" }, "Control de la página"),
    abajo ? createElement(Dialogo, { id: "abajo", onClose: () => setAbajo(false) }) : null,
    arriba ? createElement(Dialogo, { id: "arriba", onClose: () => setArriba(false) }) : null
  );
}

const contenedor = (id: string) => document.getElementById(id)!.closest<HTMLElement>("[role='dialog']")!;
const boton = (texto: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === texto) as HTMLButtonElement;

function tabulador(shiftKey: boolean) {
  const evento = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(evento);
  return evento;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("la trampa de foco cubre el propio contenedor", () => {
  test("con el foco en el contenedor, Mayús+Tab va al último control del diálogo", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.abajo(true));
    contenedor("abajo").focus();
    expect(document.activeElement).toBe(contenedor("abajo"));

    const evento = tabulador(true);
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(boton("Último de abajo"));
  });

  test("con el foco en el contenedor, Tab va al primer control del diálogo", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.abajo(true));
    contenedor("abajo").focus();

    const evento = tabulador(false);
    expect(evento.defaultPrevented).toBe(true);
    // El primer control es la «X» de cerrar de la cabecera… si la hubiera; aquí la cabecera no lleva onClose.
    expect(document.activeElement).toBe(boton("Primero de abajo"));
  });

  test("si el foco se ha ido fuera del diálogo, el tabulador lo devuelve dentro", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.abajo(true));
    boton("Control de la página").focus();

    const evento = tabulador(true);
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(boton("Último de abajo"));
  });
});

describe("lo de detrás del diálogo queda inerte", () => {
  test("la página se marca inerte al abrir y se restaura al cerrar", async () => {
    await act(async () => root.render(createElement(Banco)));
    expect(host.hasAttribute("inert")).toBe(false);

    await act(async () => abiertos.abajo(true));
    expect(host.hasAttribute("inert")).toBe(true);
    expect(contenedor("abajo").closest("[inert]")).toBeNull();

    await act(async () => abiertos.abajo(false));
    expect(host.hasAttribute("inert")).toBe(false);
  });

  test("con dos apilados solo el de arriba está activo, y al cerrarlo vuelve el de abajo", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.abajo(true));
    await act(async () => abiertos.arriba(true));
    expect(host.hasAttribute("inert")).toBe(true);
    expect(contenedor("abajo").closest("[inert]")).not.toBeNull();
    expect(contenedor("arriba").closest("[inert]")).toBeNull();

    await act(async () => abiertos.arriba(false));
    expect(contenedor("abajo").closest("[inert]")).toBeNull();
    expect(host.hasAttribute("inert")).toBe(true);

    await act(async () => abiertos.abajo(false));
    expect(document.querySelectorAll("[inert]").length).toBe(0);
  });

  test("un `inert` que ya estuviera puesto fuera del diálogo no se quita al cerrar", async () => {
    const ajeno = document.createElement("div");
    ajeno.setAttribute("inert", "");
    document.body.append(ajeno);
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.abajo(true));
    await act(async () => abiertos.abajo(false));
    expect(ajeno.hasAttribute("inert")).toBe(true);
    ajeno.remove();
  });
});
