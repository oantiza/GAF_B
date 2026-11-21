// @vitest-environment happy-dom
/**
 * Comparador → Propuestas: la diferencia B − A vuelve a ir en verde si B mejora y en rojo si empeora, según el sentido de cada cifra
 * (más rentabilidad y más Sharpe, mejor; menos volatilidad y una caída más cerca de cero, mejor), y en la composición por clase cada clase
 * lleva el punto de su color fijo (14-11-2026, Óscar: recuperar el color de antes del rediseño). El montaje es el de
 * `portfolioComparator.test.tsx`. Las cifras salen de dos series sintéticas: lo esperado se deduce aquí de las dos cifras escritas en la
 * misma fila, con la regla de cada métrica, no de la función que pinta.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
import { PortfolioComparator } from "../src/components/PortfolioComparator";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { comparisonFixture, comparisonPortfolios, comparisonAssets } from "./support/portfolioComparisonFixtures";
import type { ComparisonPeriod } from "../src/core/portfolioComparison";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { AssetDataSourceKind } from "../src/types/assetDataSource";

const mocks = vi.hoisted(() => ({ list: vi.fn(), assets: vi.fn(), history: vi.fn(), pdf: vi.fn(), local: vi.fn() }));
vi.mock("../src/adapters/portfolioBackend", () => ({ backendListPortfolios: mocks.list, usesBackendPersistence: (kind: string) => kind === "BBDD_LIVE_API" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: mocks.assets }) }));
vi.mock("../src/adapters/portfolioComparisonHistory", () => ({ fetchComparisonHistory: mocks.history }));
vi.mock("../src/core/localPortfolioStorage", () => ({ readLocalPortfoliosFromStorage: mocks.local }));
vi.mock("../src/reports/comparePdf", () => ({ downloadComparisonPdf: mocks.pdf }));
vi.mock("../src/charts/oaa", () => ({
  OaaLineChart: (props: unknown) => <div data-testid="history" data-chart={JSON.stringify(props)} />,
  OaaRiskReturnChart: (props: unknown) => <div data-testid="risk" data-chart={JSON.stringify(props)} />,
  OaaLegend: () => null
}));
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  /* La elección y el periodo se conservan en la sesión: sin esto, cada prueba hereda la anterior. */
  clearSessionCaches();
  mocks.list.mockResolvedValue(comparisonPortfolios);
  mocks.assets.mockResolvedValue(comparisonAssets);
  mocks.local.mockReturnValue(comparisonPortfolios.map((p) => ({ ...p, sourceKind: "LOCAL_MOCK" })));
  mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => comparisonFixture(period, positions[0].asset_id));
  mocks.pdf.mockResolvedValue(undefined);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function mount(kind: AssetDataSourceKind = "BBDD_LIVE_API") { await act(async () => root.render(<PortfolioComparator sourceKind={kind} />)); }
async function select(index: number, value: string) { await act(async () => { const field = document.querySelectorAll("select")[index]; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function click(label: string) { const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label); if (!button) throw new Error(label); await act(async () => button.click()); }
async function choose() { await select(0, "Alfa"); await select(1, "Beta"); }


/** «+8,24 %», «−0,26», «1,01» → número. */
const cifra = (texto: string) => Number(texto.replace(/[^0-9,+−-]/g, "").replace("−", "-").replace(",", "."));
const sentidos: Record<string, "mas" | "menos" | "menosProfunda"> = {
  "Rentabilidad acumulada": "mas",
  "Rentabilidad anualizada": "mas",
  "Volatilidad anual": "menos",
  Sharpe: "mas",
  "Caída máxima": "menosProfunda"
};

describe("Comparador → Propuestas: mejora y empeora, en verde y rojo (G10)", () => {
  test("cada diferencia B − A en el color que le toca por las dos cifras de su fila; el signo escrito no cambia", async () => {
    await mount(); await choose();
    const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].filter((fila) => (fila.firstElementChild?.textContent ?? "") in sentidos);
    expect(filas).toHaveLength(5);
    let conColor = 0;
    for (const fila of filas) {
      const [rotulo, a, b, diferencia] = [...fila.children].map((celda) => celda.textContent ?? "");
      const [va, vb] = [cifra(a), cifra(b)];
      const sentido = sentidos[rotulo];
      const mejora = sentido === "mas" ? vb > va : sentido === "menos" ? vb < va : Math.abs(vb) < Math.abs(va);
      const marca = fila.lastElementChild!.querySelector(".cifra")!;
      const color = marca.classList.contains("cifra--sube") ? "verde" : marca.classList.contains("cifra--baja") ? "rojo" : "tinta";
      if (va === vb) {
        expect(color, rotulo).toBe("tinta");
      } else {
        expect(color, rotulo).toBe(mejora ? "verde" : "rojo");
        conColor += 1;
      }
      /* El signo escrito es el de B − A, mejore o empeore. */
      expect(diferencia.startsWith(vb > va ? "+" : vb < va ? "−" : ""), rotulo).toBe(true);
    }
    expect(conColor).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("En verde, lo que mejora; en rojo, lo que empeora.");
  });
});

describe("Comparador → Propuestas: la composición por clase con el color de cada clase (7d)", () => {
  test("por clase, el punto de su color delante del nombre; por categoría, sin punto", async () => {
    await mount(); await choose();
    expect(document.querySelector(".pcmp-allocations .clase-con-color")).toBeNull();
    await click("Clase");
    const clases = [...document.querySelectorAll(".pcmp-allocations .clase-con-color")].map((clase) => clase.textContent);
    expect(clases).toEqual(expect.arrayContaining(["Renta variable", "Monetario"]));
    const puntos = [...document.querySelectorAll<HTMLElement>(".pcmp-allocations .clase-con-color__punto")].map((punto) => punto.style.background);
    expect(new Set(puntos).size).toBe(puntos.length);
    /* Las barras siguen en el color de A y de B: es lo que comparan. */
    expect(document.querySelectorAll(".pcmp-bar--a").length).toBeGreaterThan(0);
  });
});
