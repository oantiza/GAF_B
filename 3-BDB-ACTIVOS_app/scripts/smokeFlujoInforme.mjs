/**
 * Prueba de humo del flujo Diseño → Informes → Análisis (P10, ola 3b), con un navegador de verdad.
 *
 * Las 454 pruebas unitarias de julio no cazaron ni N1 (el capital perdía el
 * foco con cada tecla y borraba los candados) ni la divergencia de N4: este
 * recorrido con navegador real fija exactamente esos comportamientos. Y es la
 * única comprobación que descarga de verdad el informe para el cliente por sus
 * dos puertas, Informes y Análisis: en las pruebas de vitest el generador va
 * simulado.
 *
 * Requiere el entorno local en marcha (habilidad `arrancar-entorno`): la
 * aplicación en AUDIT_BASE (por defecto http://localhost:5174) y los
 * emuladores. Como la aplicación pide acceso, entra con el usuario local del
 * emulador: BDB_SHOTS_EMAIL y BDB_SHOTS_PASSWORD (`entrarEnLaApp.mjs`). No
 * escribe en la base: solo en el almacenamiento del navegador.
 *
 * Puesta al día el 19-11-2026: desde el rediseño del 14-11 buscaba rótulos que
 * ya no existían, apuntaba a un puerto que nadie levanta y no entraba.
 */
import { chromium } from "playwright";
import { SEED_POSITIONS, SEED_SCRIPT } from "./carteraDeMuestra.mjs";
import { baseDeLaApp, entrar } from "./entrarEnLaApp.mjs";

const BASE = baseDeLaApp();
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
let sawDialog = null;
let avisosAlSalir = 0;
page.on("dialog", (dialog) => {
  // Con la base en directo el borrador vive en la pestaña, y la aplicación deja
  // que el navegador pregunte antes de recargar o de irse con cambios sin
  // guardar (useCicloDeCartera). Es a propósito: se acepta y se sigue.
  if (dialog.type() === "beforeunload") {
    avisosAlSalir += 1;
    void dialog.accept();
    return;
  }
  // N5: el flujo del informe moría con un alert() del navegador. Ninguna
  // parte del recorrido puede abrir un alert, un confirm o un prompt.
  sawDialog = `${dialog.type()}: ${dialog.message().slice(0, 120)}`;
  void dialog.dismiss();
});

// Abre una pantalla y espera a que cargue. No se espera a que la red calle: con
// la base en directo, las pantallas de la propuesta la escuchan y no calla nunca
// (el recorrido de antes, contra la muestra estática, sí podía). Cada paso espera
// después a lo que va a mirar.
const abrir = (ruta) => page.goto(`${BASE}${ruta}`, { waitUntil: "load", timeout: 30000 });

// Lo que se descarga, entero, y si es un PDF con contenido: lo mismo por las dos puertas.
const leerPdf = async (descarga) => {
  const trozos = [];
  for await (const trozo of await descarga.createReadStream()) trozos.push(trozo);
  return Buffer.concat(trozos);
};
const esUnPdfConContenido = (bytes) => bytes.subarray(0, 4).toString() === "%PDF" && bytes.length > 10_000;

// Primero se entra y después se siembra: la cartera de muestra va al
// almacenamiento de la sesión, y sembrarla antes de entrar la dejaría a merced
// de lo que el acceso haga con él.
await entrar(page, BASE);

// Siembra ÚNICA de la cartera de muestra en el origen de la app — con
// addInitScript el seed re-corría en cada reload y machacaba lo que la app
// persiste (imposible verificar F2.7).
await page.goto(`${BASE}/buscador`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(SEED_SCRIPT, SEED_POSITIONS);

// 1 · La raíz lleva a Diseño (mapa 15→9: /inicio ya no existe).
await abrir("/");
await page.waitForURL((url) => url.pathname === "/cartera", { timeout: 15000 }).catch(() => {});
check(new URL(page.url()).pathname === "/cartera", `la raíz canonicaliza a /cartera (actual: ${new URL(page.url()).pathname})`);

// 2 · N1: teclear el capital no pierde el foco ni borra candados.
const capitalInput = page.getByLabel("Capital total en euros");
await capitalInput.waitFor({ state: "visible", timeout: 15000 });

const firstLock = page.locator("button.portfolio-lock").first();
await firstLock.waitFor({ state: "visible", timeout: 15000 });
await firstLock.click();
check((await firstLock.getAttribute("aria-pressed")) === "true", "el candado de la primera posición se activa");

await capitalInput.click({ clickCount: 3 });
await page.keyboard.type("250000", { delay: 40 });
const focusStable = await page.evaluate(() => {
  const active = document.activeElement;
  return Boolean(active && active.matches("input[aria-label=\"Capital total en euros\"]"));
});
check(focusStable, "N1: el campo Capital conserva el foco tras teclear");
check(
  (await capitalInput.inputValue()) === "250000",
  `N1: entró el importe completo (valor: ${await capitalInput.inputValue()})`
);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check(
  (await firstLock.getAttribute("aria-pressed")) === "true",
  "N1: el candado sobrevive a la edición del capital"
);

// 3 · Convención española (revisión 12-08): «20.000» son veinte mil euros,
// no 20 — y el campo formatea al confirmar. El input type=number anterior
// se tragaba los puntos de miles.
await capitalInput.click({ clickCount: 3 });
await page.keyboard.type("20.000", { delay: 40 });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const formattedCapital = await capitalInput.inputValue();
check(formattedCapital === "20.000", `los miles con punto entran y se formatean (valor: ${formattedCapital})`);
await capitalInput.click({ clickCount: 3 });
await page.keyboard.type("250000", { delay: 30 });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);

// 4 · Persistencia del capital (F2.7): tras recargar, el capital se restaura.
await page.reload({ waitUntil: "load", timeout: 30000 });
await capitalInput.waitFor({ state: "visible", timeout: 15000 });
check((await capitalInput.inputValue()) === "250.000", `F2.7: el capital sobrevive a un F5, formateado es-ES (valor: ${await capitalInput.inputValue()})`);

// 5 · Informes: la lista de documentos monta sin alert() ni pantalla rota. Se
// mira el botón de la lista y no la descripción de la cabecera, que sale
// también cuando la pantalla está vacía o cargando.
const prepararInforme = page.getByRole("button", { name: "Preparar: Informe de la propuesta", exact: true });
await abrir("/cartera/informes");
const listaMontada = await prepararInforme.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
check(listaMontada, "la pantalla Informes enseña su lista de documentos, con el informe para el cliente");
check(sawDialog === null, `sin diálogos nativos en el recorrido${sawDialog ? ` (visto: ${sawDialog})` : ""}`);

// 6 · Análisis (fusión Resumen→Análisis): la lectura de salud y control, que
// en pantalla se titula «Qué conviene mirar».
await abrir("/analisis");
const lecturaMontada = await page.getByRole("heading", { name: "Qué conviene mirar", exact: true }).waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
check(lecturaMontada, "el Análisis enseña «Qué conviene mirar»");

// 7 · Una cartera de un solo activo no puede tener frontera, pero sí informe.
// Se descarga de verdad, por las dos puertas.
const dialogoDelInforme = page.getByRole("dialog", { name: "Informe de la propuesta", exact: true });
const descargar = dialogoDelInforme.getByRole("button", { name: "Descargar el informe", exact: true });
await page.evaluate(SEED_SCRIPT, [{ ...SEED_POSITIONS[0], weight_percent: 100 }]);
await abrir("/cartera/informes");
await page.getByRole("heading", { name: "Informes", exact: true }).waitFor();
// Que lo que se va a descargar sea de verdad la cartera de un activo: si la siembra no llegara a leerse, se descargaría
// el informe de las ocho posiciones y este paso daría en verde un caso que no ha probado.
const recuento = (await page.locator(".topbar-chip__count").innerText().catch(() => "")).trim();
check(/^1 posición/.test(recuento), `la propuesta sembrada tiene una sola posición (la barra dice «${recuento}»)`);
await prepararInforme.click();
await dialogoDelInforme.waitFor({ state: "visible" });
const downloading = page.waitForEvent("download", { timeout: 30_000 });
await descargar.click();
const pdf = await leerPdf(await downloading);
check(esUnPdfConContenido(pdf), `una cartera de un activo descarga su PDF desde Informes sin necesitar frontera (${pdf.length} bytes)`);

await abrir("/analisis");
await page.getByRole("button", { name: "Informe de la propuesta", exact: true }).click();
await dialogoDelInforme.waitFor({ state: "visible" });
const analysisDownloading = page.waitForEvent("download", { timeout: 30_000 });
await descargar.click();
const pdfDeAnalisis = await leerPdf(await analysisDownloading);
check(esUnPdfConContenido(pdfDeAnalisis), `Análisis también descarga el PDF del informe de un activo sin frontera (${pdfDeAnalisis.length} bytes)`);

check(sawDialog === null, `sin diálogos nativos hasta el final${sawDialog ? ` (visto: ${sawDialog})` : ""}`);
check(pageErrors.length === 0, `sin errores de página${pageErrors.length ? ` (${pageErrors[0]})` : ""}`);
console.log(`  (el navegador preguntó ${avisosAlSalir} ${avisosAlSalir === 1 ? "vez" : "veces"} antes de salir con cambios sin guardar: es lo previsto con la base en directo)`);

await browser.close();

if (failures.length > 0) {
  console.error(`\nhumo Diseño→Informe — ${failures.length} fallos`);
  process.exitCode = 1;
} else {
  console.log("\nhumo Diseño→Informe — en verde");
}
