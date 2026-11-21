// @vitest-environment happy-dom

/**
 * Campo de importe (N3-08, cuarta pasada): «25k» ya no se lee como 25, pero
 * tampoco se descarta en silencio. La cifra se queda en el campo, marcada como
 * no válida, hasta que se corrige o se pulsa Escape.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { EuroAmountInput } from "../src/components/ui/EuroAmountInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(input: HTMLInputElement, value: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("una cifra ilegible se marca como no válida y no se aplica; una válida, sí", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital", className: "ui-input" }));
    });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await type(input, "25k");
    await act(async () => { input.blur(); });

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("25k");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("is-invalid");
    expect(input.title).toContain("Cifra no válida");

    await act(async () => { input.focus(); });
    await type(input, "25.000");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    await act(async () => { input.blur(); });
    expect(onCommit).toHaveBeenCalledWith(25000);
    expect(input.className).toBe("ui-input");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("MAR-05: la nota de cifra no válida se ve junto al campo, no solo la oye un lector de pantalla", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital" }));
    });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await type(input, "25k");
    await act(async () => { input.blur(); });

    const nota = host.querySelector(`[id="${input.getAttribute("aria-describedby")}"]`)!;
    expect(nota.textContent).toBe("Cifra no válida: escríbela con números, por ejemplo 25.000");
    expect(nota.classList.contains("ui-visually-hidden")).toBe(false);
    expect(nota.classList.contains("field__error")).toBe(true);
    expect(nota.getAttribute("role")).toBe("alert");

    await act(async () => { input.focus(); });
    await type(input, "25.000");
    expect(host.querySelector(".field__error")).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("un negativo no se convierte en 0: se marca y no se aplica", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital" }));
    });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await type(input, "-500");
    await act(async () => { input.blur(); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("Intro confirma una sola vez y la pulsación no sigue: no pulsa lo que haya abierto", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital" }));
    });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await type(input, "30.000");
    const intro = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(intro); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(30000);
    expect(intro.defaultPrevented).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("un peso escrito con punto es ese peso, y a medias no escribe nada", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(EuroAmountInput, { value: 10, onCommit, ariaLabel: "Peso", notaDeError: "Peso no válido" }));
    });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await type(input, "12.");
    expect(onCommit).not.toHaveBeenCalled();
    await type(input, "12.5");
    await act(async () => { input.blur(); });
    expect(onCommit).toHaveBeenCalledWith(12.5);
    await act(async () => { input.focus(); });
    await type(input, ",5");
    await act(async () => { input.blur(); });
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
