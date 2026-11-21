// @vitest-environment happy-dom
/**
 * Un gráfico dentro de un panel oculto no se dibuja hasta que el panel se enseña.
 *
 * La ficha de activo deja montadas sus cinco pestañas y esconde las que no se ven con `hidden`. Al abrirla en
 * «Costes», el gráfico de «Resumen» medía 0 × 0 y la librería de gráficos lo decía por consola en cada pantalla: «The
 * width(0) and height(0) of chart should be greater than 0». Se vio en el recorrido del 14-11-2026, en las cuatro
 * pestañas de la ficha que no son la primera.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OaaChartFrame } from "../src/charts/oaa/OaaChartFrame";

let host: HTMLDivElement;
let root: Root;
/** Los avisos del observador de tamaño que el marco ha pedido: llamarlos es decir «el marco ha cambiado de tamaño». */
let avisos: Array<() => void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  avisos = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly aviso: () => void;
      constructor(aviso: () => void) {
        this.aviso = aviso;
      }
      observe() {
        avisos.push(this.aviso);
      }
      disconnect() {
        avisos = avisos.filter((aviso) => aviso !== this.aviso);
      }
    }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function pintar(oculto: boolean) {
  act(() =>
    root.render(
      <div hidden={oculto} id="panel">
        <OaaChartFrame alternativa={{ titulo: "Evolución", columnas: ["Fecha", "Valor"], filas: [{ clave: "2026-10-30", rotulo: "30/10/2026", celdas: ["150,8"] }] }}>
          <svg data-testid="grafico" />
        </OaaChartFrame>
      </div>
    )
  );
}

const grafico = () => host.querySelector('[data-testid="grafico"]');

describe("el marco de los gráficos", () => {
  test("a la vista, dibuja el gráfico", () => {
    pintar(false);
    expect(grafico()).not.toBeNull();
  });

  test("dentro de un panel oculto no lo dibuja, y conserva el marco con su alto y su tabla alternativa", () => {
    pintar(true);
    expect(grafico()).toBeNull();
    expect(host.querySelector(".oaa-chart-frame")).not.toBeNull();
    expect(host.querySelector("table")).not.toBeNull();
  });

  test("lo dibuja cuando el panel se enseña, y lo retira si se vuelve a esconder", () => {
    pintar(true);
    expect(grafico()).toBeNull();
    /* Se elige su pestaña: el panel deja de estar oculto, el marco pasa a tener tamaño y el observador avisa. */
    pintar(false);
    act(() => avisos.forEach((aviso) => aviso()));
    expect(grafico()).not.toBeNull();
    pintar(true);
    act(() => avisos.forEach((aviso) => aviso()));
    expect(grafico()).toBeNull();
  });

  test("al desmontarse deja de observar", () => {
    pintar(false);
    expect(avisos).toHaveLength(1);
    act(() => root.render(<div />));
    expect(avisos).toHaveLength(0);
  });
});
