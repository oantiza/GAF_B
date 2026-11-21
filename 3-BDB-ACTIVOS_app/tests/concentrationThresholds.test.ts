import { describe, expect, test } from "vitest";
import { CONCENTRATION_THRESHOLDS, concentrationBand } from "../src/core/concentration";
import { buildReportFromAssets } from "../src/core/portfolio";
import { evaluatePortfolioHealth, PORTFOLIO_HEALTH_RULES } from "../src/core/portfolioHealth";
import { leerSaludYControl } from "../src/core/saludYControl";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

// MEDIA-06 (decisión de Óscar del 17-10-2026): la Radiografía, las reglas de salud y la
// lectura «Salud y control» miran la mayor posición con el mismo umbral, { watch: 25, high: 40 }.
// Antes, con una posición del 30 %, la misma pantalla decía «Balanceada» (35/50),
// un aviso (25/40) y «Alta» (15/30).

function asset(id: string): BdbAssetDetail {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY",
    currency: "EUR", coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE",
    quality_flags: [], warnings: [], description: "", metrics: { volatility_3y: 0.12 },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

/** La mayor posición pesa `top` y el resto se reparte en posiciones que no la superan. */
function portfolio(top: number): { positions: BdbManualPortfolioPosition[]; assets: BdbAssetDetail[] } {
  const rest = 100 - top;
  const others = Math.max(1, Math.ceil(rest / Math.min(top, 20)));
  const positions: BdbManualPortfolioPosition[] = [{ asset_id: "TOP", weight_percent: top }];
  for (let i = 0; i < others; i += 1) positions.push({ asset_id: `R${i}`, weight_percent: rest / others });
  return { positions, assets: positions.map((position) => asset(position.asset_id)) };
}

function levels(top: number) {
  const { positions, assets } = portfolio(top);
  const xray = buildReportFromAssets({ source: "LOCAL_MOCK", portfolioName: "Prueba", manualPositions: positions, assets }).xray;
  const salud = evaluatePortfolioHealth({ positions, assets });
  const health = salud.violations.find((v) => v.rule === "POSITION_WEIGHT" && v.asset_id === "TOP");
  const fila = leerSaludYControl({ positions, assets, feasibility: null, salud, horizonte: null, midiendo: false })
    .filas.find((item) => item.rotulo === "Mayor posición");
  return {
    xray: xray.concentration_level,
    health: health?.severity ?? "OK",
    umbral: fila?.nota
  };
}

describe("umbral único de concentración (MEDIA-06)", () => {
  test("la constante es la decidida y la Salud la usa", () => {
    expect(CONCENTRATION_THRESHOLDS).toEqual({ watch: 25, high: 40 });
    expect(PORTFOLIO_HEALTH_RULES.POSITION_WARN_WEIGHT_PCT).toBe(CONCENTRATION_THRESHOLDS.watch);
    expect(PORTFOLIO_HEALTH_RULES.POSITION_FAIL_WEIGHT_PCT).toBe(CONCENTRATION_THRESHOLDS.high);
  });

  test("las fronteras exactas no disparan", () => {
    expect(concentrationBand(25)).toBe("BALANCED");
    expect(concentrationBand(25.1)).toBe("WATCH");
    expect(concentrationBand(40)).toBe("WATCH");
    expect(concentrationBand(40.1)).toBe("HIGH");
  });

  test.each([
    [20, { xray: "BALANCED", health: "OK", umbral: "vigilar desde 25 %" }],
    [30, { xray: "WATCH", health: "WARN", umbral: "vigilar: pasa del 25 %; crítico si pasa del 40 %" }],
    [45, { xray: "CONCENTRATED", health: "FAIL", umbral: "crítico: pasa del 40 %" }]
  ])("una posición del %s %% da el mismo nivel en la Radiografía, la Salud y la lectura de Análisis", (top, expected) => {
    expect(levels(top)).toEqual(expected);
  });
});
