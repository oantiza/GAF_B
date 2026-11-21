// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CampoDeCifraAcotada } from "../src/components/CampoDeCifraAcotada";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { EuroAmountInput } from "../src/components/ui/EuroAmountInput";
import { pintar, teclear } from "./piezas/pintar";

/**
 * FMT-20: los campos donde teclea una persona leen con un solo lector (`cifraTecleada.ts`): coma decimal, punto de
 * millar opcional, y se enseña cómo se ha leído. El tope acotado ya no es `type="number"`, que dejaba la coma en manos
 * del navegador.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

function escribir(input: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function salir(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const acotado = (alConfirmar: (valor: number) => void, alCambiarValidez?: (valida: boolean) => void) => (
  <CampoDeCifraAcotada alCambiarValidez={alCambiarValidez} alConfirmar={alConfirmar} etiqueta="Máx. por activo (%)" max={100} min={1} step={5} valor={35} />
);

describe("el campo de cifra acotada", () => {
  test("es un campo de texto con teclado decimal, y su rótulo lo nombra", () => {
    const vista = pintar(acotado(vi.fn()));
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    expect(input.type).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.closest("label")?.querySelector("span")?.textContent).toBe("Máx. por activo (%)");
    expect(input.value).toBe("35");
  });

  test("«12,5» se lee 12,5; «12.5» también, y vuelve al campo escrito en español", () => {
    const alConfirmar = vi.fn();
    const vista = pintar(acotado(alConfirmar));
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    escribir(input, "12,5");
    salir(input);
    expect(alConfirmar).toHaveBeenLastCalledWith(12.5);
    vista.repintar(<CampoDeCifraAcotada alConfirmar={alConfirmar} etiqueta="Máx. por activo (%)" max={100} min={1} step={5} valor={12.5} />);
    expect(input.value).toBe("12,5");
  });

  test("lo que se sale del rango dice cómo se ha leído, queda enlazado al campo y no se aplica", () => {
    const alConfirmar = vi.fn();
    const alCambiarValidez = vi.fn();
    const vista = pintar(acotado(alConfirmar, alCambiarValidez));
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    escribir(input, "1.250");
    salir(input);
    expect(alConfirmar).not.toHaveBeenCalled();
    expect(alCambiarValidez).toHaveBeenLastCalledWith(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toBe("Se ha leído 1.250. Escribe una cifra entre 1 y 100, con coma decimal. Sigue valiendo 35.");
  });

  test("lo que no es una cifra («1,2,3») se dice así, y Escape vuelve a la que vale", () => {
    const vista = pintar(acotado(vi.fn()));
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    escribir(input, "1,2,3");
    salir(input);
    expect(vista.host.querySelector('[role="alert"]')?.textContent).toBe(
      "«1,2,3» no se lee como una cifra. Escribe una cifra entre 1 y 100, con coma decimal. Sigue valiendo 35."
    );
    teclear(input, "Escape");
    expect(input.value).toBe("35");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  test("las flechas suben y bajan un paso, sin salir del rango, como el campo numérico de antes", () => {
    const alConfirmar = vi.fn();
    const vista = pintar(acotado(alConfirmar));
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    teclear(input, "ArrowUp");
    expect(input.value).toBe("40");
    teclear(input, "ArrowDown");
    teclear(input, "ArrowDown");
    expect(input.value).toBe("30");
    salir(input);
    expect(alConfirmar).toHaveBeenLastCalledWith(30);
  });
});

describe("el peso de una posición", () => {
  test("«12.500» se lee 12.500 (punto de millar) y se rechaza; el motivo queda enlazado a su campo (MAR-10)", () => {
    const onWeightChange = vi.fn();
    const vista = pintar(
      <PortfolioPositionsTable
        assets={[]}
        locks={{}}
        onEuroChange={vi.fn()}
        onRemove={vi.fn()}
        onToggleLock={vi.fn()}
        onWeightChange={onWeightChange}
        positions={[{ asset_id: "A", label: "Fondo A", weight_percent: 50 }]}
        totalCapital={100000}
      />
    );
    quitar = vista.quitar;
    const input = vista.host.querySelector<HTMLInputElement>('input[aria-label="Peso de Fondo A"]')!;
    act(() => input.focus());
    escribir(input, "12.500");
    salir(input);
    expect(onWeightChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const motivo = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(motivo.textContent).toBe("Se ha leído 12.500\u00a0%: un peso no pasa del 100 %. Los decimales se escriben con coma, como 12,5. El peso no ha cambiado.");
  });
});

describe("el campo de importe lee con el mismo lector", () => {
  test("«1,234,567» no es una cifra al teclear (el lector de los ficheros del banco lo leía 1.234.567)", () => {
    const onCommit = vi.fn();
    const vista = pintar(<EuroAmountInput ariaLabel="Capital" onCommit={onCommit} value={100000} />);
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    act(() => input.focus());
    escribir(input, "1,234,567");
    salir(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  test("«1.500 EUR» tampoco; «1.500 €», sí", () => {
    const onCommit = vi.fn();
    const vista = pintar(<EuroAmountInput ariaLabel="Capital" onCommit={onCommit} value={100000} />);
    quitar = vista.quitar;
    const input = vista.host.querySelector("input")!;
    act(() => input.focus());
    escribir(input, "1.500 EUR");
    salir(input);
    expect(onCommit).not.toHaveBeenCalled();
    act(() => input.focus());
    escribir(input, "1.500 €");
    salir(input);
    expect(onCommit).toHaveBeenCalledWith(1500);
  });
});
