import type { BacktestResponse } from "../../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../../src/adapters/portfolioHorizon";

/** Una simulación con lo que lee el papel. Mide toda la cartera si no se le dice otra cosa. */
export function horizonteDePrueba(backtest: BacktestResponse, extra: Partial<PortfolioHorizon> = {}): PortfolioHorizon {
  return {
    window: backtest.window as PortfolioHorizon["window"],
    years: backtest.window === "5Y" ? 5 : 3,
    referenceVersion: "test",
    backtest,
    frontier: null,
    equalWeight: backtest,
    maxSharpe: null,
    coverageWeightPercent: 100,
    extensions: [],
    methodology: "",
    ...extra
  };
}
