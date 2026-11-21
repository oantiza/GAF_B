import { cifraLeida } from "./cifraTecleada";

/**
 * Mín. por activo en Optimizar (decisión de Óscar, 14-11-2026). Se comprueba antes de llamar, y lo que no cabe se dice con
 * sus cifras: no se recorta en silencio. Las cuatro reglas acordadas:
 *
 * 1. Por defecto, 0 %: el optimizador puede dejar fuera cualquier activo, como hasta ahora.
 * 2. El mínimo no pasa del máximo escrito, y el mínimo por el número de activos del cálculo —también los que están al 0 %—
 *    no pasa del 100 %. Con candados: lo fijado más el mínimo de cada activo libre, tampoco.
 * 3. Con un mínimo por encima de 0, ningún activo del cálculo se descarta.
 * 4. Un candado manda sobre el tope del modelo, no sobre un límite escrito por el asesor: un candado por debajo del mínimo
 *    no se calcula, y se dice cuál. Es la misma regla que la Function aplica con el máximo escrito.
 *
 * La Function vuelve a comprobarlo (`validate_request` y `dynamic_bounds`): esto es para decirlo antes y en palabras.
 * El máximo de 100 significa «el tope del modelo», que depende del número de activos y nunca es menor que el reparto a
 * partes iguales; por eso, con 100, el mínimo solo choca con el 100 %.
 */
export interface ComprobacionDelMinimo {
  /** Mínimo y máximo por activo, en % (0-100), como los escribe el asesor. */
  minimoPct: number;
  maximoPct: number;
  /** Los activos que entran en el cálculo. */
  assetIds: readonly string[];
  /** Candados (decimales). Solo cuentan los de activos que entran en el cálculo. */
  candados?: Record<string, number>;
  nombre?: (assetId: string) => string;
}

const HOLGURA = 1e-7;

const ESPACIO_DURO = "\u00a0";

/** En %, con hasta dos decimales y sin ceros de relleno: lo escrito se lee como se escribió («40 %», «12,5 %», «33,33 %»). */
const pct = (fraccion: number) => `${cifraLeida(Math.round(fraccion * 10000) / 100)}${ESPACIO_DURO}%`;

/** El mínimo más alto que cabe, redondeado hacia abajo a la centésima de punto: quien lo escriba tiene cartera. */
export function minimoQueCabe(libre: number, activosLibres: number): number {
  if (activosLibres <= 0) return 0;
  return Math.floor((libre / activosLibres) * 10000 + HOLGURA) / 10000;
}

export function problemaDelMinimo({ minimoPct, maximoPct, assetIds, candados = {}, nombre = (id) => id }: ComprobacionDelMinimo): string | null {
  if (!(minimoPct > 0)) return null;
  const minimo = minimoPct / 100;
  if (maximoPct < 100 && minimoPct > maximoPct) {
    return `El mínimo por activo (${pct(minimo)}) pasa del máximo (${pct(maximoPct / 100)}): ninguna cartera cumple los dos. Baja el mínimo o sube el máximo.`;
  }
  const enElCalculo = new Set(assetIds);
  const fijados = Object.entries(candados).filter(([id, valor]) => enElCalculo.has(id) && Number.isFinite(valor));
  const pordebajo = fijados.find(([, valor]) => valor < minimo - HOLGURA);
  if (pordebajo) {
    return `El candado de ${nombre(pordebajo[0])} (${pct(pordebajo[1])}) queda por debajo del mínimo por activo (${pct(minimo)}): baja el mínimo o cambia el candado.`;
  }
  const fijado = fijados.reduce((total, [, valor]) => total + valor, 0);
  const libres = assetIds.length - fijados.length;
  if (fijado + minimo * libres <= 1 + HOLGURA) return null;
  const cabe = pct(minimoQueCabe(1 - fijado, libres));
  if (fijados.length === 0) {
    return `Con ${assetIds.length} activos, un mínimo del ${pct(minimo)} por activo suma un ${pct(minimo * libres)}: pasa del 100 %. El mínimo más alto que cabe es un ${cabe}, que deja la cartera a partes iguales.`;
  }
  return `Los candados suman un ${pct(fijado)}, y un mínimo del ${pct(minimo)} para ${libres === 1 ? "el activo libre" : `los ${libres} activos libres`} suma un ${pct(minimo * libres)}: pasa del 100 %. El mínimo más alto que cabe es un ${cabe}.`;
}
