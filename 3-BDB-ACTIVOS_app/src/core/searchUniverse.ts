import { numero } from "./formato";

/**
 * Estado del universo cargado en el Buscador (auditoría 27-07, D1).
 *
 * El backend recorta cada página a su tope (CAP_SEARCH_LIMIT = 200 en
 * functions_python/main.py). Antes el cliente pedía 1500, el backend devolvía
 * 200 en silencio y el aviso de recorte comparaba contra 1500: nunca se
 * mostraba. Con paginación real el aviso usa el total del servidor; si la
 * fuente no lo conoce (fallback sin índice o backend antiguo), se avisa de
 * forma conservadora al llegar al tope de página.
 */
export function buildUniverseNotice(
  loadedCount: number,
  totalMatches: number | null,
  pageLimit: number
): string | null {
  if (totalMatches !== null && loadedCount < totalMatches) {
    return `cargados ${numero(loadedCount)} de ${numero(totalMatches)} activos del catálogo`;
  }
  if (totalMatches === null && loadedCount >= pageLimit) {
    return "la lista puede estar recortada: amplía o afina la búsqueda";
  }
  return null;
}

export function hasMoreUniverse(
  nextCursor: string | null,
  loadedCount: number,
  totalMatches: number | null
): boolean {
  return nextCursor !== null && (totalMatches === null || loadedCount < totalMatches);
}
