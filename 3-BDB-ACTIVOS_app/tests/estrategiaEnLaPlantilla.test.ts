/**
 * El informe de estrategia en la plantilla única: tema interno en la pantalla normal y de cliente en Modo cliente (que es
 * cuando no se nombra al proveedor), la identidad del asesor en la cabecera, y los pesos de la asignación con el formato
 * común. Se lee el PDF generado.
 */
import { describe, expect, test } from "vitest";
import { peso } from "../src/core/formato";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import type { WeeklyReport } from "../src/types/weeklyReport";
import { IDENTIDAD_DE_PRUEBA, comprobarPlantilla, guardarSiSePide } from "./support/comprobarPlantilla";
import { extractPdfPageTexts, extractPdfTextRuns } from "./support/pdfText";

const LARGO: WeeklyReport = {
  ...WEEKLY_REPORT_MOCK,
  provider: "Gemini con Google Search",
  fullReport: { narrative: Array.from({ length: 12 }, (_, i) => `### Apartado ${i + 1}\n\n${"La renta variable mantiene el tono y los beneficios acompañan. ".repeat(14)}`).join("\n\n") },
  sources: Array.from({ length: 14 }, (_, i) => ({ title: `fuente-${i + 1}.com`, url: `https://fuente-${i + 1}.com/informe` }))
};

async function generar(informe: WeeklyReport, tipo: string, conProveedor: boolean, identidad: typeof IDENTIDAD_DE_PRUEBA | Record<string, never>, nombre?: string) {
  const bytes = Buffer.from(await (await createWeeklyReportPdfBlob(informe, tipo, { atrasado: false, diasDeAtraso: null }, conProveedor, identidad)).arrayBuffer());
  if (nombre) guardarSiSePide(bytes, "informe-de-estrategia", nombre);
  const hojas = extractPdfPageTexts(bytes);
  return { bytes, hojas, texto: hojas.join("\n"), cadenas: extractPdfTextRuns(bytes).flat().join("\n") };
}

describe("el informe de estrategia en la plantilla", () => {
  test("semanal, interno: tema interno, con el proveedor y la identidad del asesor en cada hoja", async () => {
    const { bytes, texto } = await generar(LARGO, "WEEKLY_REPORT", true, IDENTIDAD_DE_PRUEBA, "semanal-interno");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Informe de estrategia", identidad: "Marta Ruiz Alonso" });
    expect(texto).toContain("Gemini con Google Search");
  }, 30_000);

  test("semanal, en Modo cliente: tema de cliente y sin el proveedor", async () => {
    const { bytes, texto } = await generar(LARGO, "WEEKLY_REPORT", false, IDENTIDAD_DE_PRUEBA, "semanal-cliente");
    comprobarPlantilla(bytes, { tema: "cliente", documento: "Informe de estrategia", identidad: "Marta Ruiz Alonso" });
    expect(texto).not.toMatch(/Gemini|Google Search/);
  }, 30_000);

  test("diario, sin identidad guardada: sin membrete y sin asignación", async () => {
    const { bytes, texto } = await generar({ ...WEEKLY_REPORT_MOCK, assetAllocation: undefined }, "DAILY_REPORT", true, {}, "diario-sin-identidad");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Informe de estrategia", identidad: null });
    expect(texto).toContain("Informe diario");
    expect(texto).not.toContain("Asignación de activos");
  }, 30_000);

  test("los pesos de la asignación no están en el papel, y la fecha lleva el mes escrito", async () => {
    const { cadenas, hojas } = await generar(WEEKLY_REPORT_MOCK, "WEEKLY_REPORT", true, {});
    const asignacion = WEEKLY_REPORT_MOCK.assetAllocation!;
    for (const fila of asignacion.classes) {
      expect(cadenas).not.toContain(peso(fila.strategicWeight / 100)!);
      expect(cadenas).not.toContain(peso(fila.tacticalWeight / 100)!);
    }
    for (const fila of asignacion.regionsEquity) expect(cadenas).not.toContain(peso(fila.weight / 100)!);
    expect(hojas[0]).toMatch(/Informe semanal · 22 de junio de 2026/);
  }, 30_000);
});
