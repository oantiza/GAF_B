import { describe, expect, test } from "vitest";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import type { WeeklyReport } from "../src/types/weeklyReport";
import { extractPdfPageTexts } from "./support/pdfText";

/**
 * Glifos del papel (auditoría 16-10-2026, MEDIA-08): una flecha, «≈» o «Δ» salían como signos sueltos en el semanal.
 *
 * Hasta el 14-11-2026 esta prueba medía `safeText` (`pdfTheme`) contra las TTF de Instrument Sans y Newsreader. Ese papel se
 * retiró, y lo que hace su trabajo en la plantilla única es `sanearTexto` (`src/reports/plantilla/texto.ts`), medido contra
 * las cuatro fuentes de la plantilla en `tests/plantilla/texto.test.ts`. Aquí queda lo que se lee en un PDF generado: el
 * informe completo del semanal llega entero y sin flechas rotas.
 */
describe("PDF semanal: informe completo entero y sin flechas rotas", () => {
  test("una narrativa de más de 6.000 caracteres llega entera al papel", async () => {
    const paragraph = "La renta variable europea mantiene un tono constructivo con valoraciones razonables y beneficios estables. ";
    const narrative = `${paragraph.repeat(60)}\n\nCierre XQZWKV del informe.`;
    expect(narrative.length).toBeGreaterThan(6000);
    const report: WeeklyReport = {
      ...WEEKLY_REPORT_MOCK,
      summary: { ...WEEKLY_REPORT_MOCK.summary, narrative: "Rotación XQZ → WKV en la semana." },
      fullReport: { narrative }
    };
    const blob = await createWeeklyReportPdfBlob(report, "WEEKLY_REPORT");
    const text = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ");
    expect(text).toContain("XQZWKV");
    expect(text).toContain("XQZ a WKV");
    expect(text).not.toContain("→");
  }, 30_000);
});
