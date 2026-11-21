/**
 * Cableado a la callable `improve_portfolio` (portfolio-improvement.v1).
 * «Mejorar cartera», modalidad M1: sustituciones equivalentes con pesos conservados,
 * evaluadas en el servidor sobre la misma ventana semanal y validadas fuera de
 * muestra. Solo lectura; los errores se propagan para mostrarlos en pantalla.
 */
import { callBackend } from "./callableBackend";
import {
  requireArray, requireBoolean, requireNullableNumber, requireNumber, requireObject, requireOneOf,
  requireOptionalNumber, requireOptionalString, requireString, requireStringArray
} from "./contractGuards";

/** `WINDOW_TOO_SHORT` (15-11-2026): el tramo de selección o el de confirmación no llega a los 330 días que hacen falta para anualizar. */
export type ImprovementStatus = "PROPOSAL" | "NO_IMPROVEMENT" | "INSUFFICIENT_DATA" | "INFEASIBLE" | "WINDOW_TOO_SHORT";
export type ImprovementCheckStatus = "PASS" | "FAIL" | "NOT_EVALUABLE";
export type ImprovementWindow = "3Y" | "5Y";

export interface ImprovementRequest {
  positions: { asset_id: string; weight: number }[];
  candidates: Record<string, string[]>;
  window: ImprovementWindow;
  locked?: string[];
  /** Posición → candidatos que son otra clase del mismo fondo: no consumen sustitución. */
  same_fund_class?: Record<string, string[]>;
  max_substitutions?: number;
  thresholds?: Record<string, number | Record<string, number>>;
}

export interface ImprovementWindowMetrics {
  cagr: number;
  volatility: number;
  /** `null` con volatilidad cero: el Sharpe no existe y se escribe que falta. */
  sharpe: number | null;
  max_drawdown: number;
  cumulative_return: number;
  weeks: number;
}

export interface ImprovementMetricsByWindow {
  selection: ImprovementWindowMetrics;
  confirmation: ImprovementWindowMetrics;
  full: ImprovementWindowMetrics;
}

export interface ImprovementCheck {
  key: string;
  label: string;
  status: ImprovementCheckStatus;
  detail: string;
}

export interface ImprovementSubstitution {
  from_asset_id: string;
  to_asset_id: string;
  from_name: string;
  to_name: string;
  weight: number;
  correlation: number;
  tracking_error: number;
  /** Otra clase del mismo fondo (no cuenta en el máximo de sustituciones). */
  same_fund_class?: boolean;
}

export interface ImprovementProposal {
  substitutions: ImprovementSubstitution[];
  weights: Record<string, number>;
  metrics: ImprovementMetricsByWindow;
  /** `sharpe` va `null` si a alguna de las dos carteras le falta el Sharpe (volatilidad cero): un vacío no es un 0. */
  deltas_confirmation: { cagr: number; volatility: number; sharpe: number | null; max_drawdown: number };
  weighted_cost: number | null;
  validation: ImprovementCheck[];
  improvements: { key: string; label: string; delta: number }[];
  consistency: { windows: number; wins: number; share: number; rolling_weeks: number } | null;
  valid: boolean;
}

export interface ImprovementRejectedCandidate {
  asset_id: string;
  reason: string;
  detail?: string;
  /** No se ha podido medir (sin serie que cubra la ventana, no invertible…): no es un descarte, es un candidato no evaluable. */
  not_evaluable?: boolean;
}

export interface ImprovementWindowSpan {
  first_date: string;
  last_date: string;
  weeks: number;
  /** Días del tramo; un servidor anterior al 15-11-2026 no los manda. */
  days?: number;
}

/** Una posición que se queda fuera de la medición, como en Simular. `weight`: su peso en la cartera pedida (decimal). */
export interface ImprovementExcludedPosition {
  asset_id: string;
  reason: string;
  weight: number;
  covers_window?: string;
}

/** Una posición completada con una referencia antes de su inicio real, como en Simular. */
export interface ImprovementExtension {
  asset_id: string;
  reference: string;
  estimated_from: string;
  observed_from: string;
}

export interface ImprovementCandidatesPerPosition {
  requested: number;
  evaluated: number;
  trimmed: boolean;
  max_assets: number;
}

export interface ImprovementShortWindow {
  window: "selection" | "confirmation";
  first_date: string;
  last_date: string;
  days: number;
}

export interface ImprovementRiskFree {
  risk_free_rate: number;
  risk_free_rate_policy: string;
}

export interface ImprovementResponse {
  schema_version: string;
  status: ImprovementStatus;
  window?: ImprovementWindow;
  reason?: string;
  original?: { weights: Record<string, number>; metrics: ImprovementMetricsByWindow; weighted_cost: number | null };
  windows?: { frequency: "WEEKLY"; full: ImprovementWindowSpan; selection: ImprovementWindowSpan; confirmation: ImprovementWindowSpan };
  proposals: ImprovementProposal[];
  rejected_candidates: Record<string, ImprovementRejectedCandidate[]>;
  /** `covers_window`: de una posición a la que le falta la ventana, la más corta que sí cubre, si la hay. */
  excluded_assets: { asset_id: string; reason: string; covers_window?: string }[];
  missing_assets?: string[];
  best_rejected?: { substitutions: ImprovementSubstitution[]; failed: string[] };
  evaluated_combinations: number;
  search?: "EXHAUSTIVE" | "GREEDY";
  warnings: string[];
  coverage?: { requested_assets: number; included_assets: number; common_observations: number; first_date: string; last_date: string };
  risk_free?: ImprovementRiskFree;
  /* Desde el 15-11-2026 «Mejorar» mide con el periodo de Simular. Un servidor anterior no manda nada de esto: todo es opcional. */
  /** El €STR medio de cada tramo, cada uno con sus fechas. */
  risk_free_by_window?: Partial<Record<"selection" | "confirmation" | "full", ImprovementRiskFree>>;
  /** Las posiciones que se quedan fuera de la medición. Si llega, `excluded_assets` repite esas posiciones y los candidatos sin medir. */
  excluded_positions?: ImprovementExcludedPosition[];
  extensions?: ImprovementExtension[];
  /** El peso medido, en porcentaje de la cartera pedida. */
  coverage_weight_percent?: number;
  candidates_per_position?: ImprovementCandidatesPerPosition;
  short_windows?: ImprovementShortWindow[];
  min_days?: number;
}

const STATUSES: readonly ImprovementStatus[] = ["PROPOSAL", "NO_IMPROVEMENT", "INSUFFICIENT_DATA", "INFEASIBLE", "WINDOW_TOO_SHORT"];
/** La misma espera que el servidor (`timeout_sec=300` de `improve_portfolio` en main.py). Sin ella, el navegador abandonaba a los 70 s. */
export const IMPROVEMENT_TIMEOUT_MS = 300_000;
const CHECK_STATUSES: readonly ImprovementCheckStatus[] = ["PASS", "FAIL", "NOT_EVALUABLE"];

/**
 * El Sharpe de un tramo: `null` con volatilidad cero, porque no existe (hallazgo 11, 15-11-2026). Un servidor anterior manda ahí
 * un 0, y se lee como lo que es. Con volatilidad, tiene que ser un número.
 */
function sharpeConSuVolatilidad(m: Record<string, unknown>, field: string): number | null {
  const volatilidad = requireNumber(m.volatility, `${field}.volatility`);
  if (volatilidad <= 1e-12) return null;
  return requireNumber(m.sharpe, `${field}.sharpe`);
}

function parseWindowMetrics(raw: unknown, field: string): ImprovementWindowMetrics {
  const m = requireObject(raw, field);
  return {
    cagr: requireNumber(m.cagr, `${field}.cagr`),
    volatility: requireNumber(m.volatility, `${field}.volatility`),
    sharpe: sharpeConSuVolatilidad(m, field),
    max_drawdown: requireNumber(m.max_drawdown, `${field}.max_drawdown`),
    cumulative_return: requireNumber(m.cumulative_return, `${field}.cumulative_return`),
    weeks: requireNumber(m.weeks, `${field}.weeks`)
  };
}

function parseMetricsByWindow(raw: unknown, field: string): ImprovementMetricsByWindow {
  const m = requireObject(raw, field);
  return {
    selection: parseWindowMetrics(m.selection, `${field}.selection`),
    confirmation: parseWindowMetrics(m.confirmation, `${field}.confirmation`),
    full: parseWindowMetrics(m.full, `${field}.full`)
  };
}

function parseWeights(raw: unknown, field: string): Record<string, number> {
  const source = requireObject(raw, field);
  return Object.fromEntries(Object.entries(source).map(([id, weight]) => [id, requireNumber(weight, `${field}.${id}`)]));
}

function parseSpan(raw: unknown, field: string): ImprovementWindowSpan {
  const s = requireObject(raw, field);
  const days = requireOptionalNumber(s.days, `${field}.days`);
  return {
    first_date: requireString(s.first_date, `${field}.first_date`),
    last_date: requireString(s.last_date, `${field}.last_date`),
    weeks: requireNumber(s.weeks, `${field}.weeks`),
    ...(days === undefined ? {} : { days })
  };
}

function parseSubstitution(raw: unknown, field: string): ImprovementSubstitution {
  const s = requireObject(raw, field);
  return {
    from_asset_id: requireString(s.from_asset_id, `${field}.from_asset_id`),
    to_asset_id: requireString(s.to_asset_id, `${field}.to_asset_id`),
    from_name: requireOptionalString(s.from_name, `${field}.from_name`) ?? String(s.from_asset_id),
    to_name: requireOptionalString(s.to_name, `${field}.to_name`) ?? String(s.to_asset_id),
    weight: requireNumber(s.weight, `${field}.weight`),
    correlation: requireNumber(s.correlation, `${field}.correlation`),
    tracking_error: requireNumber(s.tracking_error, `${field}.tracking_error`),
    same_fund_class: typeof s.same_fund_class === "boolean" ? s.same_fund_class : undefined
  };
}

function parseProposal(raw: unknown, field: string): ImprovementProposal {
  const p = requireObject(raw, field);
  const consistency = p.consistency === null || p.consistency === undefined ? null : requireObject(p.consistency, `${field}.consistency`);
  return {
    substitutions: requireArray(p.substitutions, `${field}.substitutions`).map((s, i) => parseSubstitution(s, `${field}.substitutions[${i}]`)),
    weights: parseWeights(p.weights, `${field}.weights`),
    metrics: parseMetricsByWindow(p.metrics, `${field}.metrics`),
    deltas_confirmation: (() => {
      const d = requireObject(p.deltas_confirmation, `${field}.deltas_confirmation`);
      return {
        cagr: requireNumber(d.cagr, `${field}.deltas_confirmation.cagr`),
        volatility: requireNumber(d.volatility, `${field}.deltas_confirmation.volatility`),
        sharpe: requireNullableNumber(d.sharpe, `${field}.deltas_confirmation.sharpe`),
        max_drawdown: requireNumber(d.max_drawdown, `${field}.deltas_confirmation.max_drawdown`)
      };
    })(),
    weighted_cost: requireNullableNumber(p.weighted_cost ?? null, `${field}.weighted_cost`),
    validation: requireArray(p.validation, `${field}.validation`).map((c, i) => {
      const check = requireObject(c, `${field}.validation[${i}]`);
      return {
        key: requireString(check.key, `${field}.validation[${i}].key`),
        label: requireString(check.label, `${field}.validation[${i}].label`),
        status: requireOneOf(check.status, CHECK_STATUSES, `${field}.validation[${i}].status`),
        detail: requireOptionalString(check.detail, `${field}.validation[${i}].detail`) ?? ""
      };
    }),
    improvements: requireArray(p.improvements, `${field}.improvements`).map((item, i) => {
      const imp = requireObject(item, `${field}.improvements[${i}]`);
      return { key: requireString(imp.key, "key"), label: requireString(imp.label, "label"), delta: requireNumber(imp.delta, "delta") };
    }),
    consistency: consistency ? {
      windows: requireNumber(consistency.windows, `${field}.consistency.windows`),
      wins: requireNumber(consistency.wins, `${field}.consistency.wins`),
      share: requireNumber(consistency.share, `${field}.consistency.share`),
      rolling_weeks: requireNumber(consistency.rolling_weeks, `${field}.consistency.rolling_weeks`)
    } : null,
    valid: requireBoolean(p.valid, `${field}.valid`)
  };
}

export function parseImprovementResponse(raw: unknown): ImprovementResponse {
  const data = requireObject(raw, "improvement");
  const status = requireOneOf(data.status, STATUSES, "status");
  const rejectedRaw = data.rejected_candidates ? requireObject(data.rejected_candidates, "rejected_candidates") : {};
  const rejected_candidates = Object.fromEntries(Object.entries(rejectedRaw).map(([position, items]) => [
    position,
    requireArray(items, `rejected_candidates.${position}`).map((item, i) => {
      const r = requireObject(item, `rejected_candidates.${position}[${i}]`);
      return {
        asset_id: requireString(r.asset_id, "asset_id"),
        reason: requireString(r.reason, "reason"),
        detail: requireOptionalString(r.detail, "detail"),
        ...(r.not_evaluable === true ? { not_evaluable: true } : {})
      };
    })
  ]));
  const windows = data.windows ? requireObject(data.windows, "windows") : null;
  const original = data.original ? requireObject(data.original, "original") : null;
  const bestRejected = data.best_rejected ? requireObject(data.best_rejected, "best_rejected") : null;
  const coverage = data.coverage ? requireObject(data.coverage, "coverage") : null;
  const riskFree = data.risk_free ? requireObject(data.risk_free, "risk_free") : null;
  return {
    schema_version: requireString(data.schema_version, "schema_version"),
    status,
    window: data.window === "5Y" ? "5Y" : data.window === "3Y" ? "3Y" : undefined,
    reason: requireOptionalString(data.reason, "reason"),
    original: original ? {
      weights: parseWeights(original.weights, "original.weights"),
      metrics: parseMetricsByWindow(original.metrics, "original.metrics"),
      weighted_cost: requireNullableNumber(original.weighted_cost ?? null, "original.weighted_cost")
    } : undefined,
    windows: windows ? {
      frequency: "WEEKLY",
      full: parseSpan(windows.full, "windows.full"),
      selection: parseSpan(windows.selection, "windows.selection"),
      confirmation: parseSpan(windows.confirmation, "windows.confirmation")
    } : undefined,
    proposals: requireArray(data.proposals ?? [], "proposals").map((p, i) => parseProposal(p, `proposals[${i}]`)),
    rejected_candidates,
    excluded_assets: requireArray(data.excluded_assets ?? [], "excluded_assets").map((item, i) => {
      const e = requireObject(item, `excluded_assets[${i}]`);
      return {
        asset_id: requireString(e.asset_id, "asset_id"),
        reason: requireString(e.reason, "reason"),
        ...(typeof e.covers_window === "string" ? { covers_window: e.covers_window } : {})
      };
    }),
    missing_assets: data.missing_assets ? requireStringArray(data.missing_assets, "missing_assets") : undefined,
    best_rejected: bestRejected ? {
      substitutions: requireArray(bestRejected.substitutions, "best_rejected.substitutions").map((s, i) => parseSubstitution(s, `best_rejected.substitutions[${i}]`)),
      failed: requireStringArray(bestRejected.failed, "best_rejected.failed")
    } : undefined,
    evaluated_combinations: requireOptionalNumber(data.evaluated_combinations, "evaluated_combinations") ?? 0,
    search: data.search === "GREEDY" ? "GREEDY" : data.search === "EXHAUSTIVE" ? "EXHAUSTIVE" : undefined,
    warnings: data.warnings ? requireStringArray(data.warnings, "warnings") : [],
    coverage: coverage ? {
      requested_assets: requireNumber(coverage.requested_assets, "coverage.requested_assets"),
      included_assets: requireNumber(coverage.included_assets, "coverage.included_assets"),
      common_observations: requireNumber(coverage.common_observations, "coverage.common_observations"),
      first_date: requireString(coverage.first_date, "coverage.first_date"),
      last_date: requireString(coverage.last_date, "coverage.last_date")
    } : undefined,
    risk_free: riskFree ? parseRiskFree(riskFree, "risk_free") : undefined,
    ...parsePeriodoDeSimular(data)
  };
}

function parseRiskFree(raw: unknown, field: string): ImprovementRiskFree {
  const r = requireObject(raw, field);
  return {
    risk_free_rate: requireNumber(r.risk_free_rate, `${field}.risk_free_rate`),
    risk_free_rate_policy: requireString(r.risk_free_rate_policy, `${field}.risk_free_rate_policy`)
  };
}

/** Los campos del 15-11-2026. Si el servidor aún no los manda, no aparecen, y la pantalla dice lo de antes. */
function parsePeriodoDeSimular(data: Record<string, unknown>): Partial<ImprovementResponse> {
  const out: Partial<ImprovementResponse> = {};
  if (data.risk_free_by_window) {
    const byWindow = requireObject(data.risk_free_by_window, "risk_free_by_window");
    out.risk_free_by_window = Object.fromEntries((["selection", "confirmation", "full"] as const)
      .filter((key) => byWindow[key] !== undefined)
      .map((key) => [key, parseRiskFree(byWindow[key], `risk_free_by_window.${key}`)]));
  }
  if (data.excluded_positions !== undefined) {
    out.excluded_positions = requireArray(data.excluded_positions, "excluded_positions").map((item, i) => {
      const e = requireObject(item, `excluded_positions[${i}]`);
      return {
        asset_id: requireString(e.asset_id, `excluded_positions[${i}].asset_id`),
        reason: requireString(e.reason, `excluded_positions[${i}].reason`),
        weight: requireNumber(e.weight, `excluded_positions[${i}].weight`),
        ...(typeof e.covers_window === "string" ? { covers_window: e.covers_window } : {})
      };
    });
  }
  if (data.extensions !== undefined) {
    out.extensions = requireArray(data.extensions, "extensions").map((item, i) => {
      const e = requireObject(item, `extensions[${i}]`);
      return {
        asset_id: requireString(e.asset_id, `extensions[${i}].asset_id`),
        reference: requireString(e.reference, `extensions[${i}].reference`),
        estimated_from: requireString(e.estimated_from, `extensions[${i}].estimated_from`),
        observed_from: requireString(e.observed_from, `extensions[${i}].observed_from`)
      };
    });
  }
  const pesoMedido = requireOptionalNumber(data.coverage_weight_percent, "coverage_weight_percent");
  if (pesoMedido !== undefined) out.coverage_weight_percent = pesoMedido;
  if (data.candidates_per_position) {
    const c = requireObject(data.candidates_per_position, "candidates_per_position");
    out.candidates_per_position = {
      requested: requireNumber(c.requested, "candidates_per_position.requested"),
      evaluated: requireNumber(c.evaluated, "candidates_per_position.evaluated"),
      trimmed: requireBoolean(c.trimmed, "candidates_per_position.trimmed"),
      max_assets: requireNumber(c.max_assets, "candidates_per_position.max_assets")
    };
  }
  if (data.short_windows !== undefined) {
    out.short_windows = requireArray(data.short_windows, "short_windows").map((item, i) => {
      const w = requireObject(item, `short_windows[${i}]`);
      return {
        window: requireOneOf(w.window, ["selection", "confirmation"] as const, `short_windows[${i}].window`),
        first_date: requireString(w.first_date, `short_windows[${i}].first_date`),
        last_date: requireString(w.last_date, `short_windows[${i}].last_date`),
        days: requireNumber(w.days, `short_windows[${i}].days`)
      };
    });
  }
  const minDays = requireOptionalNumber(data.min_days, "min_days");
  if (minDays !== undefined) out.min_days = minDays;
  return out;
}

export async function fetchPortfolioImprovement(request: ImprovementRequest): Promise<ImprovementResponse> {
  const raw = await callBackend<unknown>("improve_portfolio", request, "No se pudo calcular la mejora de la cartera.", { timeout: IMPROVEMENT_TIMEOUT_MS });
  return parseImprovementResponse(raw);
}
