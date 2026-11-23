/**
 * Cableado a la callable `backtest_portfolio` (backtest.v1).
 * Métricas + serie de cartera (rebase 100) + matriz de correlación de una cartera.
 * Solo lectura (LIVE_API); los errores de backend se propagan para mostrarlos en UI.
 * Desbloquea: Táctico, Sharpe maximizer, comparativa histórica y multiperiodo.
 */
import { callBackend } from "./callableBackend";
import { AppError } from "../core/appError";
import { PESO_MINIMO_DE_UNA_CRISIS_PCT } from "../core/crisisPasadas";
import {
  type GuardObject,
  requireArray,
  requireBoolean,
  requireLiteral,
  requireNullableNumber,
  requireNullableString,
  requireNumber,
  requireObject,
  requireOneOf,
  requireString,
  requireStringArray
} from "./contractGuards";

export type BacktestWindow = "1Y" | "3Y" | "5Y" | "10Y";
export type BacktestFrequency = "WEEKLY" | "DAILY";

/**
 * Contrato de las métricas (15-11-2026, decisión de Óscar): un tramo de menos de 330 días
 * (`MIN_ANNUALIZATION_DAYS` de `functions_python/weekly_sampling.py`) no se anualiza. Entonces
 * `cagr` y `sharpe` llegan `null` —nunca un cero—, `annualized` es `false` y la cifra que se
 * enseña es `cumulative_return`, la rentabilidad del periodo, con sus fechas. Volatilidad y
 * caída máxima se publican siempre.
 *
 * Convivencia durante el despliegue: un servidor todavía sin actualizar no manda los campos
 * nuevos y su `cagr` es siempre un número. Se acepta: la rentabilidad del periodo y sus fechas
 * se leen de `portfolio_series` (primer y último punto, los mismos con los que el servidor
 * calcula), y `annualized` se toma como `true`, que es lo que ese servidor hacía siempre.
 */
export interface BacktestMetrics {
  /** Rentabilidad anualizada por fechas; `null` si el tramo no llega a 330 días. */
  cagr: number | null;
  volatility: number;
  /**
   * Sharpe ex post sobre `cagr`; `null` cuando `cagr` lo es, y también con volatilidad cero (hallazgo 11, 15-11-2026),
   * porque entonces no existe: ahí `annualized` es `true`, `cagr` es un número y `volatility` es 0. Un servidor anterior
   * manda en ese caso un 0, y el adaptador lo convierte en `null`.
   */
  sharpe: number | null;
  max_drawdown: number;
  rf_rate: number;
  /** Rentabilidad acumulada del tramo entero (último / primero − 1), sin anualizar. */
  cumulative_return: number | null;
  period_start: string | null;
  period_end: string | null;
  period_days: number | null;
  /** Si `cagr` y `sharpe` están anualizados. `false`: van `null` y se enseña `cumulative_return`. */
  annualized: boolean;
}

export interface BacktestRiskFree {
  risk_free_source: "ECB_ESTR";
  risk_free_rate: number;
  risk_free_rate_policy: "WINDOW_AVERAGE" | "STATIC_FALLBACK";
  risk_free_first_date?: string;
  risk_free_last_date?: string;
  risk_free_observations?: number;
  risk_free_coverage_ratio?: number;
}

export interface BacktestSeriesPoint {
  date: string;
  value: number;
}

export interface BacktestSynthetic {
  id: string;
  label: string;
  color: string;
  volatility: number;
  annual_return: number;
}

/**
 * `NO_DRAWDOWN` (P1-06, 21-11-2026): la cartera no bajó nunca del nivel desde el que se mide. La caída es 0, no hay
 * recuperación ni activo que más restó (`worst_asset` es null). Antes llegaba como «RECOVERED» en un día.
 */
export type StressRecoveryStatus = "RECOVERED" | "NOT_RECOVERED" | "NO_DRAWDOWN" | "NO_DATA";
export type StressScenarioReason =
  | "NO_POSITIVE_WEIGHTS"
  | "NO_ELIGIBLE_ASSETS"
  | "INSUFFICIENT_COMMON_DATA";
export type StressExclusionReason =
  | "NO_SERIES"
  | "NO_DATA_AT_WINDOW_START"
  | "YOUNGEST_TO_REACH_THREE_YEARS"
  /* P1-06: una serie que acaba más de catorce días antes que la más reciente (la regla de A-161) se aparta de los tres escenarios. */
  | "SERIES_ENDS_EARLY"
  /* N03 (22-11-2026): dentro de una crisis, dos precios seguidos de la serie distan más de catorce días. Se aparta de esa crisis: llevar el
     último precio a través del hueco inventaba un tramo plano justo donde se mide la caída. */
  | "GAP_IN_WINDOW"
  | "PRICE_SERIES_MISSING"
  | "INSUFFICIENT_HISTORY"
  | "FX_SERIES_MISSING"
  | "FX_QUARANTINE"
  | "NON_INVESTABLE"
  | "QUALITY_BLOCKED"
  | "DISTRIBUTES_WITHOUT_PAYMENTS";

export interface BacktestStressScenario {
  id: "COVID" | "RATES_2022" | "COMMON_HISTORY";
  label: string;
  configured_start_date: string | null;
  configured_end_date: string | null;
  start_date: string | null;
  end_date: string | null;
  /**
   * El máximo desde el que se mide la caída, y desde el que cuentan la duración y la recuperación: solo en la historia
   * común, que mide de máximo a mínimo (decisión 115). Null en una crisis, que mide desde su primer día (`start_date`),
   * y también con unas Functions anteriores a la 115, que medían la historia común desde su primer día.
   */
  peak_date?: string | null;
  trough_date: string | null;
  common_data_end_date: string | null;
  drawdown_pct: number | null;
  duration_days: number | null;
  recovery_date: string | null;
  recovery_days: number | null;
  remaining_to_recover_pct: number | null;
  recovery_status: StressRecoveryStatus;
  worst_asset: {
    asset_id: string;
    weight_pct: number;
    return_pct: number;
    contribution_pct: number;
  } | null;
  coverage: { weight_pct: number; included_assets: number; total_assets: number };
  representative: boolean;
  included_assets: string[];
  excluded_assets: { asset_id: string; reason: StressExclusionReason }[];
  reason: StressScenarioReason | null;
}

export interface BacktestResponse {
  schema_version: string;
  base_currency: string;
  window: BacktestWindow;
  /** Frecuencia de la serie que se DIBUJA. */
  frequency: BacktestFrequency;
  /** Frecuencia con la que se MIDEN cagr, volatilidad, Sharpe y la correlacion. */
  metrics_frequency: BacktestFrequency;
  /** La maxima caida se mide sobre la serie dibujada: es el suelo real del camino. */
  max_drawdown_frequency: BacktestFrequency;
  units: string;
  metrics: BacktestMetrics;
  risk_free?: BacktestRiskFree;
  portfolio_series: BacktestSeriesPoint[];
  asset_ids: string[];
  weights_normalized: Record<string, number>;
  /** `null` en la casilla que no se puede calcular (una serie plana, o menos de tres semanas comunes); la diagonal es 1. */
  correlation_matrix: (number | null)[][];
  benchmark_series: Record<string, BacktestSeriesPoint[]>;
  synthetics: BacktestSynthetic[];
  stress_scenarios: BacktestStressScenario[];
  coverage: {
    requested_assets: number;
    included_assets: number;
    /** Observaciones de la serie DIBUJADA (diaria o semanal, según `frequency`). */
    common_observations: number;
    /** Observaciones con las que se MIDEN las métricas: siempre semanales. */
    measured_observations?: number;
    /** Frecuencia de esas observaciones medidas. */
    measurement_frequency?: BacktestFrequency;
    /** Mínimo de observaciones que pide la ventana (aditivo, 06-09-2026). */
    required_observations?: number;
    first_date: string | null;
    last_date: string | null;
    /** Activo que entra más tarde y define el inicio de la ventana común. */
    window_start_limited_by?: string | null;
    /** Activo que se va antes y define el final de la ventana común. */
    window_end_limited_by?: string | null;
  } | null;
  excluded_assets: { asset_id: string; reason: string }[];
  warnings: string[];
}

export interface BacktestPosition {
  asset_id: string;
  weight: number;
}

const WINDOWS: readonly BacktestWindow[] = ["1Y", "3Y", "5Y", "10Y"];
const FREQUENCIES: readonly BacktestFrequency[] = ["WEEKLY", "DAILY"];
const RISK_FREE_POLICIES = ["WINDOW_AVERAGE", "STATIC_FALLBACK"] as const;
const STRESS_SCENARIO_IDS = ["COVID", "RATES_2022", "COMMON_HISTORY"] as const;
const STRESS_SCENARIO_REASONS = ["NO_POSITIVE_WEIGHTS", "NO_ELIGIBLE_ASSETS", "INSUFFICIENT_COMMON_DATA"] as const;
const STRESS_EXCLUSION_REASONS = [
  "NO_SERIES",
  "NO_DATA_AT_WINDOW_START",
  "YOUNGEST_TO_REACH_THREE_YEARS",
  "SERIES_ENDS_EARLY",
  "GAP_IN_WINDOW",
  "PRICE_SERIES_MISSING",
  "INSUFFICIENT_HISTORY",
  "FX_SERIES_MISSING",
  "FX_QUARANTINE",
  "NON_INVESTABLE",
  "QUALITY_BLOCKED",
  "DISTRIBUTES_WITHOUT_PAYMENTS"
] as const;

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireString(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, field);
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  return value === undefined ? undefined : requireNullableString(value, field);
}

function parseRiskFree(raw: unknown): BacktestRiskFree | undefined {
  if (raw === undefined) return undefined;
  const value = requireObject(raw, "risk_free");
  return {
    risk_free_source: requireLiteral(value.risk_free_source, "ECB_ESTR", "risk_free.risk_free_source"),
    risk_free_rate: requireNumber(value.risk_free_rate, "risk_free.risk_free_rate"),
    risk_free_rate_policy: requireOneOf(value.risk_free_rate_policy, RISK_FREE_POLICIES, "risk_free.risk_free_rate_policy"),
    risk_free_first_date: optionalString(value.risk_free_first_date, "risk_free.risk_free_first_date"),
    risk_free_last_date: optionalString(value.risk_free_last_date, "risk_free.risk_free_last_date"),
    risk_free_observations: optionalNumber(value.risk_free_observations, "risk_free.risk_free_observations"),
    risk_free_coverage_ratio: optionalNumber(value.risk_free_coverage_ratio, "risk_free.risk_free_coverage_ratio")
  };
}

function parseSeriesPoint(raw: unknown, field: string): BacktestSeriesPoint {
  const item = requireObject(raw, field);
  return {
    date: requireString(item.date, `${field}.date`),
    value: requireNumber(item.value, `${field}.value`)
  };
}

function parseCoverage(raw: unknown): BacktestResponse["coverage"] {
  if (raw === null) {
    return null;
  }
  const coverage = requireObject(raw, "coverage");
  return {
    requested_assets: requireNumber(coverage.requested_assets, "coverage.requested_assets"),
    included_assets: requireNumber(coverage.included_assets, "coverage.included_assets"),
    common_observations: requireNumber(coverage.common_observations, "coverage.common_observations"),
    measured_observations: optionalNumber(coverage.measured_observations, "coverage.measured_observations"),
    measurement_frequency: coverage.measurement_frequency === undefined
      ? undefined
      : requireOneOf(coverage.measurement_frequency, FREQUENCIES, "coverage.measurement_frequency"),
    required_observations: optionalNumber(coverage.required_observations, "coverage.required_observations"),
    first_date: requireNullableString(coverage.first_date, "coverage.first_date"),
    last_date: requireNullableString(coverage.last_date, "coverage.last_date"),
    window_start_limited_by: optionalNullableString(coverage.window_start_limited_by, "coverage.window_start_limited_by"),
    window_end_limited_by: optionalNullableString(coverage.window_end_limited_by, "coverage.window_end_limited_by")
  };
}

function parseStressScenario(raw: unknown, index: number): BacktestStressScenario {
  const field = `stress_scenarios[${index}]`;
  const item = requireObject(raw, field);
  const coverage = requireObject(item.coverage, `${field}.coverage`);
  const recoveryStatus = requireOneOf(
    item.recovery_status,
    ["RECOVERED", "NOT_RECOVERED", "NO_DRAWDOWN", "NO_DATA"] as const,
    `${field}.recovery_status`
  );
  const scenarioId = requireOneOf(
    item.id,
    STRESS_SCENARIO_IDS,
    `${field}.id`
  );
  const worst = item.worst_asset === null ? null : requireObject(item.worst_asset, `${field}.worst_asset`);
  return {
    id: scenarioId,
    label: requireString(item.label, `${field}.label`),
    configured_start_date: requireNullableString(item.configured_start_date, `${field}.configured_start_date`),
    configured_end_date: requireNullableString(item.configured_end_date, `${field}.configured_end_date`),
    start_date: requireNullableString(item.start_date, `${field}.start_date`),
    end_date: requireNullableString(item.end_date, `${field}.end_date`),
    // Opcional durante el despliegue: unas Functions anteriores a la 115 no lo mandan, y medían desde el primer día.
    peak_date: item.peak_date === undefined ? null : requireNullableString(item.peak_date, `${field}.peak_date`),
    trough_date: requireNullableString(item.trough_date, `${field}.trough_date`),
    common_data_end_date: requireNullableString(item.common_data_end_date, `${field}.common_data_end_date`),
    drawdown_pct: requireNullableNumber(item.drawdown_pct, `${field}.drawdown_pct`),
    duration_days: requireNullableNumber(item.duration_days, `${field}.duration_days`),
    recovery_date: requireNullableString(item.recovery_date, `${field}.recovery_date`),
    recovery_days: requireNullableNumber(item.recovery_days, `${field}.recovery_days`),
    remaining_to_recover_pct: requireNullableNumber(item.remaining_to_recover_pct, `${field}.remaining_to_recover_pct`),
    recovery_status: recoveryStatus,
    worst_asset: worst
      ? {
          asset_id: requireString(worst.asset_id, `${field}.worst_asset.asset_id`),
          weight_pct: requireNumber(worst.weight_pct, `${field}.worst_asset.weight_pct`),
          return_pct: requireNumber(worst.return_pct, `${field}.worst_asset.return_pct`),
          contribution_pct: requireNumber(worst.contribution_pct, `${field}.worst_asset.contribution_pct`)
        }
      : null,
    coverage: {
      weight_pct: requireNumber(coverage.weight_pct, `${field}.coverage.weight_pct`),
      included_assets: requireNumber(coverage.included_assets, `${field}.coverage.included_assets`),
      total_assets: requireNumber(coverage.total_assets, `${field}.coverage.total_assets`)
    },
    representative: requireBoolean(item.representative, `${field}.representative`),
    included_assets: requireStringArray(item.included_assets, `${field}.included_assets`),
    excluded_assets: requireArray(item.excluded_assets, `${field}.excluded_assets`).map((rawExcluded, excludedIndex) => {
      const excluded = requireObject(rawExcluded, `${field}.excluded_assets[${excludedIndex}]`);
      return {
        asset_id: requireString(excluded.asset_id, `${field}.excluded_assets[${excludedIndex}].asset_id`),
        reason: requireOneOf(
          excluded.reason,
          STRESS_EXCLUSION_REASONS,
          `${field}.excluded_assets[${excludedIndex}].reason`
        )
      };
    }),
    reason: item.reason === null
      ? null
      : requireOneOf(item.reason, STRESS_SCENARIO_REASONS, `${field}.reason`)
  };
}

function parseStressScenarios(raw: unknown): BacktestStressScenario[] {
  if (raw === undefined) {
    return []; // Compatibilidad durante el rollout conjunto de hosting/functions.
  }
  const parsed = requireArray(raw, "stress_scenarios").map(parseStressScenario);
  if (parsed.length !== STRESS_SCENARIO_IDS.length) {
    throw new AppError("BACKEND", "Contrato de backend inválido: stress_scenarios debe contener tres escenarios.");
  }
  parsed.forEach((scenario, index) => {
    if (scenario.id !== STRESS_SCENARIO_IDS[index]) {
      throw new AppError("BACKEND", `Contrato de backend inválido: orden inesperado en stress_scenarios[${index}].`);
    }
    const expectedRepresentative = scenario.coverage.weight_pct >= PESO_MINIMO_DE_UNA_CRISIS_PCT;
    if (scenario.representative !== expectedRepresentative) {
      throw new AppError("BACKEND", `Contrato de backend inválido: representative no cuadra en ${scenario.id}.`);
    }
    if (
      scenario.coverage.weight_pct < 0 || scenario.coverage.weight_pct > 100 ||
      !Number.isInteger(scenario.coverage.included_assets) ||
      !Number.isInteger(scenario.coverage.total_assets) ||
      scenario.coverage.included_assets < 0 ||
      scenario.coverage.total_assets < scenario.coverage.included_assets
    ) {
      throw new AppError("BACKEND", `Contrato de backend inválido: coverage no cuadra en ${scenario.id}.`);
    }
  });
  return parsed;
}

function daysBetween(start: string, end: string): number | null {
  const a = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

/** Por debajo de esto la volatilidad es cero: la misma cota que `ex_post_sharpe` de `weekly_sampling.py`. */
const VOLATILIDAD_CERO = 1e-12;

/**
 * El Sharpe que llega, contrastado con la volatilidad: con volatilidad cero no existe y va `null`, también si un servidor
 * anterior manda un 0; con volatilidad, un `null` solo cabe si la cifra no está anualizada.
 */
function sharpeConSuVolatilidad(sharpe: number | null, volatility: number, annualized: boolean): number | null {
  if (volatility <= VOLATILIDAD_CERO) return null;
  if (sharpe === null && annualized) {
    throw new AppError("BACKEND", "Contrato de backend inválido: metrics.sharpe llega vacío con volatilidad.");
  }
  return sharpe;
}

function parseMetrics(metrics: GuardObject, series: readonly BacktestSeriesPoint[]): BacktestMetrics {
  const base = {
    volatility: requireNumber(metrics.volatility, "metrics.volatility"),
    max_drawdown: requireNumber(metrics.max_drawdown, "metrics.max_drawdown"),
    rf_rate: requireNumber(metrics.rf_rate, "metrics.rf_rate")
  };
  if (metrics.annualized === undefined) {
    // Servidor anterior al 15-11-2026: ver el comentario de `BacktestMetrics`.
    const first = series[0];
    const last = series[series.length - 1];
    return {
      ...base,
      cagr: requireNumber(metrics.cagr, "metrics.cagr"),
      sharpe: sharpeConSuVolatilidad(requireNullableNumber(metrics.sharpe, "metrics.sharpe"), base.volatility, true),
      cumulative_return: first && last && first.value > 0 ? last.value / first.value - 1 : null,
      period_start: first?.date ?? null,
      period_end: last?.date ?? null,
      period_days: first && last ? daysBetween(first.date, last.date) : null,
      annualized: true
    };
  }
  const annualized = requireBoolean(metrics.annualized, "metrics.annualized");
  const cagr = requireNullableNumber(metrics.cagr, "metrics.cagr");
  const sharpe = requireNullableNumber(metrics.sharpe, "metrics.sharpe");
  if (annualized ? cagr === null : cagr !== null || sharpe !== null) {
    throw new AppError("BACKEND", "Contrato de backend inválido: metrics.cagr no cuadra con metrics.annualized.");
  }
  return {
    ...base,
    cagr,
    sharpe: sharpeConSuVolatilidad(sharpe, base.volatility, annualized),
    cumulative_return: requireNullableNumber(metrics.cumulative_return, "metrics.cumulative_return"),
    period_start: requireNullableString(metrics.period_start, "metrics.period_start"),
    period_end: requireNullableString(metrics.period_end, "metrics.period_end"),
    period_days: requireNullableNumber(metrics.period_days, "metrics.period_days"),
    annualized
  };
}

/** Una simulación con su rentabilidad anualizada y su Sharpe: la que exige el análisis de 3 y 5 años. */
/** `sharpe` puede ir `null` aun anualizada: con volatilidad cero el Sharpe no existe (hallazgo 11). */
export type BacktestAnualizado = BacktestResponse & { metrics: BacktestMetrics & { cagr: number } };

/**
 * El análisis de 3 y 5 años (`analysis_bundle`) sigue publicando siempre cifras anualizadas, y su adaptador ya rechaza un
 * histórico que no cubra la ventana entera: un `null` ahí es un contrato roto, no un tramo corto. Si algún día ese análisis
 * adopta la regla de los 330 días (está por decidir, 15-11-2026), es aquí donde se cambia.
 */
export function exigeAnualizado(backtest: BacktestResponse, campo: string): BacktestAnualizado {
  const { cagr } = backtest.metrics;
  /* El Sharpe no entra: `parseMetrics` ya solo lo deja vacío con volatilidad cero, que no es un tramo corto. */
  if (cagr === null || !backtest.metrics.annualized) {
    throw new AppError("BACKEND", `Contrato de backend inválido: ${campo}.metrics llega sin anualizar.`);
  }
  return { ...backtest, metrics: { ...backtest.metrics, cagr } };
}

export function parseBacktestResponse(raw: unknown): BacktestResponse {
  const data = requireObject(raw, "backtest_portfolio response");
  const metrics = requireObject(data.metrics, "metrics");
  const weights = requireObject(data.weights_normalized, "weights_normalized");
  const benchmark = requireObject(data.benchmark_series, "benchmark_series");

  const weights_normalized: Record<string, number> = {};
  for (const [assetId, value] of Object.entries(weights)) {
    weights_normalized[assetId] = requireNumber(value, `weights_normalized.${assetId}`);
  }

  const benchmark_series: Record<string, BacktestSeriesPoint[]> = {};
  for (const [key, value] of Object.entries(benchmark)) {
    benchmark_series[key] = requireArray(value, `benchmark_series.${key}`).map((item, index) =>
      parseSeriesPoint(item, `benchmark_series.${key}[${index}]`)
    );
  }

  const portfolio_series = requireArray(data.portfolio_series, "portfolio_series").map((item, index) =>
    parseSeriesPoint(item, `portfolio_series[${index}]`)
  );

  return {
    schema_version: requireLiteral(data.schema_version, "backtest.v1", "schema_version"),
    base_currency: requireLiteral(data.base_currency, "EUR", "base_currency"),
    window: requireOneOf(data.window, WINDOWS, "window"),
    frequency: requireOneOf(data.frequency, FREQUENCIES, "frequency"),
    // Opcionales durante el despliegue conjunto de hosting/functions: hasta que
    // las functions nuevas esten arriba, el backend antiguo no los manda y la
    // medicion era la de la propia frecuencia.
    metrics_frequency: data.metrics_frequency === undefined
      ? requireOneOf(data.frequency, FREQUENCIES, "frequency")
      : requireOneOf(data.metrics_frequency, FREQUENCIES, "metrics_frequency"),
    max_drawdown_frequency: data.max_drawdown_frequency === undefined
      ? requireOneOf(data.frequency, FREQUENCIES, "frequency")
      : requireOneOf(data.max_drawdown_frequency, FREQUENCIES, "max_drawdown_frequency"),
    units: requireLiteral(data.units, "decimal", "units"),
    metrics: parseMetrics(metrics, portfolio_series),
    risk_free: parseRiskFree(data.risk_free),
    portfolio_series,
    asset_ids: requireStringArray(data.asset_ids, "asset_ids"),
    weights_normalized,
    correlation_matrix: requireArray(data.correlation_matrix, "correlation_matrix").map((row, rowIndex) =>
      requireArray(row, `correlation_matrix[${rowIndex}]`).map((cell, colIndex) =>
        requireNullableNumber(cell, `correlation_matrix[${rowIndex}][${colIndex}]`)
      )
    ),
    benchmark_series,
    synthetics: requireArray(data.synthetics, "synthetics").map((item, index) => {
      const synthetic = requireObject(item, `synthetics[${index}]`);
      return {
        id: requireString(synthetic.id, `synthetics[${index}].id`),
        label: requireString(synthetic.label, `synthetics[${index}].label`),
        color: requireString(synthetic.color, `synthetics[${index}].color`),
        volatility: requireNumber(synthetic.volatility, `synthetics[${index}].volatility`),
        annual_return: requireNumber(synthetic.annual_return, `synthetics[${index}].annual_return`)
      };
    }),
    stress_scenarios: parseStressScenarios(data.stress_scenarios),
    coverage: parseCoverage(data.coverage),
    excluded_assets: requireArray(data.excluded_assets, "excluded_assets").map((item, index) => {
      const excluded = requireObject(item, `excluded_assets[${index}]`);
      return {
        asset_id: requireString(excluded.asset_id, `excluded_assets[${index}].asset_id`),
        reason: requireString(excluded.reason, `excluded_assets[${index}].reason`)
      };
    }),
    warnings: data.warnings === undefined ? [] : requireStringArray(data.warnings, "warnings")
  };
}

/**
 * Dibujar en diario, medir en semanal. `frequency` gobierna la serie que se
 * pinta; el backend mide siempre cagr/volatilidad/Sharpe y la correlacion sobre
 * el remuestreo semanal, y la maxima caida sobre la serie dibujada.
 */
/**
 * Política de histórico mínimo (06-09-2026).
 *
 * "NONE": la ventana común se reduce a la intersección de TODOS los activos, así que
 * uno solo con histórico corto la colapsa para el resto.
 * "ENFORCE": los activos que no cubren la ventana se apartan y se dicen en
 * `excluded_assets`; el resto se mide sobre la ventana completa.
 */
export type BacktestMinHistory = "NONE" | "ENFORCE";

export const BACKTEST_TIMEOUT_MS = 300_000;

export async function fetchBacktest(
  positions: BacktestPosition[],
  period: BacktestWindow,
  frequency: BacktestFrequency = "DAILY",
  minHistory: BacktestMinHistory = "NONE"
): Promise<BacktestResponse | null> {
  if (positions.length === 0) {
    return null;
  }
  const raw = await callBackend<unknown>(
    "backtest_portfolio",
    {
      positions,
      period,
      frequency,
      min_history: minHistory
    },
    "No se pudo calcular el backtest.",
    /* La misma espera que el servidor (`timeout_sec=300` de `backtest_portfolio` en main.py); sin ella, 70 s. */
    { timeout: BACKTEST_TIMEOUT_MS }
  );
  return parseBacktestResponse(raw);
}
