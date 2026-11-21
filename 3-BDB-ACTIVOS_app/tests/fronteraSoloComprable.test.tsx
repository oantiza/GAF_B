/**
 * La frontera de Simular, solo con lo que se puede comprar (decisión de Óscar, 15-11-2026).
 *
 * El servidor manda `frontier_excluded_assets` cuando hay algo medido que no se puede comprar: entra en las cifras y en el punto
 * de la cartera, no en la curva ni en sus carteras. Un servidor de antes no lo manda, y entonces no hay nota. La pantalla, la
 * Comparativa y el informe completo dicen qué no entra, por qué, y que las cifras de la cartera sí lo incluyen.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { parsePortfolioHorizon, type PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { parseFrontierNotSelectable } from "../src/adapters/portfolioFrontierAdapter";
import { HorizonFrontier } from "../src/components/PortfolioHorizonPanel";
import { fraseDelMaximoSinLoQueNoSePuedeComprar, notaDeLoQueNoEntraEnLaFrontera } from "../src/core/medidaDeLaCartera";
import { notasDeLoQueNoEntra } from "../src/reports/internalPortfolioReportPdf";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const IDS = ["A", "B", "NH"];

function respuesta({ conLista, conFrontera = true }: { conLista: boolean; conFrontera?: boolean }): Record<string, unknown> {
  const primera = Date.UTC(2023, 8, 1);
  const serie = Array.from({ length: 158 }, (_, i) => ({ date: new Date(primera + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 + i / 4 }));
  const cobertura = { requested_assets: 3, included_assets: 3, common_observations: serie.length, first_date: serie[0].date, last_date: serie.at(-1)!.date };
  const simulacion = (pesos: Record<string, number>) => ({
    schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", units: "decimal", frequency: "DAILY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "DAILY",
    metrics: { cagr: 0.1, volatility: 0.08, sharpe: 1, max_drawdown: -0.1, rf_rate: 0.02 }, portfolio_series: serie,
    asset_ids: IDS, weights_normalized: pesos, correlation_matrix: [[1, 0.2, 0], [0.2, 1, 0], [0, 0, 1]], benchmark_series: {}, synthetics: [],
    coverage: cobertura, excluded_assets: [], warnings: []
  });
  const punto = (er: number, vol: number, weights: Record<string, number>) => ({ expected_return: er, volatility: vol, sharpe_ratio: (er - 0.02) / vol, weights });
  /* Con la lista, las carteras propuestas no llevan NH: es lo que manda el servidor nuevo. */
  const propuestas = conLista ? { A: 0.55, B: 0.45 } : { A: 0.5, B: 0.3, NH: 0.2 };
  const frontera = {
    schema_version: "portfolio-frontier.v1", as_of_date: serie.at(-1)!.date, units: "decimal", base_currency: "EUR",
    methodology: { window: "3Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR", risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" },
    coverage: { ...cobertura, included_assets: conLista ? 2 : 3 },
    current_portfolio: punto(0.06, 0.07, { A: 0.5, B: 0.4, NH: 0.1 }),
    min_volatility_portfolio: punto(0.05, 0.09, propuestas),
    max_sharpe_portfolio: punto(0.08, 0.11, propuestas),
    target_portfolio: punto(0.07, 0.1, propuestas),
    frontier: [punto(0.05, 0.09, propuestas), punto(0.08, 0.11, propuestas)],
    excluded_assets: [], warnings: [],
    risk_contributions: [{ asset_id: "A", weight_pct: 50, risk_pct: 60 }, { asset_id: "B", weight_pct: 40, risk_pct: 40 }, { asset_id: "NH", weight_pct: 10, risk_pct: 0 }],
    risk_contributions_meta: { cov_model: "LEDOIT_WOLF" }
  };
  return {
    schema_version: "portfolio-horizon.v1", window: "3Y", horizon_years: 3, reference_version: "test",
    backtest: simulacion({ A: 0.5, B: 0.4, NH: 0.1 }), equal_weight: simulacion({ A: 1 / 3, B: 1 / 3, NH: 1 / 3 }),
    max_sharpe: conFrontera ? simulacion(conLista ? { ...propuestas, NH: 0 } : propuestas) : null,
    frontier: conFrontera ? frontera : null,
    frontier_unavailable_reason: conFrontera ? null : "La frontera solo usa activos que se pueden comprar y necesita al menos dos.",
    coverage_weight_percent: 100, extensions: [], methodology: "",
    ...(conLista ? { frontier_excluded_assets: [{ asset_id: "NH", reason: "FROZEN_PRICE", weight: 0.1 }] } : {})
  };
}

const activo = (asset_id: string, display_name: string) => ({ asset_id, display_name }) as BdbAssetDetail;
const ACTIVOS = [activo("A", "Fondo A"), activo("B", "Fondo B"), activo("NH", "NH Hotel Group")];
const nombreDe = (id: string) => ACTIVOS.find((a) => a.asset_id === id)?.display_name ?? id;

describe("el adaptador lee lo que no entra en la frontera", () => {
  test("un servidor de antes no manda la lista: queda vacía y no hay nota", () => {
    const analisis = parsePortfolioHorizon(respuesta({ conLista: false }), "3Y");
    expect(analisis.frontierNotSelectable).toEqual([]);
    expect(notaDeLoQueNoEntraEnLaFrontera(analisis, nombreDe, { hayFrontera: true })).toBeNull();
    expect(fraseDelMaximoSinLoQueNoSePuedeComprar(analisis, nombreDe)).toBeNull();
    const html = renderToStaticMarkup(createElement(HorizonFrontier, { analysis: analisis, assets: ACTIVOS }));
    expect(html).not.toContain("Fuera de la frontera");
  });

  test("el servidor nuevo la manda: activo, motivo con su rótulo y peso en decimal", () => {
    const analisis = parsePortfolioHorizon(respuesta({ conLista: true }), "3Y");
    expect(analisis.frontierNotSelectable).toEqual([{ assetId: "NH", reason: "FROZEN_PRICE", reasonLabel: "precio congelado", weight: 0.1 }]);
    /* No se mezcla con lo que no se ha podido medir. */
    expect(analisis.backtest.excluded_assets).toEqual([]);
    expect(analisis.frontier?.excluded).toEqual([]);
  });

  test("los tres motivos y uno que el sitio no conozca", () => {
    const lista = parseFrontierNotSelectable([
      { asset_id: "A", reason: "CORPORATE_ACTION", weight: 0.2 },
      { asset_id: "B", reason: "SELECTION_BLOCKED", weight: 0.3 },
      { asset_id: "NH", reason: "OTRO_DE_MAS_ADELANTE", weight: 0.5 }
    ], IDS);
    expect(lista.map((a) => a.reasonLabel)).toEqual(["operación corporativa", "bloqueado para nuevas compras", "no se puede comprar"]);
  });

  test("rechaza un activo ajeno a la cartera medida, uno repetido y un peso imposible", () => {
    expect(() => parseFrontierNotSelectable([{ asset_id: "X", reason: "FROZEN_PRICE", weight: 0.1 }], IDS)).toThrow(/ajeno/);
    expect(() => parseFrontierNotSelectable([{ asset_id: "NH", reason: "FROZEN_PRICE", weight: 0.1 }, { asset_id: "NH", reason: "FROZEN_PRICE", weight: 0.1 }], IDS)).toThrow(/ajeno/);
    expect(() => parseFrontierNotSelectable([{ asset_id: "NH", reason: "FROZEN_PRICE", weight: 1.5 }], IDS)).toThrow(/peso|weight/);
    expect(() => parseFrontierNotSelectable({}, IDS)).toThrow(/array/);
  });

  test("si una cartera propuesta llevara peso en lo apartado, la respuesta no se acepta", () => {
    const mal = respuesta({ conLista: true });
    (mal.frontier as { max_sharpe_portfolio: { weights: Record<string, number> } }).max_sharpe_portfolio.weights = { A: 0.5, B: 0.3, NH: 0.2 };
    expect(() => parsePortfolioHorizon(mal, "3Y")).toThrow(/no se puede comprar/);
    const malSimulada = respuesta({ conLista: true });
    (malSimulada.max_sharpe as { weights_normalized: Record<string, number> }).weights_normalized = { A: 0.5, B: 0.3, NH: 0.2 };
    expect(() => parsePortfolioHorizon(malSimulada, "3Y")).toThrow(/no se puede comprar/);
  });
});

describe("la nota junto a la frontera", () => {
  const conLista = (): PortfolioHorizon => parsePortfolioHorizon(respuesta({ conLista: true }), "3Y");

  test("dice qué no entra, por qué y con cuánto peso, y que las cifras de la cartera sí lo incluyen", () => {
    const html = renderToStaticMarkup(createElement(HorizonFrontier, { analysis: conLista(), assets: ACTIVOS }));
    expect(html).toContain("Fuera de la frontera.");
    expect(html).toContain("No entra en la frontera porque no se puede comprar: NH Hotel Group (precio congelado, 10,0 % de la cartera). "
      + "Las cifras de la cartera sí lo incluyen, y por eso su punto puede quedar fuera de la curva.");
  });

  test("en el lateral de Componer, también", () => {
    const html = renderToStaticMarkup(createElement(HorizonFrontier, { analysis: conLista(), assets: ACTIVOS, compacta: true }));
    expect(html).toContain("NH Hotel Group (precio congelado");
  });

  test("sin frontera, el motivo y la nota, sin hablar de un punto que no se dibuja", () => {
    const analisis = parsePortfolioHorizon(respuesta({ conLista: true, conFrontera: false }), "3Y");
    const html = renderToStaticMarkup(createElement(HorizonFrontier, { analysis: analisis, assets: ACTIVOS }));
    expect(html).toContain("La frontera solo usa activos que se pueden comprar");
    expect(html).toContain("Las cifras de la cartera sí lo incluyen.");
    expect(html).not.toContain("fuera de la curva");
  });

  test("con varios, en plural y separados", () => {
    const analisis = { ...conLista(), frontierNotSelectable: [
      { assetId: "NH", reason: "FROZEN_PRICE" as const, reasonLabel: "precio congelado", weight: 0.1 },
      { assetId: "B", reason: "CORPORATE_ACTION" as const, reasonLabel: "operación corporativa", weight: 0.4 }
    ] };
    expect(notaDeLoQueNoEntraEnLaFrontera(analisis, nombreDe, { hayFrontera: true })).toBe(
      "No entran en la frontera porque no se pueden comprar: NH Hotel Group (precio congelado, 10,0 % de la cartera); "
      + "Fondo B (operación corporativa, 40,0 % de la cartera). Las cifras de la cartera sí los incluyen, y por eso su punto puede quedar fuera de la curva.");
  });

  test("la Comparativa y el informe completo dicen lo mismo", () => {
    const analisis = conLista();
    expect(fraseDelMaximoSinLoQueNoSePuedeComprar(analisis, nombreDe)).toBe(
      "La de Máximo Sharpe no lleva NH Hotel Group (precio congelado): no se puede comprar. La cartera actual sí lo lleva.");
    const m = { positions: ACTIVOS.map((a) => ({ assetId: a.asset_id, name: a.display_name })) } as never;
    const cinco = { ...analisis, years: 5 as const };
    /* La misma lista en las dos ventanas se dice una vez. */
    expect(notasDeLoQueNoEntra(m, [{ horizon: analisis }, { horizon: cinco }], true)).toBe(notaDeLoQueNoEntraEnLaFrontera(analisis, nombreDe, { hayFrontera: true }));
    expect(notasDeLoQueNoEntra(m, [{ horizon: { ...analisis, frontierNotSelectable: [] } }], true)).toBeNull();
  });
});
