// @vitest-environment happy-dom

/**
 * Decisión 40 (05-11-2026): «Máximo Sharpe» es una sola cartera, y lo que enseña la propuesta dice de qué modelo sale y con qué
 * tope. Decisión 61: «Rentabilidad objetivo» sale del mismo cálculo, y dice lo que mide la serie para que no parezca que se cumple. Decisión 94: lo
 * que se escribe es la media de la serie, y la tarjeta sigue dando la rentabilidad del modelo. Decisión 95: la nota dice lo que hace el encogimiento,
 * solo donde hay renta fija y bolsa.
 * Si ninguna cartera cumple lo pedido, se dice con sus cifras, y no se devuelve otra cosa.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildFrontierViewModel, frontierStateFromError, frontierStateFromRawResponse, parsePortfolioFrontierResponse } from "../src/adapters/portfolioFrontierAdapter";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { FrontierHistoricalState, FrontierViewModel } from "../src/types/portfolioFrontier";

const backend = vi.hoisted(() => ({
  fetchHistoricalFrontier: vi.fn(),
  isRealFrontierEnabled: vi.fn(() => true)
}));

vi.mock("../src/adapters/optimizePortfolioBackend", () => backend);

import { FrontierHistoricalView } from "../src/components/FrontierHistoricalView";
import { MedidaDelObjetivo } from "../src/components/MedidaDelObjetivo";
import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { toAppError } from "../src/core/appError";
import { olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";
import { notaDelMaximoSharpe } from "../src/core/internalPortfolioReport";
import { fraseDelEncogimiento, lecturaDelObjetivo, MAXIMO_SHARPE, MIN_VOLATILIDAD, notaDeLaCartera, notaDeLaPropuesta, notaDeLaRentabilidadObjetivo, RENTABILIDAD_OBJETIVO, sharpeQueNoAplica, TU_OBJETIVO } from "../src/core/notaDeLaPropuesta";
import { clearSessionCaches } from "../src/core/sessionCaches";

const PUNTO = { expected_return: 0.09, volatility: 0.06, sharpe_ratio: 1.1, weights: { A: 0.35, B: 0.65 } };

function respuesta(methodology: Record<string, unknown> = {}, resto: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "portfolio-frontier.v1",
    as_of_date: "2026-10-23",
    units: "decimal",
    base_currency: "EUR",
    methodology: {
      window: "3Y", frequency: "WEEKLY", annualization_factor: 52, alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR", risk_free_rate: 0.0275, risk_free_rate_policy: "WINDOW_AVERAGE",
      ...methodology
    },
    coverage: { requested_assets: 2, included_assets: 2, common_observations: 158, first_date: "2023-10-20", last_date: "2026-10-23" },
    current_portfolio: { ...PUNTO, weights: { A: 0.5, B: 0.5 } },
    min_volatility_portfolio: { ...PUNTO, expected_return: 0.07, weights: { A: 0.3, B: 0.7 } },
    max_sharpe_portfolio: PUNTO,
    frontier: [PUNTO, { ...PUNTO, expected_return: 0.1, volatility: 0.08 }],
    excluded_assets: [],
    warnings: [],
    ...resto
  };
}

const modelo = (methodology?: Record<string, unknown>, resto?: Record<string, unknown>): FrontierViewModel =>
  buildFrontierViewModel(parsePortfolioFrontierResponse(respuesta(methodology, resto)));

const vista = (state: FrontierHistoricalState, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(FrontierHistoricalView, { state, ...extra }));

const resultado = (methodology?: Record<string, unknown>, resto?: Record<string, unknown>) => frontierStateFromRawResponse(respuesta(methodology, resto));

describe("la nota de la propuesta", () => {
  test.each([
    ["CLA", 0.35, "tope del 35,0\u00a0% por posición"],
    ["CLA", 0.6, "tope del 60,0\u00a0% por posición"],
    ["QP", 0.25, "tope del 25,0\u00a0% por posición"],
    ["QP", 0.2, "tope del 20,0\u00a0% por posición"]
  ])("con %s y un tope de %f dice «%s», el que ha aplicado el motor", (optimizer, tope, escrito) => {
    expect(notaDeLaPropuesta(modelo({ optimizer, weight_bounds: [0, tope] }))).toBe(
      `Máximo Sharpe del modelo: covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan), ${escrito}. Medida luego con la serie real puede quedar por debajo de la cartera actual.`
    );
  });

  test("si el motor no dice el tope, tampoco se supone", () => {
    expect(notaDeLaPropuesta(modelo({ optimizer: "CLA" }))).toContain("tope por posición no informado");
  });

  test("es la misma frase que la del informe interno: si una cambia, esta prueba lo dice", () => {
    const model = modelo({ optimizer: "CLA", weight_bounds: [0, 0.35] });
    const metrica = { metrics: { sharpe: 1 } };
    const horizon = { frontier: model, maxSharpe: metrica, backtest: metrica, years: 3 } as never;
    expect(notaDelMaximoSharpe([{ horizon }])).toBe(notaDeLaPropuesta(model));
  });

  test("un servidor que no declara su método no recibe una nota que quizá no sea verdad", () => {
    expect(notaDeLaPropuesta(modelo())).toBeNull();
    expect(notaDeLaPropuesta(modelo({ optimizer: "OTRO" }))).toBeNull();
  });

  describe("lo que hace el encogimiento (decisión 95), solo donde es cierto", () => {
    const FRASE = "El modelo acerca lo que espera de la renta fija a lo que espera de la bolsa, y por eso esta cartera suele llevar más renta fija de lo que sugiere la serie.";
    const PESOS = { A: 0.25, B: 0.25, C: 0.25, D: 0.25 };
    const conPesos = (weights: Record<string, number>, methodology: Record<string, unknown> = { optimizer: "CLA", weight_bounds: [0, 0.35] }) =>
      modelo(methodology, { max_sharpe_portfolio: { ...PUNTO, weights } });
    const fichas = (clases: Record<string, string>) =>
      Object.entries(clases).map(([asset_id, economic_asset_class]) => ({ asset_id, economic_asset_class, instrument_type: "FUND" })) as never;

    test("con renta fija y bolsa se dice, detrás de la nota de siempre", () => {
      const nota = notaDeLaPropuesta(conPesos(PESOS), fichas({ A: "EQUITY", B: "EQUITY", C: "FIXED_INCOME", D: "FIXED_INCOME" }));
      expect(nota).toBe(`Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, tope del 35,0\u00a0% por posición. Medida luego con la serie real puede quedar por debajo de la cartera actual. ${FRASE}`);
    });

    test.each([
      ["solo bolsa", { A: "EQUITY", B: "EQUITY", C: "EQUITY", D: "EQUITY" }],
      ["solo renta fija", { A: "FIXED_INCOME", B: "FIXED_INCOME", C: "FIXED_INCOME", D: "FIXED_INCOME" }],
      ["bolsa y mixtos: no hay ningún fondo de renta fija que acercar", { A: "EQUITY", B: "EQUITY", C: "MIXED", D: "MIXED" }],
      ["renta fija y monetarios", { A: "FIXED_INCOME", B: "FIXED_INCOME", C: "MONEY_MARKET", D: "MONEY_MARKET" }],
      ["sin clase conocida", { A: "UNKNOWN", B: "OTHER", C: "ALTERNATIVE", D: "UNKNOWN" }]
    ])("con %s no se dice", (_caso, clases) => {
      expect(fraseDelEncogimiento(conPesos(PESOS), fichas(clases))).toBeNull();
      expect(notaDeLaPropuesta(conPesos(PESOS), fichas(clases))).not.toContain("acerca");
    });

    test("cuenta también lo que se queda a cero: está en el cálculo", () => {
      expect(fraseDelEncogimiento(conPesos({ A: 1, B: 0, C: 0, D: 0 }), fichas({ A: "EQUITY", B: "EQUITY", C: "EQUITY", D: "FIXED_INCOME" }))).toBe(FRASE);
    });

    test("con tres activos o menos no se dice: el motor no encoge", () => {
      const tres = { A: 0.4, B: 0.3, C: 0.3 };
      expect(fraseDelEncogimiento(conPesos(tres), fichas({ A: "EQUITY", B: "EQUITY", C: "FIXED_INCOME" }))).toBeNull();
    });

    test("sin fichas no se afirma nada, y lo que no está en el cálculo no cuenta", () => {
      expect(notaDeLaPropuesta(conPesos(PESOS))).not.toContain("acerca");
      expect(fraseDelEncogimiento(conPesos(PESOS), fichas({ A: "EQUITY", B: "EQUITY", C: "EQUITY", D: "EQUITY", FUERA: "FIXED_INCOME" }))).toBeNull();
      expect(fraseDelEncogimiento(null, fichas({ A: "EQUITY" }))).toBeNull();
    });

    test("en la revisión va solo con Máximo Sharpe: Mínima volatilidad no depende de esto, y «esta cartera» sería otra", () => {
      const assets = fichas({ A: "EQUITY", B: "EQUITY", C: "FIXED_INCOME", D: "FIXED_INCOME" });
      expect(notaDeLaCartera(conPesos(PESOS), MAXIMO_SHARPE, assets)).toContain(FRASE);
      expect(notaDeLaCartera(conPesos(PESOS), "Mín. volatilidad", assets)).not.toContain("acerca");
      expect(notaDeLaCartera(conPesos(PESOS), "Tu objetivo", assets)).not.toContain("acerca");
    });

    test("en la frontera sale, pasándole las fichas, y sin ellas no", () => {
      const assets = fichas({ A: "EQUITY", B: "EQUITY", C: "FIXED_INCOME", D: "FIXED_INCOME" });
      const estado = resultado({ optimizer: "CLA", weight_bounds: [0, 0.35] }, { max_sharpe_portfolio: { ...PUNTO, weights: PESOS } });
      expect(vista(estado, { assets })).toContain(FRASE);
      expect(vista(estado)).not.toContain("acerca lo que espera");
    });
  });
});

describe("lo que se dice de «Rentabilidad objetivo»", () => {
  /** Las cifras son de la muestra en la base nueva, a 3 y 5 años: sirven de resultado esperado, y aquí se pasan como dato. */
  const MEDIDA_3A = { cagr: 0.0882, volatility: 0.0575, sharpe: 1.06, max_drawdown: -0.0793 };
  const ACTUAL_3A = { cagr: 0.134821, volatility: 0.084352, sharpe: 1.273, max_drawdown: -0.130488 };
  const conObjetivo = (expected: number, pedido: number, medida: unknown, actual: unknown = ACTUAL_3A, methodology: Record<string, unknown> = {}) =>
    modelo({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: pedido, ...methodology }, {
      target_return_portfolio: { ...PUNTO, expected_return: expected },
      target_return_measured: { portfolio: medida, current: actual }
    });

  test("lo pedido es la media de la serie, lo medido otra cifra, y la de la tarjeta se explica: con la muestra, 8 %, 8,82 % y 9,79 %", () => {
    expect(notaDeLaRentabilidadObjetivo(conObjetivo(0.0979, 0.08, MEDIDA_3A))).toBe(
      "El +8,00\u00a0% que pides es la media de la serie, con covarianza regularizada y tope del 35,0\u00a0% por posición. " +
      "Medida con la serie real a 3 años, con los pesos fijos desde el primer día, esta cartera da un +8,82\u00a0% anualizado, por encima de lo que pides, con una volatilidad del 5,75\u00a0% y un Sharpe de 1,06. " +
      "El modelo le da un +9,79\u00a0%, porque acerca lo que espera de cada activo a la media de todos: es la cifra de la tarjeta, no lo que se pide. " +
      "La cartera actual, medida igual, da un +13,48\u00a0% con una volatilidad del 8,44\u00a0% y un Sharpe de 1,27. " +
      "Es retrospectiva: los pesos se eligen con este mismo periodo, y no dice lo que rendirá."
    );
    expect(lecturaDelObjetivo(conObjetivo(0.0979, 0.08, MEDIDA_3A))?.frenteALoPedido).toBe("por-encima");
  });

  test("si lo medido no llega, lo dice con las dos cifras y frente a la actual: pasa en el 6 % de las peticiones, y por poco", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.0979, 0.08, { ...MEDIDA_3A, cagr: 0.0781 }));
    expect(nota).toContain("El +8,00\u00a0% que pides es la media de la serie");
    expect(nota).toContain("esta cartera da un +7,81\u00a0% anualizado, por debajo de lo que pides,");
    expect(lecturaDelObjetivo(conObjetivo(0.0979, 0.08, { ...MEDIDA_3A, cagr: 0.0781 }))?.frenteALoPedido).toBe("por-debajo");
  });

  test("a 5 años el modelo da menos que lo pedido, y también se explica", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.0701, 0.08, { ...MEDIDA_3A, cagr: 0.0835 }, { ...ACTUAL_3A, cagr: 0.06378 }, { window: "5Y" }));
    expect(nota).toContain("a 5 años");
    expect(nota).toContain("da un +8,35\u00a0% anualizado, por encima de lo que pides");
    expect(nota).toContain("El modelo le da un +7,01\u00a0%,");
    expect(nota).toContain("La cartera actual, medida igual, da un +6,38\u00a0%");
  });

  test("si el modelo da lo mismo que la media, porque con tres activos no encoge, no hay nada que aclarar", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.08, 0.08, MEDIDA_3A));
    expect(nota).not.toContain("El modelo le da");
    expect(nota).not.toContain("tarjeta");
  });

  test("se compara lo que se lee, con dos decimales", () => {
    expect(lecturaDelObjetivo(conObjetivo(0.08, 0.08, { ...MEDIDA_3A, cagr: 0.08004 }))?.frenteALoPedido).toBe("lo-pedido");
    expect(notaDeLaRentabilidadObjetivo(conObjetivo(0.08, 0.08, { ...MEDIDA_3A, cagr: 0.08004 }))).toContain("da un +8,00\u00a0% anualizado, lo que pides,");
    expect(lecturaDelObjetivo(conObjetivo(0.08, 0.08, { ...MEDIDA_3A, cagr: 0.07994 }))?.frenteALoPedido).toBe("por-debajo");
    expect(lecturaDelObjetivo(conObjetivo(0.08, 0.08, { ...MEDIDA_3A, cagr: 0.08006 }))?.frenteALoPedido).toBe("por-encima");
    /* Que el modelo dé más que lo pedido no es la cartera de menor riesgo: lo era antes, y con la media de la serie ya no. */
    expect(lecturaDelObjetivo(conObjetivo(0.0979, 0.08, MEDIDA_3A, ACTUAL_3A, { target_return_floor: 0.0418 }))?.laDeMenorRiesgo).toBe(false);
  });

  test("es la cartera de menor riesgo si lo pedido no pasa del suelo que manda el servidor: la misma cuenta, sin redondear", () => {
    const con = (suelo: number) => lecturaDelObjetivo(conObjetivo(0.0979, 0.08, MEDIDA_3A, ACTUAL_3A, { target_return_floor: suelo }));
    expect(con(0.08)?.laDeMenorRiesgo).toBe(true);
    expect(con(0.0800001)?.laDeMenorRiesgo).toBe(true);
    expect(con(0.0799999)?.laDeMenorRiesgo).toBe(false);
    /* Sin suelo no se afirma. */
    expect(lecturaDelObjetivo(conObjetivo(0.0979, 0.08, MEDIDA_3A))?.laDeMenorRiesgo).toBe(false);
  });

  test("por debajo de la cartera de menor riesgo se propone esa, y se dice con su media de la serie, que es lo que se compara", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.076084, 0.01, { ...MEDIDA_3A, cagr: 0.042151 }, ACTUAL_3A, { target_return_floor: 0.041779 }));
    expect(nota).toContain("Pides un +1,00\u00a0%, y con tus límites la cartera de menor riesgo ya tiene una media de la serie del +4,18\u00a0%, con covarianza regularizada y tope del 35,0\u00a0% por posición: se propone esa.");
    expect(nota).toContain("da un +4,22\u00a0% anualizado, por encima de lo que pides");
    expect(nota).toContain("El modelo le da un +7,61\u00a0%,");
    expect(nota).not.toContain("que pides es la media de la serie");
  });

  test("una rentabilidad medida negativa lleva su signo", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.025367, 0.01, { ...MEDIDA_3A, cagr: -0.002181 }));
    expect(nota).toContain("da un \u22120,22\u00a0% anualizado, por debajo de lo que pides");
  });

  test("lo que no se ha medido falta, y no se compara con nada", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.08, 0.08, null));
    expect(nota).toBe("El +8,00\u00a0% que pides es la media de la serie, con covarianza regularizada y tope del 35,0\u00a0% por posición. La medida con la serie no está: falta el dato.");
    expect(lecturaDelObjetivo(conObjetivo(0.08, 0.08, null))?.frenteALoPedido).toBeNull();
    /* La cifra de la tarjeta se sigue explicando: está en la pantalla aunque falte la medida. */
    expect(notaDeLaRentabilidadObjetivo(conObjetivo(0.0979, 0.08, null))).toContain("El modelo le da un +9,79\u00a0%,");
  });

  test("sin cartera actual no se habla de ella", () => {
    const nota = notaDeLaRentabilidadObjetivo(conObjetivo(0.08, 0.08, MEDIDA_3A, null));
    expect(nota).not.toContain("cartera actual");
    expect(nota).toContain("por encima de lo que pides");
  });

  test("si la cartera no entra entera, lo que se compara es la parte incluida", () => {
    const parcial = { ...conObjetivo(0.08, 0.08, MEDIDA_3A), portfolioCoverage: { requested: 3, included: 2, weightPercent: 88, excluded: [{ assetId: "C", weightPercent: 12, reasonLabel: "x" }] } };
    expect(notaDeLaRentabilidadObjetivo(parcial)).toContain("La parte incluida de la cartera actual, medida igual, da un +13,48\u00a0%");
  });

  test("si en la medida hay tramos estimados, no se llama serie real", () => {
    const tramo = { assetId: "A", reference: "X", estimatedFrom: "2023-10-20", estimatedUntil: "2025-02-07" };
    const nota = notaDeLaRentabilidadObjetivo({ ...conObjetivo(0.08, 0.08, MEDIDA_3A), extensions: [tramo] });
    expect(nota).toContain("Medida con la serie, con tramos estimados, a 3 años,");
    expect(nota).not.toContain("serie real");
    expect(notaDeLaRentabilidadObjetivo({ ...conObjetivo(0.08, 0.08, MEDIDA_3A), extensions: [] })).toContain("Medida con la serie real a 3 años,");
  });

  test("el Sharpe de una sola acción no se lee tampoco en la frase", () => {
    const model = modelo({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, {
      current_portfolio: { ...PUNTO, weights: { A: 1, B: 0 } },
      target_return_portfolio: { ...PUNTO, expected_return: 0.08, weights: { A: 0.45, B: 0.55 } },
      target_return_measured: { portfolio: MEDIDA_3A, current: ACTUAL_3A }
    });
    const assets = [{ asset_id: "A", instrument_type: "STOCK" }, { asset_id: "B", instrument_type: "FUND" }] as never;
    const nota = notaDeLaRentabilidadObjetivo(model, assets);
    expect(nota).toContain("La cartera actual, medida igual, da un +13,48\u00a0% con una volatilidad del 8,44\u00a0%.");
    expect(nota).toContain("con una volatilidad del 5,75\u00a0% y un Sharpe de 1,06.");
    expect(notaDeLaCartera(model, RENTABILIDAD_OBJETIVO, assets)).toBe(nota);
    expect(sharpeQueNoAplica(model, assets)).toBe("actual");
    expect(sharpeQueNoAplica(model, [])).toBeNull();
  });

  test("si las dos son una sola acción, no se lee el Sharpe de ninguna: ni en la frase ni en la tabla (P2-06)", () => {
    const model = modelo({ optimizer: "CLA", weight_bounds: [0, 1], target_return: 0.08 }, {
      current_portfolio: { ...PUNTO, weights: { A: 1, B: 0 } },
      target_return_portfolio: { ...PUNTO, expected_return: 0.08, weights: { A: 0, B: 1 } },
      target_return_measured: { portfolio: MEDIDA_3A, current: ACTUAL_3A }
    });
    const assets = [{ asset_id: "A", instrument_type: "STOCK" }, { asset_id: "B", instrument_type: "STOCK" }] as never;
    expect(sharpeQueNoAplica(model, assets)).toBe("ambas");
    const nota = notaDeLaRentabilidadObjetivo(model, assets)!;
    expect(nota).toContain("con una volatilidad del 5,75 %.");
    expect(nota).toContain("con una volatilidad del 8,44 %.");
    expect(nota).not.toContain("Sharpe");
    /* La tabla: la fila del Sharpe lleva «No aplica» en las dos carteras y en la diferencia, sin 1,06 ni 1,27. */
    const html = renderToStaticMarkup(createElement(MedidaDelObjetivo, { model, assets }));
    const fila = /<tr><td>Sharpe<\/td>(.*?)<\/tr>/.exec(html)?.[1] ?? "";
    expect(fila.match(/No aplica/g)).toHaveLength(3);
    expect(fila).not.toMatch(/1,06|1,27/);
    /* Solo la propuesta de una acción: la tabla quita la suya y deja la actual. */
    const soloLaPropuesta = [{ asset_id: "A", instrument_type: "FUND" }, { asset_id: "B", instrument_type: "STOCK" }] as never;
    expect(sharpeQueNoAplica(model, soloLaPropuesta)).toBe("propuesta");
  });

  test("sin el motor no dice que esté regularizado, y sin lo pedido no afirma nada", () => {
    const demo = conObjetivo(0.08, 0.08, null, null, { optimizer: "DEMO_MEAN_VARIANCE_QP" });
    expect(notaDeLaRentabilidadObjetivo(demo)).toBe("El +8,00\u00a0% que pides es la media de la serie. La medida con la serie no está: falta el dato.");
    /* Y sin el motor no se explica una tarjeta con un modelo que no se sabe si encoge. */
    expect(notaDeLaRentabilidadObjetivo(conObjetivo(0.0979, 0.08, null, null, { optimizer: "DEMO_MEAN_VARIANCE_QP" }))).not.toContain("El modelo le da");
    expect(notaDeLaRentabilidadObjetivo(modelo({ optimizer: "CLA" }, { target_return_portfolio: PUNTO }))).toBeNull();
    expect(notaDeLaRentabilidadObjetivo(modelo({ optimizer: "CLA", target_return: 0.08 }))).toBeNull();
  });

  test("cada tarjeta, su nota: la de Máximo Sharpe no habla del objetivo, ni al revés", () => {
    const model = conObjetivo(0.08, 0.08, MEDIDA_3A);
    expect(notaDeLaCartera(model, RENTABILIDAD_OBJETIVO)).toBe(notaDeLaRentabilidadObjetivo(model));
    expect(notaDeLaCartera(model, "Máx. Sharpe")).toBe(notaDeLaPropuesta(model));
  });
});

/**
 * 20-11-2026. Hasta ese día, la revisión de «Mín. volatilidad» y la de «Posición en la frontera» llevaban la nota de Máximo Sharpe: empezaba por
 * «Máximo Sharpe del modelo» debajo de un encabezado que decía «Diferencias · Mín. volatilidad», y decía de esa cartera que podía quedar por debajo
 * de la actual, que con ninguna de esas dos carteras se ha medido (se midió con Máximo Sharpe, decisión A-40). Ahora cada una dice de qué sale la
 * suya. Lo que decide cada cartera se ha leído en `functions_python/optimization/robust_engine.py`: a la de mínima volatilidad la deciden la
 * covarianza y las restricciones, no las rentabilidades; y la posición en la frontera es un punto de la curva que dan las medias de la serie y la
 * covarianza, una curva que el encogimiento de las rentabilidades no mueve, porque es afín (§13 del método). Por eso ninguna de las dos notas dice
 * «rentabilidades regularizadas» —con tres activos o menos, además, el motor no las encoge—, y la de la posición en la frontera sí nombra las
 * medias: callarlas la dejaría igual que la de mínima volatilidad, como si no dependiera de lo que rindió cada activo.
 */
describe("la nota de las otras dos carteras del modelo", () => {
  const MIN_VOL = "Mínima volatilidad del modelo: covarianza regularizada, tope del 35,0 % por posición. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.";
  const POSICION = "Posición en la frontera del modelo: un punto de la curva que dan las medias de la serie y la covarianza regularizada, tope del 35,0 % por posición. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.";
  const model = modelo({ optimizer: "CLA", weight_bounds: [0, 0.35] });

  test("«Mín. volatilidad» dice que sale de la covarianza, con su tope, y no nombra otra cartera", () => {
    expect(notaDeLaCartera(model, MIN_VOLATILIDAD)).toBe(MIN_VOL);
    expect(MIN_VOLATILIDAD).toBe("Mín. volatilidad");
  });

  test("«Tu objetivo» dice que es un punto de la curva de las medias de la serie y la covarianza, con su tope", () => {
    expect(notaDeLaCartera(model, TU_OBJETIVO)).toBe(POSICION);
    expect(TU_OBJETIVO).toBe("Tu objetivo");
    /* No puede leerse como la de mínima volatilidad: esta cartera sí depende de lo que rindió cada activo. */
    expect(notaDeLaCartera(model, TU_OBJETIVO)).toContain("las medias de la serie");
    expect(notaDeLaCartera(model, MIN_VOLATILIDAD)).not.toContain("medias");
  });

  test("ninguna de las dos habla de Máximo Sharpe, ni dice lo que solo se ha medido con él", () => {
    for (const origen of [MIN_VOLATILIDAD, TU_OBJETIVO]) {
      const nota = notaDeLaCartera(model, origen);
      expect(nota, origen).not.toContain("Máximo Sharpe");
      expect(nota, origen).not.toContain("por debajo de la cartera actual");
      /* El modelo de esta prueba tiene dos activos, y con tres o menos el motor no encoge las rentabilidades: decir que están
         regularizadas sería falso. Ninguna de las dos lo dice; la cifra de rentabilidad ya se dice «del modelo». */
      expect(nota, origen).not.toContain("rentabilidades y covarianza");
      expect(nota, origen).not.toContain("rentabilidades regularizadas");
    }
    /* Y la de Máximo Sharpe sigue siendo la suya, la misma del informe interno. */
    expect(notaDeLaCartera(model, MAXIMO_SHARPE)).toBe(notaDeLaPropuesta(model));
    expect(notaDeLaCartera(model, MAXIMO_SHARPE)).toContain("Máximo Sharpe del modelo");
  });

  test.each([
    ["CLA", 0.6, "tope del 60,0 % por posición"],
    ["QP", 0.2, "tope del 20,0 % por posición"]
  ])("el tope es el que ha aplicado el motor: con %s y %f, «%s»", (optimizer, tope, escrito) => {
    const con = modelo({ optimizer, weight_bounds: [0, tope] });
    expect(notaDeLaCartera(con, MIN_VOLATILIDAD)).toBe(`Mínima volatilidad del modelo: covarianza regularizada, ${escrito}. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.`);
    expect(notaDeLaCartera(con, TU_OBJETIVO)).toBe(`Posición en la frontera del modelo: un punto de la curva que dan las medias de la serie y la covarianza regularizada, ${escrito}. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.`);
  });

  test("si el motor no dice el tope, tampoco se supone", () => {
    expect(notaDeLaCartera(modelo({ optimizer: "CLA" }), MIN_VOLATILIDAD)).toContain("covarianza regularizada, tope por posición no informado.");
  });

  test("un servidor que no declara su método no recibe una nota que quizá no sea verdad", () => {
    for (const origen of [MIN_VOLATILIDAD, TU_OBJETIVO]) {
      expect(notaDeLaCartera(modelo(), origen)).toBeNull();
      expect(notaDeLaCartera(modelo({ optimizer: "OTRO" }), origen)).toBeNull();
    }
  });

  test("de una cartera que no se sabe cuál es no se afirma nada: antes recibía la de Máximo Sharpe", () => {
    expect(notaDeLaCartera(model, undefined)).toBeNull();
    expect(notaDeLaCartera(model, "Optimizador")).toBeNull();
    expect(notaDeLaCartera(model, "Tu cartera")).toBeNull();
    /* Un nombre que coincide con algo del lenguaje no es una cartera. */
    expect(notaDeLaCartera(model, "constructor")).toBeNull();
    expect(notaDeLaCartera(model, "toString")).toBeNull();
  });
});

describe("lo que enseña la frontera", () => {
  test("con el motor regularizado, la nota al lado de las cifras, y cada cifra dice que es del modelo", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35] }));
    expect(html).toContain("Máximo Sharpe del modelo: covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan), tope del 35,0\u00a0% por posición.");
    for (const rotulo of ["Rent. del modelo", "Vol. del modelo", "Sharpe del modelo"]) expect(html).toContain(`<dt>${rotulo}</dt>`);
    expect(html).not.toContain("<dt>Rent.</dt>");
    expect(html).toContain("Máx. Sharpe");
    expect(html).toContain("Mín. volatilidad");
  });

  const OBJETIVO = {
    target_return_portfolio: { ...PUNTO, expected_return: 0.0979, weights: { A: 0.45, B: 0.55 } },
    target_return_measured: {
      portfolio: { cagr: 0.0882, volatility: 0.0575, sharpe: 1.06, max_drawdown: -0.0793 },
      current: { cagr: 0.1348, volatility: 0.0844, sharpe: 1.273, max_drawdown: -0.1305 }
    }
  };

  test("con «Rentabilidad objetivo» salen también las otras dos, que son las mismas carteras que con los demás objetivos", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, OBJETIVO));
    expect(html).toContain("Rentabilidad objetivo");
    expect(html).toContain("Máx. Sharpe");
    expect(html).toContain("Mín. volatilidad");
    /* La principal, delante de las de referencia. */
    expect(html.indexOf(">Rentabilidad objetivo</span>")).toBeLessThan(html.indexOf(">Máx. Sharpe</span>"));
    /* Una sola vez: el objetivo no sale también como «Tu objetivo». */
    expect(html).not.toContain("Tu objetivo");
  });

  test("lo medido se lee en una tabla, frente a la actual, y si pasa de lo pedido no hay aviso: la tarjeta, sin más, da la del modelo", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, OBJETIVO));
    expect(html).not.toContain("aviso--aviso");
    expect(html).toContain("por encima de lo que pides");
    expect(html).toContain("Medida con la serie · 3 años");
    /* Las cifras de la tabla, con el formato único: rentabilidad con signo, espacio duro antes de la unidad. */
    for (const cifra of ["+8,82\u00a0%", "+13,48\u00a0%", "5,75\u00a0%", "8,44\u00a0%", "1,06", "1,27", "\u22127,93\u00a0%", "\u221213,05\u00a0%", "\u22124,66\u00a0pp", "20/10/2023", "23/10/2026"]) expect(html).toContain(cifra);
    /* La diferencia de dos porcentajes va en puntos (puertas finales del 06-11, pantalla-3). Es la de la serie: la de la revisión es la del modelo. */
    expect(html).not.toContain("\u22124,66 %");
    expect(html).toContain("pesos fijos desde el primer día");
    /* La tarjeta sigue con la del modelo, y la frase dice que es otra cifra. */
    expect(html).toMatch(/<dt>Rent\. del modelo<\/dt><dd><span class="cifra[^"]*">\+9,79\u00a0%<\/span><\/dd>/);
    expect(html).toContain("El modelo le da un +9,79\u00a0%, porque acerca lo que espera de cada activo a la media de todos: es la cifra de la tarjeta, no lo que se pide.");
  });

  test("si lo medido no llega se avisa", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, {
      ...OBJETIVO,
      target_return_measured: { ...OBJETIVO.target_return_measured, portfolio: { ...OBJETIVO.target_return_measured.portfolio, cagr: 0.0781 } }
    }));
    /* El aviso es la pieza `Aviso`, en ocre (antes, la clase `notice notice--warn` escrita a mano). */
    expect(html).toContain("aviso--aviso");
    expect(html).toContain("da un +7,81\u00a0% anualizado, por debajo de lo que pides");
  });

  test("los tramos estimados también se dicen debajo de la tabla", () => {
    const tramo = { asset_id: "A", reference: "Índice de referencia X", estimated_from: "2023-10-20", estimated_until: "2025-02-07" };
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, { ...OBJETIVO, extensions: [tramo] }));
    expect(html).toContain("pesos fijos desde el primer día · con tramos estimados.");
    expect(html).toContain("Medida con la serie, con tramos estimados, a 3 años");
  });

  test("si da justo lo pedido, a dos decimales, tampoco hace falta avisar", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, {
      ...OBJETIVO,
      target_return_measured: { ...OBJETIVO.target_return_measured, portfolio: { ...OBJETIVO.target_return_measured.portfolio, cagr: 0.08 } }
    }));
    expect(html).not.toContain("aviso--aviso");
    expect(html).toContain("da un +8,00\u00a0% anualizado, lo que pides");
  });

  test("si no se ha medido, falta: ni tabla ni cifra de relleno, y se avisa", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, {
      ...OBJETIVO,
      target_return_measured: { portfolio: null, current: null }
    }));
    expect(html).toContain("falta el dato");
    expect(html).toContain("aviso--aviso");
    expect(html).not.toContain("Medida con la serie ·");
  });

  test("sin cartera actual, una sola columna y sin diferencia", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, {
      ...OBJETIVO,
      target_return_measured: { ...OBJETIVO.target_return_measured, current: null }
    }));
    expect(html).toContain("Medida con la serie · 3 años");
    expect(html).not.toContain("Diferencia");
    /* Lo que se comprueba es la tabla de lo medido: una sola columna. Se mira esa tabla y no la página entera, porque
       el gráfico de la frontera lleva desde el 14-11-2026 su tabla alternativa, que nombra el punto «Tu cartera». */
    const tablaDeLoMedido = html.slice(html.indexOf("backtest-metrics-table"), html.indexOf("</table>", html.indexOf("backtest-metrics-table")));
    expect(tablaDeLoMedido).toContain("Rentabilidad objetivo");
    expect(tablaDeLoMedido).not.toContain("Tu cartera");
  });

  test("si lo que mide la cartera actual es una sola acción, su Sharpe no se enseña", () => {
    const accion = { ...OBJETIVO, current_portfolio: { ...PUNTO, weights: { A: 1, B: 0 } } };
    const assets = [{ asset_id: "A", instrument_type: "STOCK" }, { asset_id: "B", instrument_type: "FUND" }];
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, accion), { assets });
    expect(html).toContain("No aplica");
    expect(html).not.toContain("1,27");
    /* Con varias posiciones, sale. */
    expect(vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35], target_return: 0.08 }, OBJETIVO), { assets })).toContain("1,27");
  });

  test("con los demás objetivos no hay nada de esto", () => {
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35] }));
    expect(html).not.toContain("Medida con la serie");
    expect(html).not.toContain("que pides");
  });

  test("en compacto no hay tarjetas, y tampoco nota", () => {
    expect(vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.35] }), { compact: true })).not.toContain("Máximo Sharpe del modelo");
  });

  test("un tramo estimado entra en el cálculo y se dice cuál es, con el nombre del activo", () => {
    const tramo = { asset_id: "A", reference: "Índice de referencia X", estimated_from: "2023-10-20", estimated_until: "2025-02-07" };
    const html = vista(resultado({ optimizer: "CLA", weight_bounds: [0, 0.6] }, { extensions: [tramo] }), { nameById: { A: "Fondo A" } });
    expect(html).toContain("Histórico ampliado: los tramos estimados entran en el cálculo. No son precios reales del activo.");
    expect(html).toContain("Fondo A: Índice de referencia X · tramo estimado");
    expect(vista(resultado({ optimizer: "CLA" }))).not.toContain("Histórico ampliado");
    expect(vista(resultado({ optimizer: "CLA" }, { extensions: [] }))).not.toContain("Histórico ampliado");
  });

  test("un tramo mal formado no pasa por bueno", () => {
    expect(resultado({ optimizer: "CLA" }, { extensions: [{ asset_id: "A" }] }).status).toBe("error");
  });
});

describe("sin solución", () => {
  const SERVIDOR = "Sin solución: los candados suman 30,0 % y 1 posición libre, con su tope del 60,0 %, solo llega al 90,0 % de la cartera. Suelta un candado o cambia el máximo por activo.";
  /** Como llega de `httpsCallable`: un Error con su código. */
  const deFirebase = (code: string, message: string) => Object.assign(new Error(message), { code });

  test("el texto del servidor llega a pantalla, no «La petición contiene un dato no válido»", () => {
    /* El SDK le añade al mensaje el estado HTTP. */
    const error = toAppError(deFirebase("functions/invalid-argument", `${SERVIDOR} [400]`));
    expect(error.message).toBe("La petición contiene un dato no válido.");
    expect(frontierStateFromError(error)).toEqual({ status: "error", message: SERVIDOR });
  });

  test("otro error de la petición sigue siendo el de siempre", () => {
    const error = toAppError(deFirebase("functions/invalid-argument", "Invalid locked weights or conflict with weight bounds."));
    expect(frontierStateFromError(error)).toEqual({ status: "error", message: "La petición contiene un dato no válido." });
  });

  test("se enseña tal cual, sin presentarlo como un fallo ni como detalle técnico", () => {
    const html = vista({ status: "error", message: SERVIDOR });
    expect(html).toContain("solo llega al 90,0 % de la cartera");
    expect(html).not.toContain("Histórica no disponible");
    expect(html).not.toContain("Detalle técnico");
    expect(html).not.toContain("frontier-cards");
  });

  test("cada activo, por su nombre", () => {
    const html = vista(
      { status: "error", message: "Sin solución: el candado de IE00B4L5Y983 (40,0 %) supera el máximo por activo que has escrito (30,0 %)." },
      { nameById: { IE00B4L5Y983: "iShares Core MSCI World" } }
    );
    expect(html).toContain("el candado de iShares Core MSCI World (40,0 %)");
    expect(html).not.toContain("IE00B4L5Y983");
  });

  test("un fallo de verdad sigue saliendo como fallo", () => {
    const html = vista({ status: "error", message: "fallo X" });
    expect(html).toContain("Histórica no disponible");
    expect(html).toContain("Detalle técnico: fallo X");
  });
});

describe("el panel de Optimizar", () => {
  /** Doce posiciones: las que antes de la decisión 61 no entraban en «Rentabilidad objetivo». */
  const positions: BdbManualPortfolioPosition[] = Array.from({ length: 12 }, (_, indice) => ({
    asset_id: `F${indice}`,
    label: `Fondo ${indice}`,
    weight_percent: indice === 0 ? 12 : 8
  }));
  const assets = positions.map((position) => ({
    asset_id: position.asset_id,
    display_name: position.label,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { volatility_3y: 0.11, annualized_return_3y: 0.06 }
  })) as unknown as BdbAssetDetail[];
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearSessionCaches();
    olvidarTrabajoDeCartera();
    backend.fetchHistoricalFrontier.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const montar = async (extra: Record<string, unknown> = {}) => {
    await act(async () => {
      root.render(createElement(OptimizerPanel, { assets, positions, onApplyWeights: () => undefined, ...extra }));
    });
  };
  const elegirObjetivo = async (valor: string) => {
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = valor;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const pulsarOptimizar = async () => {
    const boton = [...host.querySelectorAll("button")].find((b) => b.textContent === "Optimizar") as HTMLButtonElement;
    await act(async () => {
      boton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  test.each(["MAX_SHARPE", "MIN_VOLATILITY", "TARGET_RISK", "TARGET_RETURN"])("doce posiciones entran enteras con %s", async (objetivo) => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "idle" });
    await montar();
    await elegirObjetivo(objetivo);
    expect(host.textContent).not.toContain("Se optimizan");
    await pulsarOptimizar();
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].assetIds).toHaveLength(12);
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].objective).toBe(objetivo);
  });

  test("lo que se escribe en «Rent. objetivo» se pide en decimal, y se dice que es la media de la serie y que lo medido es otra cifra", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "idle" });
    await montar();
    expect(host.textContent).not.toContain("Rent. objetivo: lo que escribes");
    await elegirObjetivo("TARGET_RETURN");
    expect(host.textContent).toContain("Rent. objetivo: lo que escribes es la media de la serie");
    expect(host.textContent).toContain("la rentabilidad anualizada se queda cerca sin ser la misma cifra");
    expect(host.textContent).not.toContain("lo que escribes es la rentabilidad del modelo");
    await pulsarOptimizar();
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].targetReturn).toBeCloseTo(0.08, 12);
  });

  /* DIS-02: el objetivo es un punto de la frontera de estos activos, no el perfil de riesgo 1-10 de la cartera, y no
     puede llamarse igual. El cálculo y lo que se envía no cambian. */
  test("«Posición en la frontera» no se llama «Nivel de riesgo», no usa la escala /10 y dice que no es el perfil", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "idle" });
    await montar();
    const opcion = [...host.querySelectorAll("option")].find((o) => o.value === "TARGET_RISK");
    expect(opcion?.textContent).toBe("Posición en la frontera");
    await elegirObjetivo("TARGET_RISK");
    const deslizador = host.querySelector('input[type="range"]') as HTMLInputElement;
    const rotulo = deslizador.closest("label")?.textContent ?? "";
    expect(rotulo).toContain("Riesgo dentro de la frontera: de menor (1) a mayor (10)");
    expect(rotulo).not.toContain("Nivel de riesgo");
    expect(rotulo).not.toContain("/10");
    expect(deslizador.getAttribute("aria-label")).not.toContain("Nivel de riesgo");
    expect(host.textContent).toContain("No es el perfil de riesgo de la cartera.");
    expect(host.textContent).not.toContain("Nivel de riesgo");
    await pulsarOptimizar();
    const pedido = backend.fetchHistoricalFrontier.mock.calls[0][0];
    expect(pedido.objective).toBe("TARGET_RISK");
    expect(pedido.riskSlider).toBe(5);
    expect(pedido.riskTargetMode).toBe("FRONTIER_PERCENTILE");
  });

  test("la rotación se ofrece con Rentabilidad objetivo y con Posición en la frontera, y llega al cálculo", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue({ status: "idle" });
    await montar();
    expect(host.textContent).not.toContain("Rotación máx.");
    await elegirObjetivo("TARGET_RETURN");
    expect(host.textContent).toContain("Rotación máx.");
    const campo = [...host.querySelectorAll("label")].find((l) => l.textContent?.includes("Rotación máx."))?.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, "10");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      /* DIS-04 (13-11-2026): lo escrito en un tope es un borrador hasta salir del campo, como los importes. Quien pulsa
         «Optimizar» con el ratón sale del campo antes de que llegue la pulsación; aquí se dice a mano. */
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await pulsarOptimizar();
    /* Un 10 % del patrimonio que cambia de sitio son 0,20 en la suma de diferencias. */
    expect(backend.fetchHistoricalFrontier.mock.calls[0][0].maxTurnover).toBeCloseTo(0.2, 12);
  });

  test("una posición al 0 % entra aquí y no en Simular, y se dice", async () => {
    await montar({ positions: [...positions.slice(0, 2), { asset_id: "CERO", label: "Fondo sin peso", weight_percent: 0 }], assets: [...assets.slice(0, 2), { ...assets[0], asset_id: "CERO", display_name: "Fondo sin peso" }] });
    expect(host.textContent).toContain("Entra también una posición al 0 %, que Simular no mide: con otros activos, otra cartera.");
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar();
    expect(host.textContent).not.toContain("al 0 %");
  });

  test("dice qué hace el máximo por activo con 100, también con Rentabilidad objetivo", async () => {
    await montar();
    expect(host.textContent).toContain("con 100, manda el tope del modelo");
    await elegirObjetivo("TARGET_RETURN");
    expect(host.textContent).toContain("con 100, manda el tope del modelo");
  });

  test("un candado por encima del tope: el panel dice que manda, con cualquier objetivo", async () => {
    await montar({ lockedWeights: { F0: 0.5 } });
    expect(host.textContent).toContain("con su tope; un candado manda aunque pase de él.");
    await elegirObjetivo("TARGET_RETURN");
    expect(host.textContent).toContain("con su tope; un candado manda aunque pase de él.");
  });

  test("la revisión de la propuesta dice de dónde salen sus cifras, al abrirse sola y desde la tarjeta", async () => {
    backend.fetchHistoricalFrontier.mockResolvedValue(
      resultado({ optimizer: "CLA", weight_bounds: [0, 0.25] }, {
        max_sharpe_portfolio: { ...PUNTO, weights: Object.fromEntries(positions.map((p) => [p.asset_id, 1 / 12])) }
      })
    );
    await montar();
    await pulsarOptimizar();
    const dialogo = () => document.querySelector('[role="dialog"]');
    expect(dialogo()?.textContent).toContain("Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, tope del 25,0\u00a0% por posición.");

    await act(async () => {
      ([...document.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialogo()).toBeNull();
    await act(async () => {
      ([...host.querySelectorAll("button")].find((b) => b.textContent === "Revisar propuesta") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialogo()?.textContent).toContain("tope del 25,0\u00a0% por posición");
  });

  test("con Rentabilidad objetivo, la revisión de esa cartera dice lo medido, y la de Máximo Sharpe dice lo suyo", async () => {
    const pesos = Object.fromEntries(positions.map((p) => [p.asset_id, 1 / 12]));
    backend.fetchHistoricalFrontier.mockResolvedValue(
      resultado({ optimizer: "CLA", weight_bounds: [0, 0.25], target_return: 0.08 }, {
        max_sharpe_portfolio: { ...PUNTO, weights: pesos },
        min_volatility_portfolio: { ...PUNTO, expected_return: 0.07, weights: pesos },
        current_portfolio: { ...PUNTO, weights: pesos },
        target_return_portfolio: { ...PUNTO, expected_return: 0.08, weights: pesos },
        target_return_measured: {
          portfolio: { cagr: 0.0503, volatility: 0.0411, sharpe: 0.557, max_drawdown: -0.0431 },
          current: { cagr: 0.1348, volatility: 0.0844, sharpe: 1.273, max_drawdown: -0.1305 }
        }
      })
    );
    await montar();
    await elegirObjetivo("TARGET_RETURN");
    await pulsarOptimizar();
    const dialogo = () => document.querySelector('[role="dialog"]');
    const cancelar = async () => {
      await act(async () => {
        ([...document.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    expect(dialogo()?.textContent).toContain("Diferencias · Rentabilidad objetivo");
    expect(dialogo()?.textContent).toContain("El +8,00\u00a0% que pides es la media de la serie");
    expect(dialogo()?.textContent).toContain("da un +5,03\u00a0% anualizado, por debajo de lo que pides");
    expect(dialogo()?.textContent).not.toContain("Máximo Sharpe del modelo");
    await cancelar();

    const botones = () => [...host.querySelectorAll(".frontier-card")];
    const deLaTarjeta = (titulo: string) => botones().find((c) => c.textContent?.includes(titulo))?.querySelector("button") as HTMLButtonElement;
    await act(async () => deLaTarjeta("Máx. Sharpe").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dialogo()?.textContent).toContain("Máximo Sharpe del modelo");
    expect(dialogo()?.textContent).not.toContain("que pides");
    await cancelar();

    await act(async () => deLaTarjeta("Rentabilidad objetivo").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dialogo()?.textContent).toContain("por debajo de lo que pides");
  });

  /* 20-11-2026: con estos dos objetivos, el encabezado de la revisión nombraba una cartera y la nota de debajo empezaba por otra. */
  describe("la revisión de las otras dos carteras dice lo suyo, y no «Máximo Sharpe»", () => {
    const pesos = Object.fromEntries(positions.map((p) => [p.asset_id, 1 / 12]));
    const dialogo = () => document.querySelector('[role="dialog"]');
    const cancelar = async () => {
      await act(async () => {
        ([...document.querySelectorAll("button")].find((b) => b.textContent === "Cancelar") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const deLaTarjeta = (titulo: string) => [...host.querySelectorAll(".frontier-card")].find((c) => c.textContent?.includes(titulo))?.querySelector("button") as HTMLButtonElement;
    const pulsarLaTarjeta = (titulo: string) => act(async () => deLaTarjeta(titulo).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const DE_MIN_VOL = "Mínima volatilidad del modelo: covarianza regularizada, tope del 25,0 % por posición. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.";
    const DE_LA_POSICION = "Posición en la frontera del modelo: un punto de la curva que dan las medias de la serie y la covarianza regularizada, tope del 25,0 % por posición. Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.";

    test("con «Mín. volatilidad», al abrirse sola y desde su tarjeta; la de Máximo Sharpe sigue con la suya", async () => {
      backend.fetchHistoricalFrontier.mockResolvedValue(
        resultado({ optimizer: "CLA", weight_bounds: [0, 0.25] }, {
          max_sharpe_portfolio: { ...PUNTO, weights: pesos },
          min_volatility_portfolio: { ...PUNTO, expected_return: 0.07, weights: pesos },
          current_portfolio: { ...PUNTO, weights: pesos }
        })
      );
      await montar();
      await elegirObjetivo("MIN_VOLATILITY");
      await pulsarOptimizar();
      expect(dialogo()?.textContent).toContain("Diferencias · Mín. volatilidad");
      expect(dialogo()?.textContent).toContain(DE_MIN_VOL);
      expect(dialogo()?.textContent).not.toContain("Máximo Sharpe");
      await cancelar();

      await pulsarLaTarjeta("Mín. volatilidad");
      expect(dialogo()?.textContent).toContain(DE_MIN_VOL);
      expect(dialogo()?.textContent).not.toContain("Máximo Sharpe");
      await cancelar();

      await pulsarLaTarjeta("Máx. Sharpe");
      expect(dialogo()?.textContent).toContain("Diferencias · Máx. Sharpe");
      expect(dialogo()?.textContent).toContain("Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, tope del 25,0 % por posición.");
      expect(dialogo()?.textContent).not.toContain("Mínima volatilidad del modelo");
    });

    test("con «Posición en la frontera», al abrirse sola y desde su tarjeta, «Tu objetivo»", async () => {
      backend.fetchHistoricalFrontier.mockResolvedValue(
        resultado({ optimizer: "CLA", weight_bounds: [0, 0.25] }, {
          max_sharpe_portfolio: { ...PUNTO, weights: pesos },
          min_volatility_portfolio: { ...PUNTO, expected_return: 0.07, weights: pesos },
          current_portfolio: { ...PUNTO, weights: pesos },
          target_portfolio: { ...PUNTO, expected_return: 0.085, weights: pesos }
        })
      );
      await montar();
      await elegirObjetivo("TARGET_RISK");
      await pulsarOptimizar();
      expect(dialogo()?.textContent).toContain("Diferencias · Tu objetivo");
      expect(dialogo()?.textContent).toContain(DE_LA_POSICION);
      expect(dialogo()?.textContent).not.toContain("Máximo Sharpe");
      await cancelar();

      await pulsarLaTarjeta("Tu objetivo");
      expect(dialogo()?.textContent).toContain(DE_LA_POSICION);
      expect(dialogo()?.textContent).not.toContain("Máximo Sharpe");
    });
  });
});
