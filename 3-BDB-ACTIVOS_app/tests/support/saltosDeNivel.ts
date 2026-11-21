/**
 * MAR-32 (14-11-2026): `h1` la pantalla, `h2` cada bloque, `h3` lo que va dentro de un bloque. Quien recorre una página
 * por encabezados con un lector de pantalla no debe pasar de un nivel a otro dos por debajo (del `h1` al `h3`, del `h2` al
 * `h4`): se pierde la estructura.
 *
 * Se cuentan solo los encabezados que se ven: los que están dentro de `[hidden]` (una pestaña no elegida, el cuerpo de un
 * panel plegado) o de `[aria-hidden="true"]` no los lee nadie.
 */

const ENCABEZADOS = "h1, h2, h3, h4, h5, h6";

/** Los encabezados visibles, en el orden del documento, con su nivel y su texto. */
export function encabezadosVisibles(contenedor: ParentNode): Array<{ nivel: number; texto: string }> {
  return [...contenedor.querySelectorAll<HTMLElement>(ENCABEZADOS)]
    .filter((encabezado) => !encabezado.closest("[hidden]") && !encabezado.closest('[aria-hidden="true"]'))
    .map((encabezado) => ({ nivel: Number(encabezado.tagName.slice(1)), texto: (encabezado.textContent ?? "").replace(/\s+/g, " ").trim() }));
}

/**
 * Los saltos de más de un nivel hacia abajo entre dos encabezados visibles seguidos, escritos para que el fallo diga
 * dónde está: «h2 «Riesgo» → h4 «Caída máxima»». Subir de nivel (del `h4` al `h2`) no es un salto: es cerrar una sección.
 */
export function saltosDeNivel(contenedor: ParentNode): string[] {
  const saltos: string[] = [];
  let anterior: { nivel: number; texto: string } | null = null;
  for (const actual of encabezadosVisibles(contenedor)) {
    if (anterior && actual.nivel > anterior.nivel + 1) {
      saltos.push(`h${anterior.nivel} «${anterior.texto}» → h${actual.nivel} «${actual.texto}»`);
    }
    anterior = actual;
  }
  return saltos;
}
