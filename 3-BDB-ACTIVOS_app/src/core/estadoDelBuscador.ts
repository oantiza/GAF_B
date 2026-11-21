import type { EstadoDeTabla } from "../types/tablaDeDatos";

/**
 * Por dónde va el Buscador: lo tecleado, los filtros, el orden, la página y lo desplazado.
 *
 * Lo guarda el marco, en memoria, y dura lo que dura la sesión: al abrir una ficha y volver, la lista
 * sigue donde estaba, sin rehacer el filtro. Antes todo esto moría con la pantalla: la búsqueda «Fondo»
 * volvía vacía, de 100 resultados se pasaba a 200 y de la página 2 a la 1.
 *
 * Vive aparte de la pantalla para que el marco no tenga que cargarla entera solo para saber cómo
 * empieza.
 */
export const TODAS = "TODAS";

export type TipoDelBuscador = "TODOS" | "FUND" | "STOCK" | "ETF";

export interface EstadoDelBuscador {
  tipo: TipoDelBuscador;
  busqueda: string;
  clase: string;
  region: string;
  /** Opcional: un estado guardado antes del 06-11-2026 no la trae, y vale «Todas». */
  categoria?: string;
  soloFavoritos: boolean;
  tabla: EstadoDeTabla;
  /** Lo desplazada que estaba la pantalla al abrir una ficha, para volver al mismo sitio. */
  desplazamiento: { pagina: number; arriba: number; izquierda: number } | null;
}

export const ESTADO_INICIAL_DEL_BUSCADOR: EstadoDelBuscador = {
  tipo: "TODOS",
  busqueda: "",
  clase: TODAS,
  region: TODAS,
  categoria: TODAS,
  soloFavoritos: false,
  /* Por nombre y con su flecha: la lista arrancaba por ISIN sin decirlo. */
  tabla: { orden: "nombre", sentido: 1, pagina: 1 },
  desplazamiento: null
};

/** Si hay algo que limpiar. El orden no cuenta: no quita filas. */
export function hayCriteriosDeBusqueda(estado: EstadoDelBuscador): boolean {
  return (
    estado.busqueda.trim() !== "" ||
    estado.tipo !== "TODOS" ||
    estado.clase !== TODAS ||
    estado.region !== TODAS ||
    (estado.categoria ?? TODAS) !== TODAS ||
    estado.soloFavoritos
  );
}
