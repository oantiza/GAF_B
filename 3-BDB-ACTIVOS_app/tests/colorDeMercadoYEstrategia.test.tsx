// @vitest-environment happy-dom
/**
 * El color de Mercado y Estrategia (14-11-2026, Óscar: «le faltan colores en general… dale más vida»). Recupera lo que el
 * rediseño «Informe vivo» había dejado en gris, sin perder ningún dato:
 *
 * - G2: Estrategia → Asignación vuelve a los dos aros (renta variable por región, renta fija por segmento), con sus cifras
 *   en la leyenda.
 * - G7: la visión del comité lleva el color de su sentido: «Positiva» en verde, «Negativa» en rojo, «Neutral» en gris.
 * - G6: el impacto de un evento del calendario lleva tono, nunca verde ni rojo: «Alto» en ocre (pide atención), «Medio» en
 *   índigo, «Bajo» y «Sin nivel» en gris. Siempre con su palabra.
 * - D6: cada publicación de resultados dice cuántas hay ese día.
 */
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ informe: vi.fn(), calendario: vi.fn(), resultados: vi.fn() }));
vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: mocks.informe, publishStrategyReport: vi.fn() }));
vi.mock("../src/adapters/economicCalendarBackend", () => ({ fetchEconomicCalendar: mocks.calendario }));
vi.mock("../src/adapters/earningsCalendarBackend", () => ({ fetchEarningsCalendar: mocks.resultados }));

import { columnasDeSegmentos, type FilaDeSegmento } from "../src/adapters/tablaDeEstrategia";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { pesoDelGrafico } from "../src/charts/oaa/chartFormatters";
import { EarningsPanel } from "../src/components/EarningsPanel";
import { EconomicCalendarPanel } from "../src/components/EconomicCalendarPanel";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { regionDeEstrategia } from "../src/core/textoDeEstrategia";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  mocks.informe.mockReset();
  mocks.calendario.mockReset();
  mocks.resultados.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const pintar = async (nodo: React.ReactNode) => {
  await act(async () => {
    root!.render(<ClientModeProvider initialValue={false}>{nodo}</ClientModeProvider>);
  });
  await act(async () => {
    await new Promise((listo) => setTimeout(listo, 0));
  });
};
const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
/** El bloque cuyo título es `titulo`: la sección que lo encabeza. */
const bloque = (titulo: string) =>
  [...host.querySelectorAll("section")].find((s) => s.querySelector("h1, h2, h3, h4")?.textContent?.trim() === titulo);

describe("Estrategia", () => {
  test("G7: la visión del comité, con el color de su sentido y su palabra escrita", () => {
    const fila = (vision: FilaDeSegmento["vision"]): FilaDeSegmento => ({ id: vision, nombre: "Europa", peso: 20, vision });
    const columna = columnasDeSegmentos([], { columnaDelNombre: "Zona", columnaDelPeso: "Peso" }).find((c) => c.id === "vision")!;
    const pinta = (vision: FilaDeSegmento["vision"]) => renderToStaticMarkup(<>{columna.celda(fila(vision)).nodo}</>);
    expect(pinta("Positiva")).toBe('<span class="distintivo distintivo--favorable">Positiva</span>');
    expect(pinta("Negativa")).toBe('<span class="distintivo distintivo--desfavorable">Negativa</span>');
    expect(pinta("Neutral")).toBe('<span class="distintivo distintivo--neutro">Neutral</span>');
    /* La columna se sigue ordenando por la palabra. */
    expect(columna.celda(fila("Positiva")).valor).toBe("Positiva");
  });

  test("G2 y G7 en pantalla: los dos aros con sus cifras en la leyenda, y las tablas con la visión en color", async () => {
    mocks.informe.mockResolvedValue({ report: WEEKLY_REPORT_MOCK, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
    await pintar(<StrategyPage />);
    await act(async () => boton("Semanal")!.click());
    await act(async () => boton("Asignación")!.click());

    const asignacion = WEEKLY_REPORT_MOCK.assetAllocation!;
    const casos: Array<[string, Array<{ region: string; weight: number }>, (region: string) => string]> = [
      ["Renta variable", asignacion.regionsEquity, regionDeEstrategia],
      ["Renta fija", asignacion.regionsFixedIncome ?? [], (region) => region]
    ];
    for (const [titulo, filas, nombre] of casos) {
      const panel = bloque(titulo);
      expect(panel, `el bloque «${titulo}»`).toBeDefined();
      /* Un aro, no una lista de barras. */
      expect(panel!.querySelector(".oaa-donut-layout")).not.toBeNull();
      expect(panel!.querySelector("ul.partes")).toBeNull();
      /* Las cifras siguen escritas: cada parte con su peso en la leyenda. */
      const leyenda = panel!.querySelector(".oaa-chart-legend")!.textContent ?? "";
      for (const fila of filas) {
        expect(leyenda).toContain(nombre(fila.region));
        expect(leyenda).toContain(pesoDelGrafico(fila.weight));
      }
    }

    /* La visión en las tres tablas de la asignación: cada palabra con su tono. */
    const distintivos = [...host.querySelectorAll("table.tabla .distintivo")];
    expect(distintivos.length).toBeGreaterThan(0);
    for (const distintivo of distintivos) {
      const tono = { Positiva: "distintivo--favorable", Negativa: "distintivo--desfavorable", Neutral: "distintivo--neutro" }[
        distintivo.textContent as "Positiva" | "Negativa" | "Neutral"
      ];
      expect(tono, `una visión que no es ninguna de las tres: ${distintivo.textContent}`).toBeDefined();
      expect(distintivo.classList.contains(tono)).toBe(true);
    }
    expect(distintivos.some((d) => d.classList.contains("distintivo--favorable"))).toBe(true);
    expect(distintivos.some((d) => d.classList.contains("distintivo--desfavorable"))).toBe(true);
  });
});

describe("Mercado", () => {
  test("G6: el impacto lleva tono y palabra, nunca el verde ni el rojo del signo", async () => {
    mocks.calendario.mockResolvedValue({
      source: "FOREX_FACTORY",
      count: 4,
      events: [
        { date: "2026-11-16", country: "EUR", type: "IPC", importance: "high" },
        { date: "2026-11-16", country: "USD", type: "Ventas minoristas", importance: "medium" },
        { date: "2026-11-16", country: "USD", type: "Inventarios", importance: "low" },
        { date: "2026-11-16", country: "JPY", type: "Discurso", importance: null }
      ]
    });
    await pintar(<EconomicCalendarPanel />);
    const impactos = [...host.querySelectorAll(".economic-event-row .distintivo")].map((d) => [d.textContent, d.className]);
    expect(impactos).toEqual(
      expect.arrayContaining([
        ["Alto", "distintivo distintivo--aviso"],
        ["Medio", "distintivo distintivo--marca"],
        ["Bajo", "distintivo distintivo--neutro"],
        ["Sin nivel", "distintivo distintivo--neutro"]
      ])
    );
    expect(impactos).toHaveLength(4);
    expect(host.querySelector(".economic-event-row .distintivo--favorable, .economic-event-row .distintivo--desfavorable")).toBeNull();
  });

  test("D6: cada publicación dice cuántas hay ese día, y la tabla se sigue ordenando por columna", async () => {
    mocks.resultados.mockResolvedValue({
      source: "YAHOO_LIVE",
      from: "2026-11-04",
      to: "2026-12-19",
      count: 3,
      items: [
        { code: "AMS.MC", name: "Amadeus", report_date: "2026-11-06", eps_estimate: 0.924, eps_actual: null, eps_surprise_pct: null },
        { code: "ITX.MC", name: "Inditex", report_date: "2026-11-06", eps_estimate: 0.5, eps_actual: null, eps_surprise_pct: null },
        { code: "CLNX.MC", name: "Cellnex", report_date: "2026-11-05", eps_estimate: null, eps_actual: null, eps_surprise_pct: null }
      ]
    });
    await pintar(<EarningsPanel />);
    const apunteDeLaFecha = (valor: string) =>
      [...host.querySelectorAll("tbody tr")]
        .find((tr) => tr.textContent?.includes(valor))!
        .querySelector("td")!.textContent ?? "";
    expect(apunteDeLaFecha("Cellnex")).toContain("1 publicación ese día");
    expect(apunteDeLaFecha("Amadeus")).toContain("2 publicaciones ese día");
    expect(apunteDeLaFecha("Inditex")).toContain("2 publicaciones ese día");
    /* No se agrupa: los títulos de columna siguen siendo botones que ordenan. */
    expect(host.querySelector("thead th button")).not.toBeNull();
  });
});
