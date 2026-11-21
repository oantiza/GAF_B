// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { FILAS_POR_PAGINA, TablaDeDatos } from "../../src/components/tabla/TablaDeDatos";
import type { CeldaDeTabla, ColumnaDeTabla, FilaAgrupable } from "../../src/types/tablaDeDatos";
import { pintar, pulsar } from "./pintar";

/**
 * TablaDeDatos en el paso 2: ordena calculando la clave una vez por fila (ACT-12 a) con el mismo resultado que antes,
 * pagina con 25 filas cuando se pide sin número, y puede acotar su marco para que la cabecera quede fija.
 */
interface Fila extends FilaAgrupable {
  id: string;
  cifra: number | null;
  nombre: string;
}

let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

/** Mil filas con empates, huecos y textos, generadas sin azar para que la prueba sea siempre la misma. */
const MIL: Fila[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `f${i}`,
  cifra: i % 17 === 0 ? null : ((i * 7919) % 211) - 100,
  nombre: `Fondo ${String.fromCharCode(65 + ((i * 31) % 26))}${(i * 13) % 50}`
}));

const celdaDeCifra = (fila: Fila): CeldaDeTabla =>
  fila.cifra === null ? { texto: "Falta el dato", ausencia: "falta" } : { texto: String(fila.cifra), valor: fila.cifra };
const celdaDeNombre = (fila: Fila): CeldaDeTabla => ({ texto: fila.nombre });

/** El orden de antes, copiado tal cual: llamaba a `celda` dentro de la comparación. Es la referencia. */
function ordenDeAntes(filas: Fila[], celda: (fila: Fila) => CeldaDeTabla, sentido: number): string[] {
  const comparar = (a: CeldaDeTabla, b: CeldaDeTabla) => {
    const x = a.valor ?? (a.ausencia ? undefined : a.texto);
    const y = b.valor ?? (b.ausencia ? undefined : b.texto);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return sentido * (x - y);
    return sentido * String(x).localeCompare(String(y), "es");
  };
  return [...filas].sort((a, b) => comparar(celda(a), celda(b))).map((fila) => fila.id);
}

/** El orden que pinta la tabla, leído de la clave de cada fila. */
function ordenPintado(columnas: ColumnaDeTabla<Fila>[], orden: string, sentido: 1 | -1): string[] {
  const html = renderToStaticMarkup(<TablaDeDatos columnas={columnas} estado={{ orden, sentido, pagina: 1 }} filas={MIL} titulo="Prueba" />);
  return [...html.matchAll(/<th class="tabla__celda--fila" scope="row"><span>(f\d+)<\/span>/g)].map((m) => m[1]);
}

const COLUMNAS: ColumnaDeTabla<Fila>[] = [
  { id: "id", titulo: "Id", encabezaFila: true, celda: (fila) => ({ texto: fila.id }) },
  { id: "cifra", titulo: "Cifra", cifra: true, celda: celdaDeCifra },
  { id: "nombre", titulo: "Nombre", celda: celdaDeNombre }
];

describe("ordenar con la clave calculada una vez (ACT-12 a)", () => {
  test("con mil filas, la celda de la columna se pide una vez por fila al ordenar", () => {
    const llamadas = new Map<string, number>();
    const contada: ColumnaDeTabla<Fila> = {
      id: "cifra",
      titulo: "Cifra",
      cifra: true,
      celda: (fila) => {
        llamadas.set(fila.id, (llamadas.get(fila.id) ?? 0) + 1);
        return celdaDeCifra(fila);
      }
    };
    const vista = pintar(<TablaDeDatos columnas={[COLUMNAS[0], contada]} filas={MIL} porPagina={10} titulo="Prueba" />);
    quitar = vista.quitar;
    llamadas.clear();
    const encabezado = [...vista.host.querySelectorAll("thead button")].find((boton) => boton.textContent === "Cifra")!;
    pulsar(encabezado);
    const total = [...llamadas.values()].reduce((suma, n) => suma + n, 0);
    /* Mil para ordenar, más las diez filas que se pintan. Antes eran unas 20.000. */
    expect(total).toBe(1000 + 10);
    expect(Math.max(...llamadas.values())).toBeLessThanOrEqual(2);
  });

  test.each([
    ["cifras con huecos, de menor a mayor", "cifra", 1],
    ["cifras con huecos, de mayor a menor", "cifra", -1],
    ["textos con empates, de la A a la Z", "nombre", 1],
    ["textos con empates, de la Z a la A", "nombre", -1]
  ] as const)("el orden es el mismo que antes: %s", (_caso, orden, sentido) => {
    const celda = orden === "cifra" ? celdaDeCifra : celdaDeNombre;
    const pintado = ordenPintado(COLUMNAS, orden, sentido);
    expect(pintado).toHaveLength(1000);
    expect(pintado).toEqual(ordenDeAntes(MIL, celda, sentido));
  });

  test("lo que falta sigue al final en los dos sentidos", () => {
    const huecos = MIL.filter((fila) => fila.cifra === null).length;
    for (const sentido of [1, -1] as const) {
      const pintado = ordenPintado(COLUMNAS, "cifra", sentido);
      const finales = pintado.slice(-huecos).map((id) => MIL.find((fila) => fila.id === id)!.cifra);
      expect(finales.every((cifra) => cifra === null)).toBe(true);
    }
  });
});

describe("las 25 filas del sistema", () => {
  test("porPagina sin número pagina con 25", () => {
    expect(FILAS_POR_PAGINA).toBe(25);
    const html = renderToStaticMarkup(<TablaDeDatos columnas={COLUMNAS} filas={MIL.slice(0, 60)} porPagina titulo="Prueba" />);
    expect(html.match(/<th class="tabla__celda--fila" scope="row">/g)).toHaveLength(25);
    expect(html).toContain("1–25 de 60");
    expect(html).toContain("1 de 3");
  });

  test("sin porPagina se siguen pintando todas", () => {
    const html = renderToStaticMarkup(<TablaDeDatos columnas={COLUMNAS} filas={MIL.slice(0, 60)} titulo="Prueba" />);
    expect(html.match(/<th class="tabla__celda--fila" scope="row">/g)).toHaveLength(60);
  });
});

describe("la cabecera fija", () => {
  test("cabeceraFija acota el marco; sin ella, el marco de siempre", () => {
    expect(renderToStaticMarkup(<TablaDeDatos cabeceraFija columnas={COLUMNAS} filas={MIL.slice(0, 3)} titulo="Prueba" />)).toContain(
      'class="tabla__marco tabla__marco--cabecera-fija"'
    );
    expect(renderToStaticMarkup(<TablaDeDatos columnas={COLUMNAS} filas={MIL.slice(0, 3)} titulo="Prueba" />)).toContain('class="tabla__marco"');
  });

  test("la hoja pega la cabecera arriba del marco, con fondo, y acota el marco que la pide", () => {
    const hoja = readFileSync(new UrlDeNode("../../src/styles/tabla.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regla = (selector: string) => hoja.slice(hoja.indexOf(`${selector} {`), hoja.indexOf("}", hoja.indexOf(`${selector} {`)));
    expect(regla("\n.tabla thead th")).toMatch(/position: sticky;[\s\S]*top: 0;[\s\S]*background: var\(--papel\)/);
    expect(regla(".tabla__marco--cabecera-fija")).toMatch(/max-height: [^;]+;[\s\S]*overflow: auto/);
  });
});
