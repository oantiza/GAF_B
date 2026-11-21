// @vitest-environment happy-dom

/**
 * Calendario económico (auditoría de frontend, ACT-06 y DIR-09).
 * - ACT-06: los hechos del informe de estrategia solo traen el día; el servidor les pone las 09:00 de
 *   Madrid. En pantalla van sin hora y al final de su día, no a una hora inventada.
 * - DIR-09: «Est» y «Prev» son «Previsión» y «Anterior», las magnitudes de la fuente (K, M, B) se
 *   escriben en español, y la procedencia dice que los nombres de los eventos son los de la fuente.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ calendario: vi.fn() }));
vi.mock("../src/adapters/economicCalendarBackend", () => ({ fetchEconomicCalendar: mocks.calendario }));

import { EconomicCalendarPanel } from "../src/components/EconomicCalendarPanel";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  mocks.calendario.mockReset();
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

const pintar = async () => {
  await act(async () => { root!.render(<EconomicCalendarPanel />); });
  await act(async () => { await new Promise((listo) => setTimeout(listo, 0)); });
};
const filas = () => [...host.querySelectorAll(".economic-event-row")].map((fila) => ({
  hora: fila.querySelector(".economic-event-time")?.textContent,
  nombre: fila.querySelector(".economic-event-name")?.textContent
}));

test("ACT-06: un hecho del informe de estrategia va sin hora y al final de su día", async () => {
  /* La hora del primero es local del navegador: se construye así para que la prueba no dependa de la
     zona horaria en que corre. */
  const temprano = new Date(2026, 10, 13, 8, 30).toISOString();
  const tarde = new Date(2026, 10, 13, 16, 0).toISOString();
  mocks.calendario.mockResolvedValue({
    source: "STRATEGY_REPORT",
    count: 3,
    events: [
      { date: "2026-11-13T09:00:00+01:00", country: "EUR", type: "IPC de la eurozona", importance: "high", source: "STRATEGY_REPORT" },
      { date: tarde, country: "USD", type: "Ventas minoristas", importance: "medium", source: "FOREX_FACTORY" },
      { date: temprano, country: "USD", type: "Peticiones de desempleo", importance: "medium", source: "FOREX_FACTORY" }
    ]
  });
  await pintar();
  expect(filas()).toEqual([
    { hora: "08:30", nombre: "USDPeticiones de desempleo" },
    { hora: "16:00", nombre: "USDVentas minoristas" },
    { hora: "Sin hora", nombre: "EURIPC de la eurozona" }
  ]);
  expect(host.textContent).not.toContain("09:00");
});

test("ACT-06: una fecha que solo trae el día tampoco lleva hora", async () => {
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY",
    count: 1,
    events: [{ date: "2026-11-13", country: "EUR", type: "PIB", importance: "high" }]
  });
  await pintar();
  expect(filas()).toEqual([{ hora: "Sin hora", nombre: "EURPIB" }]);
});

test("DIR-09: «Previsión» y «Anterior», y las magnitudes de la fuente en español", async () => {
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY",
    count: 2,
    events: [
      { date: new Date(2026, 10, 13, 14, 30).toISOString(), country: "USD", type: "Federal Budget Balance", importance: "high", estimate: "80B", previous: "1080B" },
      { date: new Date(2026, 10, 13, 15, 0).toISOString(), country: "USD", type: "Non-Farm Employment Change", importance: "high", actual: "227K", estimate: "1.5M", previous: "-10.6%" }
    ]
  });
  await pintar();
  const valores = [...host.querySelectorAll(".economic-event-values")].map((nodo) => nodo.textContent);
  /* 80B = 80 × 1.000 millones = 80.000 M; 1080B = 1.080.000 M; 227K = 227 × 1.000 = 227.000;
     1.5M = 1,5 M; y una cifra sin magnitud sigue como hasta ahora (−10,6 %). */
  expect(valores).toEqual([
    "Previsión 80.000\u00a0MAnterior 1.080.000\u00a0M",
    "Real 227.000Previsión 1,5\u00a0MAnterior −10,6 %"
  ]);
  expect(host.textContent).not.toMatch(/\bEst\b|\bPrev\b/);
  /* Los nombres se quedan como los da la fuente, y se dice. */
  expect(host.textContent).toContain("Federal Budget Balance");
  expect(host.textContent).toContain("Los nombres de los eventos son los que da la fuente.");
});

test("DIR-09: la T de la fuente, el «trillion» inglés, es un billón español y se escribe en millones", async () => {
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY",
    count: 1,
    events: [{ date: new Date(2026, 10, 13, 0, 50).toISOString(), country: "JPY", type: "Trade Balance", importance: "low", estimate: "-0.90T", previous: "1.25T" }]
  });
  await pintar();
  const valores = [...host.querySelectorAll(".economic-event-values")].map((nodo) => nodo.textContent);
  /* 1 T = 1.000.000 de millones: −0,90 T = −900.000 M y 1,25 T = 1.250.000 M. */
  expect(valores).toEqual(["Previsión −900.000 MAnterior 1.250.000 M"]);
  expect(host.textContent).not.toMatch(/\d\s*T\b/);
});

test("hallazgo 25: la pantalla enseña el alcance y distingue los tres casos", async () => {
  /* 1. Hay eventos y el rango pasa del alcance: se dice hasta dónde llega la fuente. */
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY_JSON_LIVE", count: 1, status: "OK", covers_from: "2026-11-09", covers_to: "2026-11-15",
    note: "La fuente solo cubre hasta el domingo 15 de noviembre de 2026; lo posterior a esa fecha no se puede mostrar.",
    events: [{ date: new Date(2026, 10, 13, 14, 30).toISOString(), country: "USD", type: "PIB", importance: "high" }]
  });
  await pintar();
  expect(host.textContent).toContain("La fuente cubre hasta el");
  expect(host.textContent).toContain("solo cubre hasta el domingo 15 de noviembre de 2026");

  /* 2. Sin eventos en lo que la fuente cubre. */
  await act(async () => root?.unmount());
  clearSessionCaches();
  root = createRoot(host);
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY_JSON_LIVE", count: 0, status: "NO_EVENTS_IN_COVERAGE", events: [],
    note: "No hay eventos en lo que la fuente cubre."
  });
  await pintar();
  expect(host.textContent).toContain("Sin eventos");
  expect(host.textContent).toContain("No hay eventos en lo que la fuente cubre.");

  /* 3. La fuente no llega a ese rango: no es «no hay eventos». */
  await act(async () => root?.unmount());
  clearSessionCaches();
  root = createRoot(host);
  mocks.calendario.mockResolvedValue({
    source: "OUT_OF_SOURCE_RANGE", count: 0, status: "OUT_OF_SOURCE_RANGE", events: [],
    note: "El rango pedido cae fuera del alcance de la fuente, que solo cubre del lunes 9 al domingo 15."
  });
  await pintar();
  expect(host.textContent).toContain("Fuera del alcance de la fuente");
  expect(host.textContent).not.toContain("Sin eventos");
});

test("19-11-2026: cada fila cuelga de la única lista del calendario, que es el contenedor que la hoja declara", async () => {
  /* La hoja declara el contenedor en `.market-agenda-list` (`@container calendario`, en modules.css), y de su ancho
     depende que la fila vaya en una línea o en dos. Aquí no se evalúa esa consulta (happy-dom no lo hace): solo se
     garantiza que ninguna fila sale fuera de esa lista, donde se quedaría siempre en una línea. */
  mocks.calendario.mockResolvedValue({
    source: "FOREX_FACTORY",
    count: 2,
    events: [
      { date: new Date(2026, 10, 19, 14, 30).toISOString(), country: "USD", type: "FOMC Member Hammack Speaks", importance: "medium", source: "FOREX_FACTORY" },
      { date: new Date(2026, 10, 20, 8, 0).toISOString(), country: "EUR", type: "German Buba President Nagel Speaks", importance: "low", estimate: "0.9%", previous: "1.9%", source: "FOREX_FACTORY" }
    ]
  });
  await pintar();
  const todas = [...host.querySelectorAll(".economic-event-row")];
  expect(todas).toHaveLength(2);
  expect(todas.every((fila) => fila.closest(".market-agenda-list") !== null)).toBe(true);
  expect(host.querySelectorAll(".market-agenda-list")).toHaveLength(1);
});
