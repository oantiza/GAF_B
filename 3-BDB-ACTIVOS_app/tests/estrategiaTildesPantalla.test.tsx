// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { fetchWeeklyReportResult } from "../src/adapters/weeklyReportBackend";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

/** Un informe guardado con el prompt antiguo (títulos y región sin tilde) se pinta con tilde, y la pantalla no usa SAA ni TAA. */
vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: vi.fn() }));

it("pinta con tilde los cuatro títulos y Japón, y dice «Estratégica» y «Táctica» en vez de SAA y TAA", async () => {
  const guardado = {
    ...WEEKLY_REPORT_MOCK,
    fullReport: {
      narrative: "### Macroeconomia y geopolitica\n\nUno.\n\n### Escenarios estrategicos\n\nDos.\n\n### Valoraciones y mercados\n\nTres.\n\n### Posicionamiento y conclusiones\n\nCuatro."
    },
    assetAllocation: {
      ...WEEKLY_REPORT_MOCK.assetAllocation!,
      regionsEquity: WEEKLY_REPORT_MOCK.assetAllocation!.regionsEquity.map((row) => (row.region === "Japón" ? { ...row, region: "Japon" } : row))
    }
  };
  vi.mocked(fetchWeeklyReportResult).mockReset().mockResolvedValue({ report: guardado, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  try {
    await act(async () => { root.render(createElement(StrategyPage)); });
    await act(async () => { button("Semanal")!.click(); });
    /* En español llano: los hechos de la semana, no sus «drivers» (14-11-2026). */
    const bloques = [...container.querySelectorAll(".panel__title")].map((titulo) => titulo.textContent ?? "");
    expect(bloques).toContain("Hechos de la semana");
    expect(bloques.filter((titulo) => /driver/i.test(titulo))).toEqual([]);
    await act(async () => { button("Asignación")!.click(); });
    const asignacion = container.textContent ?? "";
    expect(asignacion).not.toMatch(/SAA|TAA/);
    expect(asignacion).toContain("Estratégica frente a táctica");
    expect(asignacion).toContain("Japón");
    expect(asignacion).not.toContain("Japon");
    const cabeceras = [...container.querySelectorAll("table.tabla th")].map((th) => th.textContent);
    expect(cabeceras).toContain("Estratégica");
    expect(cabeceras).toContain("Táctica");

    await act(async () => { button("Informe completo")!.click(); });
    /* El informe es un bloque (su título, `h2` desde MAR-32) y las secciones de su texto van justo debajo: `h3`. */
    const titulos = [...container.querySelectorAll(".strategy-document .prose h3")].map((h) => h.textContent);
    expect(titulos).toEqual(expect.arrayContaining(["Macroeconomía y geopolítica", "Escenarios estratégicos", "Valoraciones y mercados", "Posicionamiento y conclusiones"]));
    expect(container.textContent).not.toContain("Macroeconomia");
  } finally {
    await act(async () => { root.unmount(); }); container.remove();
    vi.unstubAllGlobals();
  }
});
