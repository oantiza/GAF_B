/**
 * Cajas que se desplazan de lado: lo que el recorrido de la auditoría no veía (19-11-2026).
 *
 * Una caja con desplazamiento propio (`overflow-x: auto`) a la que su contenido no le cabe de ancho no desborda la
 * página, no corta ningún texto y no da error: lo que no cabe queda dentro, a un desplazamiento de distancia, y ninguna
 * otra medida lo ve. Así pasó en Diseño: de 1.180 a 1.280 px la tabla de posiciones pedía 590 px, su tarjeta medía
 * entre 543 y 583, y el botón «Quitar» de cada fila quedaba fuera de la vista, del todo o en parte, sin que nada lo
 * dijera (SISTEMA_DISENO.md, apartados 14.6 y 14.7).
 *
 * Que una tabla ancha se desplace dentro de su marco es lo previsto: es la regla del sistema para que no empuje la
 * página. Así que esto no es un fallo automático. De cada caja se recoge lo que hace falta para decidir:
 *  - cuánto pide y cuánto le cabe;
 *  - cuántos controles —botones, enlaces, campos— quedan fuera de la vista tal como se abre la pantalla, del todo o a
 *    medias. Una columna de cifras fuera es lo que tiene desplazarse; un botón fuera, alguien tiene que saberlo. Los
 *    botones de la cabecera de una tabla no cuentan: van con su columna;
 *  - y si lleva con qué enfocarla: la caja se enfoca, o lleva dentro algo que se enfoca. Se parece a la regla
 *    `scrollable-region-focusable` de axe-core y es más estricto: aquí cuenta una caja desde que le faltan 2 px (axe,
 *    cuando lo que no cabe pasa de 13), y no vale lo que lleva `tabindex="-1"` ni lo que no se ve. Y axe pasa en un
 *    solo ancho, salvo que se pida en todos, mientras que una caja solo se desplaza donde no cabe: aquí se mira en
 *    cada ancho. Que no lleve nada que se enfoque no quiere decir que no se alcance en ningún navegador: los hay que
 *    enfocan por su cuenta una caja que se desplaza (medido el 19-11-2026: el Chromium 151 de las pruebas se para en
 *    ella con el tabulador y la mueve con las flechas, si dentro no hay nada que se enfoque). Lo que se mide es que la
 *    página no lo garantiza.
 *
 * Lo que no ve: lo que queda fuera en vertical (desplazarse hacia abajo es lo corriente), lo que una caja recorta sin
 * dejar desplazarse (`overflow: hidden`; de eso, lo que es texto lo mide `textoCortado.mjs`), y si lo que queda fuera
 * y no es un control —una columna— hace falta para leer la fila.
 */

/**
 * Cuántas cajas corrientes se guardan de cada pantalla, como mucho. Las que alguien tiene que mirar —dejan un control
 * fuera de la vista, o no llevan nada que se enfoque— se guardan todas, y van las primeras.
 */
export const TOPE_DE_CAJAS_POR_PANTALLA = 12;

/**
 * Dentro de la página: las cajas con desplazamiento propio a las que su contenido no les cabe de ancho. Se pasa a
 * `page.evaluate`, así que no puede usar nada de fuera.
 */
export function recogerCajasQueSeDesplazan() {
  /* Lo que alguien busca para pulsar o para rellenar. */
  const CONTROLES = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';
  const recortar = (texto, largo) => (texto || "").trim().replace(/\s+/g, " ").slice(0, largo);
  const seVe = (el) => {
    if (el.closest("[hidden], [inert]")) return false;
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && caja.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  /* Lo que entra en el recorrido del tabulador: lo que se enfoca por ser lo que es, o lo que lleva un `tabindex` que no
     sea negativo. Lo desactivado y un campo oculto no entran nunca, lleven el `tabindex` que lleven. */
  const seEnfoca = (el) => {
    if (el.matches(":disabled") || el.type === "hidden") return false;
    const indice = Number.parseInt(el.getAttribute("tabindex") ?? "", 10);
    if (Number.isFinite(indice)) return indice >= 0;
    return el.matches("a[href], summary, button, input, select, textarea");
  };
  const cajas = [];
  for (const elemento of document.querySelectorAll("body *")) {
    /* Un campo de varias líneas o una lista desplegable se desplazan por dentro, y no son cajas de la disposición. */
    if (elemento.matches("textarea, select, input")) continue;
    if (elemento.closest("[hidden], [aria-hidden='true'], [inert]")) continue;
    const estilo = getComputedStyle(elemento);
    if (estilo.overflowX !== "auto" && estilo.overflowX !== "scroll") continue;
    if (estilo.display === "none" || estilo.visibility === "hidden") continue;
    const pide = elemento.scrollWidth;
    const tiene = elemento.clientWidth;
    /* Con un píxel de más, que es redondeo, no se desplaza. */
    if (!(tiene > 0) || pide <= tiene + 1) continue;
    const caja = elemento.getBoundingClientRect();
    if (caja.height <= 0) continue;
    /* Lo que se ve de la caja, de lado: de su borde izquierdo adentro, lo que le cabe. */
    const izquierda = caja.left + (Number.parseFloat(estilo.borderLeftWidth) || 0);
    const derecha = izquierda + tiene;
    let controles = 0;
    let delTodo = 0;
    let ejemplo = "";
    for (const control of elemento.querySelectorAll(CONTROLES)) {
      /* Un botón de la cabecera de una tabla va con su columna: si la columna queda fuera, él también, y no hay otra
         cosa que saber. La cabecera, se escriba como se escriba. */
      if (control.closest("thead, th[scope='col'], [role='columnheader']") || !seVe(control)) continue;
      const suya = control.getBoundingClientRect();
      const entero = suya.left >= derecha - 1 || suya.right <= izquierda + 1;
      const aMedias = !entero && (suya.right > derecha + 1 || suya.left < izquierda - 1);
      if (!entero && !aMedias) continue;
      controles += 1;
      if (entero) delTodo += 1;
      /* Su nombre: lo primero que tenga algo escrito. Una etiqueta de solo espacios no es un nombre. */
      if (!ejemplo) {
        const candidatos = [control.getAttribute("aria-label"), control.textContent, control.getAttribute("title"), control.getAttribute("placeholder"), control.getAttribute("name")];
        ejemplo = candidatos.map((candidato) => recortar(candidato, 40)).find(Boolean) || control.tagName.toLowerCase();
      }
    }
    const conTeclado = seEnfoca(elemento) || [...elemento.querySelectorAll("a, button, input, select, textarea, summary, [tabindex]")].some((dentro) => seEnfoca(dentro) && seVe(dentro));
    /* Cómo se llama, para encontrarla: su etiqueta, o la de la tabla que lleva dentro. */
    const tabla = elemento.querySelector("table");
    const rotulada = (elemento.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const clases = typeof elemento.className === "string" ? elemento.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    cajas.push({
      firma: `${elemento.tagName.toLowerCase()}${clases ? "." + clases : ""}`,
      nombre: recortar(elemento.getAttribute("aria-label") || rotulada || tabla?.getAttribute("aria-label") || tabla?.querySelector("caption")?.textContent, 60),
      pide,
      tiene,
      fuera: pide - tiene,
      controles,
      delTodo,
      ejemplo,
      conTeclado
    });
  }
  return cajas;
}

/** Una caja, en una línea del informe: quién es, cuánto deja fuera, qué controles esconde y si lleva con qué enfocarla. */
export function describirCaja(caja) {
  const partes = [`${caja.firma}${caja.nombre ? ` «${caja.nombre}»` : ""}: pide ${caja.pide} px y le caben ${caja.tiene} (${caja.fuera} px fuera de la vista)`];
  if (caja.controles === 1) {
    partes.push(`1 control fuera, ${caja.delTodo ? "del todo" : "a medias"}${caja.ejemplo ? `: «${caja.ejemplo}»` : ""}`);
  } else if (caja.controles > 1) {
    const aMedias = caja.controles - caja.delTodo;
    const reparto = aMedias === 0 ? "todos del todo" : caja.delTodo === 0 ? "todos a medias" : `${caja.delTodo} del todo y ${aMedias} a medias`;
    partes.push(`${caja.controles} controles fuera, ${reparto}${caja.ejemplo ? `; el primero, «${caja.ejemplo}»` : ""}`);
  }
  if (!caja.conTeclado) partes.push("no se enfoca ni lleva dentro nada que se enfoque");
  return partes.join("; ");
}

/**
 * Lo recogido en una pantalla, para su fila del informe: las cajas, con las que alguien tiene que mirar por delante
 * —las que dejan un control fuera de la vista, las que no llevan nada que se enfoque y, después, las que más dejan
 * fuera—, y las cuentas hechas sobre todas, no solo sobre las que se guardan. Las de mirar se guardan todas: el tope es
 * para las corrientes, que si no una pantalla con muchas escondería justo la que importa.
 */
export function resumirCajasQueSeDesplazan(cajas) {
  const hayQueMirarla = (caja) => caja.controles > 0 || !caja.conTeclado;
  const ordenadas = [...cajas].sort((a, b) => Number(b.controles > 0) - Number(a.controles > 0) || Number(a.conTeclado) - Number(b.conTeclado) || b.fuera - a.fuera);
  return {
    cajasDesplazables: [...ordenadas.filter(hayQueMirarla), ...ordenadas.filter((caja) => !hayQueMirarla(caja)).slice(0, TOPE_DE_CAJAS_POR_PANTALLA)],
    cajasQueSeDesplazan: cajas.length,
    cajasConControlesFuera: cajas.filter((caja) => caja.controles > 0).length,
    cajasSinTeclado: cajas.filter((caja) => !caja.conTeclado).length
  };
}
