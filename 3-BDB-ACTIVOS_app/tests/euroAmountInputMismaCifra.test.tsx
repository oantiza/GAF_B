// @vitest-environment happy-dom

/**
 * Hallazgos 48 y 13: un capital de exactamente 100.000 € no se podía fijar. El campo veía que la cifra
 * no había cambiado y no avisaba. Pero la solución tiene una trampa: el campo confirma al salir con el
 * texto que ya había, así que entrar y salir con un clic fijaría los 100.000 € de ejemplo, y volverían
 * al informe los «100.000 € inventados» que F-04 retiró. Solo cuenta si se ha tecleado.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EuroAmountInput } from "../src/components/ui/EuroAmountInput";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function teclea(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function montar(onCommit: (valor: number) => void, confirmarLaMismaCifra?: boolean) {
  await act(async () => {
    root.render(createElement(EuroAmountInput, { value: 100000, onCommit, confirmarLaMismaCifra }));
  });
  return host.querySelector("input") as HTMLInputElement;
}

describe("confirmar la misma cifra", () => {
  test("entrar y salir sin teclear no confirma nada", async () => {
    const onCommit = vi.fn();
    const input = await montar(onCommit, true);
    await act(async () => {
      input.focus();
    });
    await act(async () => {
      input.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("teclear la misma cifra sí confirma", async () => {
    const onCommit = vi.fn();
    const input = await montar(onCommit, true);
    await act(async () => {
      input.focus();
    });
    // Tecla a tecla, como en un teclado: la cifra pasa por «1» antes de volver a ser la misma.
    await act(async () => {
      teclea(input, "1");
    });
    await act(async () => {
      teclea(input, "100.000");
    });
    await act(async () => {
      input.blur();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(100000);
  });

  test("lo tecleado en una entrada no vale para la siguiente", async () => {
    const onCommit = vi.fn();
    const input = await montar(onCommit, true);
    await act(async () => {
      input.focus();
    });
    await act(async () => {
      teclea(input, "100000");
    });
    await act(async () => {
      input.blur();
    });
    onCommit.mockClear();
    await act(async () => {
      input.focus();
    });
    await act(async () => {
      input.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("sin pedirlo, los demás campos de importe siguen igual: la misma cifra no avisa", async () => {
    const onCommit = vi.fn();
    const input = await montar(onCommit);
    await act(async () => {
      input.focus();
    });
    await act(async () => {
      teclea(input, "1");
    });
    await act(async () => {
      teclea(input, "100.000");
    });
    await act(async () => {
      input.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("otra cifra confirma siempre", async () => {
    const onCommit = vi.fn();
    const input = await montar(onCommit, true);
    await act(async () => {
      input.focus();
    });
    await act(async () => {
      teclea(input, "250.000");
    });
    await act(async () => {
      input.blur();
    });
    expect(onCommit).toHaveBeenCalledWith(250000);
  });
});
