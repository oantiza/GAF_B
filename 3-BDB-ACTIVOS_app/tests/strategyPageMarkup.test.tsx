// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { fetchWeeklyReportResult } from "../src/adapters/weeklyReportBackend";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { StrategyPage } from "../src/pages/StrategyPage";

/**
 * Estrategia (auditoría 16-10-2026, MEDIA-12): el banner de error ofrece
 * «Reintentar» y vuelve a pedir el informe; la tabla de clases de activo lleva
 * su propio nombre (antes «Asignación de renta fija», copiado) y las cifras de los pesos estratégico
 * y táctico a la derecha con formato español («40 %», no «40%»).
 */
vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: vi.fn() }));

it("reintenta tras un error y pinta la tabla de clases con su nombre y cifras .num", async () => {
  vi.mocked(fetchWeeklyReportResult)
    .mockRejectedValueOnce(new Error("Servidor no disponible"))
    .mockResolvedValue({ report: WEEKLY_REPORT_MOCK, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  try {
    await act(async () => { root.render(createElement(StrategyPage)); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Servidor no disponible");
    const retry = button("Reintentar");
    expect(retry).toBeDefined();
    await act(async () => { retry!.click(); });
    expect(vi.mocked(fetchWeeklyReportResult)).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => { button("Semanal")!.click(); });
    await act(async () => { button("Asignación")!.click(); });
    /* Las tablas pasan por la pieza (03-11-2026): se nombran con un `<caption>` para
       lector de pantalla en vez de un `aria-label`, y la columna de cifras lleva la
       clase de la pieza. Lo que se comprueba es lo mismo. */
    const tabla = (nombre: string) => [...container.querySelectorAll("table.tabla")]
      .find((node) => node.querySelector("caption")?.textContent === nombre);
    const table = tabla("Clases de activo: estratégica, táctica y visión");
    expect(table).toBeDefined();
    // Cada tabla de regiones con su propio nombre (antes las dos «Asignación por región»).
    const labels = [...container.querySelectorAll("table.tabla caption")].map((node) => node.textContent);
    expect(labels).toContain("Renta Variable por región");
    expect(labels).toContain("Renta Fija por segmento");
    expect(new Set(labels).size).toBe(labels.length);
    expect(tabla("Asignación de renta fija")).toBeUndefined();
    const headers = [...table!.querySelectorAll("th")].slice(1, 3).map((th) => th.className);
    expect(headers).toEqual(["tabla__celda--cifra", "tabla__celda--cifra"]);
    /* Rediseño: el nombre de la clase encabeza su fila (`<th scope="row">`), así que las dos cifras son las dos primeras
       `<td>`; y un peso lleva un decimal, como en toda la aplicación (antes «45 %»). */
    const firstRow = [...table!.querySelectorAll("tbody tr:first-child td")].slice(0, 2);
    for (const cell of firstRow) {
      expect(cell.className).toBe("tabla__celda--cifra");
      expect(cell.textContent).toMatch(/^\d+,\d\s%$/);
    }
  } finally {
    await act(async () => { root.unmount(); }); container.remove();
    vi.unstubAllGlobals();
  }
});

/* Rediseño (paso 4): un peso se escribe siempre con un decimal (apartado 6 de SISTEMA_DISENO.md). Antes cada columna
   elegía sus decimales mirando sus filas, y la SAA salía «45 %» al lado de una TAA «45,0 %». */
it("un peso lleva un decimal en las dos columnas: la TAA de 42,5 y la SAA entera se escriben igual", async () => {
  const allocation = WEEKLY_REPORT_MOCK.assetAllocation!;
  const report = {
    ...WEEKLY_REPORT_MOCK,
    assetAllocation: {
      ...allocation,
      classes: allocation.classes.map((row, index) => (index === 1 ? { ...row, tacticalWeight: 42.5 } : row))
    }
  };
  vi.mocked(fetchWeeklyReportResult).mockReset().mockResolvedValue({ report, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  try {
    await act(async () => { root.render(createElement(StrategyPage)); });
    await act(async () => { button("Semanal")!.click(); });
    await act(async () => { button("Asignación")!.click(); });
    const table = [...container.querySelectorAll("table.tabla")]
      .find((node) => node.querySelector("caption")?.textContent === "Clases de activo: estratégica, táctica y visión")!;
    const column = (index: number) =>
      [...table.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[index].textContent?.replace(/\s/g, " "));
    expect(column(0)).toEqual(["45,0 %", "40,0 %", "5,0 %", "10,0 %"]);
    expect(column(1)).toEqual(["45,0 %", "42,5 %", "8,0 %", "5,0 %"]);
  } finally {
    await act(async () => { root.unmount(); }); container.remove();
    vi.unstubAllGlobals();
  }
});

/* Decisión de Óscar (15-11-2026): los pesos de la asignación los escribe el modelo; en pantalla se quedan, rotulados una
   sola vez para toda la pestaña, y lo mismo en Modo cliente (el rótulo no depende del modo). */
it.each([[false], [true]])("la pestaña de asignación lleva una vez el rótulo de escenario del modelo (Modo cliente: %s)", async (modoCliente) => {
  vi.mocked(fetchWeeklyReportResult).mockReset().mockResolvedValue({ report: WEEKLY_REPORT_MOCK, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  try {
    await act(async () => { root.render(createElement(ClientModeProvider, { initialValue: modoCliente }, createElement(StrategyPage))); });
    await act(async () => { button("Semanal")!.click(); });
    await act(async () => { button("Asignación")!.click(); });
    const avisos = [...container.querySelectorAll(".aviso")].filter((n) => n.textContent?.includes("Escenario del modelo"));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].textContent).toContain("Estos pesos los propone el modelo de IA que redacta el informe. No salen de un cálculo ni de una decisión de la casa.");
    /* Gobierna el bloque entero: va antes que cualquier tabla o gráfico de pesos. */
    expect(avisos[0].compareDocumentPosition(container.querySelector("table.tabla")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Y no aparece en otra vista del informe. */
    await act(async () => { button("Resumen")?.click(); });
    expect([...container.querySelectorAll(".aviso")].some((n) => n.textContent?.includes("Escenario del modelo"))).toBe(false);
  } finally {
    await act(async () => { root.unmount(); }); container.remove();
    vi.unstubAllGlobals();
  }
});
