// @vitest-environment happy-dom

/**
 * MAR-15. `SegmentedControl` era un grupo de botones `aria-pressed` —cada uno una parada del tabulador, y el lector
 * oye «conmutador pulsado»— pero las flechas cambiaban el valor como en un grupo de opciones. Se queda en un solo
 * patrón, el de botones `aria-pressed`, que es el que ya leen sus usos y sus pruebas: el valor cambia al pulsar
 * (clic, Espacio o Intro), y las flechas, Inicio y Fin solo mueven el foco entre los botones. Y la opción elegida se
 * distingue por algo más que un fondo de papel sobre `--banda` (1,06:1): un filete de 2 px en `--marca`.
 */
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SegmentedControl } from "../src/components/ui/SegmentedControl";

let root: Root;
let host: HTMLDivElement;

const opciones = [
  { id: "1a", label: "1A" },
  { id: "3a", label: "3A" },
  { id: "5a", label: "5A", disabled: true },
  { id: "10a", label: "10A" }
] as const;

const boton = (texto: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === texto) as HTMLButtonElement;

async function pulsarTecla(destino: HTMLElement, key: string) {
  const evento = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    destino.dispatchEvent(evento);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  return evento;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("SegmentedControl, un solo patrón: botones que se pulsan", () => {
  test("las flechas mueven el foco sin cambiar el valor, y saltan la opción deshabilitada", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(SegmentedControl<string>, { label: "Periodo", options: opciones, value: "1a", onChange })));
    boton("1A").focus();

    const derecha = await pulsarTecla(boton("1A"), "ArrowRight");
    expect(derecha.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(boton("3A"));
    await pulsarTecla(boton("3A"), "ArrowRight");
    expect(document.activeElement).toBe(boton("10A"));
    await pulsarTecla(boton("10A"), "Home");
    expect(document.activeElement).toBe(boton("1A"));
    await pulsarTecla(boton("1A"), "End");
    expect(document.activeElement).toBe(boton("10A"));
    await pulsarTecla(boton("10A"), "ArrowLeft");
    expect(document.activeElement).toBe(boton("3A"));

    expect(onChange).not.toHaveBeenCalled();
    expect(boton("1A").getAttribute("aria-pressed")).toBe("true");
  });

  test("el valor cambia al pulsar, y cada opción dice si está pulsada", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(SegmentedControl<string>, { label: "Periodo", options: opciones, value: "1a", onChange })));
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Periodo");
    expect(host.querySelector('[role="radio"], [role="radiogroup"]')).toBeNull();
    expect(boton("3A").getAttribute("aria-pressed")).toBe("false");
    await act(async () => boton("3A").click());
    expect(onChange).toHaveBeenCalledWith("3a");
  });

  /* Dirección A (18-11-2026): la elegida deja de ser una pastilla de papel con contorno y pasa a ir en el marino de la
     marca con el texto en papel, también bajo el ratón (la regla del ratón, que pesa más, le devolvía la tinta oscura
     sobre el marino). Sin sombra: solo flota lo que flota (paso 1 del rediseño). */
  test("la opción elegida va en el marino de la marca con el texto en papel, también bajo el ratón, con los tokens de la casa", () => {
    const css = readFileSync(new UrlDeNode("../src/styles/components.css", import.meta.url), "utf8");
    const hallada = css.match(/\.ui-segmented__button\.active:hover:not\(:disabled\),\s*\.ui-segmented__button\.active\s*\{([^}]*)\}/);
    expect(hallada, "la regla de la opción elegida, con su estado bajo el ratón").not.toBeNull();
    const regla = hallada?.[1] ?? "";
    expect(regla).toMatch(/background:\s*var\(--marca\);/);
    expect(regla).toMatch(/color:\s*var\(--tinta-inversa\);/);
    expect(regla).toMatch(/font-weight:\s*600;/);
    expect(regla).not.toMatch(/box-shadow/);
    /* La caja del selector es de papel con el borde de un control, y sus opciones van a sangre, con un filete entre ellas. */
    const caja = css.match(/\n\.ui-segmented\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(caja).toMatch(/background:\s*var\(--papel\);/);
    expect(caja).toMatch(/border:\s*1px solid var\(--borde-control\);/);
    expect(css).toMatch(/\.ui-segmented__button \+ \.ui-segmented__button\s*\{\s*border-left:\s*1px solid var\(--filete\);/);
  });

  /* Dirección A (18-11-2026): la opción deshabilitada va en cursiva sobre la banda fuerte. La regla iba detrás de la de
     la elegida y con su mismo peso, así que una opción elegida y deshabilitada a la vez perdía su marino. */
  test("una opción deshabilitada se distingue sin la tinta, y la elegida sigue en su marino aunque no se pueda pulsar", () => {
    const css = readFileSync(new UrlDeNode("../src/styles/components.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const deshabilitada = css.match(/\n\.ui-segmented__button:disabled:not\(\.active\)\s*\{([^}]*)\}/)?.[1];
    expect(deshabilitada, "la regla de la opción deshabilitada no alcanza a la elegida").toBeDefined();
    expect(deshabilitada).toMatch(/font-style:\s*italic;/);
    expect(deshabilitada).toMatch(/background:\s*var\(--banda-fuerte\);/);
    expect(deshabilitada).toMatch(/cursor:\s*not-allowed;/);
    /* Ninguna otra regla de la opción deshabilitada le cambia el fondo a la elegida. */
    const otras = [...css.matchAll(/([^{}]*:disabled[^{}]*)\{([^}]*)\}/g)].filter(
      (regla) => regla[1].includes(".ui-segmented__button") && !regla[1].includes(":not(:disabled)") && !regla[1].includes(":not(.active)")
    );
    for (const regla of otras) expect(regla[2], regla[1].trim()).not.toMatch(/background/);
    const elegidaDeshabilitada = css.match(/\n\.ui-segmented__button\.active:disabled\s*\{([^}]*)\}/)?.[1];
    expect(elegidaDeshabilitada).toMatch(/cursor:\s*not-allowed;/);
  });

  test("la opción deshabilitada no se puede pulsar, y la elegida deshabilitada sigue diciendo que está pulsada", async () => {
    const onChange = vi.fn();
    const conLaElegidaDeshabilitada = [
      { id: "1a", label: "1A", disabled: true },
      { id: "3a", label: "3A" }
    ] as const;
    await act(async () => root.render(createElement(SegmentedControl<string>, { label: "Periodo", options: conLaElegidaDeshabilitada, value: "1a", onChange })));
    expect(boton("1A").disabled).toBe(true);
    expect(boton("1A").className).toContain("active");
    expect(boton("1A").getAttribute("aria-pressed")).toBe("true");
  });
});
