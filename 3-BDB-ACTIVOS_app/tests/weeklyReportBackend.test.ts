import { describe, expect, test } from "vitest";
import { AppError } from "../src/core/appError";
import { parseWeeklyReportResponse } from "../src/adapters/weeklyReportBackend";

function report() {
  return {
    schema_version: "strategy-report.v2",
    id: "weekly-2026-07-10",
    date: "2026-07-10T07:15:00Z",
    author: "Comite de Inversiones",
    provider: "Gemini con Google Search",
    sources: [
      { title: "Banco Central Europeo", url: "https://www.ecb.europa.eu/" },
      { title: "Federal Reserve", url: "https://www.federalreserve.gov/" }
    ],
    generation: {
      generated_at: "2026-07-10T07:15:00Z",
      grounded: true,
      research_model: "gemini-2.5-flash",
      report_model: "gemini-2.5-flash",
      source_count: 2
    },
    summary: {
      headline: "Tipos estables, seleccion activa",
      narrative: "Una vision prudente y diversificada para la semana.",
      keyEvents: ["Evento uno", "Evento dos", "Evento tres"],
      kpis: [{ label: "VIX", value: "15,4", trend: "down" }],
      marketTemperature: "Neutral",
      tailRisks: [{ risk: "Inflacion", probability: "Media", impact: "Alto" }]
    },
    fullReport: { narrative: "### Informe\n\nContenido" },
    assetAllocation: {
      overview: "Asignacion equilibrada.",
      classes: [{
        assetClass: "Renta Variable",
        strategicWeight: 45,
        tacticalWeight: 43,
        view: "Neutral",
        rationale: "Calidad"
      }],
      regionsEquity: [{ region: "Europa", weight: 25, view: "Positiva", rationale: "Valoracion" }],
      regionsFixedIncome: [{ region: "Gobierno", weight: 50, view: "Positiva", rationale: "Carry" }],
      sectors: [{ sector: "Financieros", weight: 30, view: "Positiva" }]
    }
  };
}

describe("weekly report backend contract", () => {
  test("parses freshness, traceability and sources", () => {
    const result = parseWeeklyReportResponse({
      schema_version: "strategy-report-response.v2",
      report: report(),
      source: "FIRESTORE_LIVE",
      freshness: "CURRENT",
      age_days: 0,
      invalid_count: 1
    });

    expect(result.freshness).toBe("CURRENT");
    expect(result.age_days).toBe(0);
    expect(result.invalid_count).toBe(1);
    expect(result.report?.sources).toHaveLength(2);
    expect(result.report?.generation?.grounded).toBe(true);
  });

  test("keeps compatibility with the previous response", () => {
    const result = parseWeeklyReportResponse({ report: report(), source: "FIRESTORE_LIVE" });

    expect(result.freshness).toBe("UNKNOWN");
    expect(result.age_days).toBeNull();
    expect(result.invalid_count).toBe(0);
  });

  test("accepts an explicit empty state", () => {
    const result = parseWeeklyReportResponse({
      report: null,
      source: "EMPTY",
      freshness: "EMPTY",
      age_days: null,
      invalid_count: 0
    });

    expect(result.report).toBeNull();
    expect(result.freshness).toBe("EMPTY");
  });

  test("accepts a daily brief with no asset allocation", () => {
    // strategy-report.v3: el informe diario no lleva assetAllocation. Exigirla
    // haria que el contrato del cliente rechazase un informe valido.
    const daily = report() as Record<string, unknown>;
    delete daily.assetAllocation;
    daily.id = "daily-2026-09-10";

    const result = parseWeeklyReportResponse({ report: daily, source: "FIRESTORE_LIVE" });

    expect(result.report?.id).toBe("daily-2026-09-10");
    expect(result.report?.assetAllocation).toBeUndefined();
    expect(result.report?.summary.headline).toBe("Tipos estables, seleccion activa");
  });

  test("rejects invalid metadata instead of disguising it", () => {
    expect(() => parseWeeklyReportResponse({
      report: report(), source: "FIRESTORE_LIVE", freshness: "FRESH", age_days: 0, invalid_count: 0
    })).toThrow(AppError);

    const invalidGrounding = report();
    invalidGrounding.generation.grounded = "yes" as unknown as boolean;
    expect(() => parseWeeklyReportResponse({ report: invalidGrounding, source: "FIRESTORE_LIVE" })).toThrow(AppError);

    expect(() => parseWeeklyReportResponse({
      report: report(), source: "FIRESTORE_LIVE", freshness: "CURRENT", age_days: -1, invalid_count: 0
    })).toThrow(AppError);
  });
});
