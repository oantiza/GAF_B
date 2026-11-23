/**
 * Cableado a la callable `get_weekly_report`.
 * Devuelve el último informe semanal (WeeklyReport) de la colección
 * `bdb_activos_reports`; los errores de backend se propagan para mostrarlos en UI.
 */
import { callBackend } from "./callableBackend";
import type { WeeklyReport } from "../types/weeklyReport";
import { AppError } from "../core/appError";
import {
  requireArray,
  requireNullableNumber,
  requireNumber,
  requireObject,
  requireOneOf,
  requireOptionalBoolean,
  requireOptionalString,
  requireString
} from "./contractGuards";

export type WeeklyReportFreshness = "CURRENT" | "STALE" | "EMPTY" | "ERROR" | "UNKNOWN";

export interface WeeklyReportResponse {
  report: WeeklyReport | null;
  source: string;
  freshness: WeeklyReportFreshness;
  age_days: number | null;
  invalid_count: number;
  note?: string;
}

/** Una fuente se enlaza desde la pantalla: solo http: o https:, nunca javascript:, data: ni otro esquema. */
function esDireccionWeb(url: string): boolean {
  try {
    const protocolo = new URL(url).protocol;
    return protocolo === "http:" || protocolo === "https:";
  } catch {
    return false;
  }
}

function parseViewValue(value: unknown, field: string): "Positiva" | "Neutral" | "Negativa" {
  return requireOneOf(value, ["Positiva", "Neutral", "Negativa"] as const, field);
}

function parseTrend(value: unknown, field: string): "up" | "down" | "neutral" {
  return requireOneOf(value, ["up", "down", "neutral"] as const, field);
}

function parseMarketTemperature(value: unknown, field: string): WeeklyReport["summary"]["marketTemperature"] {
  return requireOneOf(value, ["Bullish", "Neutral", "Bearish"] as const, field);
}

function parseProbability(value: unknown, field: string): "Alta" | "Media" | "Baja" {
  return requireOneOf(value, ["Alta", "Media", "Baja"] as const, field);
}

function parseImpact(value: unknown, field: string): "Alto" | "Medio" | "Bajo" {
  return requireOneOf(value, ["Alto", "Medio", "Bajo"] as const, field);
}

function parseWeeklyReport(raw: unknown): WeeklyReport | null {
  if (raw === null) {
    return null;
  }
  const report = requireObject(raw, "report");
  const summary = requireObject(report.summary, "report.summary");
  // v3: el informe diario llega sin assetAllocation. Exigirla haria que el
  // contrato del cliente rechazase un informe perfectamente valido.
  const allocation =
    report.assetAllocation === undefined || report.assetAllocation === null
      ? undefined
      : requireObject(report.assetAllocation, "report.assetAllocation");
  const fullReport = report.fullReport === undefined ? undefined : requireObject(report.fullReport, "report.fullReport");
  const generation = report.generation === undefined ? undefined : requireObject(report.generation, "report.generation");

  return {
    schema_version: requireOptionalString(report.schema_version, "report.schema_version"),
    id: requireString(report.id, "report.id"),
    date: requireString(report.date, "report.date"),
    author: requireString(report.author, "report.author"),
    provider: requireOptionalString(report.provider, "report.provider"),
    /* Una fuente con una dirección que no es web se descarta sola: una fuente mala del modelo no deja sin informe. */
    sources: report.sources === undefined ? undefined : requireArray(report.sources, "report.sources").flatMap((item, index) => {
      const source = requireObject(item, `report.sources[${index}]`);
      const url = requireString(source.url, `report.sources[${index}].url`);
      return esDireccionWeb(url) ? [{ title: requireString(source.title, `report.sources[${index}].title`), url }] : [];
    }),
    generation: generation ? {
      generated_at: requireOptionalString(generation.generated_at, "report.generation.generated_at"),
      grounded: requireOptionalBoolean(generation.grounded, "report.generation.grounded"),
      research_model: requireOptionalString(generation.research_model, "report.generation.research_model"),
      report_model: requireOptionalString(generation.report_model, "report.generation.report_model"),
      source_count: generation.source_count === undefined ? undefined : requireNumber(generation.source_count, "report.generation.source_count")
    } : undefined,
    summary: {
      headline: requireString(summary.headline, "report.summary.headline"),
      narrative: requireString(summary.narrative, "report.summary.narrative"),
      keyEvents: requireArray(summary.keyEvents, "report.summary.keyEvents").map((item, index) =>
        requireString(item, `report.summary.keyEvents[${index}]`)
      ),
      kpis: summary.kpis === undefined ? undefined : requireArray(summary.kpis, "report.summary.kpis").map((item, index) => {
        const kpi = requireObject(item, `report.summary.kpis[${index}]`);
        return {
          label: requireString(kpi.label, `report.summary.kpis[${index}].label`),
          value: requireString(kpi.value, `report.summary.kpis[${index}].value`),
          trend: parseTrend(kpi.trend, `report.summary.kpis[${index}].trend`)
        };
      }),
      marketTemperature: summary.marketTemperature === undefined ? undefined : parseMarketTemperature(summary.marketTemperature, "report.summary.marketTemperature"),
      tailRisks: summary.tailRisks === undefined ? undefined : requireArray(summary.tailRisks, "report.summary.tailRisks").map((item, index) => {
        const risk = requireObject(item, `report.summary.tailRisks[${index}]`);
        return {
          risk: requireString(risk.risk, `report.summary.tailRisks[${index}].risk`),
          probability: parseProbability(risk.probability, `report.summary.tailRisks[${index}].probability`),
          impact: parseImpact(risk.impact, `report.summary.tailRisks[${index}].impact`)
        };
      })
    },
    fullReport: fullReport ? { narrative: requireString(fullReport.narrative, "report.fullReport.narrative") } : undefined,
    assetAllocation: allocation === undefined ? undefined : {
      overview: requireString(allocation.overview, "report.assetAllocation.overview"),
      classes: requireArray(allocation.classes, "report.assetAllocation.classes").map((item, index) => {
        const row = requireObject(item, `report.assetAllocation.classes[${index}]`);
        return {
          assetClass: requireString(row.assetClass, `report.assetAllocation.classes[${index}].assetClass`),
          strategicWeight: requireNumber(row.strategicWeight, `report.assetAllocation.classes[${index}].strategicWeight`),
          tacticalWeight: requireNumber(row.tacticalWeight, `report.assetAllocation.classes[${index}].tacticalWeight`),
          view: parseViewValue(row.view, `report.assetAllocation.classes[${index}].view`),
          rationale: requireOptionalString(row.rationale, `report.assetAllocation.classes[${index}].rationale`)
        };
      }),
      regionsEquity: requireArray(allocation.regionsEquity, "report.assetAllocation.regionsEquity").map((item, index) => {
        const row = requireObject(item, `report.assetAllocation.regionsEquity[${index}]`);
        return {
          region: requireString(row.region, `report.assetAllocation.regionsEquity[${index}].region`),
          weight: requireNumber(row.weight, `report.assetAllocation.regionsEquity[${index}].weight`),
          view: parseViewValue(row.view, `report.assetAllocation.regionsEquity[${index}].view`),
          rationale: requireOptionalString(row.rationale, `report.assetAllocation.regionsEquity[${index}].rationale`)
        };
      }),
      regionsFixedIncome: allocation.regionsFixedIncome === undefined ? undefined : requireArray(allocation.regionsFixedIncome, "report.assetAllocation.regionsFixedIncome").map((item, index) => {
        const row = requireObject(item, `report.assetAllocation.regionsFixedIncome[${index}]`);
        return {
          region: requireString(row.region, `report.assetAllocation.regionsFixedIncome[${index}].region`),
          weight: requireNumber(row.weight, `report.assetAllocation.regionsFixedIncome[${index}].weight`),
          view: parseViewValue(row.view, `report.assetAllocation.regionsFixedIncome[${index}].view`),
          rationale: requireOptionalString(row.rationale, `report.assetAllocation.regionsFixedIncome[${index}].rationale`)
        };
      }),
      sectors: allocation.sectors === undefined ? undefined : requireArray(allocation.sectors, "report.assetAllocation.sectors").map((item, index) => {
        const row = requireObject(item, `report.assetAllocation.sectors[${index}]`);
        return {
          sector: requireString(row.sector, `report.assetAllocation.sectors[${index}].sector`),
          weight: requireNumber(row.weight, `report.assetAllocation.sectors[${index}].weight`),
          view: parseViewValue(row.view, `report.assetAllocation.sectors[${index}].view`)
        };
      })
    }
  };
}

export function parseWeeklyReportResponse(raw: unknown): WeeklyReportResponse {
  const data = requireObject(raw, "get_weekly_report response");
  const report = parseWeeklyReport(data.report ?? null);
  const freshness = data.freshness === undefined
    ? (report ? "UNKNOWN" : "EMPTY")
    : requireOneOf(data.freshness, ["CURRENT", "STALE", "EMPTY", "ERROR"] as const, "freshness");
  const ageDays = data.age_days === undefined ? null : requireNullableNumber(data.age_days, "age_days");
  const invalidCount = data.invalid_count === undefined ? 0 : requireNumber(data.invalid_count, "invalid_count");
  if (ageDays !== null && (!Number.isInteger(ageDays) || ageDays < 0)) {
    throw new AppError("BACKEND", "Contrato de backend inválido en age_days.");
  }
  if (!Number.isInteger(invalidCount) || invalidCount < 0) {
    throw new AppError("BACKEND", "Contrato de backend inválido en invalid_count.");
  }
  return {
    report,
    source: requireString(data.source, "source"),
    freshness,
    age_days: ageDays,
    invalid_count: invalidCount,
    note: requireOptionalString(data.note, "note")
  };
}

export async function fetchWeeklyReportResult(type: string = "WEEKLY_REPORT"): Promise<WeeklyReportResponse> {
  const data = await callBackend<unknown>(
    "get_weekly_report",
    { type },
    "No se pudo cargar el informe semanal."
  );
  return parseWeeklyReportResponse(data);
}

/**
 * Publica el informe de hoy, a mano (decisión de Óscar, 04-11-2026: no hay nada programado).
 * Es lento —investiga y redacta con Gemini—, y el servidor corta a los 540 s, así que la
 * espera tiene que ser esa y no los 70 s de una llamada normal.
 *
 * Devuelve lo que contestó el servidor (15-11-2026): antes se descartaba y la pantalla daba por
 * publicado un informe que ya existía, que estaba en curso o que había agotado sus intentos.
 * `force` (solo administrador) regenera el del día o permite un intento más; con otra
 * publicación en curso el servidor no fuerza y sigue contestando `IN_PROGRESS`.
 */
export const STRATEGY_PUBLICATION_STATUSES = ["PUBLISHED", "ALREADY_PUBLISHED", "IN_PROGRESS", "ATTEMPTS_EXHAUSTED"] as const;
export type StrategyPublicationStatus = (typeof STRATEGY_PUBLICATION_STATUSES)[number];

export interface StrategyPublicationResult {
  status: StrategyPublicationStatus;
  reportId: string;
  /** Si fue una publicación forzada por el administrador. */
  forced: boolean;
  /** La fecha del informe que sustituyó un forzado, o `null` si no sustituyó ninguno. */
  replacedDate: string | null;
}

export function parseStrategyPublicationResult(raw: unknown): StrategyPublicationResult {
  const data = requireObject(raw, "admin_publish_report");
  const replacedRaw = data.replaced;
  const replaced = replacedRaw === undefined || replacedRaw === null ? null : requireObject(replacedRaw, "replaced");
  return {
    status: requireOneOf(data.status, STRATEGY_PUBLICATION_STATUSES, "status"),
    reportId: requireString(data.report_id, "report_id"),
    forced: requireOptionalBoolean(data.forced, "forced") ?? false,
    replacedDate: replaced ? (requireOptionalString(replaced.date ?? undefined, "replaced.date") ?? null) : null
  };
}

export async function publishStrategyReport(
  type: "DAILY_REPORT" | "WEEKLY_REPORT",
  options: { force?: boolean } = {}
): Promise<StrategyPublicationResult> {
  const payload = options.force ? { type, force: true } : { type };
  const data = await callBackend<unknown>("admin_publish_report", payload, "No se pudo publicar el informe.", { timeout: 540_000 });
  return parseStrategyPublicationResult(data);
}
