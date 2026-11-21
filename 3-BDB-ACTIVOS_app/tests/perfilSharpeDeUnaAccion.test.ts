/**
 * Perfil, «Datos disponibles» y «Datos faltantes»: el Sharpe de una acción no se enseña (§9 del método), y la regla vive en
 * `seEnsenaLaMetrica` (decisión 83). Con una sola acción, Perfil ponía «Sharpe 3 años» entre los datos disponibles: es el de esa acción.
 * Ahora ni está ni falta. Dos acciones siguen siendo una cartera. Lote T7.
 */
import { describe, expect, test } from "vitest";
import { buildSummaryFromAssets } from "../src/core/portfolio";
import { buildLocalRiskProfilePreview } from "../src/core/riskProfilePreview";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const ficha = (asset_id: string, instrument_type: string, metrics: Record<string, unknown> = {}, extra: Partial<BdbAssetDetail> = {}) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type,
    economic_asset_class: "EQUITY",
    currency: "EUR",
    is_investable: true,
    role: "INVESTABLE",
    coverage_status: "COMPLETE",
    quality_flags: [],
    warnings: [],
    metrics,
    ...extra
  }) as unknown as BdbAssetDetail;

/* Rentabilidad y volatilidad a 3 años, en semanal: con eso la cartera tiene Sharpe estimado. Sin caída, para que la lista sea corta. */
const CON_3A = (rentabilidad: number, volatilidad: number, extra: Record<string, unknown> = {}) => ({
  annualized_return_3y: rentabilidad,
  volatility_3y: volatilidad,
  metrics_frequency: "WEEKLY",
  ...extra
});
const IBE = ficha("IBE", "STOCK", CON_3A(0.08, 0.15));
const APL = ficha("APL", "STOCK", CON_3A(0.12, 0.25));
const FONDO = ficha("F", "FUND", CON_3A(0.05, 0.06, { risk_score: 3 }));
const FONDO_JOVEN = ficha("FJ", "FUND", { risk_score: 3 });
const DEOLEO = ficha("DEO", "STOCK", CON_3A(0.3, 0.6), { is_investable: false, quality_flags: ["QUALITY_BLOCKED"] });
const SIN_DATOS = ficha("SIN", "STOCK");

function perfil(posiciones: Array<[BdbAssetDetail, number]>) {
  const positions: BdbManualPortfolioPosition[] = posiciones.map(([asset, weight_percent]) => ({ asset_id: asset.asset_id, weight_percent }));
  const assets = [...new Map(posiciones.map(([asset]) => [asset.asset_id, asset])).values()];
  const vista = buildLocalRiskProfilePreview({
    sourceKind: "BBDD_LIVE_API",
    selectedProfileId: "RISK_5",
    positions,
    assets,
    summary: buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: positions, assets })
  });
  return { disponibles: vista.portfolio_metrics_available, faltan: vista.portfolio_metrics_missing };
}

describe("Perfil y el Sharpe de una sola acción", () => {
  test("una sola acción: «Sharpe 3 años» ni está ni falta, y lo demás sigue", () => {
    expect(perfil([[IBE, 100]])).toEqual({
      disponibles: ["rentabilidad anualizada 3 años", "volatilidad 3 años"],
      faltan: ["caída máxima histórica"]
    });
  });

  test("lo que se queda fuera no cuenta: una acción y Deoleo es una sola acción medida", () => {
    expect(perfil([[IBE, 90], [DEOLEO, 10]])).toEqual(perfil([[IBE, 100]]));
  });

  test("la misma acción en dos líneas sigue siendo una", () => {
    expect(perfil([[IBE, 60], [IBE, 40]]).disponibles).not.toContain("Sharpe 3 años");
  });

  test("si a lo demás le falta la rentabilidad a 3 años, lo que entra es la acción, y tampoco", () => {
    const { disponibles, faltan } = perfil([[IBE, 50], [FONDO_JOVEN, 50]]);
    expect(disponibles).not.toContain("Sharpe 3 años");
    expect(faltan).not.toContain("Sharpe 3 años");
  });

  test("una acción sin datos: falta lo suyo, pero no el Sharpe", () => {
    expect(perfil([[SIN_DATOS, 100]])).toEqual({
      disponibles: [],
      faltan: ["caída máxima histórica", "rentabilidad anualizada 3 años", "volatilidad 3 años"]
    });
  });

  test("dos acciones siguen siendo una cartera: su Sharpe se lista", () => {
    expect(perfil([[IBE, 50], [APL, 50]])).toEqual({
      disponibles: ["rentabilidad anualizada 3 años", "Sharpe 3 años", "volatilidad 3 años"],
      faltan: ["caída máxima histórica"]
    });
  });

  test("una acción con un fondo, y un fondo solo, también", () => {
    expect(perfil([[IBE, 50], [FONDO, 50]]).disponibles).toContain("Sharpe 3 años");
    expect(perfil([[FONDO, 100]]).disponibles).toContain("Sharpe 3 años");
  });
});

/**
 * Revisión final (V4-2): iShares Core MSCI World 50 e Iberdrola 50 en la base nueva. Perfil decía «Datos faltantes: Sharpe 3 años · volatilidad
 * 3 años» y «Métricas parciales (0 % de la cartera)», «Mezcla de divisas sin convertir», mientras Validación, en la misma pestaña, decía que las
 * posiciones usan métodos distintos, y Análisis daba 10,5 % y 2,37 al 100 % del peso. No falta nada: mensual y diario no se suman.
 */
describe("Perfil con métodos distintos dice lo mismo que Validación", () => {
  const ISHARES = ficha("ISH", "ETF", { annualized_return_3y: 0.15, volatility_3y: 0.12, risk_score: 6, metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY" }, { currency: "USD" });
  const IBERDROLA = ficha("IBE", "STOCK", { annualized_return_3y: 0.2, volatility_3y: 0.16, metrics_frequency: "DAILY" });
  const vista = () => {
    const positions: BdbManualPortfolioPosition[] = [{ asset_id: "ISH", weight_percent: 50 }, { asset_id: "IBE", weight_percent: 50 }];
    const assets = [ISHARES, IBERDROLA];
    return buildLocalRiskProfilePreview({
      sourceKind: "BBDD_LIVE_API",
      selectedProfileId: "RISK_5",
      positions,
      assets,
      summary: buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: positions, assets })
    });
  };

  test("la volatilidad y el Sharpe a 3 años ni están ni faltan: se miden en la simulación", () => {
    expect(vista().portfolio_metrics_available).toEqual(["indicador de riesgo de los activos", "rentabilidad anualizada 3 años"]);
    expect(vista().portfolio_metrics_missing).toEqual(["caída máxima histórica"]);
  });

  test("el aviso es el de Validación, sin un «0 %» que no es un dato ni una mezcla de divisas que no queda", () => {
    expect(vista().data_warnings).toEqual(["Las posiciones usan métodos distintos: el riesgo de la cartera se mide en la simulación."]);
  });

  test("con el mismo método, la volatilidad que falta sigue faltando", () => {
    const sinVolatilidad = ficha("F2", "FUND", { annualized_return_3y: 0.05, metrics_frequency: "MONTHLY", risk_score: 3 });
    const positions: BdbManualPortfolioPosition[] = [{ asset_id: "F2", weight_percent: 100 }];
    const resultado = buildLocalRiskProfilePreview({
      sourceKind: "BBDD_LIVE_API",
      selectedProfileId: "RISK_5",
      positions,
      assets: [sinVolatilidad],
      summary: buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: positions, assets: [sinVolatilidad] })
    });
    expect(resultado.portfolio_metrics_missing).toEqual(["caída máxima histórica", "Sharpe 3 años", "volatilidad 3 años"]);
  });
});
