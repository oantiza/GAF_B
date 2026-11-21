import { describe, expect, test } from "vitest";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { evaluatePortfolioHealth } from "../src/core/portfolioHealth";
import { riesgoMedidoDe } from "../src/core/riesgoMedido";
import { leerSaludYControl } from "../src/core/saludYControl";

const horizonte = (coverageWeightPercent: number) => ({
  coverageWeightPercent,
  years: 3,
  backtest: { metrics: { cagr: 0.0832, volatility: 0.0586, sharpe: 0.95, max_drawdown: -0.0838, rf_rate: 0.0274 } }
}) as unknown as PortfolioHorizon;

const posiciones = [{ asset_id: "A", weight_percent: 100 }];
/* La fila de volatilidad de «Salud y control», que leen la pantalla y el informe interno. */
const volatilidad = (medida?: PortfolioHorizon) =>
  leerSaludYControl({
    positions: posiciones, assets: [], feasibility: null, midiendo: false, horizonte: medida ?? null,
    salud: evaluatePortfolioHealth({ positions: posiciones, assets: [] })
  }).filas.find((fila) => fila.rotulo.startsWith("Volatilidad"));

describe("el riesgo medido con series", () => {
  test("entra si cubre al menos el 80 % del peso", () => {
    expect(riesgoMedidoDe(horizonte(87))?.volatility).toBe(0.0586);
    expect(riesgoMedidoDe(horizonte(80))?.pesoPct).toBe(80);
  });

  test("por debajo, o sin simulacion, no se presenta como medida de la cartera", () => {
    expect(riesgoMedidoDe(horizonte(79.9))).toBeUndefined();
    expect(riesgoMedidoDe(null)).toBeUndefined();
  });

  test("un 80 % justo en coma flotante es un 80; un 79,99 no", () => {
    expect(riesgoMedidoDe(horizonte(79.99999999999999))?.volatility).toBe(0.0586);
    expect(riesgoMedidoDe(horizonte(79.99))).toBeUndefined();
  });

  test("la lectura de salud prefiere lo medido", () => {
    const fila = volatilidad(horizonte(87));
    expect(fila?.rotulo).toBe("Volatilidad 3 años");
    expect(fila?.cifra).toContain("5,86\u00a0%");
  });

  test("sin medida no hay volatilidad de la cartera: la lectura ya ni recibe la suma ponderada (decisiones 36 y 59)", () => {
    for (const fila of [volatilidad(), volatilidad(horizonte(79.9))]) {
      expect(fila?.rotulo).toBe("Volatilidad");
      expect(fila?.cifra).toBeUndefined();
      expect(fila?.ausencia).toBe("falta");
    }
    expect(volatilidad(horizonte(79.9))?.nota).toBe("La simulación mide el 79,9\u00a0% del peso; hace falta al menos el 80 %.");
  });
});
