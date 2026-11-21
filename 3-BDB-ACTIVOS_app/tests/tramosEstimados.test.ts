import { describe, expect, test } from "vitest";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { conTramosEstimados, riesgoParaElAnalisisIA } from "../src/core/medidaDeLaCartera";
import { evaluatePortfolioHealth } from "../src/core/portfolioHealth";
import { leerSaludYControl } from "../src/core/saludYControl";

/* Decisión 58: lo que se mide con un tramo reconstruido desde una referencia se rotula «estimado» donde se enseñe. */
const TRAMO = {
  assetId: "E", reference: "Índice de prueba", url: "", estimatedFrom: "2023-10-27", estimatedUntil: "2025-02-07", observedFrom: "2025-02-10",
  validationWeeks: 80, holdoutCorrelation: 0.97, residualVolatility: 0.08, referenceHasBacktestedHistory: true
};
const APORTACIONES = [{ asset_id: "E", weight_pct: 50, risk_pct: 68.5 }, { asset_id: "B", weight_pct: 50, risk_pct: 31.5 }];
const horizonte = (extensions: unknown[]) => ({
  window: "3Y",
  years: 3,
  referenceVersion: "2026-10",
  coverageWeightPercent: 100,
  extensions,
  frontier: { riskContributions: APORTACIONES },
  backtest: {
    metrics: { cagr: 0.2315, volatility: 0.1818, sharpe: 1.12, max_drawdown: -0.2455, rf_rate: 0.0274 },
    coverage: { first_date: "2023-10-27", last_date: "2026-10-30" },
    asset_ids: ["E", "B"],
    excluded_assets: []
  }
}) as unknown as PortfolioHorizon;
const posiciones = [{ asset_id: "E", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }];
const activos = [{ asset_id: "E", display_name: "ETF joven", metrics: {} }, { asset_id: "B", display_name: "Fondo viejo", metrics: {} }] as never[];
const salud = (medida: PortfolioHorizon) => leerSaludYControl({
  positions: posiciones, assets: activos, feasibility: null, midiendo: false, horizonte: medida,
  salud: evaluatePortfolioHealth({ positions: posiciones, assets: activos, riskContributions: APORTACIONES, riesgoMedido: true })
});

describe("una simulación con tramos estimados lo dice", () => {
  test("con tramo, sí; sin tramo o sin simulación, no", () => {
    expect(conTramosEstimados(horizonte([TRAMO]))).toBe(true);
    expect(conTramosEstimados(horizonte([]))).toBe(false);
    expect(conTramosEstimados(null)).toBe(false);
  });

  test("«Salud y control» rotula la volatilidad y la aportación, y no llama medido a secas a lo que es en parte estimado", () => {
    const { filas, alertas } = salud(horizonte([TRAMO]));
    const rotulos = filas.map((fila) => fila.rotulo);
    expect(rotulos).toContain("Volatilidad 3 años · estimado");
    expect(rotulos).toContain("Mayor aportación al riesgo · estimado");
    /* El informe interno busca esta fila por su nombre: se queda igual, y lo dice su nota. */
    expect(filas.find((fila) => fila.rotulo === "Peso medido")?.nota).toBe("a revisar por debajo del 80 %; incluye tramos estimados");
    expect(alertas.find((alerta) => alerta.clave.startsWith("RISK_CONTRIBUTION"))?.texto).toContain("con 50,0\u00a0% de la parte medida · estimado.");
  });

  test("sin tramos, las mismas filas no dicen nada de eso", () => {
    const { filas, alertas } = salud(horizonte([]));
    const rotulos = filas.map((fila) => fila.rotulo);
    expect(rotulos).toContain("Volatilidad 3 años");
    expect(rotulos).toContain("Mayor aportación al riesgo");
    expect(filas.find((fila) => fila.rotulo === "Peso medido")?.nota).toBe("a revisar por debajo del 80 %");
    expect(JSON.stringify({ filas, alertas })).not.toContain("estimado");
  });

  test("a «Análisis IA» se le dice, para que no repita la cifra como observada", () => {
    const origen = (medida: PortfolioHorizon) => (riesgoParaElAnalisisIA(medida).riesgo_de_la_cartera as { origen: string }).origen;
    expect(origen(horizonte([TRAMO]))).toContain("en parte estimada");
    expect(origen(horizonte([]))).toBe("simulación con los pesos de hoy, sin reequilibrar");
  });
});
