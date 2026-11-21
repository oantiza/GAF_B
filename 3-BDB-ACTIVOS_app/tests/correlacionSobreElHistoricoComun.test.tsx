// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/**
 * T12, de la revisión de T11: el título de la matriz de correlación del Comparador dice lo que mide, el histórico común de lo que se compara, y no
 * el periodo elegido. Carmignac Investissement E y Allianz AT2 a «10A», en la base nueva, son 36 rentabilidades semanales de ocho meses, y el título
 * decía «· 10 años» justo debajo de una evolución que decía «Desde 28 abr 2025 · no llega a 10 años». Las palabras son las del papel de la
 * Comparativa («Rentabilidades semanales sobre el histórico común»), y el aviso, el mismo de la evolución.
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

/** Un cierre por semana, `n` semanas desde `desde`. */
const semanas = (desde: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const dia = new Date(`${desde}T00:00:00Z`);
    dia.setUTCDate(dia.getUTCDate() + 7 * i);
    return dia.toISOString().slice(0, 10);
  });

/** Lo que devuelve el servidor para «3A»: solo las fechas comunes de los dos. */
const respuesta = (fechas: string[], frecuencia: "DAILY" | "WEEKLY" = "DAILY") => ({
  dates: fechas,
  frequency: frecuencia,
  window: "3Y",
  excluded_assets: [],
  coverage: { first_date: fechas[0], last_date: fechas[fechas.length - 1], common_observations: fechas.length },
  series: [
    { asset_id: "A", display_name: "Activo A", values: fechas.map((_, i) => 100 + 3 * Math.sin(i)) },
    { asset_id: "B", display_name: "Activo B", values: fechas.map((_, i) => 100 + 2 * Math.cos(i)) }
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
const subtituloDe = (titulo: string) =>
  [...container.querySelectorAll("section.panel")]
    .find((panel) => panel.querySelector(".panel__title")?.textContent === titulo)
    ?.querySelector(".panel__subtitle")?.textContent?.replace(/\s+/g, " ").trim() ?? null;

test("si el histórico común no llega al periodo, la matriz lo dice con las palabras de la evolución, y no escribe el periodo elegido", async () => {
  /* Del 12 de noviembre de 2024 al 3 de noviembre de 2026: 721 días con el botón en «3A». */
  mocks.rebased.mockResolvedValue(respuesta(semanas("2024-11-12", 104)));
  await monta();
  expect(subtituloDe("Evolución comparada (base 100)")).toBe("Desde 12/11/2024 · no llega a 3 años · 104 datos diarios");
  const matriz = subtituloDe("Matriz de correlación");
  expect(matriz).toMatch(
    /^Correlación de rentabilidades semanales sobre el histórico común · Desde 12\/11\/2024 · no llega a 3 años · claro = baja \(diversifica\), oscuro = alta · se mide en semanal/
  );
  expect(matriz).not.toContain("· 3 años ·");
});

test("si lo cubre, dice el periodo, como antes, y que es el histórico común", async () => {
  /* Del 30 de octubre de 2023 al 26 de octubre de 2026: 1.092 días, tres años con la holgura de quince días del aviso. */
  mocks.rebased.mockResolvedValue(respuesta(semanas("2023-10-30", 157)));
  await monta();
  expect(subtituloDe("Evolución comparada (base 100)")).toBe("Del 30/10/2023 al 26/10/2026 · 157 datos diarios");
  expect(subtituloDe("Matriz de correlación")).toMatch(
    /^Correlación de rentabilidades semanales sobre el histórico común · 3 años · claro = baja \(diversifica\), oscuro = alta · se mide en semanal/
  );
});

test("con el gráfico en semanal dice lo mismo, sin la frase de por qué se mide en semanal", async () => {
  mocks.rebased.mockResolvedValue(respuesta(semanas("2024-11-12", 104), "WEEKLY"));
  await monta();
  expect(subtituloDe("Matriz de correlación")).toBe(
    "Correlación de rentabilidades semanales sobre el histórico común · Desde 12/11/2024 · no llega a 3 años · claro = baja (diversifica), oscuro = alta"
  );
});
