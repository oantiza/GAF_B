// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/gestor/mercado/plataforma", () => ({ catalogoDeActivos: vi.fn(async () => []) }));

import { SelectorDeActivo } from "../../src/gestor/ui/dialogos/SelectorDeActivo";
import { pintar } from "../piezas/pintar";

/**
 * Crear un activo propio en el Gestor de carteras: el campo de fondo, ETF, acción, bono u otro se rotula «Producto»,
 * como en el resto de pantallas, y todo control del formulario lo nombra su rótulo.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

async function abrirElAlta() {
  const vista = pintar(<SelectorDeActivo activosDeLaCartera={[]} alElegir={vi.fn()} divisaBase="EUR" elegido={undefined} rotulo="Activo" />);
  quitar = vista.quitar;
  await act(async () => undefined);
  const buscador = vista.host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(buscador, "Mi fondo");
    buscador.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const crear = [...vista.host.querySelectorAll("button")].find((b) => b.textContent === "Crearlo como activo propio")!;
  act(() => crear.click());
  return vista.host;
}

describe("el alta de un activo propio", () => {
  test("el campo del producto se rotula «Producto», no «Tipo», y su rótulo nombra al desplegable", async () => {
    const host = await abrirElAlta();
    const rotulos = [...host.querySelectorAll("label")].map((label) => label.textContent);
    expect(rotulos).toContain("Producto");
    expect(rotulos).not.toContain("Tipo");
    const producto = [...host.querySelectorAll("label")].find((label) => label.textContent === "Producto")!;
    const control = document.getElementById(producto.htmlFor) as HTMLSelectElement;
    expect(control.tagName).toBe("SELECT");
    expect([...control.options].map((opcion) => opcion.textContent)).toEqual(["Fondo", "ETF", "Acción", "Bono", "Otro"]);
  });

  test("todo control del formulario tiene un rótulo enlazado", async () => {
    const host = await abrirElAlta();
    const controles = [...host.querySelectorAll<HTMLElement>("input, select, textarea")];
    expect(controles.length).toBeGreaterThan(0);
    for (const control of controles) {
      expect([control.id, host.querySelector(`label[for="${control.id}"]`)?.textContent]).not.toEqual([control.id, undefined]);
    }
  });
});
