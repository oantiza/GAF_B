/**
 * Cableado a la callable `get_macro_reference`.
 * Descarga referencias públicas de IPC (INE) y Letras (Banco de España) y,
 * cuando recibe los flujos, devuelve la comparativa patrimonial completa.
 */
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireBoolean,
  requireNullableNumber,
  requireNumber,
  requireObject,
  requireOptionalString,
  requireString
} from "./contractGuards";
import { AppError } from "../core/appError";

export interface ComparisonAlternative {
  valor_final_bruto: number | null;
  valor_final_neto: number | null;
  tir_nominal_bruta_pct: number | null;
  tir_nominal_neta_pct: number | null;
  tir_real_bruta_pct: number | null;
  tir_real_neta_pct: number | null;
}

export interface PatrimonialComparison {
  cartera: ComparisonAlternative;
  letras: ComparisonAlternative;
  deposito: ComparisonAlternative;
}

export interface BizkaiaTaxBracket {
  threshold_eur: number;
  rate_pct: number;
}

export interface MacroSourceStatus {
  name: string;
  status: string;
  last_data: string | null;
}

export interface MacroRateTable {
  measured_through_year: number;
  assumed_years: number[];
}

export interface MacroReference {
  /** Qué fuentes respondieron y con qué último dato (aditivo). */
  sources?: MacroSourceStatus[];
  /** Qué periodo cubre de verdad la media de Letras (siempre los últimos 12 meses del BdE). */
  letras_period?: { last_data: string | null; matches_request: boolean; note: string };
  /** De qué territorio y ejercicio es la escala fiscal. */
  bizkaia_tax_scale?: { territory: string; fiscal_year: number; note: string };
  deposit_rate_default_year?: number;
  deposit_rate_default_kind?: string;
  /** Qué años de las tablas fijas son dato de tabla y cuáles supuesto. */
  rate_tables?: { deposit: MacroRateTable; letras: MacroRateTable };
  inflation_annual_pct?: number | null;
  inflation_total_pct?: number | null;
  letras_avg_rate_pct?: number | null;
  ipc_start?: number | null;
  ipc_end?: number | null;
  source?: string;
  notes?: string;
  bizkaia_tax_brackets?: BizkaiaTaxBracket[];
  deposit_rate_default_pct?: number | null;
  deposit_rate_used_pct?: number | null;
  comparison?: PatrimonialComparison | null;
}

export interface ComparisonFlowInput {
  date: string;
  amount: number;
}

export interface ComparisonRequestOptions {
  flows?: ComparisonFlowInput[];
  finalValue?: number;
  depositRatePct?: number;
}

export const DEPOSIT_RATE_MIN_PCT = -5;
export const DEPOSIT_RATE_MAX_PCT = 25;

export function isDepositRatePctValid(value: number): boolean {
  return Number.isFinite(value) && value >= DEPOSIT_RATE_MIN_PCT && value <= DEPOSIT_RATE_MAX_PCT;
}

function optionalNullableNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNullableNumber(value, field);
}

function parseAlternative(raw: unknown, field: string): ComparisonAlternative {
  const data = requireObject(raw, field);
  return {
    valor_final_bruto: requireNullableNumber(data.valor_final_bruto, `${field}.valor_final_bruto`),
    valor_final_neto: requireNullableNumber(data.valor_final_neto, `${field}.valor_final_neto`),
    tir_nominal_bruta_pct: requireNullableNumber(data.tir_nominal_bruta_pct, `${field}.tir_nominal_bruta_pct`),
    tir_nominal_neta_pct: requireNullableNumber(data.tir_nominal_neta_pct, `${field}.tir_nominal_neta_pct`),
    tir_real_bruta_pct: requireNullableNumber(data.tir_real_bruta_pct, `${field}.tir_real_bruta_pct`),
    tir_real_neta_pct: requireNullableNumber(data.tir_real_neta_pct, `${field}.tir_real_neta_pct`)
  };
}

function parseComparison(raw: unknown): PatrimonialComparison | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  const data = requireObject(raw, "comparison");
  return {
    cartera: parseAlternative(data.cartera, "comparison.cartera"),
    letras: parseAlternative(data.letras, "comparison.letras"),
    deposito: parseAlternative(data.deposito, "comparison.deposito")
  };
}

function invalidTaxBrackets(message: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en bizkaia_tax_brackets: ${message}.`);
}

function parseTaxBrackets(raw: unknown): BizkaiaTaxBracket[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const values = requireArray(raw, "bizkaia_tax_brackets");
  if (values.length === 0) {
    return invalidTaxBrackets("la escala no puede estar vacía");
  }

  let previousThreshold = -1;
  return values.map((item, index) => {
    const data = requireObject(item, `bizkaia_tax_brackets[${index}]`);
    const threshold = requireNumber(data.threshold_eur, `bizkaia_tax_brackets[${index}].threshold_eur`);
    const rate = requireNumber(data.rate_pct, `bizkaia_tax_brackets[${index}].rate_pct`);
    if (index === 0 && threshold !== 0) {
      return invalidTaxBrackets("el primer umbral debe ser 0");
    }
    if (threshold < 0 || threshold <= previousThreshold) {
      return invalidTaxBrackets("los umbrales deben ser no negativos y estrictamente crecientes");
    }
    if (rate < 0 || rate > 100) {
      return invalidTaxBrackets("los tipos deben estar entre 0 y 100");
    }
    previousThreshold = threshold;
    return { threshold_eur: threshold, rate_pct: rate };
  });
}

function parseRateTable(raw: unknown, field: string): MacroRateTable {
  const data = requireObject(raw, field);
  return {
    measured_through_year: requireNumber(data.measured_through_year, `${field}.measured_through_year`),
    assumed_years: requireArray(data.assumed_years, `${field}.assumed_years`).map((year, index) =>
      requireNumber(year, `${field}.assumed_years[${index}]`)
    )
  };
}

function parseAdditions(data: Record<string, unknown>): Partial<MacroReference> {
  const out: Partial<MacroReference> = {};
  if (data.sources !== undefined) {
    out.sources = requireArray(data.sources, "sources").map((item, index) => {
      const row = requireObject(item, `sources[${index}]`);
      return {
        name: requireString(row.name, `sources[${index}].name`),
        status: requireString(row.status, `sources[${index}].status`),
        last_data: row.last_data === null || row.last_data === undefined ? null : requireString(row.last_data, `sources[${index}].last_data`)
      };
    });
  }
  if (data.letras_period !== undefined) {
    const row = requireObject(data.letras_period, "letras_period");
    out.letras_period = {
      last_data: row.last_data === null || row.last_data === undefined ? null : requireString(row.last_data, "letras_period.last_data"),
      matches_request: requireBoolean(row.matches_request, "letras_period.matches_request"),
      note: requireString(row.note, "letras_period.note")
    };
  }
  if (data.bizkaia_tax_scale !== undefined) {
    const row = requireObject(data.bizkaia_tax_scale, "bizkaia_tax_scale");
    out.bizkaia_tax_scale = {
      territory: requireString(row.territory, "bizkaia_tax_scale.territory"),
      fiscal_year: requireNumber(row.fiscal_year, "bizkaia_tax_scale.fiscal_year"),
      note: requireString(row.note, "bizkaia_tax_scale.note")
    };
  }
  if (data.deposit_rate_default_year !== undefined) {
    out.deposit_rate_default_year = requireNumber(data.deposit_rate_default_year, "deposit_rate_default_year");
  }
  if (data.deposit_rate_default_kind !== undefined) {
    out.deposit_rate_default_kind = requireString(data.deposit_rate_default_kind, "deposit_rate_default_kind");
  }
  if (data.rate_tables !== undefined) {
    const row = requireObject(data.rate_tables, "rate_tables");
    out.rate_tables = {
      deposit: parseRateTable(row.deposit, "rate_tables.deposit"),
      letras: parseRateTable(row.letras, "rate_tables.letras")
    };
  }
  return out;
}

export function parseMacroReference(raw: unknown): MacroReference {
  const data = requireObject(raw, "get_macro_reference response");
  return {
    ...parseAdditions(data),
    inflation_annual_pct: optionalNullableNumber(data.inflation_annual_pct, "inflation_annual_pct"),
    inflation_total_pct: optionalNullableNumber(data.inflation_total_pct, "inflation_total_pct"),
    letras_avg_rate_pct: optionalNullableNumber(data.letras_avg_rate_pct, "letras_avg_rate_pct"),
    ipc_start: optionalNullableNumber(data.ipc_start, "ipc_start"),
    ipc_end: optionalNullableNumber(data.ipc_end, "ipc_end"),
    source: requireOptionalString(data.source, "source"),
    notes: requireOptionalString(data.notes, "notes"),
    bizkaia_tax_brackets: parseTaxBrackets(data.bizkaia_tax_brackets),
    deposit_rate_default_pct: optionalNullableNumber(data.deposit_rate_default_pct, "deposit_rate_default_pct"),
    deposit_rate_used_pct: optionalNullableNumber(data.deposit_rate_used_pct, "deposit_rate_used_pct"),
    comparison: parseComparison(data.comparison)
  };
}

export async function fetchMacroReference(
  startDate: string,
  endDate: string,
  options?: ComparisonRequestOptions
): Promise<MacroReference | null> {
  if (options?.depositRatePct !== undefined && !isDepositRatePctValid(options.depositRatePct)) {
    throw new AppError(
      "BACKEND",
      `El tipo del depósito debe estar entre ${DEPOSIT_RATE_MIN_PCT} % y ${DEPOSIT_RATE_MAX_PCT} %.`
    );
  }
  const payload: Record<string, unknown> = {
    start_date: startDate,
    end_date: endDate
  };
  if (
    options?.flows &&
    options.flows.length > 0 &&
    typeof options.finalValue === "number" &&
    Number.isFinite(options.finalValue)
  ) {
    payload.flows = options.flows.map((flow) => ({ date: flow.date, amount: flow.amount }));
    payload.final_value = options.finalValue;
    if (typeof options.depositRatePct === "number") {
      payload.deposit_rate_pct = options.depositRatePct;
    }
  }
  const raw = await callBackend<unknown>(
    "get_macro_reference",
    payload,
    "No se pudo consultar INE/BdE."
  );
  return parseMacroReference(raw);
}
