import { getBrowserLocalStorage } from "./draftStorage";

/**
 * Los activos marcados como favoritos por el asesor.
 *
 * Vivía dentro de `AssetSearch`. Sale aquí el 02-11-2026 porque el buscador nuevo los
 * necesita, y **la clave tiene que ser la misma**: dos listas de favoritos bajo dos
 * claves distintas es perder las marcas al cambiar de pantalla sin que nadie avise.
 *
 * Es `localStorage` y no la base a propósito: es una preferencia de este navegador, no
 * un dato del cliente. Por eso cada acceso va en try/catch —en una ventana privada o
 * con el almacenamiento bloqueado lanza— y la pantalla tiene que funcionar sin ellos.
 */

const CLAVE = "bdb-activos.favorites.v1";

export function leerFavoritos(): string[] {
  try {
    const crudo = getBrowserLocalStorage()?.getItem(CLAVE);
    const leido: unknown = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(leido) ? leido.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function escribirFavoritos(favoritos: string[]): void {
  try {
    getBrowserLocalStorage()?.setItem(CLAVE, JSON.stringify(favoritos));
  } catch {
    /* Sin almacenamiento la marca no sobrevive a la recarga, y eso es todo: la
       pantalla sigue funcionando con la lista que tenga en memoria. */
  }
}

/** Añade o quita, y devuelve la lista nueva. No muta la que recibe. */
export function alternarFavorito(favoritos: string[], id: string): string[] {
  return favoritos.includes(id) ? favoritos.filter((v) => v !== id) : [...favoritos, id];
}
