// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * ANA-05, ANA-06 y ANA-07 (auditoría de frontend, 13-11-2026). Analítica avanzada tiene tres estados además del resultado, y no se
 * confunden: cargando; no se puede calcular y por qué (sin pesos, sin serie, tope del cálculo), sin «Reintentar»; y ha fallado la
 * petición, con «Reintentar» una sola vez. Con una sola posición se pinta todo lo que tiene sentido con una: solo las matrices piden dos.
 */
const mocks = vi.hoisted(() => ({ horizonte: vi.fn(), referencia: vi.fn() }));

vi.mock("../src/core/usePortfolioHorizon", () => ({ usePortfolioHorizon: mocks.horizonte }));
vi.mock("../src/core/useSeriesDeReferencia", () => ({ useSeriesDeReferencia: mocks.referencia }));
vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/charts/oaa", () => ({ OaaLineChart: () => null, OaaRiskReturnChart: () => null, OaaCorrelationHeatmap: () => null }));
vi.mock("../src/charts/UnderwaterChart", () => ({ UnderwaterChart: () => null }));
vi.mock("../src/charts/OverlapHeatmap", () => ({ OverlapHeatmap: () => null }));

import { XrayAdvanced } from "../src/components/XrayAdvanced";
import { AppError } from "../src/core/appError";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const activo = (asset_id: string) => ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND" }) as unknown as BdbAssetDetail;
const DOS: BdbManualPortfolioPosition[] = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];

let contenedor: HTMLDivElement;
let raiz: Root;

async function pintar(estado: { data?: unknown; error?: string; causa?: unknown }, positions = DOS) {
  mocks.horizonte.mockReturnValue({ window: "3Y", retry: () => undefined, ...estado });
  mocks.referencia.mockReturnValue({ estado: "lista", series: null, reintentar: () => undefined });
  await act(async () => raiz.render(createElement(XrayAdvanced, { positions, assets: positions.map((p) => activo(p.asset_id)) })));
}

const texto = () => (contenedor.textContent ?? "").split(String.fromCharCode(160)).join(" ");
const botones = (rotulo: string) => [...contenedor.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === rotulo);
const alertas = () => contenedor.querySelectorAll('[role="alert"]').length;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  contenedor = document.body.appendChild(document.createElement("div"));
  raiz = createRoot(contenedor);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  contenedor.remove();
  vi.unstubAllGlobals();
  mocks.horizonte.mockReset();
  mocks.referencia.mockReset();
});

describe("Analítica avanzada: no se puede calcular no es un fallo (ANA-05)", () => {
  test("si el servidor dice que faltan datos: sin «Reintentar», sin banner de fallo, y se dice por qué", async () => {
    const faltaDeDatos = new AppError("BACKEND", "La operación no se puede ejecutar en el estado actual de los datos.", {
      cause: { code: "functions/failed-precondition" }
    });
    await pintar({ error: faltaDeDatos.message, causa: faltaDeDatos });
    expect(botones("Reintentar")).toHaveLength(0);
    expect(alertas()).toBe(0);
    expect(texto()).toContain("Falta el dato");
    expect(texto()).toContain("la simulación no mide ninguna posición");
    expect(texto()).not.toContain("Calculando");
  });

  test("si pasa del tope del cálculo: el límite y cuántas tiene, sin «Reintentar»", async () => {
    const tope = "El cálculo admite 85 posiciones como máximo y esta cartera tiene 90. No es un fallo pasajero: reintentar no lo cambia.";
    await pintar({ error: tope, causa: new AppError("BACKEND", tope, { limite: true }) });
    expect(botones("Reintentar")).toHaveLength(0);
    expect(alertas()).toBe(0);
    expect(texto()).toContain(tope);
  });

  test("un fallo de verdad se dice una sola vez, con un solo «Reintentar»", async () => {
    const red = new AppError("NETWORK", "No hay conexión con el servidor. Comprueba la red y reinténtalo.");
    await pintar({ error: red.message, causa: red });
    expect(botones("Reintentar")).toHaveLength(1);
    expect(alertas()).toBe(1);
    expect(texto()).not.toContain("Calculando");
  });
});

describe("Analítica avanzada con todos los pesos a cero (ANA-06)", () => {
  test("no se queda en «Calculando…»: dice que ninguna posición tiene peso", async () => {
    await pintar({}, [{ asset_id: "A", weight_percent: 0 }, { asset_id: "B", weight_percent: 0 }]);
    expect(texto()).not.toContain("Calculando");
    expect(texto()).toContain("Ninguna posición tiene peso");
    expect(botones("Reintentar")).toHaveLength(0);
  });

  test("mientras se calcula, sí dice que calcula", async () => {
    await pintar({});
    expect(texto()).toContain("Calculando");
  });
});

describe("Analítica avanzada con una sola posición (ANA-07)", () => {
  test("se pinta la evolución, y solo las matrices dicen que necesitan dos", async () => {
    await pintar({}, [{ asset_id: "A", weight_percent: 100 }]);
    expect(texto()).toContain("Evolución histórica de la cartera");
    /* El bloque solo lleva el mapa, y el mapa se llama «Mapa de riesgo y rentabilidad» (ANA-16); «Rentabilidad y
       riesgo» es el nombre del bloque de las cuatro cifras, y «Riesgo y rentabilidad» ya no se escribe. */
    expect(texto()).toContain("Mapa de riesgo y rentabilidad frente a las carteras de referencia");
    expect(texto()).not.toContain("Riesgo y rentabilidad");
    expect(texto()).not.toContain("Añade al menos 2 activos a la cartera para la analítica avanzada");
    expect(texto()).toContain("La matriz de correlación necesita al menos dos posiciones.");
    expect(texto()).toContain("La matriz de solapamiento necesita al menos dos posiciones.");
  });
});
