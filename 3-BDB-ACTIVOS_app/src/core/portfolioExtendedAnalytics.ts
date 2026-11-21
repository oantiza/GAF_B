// Analítica ampliada de la cartera para el informe interno del asesor.
//
// Una sola definición para cada cifra nueva (13-10-2026): rentabilidad por años
// naturales, métricas móviles, medidas relativas al benchmark, VaR/CVaR,
// Sortino, Calmar, episodios de caída, mejores y peores periodos y
// concentración. Ninguna rehace lo que ya da el backend: la rentabilidad
// anualizada, la volatilidad, el Sharpe y la máxima caída de la cartera llegan
// en `BacktestResponse.metrics` y aquí solo se usan como entrada.
//
// Se mide como el backend: se dibuja en diario y se mide en semanal (última
// observación de cada semana ISO, `weeklyLastObservations`) y se anualiza con
// 52. La máxima caída y sus episodios se miden sobre la serie dibujada, igual
// que `max_drawdown`. Sin dato suficiente, `null`: nunca un cero creíble.
//
// Huecos (ALTA-14, 14-10-2026): un rendimiento «semanal» solo existe entre dos
// semanas ISO consecutivas; si entre dos observaciones faltan semanas, ese salto
// no cuenta como una semana (ni en beta, tracking error, VaR, Sortino, extremos
// ni móviles). Las rentabilidades anualizadas del bloque relativo se miden por
// tiempo real transcurrido entre los extremos de la serie (días / 365,2425),
// que es la definición del CAGR del backtest del periodo
// (`portfolio_horizon._backtest`).

import { isFullCalendarYear, isoWeekOrdinal, weeklyLastObservations, type DatedValue } from "./seriesFrequency";

const WEEKS_PER_YEAR = 52;
/** Año medio gregoriano: el mismo divisor que el CAGR del backtest del periodo y `portfolioComparison`. */
const DAYS_PER_YEAR = 365.2425;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

function cleanSeries(points: readonly DatedValue[]): DatedValue[] {
  return points.filter((point) => finite(point.value) && point.value > 0 && /^\d{4}-\d{2}-\d{2}/.test(point.date));
}

/**
 * Rentabilidad anualizada geométrica por tiempo real transcurrido entre dos
 * fechas (días / 365,2425): un hueco cuenta lo que dura, no como una semana.
 */
export function annualizeByElapsedTime(fromDate: string, toDate: string, first: number, last: number): number | null {
  const days = (Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  if (!(days > 0) || first <= 0 || last <= 0) return null;
  return (last / first) ** (DAYS_PER_YEAR / days) - 1;
}

/** Semanas de calendario (ISO) transcurridas entre dos fechas; null si alguna es ilegible. */
function weeksBetween(fromDate: string, toDate: string): number | null {
  const from = isoWeekOrdinal(fromDate);
  const to = isoWeekOrdinal(toDate);
  return from === null || to === null ? null : to - from;
}

/**
 * Pares de observaciones semanales CONSECUTIVAS (semanas ISO contiguas). Un salto
 * de varias semanas no es un rendimiento semanal y se descarta.
 */
export function contiguousWeeklySteps<T extends DatedValue>(weekly: readonly T[]): Array<{ from: T; to: T }> {
  const out: Array<{ from: T; to: T }> = [];
  for (let i = 1; i < weekly.length; i++) {
    if (weeksBetween(weekly[i - 1].date, weekly[i].date) === 1) out.push({ from: weekly[i - 1], to: weekly[i] });
  }
  return out;
}

/** Rendimientos semanales de una serie ya remuestreada, solo entre semanas contiguas. */
export function contiguousWeeklyReturns(weekly: readonly DatedValue[]): Array<{ date: string; value: number }> {
  return contiguousWeeklySteps(weekly).map(({ from, to }) => ({ date: to.date, value: to.value / from.value - 1 }));
}

// ------------------------------------------------------------ años naturales
export interface CalendarYearReturn {
  year: number;
  portfolio: number;
  benchmark: number | null;
  /** El año no está completo en la ventana (empieza o acaba dentro de él). */
  partial: boolean;
  from: string;
  to: string;
}

/**
 * Rentabilidad de cada año natural presente en la serie, desde el último cierre
 * del año anterior (o la primera observación) hasta el último del año. Si el
 * tramo cubre el año entero lo dice `isFullCalendarYear` (la misma regla que el
 * informe comparativo); si no, se marca parcial.
 * `benchmark` es la serie del benchmark en las fechas de la serie (mismo índice,
 * null donde no tiene dato). Cartera y benchmark de un año se miden entre las MISMAS
 * dos fechas: las últimas comunes. Sin ellas, la cartera sola y el benchmark en null.
 */
export function calendarYearReturns(
  series: readonly DatedValue[],
  benchmark?: ReadonlyArray<number | null> | null
): CalendarYearReturn[] {
  const rows: Array<{ date: string; value: number; bench: number | null }> = [];
  series.forEach((point, index) => {
    if (!finite(point.value) || point.value <= 0) return;
    const bench = benchmark?.[index];
    rows.push({ date: point.date, value: point.value, bench: finite(bench) && bench > 0 ? bench : null });
  });
  if (rows.length < 2) return [];
  const years = [...new Set(rows.map((row) => Number(row.date.slice(0, 4))))].sort((a, b) => a - b);
  const out: CalendarYearReturn[] = [];
  for (const year of years) {
    const inYear = rows.filter((row) => Number(row.date.slice(0, 4)) === year);
    const before = rows.filter((row) => Number(row.date.slice(0, 4)) < year);
    const inYearCommon = inYear.filter((row) => row.bench !== null);
    const beforeCommon = before.filter((row) => row.bench !== null);
    const commonBase = beforeCommon.length ? beforeCommon[beforeCommon.length - 1] : inYearCommon[0];
    const commonEnd = inYearCommon[inYearCommon.length - 1];
    const compared = commonBase && commonEnd && commonBase !== commonEnd;
    const pool = compared ? rows.filter((row) => row.bench !== null) : rows;
    const base = compared ? commonBase : before.length ? before[before.length - 1] : inYear[0];
    const end = compared ? commonEnd : inYear[inYear.length - 1];
    if (base === end) continue;
    const next = pool.find((row) => Number(row.date.slice(0, 4)) > year);
    out.push({
      year,
      portfolio: end.value / base.value - 1,
      benchmark: compared ? (end.bench as number) / (base.bench as number) - 1 : null,
      partial: !isFullCalendarYear(year, { start: base.date, firstInYear: (compared ? inYearCommon : inYear)[0].date, end: end.date, next: next?.date }),
      from: base.date,
      to: end.date
    });
  }
  return out;
}

// ------------------------------------------------------- periodos extremos
export interface PeriodExtremes {
  bestWeek: { date: string; value: number } | null;
  worstWeek: { date: string; value: number } | null;
  bestMonth: { month: string; value: number } | null;
  worstMonth: { month: string; value: number } | null;
  positiveWeeksShare: number | null;
  positiveMonthsShare: number | null;
  weeks: number;
  months: number;
}

function monthlyLastObservations(points: readonly DatedValue[]): DatedValue[] {
  const byMonth = new Map<string, DatedValue>();
  for (const point of points) byMonth.set(point.date.slice(0, 7), point);
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => point);
}

function monthOrdinal(isoDate: string): number {
  return Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1;
}

export function periodExtremes(series: readonly DatedValue[]): PeriodExtremes {
  const clean = cleanSeries(series);
  const weekly = weeklyLastObservations(clean);
  const monthly = monthlyLastObservations(clean);
  const weekReturns = contiguousWeeklyReturns(weekly);
  // Igual que las semanas: un salto de varios meses no es «el mejor mes».
  const monthReturns = monthly.slice(1)
    .map((point, i) => ({ point, prev: monthly[i] }))
    .filter(({ point, prev }) => monthOrdinal(point.date) - monthOrdinal(prev.date) === 1)
    .map(({ point, prev }) => ({ month: point.date.slice(0, 7), value: point.value / prev.value - 1 }));
  const pick = <T extends { value: number }>(list: T[], better: (a: number, b: number) => boolean): T | null =>
    list.length ? list.reduce((acc, item) => (better(item.value, acc.value) ? item : acc)) : null;
  return {
    bestWeek: pick(weekReturns, (a, b) => a > b),
    worstWeek: pick(weekReturns, (a, b) => a < b),
    bestMonth: pick(monthReturns, (a, b) => a > b),
    worstMonth: pick(monthReturns, (a, b) => a < b),
    positiveWeeksShare: weekReturns.length ? weekReturns.filter((r) => r.value > 0).length / weekReturns.length : null,
    positiveMonthsShare: monthReturns.length ? monthReturns.filter((r) => r.value > 0).length / monthReturns.length : null,
    weeks: weekReturns.length,
    months: monthReturns.length
  };
}

// ---------------------------------------------------------------- móviles
export interface RollingPoint {
  date: string;
  /** Rentabilidad de las últimas `windowWeeks` semanas (sin anualizar si la ventana es de un año). */
  return: number;
  volatility: number;
}

/**
 * Rentabilidad y volatilidad móviles en ventanas de `windowWeeks` semanas (por
 * defecto un año). La ventana son semanas de calendario: arranca en la
 * observación de exactamente `windowWeeks` semanas antes (si no la hay, ese
 * punto no se calcula) y la volatilidad usa solo rendimientos entre semanas
 * contiguas.
 */
export function rollingStats(series: readonly DatedValue[], windowWeeks = WEEKS_PER_YEAR): RollingPoint[] {
  const weekly = weeklyLastObservations(cleanSeries(series));
  const ordinals = weekly.map((point) => isoWeekOrdinal(point.date) ?? Number.NaN);
  const out: RollingPoint[] = [];
  let start = 0;
  for (let end = 1; end < weekly.length; end++) {
    const target = ordinals[end] - windowWeeks;
    while (start < end && ordinals[start] < target) start++;
    if (ordinals[start] !== target) continue;
    const slice = weekly.slice(start, end + 1);
    const std = sampleStd(contiguousWeeklyReturns(slice).map((r) => r.value));
    if (std === null) continue;
    const growth = slice[slice.length - 1].value / slice[0].value;
    out.push({
      date: slice[slice.length - 1].date,
      return: growth ** (WEEKS_PER_YEAR / windowWeeks) - 1,
      volatility: std * Math.sqrt(WEEKS_PER_YEAR)
    });
  }
  return out;
}

// -------------------------------------------------- relativo al benchmark
export interface BenchmarkRelativeStats {
  beta: number;
  correlation: number;
  trackingError: number;
  /** Rentabilidad anualizada de cartera y benchmark sobre las MISMAS semanas. */
  portfolioReturn: number;
  benchmarkReturn: number;
  activeReturn: number;
  informationRatio: number | null;
  /** Alfa de Jensen anualizada con el tipo sin riesgo de la ventana. */
  jensenAlpha: number;
  upCapture: number | null;
  downCapture: number | null;
  observations: number;
}

export interface BenchmarkRelativeOptions {
  /**
   * CAGR del backtest (`metrics.cagr`, días / 365,2425 entre la primera y la
   * última observación). Si la ventana común con el benchmark empieza y acaba
   * donde la serie, la rentabilidad de la cartera ES esa cifra (una cifra, una
   * definición); si no, se mide igual pero sobre la ventana común.
   */
  portfolioCagr?: number | null;
}

/**
 * Medidas relativas sobre rendimientos semanales comunes. `benchmark` va alineado
 * con `series` (mismo índice, como `referenciaEnFechas`) y solo tiene valor en las
 * fechas en que tiene dato propio: la semana de los dos es la misma, de la misma
 * última fecha común a la siguiente. Hacen falta al menos 26 rendimientos entre
 * semanas contiguas (beta, correlación, tracking error y capturas no cuentan los
 * saltos de un hueco).
 *
 * Las rentabilidades anualizadas de cartera y benchmark se miden sobre la MISMA
 * ventana común (primera y última fecha con los dos datos) y por tiempo real
 * transcurrido, con la definición del CAGR del backtest.
 */
export function benchmarkRelativeStats(
  series: readonly DatedValue[],
  benchmark: ReadonlyArray<number | null> | null | undefined,
  riskFreeRate: number,
  options: BenchmarkRelativeOptions = {}
): BenchmarkRelativeStats | null {
  if (!benchmark) return null;
  const paired: Array<{ date: string; value: number; bench: number }> = [];
  series.forEach((point, index) => {
    const bench = benchmark[index];
    if (finite(point.value) && point.value > 0 && finite(bench) && bench > 0 && /^\d{4}-\d{2}-\d{2}/.test(point.date)) {
      paired.push({ date: point.date, value: point.value, bench });
    }
  });
  const weekly = weeklyLastObservations(paired);
  const steps = contiguousWeeklySteps(weekly);
  if (steps.length < 26) return null;
  const rp = steps.map(({ from, to }) => to.value / from.value - 1);
  const rb = steps.map(({ from, to }) => to.bench / from.bench - 1);
  const mp = mean(rp);
  const mb = mean(rb);
  let cov = 0;
  let varB = 0;
  let varP = 0;
  for (let i = 0; i < rp.length; i++) {
    cov += (rp[i] - mp) * (rb[i] - mb);
    varB += (rb[i] - mb) ** 2;
    varP += (rp[i] - mp) ** 2;
  }
  if (varB <= 0 || varP <= 0) return null;
  const beta = cov / varB;
  const correlation = cov / Math.sqrt(varB * varP);
  const teStd = sampleStd(rp.map((value, i) => value - rb[i]));
  if (teStd === null) return null;
  const trackingError = teStd * Math.sqrt(WEEKS_PER_YEAR);
  const first = paired[0];
  const last = paired[paired.length - 1];
  const benchmarkReturn = annualizeByElapsedTime(first.date, last.date, first.bench, last.bench);
  const portfolioReturn = finite(options.portfolioCagr) && coversWholeSeries(series, first.date, last.date)
    ? options.portfolioCagr
    : annualizeByElapsedTime(first.date, last.date, first.value, last.value);
  if (portfolioReturn === null || benchmarkReturn === null) return null;
  const activeReturn = portfolioReturn - benchmarkReturn;
  const up = rb.map((b, i) => [rp[i], b] as const).filter(([, b]) => b > 0);
  const down = rb.map((b, i) => [rp[i], b] as const).filter(([, b]) => b < 0);
  const capture = (rows: ReadonlyArray<readonly [number, number]>) => {
    if (rows.length < 4) return null;
    const benchMean = mean(rows.map(([, b]) => b));
    return benchMean === 0 ? null : mean(rows.map(([p]) => p)) / benchMean;
  };
  return {
    beta,
    correlation,
    trackingError,
    portfolioReturn,
    benchmarkReturn,
    activeReturn,
    /* Una cartera igual al benchmark tiene tracking error 0 salvo por el redondeo de la coma flotante: no hay ratio. */
    informationRatio: trackingError > 1e-9 ? activeReturn / trackingError : null,
    jensenAlpha: portfolioReturn - (riskFreeRate + beta * (benchmarkReturn - riskFreeRate)),
    upCapture: capture(up),
    downCapture: capture(down),
    observations: rp.length
  };
}

/**
 * ¿La ventana común con el benchmark es la del CAGR del backtest? Lo es si
 * empieza y acaba en la primera y la última observación de la serie: el CAGR se
 * mide entre esos dos puntos por tiempo transcurrido, así que los huecos
 * intermedios no lo cambian.
 */
function coversWholeSeries(series: readonly DatedValue[], firstDate: string, lastDate: string): boolean {
  const clean = cleanSeries(series);
  return clean.length > 1 && clean[0].date === firstDate && clean[clean.length - 1].date === lastDate;
}

// ---------------------------------------------------------- riesgo de cola
export interface TailRisk {
  level: number;
  /** Pérdida semanal histórica en el percentil (rendimiento negativo, p. ej. −0,031). */
  valueAtRisk: number;
  /** Media de las semanas peores que el VaR (CVaR / Expected Shortfall). */
  conditionalValueAtRisk: number;
  /** Cuántas semanas hay en la cola. Con una sola, el «percentil» es la peor semana y el VaR y el CVaR coinciden. */
  tailObservations: number;
}

/** VaR y CVaR históricos semanales. Hacen falta al menos 52 semanas. */
export function historicalTailRisk(series: readonly DatedValue[], levels: readonly number[] = [0.95, 0.99]): TailRisk[] {
  const weekly = weeklyLastObservations(cleanSeries(series));
  const returns = contiguousWeeklyReturns(weekly).map((r) => r.value).sort((a, b) => a - b);
  if (returns.length < 52) return [];
  return levels.map((level) => {
    const cut = Math.max(1, Math.floor((1 - level) * returns.length));
    const tail = returns.slice(0, cut);
    return { level, valueAtRisk: returns[cut - 1], conditionalValueAtRisk: mean(tail), tailObservations: cut };
  });
}

/**
 * El peor rendimiento semanal del periodo. Hacen falta al menos 52 semanas, como para el VaR.
 *
 * Auditoría del 16-11-2026 (INF-8). El informe interno imprimía un «VaR 99 % semanal» que con menos de 200 semanas —uno
 * y tres años— es exactamente esta cifra, y con cinco años la segunda peor semana: un dato extremo presentado como un
 * percentil. Para que el 1 % tuviera unas cinco semanas en la cola harían falta casi diez años. Se imprime lo que es.
 */
export function worstWeeklyReturn(series: readonly DatedValue[]): number | null {
  const returns = contiguousWeeklyReturns(weeklyLastObservations(cleanSeries(series))).map((r) => r.value);
  return returns.length < 52 ? null : Math.min(...returns);
}

// ------------------------------------------------------ ratios de riesgo
/** Sortino: (rentabilidad anualizada del backend − tipo sin riesgo) / desviación bajista semanal anualizada. */
export function sortinoRatio(series: readonly DatedValue[], annualReturn: number, riskFreeRate: number): number | null {
  if (!finite(annualReturn) || !finite(riskFreeRate)) return null;
  const weekly = weeklyLastObservations(cleanSeries(series));
  const returns = contiguousWeeklyReturns(weekly).map((r) => r.value);
  if (returns.length < 26) return null;
  const weeklyRf = (1 + riskFreeRate) ** (1 / WEEKS_PER_YEAR) - 1;
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(0, r - weeklyRf) ** 2))) * Math.sqrt(WEEKS_PER_YEAR);
  return downside > 0 ? (annualReturn - riskFreeRate) / downside : null;
}

/** Calmar: rentabilidad anualizada / |máxima caída| (ambas del backend). */
export function calmarRatio(annualReturn: number, maxDrawdown: number): number | null {
  if (!finite(annualReturn) || !finite(maxDrawdown) || maxDrawdown >= 0) return null;
  return annualReturn / Math.abs(maxDrawdown);
}

// ---------------------------------------------------- episodios de caída
export interface DrawdownEpisode {
  peakDate: string;
  troughDate: string;
  depth: number;
  recoveryDate: string | null;
  /** Días naturales de máximo a mínimo. */
  declineDays: number;
  /** Días naturales del mínimo a la recuperación (null si no se ha recuperado). */
  recoveryDays: number | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Las `top` caídas más profundas, sin solaparse, sobre la serie dibujada (como `max_drawdown`). */
export function drawdownEpisodes(series: readonly DatedValue[], top = 3): DrawdownEpisode[] {
  const clean = cleanSeries(series);
  if (clean.length < 2) return [];
  const episodes: DrawdownEpisode[] = [];
  let peak = clean[0];
  let trough: DatedValue | null = null;
  for (const point of clean.slice(1)) {
    if (point.value >= peak.value) {
      if (trough && trough.value < peak.value) {
        episodes.push({ peakDate: peak.date, troughDate: trough.date, depth: trough.value / peak.value - 1,
          recoveryDate: point.date, declineDays: daysBetween(peak.date, trough.date), recoveryDays: daysBetween(trough.date, point.date) });
      }
      peak = point;
      trough = null;
    } else if (!trough || point.value < trough.value) {
      trough = point;
    }
  }
  if (trough && trough.value < peak.value) {
    episodes.push({ peakDate: peak.date, troughDate: trough.date, depth: trough.value / peak.value - 1,
      recoveryDate: null, declineDays: daysBetween(peak.date, trough.date), recoveryDays: null });
  }
  return episodes.sort((a, b) => a.depth - b.depth).slice(0, top);
}

// ------------------------------------------------------------ concentración
export interface ConcentrationStats {
  /** Índice Herfindahl-Hirschman sobre pesos en fracción (0-1). */
  hhi: number;
  /** Número efectivo de posiciones = 1 / HHI. */
  effectivePositions: number;
  top1: number;
  top5: number;
  top10: number;
  positions: number;
}

/** Concentración de los pesos (en %, se normalizan a 100). */
export function concentrationStats(weightsPercent: readonly number[]): ConcentrationStats | null {
  const weights = weightsPercent.filter((w) => finite(w) && w > 0).sort((a, b) => b - a);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!weights.length || total <= 0) return null;
  const fractions = weights.map((w) => w / total);
  const hhi = fractions.reduce((sum, f) => sum + f * f, 0);
  const topShare = (n: number) => fractions.slice(0, n).reduce((sum, f) => sum + f, 0);
  return { hhi, effectivePositions: 1 / hhi, top1: topShare(1), top5: topShare(5), top10: topShare(10), positions: weights.length };
}
