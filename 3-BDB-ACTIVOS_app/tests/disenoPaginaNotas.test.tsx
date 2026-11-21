// @vitest-environment happy-dom

/**
 * La página de Diseño de cartera, hallazgos medios y bajos:
 * - DIS-17: al llegar desde Posiciones, la nota dice cuántas posiciones han entrado y cuáles se han quedado fuera.
 * - DIS-09: mientras se leen las fichas, la página se lo dice a la tabla.
 * - DIS-26: sustituir con «Mantener €» deja la posición con importe fijo, y la nota lo dice.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const fichas = vi.hoisted(() => ({ leer: vi.fn(), previa: vi.fn(async () => null) }));
vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: fichas.leer,
    buildManualPortfolioSummary: async () => ({ weighted_metrics: {}, warnings: [], by_economic_asset_class: [], total_weight_percent: 100, validation_status: "VALID" }),
    buildManualPortfolioOptimizationPreview: fichas.previa
  };
  return { getAssetDataSource: () => dataSource };
});

const visto = vi.hoisted(() => ({ props: null as unknown }));
vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: (props: unknown) => {
    visto.props = props;
    return createElement("section", { "data-vista": "constructor" });
  }
}));
vi.mock("../src/pages/PortfolioReportPage", () => ({ PortfolioReportPage: () => null }));

const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");
const { anotarTraspaso, leerNotaDelTraspaso } = await import("../src/core/notaDelTraspaso");
const { clearSessionCaches } = await import("../src/core/sessionCaches");

type Vistas = {
  portfolioNotice: string | null;
  cargandoFichas?: boolean;
  onSwap: (oldId: string, newId: string, newLabel: string, options: { preserveMode: "weight" | "money"; targetEuros?: number }) => void;
};
const props = () => visto.props as Vistas;

const CARTERA: BdbManualPortfolioPosition[] = [
  { asset_id: "A", label: "Fondo A", weight_percent: 60 },
  { asset_id: "B", label: "Fondo B", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  fichas.leer.mockReset();
  fichas.leer.mockResolvedValue([]);
  fichas.previa.mockClear();
  visto.props = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(positions: BdbManualPortfolioPosition[] = CARTERA, setPositions: (valor: unknown) => void = () => undefined, view: "builder" | "report" = "builder") {
  await act(async () => {
    root.render(
      createElement(PortfolioBuilderPage, {
        positions,
        setPositions,
        sourceKind: "LOCAL_MOCK",
        totalCapital: 4000,
        onCapitalChange: () => undefined,
        portfolioName: "Extracto del 13/11/2026",
        onPortfolioNameChange: () => undefined,
        onViewChange: () => undefined,
        view
      } as never)
    );
  });
}

const TRASPASO = { positions: CARTERA, totalCapital: 4000, name: "Extracto del 13/11/2026", excludedIds: ["XX0000000000"], excludedCapital: 500 };

describe("DIS-17 · llegar desde Posiciones", () => {
  test("Diseño abre con la nota de lo que ha entrado y lo que no, y la consume", async () => {
    anotarTraspaso(TRASPASO);
    await montar();
    expect(props().portfolioNotice?.replace(/\u00a0/g, " ")).toBe(
      "Del extracto han entrado 2 posiciones por 4.000 €. Se ha quedado fuera 1 posición (500 €): XX0000000000."
    );
    expect(leerNotaDelTraspaso(CARTERA)).toBeNull();
  });

  test("sobre otra cartera no sale: el asesor se echó atrás antes de sustituir", async () => {
    anotarTraspaso(TRASPASO);
    await montar([{ asset_id: "OTRA", weight_percent: 100 }]);
    expect(props().portfolioNotice).toBeNull();
  });
});

describe("DIS-09 · mientras se leen las fichas", () => {
  test("la página se lo dice al Constructor", async () => {
    fichas.leer.mockReturnValue(new Promise(() => undefined));
    await montar();
    expect(props().cargandoFichas).toBe(true);
  });
});

describe("ANA-20 · la vista Informes no pide los datos del Constructor", () => {
  test("con view=report no se piden fichas, resumen ni vista previa; al volver al Constructor, sí", async () => {
    await montar(CARTERA, () => undefined, "report");
    expect(fichas.previa).not.toHaveBeenCalled();
    expect(fichas.leer).not.toHaveBeenCalled();
    await montar(CARTERA, () => undefined, "builder");
    expect(fichas.previa).toHaveBeenCalledTimes(1);
  });
});

describe("DIS-26 · sustituir con «Mantener €»", () => {
  test("la nota dice que la posición queda con importe fijo", async () => {
    await montar();
    await act(async () => props().onSwap("A", "C", "Fondo C", { preserveMode: "money", targetEuros: 2400 }));
    expect(props().portfolioNotice).toContain("Posición sustituida por Fondo C.");
    expect(props().portfolioNotice).toContain("«Importe fijo»");
  });

  test("con «Mantener %» no lo dice", async () => {
    await montar();
    await act(async () => props().onSwap("A", "C", "Fondo C", { preserveMode: "weight" }));
    expect(props().portfolioNotice).toBe("Posición sustituida por Fondo C.");
  });
});
