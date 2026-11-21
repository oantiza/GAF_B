/**
 * Dibujar en diario, medir en semanal.
 *
 * El backend mide asi el backtest (cagr, volatilidad, Sharpe y correlacion sobre
 * el remuestreo semanal; maxima caida sobre la serie dibujada). Lo que el cliente
 * calcula por su cuenta a partir de la serie —hoy, la proyeccion Monte-Carlo—
 * tiene que medir igual, o la misma cartera contaria dos historias.
 *
 * En fondos el dato diario no es inocente: el valor liquidativo se publica con
 * retraso y arrastra el del dia anterior, asi que la serie diaria esta
 * autocorrelacionada. Eso infla la volatilidad y estrecha el cono de la
 * proyeccion. El remuestreo semanal —ultima observacion de cada semana ISO— es
 * el espejo exacto de `_weekly_last_observations` del backend.
 */

export interface DatedValue {
  date: string;
  value: number;
}

export type SeriesFrequency = "WEEKLY" | "DAILY";

/** Lunes (en UTC) de la semana ISO a la que pertenece la fecha. */
function isoWeekStart(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) return null;
  const offsetFromMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - offsetFromMonday);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Numero de la semana ISO de la fecha contado desde 1970 (lunes 1970-01-05 = 1).
 * Dos observaciones son de semanas consecutivas si sus ordinales difieren en 1;
 * sirve para medir el tiempo transcurrido en semanas reales y detectar huecos.
 */
export function isoWeekOrdinal(isoDate: string): number | null {
  const monday = isoWeekStart(isoDate);
  if (monday === null) return null;
  // 1970-01-05 es el primer lunes desde el origen (dia 4).
  const days = Math.round(Date.parse(`${monday}T00:00:00Z`) / 86_400_000);
  return (days - 4) / 7 + 1;
}

/**
 * Ultima observacion de cada semana ISO, en orden. Los puntos con fecha
 * ilegible se descartan; el orden de entrada manda (el ultimo de cada semana
 * gana), asi que la serie debe venir ascendente, que es como la manda el backend.
 */
export function weeklyLastObservations<T extends DatedValue>(points: readonly T[]): T[] {
  const byWeek = new Map<string, T>();
  for (const point of points) {
    const week = isoWeekStart(point.date);
    if (week === null) continue;
    byWeek.set(week, point);
  }
  return [...byWeek.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, point]) => point);
}

/**
 * Serie con la que MEDIR, sea cual sea la que se dibuja. Devuelve siempre
 * frecuencia semanal para que quien la reciba anualice con 52.
 */
export function measurementSeries<T extends DatedValue>(
  points: readonly T[],
  frequency: SeriesFrequency
): { series: T[]; frequency: "WEEKLY" } {
  return {
    series: frequency === "DAILY" ? weeklyLastObservations(points) : [...points],
    frequency: "WEEKLY"
  };
}

/**
 * Indices de la ultima observacion de cada semana ISO, para series que viajan
 * como arrays paralelos (`dates[]` + `values[]`, como las rebasadas del backend).
 */
export function weeklyMeasurementIndices(dates: readonly string[]): number[] {
  const byWeek = new Map<string, number>();
  dates.forEach((isoDate, index) => {
    const week = isoWeekStart(isoDate);
    if (week === null) return;
    byWeek.set(week, index);
  });
  return [...byWeek.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, index]) => index);
}

/** Tramo de un año natural dentro de una serie, para `isFullCalendarYear`. */
export interface CalendarYearSpan {
  /** Base: ultimo cierre del año anterior o, si no lo hay, primera observacion del año. */
  start: string;
  /** Primera observacion dentro del año. */
  firstInYear: string;
  /** Ultima observacion dentro del año. */
  end: string;
  /** Primera observacion despues del año, si la serie sigue. */
  next?: string | null;
}

/** ¿Las dos fechas caen en la misma semana ISO o en semanas consecutivas (sin hueco)? */
function adjacentWeeks(earlier: string, later: string | null | undefined): boolean {
  const from = isoWeekOrdinal(earlier);
  const to = later ? isoWeekOrdinal(later) : null;
  return from !== null && to !== null && to - from <= 1;
}

/**
 * Regla UNICA de «año natural completo» para las tablas de rentabilidad por años
 * (informe interno y comparativo). El mismo criterio en los dos extremos:
 *  - inicio: la base es el ultimo cierre del año anterior y esta cerca del 31-12
 *    (a partir del 24-12, o sin hueco hasta la primera observacion del año); o
 *    la serie empieza en la primera semana del año (hasta el 7 de enero);
 *  - fin: el ultimo cierre del año esta a partir del 24-12, o la serie sigue sin
 *    hueco en la semana ISO siguiente.
 * Se cuenta por continuidad de la serie y no solo por dias al 31-12: con series
 * semanales y festivos el ultimo cierre del año puede quedar a mas de 7 dias
 * (23-12) sin que falte nada, y antes salia como «parcial».
 */
export function isFullCalendarYear(year: number, span: CalendarYearSpan): boolean {
  const startYear = Number(span.start.slice(0, 4));
  const startsAtOpen = startYear === year
    ? span.start.slice(5, 10) <= "01-07"
    : startYear === year - 1 && (span.start.slice(5, 10) >= "12-24" || adjacentWeeks(span.start, span.firstInYear));
  const reachesClose = span.end.slice(5, 10) >= "12-24" || adjacentWeeks(span.end, span.next);
  return startsAtOpen && reachesClose;
}
