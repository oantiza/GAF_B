/** Contrato del calendario macro: fuente en vivo y respaldo fundamentado. */
import { callBackend } from "./callableBackend";
import { AppError } from "../core/appError";
import {
  requireArray,
  requireNullableString,
  requireOptionalNumber,
  requireObject,
  requireOptionalString,
  requireString
} from "./contractGuards";

export interface EconomicEvent {
  date?: string | null;
  country?: string | null;
  type?: string | null;
  actual?: number | string | null;
  estimate?: number | string | null;
  previous?: number | string | null;
  importance?: number | string | null;
  source?: string;
}

export interface EconomicCalendarResult {
  schema_version?: string;
  events: EconomicEvent[];
  from?: string;
  to?: string;
  source: string;
  note?: string;
  /** OK, NO_EVENTS_IN_COVERAGE, OUT_OF_SOURCE_RANGE, SOURCE_ERROR o INVALID_REQUEST. Ausente en un servidor sin actualizar. */
  status?: string;
  /** Primer y último día que cubre la fuente (solo trae la semana en curso). */
  covers_from?: string;
  covers_to?: string;
  count: number;
}

function parseScalar(value: unknown, field: string): number | string | null | undefined {
  if (value === undefined || value === null || typeof value === "number" || typeof value === "string") {
    return value;
  }
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: valor escalar inesperado.`);
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNullableString(value, field);
}

function requireOptionalIsoDate(value: unknown, field: string): string | undefined {
  const parsed = requireOptionalString(value, field);
  if (parsed !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: fecha no ISO.`);
  }
  return parsed;
}

function requireOptionalIsoDateTime(value: unknown, field: string): string | null | undefined {
  const parsed = optionalNullableString(value, field);
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: fecha no valida.`);
  }
  return parsed;
}

export function parseEconomicCalendarResult(raw: unknown): EconomicCalendarResult {
  const data = requireObject(raw, "get_economic_calendar response");
  const events = requireArray(data.events, "events").map((item, index) => {
      const row = requireObject(item, `events[${index}]`);
      return {
        date: requireOptionalIsoDateTime(row.date, `events[${index}].date`),
        country: optionalNullableString(row.country, `events[${index}].country`),
        type: optionalNullableString(row.type, `events[${index}].type`),
        actual: parseScalar(row.actual, `events[${index}].actual`),
        estimate: parseScalar(row.estimate, `events[${index}].estimate`),
        previous: parseScalar(row.previous, `events[${index}].previous`),
        importance: parseScalar(row.importance, `events[${index}].importance`),
        source: requireOptionalString(row.source, `events[${index}].source`)
      };
    });
  const count = requireOptionalNumber(data.count, "count") ?? events.length;
  if (!Number.isInteger(count) || count < 0 || count !== events.length) {
    throw new AppError("BACKEND", "Contrato de backend inválido en count: no coincide con events.");
  }
  const from = requireOptionalIsoDate(data.from, "from");
  const to = requireOptionalIsoDate(data.to, "to");
  if (from && to && from > to) {
    throw new AppError("BACKEND", "Contrato de backend inválido: from es posterior a to.");
  }
  return {
    schema_version: requireOptionalString(data.schema_version, "schema_version"),
    events,
    from,
    to,
    source: requireString(data.source, "source"),
    note: requireOptionalString(data.note, "note"),
    status: requireOptionalString(data.status, "status"),
    covers_from: requireOptionalIsoDate(data.covers_from, "covers_from"),
    covers_to: requireOptionalIsoDate(data.covers_to, "covers_to"),
    count
  };
}

export async function fetchEconomicCalendar(
  opts?: { from?: string; to?: string; country?: string }
): Promise<EconomicCalendarResult | null> {
  const raw = await callBackend<unknown>(
    "get_economic_calendar",
    opts ?? {},
    "No se pudo cargar el calendario macro."
  );
  return parseEconomicCalendarResult(raw);
}
