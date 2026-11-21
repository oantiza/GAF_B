/**
 * INF-5 (auditoría integral del 16-11-2026): con todos los pesos a cero, «Calculando…» no terminaba.
 *
 * El gancho del análisis no pide nada si ninguna posición tiene peso —no hay qué medir—, y sin datos ni error las
 * pantallas leían «calculando» para siempre. Ahora el gancho dice que no hay pesos y cada panel lo escribe.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BacktestComparison } from "../src/components/BacktestComparison";
import { PortfolioHorizonPanel } from "../src/components/PortfolioHorizonPanel";
import { SIN_PESOS_NO_HAY_SIMULACION } from "../src/core/textoDeAusencia";

const A_CERO = [{ asset_id: "A", weight_percent: 0 }, { asset_id: "B", weight_percent: 0 }];
const CON_PESO = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];

describe("sin ningún peso no hay nada que calcular, y se dice", () => {
  test.each(["metricas", "frontera", "full"] as const)("el panel de la simulación, variante «%s»", (variant) => {
    const sinPesos = renderToStaticMarkup(createElement(PortfolioHorizonPanel, { positions: A_CERO, variant }));
    expect(sinPesos).toContain(SIN_PESOS_NO_HAY_SIMULACION);
    expect(sinPesos).not.toContain("Calculando");
    /* Con pesos sigue esperando al cálculo, como siempre. */
    const conPesos = renderToStaticMarkup(createElement(PortfolioHorizonPanel, { positions: CON_PESO, variant }));
    expect(conPesos).toContain("Calculando el periodo completo…");
    expect(conPesos).not.toContain(SIN_PESOS_NO_HAY_SIMULACION);
  });

  test("la comparativa del periodo", () => {
    const sinPesos = renderToStaticMarkup(createElement(BacktestComparison, { positions: A_CERO, assets: [] }));
    expect(sinPesos).toContain(SIN_PESOS_NO_HAY_SIMULACION);
    expect(sinPesos).not.toContain("Calculando");
    const conPesos = renderToStaticMarkup(createElement(BacktestComparison, { positions: CON_PESO, assets: [] }));
    expect(conPesos).toContain("Calculando la comparativa del periodo…");
  });
});
