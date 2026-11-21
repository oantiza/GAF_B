import type { BacktestResponse, BacktestSeriesPoint } from "../adapters/backtestPortfolioBackend";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { weeklyLastObservations } from "./seriesFrequency";
import { fecha as fechaConBarras, oFalta, periodo as periodoEntre, peso } from "./formato";
import { backtestExclusionLabel } from "./backtestCoverage";
import { CLASS_LABELS, readableBackendLabel } from "./labels";
import { categoriaLegible } from "./etiquetasDeReparto";

export type ComparisonPeriod = "3Y" | "5Y" | "10Y";
export interface ComparisonHistory {
  backtest: BacktestResponse;
  extensionNotes: string[];
}
/**
 * Por debajo de este tramo, de la primera a la última fecha común, no se anualiza (decisión de Óscar, 15-11-2026): es el
 * `MIN_ANNUALIZATION_DAYS` de `functions_python/weekly_sampling.py`, el de la maestra, la cartera real y la simulación. Un
 * +6 % en 119 días no es un 19,5 % anual: se enseña la rentabilidad del periodo, con sus fechas, y el Sharpe queda sin dato.
 */
export const MIN_DIAS_PARA_ANUALIZAR = 330;

export interface ComparisonMetrics {
  /** Rentabilidad del periodo entero, sin anualizar. */
  cumulative: number;
  /** `null` si el tramo no llega a `MIN_DIAS_PARA_ANUALIZAR` días (`annualized` en `false`) o no hay tres semanas. */
  cagr: number | null;
  volatility: number | null;
  /** Sobre `cagr`: sin `cagr`, sin Sharpe. */
  sharpe: number | null;
  maxDrawdown: number;
  /** Si `cagr` y `sharpe` están anualizados. Con `false`, la cifra de rentabilidad que se enseña es `cumulative`. */
  annualized: boolean;
}
export interface ComparisonResult {
  period: ComparisonPeriod;
  periodLabel: string;
  firstDate: string;
  lastDate: string;
  rangeLabel: string;
  coversPeriod: boolean;
  /** Días de la primera a la última fecha común, y si llegan para anualizar (`MIN_DIAS_PARA_ANUALIZAR`). */
  periodDays: number;
  annualized: boolean;
  seriesA: BacktestSeriesPoint[];
  seriesB: BacktestSeriesPoint[];
  metricsA: ComparisonMetrics;
  metricsB: ComparisonMetrics;
  riskFree: number | null;
  notes: string[];
}

/** One canonical set of positive weights for requests, identity and coverage. */
export function comparisonPositions(positions: readonly BdbManualPortfolioPosition[]) {
  const weights = new Map<string, number>();
  for (const position of positions) {
    if (!Number.isFinite(position.weight_percent) || position.weight_percent < 0) {
      throw new Error("Revisa los pesos de la cartera: deben ser números positivos o cero.");
    }
    if (position.weight_percent === 0) continue;
    const id = position.asset_id.trim();
    if (!id) throw new Error("Hay una posición sin identificar.");
    weights.set(id, (weights.get(id) ?? 0) + position.weight_percent);
  }
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("La cartera no tiene posiciones con peso válido.");
  return [...weights.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([asset_id, weight]) => ({ asset_id, weight_percent: weight / total * 100 }));
}

function pointsByDate(points: readonly BacktestSeriesPoint[]) {
  const result = new Map<string, number>();
  for (const point of points) {
    const time = Date.parse(`${point.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(time)
      || new Date(time).toISOString().slice(0, 10) !== point.date
      || !Number.isFinite(point.value) || point.value <= 0 || result.has(point.date)) {
      throw new Error("El histórico contiene fechas o valores inválidos. No se puede comparar con fiabilidad.");
    }
    result.set(point.date, point.value);
  }
  return result;
}

function weekIndex(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  return Math.floor((day.getTime() / 86400000 - (day.getUTCDay() + 6) % 7) / 7);
}

/**
 * Con semanas sin fechas comunes, mínimo de rentabilidades entre semanas
 * CONSECUTIVAS para dar una volatilidad (medio año). Sin huecos basta con dos,
 * como siempre.
 */
export const COMPARISON_MIN_GAPPED_WEEKLY_RETURNS = 26;

/** Rentabilidades semanales entre semanas ISO consecutivas; un hueco nunca cuenta como una semana. */
function consecutiveWeeklyReturns(weekly: readonly BacktestSeriesPoint[]): { returns: number[]; gaps: number } {
  const returns: number[] = [];
  let gaps = 0;
  for (let index = 1; index < weekly.length; index += 1) {
    if (weekIndex(weekly[index].date) - weekIndex(weekly[index - 1].date) === 1) {
      returns.push(weekly[index].value / weekly[index - 1].value - 1);
    } else {
      gaps += 1;
    }
  }
  return { returns, gaps };
}

/** ¿Faltan semanas enteras en la serie (semanas ISO sin ninguna observación)? */
export function hasWeeklyGaps(points: readonly BacktestSeriesPoint[]): boolean {
  return consecutiveWeeklyReturns(weeklyLastObservations(points)).gaps > 0;
}

/** Días naturales entre dos fechas «AAAA-MM-DD». */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
}

/** Matches the 3/5Y analysis: calendar CAGR, last observation per ISO week, sample SD.
 * Drawdown keeps every daily point.
 *
 * MEDIA-05 (auditoría 16-10-2026): una sola semana sin fechas comunes anulaba
 * CAGR, volatilidad y Sharpe. La CAGR solo usa los extremos y no necesita
 * continuidad; la volatilidad se mide entre semanas consecutivas (un hueco
 * nunca cuenta como una semana) y, si hubo huecos, exige un mínimo de
 * COMPARISON_MIN_GAPPED_WEEKLY_RETURNS rentabilidades. */
export function comparisonMetrics(points: readonly BacktestSeriesPoint[], riskFree: number | null): ComparisonMetrics {
  const weekly = weeklyLastObservations(points);
  let peak = points[0].value;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1);
  }
  const cumulative = points[points.length - 1].value / points[0].value - 1;
  const days = diasEntre(points[0].date, points[points.length - 1].date);
  const annualized = weekly.length >= 3 && days >= MIN_DIAS_PARA_ANUALIZAR;
  if (weekly.length < 3) return { cumulative, cagr: null, volatility: null, sharpe: null, maxDrawdown, annualized };
  const cagr = annualized ? (1 + cumulative) ** (365.2425 / days) - 1 : null;
  const { returns, gaps } = consecutiveWeeklyReturns(weekly);
  const minReturns = gaps > 0 ? COMPARISON_MIN_GAPPED_WEEKLY_RETURNS : 2;
  if (returns.length < minReturns) return { cumulative, cagr, volatility: null, sharpe: null, maxDrawdown, annualized };
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) * 52);
  const sharpe = cagr !== null && riskFree !== null && volatility > 1e-12 ? (cagr - riskFree) / volatility : null;
  return { cumulative, cagr, volatility, sharpe, maxDrawdown, annualized };
}

/** Both lines and all metrics use exactly the same observations and base date. */
/**
 * Alinea dos carteras sin que la que no da cifra recorte a la otra (auditoría del 16-11-2026, CMP-1).
 *
 * De una cartera que mide menos del 80 % del peso no se enseña nada, pero sus fechas seguían entrando en las fechas
 * comunes: con A de tres años y B sin cifra y con 207 días, A se quedaba sin rentabilidad anualizada, sin Sharpe y sin
 * mapa, recortada por una serie que nadie ve. La que no da cifra se sustituye aquí por la otra, igual que ya se hacía
 * cuando no tenía ninguna serie: la que sí la da se mide sobre su propio periodo. Si ninguna la da, se alinean como
 * siempre —no se enseña ninguna—. `null` si no hay ninguna serie.
 */
export function alinearLasQueDanCifra(
  a: { historia: ComparisonHistory | null; daCifra: boolean },
  b: { historia: ComparisonHistory | null; daCifra: boolean },
  period: ComparisonPeriod
): ComparisonResult | null {
  const conA = a.daCifra ? a.historia : null;
  const conB = b.daCifra ? b.historia : null;
  const paraA = conA ?? conB ?? a.historia ?? b.historia;
  const paraB = conB ?? conA ?? b.historia ?? a.historia;
  return paraA && paraB ? alignPortfolioComparison(paraA, paraB, period) : null;
}

export function alignPortfolioComparison(a: ComparisonHistory, b: ComparisonHistory, period: ComparisonPeriod): ComparisonResult {
  for (const item of [a, b]) {
    if (item.backtest.window !== period || item.backtest.base_currency !== "EUR" || item.backtest.frequency !== "DAILY") {
      throw new Error("El histórico recibido no corresponde al periodo o a la divisa de la comparación.");
    }
  }
  const mapA = pointsByDate(a.backtest.portfolio_series);
  const mapB = pointsByDate(b.backtest.portfolio_series);
  const dates = [...mapA.keys()].filter((date) => mapB.has(date)).sort();
  if (dates.length < 2) throw new Error("Las dos carteras no tienen suficientes fechas comunes para comparar su evolución.");
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const seriesA = dates.map((date) => ({ date, value: mapA.get(date)! / mapA.get(firstDate)! * 100 }));
  const seriesB = dates.map((date) => ({ date, value: mapB.get(date)! / mapB.get(firstDate)! * 100 }));
  const sameRiskWindow = [a, b].every(({ backtest }) => {
    const sorted = backtest.portfolio_series.map((point) => point.date).sort();
    return sorted[0] === firstDate && sorted[sorted.length - 1] === lastDate;
  });
  const riskFree = sameRiskWindow && Number.isFinite(a.backtest.metrics.rf_rate)
    && Math.abs(a.backtest.metrics.rf_rate - b.backtest.metrics.rf_rate) < 1e-10 ? a.backtest.metrics.rf_rate : null;
  const years = Number.parseInt(period, 10);
  const coversPeriod = (Date.parse(lastDate) - Date.parse(firstDate)) / 86400000 >= years * 365.2425 - 14;
  const rangeLabel = oFalta(periodoEntre(firstDate, lastDate));
  const notes: string[] = [];
  if (!coversPeriod) notes.push(`La ventana solicitada es de ${years} años, pero ambas carteras solo comparten datos ${rangeLabel}. Las cifras corresponden a ese periodo disponible.`);
  if (!sameRiskWindow) notes.push("Se han ajustado las dos series a sus fechas comunes y recalculado las métricas. Falta el Sharpe: no hay una tasa sin riesgo para ese mismo intervalo.");
  else if (riskFree === null) notes.push("Falta el Sharpe: las dos carteras no tienen una tasa sin riesgo comparable.");
  const metricsA = comparisonMetrics(seriesA, riskFree);
  const metricsB = comparisonMetrics(seriesB, riskFree);
  const periodDays = diasEntre(firstDate, lastDate);
  const annualized = metricsA.annualized && metricsB.annualized;
  if (weeklyLastObservations(seriesA).length < 3) {
    notes.push("Las métricas anualizadas y el mapa quedan sin dato: las fechas comunes no llegan a tres semanas.");
  } else {
    if (!annualized) notes.push(`Las dos carteras comparten ${periodDays} días, menos de un año: un periodo tan corto no se anualiza. Se da la rentabilidad del periodo, ${rangeLabel}; la rentabilidad anualizada, el Sharpe y el mapa quedan sin dato.`);
    if (metricsA.volatility === null || metricsB.volatility === null) {
      notes.push("La volatilidad, el Sharpe y el mapa quedan sin dato porque faltan semanas consecutivas con fechas comunes.");
    } else if (hasWeeklyGaps(seriesA)) {
      notes.push("Hay semanas sin fechas comunes: la volatilidad y el Sharpe se calculan solo entre semanas consecutivas.");
    }
  }
  if ([a, b].some((item) => item.backtest.warnings.some((code) => code.startsWith("RISK_FREE_RATE_")))) {
    notes.push("La tasa sin riesgo utiliza cobertura parcial o una tasa de respaldo; el Sharpe es aproximado.");
  }
  return { period, periodLabel: coversPeriod ? `${years} años` : "periodo disponible", firstDate, lastDate,
    rangeLabel, coversPeriod, periodDays, annualized, seriesA, seriesB, metricsA, metricsB, riskFree, notes };
}

const FECHA_ISO = /\d{4}-\d{2}-\d{2}/g;

/** «LU…: tramo estimado con X, del 2023-01-01 al 2024-01-01.» Con el nombre y las fechas como los lee un cliente. */
export function notaDeAmpliacionLegible(nota: string, nombreDe: (id: string) => string): string {
  const separador = nota.indexOf(":");
  return (separador > 0 ? `${nombreDe(nota.slice(0, separador))}${nota.slice(separador)}` : nota).replace(FECHA_ISO, (iso) => fechaConBarras(iso) ?? iso);
}

export function comparisonCoverage(history: ComparisonHistory, positions: readonly BdbManualPortfolioPosition[]) {
  const included = new Set(history.backtest.asset_ids);
  const normalized = comparisonPositions(positions);
  const weight = normalized.filter((p) => included.has(p.asset_id)).reduce((sum, p) => sum + p.weight_percent, 0);
  const labels = new Map(positions.map((p) => [p.asset_id, p.label || p.asset_id]));
  const reasons = new Map(history.backtest.excluded_assets.map((p) => [p.asset_id, p.reason]));
  const excluded = normalized.filter((p) => !included.has(p.asset_id)).map((p) =>
    `${labels.get(p.asset_id)} (${backtestExclusionLabel(reasons.get(p.asset_id) ?? "INSUFFICIENT_HISTORY")})`);
  return { weight, included: normalized.length - excluded.length, total: normalized.length,
    note: `${oFalta(peso(weight / 100))} del peso representado${excluded.length ? "; los pesos incluidos se normalizan al 100 %" : ""}.`, excluded,
    /* Lo mismo, sin escribir: el papel lo dice con otras palabras que la pantalla. */
    fuera: normalized.filter((p) => !included.has(p.asset_id)).map((p) => ({ assetId: p.asset_id, reason: reasons.get(p.asset_id) ?? "INSUFFICIENT_HISTORY" })) };
}

export interface ComparisonAllocationRow { key: string; label: string; a: number; b: number }
export type CampoDeLaFicha = "economic_asset_class" | "category" | "region";

/**
 * `loQueFalta` es cómo se llama lo que la ficha no trae: `clasificacionQueFalta`, en `entradaDeComparativa.ts`, la misma palabra en pantalla y en papel (decisiones 66 y 113). `fila` manda sobre lo demás: lo que el papel saca del reparto (decisión 85).
 */
export function comparisonAllocations(
  a: readonly BdbManualPortfolioPosition[],
  b: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[],
  field: CampoDeLaFicha,
  loQueFalta: (asset: BdbAssetDetail | undefined, campo: CampoDeLaFicha) => string,
  fila: (asset: BdbAssetDetail | undefined) => string | null = () => null
): ComparisonAllocationRow[] {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const rows = new Map<string, ComparisonAllocationRow>();
  for (const [side, positions] of [["a", a], ["b", b]] as const) {
    for (const position of comparisonPositions(positions)) {
      const asset = byId.get(position.asset_id);
      /* La categoría, por el nombre que se enseña: la misma en dos idiomas es una sola fila, y ya está escrita para leerse (decisión 101). */
      const delCampo = field === "category" ? categoriaLegible(asset?.category) : asset?.[field];
      const key = fila(asset) ?? (delCampo || loQueFalta(asset, field));
      const label = field === "economic_asset_class" ? CLASS_LABELS[key] ?? readableBackendLabel(key) : field === "category" ? key : readableBackendLabel(key);
      const row = rows.get(key) ?? { key, label, a: 0, b: 0 };
      row[side] += position.weight_percent;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => Math.max(b.a, b.b) - Math.max(a.a, a.b) || a.label.localeCompare(b.label));
}
