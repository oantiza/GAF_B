// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { OaaOverlapHeatmap, type OaaOverlapCell } from "../src/charts/oaa/OaaOverlapHeatmap";

/*
 * G-7 (14-11-2026): la matriz de solapamiento se dibujaba con un diagrama de dispersión de Recharts a todo el ancho, y
 * las casillas quedaban sueltas, con huecos enormes: no se leía como una matriz. Ahora es la rejilla CSS de la de
 * correlación: casillas contiguas del mismo tamaño, numeradas por fila y columna, con la diagonal marcada. Los textos de
 * cada casilla, la leyenda, el índice y la tabla alternativa no cambian.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NB = " ";

async function montar(node: ReactElement): Promise<HTMLDivElement> {
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  const raiz = createRoot(contenedor);
  await act(async () => raiz.render(node));
  return contenedor;
}

const items = [
  { key: "a", label: "Fondo A", detalle: "1.292 líneas · 100,0 % del fondo" },
  { key: "b", label: "Fondo B" },
  { key: "c", label: "Iberdrola", detalle: "No aplica: es una acción" }
];
const celda = (fila: number, columna: number, value: number | null, extra: Partial<OaaOverlapCell> = {}): OaaOverlapCell => ({
  rowKey: items[fila].key,
  columnKey: items[columna].key,
  rowLabel: items[fila].label,
  columnLabel: items[columna].label,
  rowIndex: fila,
  columnIndex: columna,
  value,
  commonTop: [],
  ...extra
});
const cells: OaaOverlapCell[] = [
  celda(0, 0, 100),
  celda(0, 1, 94.4, { commonTop: [{ name: "Apple", weight: 3 }, { name: "Microsoft", weight: 2.5 }] }),
  celda(0, 2, null, { noAplica: true }),
  celda(1, 0, 0),
  celda(1, 1, 100),
  celda(1, 2, null, { noAplica: true }),
  celda(2, 0, null, { noAplica: true }),
  celda(2, 1, null),
  celda(2, 2, 100)
];

describe("la matriz de solapamiento es una rejilla, como la de correlación", () => {
  test("sin SVG: una rejilla de n × n casillas, con el número de cada columna y de cada fila y la diagonal marcada", async () => {
    const contenedor = await montar(createElement(OaaOverlapHeatmap, { cells, items }));
    expect(contenedor.querySelector("svg")).toBeNull();
    const rejilla = contenedor.querySelector(".oaa-heatmap-scroll > .heatmap.corr-heatmap-grid");
    expect(rejilla).not.toBeNull();
    expect(rejilla?.getAttribute("role")).toBe("group");
    expect(rejilla?.getAttribute("aria-label")).toBe("Mapa de solapamiento de 3 activos; claro = solapamiento bajo, oscuro = alto.");
    expect((rejilla as HTMLElement).style.getPropertyValue("--corr-n")).toBe("3");

    /* La cabecera: una esquina vacía y los números de columna; cada fila empieza con su número. */
    const cabecera = [...(rejilla?.querySelectorAll(".heatmap__axis--head") ?? [])].map((eje) => eje.textContent);
    expect(cabecera).toEqual(["", "1", "2", "3"]);
    const filas = [...(rejilla?.querySelectorAll(".heatmap__axis:not(.heatmap__axis--head)") ?? [])].map((eje) => eje.textContent);
    expect(filas).toEqual(["1", "2", "3"]);

    const casillas = [...(rejilla?.querySelectorAll(".heatmap__cell") ?? [])];
    expect(casillas).toHaveLength(9);
    expect(casillas.filter((casilla) => casilla.classList.contains("is-diagonal")).map((casilla) => casilla.getAttribute("data-casilla"))).toEqual([
      "0:0",
      "1:1",
      "2:2"
    ]);
  });

  test("cada casilla dice lo de siempre, con el paso de la rampa por fondo y tinta de papel desde el paso 5", async () => {
    const contenedor = await montar(createElement(OaaOverlapHeatmap, { cells, items }));
    const casilla = (posicion: string) => contenedor.querySelector(`[data-casilla="${posicion}"]`);
    /* 94,4 está en la clase de 80 a 99: paso 6 de la rampa, oscuro, tinta de papel; y en dos líneas. */
    expect(casilla("0:1")?.className).toBe("heatmap__cell oaa-rampa--6 is-dark");
    expect(casilla("0:1")?.querySelectorAll("br")).toHaveLength(1);
    expect(casilla("0:1")?.textContent).toBe(`al menos94,4${NB}%`);
    expect(casilla("1:0")?.textContent).toBe("sincomunes");
    expect(casilla("1:0")?.className).toBe("heatmap__cell oaa-rampa--0");
    expect(casilla("0:0")?.textContent).toBe(`100,0${NB}%`);
    expect(casilla("0:2")?.querySelector(".ausencia--no-aplica")?.textContent).toBe("No aplica");
    expect(casilla("2:1")?.textContent).toBe("Falta");
    /* El nombre de cada casilla trae lo que daba la nota: el par, la cifra y las mayores posiciones comunes. */
    expect(casilla("0:1")?.getAttribute("aria-label")).toBe(
      `Fondo A y Fondo B: al menos 94,4${NB}%; mayores posiciones comunes: Apple 3,0${NB}%, Microsoft 2,5${NB}%`
    );
  });

  test("la nota sale al pasar el ratón y al enfocar; la rejilla es una sola parada y las flechas mueven el foco", async () => {
    const contenedor = await montar(createElement(OaaOverlapHeatmap, { cells, items }));
    const casilla = (posicion: string) => contenedor.querySelector<HTMLElement>(`[data-casilla="${posicion}"]`)!;
    expect([...contenedor.querySelectorAll('[data-casilla][tabindex="0"]')].map((c) => c.getAttribute("data-casilla"))).toEqual(["0:1"]);

    await act(async () => casilla("0:1").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const nota = contenedor.querySelector(".overlap-heatmap-nota");
    expect(nota?.textContent).toContain("Fondo A y Fondo B");
    expect(nota?.textContent).toContain("Mayores posiciones comunes:");
    expect(nota?.textContent).toContain("Apple");

    await act(async () => casilla("0:1").focus());
    await act(async () => casilla("0:1").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-casilla")).toBe("1:1");
    expect([...contenedor.querySelectorAll('[data-casilla][tabindex="0"]')].map((c) => c.getAttribute("data-casilla"))).toEqual(["1:1"]);
    await act(async () => casilla("1:1").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-casilla")).toBe("1:0");
    expect(contenedor.querySelector(".overlap-heatmap-nota")?.textContent).toContain("Fondo B y Fondo A");
    await act(async () => casilla("1:0").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(contenedor.querySelector(".overlap-heatmap-nota")).toBeNull();
  });

  test("la leyenda, el índice con su detalle y la tabla alternativa siguen ahí", async () => {
    const contenedor = await montar(createElement(OaaOverlapHeatmap, { cells, items }));
    expect(contenedor.querySelectorAll(".oaa-rampa-leyenda li")).toHaveLength(7);
    const indice = contenedor.querySelector("ol.oaa-heatmap-index");
    expect(indice?.textContent).toContain("1.292 líneas · 100,0 % del fondo");
    const tabla = contenedor.querySelector("div.sr-only > table");
    const fila = [...(tabla?.querySelectorAll("tbody tr")[0]?.children ?? [])].map((c) => c.textContent);
    expect(fila).toEqual(["Fondo A", `100,0${NB}%`, `al menos 94,4${NB}%; mayores posiciones comunes: Apple 3,0${NB}%, Microsoft 2,5${NB}%`, "No aplica"]);
  });

  test("con menos de dos activos, dice lo que falta", async () => {
    const contenedor = await montar(createElement(OaaOverlapHeatmap, { cells: [], items: items.slice(0, 1) }));
    expect(contenedor.textContent).toContain("Hacen falta al menos 2 series para calcular el solapamiento.");
  });
});
