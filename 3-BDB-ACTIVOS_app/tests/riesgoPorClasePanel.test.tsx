import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { RiesgoPorClase } from "../src/components/RiesgoPorClase";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/**
 * «Riesgo por clase de activo» en Análisis (AN1, 21-11-2026): la barra es lo que aporta cada clase, en su color, y debajo, lo
 * que pesa en la misma parte medida. La cuenta de las cifras, en `tests/riesgoPorClase.test.ts`.
 */

const activo = (asset_id: string, economic_asset_class: string) => ({ asset_id, economic_asset_class }) as unknown as BdbAssetDetail;
const ACTIVOS = [activo("A", "EQUITY"), activo("B", "FIXED_INCOME"), activo("C", "EQUITY")];

const horizonte = (extra: Partial<PortfolioHorizon>, ids = ["A", "B", "C"]): PortfolioHorizon =>
  ({
    window: "3Y",
    years: 3,
    coverageWeightPercent: 100,
    extensions: [],
    backtest: { asset_ids: ids },
    frontier: null,
    ...extra
  }) as unknown as PortfolioHorizon;

const APORTACIONES = [
  { asset_id: "A", weight_pct: 50, risk_pct: (100 * 0.0107375) / 0.0121 },
  { asset_id: "B", weight_pct: 30, risk_pct: (100 * -0.0000375) / 0.0121 },
  { asset_id: "C", weight_pct: 20, risk_pct: (100 * 0.0014) / 0.0121 }
];

const pintar = (props: Partial<Parameters<typeof RiesgoPorClase>[0]>) =>
  renderToStaticMarkup(createElement(RiesgoPorClase, { assets: ACTIVOS, horizonte: null, midiendo: false, anos: 3, ...props })).replaceAll(String.fromCharCode(160), " ");

describe("Riesgo por clase de activo", () => {
  test("una fila por clase con lo que aporta, lo que pesa, y la que reduce el riesgo lo dice", () => {
    const html = pintar({ horizonte: horizonte({ riskContributions: APORTACIONES, riskContributionsMeta: { cov_model: "LEDOIT_WOLF" } }) });
    expect(html).toContain("<h2");
    expect(html).toContain("Riesgo por clase de activo");
    expect(html).toContain("Aportación a la volatilidad, de la parte medida (100,0 % del peso) · 3 años");
    expect(html).toMatch(/Renta variable<span class="partes__apunte">pesa 70,0 %<\/span>/);
    expect(html).toMatch(/Renta fija<span class="partes__apunte">pesa 30,0 % · reduce el riesgo<\/span>/);
    expect(html).toContain("100,3 %");
    expect(html).toContain("−0,3 %");
    /* Cada clase, en su color: la renta variable y la renta fija no comparten. */
    const colores = [...html.matchAll(/--parte-color:([^;"]+)/g)].map(([, color]) => color.trim());
    expect(colores).toHaveLength(2);
    expect(new Set(colores).size).toBe(2);
    expect(html).not.toContain("Sin clasificar");
  });

  test("lo que no tiene clase se dice, apagado y al final", () => {
    const html = pintar({
      assets: [activo("A", "UNKNOWN"), activo("B", "FIXED_INCOME"), activo("C", "EQUITY")],
      horizonte: horizonte({ riskContributions: APORTACIONES, riskContributionsMeta: { cov_model: "LEDOIT_WOLF" } })
    });
    expect(html).toContain("partes__parte--apagada");
    expect(html).toContain("«Sin clasificar»: 1 posición sin clase de activo en su ficha.");
  });

  test("midiendo, con volatilidad nula, con un solo activo o sin aportaciones, no se inventa un reparto", () => {
    expect(pintar({ midiendo: true })).toContain("Midiendo…");
    expect(pintar({ horizonte: horizonte({ riskContributions: null, riskContributionsMeta: { cov_model: "LEDOIT_WOLF", reason: "ZERO_VOLATILITY" } }) })).toContain(
      "No aplica: la volatilidad de la cartera es nula"
    );
    expect(pintar({ horizonte: horizonte({}, ["A"]) })).toContain("No aplica: la simulación mide un solo activo");
    const sinDato = pintar({ horizonte: horizonte({}) });
    expect(sinDato).toContain("ausencia--falta");
    expect(sinDato).toContain("Falta el dato");
    for (const html of [sinDato, pintar({ midiendo: true })]) expect(html).not.toContain("partes__parte");
  });
});
