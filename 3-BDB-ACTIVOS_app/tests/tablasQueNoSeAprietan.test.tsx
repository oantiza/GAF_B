// @vitest-environment happy-dom
/**
 * El nombre de un activo no se queda sin sitio en una tabla.
 *
 * Al pasar las pantallas a la tabla común (`TablaDeDatos`), sus títulos de columna no se partían: cada columna de cifras
 * medía lo que su título y la del nombre se quedaba con lo que sobraba. En «Planes y EPSV», a 1.440 px, eran ochenta
 * píxeles: cada plan ocupaba de cuatro a siete líneas, y cabían 25 en 3.445 px de alto donde antes del rediseño cabían
 * 40 en 3.024. Lo mismo, en menor medida, en las posiciones de Análisis y en las cuentas de una cartera de cliente.
 *
 * Ninguna prueba de pantalla lo ve (aquí no hay maquetación) y nada se desbordaba: se midió en el navegador, con el
 * recorrido de capturas (`scripts/auditoriaFrontend.mjs`, «tablas apretadas»: la fila mediana de una tabla no pasa de
 * 96 px). Esto vigila las reglas que lo evitan:
 *
 * 1. el título de una columna puede partirse en dos líneas, en toda tabla;
 * 2. una columna declarada `nombre` no baja de un ancho mínimo, y si la tabla no cabe desplaza dentro de su marco;
 * 3. en Planes, el catálogo, el nombre no baja del ancho de un catálogo y las columnas de más se pliegan hasta 1.800 px.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { TablaDeDatos } from "../src/components/tabla/TablaDeDatos";
import type { ColumnaDeTabla } from "../src/types/tablaDeDatos";

/* Con `happy-dom`, `URL` es la del navegador simulado y `fs` no la admite: la ruta, desde la carpeta de la app. */
const hoja = (nombre: string) => readFileSync(path.resolve(process.cwd(), "src/styles", nombre), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** El cuerpo de la regla cuyo selector (entero, normalizado) es `selector`, dentro del texto dado. */
function cuerpoDe(css: string, selector: string): string | null {
  const normal = (texto: string) => texto.replace(/\s+/g, " ").trim();
  for (const regla of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (regla[1].split(",").map(normal).includes(normal(selector))) return regla[2];
  }
  return null;
}

/** Lo que hay dentro de la `@media` con esa condición. */
function dentroDe(css: string, condicion: string): string {
  const inicio = css.indexOf(`@media ${condicion} {`);
  if (inicio < 0) return "";
  const abre = css.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === "{") nivel += 1;
    if (css[i] === "}") {
      nivel -= 1;
      if (nivel === 0) return css.slice(abre + 1, i);
    }
  }
  return "";
}

let raiz: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => raiz?.unmount());
  host?.remove();
  raiz = undefined;
  host = undefined;
});

describe("la tabla común", () => {
  const tabla = hoja("tabla.css");

  test("el título de una columna puede partirse en dos líneas", () => {
    const cabecera = cuerpoDe(tabla, ".tabla th");
    expect(cabecera).toMatch(/white-space:\s*normal/);
    expect(cabecera).not.toMatch(/white-space:\s*nowrap/);
  });

  test("la columna del nombre no baja de su ancho mínimo, que es un token", () => {
    expect(cuerpoDe(tabla, ".tabla .tabla__celda--nombre")).toMatch(/min-width:\s*var\(--columna-nombre-corta\)/);
    expect(hoja("tokens.css")).toMatch(/--columna-nombre-corta:\s*\d+px/);
  });

  test("una columna de prosa no baja de un ancho de lectura, que es un token escrito en caracteres", () => {
    expect(cuerpoDe(tabla, ".tabla .tabla__celda--prosa")).toMatch(/min-width:\s*var\(--columna-prosa-min\)/);
    const ancho = /--columna-prosa-min:\s*(\d+)ch/.exec(hoja("tokens.css"));
    expect(ancho, "el token, en caracteres").not.toBeNull();
    /* Por debajo de unos cuarenta caracteres por línea una frase larga se vuelve una columna de palabras. */
    expect(Number(ancho![1])).toBeGreaterThanOrEqual(40);
  });

  test("una columna declarada `prosa` lleva su clase en el título y en cada fila; las demás, no", async () => {
    interface Fila { id: string; fondo: string; motivo: string }
    const columnas: ColumnaDeTabla<Fila>[] = [
      { id: "fondo", titulo: "Fondo", nombre: true, celda: (fila) => ({ texto: fila.fondo }) },
      { id: "motivo", titulo: "Revisión pendiente", prosa: true, celda: (fila) => ({ texto: fila.motivo }) }
    ];
    const filas: Fila[] = [
      { id: "a", fondo: "JPMorgan Investment Funds - Global Income Fund D (div) EUR", motivo: "Rentabilidad total pendiente de conciliar · Respuesta reciente insuficiente: se conserva la cartera anterior" },
      { id: "b", fondo: "BlackRock Global Funds - Euro Corporate Bond Fund A1", motivo: "Sin histórico apto para cálculo · Solo posiciones principales" }
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => raiz!.render(createElement(TablaDeDatos<Fila>, { columnas, filas, titulo: "Calidad" })));

    const deProsa = [...host.querySelectorAll(".tabla__celda--prosa")];
    expect(deProsa.map((celda) => celda.tagName)).toEqual(["TH", "TD", "TD"]);
    expect(deProsa.slice(1).map((celda) => celda.textContent)).toEqual(filas.map((fila) => fila.motivo));
    expect(host.querySelectorAll(".tabla__celda--nombre.tabla__celda--prosa")).toHaveLength(0);
  });

  test("una columna declarada `nombre` lleva su clase en el título y en cada fila; las demás, no", async () => {
    interface Fila { id: string; activo: string; peso: string }
    const columnas: ColumnaDeTabla<Fila>[] = [
      { id: "activo", titulo: "Activo", encabezaFila: true, nombre: true, celda: (fila) => ({ texto: fila.activo }) },
      { id: "peso", titulo: "Peso", cifra: true, celda: (fila) => ({ texto: fila.peso }) }
    ];
    const filas: Fila[] = [
      { id: "a", activo: "Amundi Funds - Global Equity Responsible A EUR (C)", peso: "10,0\u00a0%" },
      { id: "b", activo: "PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation", peso: "20,0\u00a0%" }
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => raiz!.render(createElement(TablaDeDatos<Fila>, { columnas, filas, titulo: "Posiciones" })));

    const conNombre = [...host.querySelectorAll(".tabla__celda--nombre")];
    /* El título de la columna y el encabezado de cada una de las dos filas. */
    expect(conNombre.map((celda) => celda.tagName)).toEqual(["TH", "TH", "TH"]);
    expect(conNombre.slice(1).map((celda) => celda.textContent)).toEqual(filas.map((fila) => fila.activo));
    expect([...host.querySelectorAll("td")].some((celda) => celda.classList.contains("tabla__celda--nombre"))).toBe(false);
  });
});

describe("la tabla de la lista de planes", () => {
  const planes = hoja("planes.css");

  test("el nombre del plan no baja del ancho mínimo de un catálogo", () => {
    expect(cuerpoDe(planes, ".planes-lista .tabla th:first-child")).toMatch(/min-width:\s*var\(--columna-nombre-min\)/);
    expect(cuerpoDe(planes, ".planes-lista .tabla td:first-child")).toMatch(/min-width:\s*var\(--columna-nombre-min\)/);
  });

  test("la categoría y el Sharpe se pliegan hasta los 1.800 px, y la categoría baja a su apunte", () => {
    const estrecho = dentroDe(planes, "(max-width: 1799.98px)");
    expect(cuerpoDe(estrecho, ".planes-lista .tabla__columna--solo-ancho")).toMatch(/display:\s*none/);
    expect(cuerpoDe(estrecho, ".planes-lista .tabla__apunte--estrecho")).toMatch(/display:\s*block/);
  });
});
