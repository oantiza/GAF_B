// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/**
 * Decisión 8, en el Comparador: la línea de un fondo que reparte va junto a clases que acumulan, y sin decirlo se lee como si
 * hubiera rendido menos. Y una ventana común que no llega al periodo elegido lo dice: el botón sigue diciendo «3A».
 */
const mocks = vi.hoisted(() => ({ rebased: vi.fn() }));

vi.mock("../src/adapters/priceSeriesBackend", () => ({ fetchRebasedSeries: mocks.rebased }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ searchAssets: vi.fn(async () => []), getComparableAssets: vi.fn(async () => []) })
}));
vi.mock("../src/adapters/baseNuevaLectura", async (original) => ({
  ...(await original<typeof import("../src/adapters/baseNuevaLectura")>()),
  BASE_NUEVA_DISPONIBLE: false
}));
vi.mock("../src/charts/oaa", async (original) => ({
  ...(await original<typeof import("../src/charts/oaa")>()),
  OaaLineChart: () => <div data-testid="evolucion" />
}));

import { AssetComparison } from "../src/components/AssetComparison";
import { clearSessionCaches } from "../src/core/sessionCaches";

const activo = (id: string): BdbAssetDetail =>
  ({
    asset_id: id, display_name: `Activo ${id}`, isin: id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    metrics: { annualized_return_3y: 0.06, volatility_3y: 0.1, sharpe_3y: 0.98 },
    costs: { ongoing_charge: 0.012 }, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  }) as BdbAssetDetail;

const respuesta = (fechas: string[], primero: Record<string, unknown>) => ({
  dates: fechas,
  frequency: "DAILY",
  window: "3Y",
  excluded_assets: [],
  coverage: { first_date: fechas[0], last_date: fechas[fechas.length - 1], common_observations: fechas.length },
  series: [
    { asset_id: "A", display_name: "Activo A", values: fechas.map((_, i) => 100 + i), ...primero },
    { asset_id: "B", display_name: "Activo B", values: fechas.map((_, i) => 100 + 2 * i) }
  ]
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  mocks.rebased.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const monta = async () => {
  await act(async () => root.render(<AssetComparison assets={[activo("A"), activo("B")]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />));
};
const leyenda = () => [...container.querySelectorAll(".cmp-legend li")];

test("el fondo que reparte dice qué es lo dibujado y no enseña una cifra final; el otro sigue igual", async () => {
  mocks.rebased.mockResolvedValue(respuesta(["2023-10-26", "2024-10-26", "2025-10-26", "2026-10-27"], { sin_dividendos: true }));
  await monta();
  const [reparte, acumula] = leyenda();
  expect(reparte.textContent).toContain("Activo A · Valor liquidativo, sin dividendos");
  expect(reparte.querySelector("strong")).toBeNull();
  expect(acumula.textContent).not.toContain("sin dividendos");
  expect(acumula.querySelector("strong")?.textContent).toBe("106,0");
  /* Cubre los tres años: dice de qué a qué va. */
  expect(container.textContent).toContain("Del 26/10/2023 al 27/10/2026 · 4 datos diarios");
});

test("una ventana común que no llega a 3 años lo dice, con la fecha del dato", async () => {
  mocks.rebased.mockResolvedValue(respuesta(["2024-11-12", "2025-11-12", "2026-11-03"], {}));
  await monta();
  expect(container.textContent).toContain("Desde 12/11/2024 · no llega a 3 años · 3 datos diarios");
  expect(container.textContent).not.toContain("Del 12/11/2024");
});

describe("la matriz de correlación (decisión 53)", () => {
  /* Un dato por semana: la matriz mide en semanal. */
  const SEMANAS = Array.from({ length: 12 }, (_, i) => {
    const dia = new Date("2026-08-03T00:00:00Z");
    dia.setUTCDate(dia.getUTCDate() + 7 * i);
    return dia.toISOString().slice(0, 10);
  });
  const conValores = (primero: Record<string, unknown>) => {
    const base = respuesta(SEMANAS, primero);
    return {
      ...base,
      series: [
        { ...base.series[0], values: SEMANAS.map((_, i) => 100 + 3 * Math.sin(i)) },
        { ...base.series[1], values: SEMANAS.map((_, i) => 100 + 2 * Math.cos(i)) }
      ]
    };
  };
  const casillas = () => [...container.querySelectorAll(".heatmap__cell")].map((casilla) => casilla.textContent);

  test("con una línea sin dividendos no se mide, cada casilla lo dice y la frase dice por qué", async () => {
    mocks.rebased.mockResolvedValue(conValores({ sin_dividendos: true }));
    await monta();
    expect(casillas()).toEqual(["1,00", "No se mide", "No se mide", "1,00"]);
    expect(container.querySelector(".heatmap__cell[title]")?.getAttribute("title")).toBe("Activo A × Activo B: No se mide");
    expect(container.textContent).toContain(
      "No se mide la correlación de Activo A: su línea es el valor liquidativo, sin dividendos, y cada pago se leería como una caída."
    );
  });

  test("sin líneas sin dividendos sale la cifra, y ni casilla ni frase hablan de ello", async () => {
    mocks.rebased.mockResolvedValue(conValores({}));
    await monta();
    const [, ab] = casillas();
    expect(ab).toMatch(/^[−-]?\d,\d\d$/);
    expect(container.textContent).not.toContain("No se mide");
  });
});

describe("quien se ha elegido y no se dibuja", () => {
  const sinSerie = (ids: string[]) => {
    const base = respuesta(["2023-10-26", "2024-10-26", "2025-10-26", "2026-10-27"], {});
    return {
      ...base,
      excluded_assets: [{ asset_id: "A", reason: "QUALITY_BLOCKED" }],
      series: base.series.filter((serie) => ids.includes(serie.asset_id))
    };
  };

  test("lo dice con su motivo, y con dos activos no culpa al histórico común", async () => {
    mocks.rebased.mockResolvedValue(sinSerie(["B"]));
    await monta();
    expect(container.textContent).toContain(
      "Activo A no se dibuja: bloqueado por calidad del dato."
    );
    expect(container.textContent).toContain("Con las series que quedan no hay comparación que dibujar.");
    expect(container.textContent).not.toContain("Sin histórico común suficiente");
  });
});
