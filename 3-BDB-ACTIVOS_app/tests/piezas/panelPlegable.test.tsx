// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { Button } from "../../src/components/ui/Button";
import { Panel } from "../../src/components/ui/Panel";
import { pintar, pulsar } from "./pintar";

/**
 * Panel plegable: el título pasa a ser un botón con `aria-expanded` que enseña u oculta el cuerpo; el encabezado
 * sigue siendo el nombre de la sección, y las acciones quedan fuera del botón. Sin `plegable`, el panel de siempre.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

describe("el panel plegable", () => {
  test("cerrado al empezar: el botón está dentro del encabezado y controla el cuerpo oculto", () => {
    const vista = pintar(
      <Panel plegable subtitulo="Del 31/12/2025 al 13/11/2026" titulo="Detalle por año">
        <p>Cuerpo</p>
      </Panel>
    );
    quitar = vista.quitar;
    const seccion = vista.host.querySelector("section.panel")!;
    const titulo = vista.host.querySelector(".panel__title")!;
    const boton = titulo.querySelector<HTMLButtonElement>("button.panel__plegador")!;
    const cuerpo = vista.host.querySelector<HTMLElement>(".panel__body")!;
    expect(titulo.tagName).toBe("H2");
    expect(boton.type).toBe("button");
    expect(boton.textContent).toBe("Detalle por año");
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(boton.getAttribute("aria-controls")).toBe(cuerpo.id);
    expect(cuerpo.hidden).toBe(true);
    /* La sección se sigue llamando como su título. */
    expect(document.getElementById(seccion.getAttribute("aria-labelledby")!)?.textContent).toBe("Detalle por año");
  });

  test("pulsar el título lo abre y lo cierra", () => {
    const vista = pintar(
      <Panel plegable titulo="Detalle">
        <p>Cuerpo</p>
      </Panel>
    );
    quitar = vista.quitar;
    const boton = vista.host.querySelector("button.panel__plegador")!;
    const cuerpo = vista.host.querySelector<HTMLElement>(".panel__body")!;
    pulsar(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    expect(cuerpo.hidden).toBe(false);
    pulsar(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(cuerpo.hidden).toBe(true);
  });

  test("abierto al empezar, con las acciones fuera del botón y funcionando", () => {
    const accion = vi.fn();
    const vista = pintar(
      <Panel abiertoAlEmpezar acciones={<Button onClick={accion}>Ver el detalle</Button>} plegable titulo="Composición">
        <p>Cuerpo</p>
      </Panel>
    );
    quitar = vista.quitar;
    expect(vista.host.querySelector("button.panel__plegador")!.getAttribute("aria-expanded")).toBe("true");
    expect(vista.host.querySelector<HTMLElement>(".panel__body")!.hidden).toBe(false);
    const delPanel = vista.host.querySelector(".panel__actions button")!;
    expect(delPanel.closest(".panel__plegador")).toBeNull();
    pulsar(delPanel);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  test("sin plegable, el panel de siempre: ni botón, ni id en el cuerpo, ni oculto", () => {
    const vista = pintar(
      <Panel titulo="Riesgo">
        <p>Cuerpo</p>
      </Panel>
    );
    quitar = vista.quitar;
    expect(vista.host.querySelector(".panel__plegador")).toBeNull();
    const cuerpo = vista.host.querySelector<HTMLElement>(".panel__body")!;
    expect(cuerpo.hasAttribute("id")).toBe(false);
    expect(cuerpo.hidden).toBe(false);
  });
});
