/**
 * El foco del teclado, a la vista aunque la tabla tenga columnas fijas (WCAG 2.4.11; dirección A, 18-11-2026).
 *
 * Una tabla que se desplaza de lado con su primera columna y la de acciones fijas (`position: sticky`) tapa lo que
 * pasa por debajo de ellas. Al llegar con el tabulador a algo que está en la zona desplazable pero bajo una columna
 * fija, el navegador no desplaza nada —para él ya está a la vista— y el foco se pierde. No tiene arreglo en CSS:
 * `scroll-margin-inline` no actúa al enfocar algo que ya está en la zona visible, y `scroll-padding-inline` en el marco
 * hace saltar la tabla de un extremo a otro al recorrer las filas. Así que la tabla lo corrige al recibir el foco.
 */

/** Un tramo horizontal, en píxeles de la ventana: lo que ocupa algo de izquierda a derecha. */
export interface Tramo {
  left: number;
  right: number;
}

/** El aire que queda entre lo enfocado y la columna fija: deja ver entero el anillo de foco, que va por fuera. */
export const MARGEN_DEL_FOCO = 8;

export interface FocoEnLaTabla {
  /** Lo enfocado. */
  enfocado: Tramo;
  /** La parte visible del contenedor que se desplaza (su caja de relleno, sin la barra de desplazamiento). */
  vista: Tramo;
  /** Las celdas de la fila de lo enfocado fijadas a la izquierda (`left`), como el nombre. */
  fijasALaIzquierda: Tramo[];
  /** Las fijadas a la derecha (`right`), como las acciones. */
  fijasALaDerecha: Tramo[];
  /** Si lo enfocado está dentro de una celda fija: entonces se mueve con ella y nunca queda tapado. */
  enCeldaFija: boolean;
}

/**
 * Cuántos píxeles hay que desplazar el contenedor para que lo enfocado quede a la vista: positivo, hacia la derecha
 * (lo enfocado se va a la izquierda); negativo, hacia la izquierda; cero, si ya se ve entero o va en una celda fija.
 *
 * La zona libre va del borde derecho de las fijas de la izquierda al borde izquierdo de las de la derecha. Qué lado
 * tapa lo dice cómo está fijada la celda, no dónde cae: algo que asoma más allá del centro de la columna de acciones
 * sigue tapado por la derecha. Si lo enfocado no cabe entero en la zona libre, manda su principio: es por donde se
 * empieza a leer.
 */
export function desplazamientoParaElFoco(
  { enfocado, vista, fijasALaIzquierda, fijasALaDerecha, enCeldaFija }: FocoEnLaTabla,
  margen = MARGEN_DEL_FOCO
): number {
  /* Sin columnas fijas, lo que haga falta lo hace el navegador, como en cualquier tabla. */
  if (enCeldaFija || fijasALaIzquierda.length + fijasALaDerecha.length === 0) return 0;
  const desde = Math.max(vista.left, ...fijasALaIzquierda.map((fija) => fija.right));
  const hasta = Math.min(vista.right, ...fijasALaDerecha.map((fija) => fija.left));
  if (enfocado.left >= desde && enfocado.right <= hasta) return 0;
  const aLaIzquierda = enfocado.left - desde - margen;
  if (enfocado.left < desde) return aLaIzquierda;
  const aLaDerecha = enfocado.right - hasta + margen;
  /* Si al traerlo desde la derecha su principio se metiera bajo la columna de la izquierda, se alinea por el principio. */
  return enfocado.left - aLaDerecha < desde ? aLaIzquierda : aLaDerecha;
}

/** El antepasado más cercano que se desplaza de lado: el marco de la tabla, o la zona de la pantalla que lo contiene. */
function contenedorQueSeDesplaza(desde: Element): HTMLElement | null {
  for (let nodo = desde.parentElement; nodo; nodo = nodo.parentElement) {
    if (nodo.scrollWidth > nodo.clientWidth && /auto|scroll/.test(getComputedStyle(nodo).overflowX)) return nodo;
  }
  return null;
}

function seEnfocoConElTeclado(elemento: Element): boolean {
  try {
    return elemento.matches(":focus-visible");
  } catch {
    /* Un navegador que no entienda `:focus-visible` no distingue el ratón del teclado: mejor no mover nada. */
    return false;
  }
}

/**
 * Si lo enfocado con el teclado queda bajo una celda fija de su fila, desplaza de lado lo justo el contenedor que se
 * desplaza. Sin animación: un salto corto se sigue mejor que un deslizamiento, y no pide nada a quien quiere menos
 * movimiento. Un clic del ratón no mueve nada: quien pulsa ya ve dónde pulsa.
 */
export function descubrirElFoco(enfocado: Element): void {
  if (!seEnfocoConElTeclado(enfocado)) return;
  const fila = enfocado.closest("tr");
  if (!fila) return;
  const contenedor = contenedorQueSeDesplaza(enfocado);
  if (!contenedor) return;
  /* Fija de lado: las celdas de la cabecera son todas `sticky` para quedarse arriba, pero solo las que fijan su
     izquierda o su derecha tapan a sus vecinas al desplazar. */
  const ladoFijo = (celda: Element): "izquierda" | "derecha" | null => {
    const estilo = getComputedStyle(celda);
    if (estilo.position !== "sticky") return null;
    if (estilo.left !== "auto") return "izquierda";
    return estilo.right !== "auto" ? "derecha" : null;
  };
  const celdaPropia = enfocado.closest("th, td");
  const otras = [...fila.children].filter((celda) => celda !== celdaPropia);
  const fijasDe = (lado: "izquierda" | "derecha") =>
    otras.filter((celda) => ladoFijo(celda) === lado).map((celda) => celda.getBoundingClientRect());
  const caja = contenedor.getBoundingClientRect();
  const izquierda = caja.left + contenedor.clientLeft;
  const desplazamiento = desplazamientoParaElFoco({
    enfocado: enfocado.getBoundingClientRect(),
    vista: { left: izquierda, right: izquierda + contenedor.clientWidth },
    fijasALaIzquierda: fijasDe("izquierda"),
    fijasALaDerecha: fijasDe("derecha"),
    enCeldaFija: celdaPropia !== null && ladoFijo(celdaPropia) !== null
  });
  if (desplazamiento !== 0) contenedor.scrollLeft += desplazamiento;
}
