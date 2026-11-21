import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const DIST_DIR = path.resolve("dist");
const HTML_PATH = path.join(DIST_DIR, "index.html");
const MAX_INITIAL_JS_GZIP = 130 * 1024;
const MAX_INITIAL_CSS_GZIP = 45 * 1024;
const FORBIDDEN_INITIAL_CHUNKS = [
  "react-pdf",
  "firebase",
  "AdminPage",
  "PortfolioBuilderPage"
];

const html = await readFile(HTML_PATH, "utf8");
const assetPaths = [...html.matchAll(/(?:src|href)="\/(assets\/[^"?]+\.(?:js|css))"/g)]
  .map((match) => match[1]);
const uniqueAssetPaths = [...new Set(assetPaths)];

if (uniqueAssetPaths.length === 0) {
  throw new Error("No se encontraron recursos iniciales en dist/index.html.");
}

const forbidden = uniqueAssetPaths.filter((assetPath) =>
  // Match the chunk name, not a helper such as firebaseEnv (no SDK imports).
  FORBIDDEN_INITIAL_CHUNKS.some((chunk) => path.basename(assetPath).startsWith(`${chunk}-`))
);
if (forbidden.length > 0) {
  throw new Error(`Se cargan modulos diferidos en la entrada: ${forbidden.join(", ")}`);
}

let jsGzip = 0;
let cssGzip = 0;
const rows = [];

for (const assetPath of uniqueAssetPaths) {
  const absolutePath = path.join(DIST_DIR, assetPath);
  await stat(absolutePath);
  const contents = await readFile(absolutePath);
  const gzipBytes = gzipSync(contents).byteLength;
  if (assetPath.endsWith(".js")) jsGzip += gzipBytes;
  if (assetPath.endsWith(".css")) cssGzip += gzipBytes;
  rows.push(`${assetPath}: ${(gzipBytes / 1024).toFixed(1)} KiB gzip`);
}

if (jsGzip > MAX_INITIAL_JS_GZIP) {
  throw new Error(
    `JavaScript inicial ${(jsGzip / 1024).toFixed(1)} KiB supera el limite de ${MAX_INITIAL_JS_GZIP / 1024} KiB.`
  );
}
if (cssGzip > MAX_INITIAL_CSS_GZIP) {
  throw new Error(
    `CSS inicial ${(cssGzip / 1024).toFixed(1)} KiB supera el limite de ${MAX_INITIAL_CSS_GZIP / 1024} KiB.`
  );
}

console.log(rows.join("\n"));
console.log(
  `Presupuesto inicial correcto: JS ${(jsGzip / 1024).toFixed(1)} KiB gzip; CSS ${(cssGzip / 1024).toFixed(1)} KiB gzip.`
);
