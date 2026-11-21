import { AppError } from "../core/appError";
import { callBackend } from "./callableBackend";
import { requireObject } from "./contractGuards";

export type SystemStatusJsonValue =
  | null
  | boolean
  | number
  | string
  | SystemStatusJsonValue[]
  | SystemStatusJsonObject;

export interface SystemStatusJsonObject {
  [key: string]: SystemStatusJsonValue;
}

export type SystemIntegrityState = "OK" | "WARN" | "FAIL";
export type SystemFreshnessState = SystemIntegrityState | "UNKNOWN";
export type SystemProblemSeverity = "INFO" | "WARN" | "FAIL";

export type IntegrityStatusProblem = SystemStatusJsonObject & {
  severity?: SystemProblemSeverity;
  check?: string;
  detail?: string;
  sample?: string[];
};

export type IntegrityStatusFreshness = SystemStatusJsonObject & {
  price_refresh?: SystemFreshnessState;
  metrics_refresh?: SystemFreshnessState;
  backup?: SystemFreshnessState;
};

export type IntegrityStatusDocument = SystemStatusJsonObject & {
  checked_at?: string;
  status?: SystemIntegrityState;
  problems?: IntegrityStatusProblem[];
  counts?: SystemStatusJsonObject;
  freshness?: IntegrityStatusFreshness;
  applied?: boolean;
};

export type BackupStatusDocument = SystemStatusJsonObject & {
  completed_at?: string;
  verification?: string;
  firestore_records?: number;
  auth_users?: number;
  backup_dir?: string;
};

export type PriceRefreshStatusDocument = SystemStatusJsonObject & {
  last_run?: string;
  last_run_date?: string;
  read_budget_max?: number;
  read_budget_used?: number;
};

export type MetricsRefreshStatusDocument = SystemStatusJsonObject & {
  last_run?: string;
  last_price_series_last_date?: string | null;
  scan_after_asset_id?: string | null;
  cycle_completed?: boolean;
  scanned_assets?: number;
  processed_assets?: number;
  written?: number;
  read_budget_max?: number;
  read_budget_used?: number;
  stopped_by_budget?: boolean;
};

export interface SystemStatusResponse {
  integrity: IntegrityStatusDocument | null;
  backup: BackupStatusDocument | null;
  prices: PriceRefreshStatusDocument | null;
  metrics: MetricsRefreshStatusDocument | null;
}

const MAX_JSON_DEPTH = 32;

function contractError(field: string, detail: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: ${detail}.`);
}

function jsonValue(raw: unknown, field: string, ancestors: WeakSet<object>, depth: number): SystemStatusJsonValue {
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) contractError(field, "número no finito");
    return raw;
  }
  if (depth > MAX_JSON_DEPTH) {
    contractError(field, `profundidad superior a ${MAX_JSON_DEPTH}`);
  }
  if (Array.isArray(raw)) {
    if (ancestors.has(raw)) contractError(field, "referencia circular");
    if (Object.getOwnPropertySymbols(raw).length > 0 || Object.keys(raw).length !== raw.length) {
      contractError(field, "array no JSON");
    }
    ancestors.add(raw);
    try {
      const parsed: SystemStatusJsonValue[] = [];
      for (let index = 0; index < raw.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(raw, index)) {
          contractError(`${field}[${index}]`, "elemento ausente");
        }
        parsed.push(jsonValue(raw[index], `${field}[${index}]`, ancestors, depth + 1));
      }
      return parsed;
    } finally {
      ancestors.delete(raw);
    }
  }
  if (typeof raw !== "object" || raw === null) {
    contractError(field, "valor no compatible con JSON");
  }

  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    contractError(field, "objeto no plano");
  }
  if (Object.getOwnPropertySymbols(raw).length > 0) {
    contractError(field, "clave no compatible con JSON");
  }
  if (ancestors.has(raw)) contractError(field, "referencia circular");

  ancestors.add(raw);
  try {
    const entries = Object.getOwnPropertyNames(raw).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        contractError(`${field}.${key}`, "propiedad no compatible con JSON");
      }
      return [key, jsonValue(descriptor.value, `${field}.${key}`, ancestors, depth + 1)] as const;
    });
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(raw);
  }
}

function optionalString(document: SystemStatusJsonObject, key: string, field: string): void {
  const value = document[key];
  if (value !== undefined && typeof value !== "string") contractError(`${field}.${key}`, "texto esperado");
}

function optionalNullableString(document: SystemStatusJsonObject, key: string, field: string): void {
  const value = document[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    contractError(`${field}.${key}`, "texto o null esperado");
  }
}

function optionalNumber(document: SystemStatusJsonObject, key: string, field: string): void {
  const value = document[key];
  if (value !== undefined && typeof value !== "number") contractError(`${field}.${key}`, "número esperado");
}

function optionalBoolean(document: SystemStatusJsonObject, key: string, field: string): void {
  const value = document[key];
  if (value !== undefined && typeof value !== "boolean") contractError(`${field}.${key}`, "booleano esperado");
}

function optionalOneOf<T extends string>(
  document: SystemStatusJsonObject,
  key: string,
  allowed: readonly T[],
  field: string
): void {
  const value = document[key];
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value as T))) {
    contractError(`${field}.${key}`, `valor esperado: ${allowed.join("|")}`);
  }
}

function isJsonObject(value: SystemStatusJsonValue | undefined): value is SystemStatusJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIntegrity(document: SystemStatusJsonObject, field: string): void {
  optionalString(document, "checked_at", field);
  optionalOneOf(document, "status", ["OK", "WARN", "FAIL"] as const, field);
  optionalBoolean(document, "applied", field);

  if (document.counts !== undefined && !isJsonObject(document.counts)) {
    contractError(`${field}.counts`, "objeto esperado");
  }
  if (isJsonObject(document.counts)) {
    Object.entries(document.counts).forEach(([key, value]) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        contractError(`${field}.counts.${key}`, "entero no negativo esperado");
      }
    });
  }
  if (document.freshness !== undefined) {
    if (!isJsonObject(document.freshness)) contractError(`${field}.freshness`, "objeto esperado");
    ["price_refresh", "metrics_refresh", "backup"].forEach((key) =>
      optionalOneOf(document.freshness as SystemStatusJsonObject, key, ["OK", "WARN", "FAIL", "UNKNOWN"] as const, `${field}.freshness`)
    );
  }
  if (document.problems !== undefined) {
    if (!Array.isArray(document.problems)) contractError(`${field}.problems`, "array esperado");
    document.problems.forEach((item, index) => {
      if (!isJsonObject(item)) contractError(`${field}.problems[${index}]`, "objeto esperado");
      optionalOneOf(item, "severity", ["INFO", "WARN", "FAIL"] as const, `${field}.problems[${index}]`);
      optionalString(item, "check", `${field}.problems[${index}]`);
      optionalString(item, "detail", `${field}.problems[${index}]`);
      if (item.sample !== undefined && (!Array.isArray(item.sample) || item.sample.some((value) => typeof value !== "string"))) {
        contractError(`${field}.problems[${index}].sample`, "array de textos esperado");
      }
    });
  }
}

function validateBackup(document: SystemStatusJsonObject, field: string): void {
  ["completed_at", "verification", "backup_dir"].forEach((key) => optionalString(document, key, field));
  ["firestore_records", "auth_users"].forEach((key) => optionalNumber(document, key, field));
}

function validatePrices(document: SystemStatusJsonObject, field: string): void {
  ["last_run", "last_run_date"].forEach((key) => optionalString(document, key, field));
  ["read_budget_max", "read_budget_used"].forEach((key) => optionalNumber(document, key, field));
}

function validateMetrics(document: SystemStatusJsonObject, field: string): void {
  optionalString(document, "last_run", field);
  optionalNullableString(document, "last_price_series_last_date", field);
  optionalNullableString(document, "scan_after_asset_id", field);
  ["cycle_completed", "stopped_by_budget"].forEach((key) => optionalBoolean(document, key, field));
  ["scanned_assets", "processed_assets", "written", "read_budget_max", "read_budget_used"].forEach((key) =>
    optionalNumber(document, key, field)
  );
}

function nullableDocument<T extends SystemStatusJsonObject>(
  raw: unknown,
  field: string,
  validate: (document: SystemStatusJsonObject, field: string) => void
): T | null {
  if (raw === null) return null;
  const parsed = jsonValue(raw, field, new WeakSet(), 0);
  if (!isJsonObject(parsed)) contractError(field, "documento objeto o null esperado");
  validate(parsed, field);
  return parsed as T;
}

export function parseSystemStatusResponse(raw: unknown): SystemStatusResponse {
  const data = requireObject(raw, "get_system_status response");
  return {
    integrity: nullableDocument<IntegrityStatusDocument>(data.integrity, "integrity", validateIntegrity),
    backup: nullableDocument<BackupStatusDocument>(data.backup, "backup", validateBackup),
    prices: nullableDocument<PriceRefreshStatusDocument>(data.prices, "prices", validatePrices),
    metrics: nullableDocument<MetricsRefreshStatusDocument>(data.metrics, "metrics", validateMetrics)
  };
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  const raw = await callBackend<unknown>(
    "get_system_status",
    {},
    "No se pudo cargar el estado del sistema."
  );
  return parseSystemStatusResponse(raw);
}
