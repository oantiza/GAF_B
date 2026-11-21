/**
 * La barra de desplazamiento, en las fotos y en las medidas (19-11-2026).
 *
 * Playwright lanza el navegador sin cabeza con las barras ocultas, y la foto de página entera las deja fuera aunque se
 * pongan. En una ventana de verdad la barra de la página ocupa sitio: 10 px, medido en un Chromium con ventana (la
 * aplicación la pide estrecha en `base.css`). Así que toda la batería medía con 10 px más de contenido que la pantalla
 * real: a 1.280 px la lista del calendario de Mercado medía 926 px en la foto y 916 en la ventana, y un nombre que en la
 * foto cabía entero, en la ventana salía cortado.
 *
 * Lo que se hace:
 *  - Con ratón, el navegador se lanza con las barras puestas, y si la página desplaza se reserva el hueco de la barra
 *    (`scrollbar-gutter: stable`). Con el hueco reservado, la foto de página entera pinta el mismo ancho que la ventana:
 *    medido, 916 px en las dos. Sin él, la foto vuelve a disponer la página sin barra, y además la deja sin barra para
 *    lo que se mida después en esa misma pantalla.
 *  - Con dedo no hay barra que ocupe sitio (en una tableta va superpuesta), así que se quita con una hoja: sin ella, el
 *    navegador de escritorio que hace de tableta le pondría la suya.
 *  - Una pantalla que no desplaza no tiene barra, tampoco en una ventana de verdad: ahí no se reserva nada.
 *
 * Todo esto es de la barra de la página. La de un bloque que desplaza por dentro (una tabla ancha, la lista del menú)
 * es suya y no se toca; y como la foto de página entera agranda la ventana, un bloque que mide lo que mide la ventana
 * puede salir en la foto sin la barra que tenía al medirlo. Lo que se mide, se mide antes de la foto.
 *
 * `AUDIT_BARRAS=ocultas` deja las barras como las dejaba Playwright, para repetir una pasada antigua y poder compararla.
 */

/** Si la pasada se hace como antes del 19-11-2026, con las barras ocultas. */
export const BARRAS_OCULTAS = process.env.AUDIT_BARRAS === "ocultas";
const OCULTAS = BARRAS_OCULTAS;

/** Opciones de lanzamiento del navegador: con las barras puestas, salvo que se pida repetir una pasada antigua. */
export const lanzamiento = (opciones = {}) => (OCULTAS ? opciones : { ...opciones, ignoreDefaultArgs: ["--hide-scrollbars"] });

const HOJA_SIN_BARRAS = "html, body, * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }";

/** Un contexto con dedo: en cada documento que abra, ninguna barra ocupa sitio, como en una tableta. */
export async function sinBarrasDeTableta(contexto) {
  if (OCULTAS) return;
  await contexto.addInitScript((hoja) => {
    const poner = () => {
      if (document.getElementById("sin-barras-de-tableta")) return;
      const estilo = document.createElement("style");
      estilo.id = "sin-barras-de-tableta";
      estilo.textContent = hoja;
      (document.head ?? document.documentElement).append(estilo);
    };
    if (document.head) poner();
    else document.addEventListener("DOMContentLoaded", poner, { once: true });
  }, HOJA_SIN_BARRAS);
}

/**
 * Con ratón, antes de medir y de fotografiar una pantalla: si desplaza, se reserva el hueco de su barra. Devuelve los
 * píxeles que la barra le quita al contenido en ese momento (0 si la pantalla no desplaza, o con dedo).
 */
export async function reservarHuecoDeLaBarra(page) {
  if (OCULTAS) return 0;
  return page.evaluate(() => {
    if (matchMedia("(pointer: coarse)").matches) return 0;
    document.getElementById("hueco-de-la-barra")?.remove();
    if (document.documentElement.scrollHeight > window.innerHeight) {
      const estilo = document.createElement("style");
      estilo.id = "hueco-de-la-barra";
      estilo.textContent = "html { scrollbar-gutter: stable !important; }";
      document.head.append(estilo);
    }
    /* Se mide en el cuerpo y no en el documento: después de una foto de página entera el documento dice que no hay
       barra aunque su hueco siga reservado. */
    return Math.max(0, Math.round(window.innerWidth - document.body.getBoundingClientRect().width));
  });
}
