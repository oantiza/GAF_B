import { describe, expect, it } from "vitest";
import { resolveMetricsFrequency, candidateRanking, notaDeLosGrupos } from "../src/core/metricsFrequency";
import { computePortfolioPreviewMetrics } from "../src/core/portfolio";
import { calculoEnPalabras, describeMetricsMethodology } from "../src/core/metricsMethodology";
import { findHomogeneousAlternatives } from "../src/core/fundSwapper";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

function asset(id: string, frequency: string | undefined, sharpe = 1, ret = 0.1): BdbAssetDetail {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY",
    is_investable: true, role: "INVESTABLE", currency: "EUR", quality_flags: [], warnings: [],
    metrics: { annualized_return_3y: ret, volatility_3y: 0.2, sharpe_3y: sharpe,
      metrics_method: "GEOMETRIC_CAGR", metrics_frequency: frequency }
  } as unknown as BdbAssetDetail;
}

describe("frecuencia de las métricas", () => {
  it.each([["DAILY", "WEEKLY"], ["DAILY", "MONTHLY"], ["DAILY", undefined], ["PROVIDER", "PROVIDER"]])(
    "no agrega riesgos %s / %s ni inventa Sharpe", (a, b) => {
      const result = computePortfolioPreviewMetrics({ assets: [asset("A", a), asset("B", b)],
        manualPositions: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }] });
      expect(result.metrics.volatility_3y).toBeUndefined();
      expect(result.metrics.sharpe_3y).toBeUndefined();
      expect(result.metrics.annualized_return_3y).toBe(0.1);
      expect(result.metrics.preview_boundary.limitations.join(" ")).toContain("frecuencias distintas o no declaradas");
    }
  );
  it("mantiene el riesgo homogéneo y distingue diario de backtest semanal", () => {
    const result = computePortfolioPreviewMetrics({ assets: [asset("A", "DAILY"), asset("B", "WEEKLY")],
      manualPositions: [{ asset_id: "A", weight_percent: 100 }, { asset_id: "B", weight_percent: 0 }] });
    expect(result.metrics.volatility_3y).toBe(0.2);
    expect(result.metrics.preview_boundary.limitations[0]).toContain("diarias");
    expect(result.metrics.preview_boundary.limitations[0]).toContain("no son directamente comparables");
    expect(resolveMetricsFrequency(["WEEKLY", "WEEKLY"]).compatible).toBe(true);
  });
  it("con frecuencias mezcladas dice con palabras que no se calcula, sin «N/D» (FMT-08)", () => {
    const { compatible, note } = resolveMetricsFrequency(["DAILY", "WEEKLY"]);
    expect(compatible).toBe(false);
    expect(note).toBe("La volatilidad y el Sharpe de la estimación no se calculan: las posiciones se miden con frecuencias distintas o no declaradas. Calcula la simulación histórica para medir la cartera en semanal.");
    expect(note).not.toContain("N/D");
  });
  it("el comparador avisa aunque el método sea idéntico", () => {
    const result = describeMetricsMethodology([
      { value: 1, method: "GEOMETRIC_CAGR", frequency: "DAILY" },
      { value: 2, method: "GEOMETRIC_CAGR", frequency: "WEEKLY" }
    ]);
    expect(result.mixed).toBe(true);
    expect(result.footnote).toContain("Observaciones: diarias y semanales.");
    // El reparto en una frase salió con la decisión 42: ahora cada activo dice su método, y esos son los dos que se distinguen.
    expect(calculoEnPalabras({ method: "GEOMETRIC_CAGR", frequency: "DAILY" })).toBe("con datos diarios");
    expect(calculoEnPalabras({ method: "GEOMETRIC_CAGR", frequency: "WEEKLY" })).toBe("con datos semanales");
  });
  it("no favorece un Sharpe alto de distinta frecuencia al sustituir: cada frecuencia, su grupo (MET-4)", () => {
    const a = asset("A", "DAILY", 99, 0.01), b = asset("B", "WEEKLY", 0.2, 0.2), c = asset("C", "DAILY", 1, 0.15);
    const ranking = candidateRanking([a, b, c]);
    expect(ranking.label).toBe("por grupos comparables");
    /* Dos grupos: el semanal ({B}) va antes que el diario ({A, C}), que solo queda en documentos antiguos. Dentro del diario, todos tienen Sharpe y se
       ordena por él: 99 (A) antes que 1 (C). B no se pone contra A: su Sharpe de 0,2 contra el 99 de A no dice nada. */
    expect(ranking.grupos.map((grupo) => grupo.activos.map((x) => x.asset_id))).toEqual([["B"], ["A", "C"]]);
    expect([a, b, c].sort(ranking.compare).map((x) => x.asset_id)).toEqual(["B", "A", "C"]);
    expect(findHomogeneousAlternatives(asset("source", "DAILY"), [a, b, c]).map((x) => x.asset.asset_id)).toEqual(["B", "A", "C"]);
  });
  it("los métodos y los cierres distintos son grupos distintos, y solo se ordena dentro de cada uno", () => {
    const con = (id: string, extra: object, ret: number, sharpe: number) => ({
      asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY", is_investable: true, role: "INVESTABLE", currency: "EUR", quality_flags: [], warnings: [],
      metrics: { annualized_return_3y: ret, sharpe_3y: sharpe, metrics_frequency: "WEEKLY", ...extra }
    }) as unknown as BdbAssetDetail;
    const nuestroAntiguo = con("N1", { metrics_method: "GEOMETRIC_CAGR", as_of: "2026-09-30" }, 0.30, 0.9);
    const nuestroNuevoA = con("N2", { metrics_method: "GEOMETRIC_CAGR", as_of: "2026-11-13" }, 0.10, 0.5);
    const nuestroNuevoB = con("N3", { metrics_method: "GEOMETRIC_CAGR", as_of: "2026-11-13" }, 0.12, 0.8);
    const delProveedor = con("P1", { metrics_method: "TRAILING_PROVIDER", metrics_frequency: "PROVIDER", as_of: "2026-10-31" }, 0.40, 3);
    const sinCalculo = con("S1", {}, 0.50, 4);
    const ranking = candidateRanking([nuestroAntiguo, delProveedor, nuestroNuevoA, sinCalculo, nuestroNuevoB]);
    /* Los grupos, por su clave: 1 propio a 13/11 {N2, N3}; 2 propio a 30/09 {N1}; 3 del proveedor {P1}; 4 sin cálculo declarado {S1}.
       Dentro del 1, Sharpe: 0,8 (N3) antes que 0,5 (N2); la rentabilidad de N1 (30 %), P1 (40 %) y S1 (50 %) no los adelanta. */
    expect(ranking.grupos.map((grupo) => [grupo.numero, grupo.activos.map((x) => x.asset_id)])).toEqual([[1, ["N2", "N3"]], [2, ["N1"]], [3, ["P1"]], [4, ["S1"]]]);
    expect(ranking.grupos[0].criterio).toBe("sharpe_3y");
    expect([nuestroAntiguo, delProveedor, nuestroNuevoA, sinCalculo, nuestroNuevoB].sort(ranking.compare).map((x) => x.asset_id)).toEqual(["N3", "N2", "N1", "P1", "S1"]);
  });
  it("la nota dice que hay grupos y por qué, con el cálculo y el cierre de cada uno; con un solo grupo, nada", () => {
    const con = (id: string, extra: object) => ({ asset_id: id, display_name: id, instrument_type: "FUND", metrics: { annualized_return_3y: 0.1, metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY", ...extra } }) as unknown as BdbAssetDetail;
    expect(notaDeLosGrupos(candidateRanking([con("A", { as_of: "2026-11-13" }), con("B", { as_of: "2026-11-13" })]).grupos)).toBeNull();
    const nota = notaDeLosGrupos(candidateRanking([con("A", { as_of: "2026-11-13" }), con("B", { as_of: "2026-09-30" }), con("C", { as_of: "2026-11-13", metrics_method: "TRAILING_PROVIDER" })]).grupos)!;
    expect(nota).toBe("Las alternativas van en 3 grupos porque sus cifras no se calculan igual o no son de la misma fecha, y no se pueden poner en orden unas contra otras. Solo se ordenan entre sí las del mismo grupo. Grupo 1: A (con datos semanales, a 13/11/2026; por rentabilidad a 3 años). Grupo 2: B (con datos semanales, a 30/09/2026; por rentabilidad a 3 años). Grupo 3: C (con la cifra del proveedor, a 13/11/2026; por rentabilidad a 3 años).");
  });
  it("usa Sharpe solo si todos lo tienen con frecuencia y método comunes", () => {
    const a = asset("A", "DAILY", 2, 0.1), b = asset("B", "DAILY", 1, 0.2);
    expect(candidateRanking([a, b]).compare(a, b)).toBeLessThan(0);
    b.metrics.sharpe_3y = undefined;
    expect(candidateRanking([a, b]).compare(a, b)).toBeGreaterThan(0);
  });
});
