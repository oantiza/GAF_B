// @vitest-environment happy-dom

/**
 * Estrategia (auditoría de frontend, ACT-03 y ACT-20).
 * - ACT-03: al cambiar entre Diario y Semanal, mientras llega el nuevo no se enseña el anterior bajo el
 *   título nuevo, y «Descargar PDF» y «Compartir con cliente» quedan desactivados.
 * - ACT-20: dos hechos iguales no dan claves repetidas; la renta fija sin desglose no dice «N/D
 *   segmentos»; y «Publicar el de hoy» pide confirmación antes de lanzar la redacción.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: vi.fn(), publishStrategyReport: vi.fn() }));
vi.mock("../src/auth/useIsAdmin", () => ({ useIsAdmin: () => true }));

import { fetchWeeklyReportResult, publishStrategyReport, type WeeklyReportResponse } from "../src/adapters/weeklyReportBackend";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(fetchWeeklyReportResult).mockReset();
  vi.mocked(publishStrategyReport).mockReset().mockResolvedValue({ status: "PUBLISHED", reportId: "daily-2026-07-10", forced: false, replacedDate: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respuesta = (report: WeeklyReportResponse["report"]): WeeklyReportResponse => ({
  report,
  source: "test",
  freshness: "CURRENT",
  age_days: 0,
  invalid_count: 0
});
const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

test("ACT-03: al pasar a Semanal, mientras carga no se ve el diario y el PDF y compartir quedan desactivados", async () => {
  const diario = { ...WEEKLY_REPORT_MOCK, summary: { ...WEEKLY_REPORT_MOCK.summary, headline: "Titular del diario" } };
  let resolverSemanal: (valor: WeeklyReportResponse) => void = () => undefined;
  vi.mocked(fetchWeeklyReportResult)
    .mockResolvedValueOnce(respuesta(diario))
    .mockImplementationOnce(() => new Promise((resolve) => { resolverSemanal = resolve; }));
  await act(async () => { root!.render(<StrategyPage embedded />); });
  expect(host.textContent).toContain("Titular del diario");
  expect(boton("Descargar el informe")!.disabled).toBe(false);

  await act(async () => boton("Semanal")!.click());
  expect(host.textContent).toContain("Estrategia semanal");
  expect(host.textContent).not.toContain("Titular del diario");
  expect(host.querySelector(".strategy-view")?.children.length).toBe(0);
  expect(boton("Descargar el informe")!.disabled).toBe(true);
  expect(boton("Compartir con cliente")!.disabled).toBe(true);

  const semanal = { ...WEEKLY_REPORT_MOCK, summary: { ...WEEKLY_REPORT_MOCK.summary, headline: "Titular del semanal" } };
  await act(async () => { resolverSemanal(respuesta(semanal)); });
  expect(host.textContent).toContain("Titular del semanal");
  expect(boton("Descargar el informe")!.disabled).toBe(false);
});

test("ACT-20: dos hechos o dos riesgos iguales no dan claves repetidas", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const informe = {
    ...WEEKLY_REPORT_MOCK,
    summary: {
      ...WEEKLY_REPORT_MOCK.summary,
      keyEvents: ["La Fed mantiene tipos", "La Fed mantiene tipos"],
      tailRisks: [
        { risk: "Repunte de la inflación", probability: "Media", impact: "Alto" },
        { risk: "Repunte de la inflación", probability: "Media", impact: "Alto" }
      ]
    }
  } as typeof WEEKLY_REPORT_MOCK;
  vi.mocked(fetchWeeklyReportResult).mockResolvedValue(respuesta(informe));
  await act(async () => { root!.render(<StrategyPage embedded />); });
  await act(async () => boton("Informe completo")!.click());
  const claves = error.mock.calls.filter((llamada) => String(llamada[0]).includes("same key"));
  expect(claves).toEqual([]);
});

test("ACT-20: la renta fija sin desglose no dice «N/D segmentos»", async () => {
  const allocation = WEEKLY_REPORT_MOCK.assetAllocation!;
  const informe = { ...WEEKLY_REPORT_MOCK, assetAllocation: { ...allocation, regionsFixedIncome: [] } };
  vi.mocked(fetchWeeklyReportResult).mockResolvedValue(respuesta(informe));
  await act(async () => { root!.render(<StrategyPage embedded />); });
  await act(async () => boton("Semanal")!.click());
  await act(async () => boton("Asignación")!.click());
  expect(host.textContent).not.toContain("N/D");
  expect(host.textContent).toContain("Sin desglose");
});

test("ACT-20: «Publicar el de hoy» pide confirmación y no publica si se cancela", async () => {
  vi.mocked(fetchWeeklyReportResult).mockResolvedValue(respuesta(WEEKLY_REPORT_MOCK));
  await act(async () => { root!.render(<StrategyPage embedded />); });
  await act(async () => boton("Publicar el de hoy")!.click());
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(publishStrategyReport).not.toHaveBeenCalled();
  await act(async () => boton("Cancelar")!.click());
  expect(publishStrategyReport).not.toHaveBeenCalled();

  await act(async () => boton("Publicar el de hoy")!.click());
  await act(async () => boton("Publicar")!.click());
  expect(publishStrategyReport).toHaveBeenCalledWith("DAILY_REPORT", {});
});
