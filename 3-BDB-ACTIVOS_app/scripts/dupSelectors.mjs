// Censo de selectores repetidos (ola 4 · U-13): por cada hoja de src/styles,
// cuenta los selectores declarados más de una vez FUERA de @media/@supports y
// los selectores declarados en más de un fichero. El patrón «definir → neutralizar
// al final» se ve aquí como un selector con N apariciones; el objetivo es una
// sola declaración por selector con el resultado neto.
//
// Uso: node scripts/dupSelectors.mjs [--list] [--cross] [--max-dups N] [--max-cross M] [--max-intra K]
//   --list       imprime cada selector repetido con sus líneas
//   --overrides  imprime los selectores que redeclaran una misma propiedad en
//                dos reglas (la sobrescritura en cascada que hay que consolidar)
//   --cross      imprime los selectores definidos en varios ficheros
//   --max-dups   tope de selectores CON SOBRESCRITURA en modules.css; --max-cross tope
//                de selectores en varios ficheros; --max-intra tope de propiedades
//                repetidas dentro de un mismo bloque (en cualquier hoja, también en
//                @media; tests/dupSelectorsIntra.test.ts lo fija en 0). Si se
//                superan, sale con código 1.
// Las propiedades repetidas dentro de un bloque se listan siempre.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CSS_AUDIT_ROOT ?? process.cwd();
const CSS_FILES = [
  "src/styles/tokens.css",
  "src/styles/base.css",
  "src/styles/layout.css",
  "src/styles/components.css",
  "src/styles/charts.css",
  "src/styles/modules.css"
].filter(p => { try { statSync(join(ROOT, p)); return true; } catch { return false; } });

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };

/** Extrae reglas de nivel superior: { selector, line, inAtRule } */
function parseRules(css) {
  // conservar posiciones de línea: sustituir comentarios por espacios del mismo largo
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  const rules = [];
  let depth = 0;
  let atDepth = -1; // profundidad a la que se abrió un @media/@supports/@container
  let buf = "";
  let line = 1;
  let bufLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    if (ch === "{") {
      const sel = buf.trim();
      buf = "";
      if (/^@(media|supports|container|layer)/.test(sel)) {
        if (atDepth < 0) atDepth = depth;
      }
      depth++;
      // dentro de un bloque de declaraciones no hay selectores; saltar hasta su cierre
      if (!sel.startsWith("@")) {
        let j = i + 1;
        let d = 1;
        while (j < text.length && d > 0) {
          if (text[j] === "{") d++;
          else if (text[j] === "}") d--;
          if (text[j] === "\n") line++;
          j++;
        }
        const body = text.slice(i + 1, j - 1);
        if (sel) rules.push({ selector: sel, line: bufLine, inAtRule: atDepth >= 0, body });
        i = j - 1;
        depth--;
      }
      bufLine = line;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (atDepth >= 0 && depth === atDepth) atDepth = -1;
      buf = "";
      bufLine = line;
      continue;
    }
    if (buf.trim() === "" && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") bufLine = line;
    buf += ch;
  }
  return rules;
}

const normalize = s => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();

/** Divide una lista de selectores por comas de nivel superior (respeta :is(a, b)). */
function splitTop(sel) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Reservas deliberadas de una propiedad repetida en el mismo bloque: la primera
// declaración es la que entiende cualquier navegador y la segunda la moderna
// (`height: 100vh; height: 100dvh`). Nada más cuenta como deliberado.
const INTRA_ALLOW = [
  (_prop, values) => values.length === 2 && /\b\d+(?:\.\d+)?vh\b/.test(values[0]) && /\b\d+(?:\.\d+)?dvh\b/.test(values[1])
];

const perFile = {};
const cross = new Map(); // selector -> Set(file)
let totalDupSelectors = 0;
let totalExtraDecls = 0;
let totalIntra = 0;

for (const f of CSS_FILES) {
  const css = readFileSync(join(ROOT, f), "utf8");
  const rules = parseRules(css).filter(r => !r.inAtRule);
  const seen = new Map();  // lista de selectores completa (tal cual se declara)
  const parts = new Map(); // cada selector individual de una lista con comas
  for (const r of rules) {
    const key = normalize(r.selector);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r.line);
    for (const part of splitTop(key)) {
      if (!parts.has(part)) parts.set(part, []);
      parts.get(part).push(r.line);
      if (!cross.has(part)) cross.set(part, new Set());
      cross.get(part).add(f);
    }
  }
  const dups = [...seen.entries()].filter(([, lines]) => lines.length > 1);
  const partDups = [...parts.entries()].filter(([, lines]) => lines.length > 1);
  // Sobrescrituras: el mismo selector declara la MISMA propiedad en dos reglas
  // distintas (patrón «definir → neutralizar»). Es lo que hay que consolidar.
  const propsByRule = rules.map(r => new Set(
    r.body.split(";").map(d => d.split(":")[0].trim()).filter(Boolean)
  ));
  const overrides = [];
  for (const [part, lines] of partDups) {
    const idx = lines.map(l => rules.findIndex(r => r.line === l));
    const seenProps = new Map();
    const clash = new Set();
    for (const i of idx) for (const prop of propsByRule[i]) {
      if (seenProps.has(prop)) clash.add(prop); else seenProps.set(prop, i);
    }
    if (clash.size) overrides.push([part, lines, [...clash]]);
  }
  // Propiedad repetida DENTRO de un mismo bloque (auditoría 16-10-2026): la
  // segunda declaración pisa a la primera sin que nada avise. Así quedó la cifra
  // del donut de una categoría en tinta y no en Prusia (charts.css), o el H1 sin
  // el tracking de la ola 1 (components.css). Se miran todas las reglas, también
  // las de @media. Las reservas deliberadas (un valor moderno tras otro que
  // entienda cualquier navegador) van en INTRA_ALLOW.
  const intra = [];
  for (const r of parseRules(css)) {
    const decls = r.body.split(";").map(d => d.trim()).filter(d => d.includes(":") && !d.includes("{"));
    const byProp = new Map();
    for (const d of decls) {
      const prop = d.slice(0, d.indexOf(":")).trim().toLowerCase();
      const value = d.slice(d.indexOf(":") + 1).trim();
      if (!byProp.has(prop)) byProp.set(prop, []);
      byProp.get(prop).push(value);
    }
    for (const [prop, values] of byProp) {
      if (values.length < 2) continue;
      if (INTRA_ALLOW.some(allow => allow(prop, values))) continue;
      intra.push([normalize(r.selector), r.line, prop, values]);
    }
  }
  perFile[f] = { rules: rules.length, unique: seen.size, dups, partDups, overrides, intra };
  totalIntra += intra.length;
  totalDupSelectors += partDups.length;
  totalExtraDecls += partDups.reduce((a, [, l]) => a + l.length - 1, 0);
}

console.log("=== SELECTORES REPETIDOS FUERA DE @media (por fichero) ===");
console.log("(«listas» = la lista de selectores completa aparece más de una vez; «selectores» = un selector individual aparece en más de una regla, aunque sea dentro de listas distintas)");
for (const [f, info] of Object.entries(perFile)) {
  const extra = info.partDups.reduce((a, [, l]) => a + l.length - 1, 0);
  console.log(`${f.split("/").pop().padEnd(16)} reglas ${String(info.rules).padStart(5)} · listas repetidas ${String(info.dups.length).padStart(3)} · selectores repetidos ${String(info.partDups.length).padStart(4)} (+${extra} apariciones extra) · con sobrescritura ${String(info.overrides.length).padStart(3)}`);
  if (flag("--list")) {
    for (const [sel, lines] of info.partDups.sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ×${lines.length}  ${sel}   [${lines.join(", ")}]`);
    }
  }
  if (flag("--overrides")) {
    for (const [sel, lines, props] of info.overrides) {
      console.log(`   ⟳ ${sel}   [${lines.join(", ")}]  → ${props.join(", ")}`);
    }
  }
}
console.log(`Total selectores repetidos: ${totalDupSelectors} (+${totalExtraDecls} apariciones extra)`);

console.log(`\n=== PROPIEDADES REPETIDAS DENTRO DE UN MISMO BLOQUE: ${totalIntra} ===`);
for (const [f, info] of Object.entries(perFile)) {
  for (const [sel, line, prop, values] of info.intra) {
    console.log(`   ${f.split("/").pop()}:${line}  ${sel}  → ${prop}: ${values.join(" ⟶ ")}`);
  }
}

const crossList = [...cross.entries()].filter(([, files]) => files.size > 1).sort();
console.log(`\n=== SELECTORES DEFINIDOS EN MÁS DE UN FICHERO: ${crossList.length} ===`);
if (flag("--cross")) {
  for (const [sel, files] of crossList) console.log(`   ${sel}   [${[...files].map(x => x.split("/").pop()).join(", ")}]`);
}

const maxDups = opt("--max-dups", Infinity);
const maxCross = opt("--max-cross", Infinity);
const maxIntra = opt("--max-intra", Infinity);
const modDups = perFile["src/styles/modules.css"]?.overrides.length ?? 0;
let fail = false;
if (modDups > maxDups) { console.error(`✗ modules.css: ${modDups} selectores con sobrescritura > ${maxDups}`); fail = true; }
if (totalIntra > maxIntra) { console.error(`✗ ${totalIntra} propiedades repetidas dentro de un bloque > ${maxIntra}`); fail = true; }
if (crossList.length > maxCross) { console.error(`✗ ${crossList.length} selectores en varios ficheros > ${maxCross}`); fail = true; }
process.exit(fail ? 1 : 0);
