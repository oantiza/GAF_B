import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { porcentaje } from "../src/core/formato";
import {
  ACCION_DE_MUESTRA,
  BAJA_DE_MUESTRA,
  FONDO_DE_MUESTRA
} from "./fixtures/fichasDeMuestra";
import type { FichaInstrumento as ModeloDeFicha } from "../src/types/fichaInstrumento";

/**
 * La ficha de la dirección A + B.
 *
 * Lo que de verdad se comprueba aquí no es que salga HTML: es que las tres clases de
 * ausencia no se pinten igual, y que un fondo de doce secciones y una acción de cuatro
 * salgan del MISMO pintor. Si alguien vuelve a meter una rama por tipo de instrumento,
 * la ficha vuelve a ser una plantilla de fondo con huecos tachados, que es de lo que
 * veníamos.
 */

const pinta = (ficha: ModeloDeFicha) => renderToStaticMarkup(<FichaInstrumento ficha={ficha} />);

describe("ficha de instrumento", () => {
  test("el mismo pintor sirve a un fondo de doce secciones y a una acción de cuatro", () => {
    const fondo = pinta(FONDO_DE_MUESTRA);
    const accion = pinta(ACCION_DE_MUESTRA);

    expect(fondo).toContain("Janus Henderson Horizon Euroland Fund A2 EUR");
    /* El tipo va en la línea de contexto de la cabecera, escrito como una frase. */
    expect(fondo).toContain("Fondo de inversión");
    expect(accion).toContain("Inmocemento, S.A.");
    expect(accion).toContain("Acción");

    // Ninguna de las dos enseña una sección vacía: lo que no se declara, no se pinta.
    const seccionesDe = (html: string) => (html.match(/class="ficha__seccion/g) ?? []).length;
    expect(seccionesDe(fondo)).toBe(FONDO_DE_MUESTRA.secciones.length);
    expect(seccionesDe(accion)).toBe(ACCION_DE_MUESTRA.secciones.length);
    expect(seccionesDe(fondo)).toBeGreaterThan(seccionesDe(accion));
  });

  test("el componente no pregunta de qué tipo es el instrumento", () => {
    /*
     * La ficha anterior tenía veintitrés bloques y todos eran de fondo: la palabra TER,
     * que es un coste que una acción no tiene, aparecía 122 veces en el código de la
     * aplicación. Esta prueba lee el fichero y se asegura de que el pintor no decide
     * nada por el tipo: lo que se pinta lo decide el dato.
     */
    const fuente = readFileSync(
      new URL("../src/components/ficha/FichaInstrumento.tsx", import.meta.url),
      "utf8"
    );
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const rama of ['=== "FUND"', '=== "STOCK"', "instrument_type", "esFondo", "esAccion"]) {
      expect(codigo, `el pintor no puede ramificar por tipo (${rama})`).not.toContain(rama);
    }
  });

  test("un texto corrido lleva su clase, y esa clase le deja partir en líneas", () => {
    const seccion = ACCION_DE_MUESTRA.secciones[0];
    const ficha: ModeloDeFicha = {
      ...ACCION_DE_MUESTRA,
      secciones: [{ ...seccion, filas: [{ rotulo: "Actividad", valor: "La empresa hace muchas cosas.", larga: true }] }]
    };
    expect(pinta(ficha)).toContain('class="ficha__fila ficha__fila--larga"');
    const hoja = readFileSync(new URL("../src/styles/ficha.css", import.meta.url), "utf8");
    expect(hoja).toMatch(/\.ficha__fila--larga \.ficha__valor \{[^}]*white-space: normal/);
    /* Y se lee desde la izquierda, bajo su rótulo: a la derecha solo van los valores de una fila de dos columnas. */
    expect(hoja).toMatch(/\.ficha__fila--larga \.ficha__valor \{[^}]*text-align: start/);
  });

  /* 14-11-2026, visto al abrir por primera vez en el recorrido «Documentos y datos» de un ETF: «Se puede medir su alfa:
     +0,15 % a 1 año · del proveedor, contra el índice de su categoría». El valor no se partía (`nowrap`), se salía 98 px
     de la página y dejaba el rótulo en una palabra por línea. Una cifra no necesita `nowrap`: lleva espacios duros. */
  test("un valor que es una frase se parte en vez de salirse de la página, y deja sitio al rótulo", () => {
    const hoja = readFileSync(new URL("../src/styles/ficha.css", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const valor = /\n\.ficha__valor \{([^}]*)\}/.exec(hoja);
    expect(valor, "la regla del valor").not.toBeNull();
    expect(valor![1]).not.toContain("nowrap");
    expect(valor![1]).toContain("min-width: 0");
    expect(valor![1]).toContain("text-align: right");
    const fila = /\n\.ficha__fila \{([^}]*)\}/.exec(hoja);
    expect(fila![1].replace(/\/\*[\s\S]*?\*\//g, "")).toMatch(/grid-template-columns: minmax\(\d+%, 1fr\) minmax\(0, auto\)/);
    /* La cifra de una fila sigue sin partirse porque el módulo de formato le pone un espacio duro delante de la unidad:
       lo vigila tests/formato.test.ts. */
    expect(porcentaje(0.0187)).toMatch(/^1,87\u00a0%$/);
  });

  test("las tres ausencias no se pintan igual, que es lo único que no se puede fallar", () => {
    const accion = pinta(ACCION_DE_MUESTRA);
    const fondo = pinta(FONDO_DE_MUESTRA);

    // Cada clase tiene su propio modificador, y están las tres en juego.
    expect(accion).toContain("ficha__fila--no-aplica");
    expect(accion).toContain("ficha__fila--falta");
    expect(fondo).toContain("ficha__fila--sin-pedir");

    // «No aplica» y «Falta el dato» nunca comparten etiqueta.
    expect(accion).toContain("No aplica");
    expect(accion).toContain("Falta el dato");

    // Y ninguna ausencia se escribe con un guion, que se lee como cero.
    const valores = [...accion.matchAll(/class="ficha__valor"[^>]*>([^<]*)</g)].map((m) => m[1]);
    for (const valor of valores) {
      expect(valor.trim()).not.toMatch(/^[-–—]$/);
    }
  });

  test("«sin pedir» se distingue por su clase y lo que dice, y sin subrayado: no es un enlace", () => {
    /* Hasta la decisión 30 de Óscar (04-11-2026) decía «Darlo de alta», subrayado, y no hacía nada.
       La señal cambió de forma: sigue siendo la única en índigo y con filete de color. */
    const fondo = pinta(FONDO_DE_MUESTRA);
    const accion = pinta(ACCION_DE_MUESTRA);
    expect(fondo).toMatch(/ficha__fila--sin-pedir[^>]*>.*?Pendiente de alta/);
    expect(fondo).not.toContain("<u>");
    expect(fondo).not.toContain("Darlo de alta");
    // La acción no tiene ninguna ausencia que podamos ir a buscar.
    expect(accion).not.toContain("Pendiente de alta");
    const hoja = readFileSync(new URL("../src/styles/ficha.css", import.meta.url), "utf8");
    expect(hoja).toMatch(/\.ficha__fila--sin-pedir \.ficha__valor \{[^}]*--marca/);
  });

  test("un instrumento que dejó de cotizar se marca con la fecha, no con un adjetivo", () => {
    const html = pinta(BAJA_DE_MUESTRA);
    expect(html).toContain("ficha__disponibilidad--baja");
    expect(html).toContain("Dejó de cotizar");
    expect(html).toContain("21 sep 2026");
    // Y sigue ahí: no desaparece del catálogo.
    expect(html).toContain("ERCROS");
  });

  test("cada sección dice de quién es el dato y desde cuándo", () => {
    for (const ficha of [FONDO_DE_MUESTRA, ACCION_DE_MUESTRA, BAJA_DE_MUESTRA]) {
      for (const seccion of ficha.secciones) {
        const procedencia = seccion.procedencia.map((trozo) => trozo.texto).join("");
        expect(procedencia.trim().length, `${ficha.nombre} · ${seccion.titulo}`).toBeGreaterThan(0);
      }
    }
  });

  test("la glosa de una ausencia sale del dato, no de la interfaz", () => {
    /* Las frases que explican por qué un campo no aplica las guarda la base campo a
       campo en `quality/latest`. La ficha las enseña; no las redacta. */
    const sinCoste = ACCION_DE_MUESTRA.secciones
      .flatMap((seccion) => seccion.filas)
      .find((fila) => fila.rotulo === "SRI, de 1 a 7");
    expect(sinCoste?.ausencia).toBe("no-aplica");
    expect(sinCoste?.glosa).toContain("no existe para este producto");
    expect(pinta(ACCION_DE_MUESTRA)).toContain("no existe para este producto");
  });

  test("ninguna hoja declara un color en crudo para la ficha", () => {
    const hoja = readFileSync(new URL("../src/styles/ficha.css", import.meta.url), "utf8");
    const sinComentarios = hoja.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sinComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sinComentarios).not.toMatch(/\brgba?\(/);
  });
});
