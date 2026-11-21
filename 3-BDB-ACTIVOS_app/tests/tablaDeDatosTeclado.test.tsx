// @vitest-environment happy-dom

/**
 * MAR-01 (auditoría de frontend, 13-11-2026): una fila «abrible» se abre también con el teclado.
 *
 * La tabla hacía abrible una fila con un `onClick` en el `<tr>`, que no recibe el foco ni responde a Intro.
 * En la lista de carteras del Gestor ninguna celda trae enlace ni botón, así que con teclado no se podía abrir
 * ninguna cartera. Ahora lo garantiza la pieza: la celda que encabeza la fila se pinta como un botón.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TablaDeDatos } from "../src/components/tabla/TablaDeDatos";
import type { ColumnaDeTabla, FilaAgrupable } from "../src/types/tablaDeDatos";

interface Caso extends FilaAgrupable {
  id: string;
  nombre: string;
}

const FILAS: Caso[] = [
  { id: "a", nombre: "Cartera de Ana" },
  { id: "b", nombre: "Cartera de Luis" }
];

const SOLO_TEXTO: ColumnaDeTabla<Caso>[] = [
  { id: "nombre", titulo: "Cartera", encabezaFila: true, celda: (f) => ({ texto: f.nombre, valor: f.nombre }) },
  { id: "otra", titulo: "Otra", celda: () => ({ texto: "EUR" }) }
];

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const filasDelCuerpo = () => [...host.querySelectorAll<HTMLTableRowElement>(".tabla tbody tr")];
const interactivos = (fila: Element) => [...fila.querySelectorAll<HTMLElement>("a[href], button")];

describe("una fila abrible se abre con el teclado", () => {
  test("con columnas de solo texto, cada fila tiene un botón enfocable que la abre una sola vez", async () => {
    const alAbrir = vi.fn();
    await act(async () => root!.render(<TablaDeDatos alAbrir={alAbrir} columnas={SOLO_TEXTO} filas={FILAS} titulo="Carteras" />));

    for (const [indice, fila] of filasDelCuerpo().entries()) {
      const botones = interactivos(fila);
      expect(botones).toHaveLength(1);
      const boton = botones[0] as HTMLButtonElement;
      /* Un `<button type="button">` nativo: recibe el foco con el tabulador y el navegador lo activa con Intro
         y con Espacio disparando su `click`. */
      expect(boton.tagName).toBe("BUTTON");
      expect(boton.type).toBe("button");
      expect(boton.textContent).toBe(FILAS[indice].nombre);
      boton.focus();
      expect(document.activeElement).toBe(boton);

      alAbrir.mockClear();
      /* Lo que hace el navegador al pulsar Intro sobre un botón: el evento de teclado y, después, el clic. */
      await act(async () => {
        boton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        boton.click();
      });
      /* Una sola vez: el clic del botón no sube a la fila y la vuelve a abrir. */
      expect(alAbrir).toHaveBeenCalledTimes(1);
      expect(alAbrir).toHaveBeenCalledWith(FILAS[indice]);
    }
  });

  test("el clic en el resto de la fila sigue abriéndola", async () => {
    const alAbrir = vi.fn();
    await act(async () => root!.render(<TablaDeDatos alAbrir={alAbrir} columnas={SOLO_TEXTO} filas={FILAS} titulo="Carteras" />));
    await act(async () => filasDelCuerpo()[1].querySelector("td")!.click());
    expect(alAbrir).toHaveBeenCalledTimes(1);
    expect(alAbrir).toHaveBeenCalledWith(FILAS[1]);
  });

  test("si la celda ya trae su enlace o su nodo, no se añade otro", async () => {
    const columnas: ColumnaDeTabla<Caso>[] = [
      { id: "nombre", titulo: "Activo", encabezaFila: true, celda: (f) => ({ texto: f.nombre, enlaceAFicha: f.id }) },
      {
        id: "propio",
        titulo: "Propio",
        celda: (f) => ({ texto: f.nombre, nodo: <button type="button">Ver {f.nombre}</button> })
      }
    ];
    const conNodo: ColumnaDeTabla<Caso>[] = [
      { id: "nombre", titulo: "Cartera", encabezaFila: true, celda: (f) => ({ texto: f.nombre, nodo: <button type="button">{f.nombre}</button> }) }
    ];
    await act(async () => root!.render(<TablaDeDatos alAbrir={vi.fn()} columnas={columnas} filas={FILAS} titulo="Activos" />));
    expect(filasDelCuerpo().map((fila) => interactivos(fila).length)).toEqual([2, 2]);
    await act(async () => root!.render(<TablaDeDatos alAbrir={vi.fn()} columnas={conNodo} filas={FILAS} titulo="Carteras" />));
    expect(filasDelCuerpo().map((fila) => interactivos(fila).length)).toEqual([1, 1]);
  });

  test("con una columna de acciones, la salida por teclado ya la dan sus botones y no se repite", async () => {
    /* Es el caso de Movimientos del gestor: la fila se abre para editar, y «Editar» ya está en sus acciones. */
    const columnas: ColumnaDeTabla<Caso>[] = [
      ...SOLO_TEXTO,
      { id: "acciones", titulo: "Acciones", acciones: true, tituloOculto: true, celda: () => ({ texto: "", nodo: <button type="button">Editar</button> }) }
    ];
    await act(async () => root!.render(<TablaDeDatos alAbrir={vi.fn()} columnas={columnas} filas={FILAS} titulo="Movimientos" />));
    expect(filasDelCuerpo().map((fila) => interactivos(fila).map((b) => b.textContent))).toEqual([["Editar"], ["Editar"]]);
  });

  test("sin `alAbrir`, la celda sigue siendo texto", async () => {
    await act(async () => root!.render(<TablaDeDatos columnas={SOLO_TEXTO} filas={FILAS} titulo="Carteras" />));
    expect(filasDelCuerpo().map((fila) => interactivos(fila).length)).toEqual([0, 0]);
  });
});
