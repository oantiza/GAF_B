// Inspect text actually drawn by react-pdf. A declared, unused default font
// is harmless; a fallback font that draws even one glyph must fail the smoke.
import { inflateSync } from "node:zlib";

export function pdfUsedFonts(bytes) {
  const raw = bytes.toString("latin1");
  const objects = new Map();
  for (const match of raw.matchAll(/(\d+) \d+ obj\s*/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endobj", start);
    const streamAt = raw.indexOf("stream", start);
    const hasStream = streamAt >= 0 && streamAt < end;
    const dict = raw.slice(start, hasStream ? streamAt : end);
    let content = "";
    if (hasStream) {
      const offset = streamAt + "stream".length + (raw[streamAt + 6] === "\r" ? 2 : 1);
      const data = bytes.subarray(offset, raw.indexOf("endstream", offset));
      content = (/\/FlateDecode/.test(dict) ? inflateSync(data) : data).toString("latin1");
    }
    objects.set(Number(match[1]), { dict, content });
  }
  const used = new Set();
  for (const page of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(page.dict)) continue;
    const resourcesRef = /\/Resources\s+(\d+)\s+0\s+R/.exec(page.dict);
    const resources = resourcesRef ? objects.get(Number(resourcesRef[1]))?.dict : page.dict;
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(resources ?? "");
    if (!fontBlock) throw new Error("PDF page has no inspectable font resources");
    // Text drawn inside a Form XObject uses the form's own fonts, which this walk never
    // sees: better to fail than to report a clean page that was not fully inspected.
    const xobjectsRef = /\/XObject\s+(\d+)\s+\d+\s+R/.exec(resources ?? "");
    const xobjects = xobjectsRef ? objects.get(Number(xobjectsRef[1]))?.dict ?? "" : /\/XObject\s*<<([\s\S]*?)>>/.exec(resources ?? "")?.[1] ?? "";
    // Any name, any generation: a form called /Fm-1, or referenced as "7 1 R", is still a form.
    for (const reference of xobjects.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (/\/Subtype\s*\/Form\b/.test(objects.get(Number(reference[2]))?.dict ?? "")) {
        throw new Error("PDF page draws a Form XObject: the fonts used inside it are not inspected");
      }
    }
    const fonts = new Map([...fontBlock[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)].map((m) => {
      const dict = objects.get(Number(m[2]))?.dict ?? "";
      return [m[1], /\/BaseFont\s*\/([^\s/>]+)/.exec(dict)?.[1]];
    }));
    const contentRef = /\/Contents\s+(\d+)\s+0\s+R/.exec(page.dict);
    if (!contentRef) throw new Error("Unsupported PDF page content reference");
    const content = objects.get(Number(contentRef[1]))?.content ?? "";
    let font;
    // react-pdf emits hex glyph strings, literal strings, and TJ arrays.
    const tokens = /\/(\w+)\s+[\d.+-]+\s+Tf\b|(\[(?:[^\]]*)\]|<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\))\s*(?:TJ|Tj)\b/g;
    for (const token of content.matchAll(tokens)) {
      if (token[1]) font = fonts.get(token[1]);
      else if (font && /<\s*[0-9a-fA-F]+|\((?:\\.|[^\\)])+\)/.test(token[2])) used.add(font);
    }
  }
  if (!used.size) throw new Error("No drawn PDF fonts found");
  return [...used];
}
