/** Contrato del calendario de resultados de cotizadas españolas. */
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireNullableNumber,
  requireNullableString,
  requireObject,
  requireOptionalBoolean
} from "./contractGuards";
import { optionalNullableIsoDay, parseCalendarEnvelope } from "./calendarContract";

export interface EarningItem {
  code?: string | null;
  name?: string | null;
  /** Fecha del anuncio de resultados (ISO). */
  report_date?: string | null;
  /** "BeforeMarket" | "AfterMarket" | null. */
  when?: string | null;
  currency?: string | null;
  eps_actual?: number | null;
  eps_estimate?: number | null;
  /** true cuando Yahoo dio una ventana de fechas y `report_date` es solo la primera. Ausente en un servidor sin actualizar. */
  date_estimated?: boolean;
  /** Fin de la ventana de fechas, si la hay. */
  report_date_window_end?: string | null;
  /** Sorpresa en % (real vs estimado). */
  eps_surprise_pct?: number | null;
  revenue_actual?: number | null;
  revenue_estimate?: number | null;
}

export interface EarningsCalendarResult {
  schema_version?: string;
  items: EarningItem[];
  from?: string;
  to?: string;
  source: string;
  note?: string;
  count: number;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  return requireNullableString(value, field);
}

function optionalNullableNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  return requireNullableNumber(value, field);
}

export function parseEarningsCalendarResult(raw: unknown): EarningsCalendarResult {
  const data = requireObject(raw, "get_earnings_calendar response");
  const items = requireArray(data.items, "items").map((item, index) => {
    const row = requireObject(item, `items[${index}]`);
    return {
      code: optionalNullableString(row.code, `items[${index}].code`),
      name: optionalNullableString(row.name, `items[${index}].name`),
      report_date: optionalNullableIsoDay(row.report_date, `items[${index}].report_date`),
      date_estimated: requireOptionalBoolean(row.date_estimated, `items[${index}].date_estimated`),
      report_date_window_end: optionalNullableIsoDay(row.report_date_window_end, `items[${index}].report_date_window_end`),
      when: optionalNullableString(row.when, `items[${index}].when`),
      currency: optionalNullableString(row.currency, `items[${index}].currency`),
      eps_actual: optionalNullableNumber(row.eps_actual, `items[${index}].eps_actual`),
      eps_estimate: optionalNullableNumber(row.eps_estimate, `items[${index}].eps_estimate`),
      eps_surprise_pct: optionalNullableNumber(row.eps_surprise_pct, `items[${index}].eps_surprise_pct`),
      revenue_actual: optionalNullableNumber(row.revenue_actual, `items[${index}].revenue_actual`),
      revenue_estimate: optionalNullableNumber(row.revenue_estimate, `items[${index}].revenue_estimate`)
    };
  });
  return {
    items,
    ...parseCalendarEnvelope(data, items.length)
  };
}

export async function fetchEarningsCalendar(
  opts?: { from?: string; to?: string }
): Promise<EarningsCalendarResult | null> {
  const raw = await callBackend<unknown>(
    "get_earnings_calendar",
    opts ?? {},
    "No se pudo cargar el calendario de resultados."
  );
  return parseEarningsCalendarResult(raw);
}
