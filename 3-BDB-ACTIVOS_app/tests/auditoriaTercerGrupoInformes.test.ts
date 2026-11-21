/**
 * Tres hallazgos de la auditoría del 16-11-2026 en informes y en Comparar carteras:
 *
 * - INF-7: el mismo activo en dos líneas es una sola concentración.
 * - INF-8: el «VaR 99 % semanal» del informe interno era la peor semana; se da como lo que es.
 * - CMP-1: una cartera que no da cifra no recorta el periodo de la otra.
 */
import { describe, expect, test } from "vitest";
import { loQueFaltaEnLaComparacion } from "../src/core/comparacionDeCarteras";
import { alignPortfolioComparison, alinearLasQueDanCifra } from "../src/core/portfolioComparison";
import { historicalTailRisk, worstWeeklyReturn } from "../src/core/portfolioExtendedAnalytics";
import { cifrasDeLasDos } from "../src/core/propuestaDeCambio";
import { evaluatePortfolioHealth, pesoEscritoPorActivo, pesoMedidoPorActivo } from "../src/core/portfolioHealth";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import { comparisonFixture } from "./support/portfolioComparisonFixtures";

describe("INF-7 · la concentración suma las líneas del mismo activo", () => {
  const activo = (id: string): BdbAssetDetail => ({
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "COMPLETE",
    is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "", metrics: { volatility_3y: 0.12 },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  });
  const posiciones = (filas: Array<[string, number]>): BdbManualPortfolioPosition[] => filas.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));

  test("A en dos líneas de 30 % es un 60 %: una sola alerta, y crítica", () => {
    const dosLineas = posiciones([["A", 30], ["A", 30], ["B", 20], ["C", 20]]);
    expect([...pesoEscritoPorActivo(dosLineas)]).toEqual([["A", 60], ["B", 20], ["C", 20]]);
    const salud = evaluatePortfolioHealth({ positions: dosLineas, assets: [activo("A"), activo("B"), activo("C")] });
    const dePeso = salud.violations.filter((v) => v.rule === "POSITION_WEIGHT");
    /* Antes: dos avisos «A pesa 30,0 %». */
    expect(dePeso).toHaveLength(1);
    expect(dePeso[0]).toMatchObject({ severity: "FAIL", asset_id: "A", observed: 60 });
    expect(dePeso[0].message).toBe("A concentra 60,0 % de la cartera.");
  });

  test("con pesos que suman 70 se mide sobre lo asignado: 40 es el 57,1 %, crítico, y se dicen las dos cifras (A-164)", () => {
    /* A 40, B 20, C 10: suman 70. A es 40 / 70 = 57,14 %, que pasa del 40 %; B es 28,57 %, que pasa del 25 %; C, 14,29 %. */
    const salud = evaluatePortfolioHealth({ positions: posiciones([["A", 40], ["B", 20], ["C", 10]]), assets: [activo("A"), activo("B"), activo("C")] });
    const dePeso = salud.violations.filter((v) => v.rule === "POSITION_WEIGHT");
    expect(dePeso.map((v) => [v.asset_id, v.severity])).toEqual([["A", "FAIL"], ["B", "WARN"]]);
    expect(dePeso[0].observed).toBeCloseTo(57.142857, 5);
    expect(dePeso[0].message).toBe("A concentra 40,0\u00a0% de la cartera, el 57,1\u00a0% de lo asignado.");
    expect(dePeso[1].message).toBe("B pesa 20,0\u00a0% de la cartera, el 28,6\u00a0% de lo asignado.");
    expect(salud.violations.some((v) => v.rule === "WEIGHT_SUM")).toBe(true);
    /* Y por encima de 100 también: A 60 de 120 es el 50 %. */
    expect(pesoMedidoPorActivo(posiciones([["A", 60], ["B", 60]])).pesos.get("A")).toEqual({ escrito: 60, medido: 50 });
  });

  test("con pesos que suman 100 no cambia nada: la cifra es la escrita y la frase no añade nada", () => {
    const salud = evaluatePortfolioHealth({ positions: posiciones([["A", 45], ["B", 30], ["C", 25]]), assets: [activo("A"), activo("B"), activo("C")] });
    const dePeso = salud.violations.filter((v) => v.rule === "POSITION_WEIGHT");
    expect(dePeso.map((v) => [v.asset_id, v.severity, v.observed])).toEqual([["A", "FAIL", 45], ["B", "WARN", 30]]);
    expect(dePeso[0].message).toBe("A concentra 45,0\u00a0% de la cartera.");
    expect(pesoMedidoPorActivo(posiciones([["A", 45], ["B", 30], ["C", 25]])).cuadra).toBe(true);
  });
});

describe("INF-8 · la peor semana, y no un VaR al 99 %", () => {
  /**
   * Una serie de viernes: cada semana sube un 1 %, salvo dos que se dicen aparte. Con 60 rendimientos semanales el
   * 1 % es `floor(0,6) = 0`, que se sube a uno: el «VaR 99 %» es el peor de todos.
   */
  function viernes(semanas: number, caidas: Record<number, number>): Array<{ date: string; value: number }> {
    const puntos: Array<{ date: string; value: number }> = [];
    let valor = 100;
    for (let i = 0; i <= semanas; i++) {
      if (i > 0) valor *= 1 + (caidas[i] ?? 0.01);
      puntos.push({ date: new Date(Date.UTC(2024, 0, 5) + i * 7 * 86400000).toISOString().slice(0, 10), value: valor });
    }
    return puntos;
  }

  test("con 60 semanas, el VaR al 99 % es la peor semana y coincide con su CVaR", () => {
    const serie = viernes(60, { 10: -0.08, 30: -0.05 });
    const al99 = historicalTailRisk(serie).find((riesgo) => riesgo.level === 0.99)!;
    expect(al99.tailObservations).toBe(1);
    expect(al99.valueAtRisk).toBeCloseTo(-0.08, 12);
    expect(al99.conditionalValueAtRisk).toBeCloseTo(-0.08, 12);
    expect(worstWeeklyReturn(serie)).toBeCloseTo(-0.08, 12);
    /* Al 95 %: floor(0,05 × 60) = 3 semanas en la cola; la tercera peor es una de las del +1 %. */
    expect(historicalTailRisk(serie).find((riesgo) => riesgo.level === 0.95)).toMatchObject({ tailObservations: 3 });
  });

  test("con cinco años el «99 %» era la segunda peor semana: la peor es otra cifra", () => {
    const serie = viernes(260, { 10: -0.08, 30: -0.05 });
    const al99 = historicalTailRisk(serie).find((riesgo) => riesgo.level === 0.99)!;
    expect(al99.tailObservations).toBe(2);
    expect(al99.valueAtRisk).toBeCloseTo(-0.05, 12);
    expect(worstWeeklyReturn(serie)).toBeCloseTo(-0.08, 12);
  });

  test("con menos de 52 semanas no hay cifra", () => {
    expect(worstWeeklyReturn(viernes(40, { 10: -0.08 }))).toBeNull();
  });
});

describe("CMP-1 · la que no da cifra no recorta a la otra", () => {
  /* A tiene los tres años; B, solo los últimos 200 días. */
  const a = comparisonFixture("3Y", "A");
  const b = comparisonFixture("3Y", "B");
  b.backtest.portfolio_series = b.backtest.portfolio_series.slice(-200);

  test("si las dos dan cifra, mandan las fechas comunes, como siempre", () => {
    const comunes = alinearLasQueDanCifra({ historia: a, daCifra: true }, { historia: b, daCifra: true }, "3Y")!;
    expect(comunes.seriesA).toHaveLength(200);
    expect(comunes.firstDate).toBe(b.backtest.portfolio_series[0].date);
    expect(comunes).toEqual(alignPortfolioComparison(a, b, "3Y"));
  });

  test("si B no da cifra, A se mide sobre sus tres años", () => {
    const soloA = alinearLasQueDanCifra({ historia: a, daCifra: true }, { historia: b, daCifra: false }, "3Y")!;
    expect(soloA.seriesA).toHaveLength(a.backtest.portfolio_series.length);
    expect(soloA.firstDate).toBe(a.backtest.portfolio_series[0].date);
    expect(soloA.metricsA).toEqual(alignPortfolioComparison(a, a, "3Y").metricsA);
    /* Y al revés. */
    const soloB = alinearLasQueDanCifra({ historia: b, daCifra: false }, { historia: a, daCifra: true }, "3Y")!;
    expect(soloB.seriesB).toHaveLength(a.backtest.portfolio_series.length);
  });

  test("si ninguna da cifra se alinean como antes, y sin ninguna serie no hay resultado", () => {
    expect(alinearLasQueDanCifra({ historia: a, daCifra: false }, { historia: b, daCifra: false }, "3Y")).toEqual(alignPortfolioComparison(a, b, "3Y"));
    expect(alinearLasQueDanCifra({ historia: null, daCifra: false }, { historia: null, daCifra: false }, "3Y")).toBeNull();
    /* Sin serie de B y con cifra de A: A consigo misma, como ya hacía la pantalla. */
    expect(alinearLasQueDanCifra({ historia: a, daCifra: true }, { historia: null, daCifra: false }, "3Y")!.seriesA).toHaveLength(a.backtest.portfolio_series.length);
  });

  test("CMP-2 · en la propuesta de cambio, si una no tiene serie, la otra da sus cifras igual que en Comparar carteras", () => {
    const nombreDe = (id: string) => id;
    const entera = { requested: 2, included: 2, weightPercent: 100, excluded: [] };
    const conSerie = { rotulo: "Actual", historia: a, parte: entera };
    const sinSerie = { rotulo: "Propuesta", historia: null, parte: null };
    const cifras = cifrasDeLasDos(conSerie, sinSerie, "3Y", nombreDe);
    /* Antes: las tres filas con «Falta el dato» en las dos columnas y «Sin las dos simulaciones…». */
    const propia = alignPortfolioComparison(a, a, "3Y");
    /* Las 1.097 fechas de A, las de sus tres años: antes, ninguna ventana. */
    expect(propia.seriesA).toHaveLength(1097);
    expect(cifras.ventana).toContain("(1.097 fechas), en euros");
    expect(cifras.filas.map((fila) => fila.rotulo)).toEqual(["Rentabilidad anualizada", "Volatilidad", "Caída máxima"]);
    for (const fila of cifras.filas) {
      expect(fila.actual).not.toBe("Falta el dato");
      expect(fila.propuesta).toBe("Falta el dato");
      expect(fila.diferencia).toBe("Falta el dato");
    }
    expect(cifras.notas).toContain("Propuesta: ninguna de sus posiciones tiene serie suficiente en este periodo, así que no se puede simular.");
    expect(cifras.notas).toContain("Solo se dan las cifras de la cartera actual, medidas sobre su propio periodo: sin la otra no hay fechas comunes.");
    /* Y al revés, la que tiene serie es la propuesta. */
    const alReves = cifrasDeLasDos({ ...sinSerie, rotulo: "Actual" }, { ...conSerie, rotulo: "Propuesta" }, "3Y", nombreDe);
    expect(alReves.filas.every((fila) => fila.actual === "Falta el dato" && fila.propuesta !== "Falta el dato")).toBe(true);
    expect(alReves.notas).toContain("Solo se dan las cifras de la propuesta, medidas sobre su propio periodo: sin la otra no hay fechas comunes.");
    /* Sin ninguna de las dos, ninguna cifra. */
    const ninguna = cifrasDeLasDos({ ...sinSerie, rotulo: "Actual" }, sinSerie, "3Y", nombreDe);
    expect(ninguna.ventana).toBeNull();
    expect(ninguna.filas.every((fila) => fila.actual === "Falta el dato" && fila.propuesta === "Falta el dato")).toBe(true);
    expect(ninguna.notas).toContain("Sin ninguna de las dos simulaciones no hay cifras que dar.");
  });

  test("la pantalla dice que las cifras de la otra son de su propio periodo", () => {
    expect(loQueFaltaEnLaComparacion(null, "No llega al 80 % del peso.").aviso).toBe(
      "Falta el dato de B. No llega al 80 % del peso. Sin esa cifra no se comparan rentabilidad ni riesgo. Las cifras de A son de su propio periodo."
    );
  });
});
