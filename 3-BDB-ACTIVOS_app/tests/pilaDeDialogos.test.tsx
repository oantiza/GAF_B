// @vitest-environment happy-dom

/**
 * Un diálogo sobre otro. Medido en la revisión: Importar cartera, y encima «La cartera tiene cambios sin guardar». Esc
 * cerraba los dos, `overflow` se quedaba en «hidden» y la página dejaba de desplazarse hasta recargar.
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
    createElement("button", { type: "button" }, `Botón de ${id}`)
  );
}

function Banco() {
  const [abajo, setAbajo] = useState(true);
  const [arriba, setArriba] = useState(false);
  useEffect(() => {
    abiertos = { abajo: setAbajo, arriba: setArriba };
  }, []);
  return createElement(
    "div",
    null,
    abajo ? createElement(Dialogo, { id: "abajo", onClose: () => setAbajo(false) }) : null,
    arriba ? createElement(Dialogo, { id: "arriba", onClose: () => setArriba(false) }) : null
  );
}

const hay = (id: string) => document.getElementById(id) !== null;
const escape = () => act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.style.overflow = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("un diálogo sobre otro", () => {
  test("Escape cierra solo el de arriba, y al cerrar el último la página vuelve a desplazarse", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.arriba(true));
    expect(hay("abajo") && hay("arriba")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await escape();
    expect(hay("arriba")).toBe(false);
    expect(hay("abajo")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await escape();
    expect(hay("abajo")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  test("si se cierran a la vez, el `overflow` no se queda en «hidden»", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.arriba(true));
    await act(async () => {
      abiertos.abajo(false);
      abiertos.arriba(false);
    });
    expect(document.body.style.overflow).toBe("");
  });

  test("cerrar el de abajo primero tampoco lo deja «hidden»", async () => {
    await act(async () => root.render(createElement(Banco)));
    await act(async () => abiertos.arriba(true));
    await act(async () => abiertos.abajo(false));
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => abiertos.arriba(false));
    expect(document.body.style.overflow).toBe("");
  });

  test("un `overflow` que ya hubiera se respeta", async () => {
    document.body.style.overflow = "clip";
    await act(async () => root.render(createElement(Banco)));
    expect(document.body.style.overflow).toBe("hidden");
    await escape();
    expect(document.body.style.overflow).toBe("clip");
  });
});
