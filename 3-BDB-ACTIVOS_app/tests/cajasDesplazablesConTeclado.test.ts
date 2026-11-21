/**
 * Una caja que se desplaza de lado tiene que poder enfocarse (19-11-2026, apartado 14.7 del sistema de diseño).
 *
 * Donde una tabla no cabe, su envoltorio se desplaza (`overflow-x: auto`). Con ratón se arrastra; con teclado, si la
 * caja no se enfoca y dentro no hay nada que se enfoque, llegar a las columnas que quedan fuera depende de lo que haga
 * cada navegador: es la regla `scrollable-region-focusable` de axe-core, que el recorrido midió incumplida en la ficha
 * de un ETF y en Diseño → Simular, a 1.025 px. La pieza de tablas ya lo resolvía en su marco (`role="group"`, un nombre
 * y `tabIndex={0}`); de los envoltorios escritos a mano, diecisiete no: los siete de `.report-table-wrapper` y
 * `.ficha__rentabilidades`, nueve `.table-wrap` (la revisión de una importación, las tablas de un texto y seis de
 * Sistema → Operaciones) y el marco de la matriz de correlación de Análisis.
 *
 * Dos lecturas, y ninguna es la pantalla (happy-dom no dispone ni desplaza nada; lo pintado lo mide el recorrido):
 *
 *  - **Las hojas dicen qué cajas se desplazan.** Toda clase a la que una hoja da desplazamiento propio tiene que estar
 *    declarada abajo, en una de cuatro listas y con su razón. Una caja nueva con `overflow: auto` obliga a decidir.
 *  - **El código dice si se enfocan.** Se lee con el compilador de TypeScript, etiqueta a etiqueta: una clase escrita
 *    en una condición o en una plantilla se ve igual que una escrita a secas. Lo que no ve es una clase que llegue por
 *    una variable o por una propiedad; por eso la primera prueba cuenta los usos, fichero a fichero.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(APP, "src");

/** Se desplazan de lado y tienen que enfocarse ellas: su etiqueta lleva `tabIndex={0}`, un papel y un nombre. */
const SE_ENFOCAN: Record<string, string> = {
  "tabla__marco": "el marco de la pieza de tablas",
  "report-table-wrapper": "el envoltorio de una tabla de informe escrita a mano",
  "ficha__rentabilidades": "las rentabilidades por periodo del resumen de una ficha",
  "table-wrap": "el envoltorio de una tabla suelta",
  "gestor-tabla-envoltorio": "el envoltorio de una tabla de Carteras de clientes",
  "oaa-heatmap-scroll": "el marco de una matriz de Análisis"
};

/** El mismo elemento que una de las de arriba, con otra clase que también lleva el desplazamiento. */
const SON_EL_MISMO_ELEMENTO: Record<string, string> = {
  "tabla__marco--cabecera-fija": "tabla__marco",
  "retro-table-wrapper": "report-table-wrapper",
  "retro-preview-wrapper": "report-table-wrapper",
  "backfill-table-wrapper": "report-table-wrapper"
};

/** Se desplazan de lado y no les hace falta: llevan siempre dentro algo que se enfoca. */
const LLEVAN_DENTRO_LO_QUE_SE_ENFOCA: Record<string, string> = {
  "portfolio-table-wrapper":
    "la tabla de posiciones de Diseño: cada fila lleva sus dos campos y, en la última columna, que es la de acciones, su candado; enfocarlo trae a la vista hasta el borde derecho de la tabla. Vale porque los controles llegan a ese borde: en una tabla que los lleve solo en las primeras columnas no valdría",
  "ui-segmented": "un control segmentado: sus hijos son botones",
  "cmp-catalog-table-wrap": "el catálogo del Comparador: lleva dentro el marco de la pieza de tablas, que se enfoca",
  "buscador-nuevo": "el Buscador, que por debajo de 1.440 px se desplaza entero dentro de su marco: lleva dentro los filtros y el marco de la tabla"
};

/**
 * No se desplazan de lado. Tres de ellas se desplazan en vertical y no llevan nada que se enfoque: se vieron el
 * 19-11-2026 y se dejaron como estaban, porque lo aprobado ese día eran las cajas que se desplazan de lado (apartado
 * 14.7, «visto de paso»).
 */
const NO_SE_DESPLAZAN_DE_LADO: Record<string, string> = {
  "heatmap": "la rejilla de una matriz: `.corr-heatmap-grid`, que la acompaña siempre, le quita el desplazamiento; quien se desplaza es su marco, `.oaa-heatmap-scroll`",
  "code-block": "un bloque de código parte sus líneas (`white-space: pre-wrap`)",
  "rail-nav": "la lista del menú se desplaza en vertical, y sus hijos son enlaces",
  "ui-dialog-backdrop": "el fondo de un diálogo se desplaza en vertical, y el diálogo retiene el foco dentro",
  "ui-dialog__body": "el cuerpo de un diálogo se desplaza en vertical",
  "asset-picker-list": "la lista del selector de activos se desplaza en vertical, y sus filas son botones",
  "admin-json": "el resultado de la ingesta, en Sistema: en vertical y sin nada que se enfoque. Visto y sin tocar",
  "inspector-result-json": "la respuesta del inspector, en Sistema: en vertical y sin nada que se enfoque. Visto y sin tocar",
  "ops-log__body": "el registro de una tarea, en Sistema: en vertical y sin nada que se enfoque. Visto y sin tocar"
};

/** Un uso de una clase de `SE_ENFOCAN` que no necesita enfocarse, con su razón y con lo que la prueba. */
const EXCEPCIONES = [
  {
    clase: "oaa-heatmap-scroll",
    fichero: "src/charts/oaa/OaaOverlapHeatmap.tsx",
    razon: "las casillas de la matriz de solapamiento se enfocan: llevan un `tabIndex` que se mueve con las flechas",
    loPrueba: "tabIndex={rowIndex === filaEnfocada && columnIndex === columnaEnfocada ? 0 : -1}"
  }
];

function ficheros(carpeta: string, extension: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return ficheros(ruta, extension);
    return entrada.name.endsWith(extension) ? [ruta] : [];
  });
}

/** Las clases a las que alguna hoja da desplazamiento propio: `overflow`, `overflow-x` u `overflow-y` en `auto` o `scroll`. */
function clasesQueSeDesplazan(): string[] {
  const clases = new Set<string>();
  for (const ruta of ficheros(join(SRC, "styles"), ".css")) {
    const css = readFileSync(ruta, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const regla of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const desplaza = [...regla[2].matchAll(/(?:^|;)\s*overflow(?:-[xy])?\s*:\s*([^;]+)/g)].some((declaracion) => /\b(auto|scroll)\b/.test(declaracion[1]));
      if (!desplaza) continue;
      for (const selector of regla[1].split(",")) {
        /* Quien se desplaza es el último eslabón del selector: `.swap-dialog .tabla__marco` habla de `.tabla__marco`. */
        const ultimo = selector.trim().split(/[\s>+~]+/).pop() ?? "";
        for (const clase of ultimo.matchAll(/\.([\w-]+)/g)) clases.add(clase[1]);
      }
    }
  }
  return [...clases].sort();
}

interface Uso { fichero: string; clases: string[]; etiqueta: string; tabIndex: string | null; papel: string | null; nombre: string | null }

/** Los trozos de texto escritos dentro de una expresión: los de una cadena, una plantilla o una condición. */
function literalesDe(nodo: ts.Node): string[] {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return [nodo.text];
  if (ts.isTemplateExpression(nodo)) return [nodo.head.text, ...nodo.templateSpans.flatMap((tramo) => [...literalesDe(tramo.expression), tramo.literal.text])];
  const dentro: string[] = [];
  ts.forEachChild(nodo, (hijo) => void dentro.push(...literalesDe(hijo)));
  return dentro;
}

/** Cada etiqueta JSX de un fuente con sus clases y con lo que hace falta para enfocarla, leída con el compilador. */
function usosEn(fuente: string, fichero: string): Uso[] {
  const arbol = ts.createSourceFile(fichero, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const usos: Uso[] = [];
  /* El valor de un atributo tal como está escrito: el texto de una cadena, o la expresión de entre llaves. */
  const valorDe = (atributo: ts.JsxAttribute | undefined): string | null => {
    const valor = atributo?.initializer;
    if (!valor) return null;
    if (ts.isStringLiteral(valor)) return valor.text;
    return ts.isJsxExpression(valor) && valor.expression ? valor.expression.getText(arbol) : null;
  };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const atributos = new Map<string, ts.JsxAttribute>();
      for (const atributo of nodo.attributes.properties) if (ts.isJsxAttribute(atributo)) atributos.set(atributo.name.getText(arbol), atributo);
      const clase = atributos.get("className")?.initializer;
      if (clase) {
        usos.push({
          fichero,
          clases: literalesDe(clase).flatMap((trozo) => trozo.split(/\s+/)).filter(Boolean),
          etiqueta: nodo.getText(arbol).replace(/\s+/g, " ").slice(0, 160),
          tabIndex: valorDe(atributos.get("tabIndex")),
          papel: valorDe(atributos.get("role")),
          nombre: valorDe(atributos.get("aria-label")) ?? valorDe(atributos.get("aria-labelledby"))
        });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return usos;
}

/** Todos los usos de `src/`, de los ficheros que nombran alguna de esas clases. */
function usosDe(clases: readonly string[]): Uso[] {
  return ficheros(SRC, ".tsx").flatMap((ruta) => {
    const fuente = readFileSync(ruta, "utf8");
    if (!clases.some((clase) => fuente.includes(clase))) return [];
    return usosEn(fuente, relative(APP, ruta).replace(/\\/g, "/")).filter((uso) => uso.clases.some((clase) => clases.includes(clase)));
  });
}

const esExcepcion = (uso: Uso) => EXCEPCIONES.some((excepcion) => excepcion.fichero === uso.fichero && uso.clases.includes(excepcion.clase));
/** El nombre termina diciendo que la caja se desplaza, esté escrito en una cadena o en una plantilla. */
const diceQueSeDesplaza = (nombre: string | null) => /\((tabla|matriz) desplazable\)`?$/.test(nombre ?? "");

describe("las hojas dicen qué cajas se desplazan, y cada una está declarada con su razón", () => {
  const declaradas = { ...SE_ENFOCAN, ...SON_EL_MISMO_ELEMENTO, ...LLEVAN_DENTRO_LO_QUE_SE_ENFOCA, ...NO_SE_DESPLAZAN_DE_LADO };

  test("toda clase con desplazamiento propio está en una de las cuatro listas, y ninguna lista nombra una que ya no existe", () => {
    expect(clasesQueSeDesplazan()).toEqual(Object.keys(declaradas).sort());
    /* Ninguna está en dos listas a la vez. */
    const cuantas = Object.keys(SE_ENFOCAN).length + Object.keys(SON_EL_MISMO_ELEMENTO).length + Object.keys(LLEVAN_DENTRO_LO_QUE_SE_ENFOCA).length + Object.keys(NO_SE_DESPLAZAN_DE_LADO).length;
    expect(Object.keys(declaradas)).toHaveLength(cuantas);
    for (const [clase, razon] of Object.entries(declaradas)) expect(razon.length, clase).toBeGreaterThan(10);
  });

  test("la que es el mismo elemento que otra va siempre con ella", () => {
    for (const [clase, base] of Object.entries(SON_EL_MISMO_ELEMENTO)) {
      expect(SE_ENFOCAN[base], clase).toBeDefined();
      const usos = usosDe([clase]);
      expect(usos.length, clase).toBeGreaterThan(0);
      for (const uso of usos) expect(uso.clases, `${uso.fichero} · ${clase}`).toContain(base);
    }
  });

  test("la rejilla de una matriz va siempre con la clase que le quita el desplazamiento, y dentro de su marco", () => {
    const rejillas = usosDe(["heatmap"]);
    expect(rejillas.map((uso) => uso.fichero).sort()).toEqual(["src/charts/oaa/OaaCorrelationHeatmap.tsx", "src/charts/oaa/OaaOverlapHeatmap.tsx"]);
    for (const uso of rejillas) expect(uso.clases, uso.fichero).toContain("corr-heatmap-grid");
    const graficos = readFileSync(join(SRC, "styles", "charts.css"), "utf8");
    expect(graficos).toMatch(/\n\.corr-heatmap-grid \{[^}]*overflow-x: visible;/);
    /* Detrás de la regla de la rejilla, que con el mismo peso la pisaría. */
    expect(graficos.indexOf("\n.corr-heatmap-grid {")).toBeGreaterThan(graficos.indexOf("\n.heatmap {"));
  });
});

describe("las cajas que se desplazan de lado se alcanzan con el teclado", () => {
  const usos = usosDe(Object.keys(SE_ENFOCAN));
  const vigilados = usos.filter((uso) => !esExcepcion(uso));

  test("la prueba ve los envoltorios: los escritos a mano, los del Gestor, los dos marcos de la pieza y las dos matrices", () => {
    const porClase = (clase: string) => usos.filter((uso) => uso.clases.includes(clase)).map((uso) => uso.fichero).sort();
    expect(porClase("report-table-wrapper")).toEqual([
      "src/components/AdminBackfill.tsx",
      "src/components/AdminInspector.tsx",
      "src/components/AdminRetrocessions.tsx",
      "src/components/AdminRetrocessions.tsx",
      "src/components/AssetHoldingsSection.tsx",
      "src/components/MetricasComparativas.tsx"
    ]);
    expect(porClase("ficha__rentabilidades")).toEqual(["src/components/ficha/FichaInstrumento.tsx"]);
    expect(porClase("tabla__marco")).toEqual(["src/components/tabla/TablaComparativa.tsx", "src/components/tabla/TablaDeDatos.tsx"]);
    expect(porClase("gestor-tabla-envoltorio")).toEqual([
      "src/gestor/ui/analisis/BloqueMeses.tsx",
      "src/gestor/ui/comparar/TablaComparada.tsx",
      "src/gestor/ui/dialogos/DialogoDeVersiones.tsx",
      "src/gestor/ui/importar/PasoComprobacion.tsx",
      "src/gestor/ui/importar/PasoRevision.tsx"
    ]);
    expect(porClase("oaa-heatmap-scroll")).toEqual(["src/charts/oaa/OaaCorrelationHeatmap.tsx", "src/charts/oaa/OaaOverlapHeatmap.tsx"]);
    /* Las nueve `.table-wrap` que no se enfocaban, entre las seis que ya lo hacían. */
    const deTabla = porClase("table-wrap");
    expect(deTabla.filter((fichero) => fichero === "src/components/AdminOperaciones.tsx")).toHaveLength(6);
    expect(deTabla.filter((fichero) => fichero === "src/components/ImportReview.tsx")).toHaveLength(2);
    expect(deTabla).toContain("src/components/MarkdownView.tsx");
    expect(deTabla).toHaveLength(15);
    /* Con las dos lecturas a la vez no se escapa ninguno: son tantos como veces está escrita la clase en el código,
       fuera de los comentarios. Una clase que llegara por una variable descuadraría la cuenta. */
    const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const aSecas = ficheros(SRC, ".tsx").flatMap((ruta) => [...sinComentarios(readFileSync(ruta, "utf8")).matchAll(/(?<![\w-])(report-table-wrapper|ficha__rentabilidades|table-wrap|gestor-tabla-envoltorio|oaa-heatmap-scroll)(?![\w-])/g)]);
    expect(aSecas).toHaveLength(usos.filter((uso) => !uso.clases.includes("tabla__marco")).length);
  });

  test("cada uno se enfoca: `tabIndex={0}`", () => {
    expect(vigilados.filter((uso) => uso.tabIndex !== "0").map((uso) => `${uso.fichero} · ${uso.etiqueta}`)).toEqual([]);
  });

  test("y dice qué es, de una de dos formas: un grupo cuyo nombre acaba diciendo que se desplaza, o una región con nombre propio", () => {
    /* Las seis `.table-wrap` de antes del 19-11-2026 son regiones con el nombre de su tabla, y se quedan así. Las demás
       son grupos, como el marco de la pieza: un grupo no añade un punto de referencia a la página. */
    const mal = vigilados.filter((uso) => !(uso.papel === "group" && diceQueSeDesplaza(uso.nombre)) && !(uso.papel === "region" && Boolean(uso.nombre)));
    expect(mal.map((uso) => `${uso.fichero} · ${uso.etiqueta}`)).toEqual([]);
    const regiones = vigilados.filter((uso) => uso.papel === "region");
    expect(regiones.map((uso) => uso.fichero).sort()).toEqual([
      "src/components/CostsModal.tsx",
      "src/components/CostsModal.tsx",
      "src/components/EfectoDeLosCostes.tsx",
      "src/components/PortfolioImprovementPanel.tsx",
      "src/components/PortfolioImprovementPanel.tsx",
      "src/components/PortfolioImprovementPanel.tsx"
    ]);
    /* La matriz no es una tabla, y su nombre lo dice. */
    const matriz = vigilados.find((uso) => uso.clases.includes("oaa-heatmap-scroll"));
    expect(matriz?.nombre).toMatch(/\(matriz desplazable\)`$/);
  });

  test("cada excepción sigue siendo verdad: lo que la justifica está en su fichero", () => {
    for (const excepcion of EXCEPCIONES) {
      expect(usos.filter(esExcepcion).map((uso) => uso.fichero), excepcion.clase).toContain(excepcion.fichero);
      expect(readFileSync(join(APP, excepcion.fichero), "utf8"), excepcion.razon).toContain(excepcion.loPrueba);
    }
  });

  test("la tabla de posiciones de Diseño no lo necesita: cada fila lleva lo que se enfoca, hasta la última columna", () => {
    expect(usosDe(["portfolio-table-wrapper"]).map((uso) => uso.fichero)).toEqual(["src/components/PortfolioPositionsTable.tsx"]);
    const tabla = readFileSync(join(SRC, "components", "PortfolioPositionsTable.tsx"), "utf8");
    /* Cada fila lleva sus dos campos y su candado. */
    expect(tabla.match(/<EuroAmountInput/g)?.length).toBeGreaterThanOrEqual(2);
    expect(tabla).toContain('"portfolio-lock locked" : "portfolio-lock"');
    /* Y la última columna de la cabecera es la de acciones: lo que se enfoca llega al borde derecho. */
    const cabecera = tabla.slice(tabla.indexOf("<thead>"), tabla.indexOf("</thead>"));
    expect(cabecera.trimEnd().endsWith("</tr>")).toBe(true);
    expect(cabecera.slice(cabecera.lastIndexOf("<th"))).toContain('<span className="sr-only">Acciones</span>');
  });
});

describe("la lectura del código ve la clase se escriba como se escriba", () => {
  const leer = (jsx: string) => usosEn(`export const C = ({ n, ancha }: { n: number; ancha: boolean }) => (<>${jsx}</>);`, "sintetico.tsx").filter((uso) => uso.clases.includes("table-wrap"));

  test("con un genérico, otra etiqueta o una comparación delante de la clase, que confundían a la lectura a mano", () => {
    expect(leer('<div ref={useRef<HTMLDivElement>(null)} className="table-wrap" />')).toHaveLength(1);
    expect(leer('<Panel icon={<Icon />} className="table-wrap" />')).toHaveLength(1);
    expect(leer('<div hidden={n < 3} className="table-wrap" />')).toHaveLength(1);
  });

  test("con la clase dentro de una condición o de una plantilla, y con lo que hace falta para enfocarla", () => {
    expect(leer('<div className={n < 3 ? "table-wrap" : "otra"} />')).toHaveLength(1);
    const [enPlantilla] = leer('<div aria-label={`${n} (tabla desplazable)`} className={`caja ${ancha ? "table-wrap ancha" : ""}`} role="group" tabIndex={0} />');
    expect(enPlantilla).toMatchObject({ clases: ["caja", "table-wrap", "ancha"], tabIndex: "0", papel: "group", nombre: "`${n} (tabla desplazable)`" });
    expect(diceQueSeDesplaza(enPlantilla.nombre)).toBe(true);
    /* Un `tabIndex` que no es cero, o que no está, se ve como tal. */
    expect(leer('<div className="table-wrap" tabIndex={-1} />')[0].tabIndex).toBe("-1");
    expect(leer('<div className="table-wrap" />')[0]).toMatchObject({ tabIndex: null, papel: null, nombre: null });
  });

  test("y no cuenta una clase que solo está en un comentario o en un texto", () => {
    expect(leer('{/* el antiguo table-wrap */}<p className="nota">table-wrap</p>')).toEqual([]);
    /* Ni una clase que la lleve dentro de su nombre. */
    expect(leer('<div className="table-wrap-viejo" />')).toEqual([]);
  });
});
