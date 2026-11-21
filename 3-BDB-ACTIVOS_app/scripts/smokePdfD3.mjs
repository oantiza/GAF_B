// D3.5 — prueba de humo de los PDF: genera en el navegador, contra el servidor de
// desarrollo, la comparativa de carteras y el informe semanal, y comprueba que las
// dos letras de la plantilla única (Fraunces y Roboto Flex, que el papel recuperó el
// 14-11-2026: src/reports/plantilla/fuentes.ts) quedan incrustadas, que ninguna otra
// dibuja un glifo y que el documento no está vacío. Mira las letras de lo que cada página
// dibuja directamente; si una página dibujara dentro de un formulario incrustado (un «Form
// XObject»), cuyas letras no se ven así, la prueba falla y lo dice (pdfUsedFonts.mjs). Los
// dos PDF de esta prueba no llevan ninguno (mirado el 19-11-2026). Es la única comprobación que
// genera los PDF por el camino del asesor —el navegador, con las letras servidas por
// Vite—; las pruebas de vitest los generan en Node, por la otra rama.
//
// Necesita el servidor de desarrollo (importa /src/…, que `vite preview` no sirve) en
// AUDIT_BASE, por defecto http://localhost:5174. No entra ni lee la base: solo importa
// los módulos de los informes. Con PDF_SMOKE_OUTPUT_DIR guarda los dos PDF.
//
// Puesta al día el 19-11-2026: exigía IBM Plex Sans y Source Serif 4, que son las
// letras de la pantalla y solo fueron las del papel unas horas del 14-11, así que
// fallaba siempre aunque el PDF estuviera bien.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pdfUsedFonts } from "./pdfUsedFonts.mjs";
import { baseDeLaApp } from "./entrarEnLaApp.mjs";

const BASE = baseDeLaApp();
/** Toda letra que dibuje un glifo tiene que ser de la plantilla (con o sin el prefijo de subconjunto, «ABCDEF+»). */
const ES_DE_LA_PLANTILLA = /^([A-Z]{6}\+)?(Fraunces|RobotoFlex)-/;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/buscador`, { waitUntil: "domcontentloaded", timeout: 30000 });

const result = await page.evaluate(async () => {
  const out = {};
  const blobs = [];
  URL.createObjectURL = (b) => { blobs.push(b); return "blob:fake"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};

  async function inspect(name, blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let ascii = "";
    for (let i = 0; i < buf.length; i++) ascii += buf[i] >= 32 && buf[i] < 127 ? String.fromCharCode(buf[i]) : ".";
    out[name] = { bytes: buf.length, pdf: ascii.startsWith("%PDF") };
    out[name].base64 = btoa(buf.reduce((text, byte) => text + String.fromCharCode(byte), ""));
  }

  const compare = await import("/src/reports/comparePdf.tsx");
  await compare.downloadComparisonPdf({
    nameA: "Cartera Ávila", nameB: "Cartera Coruña",
    a: { posiciones: 8, ret: 0.0642, vol: 0.11, sharpe: 0.58, maxdd: -0.137 },
    b: { posiciones: 12, ret: 0.051, vol: 0.09, sharpe: 0.55, maxdd: -0.101 },
    classRows: [{ label: "Renta variable", a: 60, b: 40 }, { label: "Renta fija", a: 30, b: 50 }]
  });
  await inspect("compare", blobs.pop());

  const weekly = await import("/src/reports/weeklyReportPdf.tsx");
  const blobW = await weekly.createWeeklyReportPdfBlob({
    date: "2026-08-24", author: "Comité", provider: "BDB",
    summary: {
      headline: "Semana de transición — atención al BCE",
      narrative: "Visión constructiva con volatilidad contenida. Ñandú, camión, 12,5 %, −3,2 %, 1.250 €.",
      marketTemperature: "Neutral", keyEvents: ["Reunión del BCE", "IPC de la eurozona"],
      kpis: [{ label: "EUR/USD", value: "1,09", trend: "up" }]
    },
    assetAllocation: {
      overview: "Sobreponderación moderada de renta variable europea.",
      classes: [{ assetClass: "Renta variable", strategicWeight: 50, tacticalWeight: 55, view: "Positiva" }],
      regionsEquity: [{ region: "Europa", weight: 40, view: "Positiva" }]
    },
    fullReport: { narrative: "Informe completo de prueba." }
  }, "WEEKLY_REPORT");
  await inspect("weekly", blobW);

  return out;
});

if (process.env.PDF_SMOKE_OUTPUT_DIR) {
  mkdirSync(process.env.PDF_SMOKE_OUTPUT_DIR, { recursive: true });
  for (const [name, r] of Object.entries(result)) {
    writeFileSync(join(process.env.PDF_SMOKE_OUTPUT_DIR, `${name}.pdf`), Buffer.from(r.base64, "base64"));
  }
}
for (const r of Object.values(result)) {
  r.usedFonts = pdfUsedFonts(Buffer.from(r.base64, "base64"));
  /* Las dos letras, entre las que DIBUJAN algún glifo: que el nombre esté en el fichero no prueba que se use. */
  r.fraunces = r.usedFonts.some((name) => /^([A-Z]{6}[+])?Fraunces-/.test(name ?? ""));
  r.robotoFlex = r.usedFonts.some((name) => /^([A-Z]{6}[+])?RobotoFlex-/.test(name ?? ""));
  r.ajenas = r.usedFonts.filter((name) => !ES_DE_LA_PLANTILLA.test(name ?? ""));
  delete r.base64;
}
console.log(JSON.stringify(result, null, 1));
if (errors.length) console.log("pageerrors:", errors);
const bad = Object.entries(result).filter(([, r]) => !r.pdf || !r.fraunces || !r.robotoFlex || r.ajenas.length > 0 || r.bytes < 10000);
console.log(bad.length === 0 && !errors.length ? "HUMO PDF ✓" : `HUMO PDF ✗ (${bad.map(([k]) => k).join(", ") || "errores de página"})`);
await browser.close();
process.exit(bad.length === 0 && errors.length === 0 ? 0 : 1);
