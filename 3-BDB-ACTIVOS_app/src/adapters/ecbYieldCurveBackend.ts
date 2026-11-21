import { AppError } from "../core/appError";
import { callBackend } from "./callableBackend";
import { requireArray, requireLiteral, requireNumber, requireObject, requireString } from "./contractGuards";

export const ECB_YIELD_MATURITIES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30] as const;

export interface EcbYieldCurvePoint {
  maturity_years: number;
  yield_pct: number;
}

export interface EcbYieldCurveResult {
  schema_version: "ecb-yield-curve.v1";
  /** null cuando el BCE no contestó con ninguna curva: la respuesta viene vacía y con notas. */
  as_of_date: string | null;
  aaa: EcbYieldCurvePoint[];
  all_bonds: EcbYieldCurvePoint[];
  source: "ECB_DATA_PORTAL";
  notes: string;
}

function contractError(field: string, detail: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: ${detail}.`);
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    contractError(field, `claves inesperadas; se esperaba ${wanted.join(", ")}`);
  }
}

function requireIsoDate(value: unknown, field: string): string {
  const raw = requireString(value, field);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    contractError(field, "se esperaba una fecha ISO válida");
  }
  return raw;
}

function parseCurve(value: unknown, field: "aaa" | "all_bonds"): EcbYieldCurvePoint[] {
  const points = requireArray(value, field).map((item, index) => {
    const point = requireObject(item, `${field}[${index}]`);
    requireExactKeys(point, ["maturity_years", "yield_pct"], `${field}[${index}]`);
    const maturity = requireNumber(point.maturity_years, `${field}[${index}].maturity_years`);
    const yieldPct = requireNumber(point.yield_pct, `${field}[${index}].yield_pct`);
    if (!ECB_YIELD_MATURITIES.includes(maturity as (typeof ECB_YIELD_MATURITIES)[number])) {
      contractError(`${field}[${index}].maturity_years`, "vencimiento no admitido");
    }
    if (yieldPct < -20 || yieldPct > 50) {
      contractError(`${field}[${index}].yield_pct`, "rentabilidad fuera del rango admitido");
    }
    return { maturity_years: maturity, yield_pct: yieldPct };
  });
  if (points.some((point, index) => index > 0 && point.maturity_years <= points[index - 1].maturity_years)) {
    contractError(field, "los vencimientos deben ser únicos y crecientes");
  }
  return points;
}

export function parseEcbYieldCurveResponse(raw: unknown): EcbYieldCurveResult {
  const data = requireObject(raw, "get_euro_yield_curve response");
  requireExactKeys(data, ["schema_version", "as_of_date", "aaa", "all_bonds", "source", "notes"], "get_euro_yield_curve response");
  const aaa = parseCurve(data.aaa, "aaa");
  const allBonds = parseCurve(data.all_bonds, "all_bonds");
  const vacia = aaa.length === 0 && allBonds.length === 0;
  if (vacia && data.as_of_date !== null) {
    contractError("curves", "se esperaba al menos una curva con observaciones");
  }
  return {
    schema_version: requireLiteral(data.schema_version, "ecb-yield-curve.v1", "schema_version"),
    as_of_date: vacia ? null : requireIsoDate(data.as_of_date, "as_of_date"),
    aaa,
    all_bonds: allBonds,
    source: requireLiteral(data.source, "ECB_DATA_PORTAL", "source"),
    notes: requireString(data.notes, "notes")
  };
}

export async function fetchEcbYieldCurve(): Promise<EcbYieldCurveResult> {
  const raw = await callBackend<unknown>(
    "get_euro_yield_curve",
    {},
    "No se pudo consultar la curva de tipos del Banco Central Europeo."
  );
  return parseEcbYieldCurveResponse(raw);
}
