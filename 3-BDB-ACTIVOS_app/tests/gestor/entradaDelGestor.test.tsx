// @vitest-environment happy-dom
/**
 * La entrada del gestor: ya no lleva al «Análisis rápido de extractos», que enviaba los extractos a la
 * plataforma (GES-09) y se retiró el 14-11-2026, y crear una cartera con la tecla Intro, que no puede dejar
 * el diálogo reabierto (DIR-01).
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/gestor/ui/estado/useAlmacen", () => ({
  useAlmacen: () => ({ estado: { fase: "sin-acceso" }, error: null, elegir: async () => undefined, reanudar: async () => undefined, olvidar: async () => undefined })
}));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false }));
vi.mock("../../src/gestor/almacen/descarga", () => ({ descargarCartera: vi.fn(() => "x.cartera.json"), nombreDeFichero: () => "x.cartera.json", abrirFichero: vi.fn() }));

import { GestorDeCarterasPage } from "../../src/gestor/ui/GestorDeCarterasPage";
import { pintar, type Pintado } from "./vistaAnalisisDatos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

describe("el análisis rápido, retirado (GES-09)", () => {
  it("la entrada no lleva a ningún análisis que saque los extractos del equipo", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    pintado = await pintar(<GestorDeCarterasPage />);
    expect(boton("Análisis rápido de extractos")).toBeUndefined();
    expect(document.body.textContent).not.toContain("envía los extractos a la plataforma");
  });
});

describe("crear una cartera con Intro (DIR-01)", () => {
  it("la tecla queda anulada, se crea una sola cartera y el diálogo no queda abierto", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    pintado = await pintar(<GestorDeCarterasPage />);
    await act(async () => boton("Nueva cartera")!.click());
    const campo = document.body.querySelector<HTMLInputElement>('input[placeholder="Por ejemplo, Familia García"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "Familia Intro");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const intro = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      campo.dispatchEvent(intro);
    });
    /* Sin anularla, la misma pulsación activa el botón que abrió el diálogo, que recibe el foco al cerrarse. */
    expect(intro.defaultPrevented).toBe(true);
    expect(document.body.querySelector("h1")?.textContent).toBe("Familia Intro");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
