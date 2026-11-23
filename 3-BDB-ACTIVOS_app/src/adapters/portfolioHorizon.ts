import { exigeAnualizado, parseBacktestResponse, type BacktestAnualizado } from "./backtestPortfolioBackend";
import { parsePortfolioFrontierResponse, buildFrontierViewModel, parseFrontierNotSelectable, parseRiskContributionBlock } from "./portfolioFrontierAdapter";
import { requireArray, requireNumber, requireObject, requireString } from "./contractGuards";
import type { AnalysisWindow } from "../core/analysisPreferences";
import { oFalta, peso } from "../core/formato";
import { registerSessionCache, sessionCacheEpoch } from "../core/sessionCaches";
import { SharedRequestCache } from "../core/sharedRequestCache";
import { parteMedidaDeLaSimulacion } from "../core/parteMedida";
import { canProjectReportBacktest } from "../core/reportMonteCarlo";
import type { FrontierNotSelectableView, FrontierViewModel, PortfolioRiskContribution, PortfolioRiskContributionMeta } from "../types/portfolioFrontier";

export type HorizonPosition = { asset_id: string; weight_percent: number };
export interface HistoryExtension {
  assetId: string; reference: string; url: string; estimatedFrom: string; estimatedUntil: string;
  observedFrom: string; validationWeeks: number; holdoutCorrelation: number; residualVolatility: number;
  referenceHasBacktestedHistory: boolean;
}
export interface PortfolioHorizon {
  window: AnalysisWindow; years: 3 | 5; referenceVersion: string; backtest: BacktestAnualizado;
  frontier: FrontierViewModel | null; frontierUnavailableReason?: string;
  /** Pesos iguales entre lo que se puede comprar, con la misma regla que la frontera. Vacía si no se puede comprar nada. */
  equalWeight: BacktestAnualizado | null; maxSharpe: BacktestAnualizado | null;
  coverageWeightPercent: number; extensions: HistoryExtension[]; methodology: string;
  /** La aportación al riesgo de cada posición: la de la frontera si la hay, y si no, la que la simulación manda aparte (más de 40 activos). */
  riskContributions?: PortfolioRiskContribution[] | null;
  riskContributionsMeta?: PortfolioRiskContributionMeta;
  /**
   * Lo que se mide en la cartera y no entra en la frontera ni en sus carteras, porque no se puede comprar (decisión de Óscar,
   * 15-11-2026). Vacía si no hay ninguno o si el servidor es anterior y no la manda. No es `backtest.excluded_assets`: aquello
   * no se ha podido medir; esto sí está en las cifras de la cartera.
   */
  frontierNotSelectable?: FrontierNotSelectableView[];
}

/** Una cifra del papel, con su rótulo. */
export interface CifraDelHorizonte {
  value: number;
  label: string;
}

/** El Sharpe, que puede ir vacío: con volatilidad cero no existe (hallazgo 11) y se escribe que falta. */
export interface SharpeDelHorizonte {
  value: number | null;
  label: string;
}

export interface CifrasDelHorizonte {
  cagr: CifraDelHorizonte;
  volatility: CifraDelHorizonte;
  sharpe: SharpeDelHorizonte;
  maxDrawdown: CifraDelHorizonte;
  riskFree: CifraDelHorizonte;
  /** De dónde salen, para la nota bajo la tira cuando hace falta decirlo. */
  sourceNote: string;
}

export function parsePortfolioHorizon(raw: unknown, window: AnalysisWindow): PortfolioHorizon {
  const data = requireObject(raw, "analysis");
  if (data.schema_version !== "portfolio-horizon.v1" || data.window !== window || data.horizon_years !== Number(window[0])) {
    throw new Error("El análisis recibido no corresponde al periodo elegido.");
  }
  const backtest = exigeAnualizado(parseBacktestResponse(data.backtest), "backtest");
  const equalWeight = data.equal_weight ? exigeAnualizado(parseBacktestResponse(data.equal_weight), "equal_weight") : null;
  const maxSharpe = data.max_sharpe ? exigeAnualizado(parseBacktestResponse(data.max_sharpe), "max_sharpe") : null;
  const frontier = data.frontier ? buildFrontierViewModel(parsePortfolioFrontierResponse(data.frontier)) : null;
  const first = backtest.coverage?.first_date;
  const last = backtest.coverage?.last_date;
  const span = first && last ? (Date.parse(last) - Date.parse(first)) / 86400000 : 0;
  if (backtest.window !== window || span < Number(window[0]) * 365 || span > Number(window[0]) * 366 + 7) {
    throw new Error("El histórico no cubre el periodo completo seleccionado.");
  }
  for (const comparison of [equalWeight, maxSharpe].filter((b): b is BacktestAnualizado => !!b)) {
    if (comparison.window !== window || comparison.asset_ids.join() !== backtest.asset_ids.join()
      || comparison.coverage?.first_date !== first || comparison.coverage?.last_date !== last) {
      throw new Error("La comparación utiliza otro periodo o conjunto de activos.");
    }
  }
  if (frontier && (frontier.window !== window || frontier.coverage.firstDate !== first || frontier.coverage.lastDate !== last)) {
    throw new Error("La frontera no coincide con el periodo del análisis.");
  }
  const coverageWeightPercent = requireNumber(data.coverage_weight_percent, "coverage_weight_percent");
  if (coverageWeightPercent <= 0 || coverageWeightPercent > 100.000001) throw new Error("Cobertura inválida.");
  const extensions = requireArray(data.extensions, "extensions").map((row) => {
    const p = requireObject(row, "extension");
    const str = (key: string) => requireString(p[key], key);
    return { assetId: str("asset_id"), reference: str("reference"), url: str("url"),
      estimatedFrom: str("estimated_from"), estimatedUntil: str("estimated_until"), observedFrom: str("observed_from"),
      validationWeeks: requireNumber(p.validation_weeks, "validation_weeks"),
      holdoutCorrelation: requireNumber(p.holdout_correlation, "holdout_correlation"),
      residualVolatility: requireNumber(p.residual_volatility, "residual_volatility"),
      referenceHasBacktestedHistory: p.reference_has_backtested_history === true };
  });
  if (extensions.some((e) => !backtest.asset_ids.includes(e.assetId))) throw new Error("Referencia ajena al análisis.");
  if (frontier) frontier.label = `Frontera eficiente · ${window[0]} años${extensions.length ? " · estimada" : ""}`;
  /* Con frontera, la aportación es la suya y no viene otra. Sin ella (más de 40 activos medidos) viaja aparte. */
  if (frontier && (data.risk_contributions !== undefined || data.risk_contributions_meta !== undefined)) {
    throw new Error("La aportación al riesgo llega dos veces.");
  }
  const aparte = frontier ? null : parseRiskContributionBlock(data.risk_contributions, data.risk_contributions_meta);
  if (aparte?.riskContributions?.some((row) => !backtest.asset_ids.includes(row.asset_id))) throw new Error("Aportación al riesgo ajena al análisis.");
  const frontierNotSelectable = parseFrontierNotSelectable(data.frontier_excluded_assets, backtest.asset_ids);
  /* Ninguna cartera propuesta lleva peso en lo que no se puede comprar: si llegara, la respuesta no es de fiar. */
  const propuestas = frontier ? [frontier.maxSharpe, frontier.minVolatility, ...(frontier.target ? [frontier.target] : []), ...(frontier.targetReturn ? [frontier.targetReturn] : [])] : [];
  for (const { assetId } of frontierNotSelectable) {
    if (propuestas.some((p) => (p.pesosCompletos?.[assetId] ?? 0) > 1e-9) || (maxSharpe?.weights_normalized[assetId] ?? 0) > 1e-9
      || (equalWeight?.weights_normalized[assetId] ?? 0) > 1e-9) {
      throw new Error("La frontera propone peso en un activo que no se puede comprar.");
    }
  }
  /* Sin equiponderada solo se responde cuando no queda nada que se pueda comprar: si no, falta algo que debía venir. */
  if (!equalWeight && frontierNotSelectable.length !== backtest.asset_ids.length) throw new Error("Falta la cartera equiponderada.");
  const riskContributions = frontier ? frontier.riskContributions : aparte?.riskContributions;
  const riskContributionsMeta = frontier ? frontier.riskContributionsMeta : aparte?.riskContributionsMeta;
  return { window, years: window === "3Y" ? 3 : 5, referenceVersion: requireString(data.reference_version, "reference_version"),
    backtest, equalWeight, maxSharpe, frontier, coverageWeightPercent, extensions, frontierNotSelectable,
    ...(riskContributions !== undefined ? { riskContributions } : {}),
    ...(riskContributionsMeta !== undefined ? { riskContributionsMeta } : {}),
    frontierUnavailableReason: typeof data.frontier_unavailable_reason === "string" ? data.frontier_unavailable_reason : undefined,
    methodology: requireString(data.methodology, "methodology") };
}

/**
 * Values remain decimal; the same resolution feeds the screen and PDF. Los rótulos solo los imprime el informe de
 * cliente: la pantalla escribe los suyos con el mismo glosario, y el interno no pasa por aquí y conserva sus siglas.
 */
export function resolveHorizonMetrics(analysis: PortfolioHorizon): CifrasDelHorizonte {
  const { metrics } = analysis.backtest;
  const estimated = analysis.extensions.length > 0;
  const metric = <T extends number | null>(label: string, value: T) => ({
    label: `${label} ${analysis.years} años${estimated ? " · estimado" : ""}`, value
  });
  return { cagr: metric("Rentabilidad anualizada", metrics.cagr), volatility: metric("Volatilidad", metrics.volatility),
    sharpe: metric("Sharpe", metrics.sharpe), maxDrawdown: metric("Caída máxima", metrics.max_drawdown),
    riskFree: { label: `Tipo sin riesgo ${analysis.years} años`, value: metrics.rf_rate },
    sourceNote: `${analysis.referenceVersion === "demo-synthetic.v1" ? "Datos de muestra · series sintéticas" : estimated ? "Histórico ampliado con referencias" : "Histórico observado"} · ${analysis.years} años · ${oFalta(peso(analysis.coverageWeightPercent / 100))} del peso` };
}

const cache = new SharedRequestCache<PortfolioHorizon>(2, 5 * 60_000, 16);
registerSessionCache(() => cache.clear());
export function horizonFingerprint(positions: readonly HorizonPosition[], window: AnalysisWindow) {
  const weights = new Map<string, number>();
  for (const p of positions) if (Number.isFinite(p.weight_percent) && p.weight_percent > 0) {
    weights.set(p.asset_id, (weights.get(p.asset_id) ?? 0) + p.weight_percent);
  }
  return JSON.stringify([sessionCacheEpoch(), window, [...weights].sort(([a], [b]) => a.localeCompare(b))]);
}
export function fetchPortfolioHorizon(positions: readonly HorizonPosition[], window: AnalysisWindow, signal?: AbortSignal): Promise<PortfolioHorizon> {
  const key = horizonFingerprint(positions, window);
  const epoch = sessionCacheEpoch();
  return cache.get(key, () => import("./callableBackend").then(({ callBackend }) => callBackend("backtest_portfolio", {
    analysis_bundle: true, window,
    positions: positions.filter((p) => p.weight_percent > 0).map((p) => ({ asset_id: p.asset_id, weight: p.weight_percent / 100 }))
  }, "No se pudo calcular el análisis del periodo.", { timeout: 300000 }))
    .then((raw) => {
      if (epoch !== sessionCacheEpoch()) throw new Error("La sesión ha cambiado.");
      const result = parsePortfolioHorizon(raw, window);
      const parteMedida = canProjectReportBacktest(result.backtest) ? parteMedidaDeLaSimulacion(result.backtest, positions) : null;
      if (!parteMedida || Math.abs(parteMedida.weightPercent - result.coverageWeightPercent) > .0001) {
        throw new Error("La cobertura recibida no corresponde a la cartera.");
      }
      if (result.frontier) result.frontier.portfolioCoverage = parteMedida;
      return result;
    }), signal);
}
