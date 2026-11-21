// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { OverlapHeatmap, type OverlapSeries } from "../src/charts/OverlapHeatmap";
import { posicionesDelInformeDeCliente, entradaDelInformeDeCliente } from "../src/core/reportPipelineCliente";
import { buildReportOverlap } from "../src/core/reportOverlap";
import type { BdbAssetDetail, BdbAssetHoldings, BdbHoldingPosition, BdbPortfolioReport } from "../src/types/bdbAssets";

/**
 * Los ETF no se quedan fuera del solapamiento (decisión de Óscar del 14-11-2026, que revisa la B-79: «con respecto a los ETF, no los
 * dejes fuera»). Un ETF se mide con la cartera completa de su emisor en la matriz de Análisis, también en Modo cliente, y en el informe
 * de cliente. Lo que un cliente no ve es de quién es esa cartera: la pantalla dice «cartera completa, a tal fecha».
 *
 * Aquí se prueba lo de la pantalla y la entrada del informe; que el papel imprime la cifra y no nombra al emisor, en
 * `tests/informeDeClienteSeisHojas.test.ts`; que ningún papel lee la cartera, en `tests/barreraCarteraDelEmisor.test.ts`.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const linea = (name: string, weight_pct: number, isin: string): BdbHoldingPosition => ({ name, weight_pct, isin });
const cartera = (asset_id: string, lineas: BdbHoldingPosition[], extra: Partial<BdbAssetHoldings> = {}): BdbAssetHoldings => ({
  asset_id,
  storage_mode: "SINGLE_DOCUMENT",
  as_of_date: "2026-09-30",
  holdings: lineas,
  ...extra
});

/* El ETF, con la cartera completa de su emisor: NVIDIA 40, Apple 35 y Microsoft 25. El fondo publica la suya entera: NVIDIA 20,
   Apple 30 y Nestlé 50. Comparten min(40, 20) + min(35, 30) = 50. */
const DEL_EMISOR = cartera(
  "ETF",
  [linea("NVIDIA", 40, "US67066G1040"), linea("Apple", 35, "US0378331005"), linea("Microsoft", 25, "US5949181045")],
  { as_of_date: "2026-11-06", issuer_portfolio: { source: "ishares", as_of: "2026-11-06", weighting: "MARKET_VALUE" } }
);
const DEL_FONDO = cartera("FONDO", [linea("NVIDIA", 20, "US67066G1040"), linea("Apple", 30, "US0378331005"), linea("Nestlé", 50, "CH0038863350")]);

const SERIES: OverlapSeries[] = [
  { asset_id: "ETF", display_name: "ETF de bolsa americana", instrument_type: "ETF", holdings: DEL_EMISOR },
  { asset_id: "FONDO", display_name: "Fondo global", instrument_type: "FUND", holdings: DEL_FONDO }
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function pintar(nombrarAlEmisor?: boolean): Promise<string> {
  await act(async () => {
    root.render(createElement(OverlapHeatmap, { series: SERIES, ...(nombrarAlEmisor === undefined ? {} : { nombrarAlEmisor }) }));
  });
  return host.textContent ?? "";
}

const detalles = () => [...host.querySelectorAll(".oaa-heatmap-index__detalle")].map((nodo) => nodo.textContent);

describe("la matriz de solapamiento con un ETF medido con la cartera completa de su emisor", () => {
  test("el ETF entra en la matriz con su cifra: 50,0 % con el fondo", async () => {
    const texto = await pintar();
    expect(texto).toContain("50,0 %");
    expect(texto).not.toContain("Fuera de la matriz");
  });

  test("para el asesor, el índice dice que la cartera es la del emisor, con su fecha", async () => {
    await pintar(true);
    expect(detalles()[0]).toContain("cartera del emisor, a 06/11/2026");
    /* El fondo, que va con lo que publica el proveedor, no dice nada de eso. */
    expect(detalles()[1]).not.toMatch(/emisor|cartera completa/);
  });

  test("en Modo cliente la cifra es la misma y el índice no nombra al emisor: «cartera completa», con su fecha", async () => {
    const texto = await pintar(false);
    expect(texto).toContain("50,0 %");
    expect(detalles()[0]).toContain("cartera completa, a 06/11/2026");
    expect(texto).not.toMatch(/emisor|ishares/i);
  });

  test("por defecto se nombra: quien no pregunta por el Modo cliente no oculta nada", async () => {
    await pintar();
    expect(detalles()[0]).toContain("cartera del emisor, a 06/11/2026");
  });
});

describe("la entrada del informe de cliente lleva el solapamiento que le da la pantalla", () => {
  const fila = (asset_id: string, display_name: string, instrument_type: string, weight_percent: number) => ({ asset_id, display_name, instrument_type, weight_percent });
  /* El total es el de la cartera, 60 + 40: sin cuadrar, la entrada del informe de cliente no se monta (INF-1). */
  const report = { portfolio_name: "Cartera", summary: { total_weight_percent: 100 }, positions: [fila("ETF", "ETF de bolsa americana", "ETF", 60), fila("FONDO", "Fondo global", "FUND", 40)] } as unknown as BdbPortfolioReport;
  const assets = [
    { asset_id: "ETF", display_name: "ETF de bolsa americana", instrument_type: "ETF", product_profile: { replication: "PHYSICAL" } },
    { asset_id: "FONDO", display_name: "Fondo global", instrument_type: "FUND" }
  ] as unknown as BdbAssetDetail[];
  const comun = {
    report,
    positions: [{ asset_id: "ETF", weight_percent: 60 }, { asset_id: "FONDO", weight_percent: 40 }],
    assets,
    clientMode: true,
    analysis: {} as never,
    seriesParadas: new Map<string, string>(),
    benchmarkId: "equilibrado",
    clientName: "Familia García",
    banker: { name: "", email: "" },
    rentabilidadPorDividendoDe: () => ({})
  };

  test("las posiciones con las que se mide son las del informe, con la réplica de cada ficha", () => {
    expect(posicionesDelInformeDeCliente(report, assets).map((p) => [p.asset_id, (p as { replica?: string }).replica])).toEqual([["ETF", "PHYSICAL"], ["FONDO", undefined]]);
  });

  test("con el modelo medido con la cartera del emisor, la entrada lo lleva tal cual, también en Modo cliente", () => {
    const overlap = buildReportOverlap(posicionesDelInformeDeCliente(report, assets), new Map([["ETF", DEL_EMISOR], ["FONDO", DEL_FONDO]]));
    expect(overlap.values[0][1]).toBe(50);
    const entrada = entradaDelInformeDeCliente({ ...comun, overlap });
    expect(entrada.overlap).toBe(overlap);
    expect(entrada.clientMode).toBe(true);
  });

  test("sin modelo, la entrada no inventa ninguno: el papel lo calcula con la fuente del proveedor", () => {
    expect(entradaDelInformeDeCliente(comun)).not.toHaveProperty("overlap");
  });
});
