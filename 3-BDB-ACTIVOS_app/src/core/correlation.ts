/**
 * Correlación de rentabilidades ALINEADA POR FECHA (A3.3).
 *
 * Antes la matriz emparejaba rentabilidades por índice: si una serie saltaba
 * una observación (valor no positivo o hueco), todo lo posterior quedaba
 * desplazado y la correlación se calculaba entre semanas distintas sin avisar.
 * Aquí cada rentabilidad queda anclada a su fecha y cada par de series se
 * correlaciona solo sobre las fechas comunes a ambas.
 */

export interface DatedSeries {
  /** Eje temporal compartido (ISO date por observación, misma longitud que values). */
  dates: string[];
  values: number[];
}

/** Rentabilidades simples ancladas a la fecha de la observación final del tramo. */
export function returnsByDate(series: DatedSeries): Map<string, number> {
  const out = new Map<string, number>();
  const n = Math.min(series.dates.length, series.values.length);
  for (let i = 1; i < n; i += 1) {
    const prev = series.values[i - 1];
    const cur = series.values[i];
    if (Number.isFinite(prev) && prev > 0 && Number.isFinite(cur) && cur > 0) {
      out.set(series.dates[i], cur / prev - 1);
    }
  }
  return out;
}

/**
 * Pearson sobre la intersección de fechas de ambos mapas de rentabilidades.
 * Devuelve NaN con menos de 3 observaciones comunes o varianza nula.
 */
export function pearsonByDate(a: Map<string, number>, b: Map<string, number>): number {
  const av: number[] = [];
  const bv: number[] = [];
  for (const [date, valueA] of a) {
    const valueB = b.get(date);
    if (valueB !== undefined) {
      av.push(valueA);
      bv.push(valueB);
    }
  }
  const n = av.length;
  if (n < 3) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += av[i];
    mb += bv[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = av[i] - ma;
    const db = bv[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const d = Math.sqrt(va * vb);
  return d > 0 ? cov / d : NaN;
}

/**
 * Matriz de correlación (fila × columna) para series sobre un eje de fechas
 * compartido. null donde no hay dato suficiente; 1 en la diagonal.
 */
export function correlationMatrixByDate(dates: string[], series: number[][]): (number | null)[][] {
  const rets = series.map((values) => returnsByDate({ dates, values }));
  return series.map((_, rowIndex) =>
    series.map((__, columnIndex) => {
      if (rowIndex === columnIndex) return 1;
      const value = pearsonByDate(rets[rowIndex], rets[columnIndex]);
      return Number.isFinite(value) ? value : null;
    })
  );
}

/** Lo que dice la casilla de una serie con la que no se mide. */
export const NO_SE_MIDE = "No se mide";

export interface SerieDeLaMatriz {
  values: number[];
  /** Su línea es el valor liquidativo de una clase que reparte, sin sus pagos. */
  sin_dividendos?: boolean;
}

/**
 * La matriz que se enseña en el Comparador, en pantalla y en papel (decisión 53).
 *
 * La línea de una clase que reparte cae cada vez que paga, y esa caída no es mercado: con ella, la correlación sale falseada,
 * y no de forma pareja (EdR da 0,45 con la mediana de sus pares sin los pagos y 0,90 con ellos). Se dibuja, pero no se mide con
 * ella: sus casillas quedan en `null` y `noSeMide` dice cuáles son, para que un hueco no parezca un fallo. La diagonal se queda.
 */
export function matrizDeCorrelacion(
  dates: string[],
  series: readonly SerieDeLaMatriz[]
): { matrix: (number | null)[][]; noSeMide: boolean[] } {
  const noSeMide = series.map((serie) => serie.sin_dividendos === true);
  const matrix = correlationMatrixByDate(dates, series.map((serie) => serie.values)).map((fila, filaIndice) =>
    fila.map((valor, columna) => (filaIndice !== columna && (noSeMide[filaIndice] || noSeMide[columna]) ? null : valor))
  );
  return { matrix, noSeMide };
}

/** Por qué hay casillas sin cifra, con los nombres de quienes las dejan así. Si no hay ninguno, nada. */
export function notaDeLaCorrelacion(nombres: readonly string[]): string | null {
  if (nombres.length === 0) return null;
  if (nombres.length === 1) {
    return `No se mide la correlación de ${nombres[0]}: su línea es el valor liquidativo, sin dividendos, y cada pago se leería como una caída.`;
  }
  const lista = `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `No se mide la correlación de ${lista}: sus líneas son el valor liquidativo, sin dividendos, y cada pago se leería como una caída.`;
}
