import { useEffect, useRef, type RefObject } from "react";

/** Una pantalla que aún no tiene título no deja el foco en el botón que la abrió más de esto. */
const ESPERA_ANTES_DEL_CONTENIDO_MS = 1500;
/** Una ficha puede tardar en llegar, y hasta entonces no tiene título: se sigue mirando un rato. */
const ESPERA_MAXIMA_MS = 6000;

/**
 * Al navegar, el foco va al título de la pantalla (hallazgo 86 de la auditoría del 04-11-2026).
 *
 * Sin esto se quedaba en el menú: quien va con teclado cambiaba de pantalla y tenía que volver a
 * recorrer todo el marco, y un lector de pantalla no anunciaba que algo hubiera cambiado.
 *
 * Las pantallas se cargan a trozos y su título llega tarde, así que se vigila el contenedor hasta
 * que aparece. Y el foco solo se mueve si nadie lo ha movido ya: una pantalla con un campo que se
 * enfoca solo, un diálogo abierto o alguien que ha seguido tabulando mandan sobre esto.
 *
 * `clave` es lo que identifica la pantalla. La primera vez no hace nada: al entrar en la aplicación
 * el foco se queda donde está, para que «Saltar al contenido» sea la primera parada.
 */
export function useFocoAlTitulo(clave: string, contenedor: RefObject<HTMLElement | null>): void {
  const claveAnterior = useRef(clave);

  useEffect(() => {
    /* Comparando la clave y no con una marca de «primera vez»: el modo estricto de React monta
       dos veces, y una marca haría que la segunda pareciera una navegación. */
    if (claveAnterior.current === clave) return;
    claveAnterior.current = clave;
    const raiz = contenedor.current;
    if (!raiz) return;

    const origen = document.activeElement;
    let destino: HTMLElement | null = null;

    const sigueLibre = () => {
      const activo = document.activeElement;
      return !activo || activo === document.body || activo === origen || activo === destino;
    };

    const enfocar = (elemento: HTMLElement) => {
      if (document.activeElement === elemento) return;
      /* Un título no se enfoca por defecto; con -1 se puede enfocar por código sin añadir una
         parada más al tabulador. */
      if (!elemento.hasAttribute("tabindex")) elemento.setAttribute("tabindex", "-1");
      elemento.focus({ preventScroll: true });
      destino = elemento;
    };

    const buscarElTitulo = () => {
      if (!sigueLibre()) {
        parar();
        return;
      }
      const titulo = raiz.querySelector<HTMLElement>("h1");
      if (titulo) enfocar(titulo);
    };

    const observador = new MutationObserver(buscarElTitulo);
    const alContenido = window.setTimeout(() => {
      if (!destino && sigueLibre()) enfocar(raiz);
    }, ESPERA_ANTES_DEL_CONTENIDO_MS);
    const alFinal = window.setTimeout(() => parar(), ESPERA_MAXIMA_MS);

    function parar() {
      observador.disconnect();
      window.clearTimeout(alContenido);
      window.clearTimeout(alFinal);
      window.removeEventListener("keydown", parar, true);
      window.removeEventListener("pointerdown", parar, true);
    }

    observador.observe(raiz, { childList: true, subtree: true });
    /* Quien pulsa o teclea ya sabe adónde va: desde ese momento el foco es suyo. */
    window.addEventListener("keydown", parar, true);
    window.addEventListener("pointerdown", parar, true);
    buscarElTitulo();

    return parar;
  }, [clave, contenedor]);
}
