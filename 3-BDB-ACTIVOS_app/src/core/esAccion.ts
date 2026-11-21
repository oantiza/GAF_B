import type { InstrumentType } from "../types/bdbAssets";

/**
 * Si un instrumento es una acción. Se sabe por su tipo, nunca por el nombre.
 *
 * El tipo sale del documento en las dos bases: `asset_type` en la vieja y `instrument_type` en la nueva, y
 * `map_instrument_type` (`functions_python/readmodel/mappers.py`) lo sirve tal cual. Medido el 05-11-2026 sobre los
 * dos emuladores: 312 acciones en la vieja y 305 en la nueva, ninguna con coste ni con cartera, y de los 1.090
 * instrumentos que están en las dos solo uno cambia de tipo, y no es una acción (`LU0290358497`, ETF y fondo). Ese
 * se retira del catálogo por la decisión B-70.
 *
 * Un tipo desconocido no es una acción: cuando eso decide que una cifra cuente como cero, ante la duda se trata como
 * un dato que falta.
 */
export function esAccion(tipo: InstrumentType | string | null | undefined): boolean {
  return tipo === "STOCK";
}
