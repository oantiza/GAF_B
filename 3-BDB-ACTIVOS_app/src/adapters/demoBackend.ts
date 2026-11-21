/**
 * Backend de demostración — SOLO desarrollo sin Firebase configurado.
 *
 * Los módulos Agenda, Estrategia, Estado del sistema y BBDD maestra dependen de
 * funciones invocables. Sin credenciales, esas pantallas quedaban en blanco con
 * un aviso de error, lo que impedía revisarlas y hacía imposible enseñar la
 * herramienta sin conexión.
 *
 * Este módulo devuelve respuestas que cumplen exactamente los mismos contratos
 * que el backend real, de modo que los validadores de `contractGuards` siguen
 * siendo la única puerta de entrada. Las cifras son ilustrativas y la interfaz
 * lo señala siempre con el distintivo «Datos de muestra» de la barra superior.
 *
 * Se activa únicamente cuando `functions` es null (Firebase sin configurar) y
 * `import.meta.env.DEV` es cierto. En producción la aplicación exige fuente en
 * vivo, así que este camino nunca se ejecuta.
 */

import { computeFrontier, type FrontierAsset, type FrontierPortfolio } from "../core/frontier";
import { oFalta, rentabilidad } from "../core/formato";
import { bbddActivosStaticExportSample } from "../data/bbddActivosStaticExportSample";

const DAY_MS = 86_400_000;

/**
 * Reloj del simulador. En producción es «ahora»; las pruebas lo fijan con `setDemoClock` para que las
 * series sintéticas (que saltan sábados y domingos) no dependan del día en que corren.
 */
let demoClock: () => Date = () => new Date();
export function setDemoClock(clock: (() => Date) | null): void {
  demoClock = clock ?? (() => new Date());
}

function isoDay(offsetDays: number, from: Date = demoClock()): string {
  return new Date(from.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function isoStamp(offsetDays: number): string {
  return new Date(demoClock().getTime() + offsetDays * DAY_MS).toISOString();
}

/** Ruido determinista: la misma pantalla se ve igual en cada recarga. */
function wobble(seed: number, amplitude: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.545;
  return (x - Math.floor(x) - 0.5) * 2 * amplitude;
}

/* ------------------------------------------------------------------ *
 * Agenda de mercado
 * ------------------------------------------------------------------ */

function ecbRates() {
  return {
    schema_version: "ecb-rates.v1",
    rates: [
      { id: "estr", date: isoDay(-1), value: 2.42 },
      { id: "dfr", date: isoDay(-34), value: 2.5 },
      { id: "mro", date: isoDay(-34), value: 2.65 },
      { id: "mlf", date: isoDay(-34), value: 2.9 }
    ],
    requested_count: 4,
    live_count: 4,
    source: "ECB_DATA_PORTAL",
    retrieved_at: isoStamp(0),
    notes: "Serie de demostración: cifras ilustrativas, no operativas."
  };
}

const YIELD_MATURITIES = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30];

function euroYieldCurve() {
  const aaa = YIELD_MATURITIES.map((maturity) => ({
    maturity_years: maturity,
    yield_pct: Number((1.92 + 0.62 * Math.log(maturity + 1) + wobble(maturity, 0.04)).toFixed(3))
  }));
  const allBonds = YIELD_MATURITIES.map((maturity) => ({
    maturity_years: maturity,
    yield_pct: Number((2.31 + 0.68 * Math.log(maturity + 1) + wobble(maturity + 7, 0.04)).toFixed(3))
  }));
  return {
    schema_version: "ecb-yield-curve.v1",
    as_of_date: isoDay(-1),
    aaa,
    all_bonds: allBonds,
    source: "ECB_DATA_PORTAL",
    notes: "Curva de demostración: cifras ilustrativas, no operativas."
  };
}

const MACRO_EVENTS = [
  { country: "ES", type: "IPC armonizado interanual", actual: 2.4, estimate: 2.5, previous: 2.6, importance: 3 },
  { country: "EU", type: "Decisión de tipos del BCE", actual: null, estimate: 2.5, previous: 2.5, importance: 3 },
  { country: "US", type: "Nóminas no agrícolas", actual: 168_000, estimate: 175_000, previous: 142_000, importance: 3 },
  { country: "DE", type: "Índice IFO de clima empresarial", actual: 88.6, estimate: 89.1, previous: 88.4, importance: 2 },
  { country: "US", type: "Deflactor del consumo (PCE) subyacente", actual: null, estimate: 2.7, previous: 2.8, importance: 3 },
  { country: "EU", type: "PMI compuesto preliminar", actual: 51.4, estimate: 51.0, previous: 50.7, importance: 2 },
  { country: "ES", type: "Ventas minoristas interanual", actual: 1.8, estimate: 1.5, previous: 2.1, importance: 1 },
  { country: "JP", type: "Decisión de tipos del BoJ", actual: null, estimate: 0.75, previous: 0.5, importance: 3 },
  { country: "US", type: "Confianza del consumidor (Conference Board)", actual: 102.4, estimate: 101.0, previous: 100.2, importance: 2 },
  { country: "EU", type: "Producción industrial mensual", actual: -0.4, estimate: 0.1, previous: 0.8, importance: 1 }
];

function economicCalendar(opts: { from?: string; to?: string } = {}) {
  const from = opts.from ?? isoDay(-3);
  const to = opts.to ?? isoDay(10);
  const events = MACRO_EVENTS.map((event, index) => ({
    ...event,
    date: `${isoDay(index - 3 > 10 ? 10 : index - 3)}T${String(8 + (index % 9)).padStart(2, "0")}:30:00Z`,
    source: "Demostración"
  }));
  return {
    schema_version: "economic-calendar.v1",
    events,
    from,
    to,
    source: "Datos de muestra",
    note: "Calendario de demostración: fechas y cifras ilustrativas.",
    count: events.length
  };
}

const DIVIDEND_ROWS = [
  { code: "ITX.MC", name: "Industria de Diseño Textil", amount: 0.809, period: "Complementario", yield: 3.1 },
  { code: "IBE.MC", name: "Iberdrola", amount: 0.35, period: "A cuenta", yield: 4.6 },
  { code: "SAN.MC", name: "Banco Santander", amount: 0.115, period: "A cuenta", yield: 4.2 },
  { code: "BBVA.MC", name: "BBVA", amount: 0.29, period: "Complementario", yield: 5.4 },
  { code: "REP.MC", name: "Repsol", amount: 0.475, period: "A cuenta", yield: 6.9 },
  { code: "ENG.MC", name: "Enagás", amount: 0.5, period: "Complementario", yield: 8.3 },
  { code: "TEF.MC", name: "Telefónica", amount: 0.15, period: "A cuenta", yield: 7.1 },
  { code: "ELE.MC", name: "Endesa", amount: 0.5, period: "A cuenta", yield: 5.8 }
];

function dividendsCalendar(opts: { from?: string; to?: string } = {}) {
  const items = DIVIDEND_ROWS.map((row, index) => ({
    ...row,
    ex_date: isoDay(index * 3 + 2),
    payment_date: isoDay(index * 3 + 9),
    currency: "EUR"
  }));
  return {
    schema_version: "dividends-calendar.v1",
    items,
    from: opts.from ?? isoDay(0),
    to: opts.to ?? isoDay(30),
    source: "Datos de muestra",
    note: "Dividendos de demostración: importes ilustrativos.",
    count: items.length
  };
}

const EARNINGS_ROWS = [
  { code: "AAPL.US", name: "Apple Inc.", eps_estimate: 2.35, eps_actual: 2.48, when: "Después del cierre" },
  { code: "MSFT.US", name: "Microsoft Corporation", eps_estimate: 3.42, eps_actual: 3.61, when: "Después del cierre" },
  { code: "SAN.MC", name: "Banco Santander", eps_estimate: 0.21, eps_actual: null, when: "Antes de la apertura" },
  { code: "ITX.MC", name: "Industria de Diseño Textil", eps_estimate: 0.44, eps_actual: null, when: "Antes de la apertura" },
  { code: "ASML.AS", name: "ASML Holding", eps_estimate: 5.12, eps_actual: 4.87, when: "Antes de la apertura" },
  { code: "NVDA.US", name: "NVIDIA Corporation", eps_estimate: 1.08, eps_actual: null, when: "Después del cierre" },
  { code: "IBE.MC", name: "Iberdrola", eps_estimate: 0.19, eps_actual: 0.2, when: "Antes de la apertura" }
];

function earningsCalendar(opts: { from?: string; to?: string } = {}) {
  const items = EARNINGS_ROWS.map((row, index) => {
    const surprise =
      row.eps_actual === null || !row.eps_estimate
        ? null
        : Number((((row.eps_actual - row.eps_estimate) / Math.abs(row.eps_estimate)) * 100).toFixed(2));
    return {
      ...row,
      report_date: isoDay(index * 2 - 2),
      currency: index >= 2 && index !== 5 ? "EUR" : "USD",
      eps_surprise_pct: surprise,
      revenue_actual: row.eps_actual === null ? null : Math.round(24_000 + index * 3_100),
      revenue_estimate: Math.round(23_500 + index * 3_000)
    };
  });
  return {
    schema_version: "earnings-calendar.v1",
    items,
    from: opts.from ?? isoDay(-7),
    to: opts.to ?? isoDay(14),
    source: "Datos de muestra",
    note: "Resultados de demostración: estimaciones ilustrativas.",
    count: items.length
  };
}

/* ------------------------------------------------------------------ *
 * Estrategia semanal
 * ------------------------------------------------------------------ */

async function weeklyReport(type: string) {
  const { WEEKLY_REPORT_MOCK } = await import("../data/weeklyReportMock");
  // 09-2026: el mensual se retiro; en modo local el diario reutiliza la muestra
  // pero sin asignacion, para que la demo se parezca al contrato real.
  const daily = type === "DAILY_REPORT";
  const base = daily ? { ...WEEKLY_REPORT_MOCK, assetAllocation: undefined } : WEEKLY_REPORT_MOCK;
  return {
    report: {
      ...base,
      id: daily ? "demo-daily" : "demo-weekly",
      date: isoStamp(-2),
      provider: "Datos de muestra"
    },
    source: "Datos de muestra",
    freshness: "CURRENT",
    age_days: 2,
    invalid_count: 0,
    note: "Informe de demostración: contenido ilustrativo, no es una recomendación."
  };
}

/* ------------------------------------------------------------------ *
 * Estado del sistema
 * ------------------------------------------------------------------ */

function systemStatus() {
  return {
    integrity: {
      checked_at: isoStamp(0),
      status: "WARN",
      applied: true,
      problems: [
        {
          severity: "WARN",
          check: "price_series_gap",
          detail: "3 activos con más de 5 días hábiles sin cotización nueva.",
          sample: ["IE00B5BMR087", "US88160R1014", "SXXP"]
        },
        {
          severity: "INFO",
          check: "missing_benchmark",
          detail: "1 activo sin benchmark oficial asignado.",
          sample: ["LU1681048804"]
        }
      ],
      counts: {
        assets: 753,
        assets_with_isin: 740,
        price_series: 731,
        metrics_latest: 726,
        holdings: 402
      },
      freshness: {
        price_refresh: "OK",
        metrics_refresh: "WARN",
        backup: "OK"
      }
    },
    backup: {
      completed_at: isoStamp(-1),
      verification: "OK",
      firestore_records: 12_486,
      auth_users: 4,
      backup_dir: "gs://bbdd-activos-backups/2026-07-25"
    },
    prices: {
      last_run: isoStamp(0),
      last_run_date: isoDay(0),
      read_budget_max: 50_000,
      read_budget_used: 18_240
    },
    metrics: {
      last_run: isoStamp(-2),
      last_price_series_last_date: isoDay(-3),
      scan_after_asset_id: null,
      cycle_completed: true,
      scanned_assets: 753,
      processed_assets: 726,
      written: 726,
      read_budget_max: 50_000,
      read_budget_used: 31_115,
      stopped_by_budget: false
    }
  };
}

/* ------------------------------------------------------------------ *
 * BBDD maestra
 * ------------------------------------------------------------------ */

function adminDbStatus() {
  const total = 753;
  const withHistory = 731;
  const withoutHistory = total - withHistory;
  const reach2011 = 604;
  const notReach2011 = withHistory - reach2011;
  const stale = 27;

  return {
    generated_at: isoStamp(0),
    total_assets: total,
    by_type: { FUND: 405, ETF: 178, STOCK: 152, INDEX: 18 },
    with_history: withHistory,
    without_history: withoutHistory,
    reach_2011: reach2011,
    not_reach_2011: notReach2011,
    stale,
    stale_days_threshold: 5,
    last_refresh_date: isoDay(0),
    latest_data_date: isoDay(-1),
    latest_by_type: {
      FUND: isoDay(-1),
      ETF: isoDay(0),
      STOCK: isoDay(0),
      INDEX: isoDay(0)
    },
    master_writes_enabled: false,
    master_writes_env: "demo",
    master_writes_mode: "disabled",
    app_check_enforced: true,
    metrics_present: { vol: 726, sharpe: 726, srri: 719, mdd: 712, mdd_hist: 688 },
    start_year_histogram: { "2011": 604, "2015": 62, "2018": 41, "2021": 24 },
    anomalies: {
      sin_historico: withoutHistory,
      desactualizados: stale,
      no_llega_2011: notReach2011,
      valle_reciente: 4,
      total_flagged: withoutHistory + stale + notReach2011 + 4
    }
  };
}

/* ------------------------------------------------------------------ *
 * Series históricas rebasadas a 100
 * ------------------------------------------------------------------ */

const WINDOW_WEEKS: Record<string, number> = { "1Y": 52, "3Y": 156, "5Y": 260, "10Y": 520 };

/**
 * Fechas de una serie demo. DAILY = sesiones hábiles (lunes a viernes) que
 * cubren la ventana entera: semanas × 5 + 1, para que el remuestreo semanal
 * dé una rentabilidad por semana de la ventana. ALTA-08 (auditoría
 * 16-10-2026): antes eran como mucho 760 días NATURALES (unos dos años), y el
 * Monte Carlo del PDF, que exige 156 rentabilidades semanales, no salía nunca
 * en modo demo. WEEKLY sigue como estaba: un punto cada siete días.
 */
function demoSeriesDates(window: string, frequency: "DAILY" | "WEEKLY", from: Date = demoClock()): string[] {
  if (frequency === "WEEKLY") {
    const points = WINDOW_WEEKS[window];
    return Array.from({ length: points }, (_, index) => isoDay(-(points - 1 - index) * 7, from));
  }
  const points = WINDOW_WEEKS[window] * 5 + 1;
  const dates: string[] = [];
  for (let offset = 0; dates.length < points; offset -= 1) {
    const day = new Date(from.getTime() + offset * DAY_MS);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(day.toISOString().slice(0, 10));
  }
  return dates.reverse();
}

/** Serie sintética con deriva y ruido estables por activo. */
function syntheticSeries(assetId: string, points: number): number[] {
  const seed = Array.from(assetId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const drift = 0.0004 + (seed % 11) * 0.00016;
  const noise = 0.004 + (seed % 7) * 0.0018;
  const values: number[] = [];
  let level = 100;
  for (let index = 0; index < points; index += 1) {
    level *= 1 + drift + wobble(seed + index, noise);
    values.push(Number(level.toFixed(3)));
  }
  return values;
}

function priceSeries(input: { asset_ids?: unknown; window?: unknown; frequency?: unknown } = {}) {
  const assetIds = Array.isArray(input.asset_ids) ? input.asset_ids.map(String) : [];
  const window = typeof input.window === "string" && WINDOW_WEEKS[input.window] ? input.window : "3Y";
  const frequency = input.frequency === "DAILY" ? "DAILY" : "WEEKLY";
  const dates = demoSeriesDates(window, frequency);
  const points = dates.length;
  const series = assetIds.map((assetId) => ({
    asset_id: assetId,
    display_name: assetId,
    values: syntheticSeries(assetId, points)
  }));

  return {
    schema_version: "price-series.v1",
    base_currency: "EUR",
    window,
    frequency,
    rebased_to: 100,
    dates,
    series,
    coverage: {
      requested_assets: assetIds.length,
      included_assets: series.length,
      common_observations: points,
      first_date: dates[0] ?? null,
      last_date: dates[dates.length - 1] ?? null
    },
    excluded_assets: []
  };
}

/* ------------------------------------------------------------------ *
 * Optimizador y backtest (demo sin muros — auditoría 11-08, N5)
 *
 * Sin credenciales, «Optimizar» y «Simulación/backtest» quedaban muertos con
 * un aviso técnico. Estos handlers devuelven respuestas que cumplen los
 * contratos portfolio-frontier.v1 y backtest.v1 (los mismos guards del
 * adapter siguen siendo la puerta de entrada) usando las métricas de la
 * muestra estática y series sintéticas DETERMINISTAS (semilla por charCode:
 * el mismo input produce siempre la misma curva).
 * ------------------------------------------------------------------ */

/** Coherente con el €STR de get_ecb_rates (2,42 %). */
const DEMO_RISK_FREE = 0.0242;
const FRONTIER_OBJECTIVES = ["MAX_SHARPE", "MIN_VOLATILITY", "TARGET_RETURN", "TARGET_RISK"] as const;

function charSeed(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function round6(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Métricas por activo: la muestra estática si el activo está en ella; si no, sintéticas deterministas. */
function demoFrontierAsset(assetId: string): FrontierAsset {
  const sample = bbddActivosStaticExportSample.find(
    (asset) => asset.asset_id === assetId || asset.isin === assetId
  );
  if (
    sample &&
    typeof sample.annualized_return_3y === "number" &&
    typeof sample.volatility_3y === "number" &&
    sample.volatility_3y > 0
  ) {
    return {
      id: assetId,
      name: sample.name,
      expectedReturn: sample.annualized_return_3y,
      volatility: sample.volatility_3y,
      assetClass: sample.economic_asset_class
    };
  }
  const seed = charSeed(assetId);
  return {
    id: assetId,
    name: assetId,
    expectedReturn: 0.018 + (seed % 9) * 0.007,
    volatility: 0.05 + (seed % 13) * 0.014,
    assetClass: seed % 3 === 0 ? "FIXED_INCOME" : "EQUITY"
  };
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Punto del contrato portfolio-frontier.v1 (weights {} en la polilínea: la UI no los usa ahí). */
function contractPoint(
  stats: { ret: number; vol: number; sharpe: number },
  weights: Record<string, number> = {}
): Record<string, unknown> {
  return {
    expected_return: round6(stats.ret),
    volatility: round6(stats.vol),
    sharpe_ratio: round6(stats.sharpe),
    weights
  };
}

/** Respeta los candados: fija los pesos bloqueados y reescala el resto a 1 - suma bloqueada. */
function applyLockedWeights(
  base: Record<string, number>,
  locked: Record<string, number>
): Record<string, number> {
  const lockedEntries = Object.entries(locked).filter(([, weight]) => Number.isFinite(weight) && weight >= 0);
  if (lockedEntries.length === 0) return base;
  const lockedTotal = Math.min(1, lockedEntries.reduce((sum, [, weight]) => sum + weight, 0));
  const lockedIds = new Set(lockedEntries.map(([assetId]) => assetId));
  const freeIds = Object.keys(base).filter((assetId) => !lockedIds.has(assetId));
  const freeBase = freeIds.reduce((sum, assetId) => sum + Math.max(0, base[assetId] ?? 0), 0);
  const remaining = Math.max(0, 1 - lockedTotal);
  const out: Record<string, number> = {};
  for (const [assetId, weight] of lockedEntries) out[assetId] = weight;
  for (const assetId of freeIds) {
    out[assetId] = freeBase > 0
      ? (Math.max(0, base[assetId] ?? 0) / freeBase) * remaining
      : freeIds.length > 0 ? remaining / freeIds.length : 0;
  }
  return out;
}

/** Estadísticas (ret/vol/sharpe + pesos normalizados) de una cartera concreta. */
function evaluateDemoWeights(assets: FrontierAsset[], weights: Record<string, number>): FrontierPortfolio | null {
  const evaluated = computeFrontier(assets, {
    currentWeights: weights,
    riskFree: DEMO_RISK_FREE
  });
  return evaluated?.current ?? null;
}

/**
 * Atribución de riesgo aproximada (peso × volatilidad, normalizado a 100).
 * El guard del adapter exige que risk_pct sume 100 con tolerancia 1e-6: el
 * residuo de coma flotante se absorbe en la fila de mayor contribución.
 */
function demoRiskContributions(
  weights: Record<string, number>,
  volByAsset: Map<string, number>
): { risk_contributions: unknown; risk_contributions_meta: Record<string, unknown> } {
  const rows = Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .map(([assetId, weight]) => ({
      asset_id: assetId,
      weight_pct: weight * 100,
      raw: weight * (volByAsset.get(assetId) ?? 0)
    }));
  const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);
  if (rows.length === 0 || totalRaw <= 0) {
    return {
      risk_contributions: null,
      risk_contributions_meta: { cov_model: "SAMPLE", reason: "ZERO_VOLATILITY" }
    };
  }
  const items = rows.map((row) => ({
    asset_id: row.asset_id,
    weight_pct: row.weight_pct,
    risk_pct: (row.raw / totalRaw) * 100
  }));
  const signedSum = items.reduce((sum, item) => sum + item.risk_pct, 0);
  let largest = items[0];
  for (const item of items) {
    if (item.risk_pct > largest.risk_pct) largest = item;
  }
  largest.risk_pct += 100 - signedSum;
  return { risk_contributions: items, risk_contributions_meta: { cov_model: "SAMPLE" } };
}

/** Handler demo de `optimize_portfolio` (contrato portfolio-frontier.v1). */
function optimizePortfolioDemo(input: DemoInput): Record<string, unknown> {
  const request = (input ?? {}) as {
    asset_ids?: unknown;
    window?: unknown;
    objective?: unknown;
    current_weights?: unknown;
    locked_weights?: unknown;
    constraints?: { min_weight?: unknown; max_weight?: unknown; max_turnover?: unknown };
    risk_slider?: unknown;
    risk_target_mode?: unknown;
    target_return?: unknown;
    expected_return_model?: unknown;
  };

  const assetIds = Array.isArray(request.asset_ids) ? [...new Set(request.asset_ids.map(String))] : [];
  const window = typeof request.window === "string" && WINDOW_WEEKS[request.window] ? request.window : "3Y";
  const objective =
    typeof request.objective === "string" && (FRONTIER_OBJECTIVES as readonly string[]).includes(request.objective)
      ? request.objective
      : "MAX_SHARPE";
  const currentWeights = numberRecord(request.current_weights);
  const locked = numberRecord(request.locked_weights) ?? {};
  const hasLocks = Object.keys(locked).length > 0;
  const maxWeight =
    typeof request.constraints?.max_weight === "number" && request.constraints.max_weight > 0
      ? Math.min(1, request.constraints.max_weight)
      : 1;
  const minWeightBound =
    typeof request.constraints?.min_weight === "number" && request.constraints.min_weight >= 0
      ? Math.min(1, request.constraints.min_weight)
      : 0;

  const assets = assetIds.map(demoFrontierAsset);
  const volByAsset = new Map(assets.map((asset) => [asset.id, asset.volatility]));
  const result = computeFrontier(assets, {
    riskFree: DEMO_RISK_FREE,
    currentWeights,
    maxWeight
  });
  if (!result) {
    throw new Error("La demo necesita al menos 2 activos con métricas para calcular la frontera.");
  }

  const maxTurnover =
    typeof request.constraints?.max_turnover === "number" && request.constraints.max_turnover > 0 && currentWeights
      ? Math.min(2, request.constraints.max_turnover)
      : null;
  /** Demo del límite de rotación: encoge la propuesta hacia los pesos actuales hasta cumplir Σ|w − w₀| ≤ τ. */
  const capTurnover = (weights: Record<string, number>): Record<string, number> => {
    if (maxTurnover === null || !currentWeights) return weights;
    const total = Object.values(currentWeights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const base = Object.fromEntries(assetIds.map((id) => [id, Math.max(0, currentWeights[id] ?? 0) / total]));
    const distance = assetIds.reduce((sum, id) => sum + Math.abs((weights[id] ?? 0) - base[id]), 0);
    if (distance <= maxTurnover) return weights;
    const factor = maxTurnover / distance;
    return Object.fromEntries(assetIds.map((id) => [id, base[id] + ((weights[id] ?? 0) - base[id]) * factor]));
  };
  const resolvePoint = (base: FrontierPortfolio): FrontierPortfolio => {
    if (!hasLocks && maxTurnover === null) return base;
    const capped = capTurnover(base.weights);
    const adjusted = hasLocks ? applyLockedWeights(capped, locked) : capped;
    return evaluateDemoWeights(assets, adjusted) ?? { ...base, weights: adjusted };
  };
  const maxSharpe = resolvePoint(result.maxSharpe);
  const minVol = resolvePoint(result.minVol);

  /** Interpola pesos entre dos carteras (t=0, la primera; t=1, la segunda) y los evalúa. */
  const mezclar = (desde: FrontierPortfolio, hasta: FrontierPortfolio, t: number): FrontierPortfolio | null => {
    const clamped = Math.max(0, Math.min(1, t));
    const blended: Record<string, number> = {};
    for (const assetId of assetIds) {
      blended[assetId] =
        (desde.weights[assetId] ?? 0) * (1 - clamped) + (hasta.weights[assetId] ?? 0) * clamped;
    }
    return evaluateDemoWeights(assets, blended);
  };
  const blendPoint = (t: number) => mezclar(minVol, maxSharpe, t);
  /** Lo más que da el modelo con estos límites: llenando por orden de rentabilidad hasta el tope. */
  const laDeMasRentabilidad = (): FrontierPortfolio => {
    const pesos: Record<string, number> = {};
    let resto = 1;
    for (const asset of [...assets].sort((a, b) => b.expectedReturn - a.expectedReturn)) {
      pesos[asset.id] = Math.min(maxWeight, resto);
      resto -= pesos[asset.id];
    }
    const punto = evaluateDemoWeights(assets, pesos);
    const limitada = punto ? resolvePoint(punto) : maxSharpe;
    return limitada.ret > maxSharpe.ret ? limitada : maxSharpe;
  };

  const weeks = WINDOW_WEEKS[window];
  const frontierVols = result.frontier.map((point) => point.vol);
  const methodology: Record<string, unknown> = {
    window,
    frequency: "WEEKLY",
    annualization_factor: 52,
    alignment_policy: "COMMON_WEEKLY_DATES",
    risk_free_source: "ECB_ESTR",
    risk_free_rate: DEMO_RISK_FREE,
    risk_free_rate_policy: "STATIC_FALLBACK",
    optimizer: "DEMO_MEAN_VARIANCE_QP",
    covariance_estimator: "ASSUMED_CLASS_CORRELATION",
    expected_return_model:
      typeof request.expected_return_model === "string" ? request.expected_return_model : "HISTORICAL_SHRINKAGE",
    objective,
    weight_bounds: [minWeightBound, maxWeight]
  };
  if (maxTurnover !== null) methodology.max_turnover = maxTurnover;
  if (frontierVols.length > 0) {
    methodology.frontier_min_volatility = round6(Math.min(...frontierVols));
    methodology.frontier_max_volatility = round6(Math.max(...frontierVols));
  }

  const response: Record<string, unknown> = {
    schema_version: "portfolio-frontier.v1",
    as_of_date: isoDay(-1),
    units: "decimal",
    base_currency: "EUR",
    methodology,
    coverage: {
      requested_assets: assetIds.length,
      included_assets: assets.length,
      common_observations: weeks,
      first_date: isoDay(-weeks * 7),
      last_date: isoDay(-1)
    },
    min_volatility_portfolio: contractPoint(minVol, minVol.weights),
    max_sharpe_portfolio: contractPoint(maxSharpe, maxSharpe.weights),
    frontier: result.frontier.map((point) => contractPoint(point, point.weights)),
    excluded_assets: [],
    warnings: [
      "Frontera de demostración: calculada en local con las métricas de la muestra estática; cifras ilustrativas, no operativas."
    ]
  };
  if (result.current) {
    response.current_portfolio = contractPoint(result.current, result.current.weights);
  }

  let proposal: FrontierPortfolio = objective === "MIN_VOLATILITY" ? minVol : maxSharpe;
  if (objective === "TARGET_RISK") {
    const rawSlider = typeof request.risk_slider === "number" && Number.isFinite(request.risk_slider)
      ? request.risk_slider
      : 5;
    const slider = Math.max(1, Math.min(10, rawSlider));
    const target = blendPoint((slider - 1) / 9) ?? maxSharpe;
    response.target_portfolio = contractPoint(target, target.weights);
    methodology.target_risk_mode = request.risk_target_mode === "ABSOLUTE_VOL" ? "ABSOLUTE_VOL" : "FRONTIER_PERCENTILE";
    methodology.risk_slider_value = slider;
    methodology.achieved_volatility = round6(target.vol);
    proposal = target;
  } else if (objective === "TARGET_RETURN") {
    const targetReturn = typeof request.target_return === "number" && Number.isFinite(request.target_return)
      ? request.target_return
      : maxSharpe.ret;
    /* Como el motor: por debajo de la de menor riesgo, esa, y por encima de lo que se puede dar, «Sin solución» con su cifra.
       La demo no tiene series: no manda `target_return_measured`, y la pantalla dice que esa medida falta. */
    const techo = laDeMasRentabilidad();
    if (targetReturn > techo.ret + 1e-9) {
      throw new Error(`Sin solución: con estos límites, la media de la serie llega como mucho a un ${oFalta(rentabilidad(Math.floor(techo.ret * 10000) / 10000))}, y has pedido un ${oFalta(rentabilidad(targetReturn))}.`);
    }
    const tramo = (desde: FrontierPortfolio, hasta: FrontierPortfolio) =>
      mezclar(desde, hasta, hasta.ret - desde.ret > 1e-9 ? (targetReturn - desde.ret) / (hasta.ret - desde.ret) : 1);
    const target = (targetReturn <= minVol.ret ? minVol : targetReturn <= maxSharpe.ret ? tramo(minVol, maxSharpe) : tramo(maxSharpe, techo)) ?? maxSharpe;
    methodology.target_return = targetReturn;
    methodology.target_return_floor = minVol.ret;
    response.target_return_portfolio = contractPoint(target, target.weights);
    proposal = target;
  }

  const contributions = demoRiskContributions(proposal.weights, volByAsset);
  response.risk_contributions = contributions.risk_contributions;
  response.risk_contributions_meta = contributions.risk_contributions_meta;
  return response;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 2) return 0;
  let meanLeft = 0;
  let meanRight = 0;
  for (let index = 0; index < n; index += 1) {
    meanLeft += left[index];
    meanRight += right[index];
  }
  meanLeft /= n;
  meanRight /= n;
  let cov = 0;
  let varLeft = 0;
  let varRight = 0;
  for (let index = 0; index < n; index += 1) {
    const dLeft = left[index] - meanLeft;
    const dRight = right[index] - meanRight;
    cov += dLeft * dRight;
    varLeft += dLeft * dLeft;
    varRight += dRight * dRight;
  }
  if (varLeft <= 0 || varRight <= 0) return 0;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(varLeft * varRight)));
}

/** Handler demo de `backtest_portfolio` (contrato backtest.v1). */
function backtestPortfolioDemo(input: DemoInput, fullHorizon = false): Record<string, unknown> {
  const request = (input ?? {}) as { positions?: unknown; period?: unknown; frequency?: unknown };
  const rawPositions = Array.isArray(request.positions) ? request.positions : [];
  const positions = rawPositions
    .map((item) => item as { asset_id?: unknown; weight?: unknown })
    .filter(
      (item) =>
        typeof item.asset_id === "string" &&
        typeof item.weight === "number" &&
        Number.isFinite(item.weight) &&
        item.weight > 0
    )
    .map((item) => ({ asset_id: item.asset_id as string, weight: item.weight as number }));

  const window = typeof request.period === "string" && WINDOW_WEEKS[request.period] ? request.period : "3Y";
  const frequency = request.frequency === "DAILY" ? "DAILY" : "WEEKLY";
  // A full 3/5-year weekly horizon needs both endpoints and the calendar-day remainder.
  const fullHorizonPoints = Math.ceil(Number(window.slice(0, -1)) * 365.25 / 7) + 1;
  const dates = fullHorizon
    ? Array.from({ length: fullHorizonPoints }, (_, index) => isoDay(-(fullHorizonPoints - 1 - index) * 7))
    : demoSeriesDates(window, frequency);
  const points = dates.length;
  const periodsPerYear = frequency === "DAILY" ? 260 : 52;

  const weightById = new Map<string, number>();
  for (const position of positions) {
    weightById.set(position.asset_id, (weightById.get(position.asset_id) ?? 0) + position.weight);
  }
  const assetIds = [...weightById.keys()];
  const totalWeight = [...weightById.values()].reduce((sum, weight) => sum + weight, 0);
  const weightsNormalized: Record<string, number> = {};
  for (const [assetId, weight] of weightById) {
    weightsNormalized[assetId] = totalWeight > 0 ? round6(weight / totalWeight) : 0;
  }

  // La MISMA serie sintética determinista que get_price_series: el mismo input
  // (activo + ventana + frecuencia) produce siempre la misma curva.
  const returnsByAsset = assetIds.map((assetId) => {
    const values = syntheticSeries(assetId, points);
    const returns: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
      returns.push(values[index] / values[index - 1] - 1);
    }
    return returns;
  });

  const portfolioValues: number[] = [100];
  for (let step = 0; step < points - 1; step += 1) {
    let portfolioReturn = 0;
    assetIds.forEach((assetId, assetIndex) => {
      portfolioReturn += (weightsNormalized[assetId] ?? 0) * (returnsByAsset[assetIndex][step] ?? 0);
    });
    portfolioValues.push(portfolioValues[step] * (1 + portfolioReturn));
  }

  // Métricas calculadas de la propia serie sintética (coherentes entre sí).
  const portfolioReturns: number[] = [];
  for (let index = 1; index < portfolioValues.length; index += 1) {
    portfolioReturns.push(portfolioValues[index] / portfolioValues[index - 1] - 1);
  }
  const yearsElapsed = (points - 1) / periodsPerYear;
  const cagr = yearsElapsed > 0 && portfolioValues[0] > 0
    ? Math.pow(portfolioValues[portfolioValues.length - 1] / portfolioValues[0], 1 / yearsElapsed) - 1
    : 0;
  const meanReturn = portfolioReturns.length > 0
    ? portfolioReturns.reduce((sum, value) => sum + value, 0) / portfolioReturns.length
    : 0;
  const variance = portfolioReturns.length > 1
    ? portfolioReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (portfolioReturns.length - 1)
    : 0;
  const volatility = Math.sqrt(Math.max(variance, 0) * periodsPerYear);
  const sharpe = volatility > 1e-9 ? (cagr - DEMO_RISK_FREE) / volatility : 0;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const value of portfolioValues) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }

  const correlationMatrix = assetIds.map((_, rowIndex) =>
    assetIds.map((_, colIndex) =>
      rowIndex === colIndex ? 1 : round6(pearsonCorrelation(returnsByAsset[rowIndex], returnsByAsset[colIndex]))
    )
  );

  return {
    schema_version: "backtest.v1",
    base_currency: "EUR",
    window,
    frequency,
    units: "decimal",
    metrics: {
      cagr: round6(cagr),
      volatility: round6(volatility),
      sharpe: round6(sharpe),
      max_drawdown: round6(maxDrawdown),
      rf_rate: DEMO_RISK_FREE
    },
    risk_free: {
      risk_free_source: "ECB_ESTR",
      risk_free_rate: DEMO_RISK_FREE,
      risk_free_rate_policy: "STATIC_FALLBACK"
    },
    portfolio_series: portfolioValues.map((value, index) => ({
      date: dates[index],
      value: Number(value.toFixed(3))
    })),
    asset_ids: assetIds,
    weights_normalized: weightsNormalized,
    correlation_matrix: correlationMatrix,
    benchmark_series: {},
    synthetics: [],
    coverage: {
      requested_assets: rawPositions.length,
      included_assets: assetIds.length,
      common_observations: points,
      first_date: dates[0] ?? null,
      last_date: dates[dates.length - 1] ?? null
    },
    excluded_assets: [],
    warnings: [
      "Simulación histórica de demostración: serie sintética determinista derivada del identificador de cada activo; cifras ilustrativas, no operativas."
    ]
  };
}

/** Same synthetic observations and metrics for the screen and exported report. */
function portfolioHorizonDemo(input: DemoInput): Record<string, unknown> {
  const window = input?.window;
  if (window !== "3Y" && window !== "5Y") throw new Error("Periodo de muestra no admitido.");
  const backtest = backtestPortfolioDemo({ ...input, period: window, frequency: "WEEKLY" }, true);
  const assetIds = backtest.asset_ids as string[];
  if (assetIds.length === 0) throw new Error("Añade posiciones con peso positivo para generar el informe.");
  const equalWeight = backtestPortfolioDemo({ period: window, frequency: "WEEKLY",
    positions: assetIds.map((asset_id) => ({ asset_id, weight: 1 / assetIds.length })) }, true);
  return {
    schema_version: "portfolio-horizon.v1", window, horizon_years: Number(window[0]),
    reference_version: "demo-synthetic.v1", backtest, equal_weight: equalWeight,
    max_sharpe: null, frontier: null,
    frontier_unavailable_reason: "La muestra no incluye una frontera calculada con estas series sintéticas.",
    coverage_weight_percent: 100, extensions: [],
    methodology: "Datos de muestra: series sintéticas deterministas. Cifras ilustrativas, no operativas."
  };
}

/* ------------------------------------------------------------------ *
 * Enrutado
 * ------------------------------------------------------------------ */

/** Handler demo de `improve_portfolio` (contrato portfolio-improvement.v1): una
 *  sustitución ilustrativa en la primera posición con candidatos. */
function improvePortfolioDemo(input: DemoInput): Record<string, unknown> {
  const request = (input ?? {}) as { positions?: unknown; candidates?: unknown; window?: unknown };
  const positions = Array.isArray(request.positions)
    ? request.positions.flatMap((item) => {
      const row = item as { asset_id?: unknown; weight?: unknown };
      return typeof row.asset_id === "string" && typeof row.weight === "number" && row.weight > 0 ? [{ asset_id: row.asset_id, weight: row.weight }] : [];
    })
    : [];
  const candidates = (request.candidates && typeof request.candidates === "object" ? request.candidates : {}) as Record<string, unknown>;
  const window = request.window === "5Y" ? "5Y" : "3Y";
  const weeks = window === "5Y" ? 260 : 156;
  const selectionWeeks = Math.round(weeks * 2 / 3);
  const first = positions.find((position) => Array.isArray(candidates[position.asset_id]) && (candidates[position.asset_id] as unknown[]).length > 0);
  const total = positions.reduce((sum, position) => sum + position.weight, 0) || 1;
  const originalWeights = Object.fromEntries(positions.map((position) => [position.asset_id, position.weight / total]));
  const metrics = (cagr: number, vol: number, mdd: number, n: number) => ({
    cagr, volatility: vol, sharpe: (cagr - 0.02) / vol, max_drawdown: mdd, cumulative_return: (1 + cagr) ** (n / 52) - 1, weeks: n
  });
  const originalMetrics = {
    selection: metrics(0.061, 0.112, -0.142, selectionWeeks),
    confirmation: metrics(0.054, 0.118, -0.097, weeks - selectionWeeks),
    full: metrics(0.058, 0.114, -0.142, weeks)
  };
  const windows = {
    frequency: "WEEKLY",
    full: { first_date: isoDay(-weeks * 7), last_date: isoDay(0), weeks },
    selection: { first_date: isoDay(-weeks * 7), last_date: isoDay(-(weeks - selectionWeeks) * 7), weeks: selectionWeeks },
    confirmation: { first_date: isoDay(-(weeks - selectionWeeks) * 7), last_date: isoDay(0), weeks: weeks - selectionWeeks }
  };
  const base = {
    schema_version: "portfolio-improvement.v1", window, base_currency: "EUR",
    original: { weights: originalWeights, metrics: originalMetrics, weighted_cost: 0.0142 },
    windows, rejected_candidates: {}, excluded_assets: [], evaluated_combinations: 0, search: "EXHAUSTIVE", warnings: [],
    risk_free: { risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: { requested_assets: positions.length, included_assets: positions.length, common_observations: weeks + 1, first_date: windows.full.first_date, last_date: windows.full.last_date }
  };
  if (!first) {
    return { ...base, status: "INFEASIBLE", proposals: [], reason: "Ninguna posición tiene candidatos equivalentes evaluables." };
  }
  const replacement = String((candidates[first.asset_id] as unknown[])[0]);
  const weightsAfter = Object.fromEntries(Object.entries(originalWeights).map(([id, weight]) => [id === first.asset_id ? replacement : id, weight]));
  const proposalMetrics = {
    selection: metrics(0.071, 0.110, -0.135, selectionWeeks),
    confirmation: metrics(0.064, 0.116, -0.091, weeks - selectionWeeks),
    full: metrics(0.068, 0.112, -0.135, weeks)
  };
  const delta = (key: "cagr" | "volatility" | "sharpe" | "max_drawdown") => proposalMetrics.confirmation[key] - originalMetrics.confirmation[key];
  const check = (key: string, label: string, status: "PASS" | "FAIL" | "NOT_EVALUABLE", detail: string) => ({ key, label, status, detail });
  return {
    ...base,
    status: "PROPOSAL",
    evaluated_combinations: 1,
    proposals: [{
      substitutions: [{ from_asset_id: first.asset_id, to_asset_id: replacement, from_name: first.asset_id, to_name: replacement, weight: originalWeights[first.asset_id], correlation: 0.97, tracking_error: 0.021 }],
      weights: weightsAfter,
      metrics: proposalMetrics,
      deltas_confirmation: { cagr: delta("cagr"), volatility: delta("volatility"), sharpe: delta("sharpe"), max_drawdown: delta("max_drawdown") },
      weighted_cost: 0.0121,
      validation: [
        check("volatility_confirmación", "Volatilidad (confirmación)", "PASS", "−0,20 pp"),
        check("max_drawdown_confirmación", "Máxima caída (confirmación)", "PASS", "+0,60 pp"),
        check("sharpe_confirmación", "Sharpe (confirmación)", "PASS", "+0,09"),
        check("cagr_confirmación", "Rentabilidad anualizada (confirmación)", "PASS", "+1,00 pp"),
        check("cost", "Coste corriente ponderado", "PASS", "−0,21 pp"),
        check("group_asset_class", "Exposición por clase de activo", "PASS", "desviación máxima 0,0 pp"),
        check("group_region", "Exposición por región", "PASS", "desviación máxima 0,0 pp"),
        check("group_currency", "Exposición por divisa", "PASS", "desviación máxima 0,0 pp"),
        check("consistency", "Consistencia en ventanas móviles de un año", "PASS", "22 de 26 ventanas"),
        check("relevant_improvement", "Al menos una mejora relevante (confirmación)", "PASS", "Rentabilidad anualizada, Coste corriente ponderado")
      ],
      improvements: [
        { key: "cagr", label: "Rentabilidad anualizada", delta: delta("cagr") },
        { key: "cost", label: "Coste corriente ponderado", delta: -0.0021 }
      ],
      consistency: { windows: 26, wins: 22, share: 22 / 26, rolling_weeks: 52 },
      valid: true
    }]
  };
}

type DemoInput = Record<string, unknown> | undefined;

const HANDLERS: Record<string, (input: DemoInput) => unknown | Promise<unknown>> = {
  get_ecb_rates: () => ecbRates(),
  get_euro_yield_curve: () => euroYieldCurve(),
  get_economic_calendar: (input) => economicCalendar((input ?? {}) as { from?: string; to?: string }),
  get_dividends_calendar: (input) => dividendsCalendar((input ?? {}) as { from?: string; to?: string }),
  get_earnings_calendar: (input) => earningsCalendar((input ?? {}) as { from?: string; to?: string }),
  get_weekly_report: (input) => weeklyReport(String((input as { type?: string })?.type ?? "WEEKLY_REPORT")),
  get_system_status: () => systemStatus(),
  get_price_series: (input) => priceSeries((input ?? {}) as Record<string, unknown>),
  optimize_portfolio: (input) => optimizePortfolioDemo(input),
  improve_portfolio: (input) => improvePortfolioDemo(input),
  backtest_portfolio: (input) => input?.analysis_bundle === true ? portfolioHorizonDemo(input) : backtestPortfolioDemo(input),
  admin_fund_quality: (input) => input?.isin ? { profile: null } : ({ generated_at: isoStamp(0), total_funds: 0, with_profile: 0, with_history: 0, history_blocked: 0, with_kid: 0, rows: [] }),
  admin_db_status: () => adminDbStatus(),
  list_portfolios: () => ({ portfolios: [] })
};

export function hasDemoResponse(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HANDLERS, name);
}

export async function demoResponse(name: string, input: unknown): Promise<unknown> {
  const handler = HANDLERS[name];
  // Latencia simbólica: deja ver los estados de carga tal y como se comportan en vivo.
  await new Promise((resolve) => setTimeout(resolve, 180));
  return handler(input as DemoInput);
}
