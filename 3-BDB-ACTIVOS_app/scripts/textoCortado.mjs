/**
 * Textos cortados: lo que el recorrido de la auditoría no veía (19-11-2026).
 *
 * Un texto recortado con puntos suspensivos no desborda, no rompe nada y no da error: ninguna otra medida lo ve, y en
 * la captura solo se ve mirando de cerca. Pasó dos veces en dos días. «PRIVATE BANKERS» se quedaba en «PRIVATE BANKE…»
 * en el menú compacto, y en el calendario de Mercado se cortaban 37 de 39 nombres de evento a 1.100 px («FOMC Membe…»,
 * y varios eventos distintos se leían igual). Los dos salieron midiendo a mano.
 *
 * Aquí se mide: todo elemento con texto —suyo, o de su enlace o su negrita— que su hoja manda recortar —en una línea,
 * con puntos suspensivos o sin ellos, o a un número de líneas— y que tiene más texto del que le cabe. No es un fallo
 * automático: hay textos que ceden a propósito, y esos están en `CORTES_ADMITIDOS` con su motivo. Lo demás se enseña,
 * pantalla a pantalla, para que alguien decida si ese corte es aceptable.
 *
 * Lo que no ve: el texto de un desplegable o de un campo (no son nodos de texto que se puedan medir), el de un dibujo,
 * y el que se pierde porque una caja de alto fijo lo tapa sin que su hoja lo mande recortar.
 */

/**
 * Los cortes que están decididos, cada uno con su motivo y con dónde está escrita la decisión. No se cuentan como
 * texto cortado, pero el informe dice cuántos hubo. Uno con `hasta` solo se admite dentro de ese límite, por pantalla:
 * pasado el límite, se enseñan todos. La lista solo crece con una decisión escrita en `docs/frontend/SISTEMA_DISENO.md`.
 */
export const CORTES_ADMITIDOS = [
  {
    selector: ".topbar-crumbs__current, .topbar-chip__value, .topbar-account__email, .topbar-chip__count",
    motivo: "la barra superior cede en un orden fijo —la miga, el correo, el nombre de la propuesta y el recuento— para que el estado de la propuesta se lea siempre entero (apartado 14.2, «Barra superior»)"
  },
  {
    selector: ".economic-event-name",
    hasta: { textos: 3, px: 23 },
    motivo: "el calendario de Mercado va en una línea mientras al nombre le queden 246 px, y ahí se cortan como mucho los tres nombres más largos de los medidos, el peor por 23 px: decisión de Óscar del 19-11-2026, «En una línea» (apartado 14.5)"
  }
];

/**
 * Dentro de la página: los textos que su hoja manda recortar y a los que les falta sitio. Se pasa a `page.evaluate`, así
 * que no puede usar nada de fuera: los selectores admitidos le llegan como argumento, y de cada corte dice a cuál
 * responde (su posición en la lista, o −1).
 */
export function recogerTextoCortado(selectoresAdmitidos) {
  /* Los hijos que son texto y no estructura: el enlace o la negrita de un nombre. Se mira la etiqueta y no cómo se
     dispone, porque dentro de una caja recortada a un número de líneas el navegador trata a un enlace como un bloque. */
  const DE_TEXTO = new Set(["A", "ABBR", "B", "BDI", "BR", "CITE", "CODE", "DATA", "DFN", "EM", "I", "KBD", "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR"]);
  const cortados = [];
  const yaContados = [];
  for (const elemento of document.querySelectorAll("body *")) {
    if (elemento.closest("[hidden], [aria-hidden='true'], [inert], svg, script, style, noscript, .sr-only")) continue;
    /* Solo lo que lleva texto: suyo, o de hijos que son texto. El nombre de un activo va dentro de su enlace a la ficha,
       y quien lo recorta es el envoltorio, que no tiene ni una letra propia. Un contenedor que recorta bloques (una
       fila de tarjetas, un panel) no es un texto cortado. */
    const propio = [...elemento.childNodes].some((nodo) => nodo.nodeType === 3 && nodo.nodeValue.trim());
    const deSusHijos = !propio && elemento.children.length > 0 && Boolean((elemento.textContent || "").trim()) && [...elemento.children].every((hijo) => DE_TEXTO.has(hijo.tagName));
    if (!propio && !deSusHijos) continue;
    /* Si quien lo envuelve ya está contado, es el mismo corte. */
    if (yaContados.some((previo) => previo.contains(elemento))) continue;
    const estilo = getComputedStyle(elemento);
    if (estilo.display === "none" || estilo.visibility === "hidden") continue;
    const caja = elemento.getBoundingClientRect();
    if (caja.width < 8 || caja.height < 4) continue;
    const lineas = Number.parseInt(estilo.getPropertyValue("-webkit-line-clamp") || estilo.getPropertyValue("line-clamp"), 10);
    const recortaEnAncho = estilo.overflowX === "hidden" || estilo.overflowX === "clip";
    let medida = null;
    if (Number.isFinite(lineas) && lineas > 0) {
      /* A un número de líneas: sobra texto si lo que pide de alto pasa de lo que tiene. */
      if (elemento.scrollHeight > elemento.clientHeight + 1) medida = { tipo: "lineas", lineas, faltan: elemento.scrollHeight - elemento.clientHeight };
    } else if (recortaEnAncho && (estilo.whiteSpace === "nowrap" || estilo.textOverflow === "ellipsis")) {
      /* En una línea: sobra texto si lo que pide de ancho pasa de lo que tiene. Se mide en décimas de píxel —el texto
         con un rango, la caja con sus rellenos—, porque `scrollWidth` y `clientWidth` son enteros y no lo ven todo:
         medido el 19-11-2026, a un texto con puntos suspensivos le bastan 0,4 px de menos para perder tres letras,
         y los dos enteros salen iguales. Con puntos suspensivos el texto se corta en cuanto pasa de la caja de
         contenido; sin ellos se pinta también sobre el relleno de la derecha, y solo se corta al pasar de él. */
      const px = (valor) => Number.parseFloat(valor) || 0;
      /* Lo que pide: de la primera a la última cosa que lleva dentro. De su texto, lo que mide el texto; de un hijo,
         su caja, no el texto que el hijo lleve: un hijo que ya recorta el suyo (el nombre de la propuesta dentro de
         su recuadro) ocupa lo que mide su caja, y su corte se cuenta aparte, en él. */
      let izquierda = Infinity;
      let derecha = -Infinity;
      for (const nodo of elemento.childNodes) {
        let cajas = [];
        if (nodo.nodeType === 3 && nodo.nodeValue.trim()) {
          const rango = document.createRange();
          rango.selectNodeContents(nodo);
          cajas = [...(rango.getClientRects?.() ?? [])];
        } else if (nodo.nodeType === 1) {
          cajas = [...(nodo.getClientRects?.() ?? [])];
          /* Un hijo que no recorta lo suyo y lleva más de lo que mide su caja (un bloque estrecho, un hijo flexible
             al que se deja encoger) se sale de ella, y quien lo corta es este elemento: cuenta lo que pide, no lo que
             mide. De un hijo en línea no hay nada que sumar: su caja ya es su texto. */
          if (cajas.length && nodo.scrollWidth > nodo.clientWidth && !["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(nodo).overflowX)) {
            cajas.push({ left: cajas[0].left, right: cajas[0].left + nodo.scrollWidth, width: nodo.scrollWidth, height: cajas[0].height });
          }
        }
        for (const trozo of cajas) {
          if (trozo.width === 0 && trozo.height === 0) continue;
          izquierda = Math.min(izquierda, trozo.left);
          derecha = Math.max(derecha, trozo.right);
        }
      }
      const pide = derecha > izquierda ? derecha - izquierda : 0;
      const sitio = caja.width - px(estilo.borderLeftWidth) - px(estilo.borderRightWidth) - px(estilo.paddingLeft) - (estilo.textOverflow === "ellipsis" ? px(estilo.paddingRight) : 0);
      /* Donde no hay disposición que medir (las pruebas, sin navegador) el rango mide cero: se usan los enteros. */
      const falta = pide > 0 ? pide - sitio : elemento.scrollWidth - elemento.clientWidth;
      if (falta > 0.05) medida = { tipo: "linea", lineas: 1, faltan: Math.round(falta * 10) / 10 };
    }
    if (!medida) continue;
    yaContados.push(elemento);
    const clases = typeof elemento.className === "string" ? elemento.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    cortados.push({
      firma: `${elemento.tagName.toLowerCase()}${clases ? "." + clases : ""}`,
      texto: (elemento.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48),
      ...medida,
      admitido: selectoresAdmitidos.findIndex((selector) => elemento.matches(selector))
    });
  }
  return cortados;
}

/**
 * Lo recogido en una pantalla, resumido para el informe: una línea por clase de elemento, con cuántos textos corta, el
 * que más pierde y cuánto. Los admitidos se cuentan aparte; los de un corte admitido «hasta» un límite, solo mientras
 * la pantalla no lo pase.
 */
export function resumirTextoCortado(cortados, admitidos = CORTES_ADMITIDOS) {
  const dentroDelLimite = admitidos.map((corte, indice) => {
    if (!corte.hasta) return true;
    const suyos = cortados.filter((c) => c.admitido === indice);
    /* El límite está decidido en píxeles enteros, y la medida viene en décimas: se compara redondeada. */
    return suyos.length <= corte.hasta.textos && suyos.every((c) => Math.round(c.faltan) <= corte.hasta.px);
  });
  const seAdmite = (corte) => corte.admitido >= 0 && dentroDelLimite[corte.admitido];
  /* Un grupo por elemento y por forma de recortar: el mismo nombre va a una línea en una tabla y a tres en otra, y
     los píxeles de ancho que le faltan a uno no se comparan con los de alto que le faltan al otro. */
  const porFirma = new Map();
  for (const corte of cortados.filter((c) => !seAdmite(c))) {
    const clave = `${corte.firma}|${corte.tipo}`;
    const previo = porFirma.get(clave) ?? { firma: corte.firma, veces: 0, peor: corte };
    previo.veces += 1;
    if (corte.faltan > previo.peor.faltan) previo.peor = corte;
    porFirma.set(clave, previo);
  }
  const grupos = [...porFirma.values()].sort((a, b) => b.veces - a.veces || b.peor.faltan - a.peor.faltan);
  /* Los píxeles, como se escriben aquí: con coma, y con una décima solo por debajo de 10, que es donde importa. */
  const enPx = (valor) => (valor < 10 && !Number.isInteger(valor) ? valor.toFixed(1).replace(".", ",") : String(Math.round(valor)));
  return {
    textoCortado: grupos.map(({ firma, veces, peor }) => {
      const cuanto = peor.tipo === "lineas" ? `a ${peor.lineas} ${peor.lineas === 1 ? "línea" : "líneas"}, le faltan ${enPx(peor.faltan)} px de alto` : `le faltan ${enPx(peor.faltan)} px`;
      return `${firma}, ${veces} ${veces === 1 ? "texto" : "textos"}; el que más pierde, «${peor.texto}»: ${cuanto}`;
    }),
    textosCortados: grupos.reduce((suma, grupo) => suma + grupo.veces, 0),
    cortesAdmitidos: cortados.filter(seAdmite).length
  };
}
