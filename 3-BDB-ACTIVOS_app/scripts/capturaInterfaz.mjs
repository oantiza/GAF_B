import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SEED_POSITIONS, SEED_SCRIPT } from "./carteraDeMuestra.mjs";
import { fotoDePaginaEntera } from "./fotoDePaginaEntera.mjs";
import { resolverAnchos } from "./anchosDeCaptura.mjs";
import { BARRAS_OCULTAS, lanzamiento, reservarHuecoDeLaBarra, sinBarrasDeTableta } from "./barraDeDesplazamiento.mjs";
import { baseDeLaApp, entrar } from "./entrarEnLaApp.mjs";

// El destino sale del entorno (AUDIT_BASE); sin el, el servidor de desarrollo, http://localhost:5174.
const BASE = baseDeLaApp();
// Salida: 3er argumento, o BDB_SHOTS_DIR, o output/shots/ (ignorado por Git).
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[3] || process.env.BDB_SHOTS_DIR || resolve(REPO, "output/shots");
// Los anchos son los de anchosDeCaptura.mjs, que comparte con el recorrido de la auditoria:
// los seis de trabajo por su nombre (xl,l,d,p,t,tp), «estrecha» (1025, 1100, 1180 y 1240, donde
// cambia la disposicion y mas aprieta el contenido) o un ancho en pixeles, con una «d» detras
// si es con dedo (1180d). Con raton se fotografia con la barra de desplazamiento puesta, que
// es como se ve en una ventana; con dedo, sin ella (barraDeDesplazamiento.mjs).

// Mapa de la ola 3b: 9 destinos + deep-links del Constructor.
const ROUTES = [
  ["mercado", "/mercado"],
  ["buscador", "/buscador"],
  ["comparador", "/comparador"],
  ["cartera", "/cartera"],
  ["optimizacion", "/cartera/optimizacion"],
  ["informes", "/cartera/informes"],
  ["guardadas", "/carteras-guardadas"],
  ["analisis", "/analisis"],
  ["cartera-real", "/cartera-real"],
  ["posiciones", "/posiciones"],
  ["jubilacion", "/jubilacion"],
  ["planes", "/jubilacion/planes"],
  ["sistema", "/sistema"],
];

const which = resolverAnchos(process.argv[2], "d");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(lanzamiento(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
const report = [];

for (const { clave: key, ancho: w, alto: h, conDedo: conDedoPedido } of which) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: conDedoPedido, deviceScaleFactor: 1, locale: "es-ES" });
  if (conDedoPedido) await sinBarrasDeTableta(ctx);
  await ctx.addInitScript(SEED_SCRIPT, SEED_POSITIONS);
  const page = await ctx.newPage();

  /* ENTRAR. Sin esto la bateria fotografia once veces la pantalla de acceso y dice
     «0 issues»: comprobado el 03-11-2026, las once capturas salieron byte a byte
     identicas. Un resultado valido afirmando otra cosa, que es justo el defecto que
     este proyecto persigue.

     Las credenciales NO viven aqui: son las que imprime `npm run seed:emulator-user`,
     validas solo contra el emulador local, y se pasan por entorno. Como se entra lo dice
     entrarEnLaApp.mjs, que comparte con el recorrido: si la aplicacion pide acceso y no se
     puede entrar, la pasada se para ahi y lo dice, en vez de fotografiar el acceso. */
  await entrar(page, BASE);

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));

  for (const [name, path] of ROUTES) {
    errors.length = 0;
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
    } catch { /* keep going */ }
    await page.waitForTimeout(1200);
    /* Antes de medir y de fotografiar: si la pantalla desplaza, su barra ocupa sitio, y la foto tiene que llevarlo. */
    const barra = await reservarHuecoDeLaBarra(page);
    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const over = [];
      const vw = de.clientWidth;
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 2 || r.left < -2)) {
          const s = getComputedStyle(el);
          // ignore elements inside a scroll container
          let p = el.parentElement, contained = false;
          while (p) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflowX === "hidden") { contained = true; break; }
            p = p.parentElement;
          }
          if (!contained && s.position !== "fixed") {
            over.push(`${el.tagName.toLowerCase()}.${(el.className && typeof el.className === "string" ? el.className : "").split(" ").filter(Boolean).slice(0, 3).join(".")} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
          }
        }
      });
      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        scrollH: de.scrollHeight,
        clientH: window.innerHeight,
        title: document.title,
        h1: document.querySelector("h1,h2")?.textContent?.slice(0, 60) ?? "",
        overflow: [...new Set(over)].slice(0, 6),
        /* La cartera de muestra puede dejar de resolverse sin que nada falle: el
           lector devuelve una posicion vacia y la pantalla, honesta, escribe que no
           encuentra el activo. Paso el 03-11-2026 con un indice base de benchmark
           metido en la muestra, y la bateria lo fotografio sin decir nada. */
        /* El color no puede ser la UNICA senal de un estado. El 03-11-2026 se
           afirmo tres veces, sin medirlo, que tres indicadores lo eran —la esfera
           de salud, las barras del control operativo y la flecha de estrategia— y
           los tres llevaban palabra, `aria-label` o glifo. Esto lo mide: un
           elemento cuya clase declara un estado y que no tiene texto propio, ni
           `aria-label` suyo o heredado, ni texto en su padre. */
        soloColor: [...document.querySelectorAll("[class]")]
          .filter((el) => {
            const cls = typeof el.className === "string" ? el.className : "";
            if (!/\b(is-(ok|warn|fail|missing|partial|unknown|error|success|bad|secure|feasible|blocked)|(^|\s)(pos|neg)(\s|$))/.test(cls)) return false;
            if ((el.textContent || "").trim()) return false;
            if (el.getAttribute("aria-label") || el.closest("[aria-label]")) return false;
            return !(el.parentElement?.textContent || "").trim();
          })
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`)
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 4),
        sinResolver: [...document.querySelectorAll("body *")]
          .filter((el) => el.children.length === 0
            && /Activo no encontrado|no existe en la fuente de datos activa/.test(el.textContent || ""))
          .map((el) => (el.textContent || "").trim().slice(0, 80))
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 4),
      };
    });
    await fotoDePaginaEntera(page, `${OUT}/${key}-${name}.png`);
    /* A 1024 y 768 —y en un ancho pedido con dedo— la foto tiene que ser con el dedo, y después de la foto también: es lo
       que se había roto sin que nadie lo viera (fotoDePaginaEntera.mjs). */
    const conDedo = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    /* Con raton, una pantalla mas alta que la ventana tiene barra: si mide cero, el navegador no la esta pintando y
       la pasada vuelve a medir con sitio de mas, que es lo que se vino a quitar. */
    const sinBarra = !BARRAS_OCULTAS && !conDedoPedido && metrics.scrollH > metrics.clientH + 1 && barra === 0;
    report.push({ w: key, name, ...metrics, barra, sinBarra, conDedoComoDebe: conDedo === conDedoPedido, errors: [...new Set(errors)].slice(0, 4) });
    process.stdout.write(`${key}/${name} ${metrics.scrollW}>${metrics.clientW ? metrics.clientW : "?"} h=${metrics.scrollH} ${metrics.overflow.length ? "OVERFLOW " + metrics.overflow.length : ""} ${metrics.errors ? "" : ""}\n`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.scrollW > r.clientW + 1 || r.errors.length || r.sinResolver.length || r.soloColor.length || !r.conDedoComoDebe || r.sinBarra);
console.log("\n=== ISSUES ===");
for (const r of bad) console.log(`${r.w}/${r.name} conDedoComoDebe=${r.conDedoComoDebe} scrollW=${r.scrollW} clientW=${r.clientW} ov=${JSON.stringify(r.overflow)} err=${JSON.stringify(r.errors)}${r.sinResolver.length ? " SIN RESOLVER " + JSON.stringify(r.sinResolver) : ""}${r.soloColor.length ? " SOLO COLOR " + JSON.stringify(r.soloColor) : ""}${r.sinBarra ? " SIN BARRA DE DESPLAZAMIENTO" : ""}`);
console.log("total routes:", report.length, "with issues:", bad.length);

/* Y la comprobacion que faltaba: si todas las rutas de un ancho pintan el MISMO
   titulo, no se ha recorrido la aplicacion, se ha fotografiado una pantalla once
   veces. Decir «0 issues» ahi es peor que fallar. */
const porAncho = new Map();
for (const r of report) porAncho.set(r.w, [...(porAncho.get(r.w) ?? []), r.h1]);
let atascada = false;
for (const [ancho, titulos] of porAncho) {
  if (titulos.length > 1 && new Set(titulos).size === 1) {
    atascada = true;
    console.error(`
NO SE RECORRIO NADA en ${ancho}: las ${titulos.length} rutas pintan «${titulos[0]}».`);
    console.error("No es por no haber entrado: de eso la pasada avisa al empezar y se para. Mira si es una pantalla de error del acceso, si la sesion se perdio a mitad de la pasada, o si AUDIT_BASE apunta a otro sitio.");
  }
}
if (atascada) process.exitCode = 1;
