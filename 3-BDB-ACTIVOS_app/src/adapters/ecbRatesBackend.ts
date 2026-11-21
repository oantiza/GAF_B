import { AppError } from "../core/appError";
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireLiteral,
  requireNumber,
  requireObject,
  requireOneOf,
  requireOptionalString,
  requireString
} from "./contractGuards";

export const ECB_RATE_IDS = ["estr", "dfr", "mro", "mlf"] as const;
export type EcbRateId = (typeof ECB_RATE_IDS)[number];

export interface EcbRate {
  id: EcbRateId;
  date: string;
  value: number;
}

export interface EcbRatesResult {
  schema_version: "ecb-rates.v1";
  rates: EcbRate[];
  requested_count: number;
  live_count: number;
  source: "ECB_DATA_PORTAL";
  retrieved_at: string;
  notes?: string;
}

function contractError(field: string, detail: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: ${detail}.`);
}

function requireCount(value: unknown, field: string): number {
  const count = requireNumber(value, field);
  if (!Number.isInteger(count) || count < 0) {
    contractError(field, "se esperaba un entero no negativo");
  }
  return count;
}

function requireIsoDate(value: unknown, field: string): string {
  const date = requireString(value, field);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    contractError(field, "se esperaba una fecha ISO valida");
  }
  return date;
}

export function parseEcbRatesResponse(raw: unknown): EcbRatesResult {
  const data = requireObject(raw, "get_ecb_rates response");
  const rates = requireArray(data.rates, "rates").map((item, index) => {
    const rate = requireObject(item, `rates[${index}]`);
    const value = requireNumber(rate.value, `rates[${index}].value`);
    if (value < -20 || value > 50) {
      contractError(`rates[${index}].value`, "valor fuera del rango monetario admitido");
    }
    return {
      id: requireOneOf(rate.id, ECB_RATE_IDS, `rates[${index}].id`),
      date: requireIsoDate(rate.date, `rates[${index}].date`),
      value
    };
  });
  const ids = new Set(rates.map((rate) => rate.id));
  if (ids.size !== rates.length) {
    contractError("rates", "hay series duplicadas");
  }

  const requestedCount = requireCount(data.requested_count, "requested_count");
  const liveCount = requireCount(data.live_count, "live_count");
  if (requestedCount !== ECB_RATE_IDS.length || liveCount !== rates.length) {
    contractError("coverage", "los recuentos no coinciden con las series recibidas");
  }

  return {
    schema_version: requireLiteral(data.schema_version, "ecb-rates.v1", "schema_version"),
    rates,
    requested_count: requestedCount,
    live_count: liveCount,
    source: requireLiteral(data.source, "ECB_DATA_PORTAL", "source"),
    retrieved_at: requireString(data.retrieved_at, "retrieved_at"),
    notes: requireOptionalString(data.notes, "notes")
  };
}

export async function fetchEcbRates(): Promise<EcbRatesResult> {
  const raw = await callBackend<unknown>(
    "get_ecb_rates",
    {},
    "No se pudieron consultar los tipos del Banco Central Europeo."
  );
  return parseEcbRatesResponse(raw);
}
