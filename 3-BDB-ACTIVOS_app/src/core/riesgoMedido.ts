import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import { LONG_WINDOW_METRIC_COVERAGE_THRESHOLD } from "./portfolio";

export interface RiesgoMedido {
  cagr: number;
  volatility: number;
  /** `null` con volatilidad cero: el Sharpe no existe (hallazgo 11). Las otras tres cifras siguen siendo de la cartera. */
  sharpe: number | null;
  maxDrawdown: number;
  /** Parte del peso de la cartera que entra en la simulación, de 0 a 100. */
  pesoPct: number;
  /** El periodo que se ha medido. */
  desde?: string;
  hasta?: string;
}

/** Por debajo de este peso no hay cifra de la cartera (decisiones 20 y 36). */
export const PESO_MINIMO_MEDIDO_PCT = LONG_WINDOW_METRIC_COVERAGE_THRESHOLD * 100;

/**
 * Si lo medido da para hablar de la cartera entera. La cuenta del servidor es `100 * cubierto / total` en coma flotante, y un
 * 80 % justo puede llegar como 79,99999999999999: eso es un 80, no un 79,9. El margen no llega a la milésima de un punto.
 */
export function hayCifraDeCartera(pesoMedidoPct: number | null | undefined): boolean {
  return typeof pesoMedidoPct === "number" && pesoMedidoPct >= PESO_MINIMO_MEDIDO_PCT - 1e-9;
}

/**
 * Lo que mide la simulación con las series de la cartera, si cubre bastante peso para hablar de
 * la cartera entera. Por debajo no hay cifra de cartera (decisión 36): una suma de lo que tiene dato se queda muy lejos
 * (2,5 % frente a 5,86 % medidos en una cartera real).
 */
export function riesgoMedidoDe(horizonte: PortfolioHorizon | null | undefined): RiesgoMedido | undefined {
  if (!horizonte || !hayCifraDeCartera(horizonte.coverageWeightPercent)) return undefined;
  const { cagr, volatility, sharpe, max_drawdown: maxDrawdown } = horizonte.backtest.metrics;
  if (![cagr, volatility, maxDrawdown].every((cifra) => Number.isFinite(cifra))) return undefined;
  if (sharpe !== null && !Number.isFinite(sharpe)) return undefined;
  const { first_date: desde, last_date: hasta } = horizonte.backtest.coverage ?? {};
  return { cagr, volatility, sharpe, maxDrawdown, pesoPct: horizonte.coverageWeightPercent, desde: desde ?? undefined, hasta: hasta ?? undefined };
}
