// @vitest-environment happy-dom
/**
 * Las tablas de «Carteras de clientes» que pueden desplazarse en horizontal se alcanzan con el teclado.
 *
 * A 1.024 px la tabla de rentabilidad por meses (catorce columnas) no cabe y su envoltorio desplaza; sin poder
 * enfocarlo, quien no usa ratón no llega a las columnas de la derecha (WCAG 2.1.1, regla
 * `scrollable-region-focusable` de axe). Lo encontró el recorrido de capturas a ese ancho. El envoltorio se hace
 * como el marco de la tabla común (`TablaDeDatos`): un grupo con nombre, en el orden del tabulador.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { BloqueMeses } from "../../src/gestor/ui/analisis/BloqueMeses";

/* Con `happy-dom`, `URL` es la del navegador simulado y `fs` no la admite: la ruta, desde la carpeta de la app. */
const RAIZ = path.resolve(process.cwd(), "src/gestor");

/** Todos los `.tsx` del gestor, con su ruta relativa. */
function fuentes(carpeta: string = RAIZ, prefijo = ""): Array<{ ruta: string; texto: string }> {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    if (entrada.isDirectory()) return fuentes(path.join(carpeta, entrada.name), `${prefijo}${entrada.name}/`);
    return entrada.name.endsWith(".tsx") ? [{ ruta: `${prefijo}${entrada.name}`, texto: readFileSync(path.join(carpeta, entrada.name), "utf8") }] : [];
  });
}

let raiz: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => raiz?.unmount());
  host?.remove();
  raiz = undefined;
  host = undefined;
});

describe("los envoltorios de tabla del gestor", () => {
  const envoltorios = fuentes().flatMap(({ ruta, texto }) =>
    texto.split(/\r?\n/).filter((linea) => linea.includes("gestor-tabla-envoltorio")).map((linea) => ({ ruta, linea: linea.trim() }))
  );

  test("la prueba ve los cinco que hay", () => {
    expect(envoltorios.map((e) => e.ruta).sort()).toEqual([
      "ui/analisis/BloqueMeses.tsx",
      "ui/comparar/TablaComparada.tsx",
      "ui/dialogos/DialogoDeVersiones.tsx",
      "ui/importar/PasoComprobacion.tsx",
      "ui/importar/PasoRevision.tsx"
    ]);
  });

  test("cada uno es un grupo con nombre al que se llega con el tabulador", () => {
    for (const { ruta, linea } of envoltorios) {
      expect(linea, ruta).toMatch(/role="group"/);
      expect(linea, ruta).toMatch(/tabIndex=\{0\}/);
      expect(linea, ruta).toMatch(/aria-label="[^"]+ \(tabla desplazable\)"/);
    }
  });
});

describe("la tabla de rentabilidad por meses", () => {
  test("su envoltorio se puede enfocar y dice qué tabla es", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const mes = (rentabilidad: number) => ({ rentabilidad, parcial: false });
    const porMeses = [{ anio: 2026, meses: [mes(0.01), mes(-0.02), ...Array.from({ length: 10 }, () => null)], total: -0.0102, parcial: true }];
    await act(async () => raiz!.render(createElement(BloqueMeses, { analisis: { porMeses: porMeses as never, sinPrecio: [] } })));

    const envoltorio = host.querySelector(".gestor-tabla-envoltorio");
    expect(envoltorio).not.toBeNull();
    expect(envoltorio!.getAttribute("role")).toBe("group");
    expect(envoltorio!.getAttribute("tabindex")).toBe("0");
    expect(envoltorio!.getAttribute("aria-label")).toBe("Rentabilidad por meses y años (tabla desplazable)");
    /* Y dentro sigue la tabla, con sus catorce columnas. */
    expect(envoltorio!.querySelectorAll("thead th")).toHaveLength(14);
  });
});
