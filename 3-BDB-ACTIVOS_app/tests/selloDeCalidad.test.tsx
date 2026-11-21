// @vitest-environment happy-dom
/**
 * El sello de calidad del dato de un gráfico se escribe en palabras y con mayúscula inicial, en todas las piezas.
 *
 * La matriz de correlación de Análisis escribía el código tal cual, «real», cuando no le daban un rótulo propio: se vio
 * en el recorrido del 14-11-2026. Las demás piezas escribían «Real».
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { OaaCorrelationHeatmap } from "../src/charts/oaa/OaaCorrelationHeatmap";
import { rotuloDelSello } from "../src/charts/oaa/selloDeCalidad";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("el rótulo del sello de calidad", () => {
  test("sin rótulo propio, la calidad en palabras", () => {
    expect(rotuloDelSello("real")).toBe("Real");
    expect(rotuloDelSello("mixed")).toBe("Mixto");
    expect(rotuloDelSello("estimated")).toBe("Estimado");
    expect(rotuloDelSello("none")).toBe("Sin dato");
  });

  test("con rótulo propio, ese, con mayúscula inicial", () => {
    expect(rotuloDelSello("real", "subyacente")).toBe("Subyacente");
    expect(rotuloDelSello("real", "Histórico")).toBe("Histórico");
  });

  test("la matriz de correlación sin rótulo propio escribe «Real», no el código", async () => {
    const contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    const raiz = createRoot(contenedor);
    await act(async () =>
      raiz.render(
        createElement(OaaCorrelationHeatmap, {
          items: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
          cells: [{ rowKey: "a", columnKey: "b", rowLabel: "A", columnLabel: "B", rowIndex: 0, columnIndex: 1, value: 0.5 }],
          dataQuality: "real"
        })
      )
    );
    expect(contenedor.querySelector(".oaa-data-pill")?.textContent).toBe("Real");
    act(() => raiz.unmount());
    contenedor.remove();
  });
});
