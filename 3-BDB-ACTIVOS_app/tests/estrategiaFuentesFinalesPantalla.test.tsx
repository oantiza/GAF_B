// @vitest-environment happy-dom

/**
 * Decisión 69 de Óscar (05-11-2026), en pantalla: la lista de fuentes enlaza a lo que el servidor guarda en `url`,
 * con el título de siempre, y sin enseñar lo que el servidor apunta para saber cuáles quedan por resolver.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../src/adapters/weeklyReportBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/weeklyReportBackend")>()),
  fetchWeeklyReportResult: vi.fn()
}));

import { fetchWeeklyReportResult, parseWeeklyReportResponse } from "../src/adapters/weeklyReportBackend";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

const GOOGLE = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";
const FUENTES = [
  { title: "europa.eu", url: "https://www.ecb.europa.eu/press/x.en.html", redirect_url: `${GOOGLE}AAA` },
  { title: "bls.gov", url: "https://www.bls.gov/cpi.htm", redirect_url: `${GOOGLE}BBB`, link_issue: "HTTP_403" },
  { title: "caducado.com", url: `${GOOGLE}CCC`, link_issue: "TIMEOUT" }
];

it("enlaza a la dirección final con el título de siempre y no enseña las marcas", async () => {
  vi.mocked(fetchWeeklyReportResult).mockResolvedValue(
    parseWeeklyReportResponse({
      source: "FIRESTORE_LIVE",
      freshness: "CURRENT",
      age_days: 0,
      invalid_count: 0,
      report: { ...WEEKLY_REPORT_MOCK, sources: FUENTES }
    })
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(StrategyPage));
    });
    const pestana = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Informe completo");
    expect(pestana).toBeDefined();
    await act(async () => {
      pestana!.click();
    });
    const enlaces = [...container.querySelectorAll(".strategy-sources a")];
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(FUENTES.map((f) => f.url));
    expect(enlaces.map((a) => a.textContent)).toEqual(FUENTES.map((f) => f.title));
    const texto = container.textContent ?? "";
    expect(texto).not.toMatch(/HTTP_403|TIMEOUT|redirect_url|link_issue|grounding-api-redirect/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});
