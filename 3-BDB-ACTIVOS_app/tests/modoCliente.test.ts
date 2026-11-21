import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { SE_OCULTA, SE_QUEDA_SIEMPRE, seEnsena, type LoQueSeOculta } from "../src/core/modoCliente";

/**
 * Qué significa Modo cliente, recorriendo las pantallas (decisión 19 de Óscar, 04-11-2026).
 *
 * La definición es `src/core/modoCliente.ts`. Esta prueba lee el código de todas las pantallas con
 * el parser de TypeScript, mira qué textos pueden acabar a la vista y falla si una pantalla enseña
 * algo de la lista de lo que se oculta sin leer el modo. Así, **toda pantalla nueva nace
 * respetándolo**: nadie tiene que acordarse.
 *
 * Lo que mira es si la pantalla lee el modo, no si lo aplica bien: para eso están las pruebas de
 * cada pantalla (`clientModeReport`, `posicionesModoCliente`, `marcoModoCliente`). Es una red, no
 * una demostración, y deja de cazar lo que una pantalla pinte con un texto que venga del dato.
 */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) ficherosDe(ruta, salida);
    else salida.push(ruta);
  }
  return salida;
}

/** Las pantallas: todo lo que pinta, menos el papel, que tiene su propia regla. */
const PANTALLAS = [
  ...ficherosDe(join(RAIZ, "src", "pages")),
  ...ficherosDe(join(RAIZ, "src", "components")),
  ...ficherosDe(join(RAIZ, "src", "app")),
  /* GES-08: el Gestor de carteras también es una pantalla (sus informes en papel no: son `src/gestor/informes`). */
  ...ficherosDe(join(RAIZ, "src", "gestor", "ui")),
  ...ficherosDe(join(RAIZ, "src", "adapters")).filter((ruta) => /[\\/](componer\w*|tablaDe\w*)\.tsx?$/.test(ruta))
]
  .filter((ruta) => /\.tsx?$/.test(ruta))
  .map((ruta) => relative(join(RAIZ, "src"), ruta).replace(/\\/g, "/"))
  .sort();

/**
 * Cómo se reconoce en el código lo que se oculta. Lo que no sale como un texto de la pantalla
 * (el correo, que es un dato; el proveedor de Estrategia, que también) no tiene señal: lo vigila la
 * prueba de quien lo pinta.
 */
const SENALES: Partial<Record<LoQueSeOculta, RegExp>> = {
  retrocesiones: /retroces/i,
  ingresos: /ingreso (estimado|identificado)|\bcesi[oó]n/i,
  fuenteDeDatos: /fuente de datos|fuente activa/i,
  calidadInterna: /calidad de(l)? datos?/i,
  sinPedir: /sin pedir|pendiente de incorporar/i,
  procedenciaYCalidad: /procedencia y calidad/i,
  documentosInternos: /propuesta de mejora|exportar propuesta|informe interno|informe del asesor/i,
  historial: /historial/i,
  posicionesGlobales: /posiciones globales/i,
  publicarEstrategia: /publicar el de hoy/i
};

/** Atributos cuyo valor es para el código, no para quien mira. */
const ATRIBUTOS_DEL_CODIGO = /^(className|\w+ClassName|claseDelCuerpo|id|\w+Id|idPrefix|key|type|htmlFor|role|name|value|ref|d|viewBox|fill|stroke)$/;
const PROPIEDADES_DEL_CODIGO = new Set(["id", "key", "kind", "type", "tone", "clave", "className"]);

function textosVisibles(contenido: string): string[] {
  const fuente = ts.createSourceFile("pantalla.tsx", contenido, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textos: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo) || ts.isTypeNode(nodo) || ts.isInterfaceDeclaration(nodo) || ts.isTypeAliasDeclaration(nodo)) return;
    if (ts.isJsxAttribute(nodo) && ATRIBUTOS_DEL_CODIGO.test(nodo.name.getText())) return;
    if (ts.isPropertyAssignment(nodo) && PROPIEDADES_DEL_CODIGO.has(nodo.name.getText())) return;
    if (ts.isCaseClause(nodo)) {
      nodo.statements.forEach(visitar);
      return;
    }
    if (ts.isBinaryExpression(nodo)) {
      const operador = nodo.operatorToken.kind;
      const compara = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken
      ].includes(operador);
      if (compara) return;
    }
    if (ts.isJsxText(nodo)) textos.push(nodo.text.trim());
    else if (ts.isStringLiteralLike(nodo)) textos.push(nodo.text.trim());
    else if (ts.isTemplateExpression(nodo)) {
      textos.push(nodo.head.text.trim());
      nodo.templateSpans.forEach((tramo) => textos.push(tramo.literal.text.trim()));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return textos.filter(Boolean);
}

function leeElModo(contenido: string): boolean {
  return /\b(useClientMode|useModoCliente|clientMode|modoCliente|seEnsena)\b/.test(contenido);
}

/** Lo que esta prueba ve en un fichero: qué enseña de la lista sin leer el modo. */
function loQueEnsenaSinLeerElModo(contenido: string): LoQueSeOculta[] {
  if (leeElModo(contenido)) return [];
  const textos = textosVisibles(contenido);
  return (Object.entries(SENALES) as [LoQueSeOculta, RegExp][])
    .filter(([, senal]) => textos.some((texto) => senal.test(texto)))
    .map(([nombre]) => nombre);
}

const fuenteDe = (ruta: string) => readFileSync(join(RAIZ, "src", ruta), "utf8");

/**
 * Las pantallas a las que no se llega en Modo cliente. Sistema y Salud del catálogo se cierran en
 * `BdbActivosApp` (también por dirección directa), y esto es lo que cuelga de ellas.
 */
const DETRAS_DE_LA_PUERTA = new Set([
  "pages/AdminPage.tsx",
  "pages/SaludDelCatalogoPage.tsx",
  "pages/SystemStatusPage.tsx",
  "components/AdminBackfill.tsx",
  "components/AdminFundQuality.tsx",
  "components/AdminInspector.tsx",
  "components/AdminOperaciones.tsx",
  "components/AdminProgress.tsx",
  "components/AdminRetrocessions.tsx",
  "components/EstadoDelCatalogoPanel.tsx",
  "adapters/componerEstado.ts",
  "adapters/componerSalud.ts"
]);

/** Piezas que no leen el modo porque se lo dice quien las monta. La prueba comprueba que quien las
    monta lo lee. */
const LO_APLICA_QUIEN_LA_MONTA: Record<string, string> = {
  "adapters/tablaDePosiciones.tsx": "components/PositionsWorkbench.tsx",
  "components/PortfolioReportWarnings.tsx": "pages/XrayPage.tsx"
};

/**
 * LO QUE FALTA. Las pantallas que aún enseñan algo de la lista sin leer el modo, con el lote que las
 * hace. **Esta lista solo puede bajar**: una pantalla nueva no entra aquí, y al aplicar el modo en
 * una de estas se borra su línea, o la prueba falla diciendo que ya no hace falta.
 */
const PENDIENTES: Record<string, string> = {
};

describe("las dos listas de Modo cliente", () => {
  test("cada entrada dice por qué está", () => {
    for (const [que, motivo] of [...Object.entries(SE_OCULTA), ...Object.entries(SE_QUEDA_SIEMPRE)]) {
      expect(motivo.length, que).toBeGreaterThan(20);
    }
  });

  test("nada está en las dos: lo que se queda siempre no se puede ocultar", () => {
    const ocultas = new Set(Object.keys(SE_OCULTA));
    expect(Object.keys(SE_QUEDA_SIEMPRE).filter((que) => ocultas.has(que))).toEqual([]);
  });

  test("escribe lo que se decidió", () => {
    expect(Object.keys(SE_OCULTA)).toEqual(
      expect.arrayContaining([
        "retrocesiones",
        "ingresos",
        "fuenteDeDatos",
        "calidadInterna",
        "sinPedir",
        "procedenciaYCalidad",
        "otrasCarteras",
        "historial",
        "posicionesGlobales",
        "correoYSeguridad",
        "publicarEstrategia",
        "proveedorDeEstrategia"
      ])
    );
    const queda = Object.values(SE_QUEDA_SIEMPRE).join(" ");
    for (const frase of [
      "Calculado sobre el X % de la cartera",
      "Simulación: no es una recomendación",
      "Falta el dato"
    ]) {
      expect(queda).toContain(frase);
    }
  });

  test("dice que no es una frontera de seguridad", () => {
    expect(readFileSync(join(RAIZ, "src", "core", "modoCliente.ts"), "utf8")).toMatch(/NO es una frontera de seguridad/);
  });

  test("con el modo apagado se enseña todo, y encendido no se enseña nada de la lista", () => {
    for (const que of Object.keys(SE_OCULTA) as LoQueSeOculta[]) {
      expect(seEnsena(que, false)).toBe(true);
      expect(seEnsena(que, true)).toBe(false);
    }
  });
});

describe("el recorrido por las pantallas", () => {
  const hallazgos = PANTALLAS.flatMap((ruta) => {
    if (DETRAS_DE_LA_PUERTA.has(ruta) || ruta in LO_APLICA_QUIEN_LA_MONTA) return [];
    const que = loQueEnsenaSinLeerElModo(fuenteDe(ruta));
    return que.length > 0 ? [{ ruta, que }] : [];
  });

  test("hay pantallas que recorrer, y la señal las encuentra", () => {
    expect(PANTALLAS.length).toBeGreaterThan(50);
    /* Si esto falla, es la prueba la que se ha quedado ciega, no las pantallas las que se han
       arreglado: una pantalla que SÍ lee el modo tiene que seguir saliendo como que dice el texto. */
    expect(textosVisibles(fuenteDe("components/PositionsWorkbench.tsx")).some((texto) => SENALES.retrocesiones!.test(texto))).toBe(true);
  });

  test("ninguna pantalla enseña lo de la lista sin leer el modo", () => {
    const sinPermiso = hallazgos.filter(({ ruta }) => !(ruta in PENDIENTES));
    expect(sinPermiso, "Estas pantallas enseñan algo de src/core/modoCliente.ts sin leer el modo: usa useModoCliente").toEqual([]);
  });

  test("la lista de pendientes solo baja: lo que ya no hace falta se borra", () => {
    const vivas = new Set(hallazgos.map(({ ruta }) => ruta));
    expect(Object.keys(PENDIENTES).filter((ruta) => !vivas.has(ruta))).toEqual([]);
  });

  test("las pantallas de las listas existen de verdad", () => {
    for (const ruta of [...DETRAS_DE_LA_PUERTA, ...Object.keys(LO_APLICA_QUIEN_LA_MONTA)]) {
      expect(PANTALLAS, ruta).toContain(ruta);
    }
  });

  test("quien monta una pieza que no lee el modo, lo lee", () => {
    for (const [pieza, quien] of Object.entries(LO_APLICA_QUIEN_LA_MONTA)) {
      expect(leeElModo(fuenteDe(quien)), `${quien}, que monta ${pieza}`).toBe(true);
    }
  });

  /* Sin esto, un fallo de la propia prueba pasaría por «todo correcto». */
  test.each([
    ["el texto de una celda", "export const X = () => <td>Retrocesión 0,50 %</td>;", ["retrocesiones"]],
    ["el título de una columna", 'export const C = [{ id: "r", titulo: "Retrocesión" }];', ["retrocesiones"]],
    ["una propiedad de una pieza", 'export const X = () => <Panel titulo="Historial de análisis" />;', ["historial"]],
    ["una frase con una expresión", "export const X = (n: number) => `Publicar el de hoy: ${n}`;", ["publicarEstrategia"]],
    ["el informe del asesor del gestor", 'export const D = [{ id: "asesor", nombre: "Informe del asesor" }];', ["documentosInternos"]]
  ])("caza una pantalla nueva que enseña %s", (_que, codigo, esperado) => {
    expect(loQueEnsenaSinLeerElModo(codigo)).toEqual(esperado);
  });

  test.each([
    ["una pantalla que lee el modo", 'const { seEnsena } = useModoCliente(); export const X = () => seEnsena("retrocesiones") ? <td>Retrocesión</td> : null;'],
    ["el nombre de una pestaña, que es código", 'export const X = (s: string) => s === "retrocesiones" ? 1 : 2;'],
    ["un `id`, que es código", 'export const C = [{ id: "retrocesiones" }];'],
    ["un comentario", "/* Retrocesión */ export const X = 1;"],
    ["un fichero importado", 'import { x } from "./retrocesiones"; export const X = x;']
  ])("no molesta a %s", (_que, codigo) => {
    expect(loQueEnsenaSinLeerElModo(codigo)).toEqual([]);
  });
});
