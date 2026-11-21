/**
 * Lo guardado sin tildes se escribe con tilde en el papel (informe de estrategia, 11-11-2026): los cuatro títulos
 * de sección que pedía el prompt antiguo y la región «Japon». Coincidencia exacta; el texto del modelo no se reescribe.
 * Y el papel no usa siglas de gestor: «Estratégica» y «Táctica», no «SAA» ni «TAA».
 */
import { describe, expect, test } from "vitest";
import { parseWeeklyReportResponse } from "../src/adapters/weeklyReportBackend";
import { conTildesEnLosTitulos, regionDeEstrategia } from "../src/core/textoDeEstrategia";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import type { WeeklyReport } from "../src/types/weeklyReport";
import { extractPdfPageTexts } from "./support/pdfText";

const SIN_TILDES =
  "### Macroeconomia y geopolitica\n\nTexto uno, con Macroeconomia y geopolitica dentro.\n\n### Escenarios estrategicos\n\nDos.\n\n" +
  "### Valoraciones y mercados\n\nTres.\n\n### Posicionamiento y conclusiones\n\nCuatro.\n\n### Otro titulo sin tilde\n\nCinco.";

const GUARDADO: WeeklyReport = {
  ...WEEKLY_REPORT_MOCK,
  fullReport: { narrative: SIN_TILDES },
  assetAllocation: {
    ...WEEKLY_REPORT_MOCK.assetAllocation!,
    regionsEquity: WEEKLY_REPORT_MOCK.assetAllocation!.regionsEquity.map((row) => (row.region === "Japón" ? { ...row, region: "Japon" } : row))
  }
};

describe("los títulos conocidos", () => {
  test("se escriben con tilde por coincidencia exacta de la línea de título, y nada más cambia", () => {
    const corregido = conTildesEnLosTitulos(SIN_TILDES);
    expect(corregido).toContain("### Macroeconomía y geopolítica\n");
    expect(corregido).toContain("### Escenarios estratégicos\n");
    expect(corregido).toContain("### Valoraciones y mercados\n");
    expect(corregido).toContain("### Posicionamiento y conclusiones\n");
    expect(corregido).toContain("### Otro titulo sin tilde\n");
    /* La misma frase dentro de un párrafo no es un título: no se toca. */
    expect(corregido).toContain("con Macroeconomia y geopolitica dentro.");
    expect(conTildesEnLosTitulos("### Macroeconomia y geopolitica 2026")).toBe("### Macroeconomia y geopolitica 2026");
    expect(conTildesEnLosTitulos("### Macroeconomia y geopolitica\r\nx")).toBe("### Macroeconomía y geopolítica\r\nx");
  });

  test("también el título del informe diario que lleva tilde, y solo ese: los otros dos no la necesitan", () => {
    const diario = "### Cierre y lectura de la sesion\n\nUno.\n\n### Datos y bancos centrales\n\nDos.\n\n### Agenda y riesgos\n\nTres.";
    expect(conTildesEnLosTitulos(diario)).toBe("### Cierre y lectura de la sesión\n\nUno.\n\n### Datos y bancos centrales\n\nDos.\n\n### Agenda y riesgos\n\nTres.");
    /* Ya escrito con tilde (el prompt de hoy), se queda como está. */
    expect(conTildesEnLosTitulos("### Cierre y lectura de la sesión\n\nUno.")).toBe("### Cierre y lectura de la sesión\n\nUno.");
  });

  test("Japon y Japón se escriben Japón", () => {
    expect(regionDeEstrategia("Japon")).toBe("Japón");
    expect(regionDeEstrategia("Japón")).toBe("Japón");
    expect(regionDeEstrategia("Europa")).toBe("Europa");
  });
});

describe("el adaptador acepta las dos escrituras de la región", () => {
  test.each(["Japon", "Japón"])("%s", (region) => {
    const result = parseWeeklyReportResponse({
      report: {
        schema_version: "strategy-report.v2",
        id: "weekly-2026-07-10",
        date: "2026-07-10T07:15:00Z",
        author: "Redacción automática (IA)",
        provider: "Gemini con Google Search",
        sources: [
          { title: "Banco Central Europeo", url: "https://www.ecb.europa.eu/" },
          { title: "Federal Reserve", url: "https://www.federalreserve.gov/" }
        ],
        generation: { generated_at: "2026-07-10T07:15:00Z", grounded: true, research_model: "m", report_model: "m", source_count: 2 },
        summary: {
          headline: "Tipos estables",
          narrative: "Una visión prudente.",
          keyEvents: ["Uno", "Dos", "Tres"],
          kpis: [{ label: "VIX", value: "15,4", trend: "down" }],
          marketTemperature: "Neutral",
          tailRisks: [{ risk: "Inflación", probability: "Media", impact: "Alto" }]
        },
        fullReport: { narrative: "### Informe\n\nContenido" },
        assetAllocation: {
          overview: "Asignación equilibrada.",
          classes: [{ assetClass: "Renta Variable", strategicWeight: 45, tacticalWeight: 43, view: "Neutral", rationale: "Calidad" }],
          regionsEquity: [{ region, weight: 25, view: "Neutral", rationale: "Reformas" }],
          regionsFixedIncome: [{ region: "Gobierno", weight: 50, view: "Positiva", rationale: "Carry" }],
          sectors: [{ sector: "Financieros", weight: 30, view: "Positiva" }]
        }
      },
      source: "FIRESTORE_LIVE"
    });
    expect(result.report?.assetAllocation?.regionsEquity[0].region).toBe(region);
  });
});

describe("el PDF de un informe guardado sin tildes", () => {
  test("pinta los títulos y la región con tilde, y no dice SAA ni TAA", async () => {
    const bytes = Buffer.from(await (await createWeeklyReportPdfBlob(GUARDADO, "WEEKLY_REPORT")).arrayBuffer());
    const texto = extractPdfPageTexts(bytes).join("\n");
    expect(texto).toContain("Macroeconomía y geopolítica");
    expect(texto).toContain("Escenarios estratégicos");
    expect(texto).toContain("Valoraciones y mercados");
    expect(texto).toContain("Posicionamiento y conclusiones");
    expect(texto).not.toContain("Escenarios estrategicos");
    expect(texto).not.toMatch(/^Macroeconomia y geopolitica$/m);
    expect(texto).toContain("Otro titulo sin tilde");
    /* Las regiones y las columnas de la asignación ya no salen en el papel (15-11-2026). */
    expect(texto).not.toMatch(/Japon|Japón/);
    expect(texto).not.toMatch(/SAA|TAA/);
    expect(texto).not.toContain("Estratégica");
    expect(texto).not.toContain("Táctica");
  }, 60_000);
});
