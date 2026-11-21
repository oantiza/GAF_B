import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * Ningún papel lee la cartera completa del emisor de un ETF (decisión B-79 de Óscar, 11-11-2026; B-53).
 *
 * Revisada el 14-11-2026 («con respecto a los ETF, no los dejes fuera»): la cartera del emisor mide el solapamiento también en el informe
 * de cliente. Lo que no cambia, y es lo que vigila esta prueba, es **quién la lee**: ningún papel. El informe de cliente recibe su
 * solapamiento ya medido de la pantalla que lo pide (Análisis o Informes), y lo que imprime es la cifra, sin decir de quién es la cartera
 * (eso lo prueba `tests/informeDeClienteSeisHojas.test.ts`). Los demás papeles de cliente ni la reciben.
 *
 * Las reglas de Firestore no lo separan, porque el Modo cliente es la misma sesión del asesor: lo separa el código. Esta prueba recorre lo
 * que importa cada papel, y lo que importan sus importaciones, también las perezosas (`import("…")`), y falla si alguno alcanza el lector
 * (`adapters/carteraDelEmisor`) o la pieza que convierte su cartera (`core/carteraDelEmisor`). El único papel que nombra a esa pieza es
 * el informe interno, para escribir de quién es cada cartera, y tampoco lee: recibe lo que le dan las cargas de la pantalla.
 *
 * Y una segunda red, por si alguien escribe otro lector: solo el lector nombra la ruta `issuer_holdings` en un texto del código.
 */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(RAIZ, "src");

const LO_QUE_NO_SE_ALCANZA = ["adapters/carteraDelEmisor.ts", "core/carteraDelEmisor.ts"];

/** El único papel que la recibe: el informe completo del asesor, sus 4.1 y 4.2. */
const PAPEL_DEL_ASESOR = "reports/internalPortfolioReportPdf.tsx";

/** Los papeles de cliente que nombra la decisión, para que la prueba no se quede ciega si uno cambia de nombre. */
const PAPELES_DE_CLIENTE_NOMBRADOS = [
  "reports/informeDeClientePdf.tsx",
  "reports/comparePdf.tsx",
  "reports/costsPdf.tsx",
  "reports/propuestaDeCambioPdf.tsx",
  "reports/fichaDeActivoPdf.tsx",
  "reports/assetComparePdf.tsx",
  "reports/weeklyReportPdf.tsx"
];

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) ficherosDe(ruta, salida);
    else if (/\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const aClave = (ruta: string) => relative(SRC, ruta).replace(/\\/g, "/");

/** Lo que importa un fichero: `import … from`, `export … from` e `import("…")`, solo lo relativo, que es lo nuestro. */
function importacionesDe(contenido: string): string[] {
  const fuente = ts.createSourceFile("f.tsx", contenido, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) && nodo.moduleSpecifier && ts.isStringLiteral(nodo.moduleSpecifier)) {
      salida.push(nodo.moduleSpecifier.text);
    }
    if (ts.isCallExpression(nodo) && nodo.expression.kind === ts.SyntaxKind.ImportKeyword && nodo.arguments[0] && ts.isStringLiteralLike(nodo.arguments[0])) {
      salida.push(nodo.arguments[0].text);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return salida.filter((especificador) => especificador.startsWith("."));
}

function resolver(desde: string, especificador: string): string | null {
  const base = resolve(dirname(desde), especificador);
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidato) && statSync(candidato).isFile() && /\.tsx?$/.test(candidato)) return candidato;
  }
  return null;
}

const GRAFO = new Map<string, string[]>(
  ficherosDe(SRC).map((ruta) => [
    aClave(ruta),
    importacionesDe(readFileSync(ruta, "utf8"))
      .map((especificador) => resolver(ruta, especificador))
      .filter((destino): destino is string => destino !== null)
      .map(aClave)
  ])
);

/** El camino de `desde` a alguno de `destinos`, o `null`. Es lo que la prueba enseña cuando falla. */
function caminoHasta(desde: string, destinos: readonly string[]): string[] | null {
  const previo = new Map<string, string | null>([[desde, null]]);
  const cola = [desde];
  while (cola.length > 0) {
    const actual = cola.shift()!;
    if (destinos.includes(actual)) {
      const camino = [actual];
      for (let paso = previo.get(actual); paso; paso = previo.get(paso)) camino.unshift(paso);
      return camino;
    }
    for (const siguiente of GRAFO.get(actual) ?? []) {
      if (!previo.has(siguiente)) {
        previo.set(siguiente, actual);
        cola.push(siguiente);
      }
    }
  }
  return null;
}

const PAPELES = [...GRAFO.keys()].filter((clave) => clave.startsWith("reports/") && clave !== PAPEL_DEL_ASESOR).sort();

describe("ningún papel de cliente lee la cartera del emisor: el de cliente recibe su solapamiento ya medido (B-79, revisada el 14-11-2026)", () => {
  test("los papeles que nombra la decisión existen, y lo que no se alcanza también", () => {
    for (const papel of [...PAPELES_DE_CLIENTE_NOMBRADOS, PAPEL_DEL_ASESOR, ...LO_QUE_NO_SE_ALCANZA]) expect(GRAFO.has(papel), papel).toBe(true);
    for (const papel of PAPELES_DE_CLIENTE_NOMBRADOS) expect(PAPELES).toContain(papel);
  });

  test("el recorrido ve las importaciones, también las perezosas: si no, no protege", () => {
    /* La pantalla de Análisis la pide, y el informe de cliente se carga perezoso desde ella. */
    expect(caminoHasta("pages/XrayPage.tsx", LO_QUE_NO_SE_ALCANZA)).not.toBeNull();
    expect(GRAFO.get("pages/XrayPage.tsx")).toContain("reports/informeDeClientePdf.tsx");
    expect(caminoHasta("components/PortfolioReport.tsx", ["adapters/carteraDelEmisor.ts"])).not.toBeNull();
  });

  test.each(PAPELES)("%s no alcanza el lector ni su conversión", (papel) => {
    expect(caminoHasta(papel, LO_QUE_NO_SE_ALCANZA)).toBeNull();
  });

  /* La matriz de solapamiento volvió al informe de cliente el 12-11-2026. Si nadie le da el modelo, lo calcula con `core/reportOverlap` y
     la fuente del proveedor; desde el 14-11-2026 se lo dan Análisis e Informes, medido con las cargas de la pantalla. */
  test("el informe de cliente llega a la matriz de solapamiento, y por ella no llega a la cartera del emisor", () => {
    expect(caminoHasta("reports/informeDeClientePdf.tsx", ["core/reportOverlap.ts"])).not.toBeNull();
    expect(caminoHasta("core/reportOverlap.ts", LO_QUE_NO_SE_ALCANZA)).toBeNull();
    expect(caminoHasta("reports/informeDeClientePdf.tsx", LO_QUE_NO_SE_ALCANZA)).toBeNull();
  });

  /* Quien llama a las cargas es la pantalla, y la entrada del informe de cliente (`core/reportPipelineCliente`) es pura: no lee. */
  test("las dos puertas del informe de cliente miden el solapamiento con las cargas, y la entrada del informe no lee nada", () => {
    for (const puerta of ["pages/XrayPage.tsx", "components/PortfolioReport.tsx"]) {
      expect(GRAFO.get(puerta), puerta).toEqual(expect.arrayContaining(["adapters/carteraDelEmisor.ts", "core/reportOverlap.ts", "core/reportPipelineCliente.ts"]));
    }
    expect(caminoHasta("core/reportPipelineCliente.ts", LO_QUE_NO_SE_ALCANZA)).toBeNull();
  });

  test("el informe interno no lee: recibe la cartera de quien lo llama", () => {
    expect(caminoHasta(PAPEL_DEL_ASESOR, ["adapters/carteraDelEmisor.ts"])).toBeNull();
  });

  test("solo el lector escribe la ruta de la cartera del emisor", () => {
    const quienLaEscribe = [...GRAFO.keys()].filter((clave) => {
      const fuente = ts.createSourceFile("f.tsx", readFileSync(join(SRC, clave), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let escribe = false;
      const visitar = (nodo: ts.Node): void => {
        if ((ts.isStringLiteralLike(nodo) || ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) && /issuer_holdings/.test(nodo.text)) escribe = true;
        ts.forEachChild(nodo, visitar);
      };
      visitar(fuente);
      return escribe;
    });
    expect(quienLaEscribe).toEqual(["adapters/carteraDelEmisor.ts"]);
    /* Recorre todo el código con el analizador de TypeScript: sola tarda ~1,2 s, pero con la batería entera en marcha pasó de
       los 5 s por defecto (6,0 y 6,2 s) y fallaba sin que nada estuviera mal. Es holgura, no lo que comprueba. */
  }, 20_000);
});
