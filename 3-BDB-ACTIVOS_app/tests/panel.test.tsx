// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Panel } from "../src/components/ui/Panel";

/**
 * La pieza panel. Lo que se fija aquí es lo que no debe volver a perderse cuando otra
 * pantalla la use: el nombre accesible, dónde cae la procedencia y que no dibuje caja.
 */

function pinta(elemento: ReturnType<typeof createElement>): HTMLElement {
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  act(() => {
    raiz.render(elemento);
  });
  return contenedor;
}

describe("la pieza panel", () => {
  it("nombra la región aunque nadie le dé un id", () => {
    const c = pinta(createElement(Panel, { titulo: "Riesgo histórico" }, "cuerpo"));
    const seccion = c.querySelector("section.panel")!;
    const id = seccion.getAttribute("aria-labelledby");
    expect(id).toBeTruthy();
    /* El id no vale de nada si no apunta al título: eso es lo que anuncia el lector. */
    expect(c.querySelector(`#${id}`)?.textContent).toBe("Riesgo histórico");
    /* MAR-32: `h1` la pantalla, `h2` cada bloque, `h3` lo que va dentro de un bloque. */
    expect(c.querySelector(".panel__title")?.tagName).toBe("H2");
  });

  it("respeta el id que se le da, para enlazarlo desde fuera", () => {
    const c = pinta(
      createElement(Panel, { titulo: "Cobertura", tituloId: "mi-id" }, "cuerpo")
    );
    expect(c.querySelector("section.panel")!.getAttribute("aria-labelledby")).toBe("mi-id");
    expect(c.querySelector("#mi-id")?.textContent).toBe("Cobertura");
  });

  it("pone la procedencia bajo el título y el estado aparte", () => {
    const c = pinta(
      createElement(
        Panel,
        {
          titulo: "Riesgo histórico",
          subtitulo: "Rf del BCE · 31 oct 2026",
          estado: createElement("span", { className: "warn" }, "pendiente")
        },
        "cuerpo"
      )
    );
    /* El orden importa: la procedencia va pegada al título, dentro del mismo bloque,
       y el estado fuera. Eso es el principio 1 de la dirección: «Rf del BCE» y
       «pendiente» no son la misma clase de cosa y no se leen en la misma línea. */
    const texto = c.querySelector(".panel-head-text")!;
    expect(texto.querySelector(".panel__subtitle")?.textContent).toBe("Rf del BCE · 31 oct 2026");
    expect(texto.querySelector(".warn")).toBeNull();
    expect(c.querySelector(".panel__actions .warn")?.textContent).toBe("pendiente");
  });

  it("apila el antetítulo sobre el título", () => {
    const c = pinta(
      createElement(Panel, { rotulo: "Paso 1", titulo: "Cargar exportaciones" }, "cuerpo")
    );
    const hijos = [...c.querySelector(".panel-head-text")!.children].map((n) => n.className);
    expect(hijos[0]).toContain("section-label");
    expect(hijos[1]).toContain("panel__title");
  });

  it("baja a h3 cuando el panel va dentro de otro", () => {
    const c = pinta(
      createElement(Panel, { nivel: 3, titulo: "Actividad realizada y cobros" }, "cuerpo")
    );
    expect(c.querySelector(".panel__title")?.tagName).toBe("H3");
  });

  it("con nivel 2, el de siempre: el mismo h2 que sin nivel, con la misma clase", () => {
    const c = pinta(createElement(Panel, { nivel: 2, titulo: "Riesgo histórico" }, "cuerpo"));
    const titulo = c.querySelector(".panel__title")!;
    expect(titulo.tagName).toBe("H2");
    /* El aspecto lo da la clase, no la etiqueta: con cualquier nivel se ve igual. */
    expect(titulo.className).toBe("panel__title");
  });

  it("no dibuja una caja", () => {
    /* La dirección B —quince cajas con borde sobre fondo gris— se descartó el
       02-11-2026. Si alguien devuelve el borde al panel, esto falla. */
    const c = pinta(createElement(Panel, { titulo: "Atribución" }, "cuerpo"));
    const seccion = c.querySelector("section.panel")!;
    expect(seccion.className.split(" ")).not.toContain("card");
    expect(seccion.getAttribute("style")).toBeNull();
  });

  it("el cuerpo va en su propia caja, para que el relleno sea de la pieza", () => {
    const c = pinta(createElement(Panel, { titulo: "Reconciliación" }, "lo que sea"));
    expect(c.querySelector(".panel__body")?.textContent).toBe("lo que sea");
  });
});
