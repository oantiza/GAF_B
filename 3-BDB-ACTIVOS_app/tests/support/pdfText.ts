/**
 * Lector mínimo de texto de un PDF generado, para poder AFIRMAR sobre lo que sale
 * impreso —el pie de página, por ejemplo— y no sobre el código que lo escribe.
 *
 * Los informes usan fuentes subconjuntadas con codificación Identity-H: las cadenas
 * del flujo de contenido llevan identificadores de glifo, no letras. Aquí se
 * deshacen los dos envoltorios: se descomprime cada flujo y se traduce cada glifo
 * con el CMap `/ToUnicode` de su fuente. Sin dependencias externas.
 *
 * Limitación conocida: las ligaduras tipográficas «fi» y «fl» viajan como un glifo que
 * el CMap de la fuente no traduce, así que se pierden en la extracción («confirmados»
 * sale como «conrmados»). Afecta solo a la lectura de la prueba, no al PDF impreso: al
 * buscar cadenas conviene elegir marcas sin esas ligaduras.
 */
import * as zlib from "node:zlib";

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function parseObjects(bytes: Buffer): Map<number, PdfObject> {
  const raw = bytes.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(raw)) !== null) {
    const number = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const streamAt = raw.indexOf("stream", bodyStart);
    const endObjAt = raw.indexOf("endobj", bodyStart);
    const hasStream = streamAt !== -1 && (endObjAt === -1 || streamAt < endObjAt);
    const dict = raw.slice(bodyStart, hasStream ? streamAt : endObjAt);
    let stream: Buffer | null = null;
    if (hasStream) {
      let dataStart = streamAt + "stream".length;
      if (raw[dataStart] === "\r") dataStart += 1;
      if (raw[dataStart] === "\n") dataStart += 1;
      const dataEnd = raw.indexOf("endstream", dataStart);
      stream = bytes.subarray(dataStart, dataEnd);
    }
    objects.set(number, { dict, stream });
  }
  return objects;
}

function inflate(object: PdfObject): Buffer {
  if (!object.stream) return Buffer.alloc(0);
  if (!/\/Filter\s*\/FlateDecode/.test(object.dict)) return object.stream;
  try {
    return zlib.inflateSync(object.stream);
  } catch {
    // Los flujos se cortan en el primer `endstream`; si el dato binario lo contenía,
    // se descomprime lo que haya llegado.
    return zlib.inflateSync(object.stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
}

/** `<< /F1 7 0 R /F2 9 0 R >>` → { F1: 7, F2: 9 } */
function fontRefs(resources: string): Record<string, number> {
  const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(resources);
  const refs: Record<string, number> = {};
  if (!fontBlock) return refs;
  for (const entry of fontBlock[1].matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g)) {
    refs[entry[1]] = Number(entry[2]);
  }
  return refs;
}

/** CMap `/ToUnicode`: bfchar y bfrange → glifo (hex) a texto. */
function parseToUnicode(cmap: string): Map<number, string> {
  const table = new Map<number, string>();
  const fromHex = (hex: string) =>
    (hex.match(/.{1,4}/g) ?? []).map((unit) => String.fromCharCode(parseInt(unit, 16))).join("");
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      table.set(parseInt(pair[1], 16), fromHex(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const triple of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const low = parseInt(triple[1], 16);
      const high = parseInt(triple[2], 16);
      const target = parseInt(triple[3], 16);
      for (let code = low; code <= high; code += 1) {
        table.set(code, String.fromCharCode(target + (code - low)));
      }
    }
  }
  return table;
}

function toUnicodeOf(objects: Map<number, PdfObject>, fontNumber: number): Map<number, string> {
  const font = objects.get(fontNumber);
  if (!font) return new Map();
  const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font.dict);
  if (!ref) {
    // Fuente compuesta: el CMap cuelga del descendiente o del propio /BaseFont.
    const descendant = /\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/.exec(font.dict);
    return descendant ? toUnicodeOf(objects, Number(descendant[1])) : new Map();
  }
  const cmap = objects.get(Number(ref[1]));
  return cmap ? parseToUnicode(inflate(cmap).toString("latin1")) : new Map();
}

function decodeShown(hex: string, table: Map<number, string>): string {
  return (hex.replace(/\s+/g, "").match(/.{1,4}/g) ?? [])
    .map((unit) => table.get(parseInt(unit.padEnd(4, "0"), 16)) ?? "")
    .join("");
}

/**
 * Un metadato del documento: `Title`, `Author`, `Subject`… Van por referencia a su objeto y, si
 * llevan acentos, en UTF-16 (cada letra con su byte nulo y los paréntesis escapados).
 */
export function extractPdfMetadata(bytes: Buffer, key: string): string | null {
  const raw = bytes.toString("latin1");
  const ref = new RegExp(`/${key} (\\d+) 0 R`).exec(raw);
  const value = ref && new RegExp(`\\n${ref[1]} 0 obj\\n\\(([\\s\\S]*?)\\)\\nendobj`).exec(raw);
  if (!value) return null;
  return value[1].replace(/^\u00FE\u00FF/, "").replaceAll("\u0000", "").replace(/\\([()])/g, "$1");
}

/** El idioma del documento, el `/Lang` del catálogo (INF-24): escrito en el sitio o por referencia a su objeto. */
export function extractPdfLanguage(bytes: Buffer): string | null {
  const raw = bytes.toString("latin1");
  const directo = /\/Lang\s*\(([^)]*)\)/.exec(raw);
  if (directo) return directo[1].replace(/^þÿ/, "").replaceAll("\u0000", "");
  const ref = /\/Lang\s+(\d+)\s+0\s+R/.exec(raw);
  const valor = ref && new RegExp(`\\n${ref[1]} 0 obj\\n\\(([\\s\\S]*?)\\)\\nendobj`).exec(raw);
  return valor ? valor[1].replace(/^þÿ/, "").replaceAll("\u0000", "") : null;
}

/** Texto de cada hoja del PDF, en orden de impresión. */
/** Las caras que el PDF incrusta, sin el prefijo de subconjunto («ABCDEF+»), ordenadas y sin repetir. */
export function extractPdfFontFaces(bytes: Buffer): string[] {
  const caras = [...bytes.toString("latin1").matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  return [...new Set(caras)].sort();
}

export function extractPdfPageTexts(bytes: Buffer): string[] {
  return extractPdfTextRuns(bytes).map((runs) => runs.join(" ").replace(/\s+/g, " ").trim());
}

/**
 * Lo mismo, pero cada cadena que el documento escribe (un `Tj` o un `TJ`) por separado: una línea de texto es una cadena,
 * así que un título que baja a una segunda línea sale partido en dos. Es lo que permite afirmar «cabe en una línea».
 */
export function extractPdfTextRuns(bytes: Buffer): string[][] {
  return extractPdfSizedRuns(bytes).map((runs) => runs.map((run) => run.texto));
}

/** Lo mismo, con el cuerpo de letra con que se escribe cada cadena (el del último `Tf`): permite afirmar a qué tamaño sale un texto. */
export function extractPdfSizedRuns(bytes: Buffer): Array<Array<{ texto: string; puntos: number }>> {
  const objects = parseObjects(bytes);
  const raw = bytes.toString("latin1");
  const kids = /\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/.exec(raw);
  const pageNumbers = kids
    ? Array.from(kids[1].matchAll(/(\d+)\s+0\s+R/g), (match) => Number(match[1]))
    : [];
  return pageNumbers.map((pageNumber) => {
    const page = objects.get(pageNumber);
    if (!page) return [];
    const resourcesRef = /\/Resources\s+(\d+)\s+0\s+R/.exec(page.dict);
    const resources = resourcesRef
      ? objects.get(Number(resourcesRef[1]))?.dict ?? ""
      : /\/Resources\s*<<([\s\S]*?)>>\s*(?:\/|$)/.exec(page.dict)?.[0] ?? page.dict;
    const fonts = fontRefs(resources);
    const tables = new Map<string, Map<number, string>>();
    for (const [name, number] of Object.entries(fonts)) {
      tables.set(name, toUnicodeOf(objects, number));
    }
    const contentNumbers = Array.from(
      (/\/Contents\s*(?:\[([^\]]*)\]|(\d+)\s+0\s+R)/.exec(page.dict)?.[1] ?? "")
        .matchAll(/(\d+)\s+0\s+R/g),
      (match) => Number(match[1])
    );
    const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(page.dict);
    if (single) contentNumbers.push(Number(single[1]));
    const runs: Array<{ texto: string; puntos: number }> = [];
    let current = new Map<number, string>();
    let puntos = 0;
    for (const contentNumber of contentNumbers) {
      const content = objects.get(contentNumber);
      if (!content) continue;
      const stream = inflate(content).toString("latin1");
      for (const token of stream.matchAll(/\/([A-Za-z0-9_.-]+)\s+([\d.]+)\s+Tf|<([0-9A-Fa-f\s]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g)) {
        if (token[1] !== undefined) {
          current = tables.get(token[1]) ?? current;
          puntos = Number(token[2]);
        } else if (token[3] !== undefined) {
          runs.push({ texto: decodeShown(token[3], current), puntos });
        } else if (token[4] !== undefined) {
          let run = "";
          for (const part of token[4].matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
            run += decodeShown(part[1], current);
          }
          runs.push({ texto: run, puntos });
        }
      }
    }
    return runs;
  });
}

/**
 * Las líneas impresas que se han quedado con una sola palabra de cierre: «impuestos.» o «ni impuestos.» solas en su renglón
 * (decisión 80). Cada cadena que el documento escribe es una línea, así que basta con mirar cuáles son solo eso.
 */
export function lineasHuerfanasDeImpuestos(bytes: Buffer): string[] {
  return extractPdfTextRuns(bytes).flat().map((linea) => linea.replace(/\s+/g, " ").trim()).filter((linea) => /^(?:ni )?impuestos\.?$/.test(linea));
}

/** Las líneas impresas que contienen `texto`, con un solo espacio: para ver dónde parte el papel una frase. */
export function lineasCon(bytes: Buffer, texto: string): string[] {
  return extractPdfTextRuns(bytes).flat().map((linea) => linea.replace(/\s+/g, " ").trim()).filter((linea) => linea.includes(texto));
}

type Matriz = [number, number, number, number, number, number];
const multiplicar = (m: Matriz, n: Matriz): Matriz => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
];

/**
 * Cada cadena con la altura de su línea base en la hoja, en puntos desde ARRIBA: sigue las `cm` con su pila de `q`/`Q` y la `Tm` de cada
 * texto. Es lo que permite afirmar que nada se ha dibujado por debajo del pie de una hoja de tamaño fijo, donde se cortaría sin avisar.
 * Lleva también `x`, donde empieza la cadena desde la izquierda: sirve para afirmar que dos textos de una misma línea no se pisan.
 * Y `puntos`, el cuerpo con que sale impresa: el del `Tf` por la escala de la matriz de texto y de la de la hoja (un gráfico con
 * `viewBox` escala su letra), que es lo que permite afirmar que ninguna letra baja de un tamaño (INF-28).
 */
export function extractPdfTextBaselines(bytes: Buffer): Array<Array<{ texto: string; y: number; x: number; puntos: number }>> {
  const objects = parseObjects(bytes);
  const raw = bytes.toString("latin1");
  const kids = /\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/.exec(raw);
  const pageNumbers = kids ? Array.from(kids[1].matchAll(/(\d+)\s+0\s+R/g), (match) => Number(match[1])) : [];
  return pageNumbers.map((pageNumber) => {
    const page = objects.get(pageNumber);
    if (!page) return [];
    const alto = Number(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(page.dict)?.[1] ?? 841.89);
    const resourcesRef = /\/Resources\s+(\d+)\s+0\s+R/.exec(page.dict);
    const resources = resourcesRef ? objects.get(Number(resourcesRef[1]))?.dict ?? "" : page.dict;
    const tables = new Map(Object.entries(fontRefs(resources)).map(([name, number]) => [name, toUnicodeOf(objects, number)]));
    const contentNumbers = Array.from((/\/Contents\s*(?:\[([^\]]*)\]|(\d+)\s+0\s+R)/.exec(page.dict)?.[1] ?? "").matchAll(/(\d+)\s+0\s+R/g), (match) => Number(match[1]));
    const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(page.dict);
    if (single) contentNumbers.push(Number(single[1]));
    const salida: Array<{ texto: string; y: number; x: number; puntos: number }> = [];
    let ctm: Matriz = [1, 0, 0, 1, 0, 0];
    let tm: Matriz = [1, 0, 0, 1, 0, 0];
    const pila: Matriz[] = [];
    let tabla = new Map<number, string>();
    let cuerpo = 0;
    let operandos: string[] = [];
    const anotar = (texto: string) => {
      const m = multiplicar(tm, ctm);
      /* La escala vertical de la matriz completa: la raíz de su determinante, que no depende del giro ni del volteo. */
      const escala = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      salida.push({ texto, y: alto - m[5], x: m[4], puntos: cuerpo * escala });
    };
    for (const contentNumber of contentNumbers) {
      const content = objects.get(contentNumber);
      if (!content) continue;
      const stream = inflate(content).toString("latin1");
      for (const token of stream.matchAll(/\[[^\]]*\]|<[0-9A-Fa-f\s]*>|\/[A-Za-z0-9_.-]+|-?\d*\.?\d+(?:e-?\d+)?|[A-Za-z*'"]+/g)) {
        const t = token[0];
        if (/^-?\d*\.?\d+/.test(t) || t.startsWith("/") || t.startsWith("[") || t.startsWith("<")) { operandos.push(t); continue; }
        const num = (i: number) => Number(operandos[operandos.length - 6 + i]);
        if (t === "q") pila.push(ctm);
        else if (t === "Q") ctm = pila.pop() ?? ctm;
        else if (t === "cm") ctm = multiplicar([num(0), num(1), num(2), num(3), num(4), num(5)], ctm);
        else if (t === "BT") tm = [1, 0, 0, 1, 0, 0];
        else if (t === "Tm") tm = [num(0), num(1), num(2), num(3), num(4), num(5)];
        else if (t === "Td") tm = multiplicar([1, 0, 0, 1, Number(operandos[operandos.length - 2]), Number(operandos[operandos.length - 1])], tm);
        else if (t === "Tf") {
          tabla = tables.get(operandos[operandos.length - 2]?.slice(1) ?? "") ?? tabla;
          cuerpo = Number(operandos[operandos.length - 1]);
        }
        else if (t === "Tj") anotar(decodeShown(operandos[operandos.length - 1].slice(1, -1), tabla));
        else if (t === "TJ") anotar(Array.from(operandos[operandos.length - 1].matchAll(/<([0-9A-Fa-f\s]+)>/g), (parte) => decodeShown(parte[1], tabla)).join(""));
        operandos = [];
      }
    }
    return salida;
  });
}
