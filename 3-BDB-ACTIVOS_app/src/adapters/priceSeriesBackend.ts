/**
 * Cableado a la callable `get_price_series` (price-series.v1).
 * Devuelve series alineadas y rebasadas a 100 para el comparador.
 * Solo lectura; los errores de backend se propagan para mostrarlos en UI.
 */
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireLiteral,
  requireNullableString,
  requireNumber,
  requireNumberArray,
  requireObject,
  requireOneOf,
  requireString,
  requireStringArray
} from "./contractGuards";

export type RebaseWindow = "1Y" | "3Y" | "5Y" | "10Y";
export type RebaseFrequency = "WEEKLY" | "DAILY";
/**
 * Politica de historico minimo del backend. NONE (por defecto) pinta todo lo que
 * haya: es lo que quieren el comparador y la ficha de activo. ENFORCE descarta los
 * activos que no llegan al minimo del motor de riesgo, para que un fondo joven no
 * encoja la ventana comun de toda la cartera.
 */
export type MinHistoryPolicy = "NONE" | "ENFORCE";

export interface RebasedSeriesPoint {
  asset_id: string;
  display_name: string;
  values: number[];
  /** Un fondo que reparte y del que no tenemos todos los pagos: su serie es el valor liquidativo, sin dividendos (decisión 8). */
  sin_dividendos?: boolean;
}

export interface RebasedSeriesExclusion {
  asset_id: string;
  reason: string;
  /** Observaciones del activo en la ventana (dias si DAILY, semanas si WEEKLY). */
  observations?: number;
  /** Minimo exigido, en las mismas unidades que `observations`. */
  required?: number;
  window?: string;
}

export interface RebasedSeriesResponse {
  schema_version: string;
  base_currency: string;
  window: RebaseWindow;
  frequency: RebaseFrequency;
  rebased_to: number;
  dates: string[];
  series: RebasedSeriesPoint[];
  coverage: {
    requested_assets: number;
    included_assets: number;
    common_observations: number;
    first_date: string | null;
    last_date: string | null;
  };
  excluded_assets: RebasedSeriesExclusion[];
}

const WINDOWS: readonly RebaseWindow[] = ["1Y", "3Y", "5Y", "10Y"];
const FREQUENCIES: readonly RebaseFrequency[] = ["WEEKLY", "DAILY"];

function parseCoverage(raw: unknown): RebasedSeriesResponse["coverage"] {
  const coverage = requireObject(raw, "coverage");
  return {
    requested_assets: requireNumber(coverage.requested_assets, "coverage.requested_assets"),
    included_assets: requireNumber(coverage.included_assets, "coverage.included_assets"),
    common_observations: requireNumber(coverage.common_observations, "coverage.common_observations"),
    first_date: requireNullableString(coverage.first_date, "coverage.first_date"),
    last_date: requireNullableString(coverage.last_date, "coverage.last_date")
  };
}

export function parseRebasedSeriesResponse(raw: unknown): RebasedSeriesResponse {
  const data = requireObject(raw, "get_price_series response");
  const series = requireArray(data.series, "series").map((item, index) => {
    const point = requireObject(item, `series[${index}]`);
    return {
      asset_id: requireString(point.asset_id, `series[${index}].asset_id`),
      display_name: requireString(point.display_name, `series[${index}].display_name`),
      values: requireNumberArray(point.values, `series[${index}].values`),
      ...(point.sin_dividendos === true ? { sin_dividendos: true } : {})
    };
  });
  const excluded_assets = requireArray(data.excluded_assets, "excluded_assets").map((item, index) => {
    const excluded = requireObject(item, `excluded_assets[${index}]`);
    const numeroOpcional = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? valor : undefined);
    return {
      asset_id: requireString(excluded.asset_id, `excluded_assets[${index}].asset_id`),
      reason: requireString(excluded.reason, `excluded_assets[${index}].reason`),
      observations: numeroOpcional(excluded.observations),
      required: numeroOpcional(excluded.required),
      window: typeof excluded.window === "string" ? excluded.window : undefined
    };
  });

  return {
    schema_version: requireLiteral(data.schema_version, "price-series.v1", "schema_version"),
    base_currency: requireLiteral(data.base_currency, "EUR", "base_currency"),
    window: requireOneOf(data.window, WINDOWS, "window"),
    frequency: requireOneOf(data.frequency, FREQUENCIES, "frequency"),
    rebased_to: requireNumber(data.rebased_to, "rebased_to"),
    dates: requireStringArray(data.dates, "dates"),
    series,
    coverage: parseCoverage(data.coverage),
    excluded_assets
  };
}

export async function fetchRebasedSeries(
  assetIds: string[],
  window: RebaseWindow,
  frequency: RebaseFrequency = "WEEKLY",
  minHistory: MinHistoryPolicy = "NONE"
): Promise<RebasedSeriesResponse | null> {
  if (assetIds.length === 0) {
    return null;
  }
  const raw = await callBackend<unknown>(
    "get_price_series",
    {
      asset_ids: assetIds,
      window,
      frequency,
      min_history: minHistory,
      base_currency: "EUR"
    },
    "No se pudieron cargar las series históricas."
  );
  return parseRebasedSeriesResponse(raw);
}
