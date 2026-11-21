// @vitest-environment happy-dom

/**
 * Hallazgo 53: el resultado de optimizar se borraba con solo cambiar a Simular y volver. Ahora se conserva
 * en la sesión y caduca si cambia la cartera, como en «Mejorar cartera»: si no, se aplicaría una propuesta
 * calculada para otros pesos.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { FrontierHistoricalState, FrontierPointView, FrontierViewModel } from "../src/types/portfolioFrontier";

const backend = vi.hoisted(() => ({
  fetchHistoricalFrontier: vi.fn(),
  isRealFrontierEnabled: vi.fn(() => true)
}));

vi.mock("../src/adapters/optimizePortfolioBackend", () => backend);

import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";
import { clearSessionCaches } from "../src/core/sessionCaches";

const positions: BdbManualPortfolioPosition[] = [
  { asset_id: "A", label: "Fondo A", weight_percent: 60 },
  { asset_id: "B", label: "Fondo B", weight_percent: 40 }
];

const assets = positions.map((position) => ({
  asset_id: position.asset_id,
  display_name: position.label,
  instrument_type: "FUND",
  economic_asset_class: "EQUITY",
  currency: "EUR",
  coverage_status: "FULL",
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: [],
  warnings: [],
  metrics: { volatility_3y: 0.11, annualized_return_3y: 0.06 },
  description: "",
  pms_exposure: {}
})) as unknown as BdbAssetDetail[];

function point(a: number, b: number, expectedReturn: number, volatility: number, sharpeRatio: number): FrontierPointView {
  return {
    expectedReturn,
    volatility,
    sharpeRatio,
    expectedReturnLabel: `${(expectedReturn * 100).toFixed(2)} %`,
    volatilityLabel: `${(volatility * 100).toFixed(2)} %`,
    sharpeLabel: sharpeRatio.toFixed(2),
    weights: [
      { assetId: "A", weight: a, weightLabel: `${(a * 100).toFixed(2)} %` },
      { assetId: "B", weight: b, weightLabel: `${(b * 100).toFixed(2)} %` }
    ]
  };
}

function resultado(): FrontierHistoricalState {
  const current = point(0.6, 0.4, 0.06, 0.12, 0.35);
  const maxSharpe = point(0.25, 0.75, 0.085, 0.1, 0.66);
  const minVolatility = point(0.45, 0.55, 0.055, 0.08, 0.44);
  const model: FrontierViewModel = {
    kind: "historical",
    label: "Frontera histórica",
    asOfDate: "2026-07-18",
    window: "3Y",
    riskFreeRateLabel: "1,93 %",
    riskFreeSource: "ECB_ESTR",
    riskFreeRatePolicy: "WINDOW_AVERAGE",
    coverage: { requested: 2, included: 2, commonObservations: 156, firstDate: "2023-07-21", lastDate: "2026-07-17" },
    insufficientCoverage: false,
    current,
    minVolatility,
    maxSharpe,
    target: maxSharpe,
    frontier: [
      { expectedReturn: minVolatility.expectedReturn, volatility: minVolatility.volatility, sharpeRatio: minVolatility.sharpeRatio },
      { expectedReturn: maxSharpe.expectedReturn, volatility: maxSharpe.volatility, sharpeRatio: maxSharpe.sharpeRatio }
    ],
    excluded: [],
    warnings: []
  };
  return { status: "result", model };
}

let root: Root;
let host: HTMLDivElement;

async function montar(cartera: BdbManualPortfolioPosition[] = positions, onApplyWeights: (w: Record<string, number>) => void = () => undefined) {
  await act(async () => {
    root.render(createElement(OptimizerPanel, { assets, positions: cartera, onApplyWeights }));
  });
}

async function desmontar() {
  await act(async () => root.unmount());
  root = createRoot(host);
}

const boton = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

async function pulsar(texto: string) {
  const elegido = boton(texto);
  if (!elegido) throw new Error(`No aparece el botón ${texto}`);
  await act(async () => {
    elegido.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function optimizar() {
  await pulsar("Optimizar");
  await act(async () => {
    await Promise.resolve();
  });
  // La revisión se abre sola al calcular: aquí se cierra para mirar lo que queda detrás.
  await pulsar("Cancelar");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  backend.fetchHistoricalFrontier.mockReset();
  backend.fetchHistoricalFrontier.mockResolvedValue(resultado());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const AVISO = "La cartera ha cambiado desde el cálculo";

describe("el resultado de optimizar en la sesión", () => {
  test("cambiar de paso y volver no lo borra ni lo vuelve a pedir, y no reabre la revisión", async () => {
    await montar();
    await optimizar();
    const antes = host.textContent ?? "";
    expect(antes).toContain("Revisar propuesta");
    await desmontar();
    await montar();
    expect(backend.fetchHistoricalFrontier).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Revisar propuesta");
    expect(host.textContent).not.toContain(AVISO);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("los mandos también vuelven como estaban", async () => {
    await montar();
    const select = document.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "MIN_VOLATILITY");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await desmontar();
    await montar();
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("MIN_VOLATILITY");
  });

  test("si la cartera ha cambiado, caduca: se dice, y no se puede revisar ni aplicar", async () => {
    await montar();
    await optimizar();
    await desmontar();
    await montar([{ ...positions[0], weight_percent: 70 }, { ...positions[1], weight_percent: 30 }]);
    expect(host.textContent).toContain(AVISO);
    expect(host.textContent).not.toContain("Revisar propuesta");
    expect(backend.fetchHistoricalFrontier).toHaveBeenCalledTimes(1);
  });

  test("también caduca si cambia estando aquí", async () => {
    await montar();
    await optimizar();
    await montar([{ ...positions[0], weight_percent: 70 }, { ...positions[1], weight_percent: 30 }]);
    expect(host.textContent).toContain(AVISO);
    expect(host.textContent).not.toContain("Revisar propuesta");
  });

  test("volver a los pesos del cálculo la devuelve a la vida", async () => {
    await montar();
    await optimizar();
    await montar([{ ...positions[0], weight_percent: 70 }, { ...positions[1], weight_percent: 30 }]);
    await montar();
    expect(host.textContent).not.toContain(AVISO);
    expect(host.textContent).toContain("Revisar propuesta");
  });

  test("al aplicar se retira: la cartera que se calculó ya no existe", async () => {
    const onApplyWeights = vi.fn();
    await montar(positions, onApplyWeights);
    await pulsar("Optimizar");
    await act(async () => {
      await Promise.resolve();
    });
    await pulsar("Aplicar optimización");
    expect(onApplyWeights).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Pesos aplicados a la cartera.");
    expect(host.textContent).not.toContain("Revisar propuesta");
    await desmontar();
    await montar();
    expect(host.textContent).not.toContain("Revisar propuesta");
  });

  test("al cambiar de cartera se olvida, también el resultado", async () => {
    await montar();
    await optimizar();
    await desmontar();
    olvidarTrabajoDeCartera();
    await montar();
    expect(host.textContent).not.toContain("Revisar propuesta");
    expect(host.textContent).not.toContain(AVISO);
  });
});
