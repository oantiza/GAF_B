import { AppError } from "../core/appError";

export type GuardObject = Record<string, unknown>;

function fail(field: string, expected: string, value: unknown): never {
  const received = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  throw new AppError(
    "BACKEND",
    `Contrato de backend inválido en ${field}: se esperaba ${expected}; recibido ${received}.`
  );
}

export function isObject(value: unknown): value is GuardObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, field: string): GuardObject {
  if (!isObject(value)) {
    fail(field, "object", value);
  }
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(field, "string", value);
  }
  return value;
}

export function requireOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field);
}

export function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, field);
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(field, "finite number", value);
  }
  return value;
}

export function requireOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNumber(value, field);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(field, "boolean", value);
  }
  return value;
}

export function requireOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireBoolean(value, field);
}

export function requireNullableNumber(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  return requireNumber(value, field);
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(field, "array", value);
  }
  return value;
}

export function requireStringArray(value: unknown, field: string): string[] {
  return requireArray(value, field).map((item, index) => requireString(item, `${field}[${index}]`));
}

export function requireNumberArray(value: unknown, field: string): number[] {
  return requireArray(value, field).map((item, index) => requireNumber(item, `${field}[${index}]`));
}

export function requireLiteral<T extends string | number>(
  value: unknown,
  expected: T,
  field: string
): T {
  if (value !== expected) {
    throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: valor inesperado ${String(value)}.`);
  }
  return expected;
}

export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: valor inesperado ${String(value)}.`);
  }
  return value as T;
}
