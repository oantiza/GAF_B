import type { BacktestSeriesPoint } from "../adapters/backtestPortfolioBackend";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { comparisonPositions } from "./portfolioComparison";
import { CLASS_LABELS } from "./labels";
import { isFullCalendarYear } from "./seriesFrequency";
import { isWeightBalanced } from "./weightTolerance";

/** Un capital de 0, negativo o que no es un número no es un capital: sin él no hay importes. */
export const capitalValido = (capital: number | null | undefined): number | null =>
  typeof capital === "number" && Number.isFinite(capital) && capital > 0 ? capital : null;

export interface ComparisonPositionRow {
  id: string;
  name: string;
  category: string;
  currency: string;
  a: number;
  b: number;
}

/** Saved, normalized holdings, including positions excluded from the backtest. */
export function comparisonPositionRows(a: readonly BdbManualPortfolioPosition[], b: readonly BdbManualPortfolioPosition[], assets: readonly BdbAssetDetail[], sinFicha = "Sin clasificar"): ComparisonPositionRow[] {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const labels = new Map([...a, ...b].map((p) => [p.asset_id.trim(), p.label]));
  const rows = new Map<string, ComparisonPositionRow>();
  for (const [side, positions] of [["a", a], ["b", b]] as const) {
    for (const p of comparisonPositions(positions)) {
      const asset = byId.get(p.asset_id);
      const row = rows.get(p.asset_id) ?? { id: p.asset_id, name: asset?.display_name || labels.get(p.asset_id) || p.asset_id,
        category: asset?.category || CLASS_LABELS[asset?.economic_asset_class ?? ""] || sinFicha,
        currency: asset?.currency || sinFicha, a: 0, b: 0 };
      row[side] = p.weight_percent;
      rows.set(p.asset_id, row);
    }
  }
  return [...rows.values()].sort((a, b) => Math.abs(b.b - b.a) - Math.abs(a.b - a.a) || Math.max(b.a, b.b) - Math.max(a.a, a.b) || a.id.localeCompare(b.id));
}

export function comparisonConcentration(rows: readonly ComparisonPositionRow[]) {
  if (!rows.length) return null;
  for (const side of ["a", "b"] as const) {
    if (rows.some((r) => !Number.isFinite(r[side]) || r[side] < 0)
      || !isWeightBalanced(rows.reduce((s, r) => s + r[side], 0))) {
      throw new Error("Los pesos de las posiciones deben sumar 100 % en cada cartera.");
    }
  }
  const side = (key: "a" | "b") => {
    const weights = rows.map((r) => r[key]).filter((w) => w > 0).sort((a, b) => b - a);
    return { count: weights.length, top1: weights[0], top5: weights.slice(0, 5).reduce((s, w) => s + w, 0),
      effective: 1 / weights.reduce((s, w) => s + (w / 100) ** 2, 0) };
  };
  return { a: side("a"), b: side("b"), shared: rows.filter((r) => r.a > 0 && r.b > 0).length,
    onlyA: rows.filter((r) => r.a > 0 && !r.b).length, onlyB: rows.filter((r) => r.b > 0 && !r.a).length,
    overlap: rows.reduce((s, r) => s + Math.min(r.a, r.b), 0),
    reallocation: rows.reduce((s, r) => s + Math.abs(r.b - r.a), 0) / 2 };
}

export interface ComparisonYearRow { label: string; start: string; end: string; a: number; b: number }

/** Require the common aligned daily observations; never join mismatched dates silently. */
export function validateComparisonHistory(a: readonly BacktestSeriesPoint[], b: readonly BacktestSeriesPoint[]): void {
  if (a.length < 2 || a.length !== b.length) throw new Error("El informe necesita dos históricos con las mismas fechas comunes.");
  a.forEach((p, i) => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Date.parse(p.date))
      && new Date(p.date).toISOString().slice(0, 10) === p.date;
    if (!validDate || p.date !== b[i].date || (i > 0 && p.date <= a[i - 1].date)
      || !Number.isFinite(p.value) || p.value <= 0 || !Number.isFinite(b[i].value) || b[i].value <= 0) {
      throw new Error("Las fechas o los valores del histórico comparativo no son válidos.");
    }
  });
}

/**
 * Chain successive calendar intervals, retaining actual boundary dates and partial years.
 * «Parcial» sigue la regla única `isFullCalendarYear` (la del informe interno): un año
 * entre dos cierres contiguos de la serie es completo aunque el último cierre quede a
 * más de 7 días del 31-12 (series semanales, festivos).
 */
export function comparisonYearReturns(a: readonly BacktestSeriesPoint[], b: readonly BacktestSeriesPoint[]): ComparisonYearRow[] {
  validateComparisonHistory(a, b);
  const rows: ComparisonYearRow[] = [];
  let start = 0;
  for (let i = 1; i < a.length; i++) {
    if (i !== a.length - 1 && a[i + 1].date.slice(0, 4) === a[i].date.slice(0, 4)) continue;
    const year = Number(a[i].date.slice(0, 4));
    // La base (a[start]) es el último cierre del año anterior salvo en el primer tramo.
    const firstInYear = a[start].date.startsWith(`${year}-`) ? a[start].date : a[start + 1].date;
    const full = isFullCalendarYear(year, { start: a[start].date, firstInYear, end: a[i].date, next: a[i + 1]?.date });
    rows.push({ label: `${year}${full ? "" : " · parcial"}`, start: a[start].date, end: a[i].date,
      a: a[i].value / a[start].value - 1, b: b[i].value / b[start].value - 1 });
    start = i;
  }
  return rows;
}

export function comparisonDrawdown(points: readonly BacktestSeriesPoint[]) {
  let peak = 0;
  let worstPeak = 0;
  let trough = 0;
  let depth = 0;
  const series = points.map((p, i) => {
    if (p.value >= points[peak].value) peak = i;
    const value = p.value / points[peak].value - 1;
    if (value < depth) { depth = value; worstPeak = peak; trough = i; }
    return { date: p.date, value };
  });
  const recoveryIndex = depth < 0 ? points.findIndex((p, i) => i > trough && p.value >= points[worstPeak].value) : -1;
  return { series, depth, peak: depth < 0 ? points[worstPeak].date : null, trough: depth < 0 ? points[trough].date : null,
    recovery: recoveryIndex >= 0 ? points[recoveryIndex].date : null,
    daysToRecovery: recoveryIndex >= 0 ? Math.round((Date.parse(points[recoveryIndex].date) - Date.parse(points[worstPeak].date)) / 86400000) : null };
}
