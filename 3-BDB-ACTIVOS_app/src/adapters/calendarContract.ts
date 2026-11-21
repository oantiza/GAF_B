import { AppError } from "../core/appError";
import {
  type GuardObject,
  requireNullableString,
  requireOptionalNumber,
  requireOptionalString,
  requireString
} from "./contractGuards";

export interface CalendarEnvelope {
  schema_version?: string;
  from?: string;
  to?: string;
  source: string;
  note?: string;
  /** Estado propio de la respuesta (aditivo): un servidor sin actualizar no lo envía. */
  status?: string;
  count: number;
}

function assertIsoDay(value: string, field: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !match
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: fecha no ISO.`);
  }
  return value;
}

export function optionalNullableIsoDay(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  const parsed = requireNullableString(value, field);
  return parsed === null ? null : assertIsoDay(parsed, field);
}

function optionalIsoDay(value: unknown, field: string): string | undefined {
  const parsed = requireOptionalString(value, field);
  return parsed === undefined ? undefined : assertIsoDay(parsed, field);
}

export function parseCalendarEnvelope(data: GuardObject, itemCount: number): CalendarEnvelope {
  const count = requireOptionalNumber(data.count, "count") ?? itemCount;
  if (!Number.isInteger(count) || count < 0 || count !== itemCount) {
    throw new AppError("BACKEND", "Contrato de backend inválido en count: no coincide con items.");
  }
  const from = optionalIsoDay(data.from, "from");
  const to = optionalIsoDay(data.to, "to");
  if (from && to && from > to) {
    throw new AppError("BACKEND", "Contrato de backend inválido: from es posterior a to.");
  }
  const source = requireString(data.source, "source");
  if (!source.trim()) {
    throw new AppError("BACKEND", "Contrato de backend inválido en source: valor vacío.");
  }
  return {
    schema_version: requireOptionalString(data.schema_version, "schema_version"),
    from,
    to,
    source,
    note: requireOptionalString(data.note, "note"),
    status: requireOptionalString(data.status, "status"),
    count
  };
}
