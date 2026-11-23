/**
 * Las estrellas de Morningstar, enteras y entre 1 y 5 (ACT-21): un 3,5 pintaba 3 + 1 = 4 símbolos y un
 * 6 rompía la tabla con `RangeError`. Sin puntuación, o con 0, no hay estrellas que enseñar.
 *
 * Vive aquí, y no en un adaptador, porque la leen dos: la comparativa de activos y la lista del Buscador
 * (decisión A-172), y el primero ya importa del segundo.
 */
export function estrellasDeMorningstar(puntuacion: unknown): number | undefined {
  if (typeof puntuacion !== "number" || !Number.isFinite(puntuacion) || puntuacion <= 0) return undefined;
  return Math.min(5, Math.max(1, Math.round(puntuacion)));
}

/** Las cinco casillas, llenas las que tiene: «★★★☆☆». Las mismas en la comparativa y en la lista. */
export function textoDeEstrellas(estrellas: number): string {
  return `${"★".repeat(estrellas)}${"☆".repeat(5 - estrellas)}`;
}

/**
 * El rótulo de la columna o fila de las estrellas. De qué proveedor viene un dato es cocina y no se enseña a un cliente
 * (`fuenteDeDatos`; decisión 5 de la auditoría consolidada del 22-11-2026, H3-01): en Modo cliente y en el papel de
 * cliente es «Estrellas», como en Planes y EPSV (D-11); con la fuente a la vista —asesor sin Modo cliente, informe
 * interno—, «Morningstar».
 */
export function rotuloDeEstrellas(conProveedor: boolean): string {
  return conProveedor ? "Morningstar" : "Estrellas";
}
