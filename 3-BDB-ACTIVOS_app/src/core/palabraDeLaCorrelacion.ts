/**
 * La palabra con que el informe interno califica una correlación, con sus umbrales, y las parejas que más se mueven juntas de una
 * matriz (INF-20, INF-28). Vivían dentro del informe (`reports/internalPortfolioReportPdf.tsx`); aquí hay una sola definición, pura.
 *
 * Los umbrales son de lectura, no de cálculo: no cambian ninguna cifra, solo la palabra que la acompaña.
 *  - 0,70 o más: «alta». Las posiciones tienden a subir y bajar a la vez.
 *  - de 0,40 a 0,70: «media».
 *  - de 0,15 a 0,40: «baja».
 *  - por debajo de 0,15: «muy baja».
 */

export const CORRELACION_ALTA = 0.7;
export const CORRELACION_MEDIA = 0.4;
export const CORRELACION_BAJA = 0.15;

export type PalabraDeLaCorrelacion = "alta" | "media" | "baja" | "muy baja";

/** La palabra de una correlación; null si no hay cifra. */
export function palabraDeLaCorrelacion(valor: number | null | undefined): PalabraDeLaCorrelacion | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return valor >= CORRELACION_ALTA ? "alta" : valor >= CORRELACION_MEDIA ? "media" : valor >= CORRELACION_BAJA ? "baja" : "muy baja";
}

/** Una pareja de posiciones de una matriz, con su cifra. */
export interface ParejaDeLaMatriz {
  a: string;
  b: string;
  valor: number;
}

/**
 * Las `cuantas` parejas con la cifra más alta de una matriz simétrica (solo el triángulo de arriba: cada pareja una vez, sin la diagonal),
 * de mayor a menor; a igualdad, en el orden de la matriz. Las casillas sin cifra no entran. Es un orden, no un cálculo.
 */
export function parejasMasAltas(ids: readonly string[], matriz: ReadonlyArray<ReadonlyArray<number | null | undefined>>, cuantas: number): ParejaDeLaMatriz[] {
  const parejas: ParejaDeLaMatriz[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const valor = matriz[i]?.[j];
      if (typeof valor === "number" && Number.isFinite(valor)) parejas.push({ a: ids[i], b: ids[j], valor });
    }
  }
  return parejas.sort((x, y) => y.valor - x.valor).slice(0, Math.max(0, cuantas));
}
