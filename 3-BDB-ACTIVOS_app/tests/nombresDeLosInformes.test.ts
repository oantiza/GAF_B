/**
 * ANA-19 e INF-25: el nombre del fichero de cada informe, con la convención común (`core/descargaDeFicheros.ts`). Cada uno lleva el
 * documento tal como lo imprime su cabecera, de quién o de qué es (el cliente; si no, la propuesta; el activo; «A frente a B») y la
 * fecha que imprime, o la de hoy si no imprime ninguna en ISO. Los nombres esperados están escritos a mano.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { nombreDelFicheroDeLaComparativa as nombreDeActivos } from "../src/reports/assetComparePdf";
import { nombreDelFicheroDeLaComparativa as nombreDePropuestas } from "../src/reports/comparePdf";
import { nombreDelFicheroDeCostes } from "../src/reports/costsPdf";
import { nombreDelFicheroDeLaFicha } from "../src/reports/fichaDeActivoPdf";
import { nombreDelFicheroDeLaMejora } from "../src/reports/improvementProposalPdf";
import { nombreDelFicheroDelInformeDeCliente } from "../src/reports/informeDeClientePdf";
import { nombreDelFicheroDelInterno } from "../src/reports/internalPortfolioReportPdf";
import { nombreDelFicheroDeLaJubilacion } from "../src/reports/jubilacionPdf";
import { nombreDelFicheroDeLaPropuesta } from "../src/reports/propuestaDeCambioPdf";
import { nombreDelFicheroDeLaEstrategia } from "../src/reports/weeklyReportPdf";
import { NOMBRE_DE_LA_PLANTILLA_CSV, NOMBRE_DE_LA_PLANTILLA_EXCEL } from "../src/gestor/ui/importar/plantilla";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";

/* El día de hoy, fijo: los documentos que imprimen la fecha de emisión la toman de él. */
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-14T12:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

const propuesta = (nombre: string) => ({ portfolio_name: nombre }) as unknown as BdbPortfolioReport;

describe("el nombre de cada informe", () => {
  test("informe de costes: el cliente, y sin él solo el documento y el día", () => {
    expect(nombreDelFicheroDeCostes({ clientName: "Familia García" })).toBe("Informe de costes - Familia García - 2026-11-14.pdf");
    expect(nombreDelFicheroDeCostes({})).toBe("Informe de costes - 2026-11-14.pdf");
  });

  test("informe de cartera: el cliente; sin él, la propuesta; y el día de quien lo genera", () => {
    expect(nombreDelFicheroDelInformeDeCliente({ clientName: "Familia García", report: propuesta("Prudente 2026"), generadoEn: "2026-11-10T12:00:00Z" }))
      .toBe("Informe de cartera - Familia García - 2026-11-10.pdf");
    expect(nombreDelFicheroDelInformeDeCliente({ clientName: "  ", report: propuesta("Prudente 2026") })).toBe("Informe de cartera - Prudente 2026 - 2026-11-14.pdf");
  });

  test("informe interno: la propuesta y el día de generación", () => {
    expect(nombreDelFicheroDelInterno({ report: propuesta("Propuesta España"), generatedAt: "2026-11-11T12:00:00Z" })).toBe("Informe interno del asesor - Propuesta España - 2026-11-11.pdf");
  });

  test("comparativa de propuestas: «A frente a B» y el día de emisión", () => {
    expect(nombreDePropuestas({ nameA: "Prudente", nameB: "Crecimiento / 2026" })).toBe("Comparativa de propuestas - Prudente frente a Crecimiento 2026 - 2026-11-14.pdf");
  });

  test("comparativa de activos: los dos primeros y cuántos más; el interno lo dice junto al documento", () => {
    const activos = (nombres: string[]) => nombres.map((name) => ({ name }));
    const generado = new Date("2026-11-12T12:00:00Z");
    expect(nombreDeActivos({ assets: activos(["Fondo Ñ", "Fondo B"]), salida: "cliente", generado })).toBe("Comparativa de activos - Fondo Ñ frente a Fondo B - 2026-11-12.pdf");
    expect(nombreDeActivos({ assets: activos(["Fondo Ñ", "Fondo B", "Fondo C", "Fondo D"]), salida: "interno", generado }))
      .toBe("Comparativa de activos (uso interno) - Fondo Ñ frente a Fondo B y 2 más - 2026-11-12.pdf");
  });

  test("ficha de activo: el nombre del activo (o su ISIN) y el día; la de la pantalla normal, de uso interno", () => {
    const generado = new Date("2026-11-09T12:00:00Z");
    expect(nombreDelFicheroDeLaFicha({ ficha: { nombre: "Fidelity Global Dividend A-Acc-EUR" }, isin: "LU1295551144", generado, modoCliente: true }))
      .toBe("Ficha de activo - Fidelity Global Dividend A-Acc-EUR - 2026-11-09.pdf");
    expect(nombreDelFicheroDeLaFicha({ ficha: { nombre: "" }, isin: "LU1295551144", generado, modoCliente: false }))
      .toBe("Ficha de activo (uso interno) - LU1295551144 - 2026-11-09.pdf");
  });

  test("propuesta de mejora: la cartera; la fecha escrita en palabras no es ISO, y va la de hoy", () => {
    expect(nombreDelFicheroDeLaMejora({ portfolioName: "Cartera Áurea", date: "13 de octubre de 2026" })).toBe("Propuesta de mejora - Cartera Áurea - 2026-11-14.pdf");
  });

  test("simulación de jubilación: el cliente, y si es un ejemplo, lo dice", () => {
    expect(nombreDelFicheroDeLaJubilacion({ clientName: "Familia García", ejemplo: false })).toBe("Simulación de jubilación - Familia García - 2026-11-14.pdf");
    expect(nombreDelFicheroDeLaJubilacion({ ejemplo: true })).toBe("Simulación de jubilación · ejemplo - 2026-11-14.pdf");
  });

  test("propuesta de cambio: el cliente o, sin él, la propuesta; y el día de emisión", () => {
    expect(nombreDelFicheroDeLaPropuesta({ cliente: "Familia García", nombrePropuesta: "Crecimiento", dia: "2026-11-05" })).toBe("Propuesta de cambio - Familia García - 2026-11-05.pdf");
    expect(nombreDelFicheroDeLaPropuesta({ cliente: "", nombrePropuesta: "Crecimiento", dia: "2026-11-05" })).toBe("Propuesta de cambio - Crecimiento - 2026-11-05.pdf");
  });

  test("informe de estrategia: semanal o diario, y el día del informe", () => {
    expect(nombreDelFicheroDeLaEstrategia({ date: "2026-11-13" }, "WEEKLY_REPORT")).toBe("Informe de estrategia - Semanal - 2026-11-13.pdf");
    expect(nombreDelFicheroDeLaEstrategia({ date: "2026-11-13" }, "DAILY_REPORT")).toBe("Informe de estrategia - Diario - 2026-11-13.pdf");
  });

  test("la plantilla de movimientos, que no es de nadie ni de ningún día", () => {
    expect(NOMBRE_DE_LA_PLANTILLA_CSV).toBe("Plantilla de movimientos.csv");
    expect(NOMBRE_DE_LA_PLANTILLA_EXCEL).toBe("Plantilla de movimientos.xlsx");
  });
});
