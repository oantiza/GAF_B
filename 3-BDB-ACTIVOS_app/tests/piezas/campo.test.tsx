// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { Campo } from "../../src/components/ui/Campo";
import { EuroAmountInput } from "../../src/components/ui/EuroAmountInput";
import { pintar } from "./pintar";

/**
 * La pieza Campo: el rótulo nombra al control, y la pista y el error le quedan enlazados, que es lo que oye quien
 * llega al campo con un lector de pantalla.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const describe_ = (control: Element) => (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
const textoDe = (id: string) => document.getElementById(id)?.textContent;

describe("la pieza Campo", () => {
  test("el rótulo nombra al control, y la pista y el error quedan enlazados en ese orden", () => {
    const vista = pintar(
      <Campo error="El horizonte debe ser mayor que cero años." pista="En años" rotulo="Horizonte">
        <input type="text" />
      </Campo>
    );
    quitar = vista.quitar;
    const control = vista.host.querySelector("input")!;
    const rotulo = vista.host.querySelector("label")!;
    expect(rotulo.className).toBe("field__label");
    expect(rotulo.getAttribute("for")).toBe(control.id);
    expect(control.id).toBeTruthy();
    expect(describe_(control).map(textoDe)).toEqual(["En años", "El horizonte debe ser mayor que cero años."]);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(vista.host.querySelector(".field__hint")?.textContent).toBe("En años");
    expect(vista.host.querySelector(".field__error")?.textContent).toBe("El horizonte debe ser mayor que cero años.");
  });

  test("sin error, el control no está marcado y solo se describe con la pista", () => {
    const vista = pintar(
      <Campo pista="Como aparecerá en el informe" rotulo="Nombre">
        <input type="text" />
      </Campo>
    );
    quitar = vista.quitar;
    const control = vista.host.querySelector("input")!;
    expect(control.hasAttribute("aria-invalid")).toBe(false);
    expect(describe_(control).map(textoDe)).toEqual(["Como aparecerá en el informe"]);
    expect(vista.host.querySelector(".field__error")).toBeNull();
  });

  test("respeta el id y la descripción que el control ya traía", () => {
    const vista = pintar(
      <>
        <p id="nota-de-fuera">Lo dice la pantalla</p>
        <Campo error="Elige uno" rotulo="Perfil">
          <select aria-describedby="nota-de-fuera" id="perfil">
            <option>5 · Equilibrado</option>
          </select>
        </Campo>
      </>
    );
    quitar = vista.quitar;
    const control = vista.host.querySelector("select")!;
    expect(control.id).toBe("perfil");
    expect(vista.host.querySelector("label")!.getAttribute("for")).toBe("perfil");
    expect(describe_(control).map(textoDe)).toEqual(["Lo dice la pantalla", "Elige uno"]);
  });

  test("«(opcional)» va en el rótulo, y un área de texto también se enlaza", () => {
    const vista = pintar(
      <Campo opcional rotulo="Nota para el cliente">
        <textarea />
      </Campo>
    );
    quitar = vista.quitar;
    expect(vista.host.querySelector("label")!.textContent).toBe("Nota para el cliente (opcional)");
    expect(vista.host.querySelector("label")!.getAttribute("for")).toBe(vista.host.querySelector("textarea")!.id);
  });

  test("con EuroAmountInput: el rótulo lo nombra y el error de fuera le llega", () => {
    const vista = pintar(
      <Campo error="El capital no puede ser cero." pista="En euros" rotulo="Capital">
        <EuroAmountInput onCommit={() => undefined} value={0} />
      </Campo>
    );
    quitar = vista.quitar;
    const control = vista.host.querySelector("input")!;
    expect(vista.host.querySelector("label")!.getAttribute("for")).toBe(control.id);
    expect(control.id).toBeTruthy();
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(describe_(control).map(textoDe)).toEqual(["En euros", "El capital no puede ser cero."]);
  });
});
