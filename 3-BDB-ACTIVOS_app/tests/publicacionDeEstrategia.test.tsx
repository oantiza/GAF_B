// @vitest-environment happy-dom

/**
 * Publicación a mano del informe de estrategia (15-11-2026).
 * - El adaptador devuelve lo que contesta `admin_publish_report`, validado como contrato, y solo manda `force` si se
 *   pide.
 * - La pantalla dice lo que pasó en cada caso, solo recarga con un informe nuevo, y ofrece forzar únicamente cuando
 *   tiene sentido: «Regenerar el informe de hoy» si ya había uno, «Reintentar» con los intentos agotados.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const callBackend = vi.fn();
vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }));
vi.mock("../src/auth/useIsAdmin", () => ({ useIsAdmin: () => true }));

import * as backend from "../src/adapters/weeklyReportBackend";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

const { parseStrategyPublicationResult, publishStrategyReport } = backend;

describe("adaptador", () => {
  beforeEach(() => callBackend.mockReset());

  test("devuelve el estado que contesta el servidor", async () => {
    callBackend.mockResolvedValue({ status: "ALREADY_PUBLISHED", report_id: "daily-2026-11-15", type: "DAILY_REPORT" });
    await expect(publishStrategyReport("DAILY_REPORT")).resolves.toEqual({
      status: "ALREADY_PUBLISHED", reportId: "daily-2026-11-15", forced: false, replacedDate: null
    });
    expect(callBackend.mock.calls[0][0]).toBe("admin_publish_report");
    expect(callBackend.mock.calls[0][1]).toEqual({ type: "DAILY_REPORT" });
  });

  test("solo manda force cuando se pide, y lee el informe sustituido", async () => {
    callBackend.mockResolvedValue({
      status: "PUBLISHED", report_id: "weekly-2026-11-09", forced: true,
      replaced: { report_id: "weekly-2026-11-09", date: "2026-11-09T07:15:00Z" }
    });
    const result = await publishStrategyReport("WEEKLY_REPORT", { force: true });
    expect(callBackend.mock.calls[0][1]).toEqual({ type: "WEEKLY_REPORT", force: true });
    expect(result).toMatchObject({ status: "PUBLISHED", forced: true, replacedDate: "2026-11-09T07:15:00Z" });
  });

  test("un estado desconocido o una respuesta vacía no pasan por buenos", () => {
    expect(() => parseStrategyPublicationResult({ status: "OK", report_id: "x" })).toThrow(/status/);
    expect(() => parseStrategyPublicationResult(undefined)).toThrow();
    expect(() => parseStrategyPublicationResult({ status: "PUBLISHED" })).toThrow(/report_id/);
  });
});

describe("pantalla", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  let publish: ReturnType<typeof vi.spyOn>;
  let fetchReport: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchReport = vi.spyOn(backend, "fetchWeeklyReportResult").mockResolvedValue({
      report: WEEKLY_REPORT_MOCK, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0
    });
    publish = vi.spyOn(backend, "publishStrategyReport");
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

  const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  const resultado = (status: backend.StrategyPublicationStatus, extra: Partial<backend.StrategyPublicationResult> = {}) =>
    ({ status, reportId: "daily-2026-11-15", forced: false, replacedDate: null, ...extra });

  async function publicar(confirmar = "Publicar") {
    await act(async () => { root!.render(<StrategyPage embedded />); });
    await act(async () => boton("Publicar el de hoy")!.click());
    await act(async () => boton(confirmar)!.click());
  }

  test("publicado: lo dice y recarga el informe", async () => {
    publish.mockResolvedValue(resultado("PUBLISHED"));
    await publicar();
    expect(host.textContent).toContain("Informe publicado.");
    expect(fetchReport).toHaveBeenCalledTimes(2);
    expect(boton("Reintentar")).toBeUndefined();
    expect(boton("Regenerar el informe de hoy")).toBeUndefined();
  });

  test("ya había uno: no recarga y ofrece regenerarlo, aparte y con su confirmación", async () => {
    publish.mockResolvedValueOnce(resultado("ALREADY_PUBLISHED"));
    await publicar();
    expect(host.textContent).toContain("Ya había un informe de hoy.");
    expect(host.textContent).not.toContain("Informe publicado.");
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith("DAILY_REPORT", {});

    publish.mockResolvedValueOnce(resultado("PUBLISHED", { forced: true, replacedDate: "2026-11-15T07:00:00Z" }));
    await act(async () => boton("Regenerar el informe de hoy")!.click());
    expect(document.body.textContent).toContain("sustituye al que está publicado hoy");
    await act(async () => boton("Regenerar")!.click());
    expect(publish).toHaveBeenLastCalledWith("DAILY_REPORT", { force: true });
    expect(host.textContent).toContain("Informe regenerado.");
    expect(fetchReport).toHaveBeenCalledTimes(2);
  });

  test("en curso: lo dice y no ofrece forzar", async () => {
    publish.mockResolvedValue(resultado("IN_PROGRESS"));
    await publicar();
    expect(host.textContent).toContain("Hay otra publicación en curso.");
    expect(boton("Reintentar")).toBeUndefined();
    expect(boton("Regenerar el informe de hoy")).toBeUndefined();
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  test("intentos agotados: lo dice y ofrece un intento más", async () => {
    publish.mockResolvedValueOnce(resultado("ATTEMPTS_EXHAUSTED"));
    await publicar();
    expect(host.textContent).toContain("Intentos agotados.");
    // Puede haber sido un cuarto intento forzado: el texto no dice cuántos fueron.
    expect(host.textContent).toContain("Los intentos de hoy fallaron");
    expect(host.textContent).not.toMatch(/tres intentos/i);
    expect(fetchReport).toHaveBeenCalledTimes(1);
    publish.mockResolvedValueOnce(resultado("PUBLISHED", { forced: true }));
    await act(async () => boton("Reintentar")!.click());
    await act(async () => [...document.body.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === "Reintentar")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(publish).toHaveBeenLastCalledWith("DAILY_REPORT", { force: true });
    expect(host.textContent).toContain("Informe publicado.");
  });

  test("error: sale el aviso de error y no se da por publicado", async () => {
    const { AppError } = await import("../src/core/appError");
    publish.mockRejectedValue(new AppError("BACKEND", "No se pudo generar o guardar el informe."));
    await publicar();
    expect(host.textContent).toContain("No se pudo generar o guardar el informe.");
    expect(host.textContent).not.toContain("Informe publicado.");
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });
});
