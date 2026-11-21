// Detección de CSS muerto para D3.1: clases definidas en CSS nunca referenciadas
// desde src/**/*.{ts,tsx} ni index.html, y tokens --x definidos y nunca consumidos.
//
// Es una PUERTA (14-10-2026): sale con código 1 ante cualquier clase muerta sin
// prefijo dinámico, cualquier token huérfano, (16-10) cualquier var(--x) usado
// sin declarar o (04-11) cualquier clase escrita en una pantalla sin regla en ninguna
// hoja, y corre dentro de `npm test` (tests/deadCssCensus.test.ts), así que la suite
// falla con una clase muerta.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import ts from "typescript";
import { CLASES_SIN_REGLA_PERMITIDAS } from "./clasesSinReglaPermitidas.mjs";

// Ola 1 (03-09-2026): la raíz era una ruta absoluta del entorno de auditoría
// del 25-08, así que el censo no corría en ninguna otra máquina. Ahora es el
// directorio del proyecto (o CSS_AUDIT_ROOT si se quiere apuntar a otro árbol).
const ROOT = process.env.CSS_AUDIT_ROOT ?? process.cwd();
const CSS_FILES = [
  "src/styles/tokens.css",
  "src/styles/base.css",
  "src/styles/layout.css",
  "src/styles/components.css",
  "src/styles/charts.css",
  "src/styles/modules.css",
  /* La ficha del redisenio (02-11-2026). Entra aqui el mismo dia que nace: una hoja
     fuera del censo es una hoja donde los estilos muertos no los ve nadie. */
  "src/styles/ficha.css",
  "src/styles/tabla.css",
  "src/styles/impresion.css",
  /* Jubilacion (13-11-2026): nace dentro del censo, como la ficha. */
  "src/styles/jubilacion.css",
  /* Planes y EPSV (13-11-2026): igual. */
  "src/styles/planes.css",
  /* Gestor de carteras (13-11-2026): igual. Sus tres hojas: la base, la del análisis y la de los diálogos. */
  "src/styles/gestor.css",
  "src/styles/gestor-analisis.css",
  "src/styles/gestor-dialogos.css",
  /* Propuestas, Diseño y Guardadas (14-11-2026): nace dentro del censo. */
  "src/styles/diseno.css",
  /* Mercado, Posiciones, Datos y Análisis (14-11-2026): igual, una hoja por sección. */
  "src/styles/mercado.css",
  "src/styles/posiciones.css",
  "src/styles/datos.css",
  "src/styles/analisis.css",
  /* El Comparador, pestañas Propuestas y Patrimonial (14-11-2026): igual. */
  "src/styles/comparador.css",
  "src/index.css"
].filter(p => { try { statSync(join(ROOT, p)); return true; } catch { return false; } });

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (!/node_modules|dist|\.git/.test(e)) walk(rel, out); }
    else out.push(rel);
  }
  return out;
}

// corpus de uso: todo ts/tsx/html/js del código de la app (no los propios css)
const srcFiles = walk("src").filter(f => [".ts", ".tsx"].includes(extname(f)));
srcFiles.push("index.html");
const corpus = srcFiles.map(f => readFileSync(join(ROOT, f), "utf8")).join("\n");

// patrones dinámicos `algo-${...}` presentes en el código (para no matar clases construidas)
const dynPrefixes = new Set();
// Ola 4: el prefijo puede ir tras un espacio dentro de la cadena
// (`backfill-outcome backfill-outcome--${tone}`), no solo tras la comilla.
for (const m of corpus.matchAll(/["'`\s]([A-Za-z][\w-]*[-_])\$\{/g)) dynPrefixes.add(m[1]);

// extraer clases por fichero css
const classRe = /\.(-?[A-Za-z_][\w-]*)/g;
const perFile = {};
const defined = new Map(); // class -> Set(files)
for (const f of CSS_FILES) {
  const css = readFileSync(join(ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // solo la parte de selectores: quitar cuerpos {...} de forma tosca
  const selectors = css.replace(/\{[^{}]*\}/g, "{}");
  const set = new Set();
  for (const m of selectors.matchAll(classRe)) {
    const name = m[1];
    if (/^\d/.test(name)) continue;
    set.add(name);
    if (!defined.has(name)) defined.set(name, new Set());
    defined.get(name).add(f);
  }
  perFile[f] = set;
}

// Lista blanca de clases que NO genera nuestro código sino una librería: las
// reglas de charts.css las afinan, pero ningún .tsx las escribe. Auditoría
// 14-10: el censo marcaba como muertas las diez .recharts-* (las pinta Recharts).
const LIBRARY_CLASS_PREFIXES = ["recharts-"];

// Lo que puede nombrar una clase: las palabras enteras de las cadenas del código, leídas con el parser.
// Hasta el 05-11-2026 se buscaba la subcadena en todo el texto, comentarios incluidos, así que `.toolbar` vivía de
// `ui-action-toolbar`, `.dot` de `cmp-legend-dot`, `.input` de `ops-input-row` y `.page` de `ui-page-header`, y el
// censo informaba de cero. Quedan fuera los atributos que nunca llevan una clase: `role="toolbar"` no es una.
const ATRIBUTOS_SIN_CLASE = /^(?:role|type|id|htmlFor|name|key|href|src|alt|title|placeholder|lang|autoComplete|inputMode|method|target|rel|scope|viewBox|d|fill|stroke\w*|aria-.*|data-.*|label|ariaLabel)$/;
const palabrasDeLasCadenas = new Set();
const anotarPalabras = (texto) => {
  for (const palabra of texto.split(/[^\w-]+/)) if (palabra) palabrasDeLasCadenas.add(palabra);
};
for (const fichero of srcFiles) {
  const texto = readFileSync(join(ROOT, fichero), "utf8");
  if (fichero.endsWith(".html")) {
    for (const m of texto.matchAll(/class="([^"]*)"/g)) anotarPalabras(m[1]);
    continue;
  }
  const fuente = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, extname(fichero) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visitar = (nodo) => {
    if (ts.isJsxAttribute(nodo) && ATRIBUTOS_SIN_CLASE.test(nodo.name.getText())) return;
    if (ts.isStringLiteralLike(nodo)) anotarPalabras(nodo.text);
    else if (ts.isTemplateExpression(nodo)) {
      anotarPalabras(nodo.head.text);
      nodo.templateSpans.forEach((tramo) => anotarPalabras(tramo.literal.text));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
}

const dead = [];
const libraryClasses = [];
for (const [name, files] of [...defined.entries()].sort()) {
  if (palabrasDeLasCadenas.has(name)) continue; // la nombra alguna cadena del código
  if (LIBRARY_CLASS_PREFIXES.some(p => name.startsWith(p))) { libraryClasses.push(name); continue; }
  const dyn = [...dynPrefixes].some(p => name.startsWith(p));
  dead.push({ name, files: [...files], dynRisk: dyn });
}

// tokens huérfanos: definidos --x: en cualquier css o inline, nunca var(--x
const tokenDefs = new Map();
for (const f of CSS_FILES) {
  const css = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Solo declaraciones (`--x:` al inicio de línea o tras `;`/`{`): un selector como
  // `.ui-button--danger:hover` no es un token.
  for (const m of css.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/gm)) {
    if (!tokenDefs.has(m[1])) tokenDefs.set(m[1], new Set());
    tokenDefs.get(m[1]).add(f);
  }
}
const allCss = CSS_FILES.map(f => readFileSync(join(ROOT, f), "utf8")).join("\n");
const usageBlob = allCss + "\n" + corpus;

// Tokens canónicos que la pantalla consume a través del espejo theme.ts:
// Recharts no resuelve var() en todos los atributos SVG, así que CHART_PALETTE
// copia --serie-1..6 y --serie-referencia, y varias no tienen var() propio. No son
// huérfanas mientras su VALOR siga en theme.ts; si el valor ya no está, el espejo se
// ha roto y sí cuentan (tests/themeTokensMirror.test.ts comprueba valor y orden).
// --chart-reference (16-10) es el trazo de referencia que Recharts toma de
// OAA_COLORS.textMuted: mismo caso.
const THEME_MIRROR_TOKENS = /^--(?:serie-\d+|serie-referencia|chart-reference)$/;

// Tokens del sistema aprobado (docs/frontend/SISTEMA_DISENO.md, §4) que ninguna hoja usa todavía
// y que no se pueden quitar porque una prueba los mide: --sube-suave es la casilla de un mes que gana,
// y tests/contrastePaleta.test.ts mide el verde sobre ella (paso 1 del rediseño, 14-11-2026). La lista
// no crece sin esa razón, y un token que ya tiene uso se borra de aquí: el censo lo da por caducado
// (así salió --aviso-suave cuando la pieza Aviso empezó a usarlo).
const TOKENS_RESERVADOS = new Set([]);
const themeTs = (() => {
  try { return readFileSync(join(ROOT, "src/core/theme.ts"), "utf8").toLowerCase(); } catch { return ""; }
})();
const tokenValue = (tok) => {
  const match = new RegExp(`${tok}\\s*:\\s*([^;]+);`).exec(allCss.replace(/\/\*[\s\S]*?\*\//g, ""));
  return match ? match[1].trim().toLowerCase() : null;
};

const orphanTokens = [];
const mirroredTokens = [];
const reservasCaducadas = [];
for (const [tok, files] of [...tokenDefs.entries()].sort()) {
  const uses = (usageBlob.match(new RegExp(`var\\(\\s*${tok}(?![\\w-])`, "g")) || []).length
    + (corpus.match(new RegExp(`["'\`]${tok}["'\`]`, "g")) || []).length
    + (corpus.match(new RegExp(`getPropertyValue\\([^)]*${tok}`, "g")) || []).length;
  if (TOKENS_RESERVADOS.has(tok) && !process.env.CSS_AUDIT_ROOT) {
    if (uses > 0) reservasCaducadas.push(tok);
    continue;
  }
  if (uses > 0) continue;
  const value = THEME_MIRROR_TOKENS.test(tok) ? tokenValue(tok) : null;
  if (value && themeTs.includes(`"${value}"`)) { mirroredTokens.push(tok); continue; }
  orphanTokens.push({ tok, files: [...files] });
}

// Puerta inversa (auditoría 16-10-2026): todo var(--x) usado ha de estar
// declarado. Un var() sin declarar invalida la propiedad en tiempo de cálculo y
// no avisa: así pasaron --border y --muted (filete ausente, tinta primaria en vez
// de secundaria). Cuenta como declaración, para todo el proyecto, un `--x:` de
// las hojas, una propiedad en línea del TSX (`style={{ "--corr-n": n }}`) o un
// `setProperty("--x"`. Un `--x:` dentro de una plantilla de texto (un HTML que
// lleve su propio :root) solo vale para los var() de ese mismo fichero. Un var()
// con valor de reserva (`var(--x, 0)`) también cuenta: la reserva tapa el error
// pero no lo arregla.
const corpusDefs = new Set();
for (const m of corpus.matchAll(/["'`](--[\w-]+)["'`]\s*:/g)) corpusDefs.add(m[1]);
for (const m of corpus.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) corpusDefs.add(m[1]);
const undefinedTokens = new Map(); // token -> Set(fichero)
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const usageSources = [
  ...CSS_FILES.map(f => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]),
  // En TS/TSX se descartan las líneas de comentario (`// …`, ` * …`): la
  // documentación cita `var(--token)` como ejemplo.
  ...srcFiles.map(f => [f, readFileSync(join(ROOT, f), "utf8").replace(/^\s*(?:\/\/|\/?\*).*$/gm, "")])
];
for (const [file, text] of usageSources) {
  const localDefs = CSS_FILES.includes(file)
    ? new Set()
    : new Set([...text.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/gm)].map(m => m[1]));
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const tok = m[1];
    if (tokenDefs.has(tok) || corpusDefs.has(tok) || localDefs.has(tok)) continue;
    if (!undefinedTokens.has(tok)) undefinedTokens.set(tok, new Set());
    undefinedTokens.get(tok).add(file.replace(/\\/g, "/"));
  }
}

// Puerta inversa de clases (04-11-2026): toda clase que una pantalla escribe ha de tener regla
// en alguna hoja. El censo solo avisaba de lo que sobra, no de lo que falta, y así una limpieza
// del 03-11 dejó 90 usos de nota sin estilo sin que nadie lo viera. Lee el código con el parser de
// TypeScript y no con expresiones regulares, porque `className` admite cualquier expresión:
// mira solo lo que puede acabar siendo una clase. Una comparación (`tipo === "FUND"`) no lo es,
// y una palabra pegada a `${}` es un prefijo dinámico y no un nombre.
//
// Lo que ve: un atributo o una propiedad de objeto `className`, `*ClassName` o `claseDelCuerpo`, y lo que hay dentro
// aunque sea una constante, un mapa o una función de ese fichero, o una constante exportada de otro.
// Lo que NO ve, y lo dice la prueba: el nombre que se compone en la ejecución (`ui-button--${size}`), y propiedades
// con otro nombre que acaben siendo una clase, como `tone`: esas son valores, y `clase="falta"` no es una clase.
const PROPIEDAD_DE_CLASE = /^(?:className|\w+ClassName|claseDelCuerpo)$/;
const NOMBRE_DE_CLASE = /^-?[A-Za-z_][\w-]*$/;

function palabras(texto, sueltaPorDelante = true, sueltaPorDetras = true) {
  const trozos = texto.split(/\s+/);
  return trozos.filter((trozo, i) => {
    if (!trozo) return false;
    if (i === 0 && !sueltaPorDelante) return false;
    if (i === trozos.length - 1 && !sueltaPorDetras) return false;
    return true;
  });
}

/** Las declaraciones que se pueden seguir: las de un fichero, y las exportadas de todos. */
const declaracionesExportadas = new Map();
function declaracionesDe(fuente) {
  const delFichero = new Map();
  const visitar = (nodo) => {
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.initializer) {
      delFichero.set(nodo.name.text, nodo.initializer);
    } else if (ts.isFunctionDeclaration(nodo) && nodo.name) {
      delFichero.set(nodo.name.text, nodo);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return delFichero;
}

function buscarDeclaracion(nombre, delFichero) {
  return delFichero.get(nombre) ?? declaracionesExportadas.get(nombre);
}

/** Lo que devuelve una función: una flecha con cuerpo de expresión, o sus `return`. */
function devueltos(funcion) {
  if (funcion.body && !ts.isBlock(funcion.body)) return [funcion.body];
  const salida = [];
  const visitar = (nodo) => {
    if (ts.isFunctionLike(nodo) && nodo !== funcion) return;
    if (ts.isReturnStatement(nodo) && nodo.expression) salida.push(nodo.expression);
    ts.forEachChild(nodo, visitar);
  };
  if (funcion.body) visitar(funcion.body);
  return salida;
}

function clasesDeLaExpresion(nodo, salida, delFichero = new Map(), vistos = new Set()) {
  if (!nodo || vistos.has(nodo)) return;
  vistos.add(nodo);
  const seguir = (hijo) => clasesDeLaExpresion(hijo, salida, delFichero, vistos);
  if (ts.isIdentifier(nodo)) {
    seguir(buscarDeclaracion(nodo.text, delFichero));
  } else if (ts.isFunctionLike(nodo)) {
    /* Una función usada como valor no es una clase; lo que devuelve, sí, si se la llama: eso lo decide quien llama. */
    return;
  } else if (ts.isObjectLiteralExpression(nodo)) {
    /* Un mapa de clases: `ESTILOS[tipo]`. Sus valores son lo que puede acabar en el atributo. */
    for (const propiedad of nodo.properties) {
      if (ts.isPropertyAssignment(propiedad)) seguir(propiedad.initializer);
    }
  } else if (ts.isPropertyAccessExpression(nodo) || ts.isElementAccessExpression(nodo)) {
    const objeto = ts.isIdentifier(nodo.expression) ? buscarDeclaracion(nodo.expression.text, delFichero) : null;
    if (objeto && ts.isObjectLiteralExpression(objeto)) {
      const clave = ts.isPropertyAccessExpression(nodo) ? nodo.name.text : ts.isStringLiteralLike(nodo.argumentExpression) ? nodo.argumentExpression.text : null;
      const propiedad = clave === null ? null : objeto.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === clave);
      if (propiedad) seguir(propiedad.initializer);
      else if (clave === null) seguir(objeto);
    }
  } else if (ts.isAsExpression(nodo) || ts.isSatisfiesExpression(nodo) || ts.isNonNullExpression(nodo)) {
    seguir(nodo.expression);
  } else if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
    salida.push(...palabras(nodo.text));
  } else if (ts.isTemplateExpression(nodo)) {
    salida.push(...palabras(nodo.head.text, true, /\s$/.test(nodo.head.text)));
    nodo.templateSpans.forEach((tramo, i) => {
      const previo = i === 0 ? nodo.head.text : nodo.templateSpans[i - 1].literal.text;
      const texto = tramo.literal.text;
      /* Pegada a un texto (`is-${estado}`), la expresión no es una clase: es un trozo de nombre. Eso es un prefijo. */
      if ((!previo || /\s$/.test(previo)) && (!texto || /^\s/.test(texto))) seguir(tramo.expression);
      const ultimo = i === nodo.templateSpans.length - 1;
      salida.push(...palabras(texto, /^\s/.test(texto), ultimo || /\s$/.test(texto)));
    });
  } else if (ts.isConditionalExpression(nodo)) {
    seguir(nodo.whenTrue);
    seguir(nodo.whenFalse);
  } else if (ts.isBinaryExpression(nodo)) {
    const operador = nodo.operatorToken.kind;
    if (operador === ts.SyntaxKind.AmpersandAmpersandToken) seguir(nodo.right);
    if (
      operador === ts.SyntaxKind.BarBarToken ||
      operador === ts.SyntaxKind.QuestionQuestionToken ||
      operador === ts.SyntaxKind.PlusToken
    ) {
      seguir(nodo.left);
      seguir(nodo.right);
    }
  } else if (ts.isParenthesizedExpression(nodo) || ts.isJsxExpression(nodo)) {
    seguir(nodo.expression);
  } else if (ts.isArrayLiteralExpression(nodo)) {
    nodo.elements.forEach(seguir);
  } else if (ts.isCallExpression(nodo)) {
    // `[…].filter(Boolean).join(" ")` y `\`…\`.trim()`: lo que cuenta es el objeto.
    // `unir("a", b)`: lo que cuenta son los argumentos. `claseDe()`: lo que devuelve, si es de este código.
    if (ts.isPropertyAccessExpression(nodo.expression)) {
      seguir(nodo.expression.expression);
    } else {
      const llamada = ts.isIdentifier(nodo.expression) ? buscarDeclaracion(nodo.expression.text, delFichero) : null;
      if (llamada && ts.isFunctionLike(llamada)) devueltos(llamada).forEach(seguir);
      nodo.arguments.forEach(seguir);
    }
  }
}

const clasesEscritas = new Map(); // clase -> Set(fichero)
const fuentesDelCodigo = srcFiles
  .filter((f) => [".ts", ".tsx"].includes(extname(f)))
  .map((fichero) => [
    fichero,
    ts.createSourceFile(
      fichero,
      readFileSync(join(ROOT, fichero), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      extname(fichero) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
  ]);
/* Las exportadas, antes de recorrer: una pantalla puede usar una constante de otro fichero. */
for (const [, fuente] of fuentesDelCodigo) {
  for (const sentencia of fuente.statements) {
    const exportada = sentencia.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    if (ts.isVariableStatement(sentencia)) {
      for (const d of sentencia.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) declaracionesExportadas.set(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(sentencia) && sentencia.name) {
      declaracionesExportadas.set(sentencia.name.text, sentencia);
    }
  }
}
for (const [fichero, fuente] of fuentesDelCodigo) {
  const delFichero = declaracionesDe(fuente);
  const anotar = (expresion) => {
    const encontradas = [];
    clasesDeLaExpresion(expresion, encontradas, delFichero);
    for (const clase of encontradas) {
      if (!NOMBRE_DE_CLASE.test(clase)) continue;
      if (!clasesEscritas.has(clase)) clasesEscritas.set(clase, new Set());
      clasesEscritas.get(clase).add(fichero.replace(/\\/g, "/"));
    }
  };
  const visitar = (nodo) => {
    if (ts.isJsxAttribute(nodo) && nodo.initializer && PROPIEDAD_DE_CLASE.test(nodo.name.getText())) anotar(nodo.initializer);
    else if (ts.isPropertyAssignment(nodo) && PROPIEDAD_DE_CLASE.test(nodo.name.getText())) anotar(nodo.initializer);
    else if (ts.isShorthandPropertyAssignment(nodo) && PROPIEDAD_DE_CLASE.test(nodo.name.getText())) anotar(nodo.name);
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
}

// La lista es de este árbol. Si el censo mira otro (CSS_AUDIT_ROOT, como hacen las pruebas),
// no se aplica ni se puede dar por caducada.
const permitidas = process.env.CSS_AUDIT_ROOT ? {} : CLASES_SIN_REGLA_PERMITIDAS;
const clasesSinRegla = [...clasesEscritas.entries()]
  .filter(([clase]) => !defined.has(clase) && !(clase in permitidas))
  .sort(([a], [b]) => a.localeCompare(b));
const excepcionesCaducadas = Object.keys(permitidas)
  .filter((clase) => !clasesEscritas.has(clase) || defined.has(clase))
  .sort();

console.log("=== CLASES SIN REFERENCIA EN CÓDIGO ===");
for (const d of dead) console.log(`${d.dynRisk ? "⚠ DYN " : "     "}${d.name}  [${d.files.map(f=>f.split("/").pop()).join(", ")}]`);
console.log(`\nTotal: ${dead.length} clases (⚠ DYN = existe prefijo dinámico compatible, revisar a mano)`);
console.log(`Lista blanca de librería (${LIBRARY_CLASS_PREFIXES.join(", ")}): ${libraryClasses.length} clases`);
console.log("\n=== TOKENS HUÉRFANOS ===");
for (const t of orphanTokens) console.log(`${t.tok}  [${t.files.map(f=>f.split("/").pop()).join(", ")}]`);
console.log(`\nTotal: ${orphanTokens.length} tokens`);
console.log(`Consumidos por el espejo theme.ts: ${mirroredTokens.join(" ") || "ninguno"}`);
if (!process.env.CSS_AUDIT_ROOT) {
  for (const tok of TOKENS_RESERVADOS) if (!tokenDefs.has(tok)) reservasCaducadas.push(tok);
}
console.log(`Reservados del sistema, aún sin uso: ${[...TOKENS_RESERVADOS].join(" ")}`);
for (const tok of reservasCaducadas) console.log(`RESERVA CADUCADA (ya se usa o ya no existe; bórrala de TOKENS_RESERVADOS): ${tok}`);
console.log("\n=== TOKENS USADOS Y NO DECLARADOS ===");
for (const [tok, files] of [...undefinedTokens.entries()].sort()) console.log(`${tok}  [${[...files].map(f => f.split("/").pop()).join(", ")}]`);
console.log(`\nTotal: ${undefinedTokens.size} tokens sin declarar`);
console.log("\n=== CLASES ESCRITAS SIN REGLA ===");
for (const [clase, ficheros] of clasesSinRegla) console.log(`${clase}  [${[...ficheros].map((f) => f.split("/").pop()).join(", ")}]`);
console.log(`\nTotal: ${clasesSinRegla.length} clases sin regla (${Object.keys(permitidas).length} en la lista de excepciones)`);
console.log("\n=== EXCEPCIONES CADUCADAS (ya no hacen falta: bórralas de clasesSinReglaPermitidas.mjs) ===");
for (const clase of excepcionesCaducadas) console.log(clase);
console.log(`\nTotal: ${excepcionesCaducadas.length} excepciones caducadas`);
console.log("\n=== PREFIJOS DINÁMICOS DETECTADOS EN CÓDIGO ===");
console.log([...dynPrefixes].sort().join("  "));

// Puerta: una clase muerta sin prefijo dinámico o un token huérfano es un
// hallazgo, y el censo sale con código 1. Las ⚠ DYN se revisan
// a mano y no cuentan: las construye el código con `prefijo-${…}`.
const hard =
  dead.filter(d => !d.dynRisk).length +
  orphanTokens.length +
  reservasCaducadas.length +
  undefinedTokens.size +
  clasesSinRegla.length +
  excepcionesCaducadas.length;
if (hard > 0) {
  console.log(`\n${hard} hallazgos: clases muertas sin prefijo dinámico, tokens huérfanos, tokens sin declarar, clases escritas sin regla o excepciones caducadas.`);
  process.exitCode = 1;
}
