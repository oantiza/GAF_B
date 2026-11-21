/**
 * Los títulos de un documento Markdown dentro de la aplicación (14-11-2026).
 *
 * El informe de estrategia lo escribe un modelo con todas sus secciones en `###`. El visor bajaba cada nivel del
 * documento tres escalones fijos, así que esas secciones salían como `h6`: en pantalla, a dos tercios del tamaño del
 * texto que encabezaban (9 px bajo párrafos de 14), y en el esquema, un salto del título del bloque a un sexto nivel.
 * Ahora el título más alto del documento toma el nivel que se le pide y los demás bajan de uno en uno.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MarkdownView } from "../src/components/MarkdownView";

/** Los encabezados que salen, en orden: «h3 Título». */
function encabezados(markdown: string, nivel?: 2 | 3 | 4): string[] {
  const html = renderToStaticMarkup(<MarkdownView nivel={nivel}>{markdown}</MarkdownView>);
  return [...html.matchAll(/<(h[1-6])[^>]*>(.*?)<\/\1>/g)].map((hallado) => `${hallado[1]} ${hallado[2]}`);
}

const INFORME = "### Cierre y lectura de la sesión\n\nUno.\n\n### Datos y bancos centrales\n\nDos.\n\n### Agenda y riesgos\n\nTres.";

describe("el título más alto del documento toma el nivel pedido", () => {
  test("un informe escrito todo con ### queda en h3 dentro de un bloque, no en h6", () => {
    expect(encabezados(INFORME, 3)).toEqual(["h3 Cierre y lectura de la sesión", "h3 Datos y bancos centrales", "h3 Agenda y riesgos"]);
  });

  test("lo mismo con el nivel por defecto: h2, bajo el título de la página", () => {
    expect(encabezados(INFORME)).toEqual(["h2 Cierre y lectura de la sesión", "h2 Datos y bancos centrales", "h2 Agenda y riesgos"]);
  });

  test("un documento que empieza en # no cambia: # toma el nivel y ## el siguiente", () => {
    expect(encabezados("# Título\n\n## Sección\n\n### Apartado\n\nTexto.", 3)).toEqual(["h3 Título", "h4 Sección", "h5 Apartado"]);
  });

  test("los niveles de debajo bajan de uno en uno desde el más alto que haya", () => {
    expect(encabezados("### Sección\n\n#### Apartado\n\n##### Detalle\n\n### Otra sección", 3)).toEqual(["h3 Sección", "h4 Apartado", "h5 Detalle", "h3 Otra sección"]);
  });

  test("ningún título pasa de h6 ni queda por encima del nivel pedido", () => {
    const todos = encabezados("# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F", 4);
    expect(todos).toEqual(["h4 A", "h5 B", "h6 C", "h6 D", "h6 E", "h6 F"]);
  });

  test("una almohadilla dentro de un bloque de código no es un título ni cuenta como el más alto", () => {
    expect(encabezados("```\n# esto es código\n```\n\n### Sección\n\nTexto.", 3)).toEqual(["h3 Sección"]);
  });

  test("un título subrayado (===) cuenta como el más alto", () => {
    expect(encabezados("Título\n======\n\n### Apartado", 3)).toEqual(["h3 Título", "h5 Apartado"]);
  });

  test("un documento sin títulos se pinta igual", () => {
    expect(encabezados("Solo un párrafo, con **negrita**.", 3)).toEqual([]);
  });
});

describe("la hoja", () => {
  const leer = (hoja: string) => readFileSync(path.resolve(process.cwd(), "src/styles", hoja), "utf8").replaceAll("\r\n", "\n");
  const piezas = leer("components.css");
  const modulos = leer("modules.css");
  /** El cuerpo de la regla cuyo selector es exactamente `selector`. */
  const regla = (hoja: string, selector: string) => {
    const hallada = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(hoja);
    expect(hallada, `la regla ${selector}`).not.toBeNull();
    return hallada![1];
  };

  test("un título de prosa nunca es más pequeño que su texto: h5 y h6 llevan el tamaño del texto base", () => {
    expect(regla(piezas, ".prose h4,\n.prose h5,\n.prose h6")).toContain("font-size: var(--texto-md)");
  });

  test("en el informe de estrategia, «Riesgos de cola» y las fuentes miden lo que las secciones del texto", () => {
    const seccionDelTexto = /font-size: (var\(--[\w-]+\))/.exec(regla(piezas, ".prose h3"))![1];
    expect(regla(modulos, ".strategy-tail-risk > h3")).toContain(`font-size: ${seccionDelTexto}`);
    expect(regla(modulos, ".strategy-sources h3")).toContain(`font-size: ${seccionDelTexto}`);
  });

  test("el texto, los riesgos y las fuentes del informe van en pila, con aire entre ellos", () => {
    const documento = regla(modulos, ".strategy-document");
    expect(documento).toContain("flex-direction: column");
    expect(documento).toMatch(/gap: var\(--s-\d+\)/);
  });

  /* Las fuentes son una lista de enlaces sueltos, uno por línea. Medían 15 px de alto, pegados unos a otros: con el
     dedo se da al de al lado (WCAG 2.5.8, 24 px). Lo midió axe al abrir el recorrido esta vista por primera vez. */
  test("cada fuente del informe se puede tocar con el dedo: su enlace mide al menos 24 px de alto", () => {
    const enlace = regla(modulos, ".strategy-sources li a");
    const alto = /min-height: var\((--[\w-]+)\)/.exec(enlace);
    expect(alto, "el enlace declara su alto mínimo con un token").not.toBeNull();
    const valor = new RegExp(`${alto![1]}: (\\d+)px`).exec(leer("tokens.css"));
    expect(valor, `el token ${alto![1]} está en píxeles`).not.toBeNull();
    expect(Number(valor![1])).toBeGreaterThanOrEqual(24);
    expect(enlace).toContain("display: inline-block");
  });
});

/*
 * La tabla de un texto puede no caber: su caja se desplaza de lado, se enfoca y dice qué es (19-11-2026, apartado 14.7
 * del sistema). Un informe lleva varias, y cada caja se llama distinto: van numeradas, en su orden.
 */
describe("las tablas de un texto: cada una en su caja, que se enfoca y lleva su número", () => {
  const TABLA = "| Clase | Peso |\n|---|---|\n| Renta fija | 30 % |";
  /** Los atributos de la caja de cada tabla, en el orden en que salen. */
  const cajas = (markdown: string) =>
    [...renderToStaticMarkup(<MarkdownView>{markdown}</MarkdownView>).matchAll(/<div ([^>]*class="table-wrap"[^>]*)>/g)].map((hallada) =>
      Object.fromEntries([...hallada[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, nombre, valor]) => [nombre, valor]))
    );

  test("una sola tabla es la 1; con varias, cada caja lleva su número y ninguna se llama igual", () => {
    expect(cajas(TABLA)).toEqual([{ "aria-label": "Tabla 1 del texto (tabla desplazable)", class: "table-wrap", role: "group", tabindex: "0" }]);
    const tres = cajas(`Uno.\n\n${TABLA}\n\n### Otra sección\n\n${TABLA}\n\nFin.\n\n${TABLA}`);
    expect(tres.map((caja) => caja["aria-label"])).toEqual(["Tabla 1 del texto (tabla desplazable)", "Tabla 2 del texto (tabla desplazable)", "Tabla 3 del texto (tabla desplazable)"]);
  });

  test("cada documento empieza a contar de nuevo, y un texto sin tablas no lleva ninguna caja", () => {
    expect(cajas(`${TABLA}\n\nDos.\n\n${TABLA}`).map((caja) => caja["aria-label"])).toEqual(["Tabla 1 del texto (tabla desplazable)", "Tabla 2 del texto (tabla desplazable)"]);
    expect(cajas(TABLA).map((caja) => caja["aria-label"])).toEqual(["Tabla 1 del texto (tabla desplazable)"]);
    expect(cajas("Solo un párrafo.")).toEqual([]);
  });

  test("la tabla va dentro de su caja, y el número no le llega como atributo", () => {
    expect(renderToStaticMarkup(<MarkdownView>{TABLA}</MarkdownView>)).toMatch(/<div [^>]*class="table-wrap"[^>]*><table><thead>/);
  });
});
