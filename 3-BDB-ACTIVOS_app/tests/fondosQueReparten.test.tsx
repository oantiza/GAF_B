// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseRebasedSeriesResponse } from "../src/adapters/priceSeriesBackend";

/**
 * Decisión 8: un fondo con rendimiento a 12 meses positivo se dibuja rotulado, sin «Variación del periodo», y se queda fuera de
 * simulación y frontera con su motivo. El servidor es quien lo decide (`functions_python/fund_distributions.py`) y lo manda en
 * cada serie: aquí se comprueba que la pantalla no lo pierda ni lo pinte como una rentabilidad.
 */
const mocks = vi.hoisted(() => ({ rebased: vi.fn(), lineChart: vi.fn() }));

vi.mock("../src/adapters/priceSeriesBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/priceSeriesBackend")>()),
  fetchRebasedSeries: mocks.rebased
}));
vi.mock("../src/charts/oaa", async (original) => ({
  ...(await original<typeof import("../src/charts/oaa")>()),
  OaaLineChart: (props: { series: unknown[]; ariaLabel?: string }) => {
    mocks.lineChart(props);
    return <div data-testid="grafico" />;
  }
}));

import { backtestExclusionLabel, backtestCoverageNotices, fraseDeLoQueNoSeDibuja, motivoDeFueraParaElCliente } from "../src/core/backtestCoverage";
import { AssetHistoryChart } from "../src/components/AssetHistoryChart";
import { avisoDeVentana } from "../src/core/coberturaDeLaSerie";
import { fueraDeLaMedida, senalDeLoQueQuedaFuera } from "../src/core/medidaDeLaCartera";
import { rejectionLabel } from "../src/core/portfolioImprovement";
import { reasonLabel } from "../src/adapters/portfolioFrontierAdapter";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const FECHAS = ["2023-10-26", "2024-10-26", "2025-10-26", "2026-10-27"];

function serie(extra: Record<string, unknown> = {}, fechas = FECHAS, window = "3Y") {
  return {
    schema_version: "price-series.v1",
    base_currency: "EUR",
    window,
    frequency: "DAILY",
    rebased_to: 100,
    dates: fechas,
    series: [{ asset_id: "LU0321373184", display_name: "Schroder", values: fechas.map((_, i) => 100 + i * 5), ...extra }],
    coverage: { requested_assets: 1, included_assets: 1, common_observations: fechas.length, first_date: fechas[0], last_date: fechas[fechas.length - 1] },
    excluded_assets: []
  };
}

describe("el contrato de la serie", () => {
  test("lee la marca, y sin ella no se la inventa", () => {
    expect(parseRebasedSeriesResponse(serie({ sin_dividendos: true })).series[0].sin_dividendos).toBe(true);
    expect(parseRebasedSeriesResponse(serie()).series[0].sin_dividendos).toBeUndefined();
    /* Un servidor anterior no la manda, y un valor que no sea `true` no marca nada. */
    expect(parseRebasedSeriesResponse(serie({ sin_dividendos: "true" })).series[0].sin_dividendos).toBeUndefined();
  });
});

describe("si la serie cubre la ventana", () => {
  test("Inmocemento: empieza el 12 de noviembre de 2024 y no llega a 3 años", () => {
    expect(avisoDeVentana(["2024-11-12", "2026-11-03"], "3Y")).toBe("Desde 12/11/2024 · no llega a 3 años");
  });

  test("sí llega a 1 año, y en singular cuando no llega", () => {
    expect(avisoDeVentana(["2024-11-12", "2026-11-03"], "1Y")).toBeNull();
    expect(avisoDeVentana(["2026-06-01", "2026-11-03"], "1Y")).toBe("Desde 01/06/2026 · no llega a 1 año");
  });

  test("tres años justos, o unos días menos por un valor liquidativo semanal, no son «no llega»", () => {
    /* El servidor corta por el último dato menos 366 días por año. */
    expect(avisoDeVentana(["2023-11-02", "2026-11-03"], "3Y")).toBeNull();
    expect(avisoDeVentana(["2023-11-10", "2026-11-03"], "3Y")).toBeNull();
    /* El límite: 15 días de holgura sobre 3 × 365,2425 = 1.095,7 días. */
    expect(avisoDeVentana(["2023-11-18", "2026-11-03"], "3Y")).toBeNull(); // 1.081 días
    expect(avisoDeVentana(["2023-11-20", "2026-11-03"], "3Y")).toBe("Desde 20/11/2023 · no llega a 3 años"); // 1.079 días
  });

  test("sin fechas, o con una ventana que no conoce, no afirma nada", () => {
    expect(avisoDeVentana([], "3Y")).toBeNull();
    expect(avisoDeVentana(["2024-11-12", "2026-11-03"], "MAX")).toBeNull();
  });
});

describe("el motivo, en todas las listas de lo que queda fuera", () => {
  const CODIGO = "DISTRIBUTES_WITHOUT_PAYMENTS";

  test("cada pieza lo dice en palabras, sin enseñar el código", () => {
    expect(backtestExclusionLabel(CODIGO)).toBe("reparte y no tenemos todos los pagos");
    expect(reasonLabel(CODIGO)).toBe("Reparte y no tenemos todos los pagos");
    expect(rejectionLabel(CODIGO)).toBe("Reparte y no tenemos todos los pagos");
  });

  test("el aviso sale como los demás activos fuera del cálculo", () => {
    const avisos = backtestCoverageNotices(
      { window: "3Y", coverage: { common_observations: 700, first_date: "2023-11-03", last_date: "2026-11-03" }, excluded_assets: [{ asset_id: "LU0321373184", reason: CODIGO }] },
      { LU0321373184: "Schroder European Dividend Maximiser" }
    );
    expect(avisos).toEqual(["Fuera del cálculo: Schroder European Dividend Maximiser (reparte y no tenemos todos los pagos)."]);
  });

  test("baja lo medido y lo nombra con su peso, sin contarlo como un problema de calidad", () => {
    const horizonte = {
      backtest: { excluded_assets: [{ asset_id: "LU0321373184", reason: CODIGO }] }
    } as unknown as PortfolioHorizon;
    const posiciones = [{ asset_id: "LU0321373184", weight_percent: 12 }, { asset_id: "IE00B4L5Y983", weight_percent: 88 }];
    const activos = [{ asset_id: "LU0321373184", display_name: "Schroder" }] as BdbAssetDetail[];
    const fuera = fueraDeLaMedida(horizonte, posiciones, activos);
    expect(fuera).toEqual([{ assetId: "LU0321373184", nombre: "Schroder", pesoPct: 12, motivo: "reparte y no tenemos todos los pagos", porCalidad: false }]);
    expect(senalDeLoQueQuedaFuera(fuera)).toBe("1 posición fuera del cálculo: Schroder (12,0\u00a0%).");
  });
});

describe("quien reparte, por el mismo motivo en todas las piezas (Fidelity, decisión 72)", () => {
  const CODIGO = "DISTRIBUTES_WITHOUT_PAYMENTS";

  test("cada pieza lo dice en palabras, sin enseñar el código", () => {
    expect(backtestExclusionLabel(CODIGO)).toBe("reparte y no tenemos todos los pagos");
    expect(reasonLabel(CODIGO)).toBe("Reparte y no tenemos todos los pagos");
    expect(rejectionLabel(CODIGO)).toBe("Reparte y no tenemos todos los pagos");
    expect(motivoDeFueraParaElCliente(CODIGO)).toBe("Fuera del cálculo: reparte, y su serie no recoge lo que paga");
  });

  test("baja lo medido sin contarlo como un problema de calidad", () => {
    const horizonte = { backtest: { excluded_assets: [{ asset_id: "LU0857700040", reason: CODIGO }] } } as unknown as PortfolioHorizon;
    const fuera = fueraDeLaMedida(horizonte, [{ asset_id: "LU0857700040", weight_percent: 20 }, { asset_id: "IE00B4L5Y983", weight_percent: 80 }], [{ asset_id: "LU0857700040", display_name: "Fidelity" }] as BdbAssetDetail[]);
    expect(fuera[0].porCalidad).toBe(false);
    expect(fuera[0].pesoPct).toBe(20);
  });

  test("lo que no se dibuja: el asesor lee el motivo, y el cliente el suyo", () => {
    expect(fraseDeLoQueNoSeDibuja("Polar", "QUALITY_BLOCKED")).toBe(`Polar no se dibuja: ${backtestExclusionLabel("QUALITY_BLOCKED")}.`);
    expect(fraseDeLoQueNoSeDibuja("Polar", "QUALITY_BLOCKED", { modoCliente: true })).toBe("Polar no se dibuja: incidencia en su serie de precios.");
    expect(fraseDeLoQueNoSeDibuja("Otro", "OTRO_CODIGO", { modoCliente: true })).toBe("Otro no se dibuja.");
    /* El ETC de oro se puede comprar. Y la cuarentena de divisa no es lo mismo que no tener conversión: la serie de cambio existe. */
    expect(fraseDeLoQueNoSeDibuja("Oro", "NON_INVESTABLE")).toBe("Oro no se dibuja: este activo está fuera del análisis histórico.");
    expect(fraseDeLoQueNoSeDibuja("ETF", "FX_QUARANTINE")).toBe("ETF no se dibuja: sin conversión a euros fiable.");
    expect(fraseDeLoQueNoSeDibuja("ETF", "FX_QUARANTINE", { modoCliente: true })).toBe("ETF no se dibuja: sin conversión a euros fiable.");
    expect(fraseDeLoQueNoSeDibuja("ETF", "FX_SERIES_MISSING")).toBe("ETF no se dibuja: sin conversión a euros.");
  });
});

describe("la gráfica de la ficha", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.rebased.mockReset();
    mocks.lineChart.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const monta = async (nodo: ReactNode) => {
    await act(async () => {
      root.render(nodo);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const FICHA = { asset_id: "LU0321373184", display_name: "Schroder", quality_flags: [] };

  test("un fondo que reparte: «Valor liquidativo, sin dividendos» y sin variación", async () => {
    mocks.rebased.mockResolvedValue(parseRebasedSeriesResponse(serie({ sin_dividendos: true })));
    await monta(<AssetHistoryChart asset={FICHA} />);
    expect(container.textContent).toContain("Valor liquidativo, sin dividendos");
    expect(container.textContent).not.toContain("Variación del periodo");
    /* La serie se sigue dibujando: lo que no se hace es sacarle una rentabilidad. */
    expect(mocks.lineChart).toHaveBeenCalled();
  });

  test("una serie bloqueada: no se dibuja y dice por qué", async () => {
    mocks.rebased.mockResolvedValue(parseRebasedSeriesResponse({ ...serie(), dates: [], series: [], excluded_assets: [{ asset_id: FICHA.asset_id, reason: "QUALITY_BLOCKED" }] }));
    await monta(<AssetHistoryChart asset={FICHA} />);
    expect(container.textContent).toContain("Serie no disponible: bloqueado por calidad del dato.");
    expect(mocks.lineChart).not.toHaveBeenCalled();
  });

  test("uno que no reparte conserva su variación y no lleva el rótulo", async () => {
    mocks.rebased.mockResolvedValue(parseRebasedSeriesResponse(serie()));
    await monta(<AssetHistoryChart asset={FICHA} />);
    expect(container.textContent).toContain("Variación del periodo");
    expect(container.textContent).toContain("+15,0");
    expect(container.textContent).not.toContain("sin dividendos");
  });

  test("una serie corta lo dice con la fecha del dato, y la que llega dice de qué a qué va", async () => {
    mocks.rebased.mockResolvedValue(parseRebasedSeriesResponse(serie({}, ["2024-11-12", "2025-11-12", "2026-11-03"])));
    await monta(<AssetHistoryChart asset={FICHA} />);
    expect(container.textContent).toContain("Desde 12/11/2024 · no llega a 3 años");
  });
});
