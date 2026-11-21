// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
import { CostsModal } from "../src/components/CostsModal";
import { useIdentidadDelInforme } from "../src/core/identidadDelInforme";
import { improvementFingerprint } from "../src/core/improvementResultStore";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";

const mocks = vi.hoisted(() => ({ download: vi.fn(async () => {}) }));
vi.mock("../src/reports/costsPdf", () => ({ downloadCostsPdf: mocks.download }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: async () => new Map(), saveCommercialRetro: vi.fn(), assetCommercialRetroKey: () => null
}));

test("el botón exporta los costes y la comisión actual; nunca envía datos de retrocesiones", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await act(async () => document.querySelector<HTMLInputElement>('.costs-management-section input[type="checkbox"]')!.click());
    await act(async () => {
      const input = document.querySelector('.costs-management-controls input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Descargar el informe")!;
    await act(async () => button.click());
    expect(mocks.download).toHaveBeenCalledTimes(1);
    const payload = mocks.download.mock.calls[0] as unknown as [{ costs: { totalCostEur: number }; management: object }];
    expect(payload[0].management).toEqual({ enabled: true, unit: "percent", input: "0.5" });
    expect(payload[0].costs.totalCostEur).toBeCloseTo(1758.264827586207);
    /* Decisión B-78: las posiciones con la serie parada viajan aparte; aquí, sin base nueva a la que preguntar, ninguna. */
    expect(Object.keys(payload[0]).sort()).toEqual(["clientName", "costs", "management", "seriesParadas"]);
    expect((payload[0] as unknown as { seriesParadas: ReadonlyMap<string, string> }).seriesParadas.size).toBe(0);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

test("sin capital, al papel no llega ningún capital ni ningún euro, y lo escrito en Informes como cliente, sí", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.download.mockClear();
  clearSessionCaches();
  const huella = improvementFingerprint(costPositions);
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  try {
    let ponerNombre: (nombre: string) => void = () => undefined;
    function Puerta() {
      const { setClientName } = useIdentidadDelInforme(huella);
      ponerNombre = setClientName;
      return null;
    }
    await act(async () => root.render(<Puerta />));
    await act(async () => ponerNombre("  Ana Ruiz "));
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} onClose={() => {}} />));
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Descargar el informe")!;
    await act(async () => button.click());
    const payload = mocks.download.mock.calls[0] as unknown as [{ clientName: string; costs: { totalCapital: number | null; totalCostEur: number | null; avgCostPct: number | null } }];
    expect(payload[0].clientName).toBe("Ana Ruiz");
    expect(payload[0].costs.totalCapital).toBeNull();
    expect(payload[0].costs.totalCostEur).toBeNull();
    expect(payload[0].costs.avgCostPct).toBeCloseTo(0.01758264827586207);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

test("quien lo elabora llega al papel si la pantalla lo sabe", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.download.mockClear();
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} responsable={{ name: "Marta Gil", email: "marta@ejemplo.invalid" }} onClose={() => {}} />));
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Descargar el informe")!;
    await act(async () => button.click());
    const payload = mocks.download.mock.calls[0] as unknown as [{ banker: { name: string; email: string } }];
    expect(payload[0].banker).toEqual({ name: "Marta Gil", email: "marta@ejemplo.invalid" });
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

test("Informes le pasa a CostsModal quien lo elabora; Diseño de cartera no lo sabe y no se lo inventa", () => {
  const leer = (fichero: string) => readFileSync(`src/components/${fichero}`, "utf8");
  expect(leer("PortfolioReport.tsx")).toMatch(/<CostsModal[^\n]*responsable=\{\{ name: bankerName, email: bankerEmail \}\}/);
  expect(leer("PortfolioBuilder.tsx")).not.toContain("useResponsableDelInforme");
});
