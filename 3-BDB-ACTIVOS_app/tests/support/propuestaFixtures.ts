/**
 * Lo que necesita la Propuesta de cambio para generarse sin servidor: dos composiciones con resultado conocido, calculado a mano.
 *
 * Actual: Fondo A 60 % (coste 1,00 %) y Fondo B 40 % (0,50 %). Propuesta: Fondo A 50 %, Fondo C 30 % (0,20 %) e Iberdrola 20 %.
 * La media de coste de Actual es 0,6 × 1,00 + 0,4 × 0,50 = 0,80 %; la de Propuesta, 0,5 × 1,00 + 0,3 × 0,20 + 0,2 × 0 = 0,56 %.
 * Cambia de posición la mitad de 10 + 40 + 30 + 20 = 50 puntos.
 */
import type { BacktestResponse, BacktestSeriesPoint, BacktestStressScenario } from "../../src/adapters/backtestPortfolioBackend";
import type { ComparisonHistory } from "../../src/core/portfolioComparison";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../../src/types/bdbAssets";

export const activo = (asset_id: string, display_name: string, ongoing_charge: number | null, instrument_type = "FUND") =>
  ({ asset_id, isin: asset_id, display_name, instrument_type, costs: { ongoing_charge }, category: "Renta variable", currency: "EUR" }) as unknown as BdbAssetDetail;

export const ACTIVOS = [
  activo("LU0000000001", "Fondo A", 0.01),
  activo("LU0000000002", "Fondo B", 0.005),
  activo("LU0000000003", "Fondo C", 0.002),
  activo("ES0144580Y14", "Iberdrola", null, "STOCK")
];

const posicion = (asset_id: string, weight_percent: number): BdbManualPortfolioPosition => ({ asset_id, weight_percent });

export const ACTUAL = { name: "Cartera de hoy", positions: [posicion("LU0000000001", 60), posicion("LU0000000002", 40)] };
export const PROPUESTA = { name: "Cartera propuesta", positions: [posicion("LU0000000001", 50), posicion("LU0000000003", 30), posicion("ES0144580Y14", 20)] };

/** Lunes a lunes, desde el 02-01-2023: una observación por semana. */
export function semanas(valores: readonly number[], desde = "2023-01-02"): BacktestSeriesPoint[] {
  const inicio = Date.parse(`${desde}T00:00:00Z`);
  return valores.map((value, i) => ({ date: new Date(inicio + i * 7 * 86400000).toISOString().slice(0, 10), value }));
}

export function escenario(id: BacktestStressScenario["id"], cambios: Partial<BacktestStressScenario> = {}): BacktestStressScenario {
  return {
    id,
    label: id,
    configured_start_date: id === "COVID" ? "2020-02-19" : "2022-01-03",
    configured_end_date: id === "COVID" ? "2020-03-23" : "2022-10-12",
    start_date: null,
    end_date: null,
    trough_date: null,
    common_data_end_date: null,
    drawdown_pct: null,
    duration_days: null,
    recovery_date: null,
    recovery_days: null,
    remaining_to_recover_pct: null,
    recovery_status: "NO_DATA",
    worst_asset: null,
    coverage: { included_assets: 0, total_assets: 2, weight_pct: 0 },
    excluded_assets: [],
    representative: false,
    reason: "NO_ELIGIBLE_ASSETS",
    ...cambios
  } as BacktestStressScenario;
}

export function crisisConCifra(id: "COVID" | "RATES_2022", cifra: number, peso = 100, dentro = 2, total = 2, fuera: BacktestStressScenario["excluded_assets"] = []): BacktestStressScenario {
  const fechas = id === "COVID" ? ["2020-02-19", "2020-03-23"] : ["2022-01-04", "2022-10-12"];
  return escenario(id, {
    start_date: fechas[0],
    trough_date: fechas[1],
    end_date: fechas[1],
    drawdown_pct: cifra,
    coverage: { included_assets: dentro, total_assets: total, weight_pct: peso } as BacktestStressScenario["coverage"],
    excluded_assets: fuera,
    representative: peso >= 60,
    reason: null
  } as Partial<BacktestStressScenario>);
}

export function historia(
  ids: readonly string[],
  serie: BacktestSeriesPoint[],
  cambios: Partial<BacktestResponse> = {},
  extensionNotes: string[] = []
): ComparisonHistory {
  return {
    extensionNotes,
    backtest: {
      window: "3Y",
      base_currency: "EUR",
      frequency: "DAILY",
      asset_ids: [...ids],
      excluded_assets: [],
      warnings: [],
      metrics: { rf_rate: 0.02 },
      portfolio_series: serie,
      stress_scenarios: [escenario("COVID"), escenario("RATES_2022"), escenario("COMMON_HISTORY")],
      ...cambios
    } as unknown as BacktestResponse
  };
}

/** 157 semanas: 3 años largos, con una caída del 10 % en medio y un punto final conocido. */
export const SERIE_ACTUAL = semanas(Array.from({ length: 157 }, (_, i) => (i < 78 ? 100 + i * (10 / 77) : i === 78 ? 99 : 99 + (i - 78) * (34.1 / 78))));
export const SERIE_PROPUESTA = semanas(Array.from({ length: 157 }, (_, i) => (i < 78 ? 100 + i * (20 / 77) : i === 78 ? 96 : 96 + (i - 78) * (32 / 78))));
