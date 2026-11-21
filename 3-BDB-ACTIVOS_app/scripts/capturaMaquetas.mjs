/**
 * Fotografía las maquetas del sistema de diseño (`docs/frontend/maquetas/*.html`) y deja un PNG junto a cada una.
 *
 *   node scripts/capturaMaquetas.mjs            # todas, a 1.440 px de ancho
 *   node scripts/capturaMaquetas.mjs ficha      # solo las que contienen «ficha»
 *
 * Las maquetas son HTML estático que usa `sistema.css`: los tokens y las piezas propuestos en
 * `docs/frontend/SISTEMA_DISENO.md`. No son código de la aplicación.
 */
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAQUETAS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "frontend", "maquetas");
const filtro = process.argv[2] || "";
const paginas = readdirSync(MAQUETAS).filter((nombre) => nombre.endsWith(".html") && nombre.includes(filtro));

const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const nombre of paginas) {
  /* Cada maqueta declara su ancho en `<meta name="ancho">`; sin él, 1.440 px. */
  const page = await navegador.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(MAQUETAS, nombre)).href, { waitUntil: "load" });
  const ancho = await page.evaluate(() => Number(document.querySelector('meta[name="ancho"]')?.getAttribute("content")) || 1440);
  if (ancho !== 1440) {
    await page.setViewportSize({ width: ancho, height: 900 });
    await page.reload({ waitUntil: "load" });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(MAQUETAS, nombre.replace(/\.html$/, ".png")), fullPage: true });
  console.log(`${nombre} → ${nombre.replace(/\.html$/, ".png")} (${ancho} px)`);
  await page.close();
}
await navegador.close();
