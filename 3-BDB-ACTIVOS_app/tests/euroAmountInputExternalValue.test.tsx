// @vitest-environment happy-dom

/* Revisión de la cuarta pasada (R4-13), invertido en la quinta (antes
   zz_review4_euro): con la cifra marcada como no válida, un importe que cambia
   desde fuera (otra cartera, el capital detectado de un extracto) ya no queda
   tapado por el borrador «25k». Mientras la cifra es no válida, la
   explicación está enlazada con aria-describedby. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { EuroAmountInput } from "../src/components/ui/EuroAmountInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("«25k» marcado como no válido deja paso a un importe nuevo que llega desde fuera", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital" })); });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "25k");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.blur(); });
    expect(input.value).toBe("25k");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const noteId = input.getAttribute("aria-describedby");
    expect(noteId).toBeTruthy();
    expect(host.querySelector(`[id="${noteId}"]`)?.textContent).toContain("Cifra no válida");

    // El Constructor aplica después el capital detectado de un extracto: 200.000.
    await act(async () => { root.render(createElement(EuroAmountInput, { value: 200000, onCommit, ariaLabel: "Capital" })); });
    expect(input.value).toBe("200.000");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("mientras se escribe, un cambio de fuera no pisa el borrador válido", async () => {
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(EuroAmountInput, { value: 100000, onCommit, ariaLabel: "Capital" })); });
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "30.000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { root.render(createElement(EuroAmountInput, { value: 200000, onCommit, ariaLabel: "Capital" })); });
    expect(input.value).toBe("30.000");
    await act(async () => { input.blur(); });
    expect(onCommit).toHaveBeenCalledWith(30000);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
