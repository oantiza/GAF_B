import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  buildFrontierViewModel,
  buildOptimizationRequest,
  formatDecimalAsPercent,
  frontierStateFromError,
  frontierStateFromRawResponse,
  parsePortfolioFrontierResponse
} from "../src/adapters/portfolioFrontierAdapter";
import { FrontierHistoricalView } from "../src/components/FrontierHistoricalView";
import { FrontierPanel } from "../src/components/FrontierPanel";
import { HorizonFrontier } from "../src/components/PortfolioHorizonPanel";
import { computeFrontier } from "../src/core/frontier";
import { approximateFrontierBadge, approximateFrontierReason } from "../src/core/frontierPresentation";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/* ------------------------------- fixtures ------------------------------- */

function validRaw(): Record<string, unknown> {
  return {
    schema_version: "portfolio-frontier.v1",
    as_of_date: "2026-06-20",
    units: "decimal",
    base_currency: "EUR",
    methodology: {
      window: "3Y",
      frequency: "WEEKLY",
      annualization_factor: 52,
      alignment_policy: "COMMON_WEEKLY_DATES",
      risk_free_source: "ECB_ESTR",
      risk_free_rate: 0.02884,
      risk_free_rate_policy: "WINDOW_AVERAGE",
      risk_free_first_date: "2023-06-23",
      risk_free_last_date: "2026-06-19",
      risk_free_observations: 760,
      risk_free_coverage_ratio: 1
    },
    coverage: {
      requested_assets: 4,
      included_assets: 3,
      common_observations: 156,
      first_date: "2023-06-23",
      last_date: "2026-06-19"
    },
    current_portfolio: { expected_return: 0.061, volatility: 0.114, sharpe_ratio: 0.36, weights: { A: 0.5, B: 0.5 } },
    min_volatility_portfolio: { expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } },
    max_sharpe_portfolio: { expected_return: 0.082, volatility: 0.12, sharpe_ratio: 0.52, weights: { A: 0.4, B: 0.35, C: 0.25 } },
    risk_contributions: [
      { asset_id: "A", weight_pct: 50, risk_pct: 112.5 },
      { asset_id: "B", weight_pct: 50, risk_pct: -12.5 }
    ],
    risk_contributions_meta: { cov_model: "SAMPLE" },
    frontier: [
      { expected_return: 0.045, volatility: 0.082, sharpe_ratio: 0.31, weights: { A: 0.7, B: 0.3 } },
      { expected_return: 0.082, volatility: 0.12, sharpe_ratio: 0.52, weights: { A: 0.4, B: 0.35, C: 0.25 } }
    ],
    excluded_assets: [{ asset_id: "ES0105394003", reason: "PRICE_SERIES_MISSING" }],
    warnings: ["AENA: histórico incompleto, usando proxy."]
  };
}

function asset(id: string, ret: number, vol: number): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { annualized_return_3y: ret, volatility_3y: vol }
  } as unknown as BdbAssetDetail;
}

/* Activo con frecuencia declarada: la estimación por composición exige que
   todas las métricas compartan frecuencia (sin ella no hay estimada posible). */
function weeklyAsset(id: string, ret: number, vol: number, assetClass = "EQUITY"): BdbAssetDetail {
  const base = asset(id, ret, vol) as unknown as { metrics: Record<string, unknown> };
  return { ...base, economic_asset_class: assetClass, metrics: { ...base.metrics, metrics_frequency: "WEEKLY" } } as unknown as BdbAssetDetail;
}

/* ------------------------------- adapter ------------------------------- */

describe("portfolio-frontier.v1 adapter", () => {
  test("parsea una respuesta válida del contrato", () => {
    const r = parsePortfolioFrontierResponse(validRaw());
    expect(r.schema_version).toBe("portfolio-frontier.v1");
    expect(r.units).toBe("decimal");
    expect(r.methodology.frequency).toBe("WEEKLY");
    expect(r.methodology.annualization_factor).toBe(52);
    expect(r.methodology.risk_free_source).toBe("ECB_ESTR");
    expect(r.methodology.risk_free_rate).toBe(0.02884);
    expect(r.methodology.risk_free_observations).toBe(760);
    expect(r.methodology.risk_free_coverage_ratio).toBe(1);
    expect(r.frontier).toHaveLength(2);
    expect(r.max_sharpe_portfolio.sharpe_ratio).toBe(0.52);
  });

  test("acepta fallback explícito y rechaza políticas desconocidas", () => {
    const fallback = validRaw();
    (fallback.methodology as Record<string, unknown>).risk_free_rate_policy = "STATIC_FALLBACK";
    expect(parsePortfolioFrontierResponse(fallback).methodology.risk_free_rate_policy).toBe("STATIC_FALLBACK");

    const invalid = validRaw();
    (invalid.methodology as Record<string, unknown>).risk_free_rate_policy = "LATEST";
    expect(() => parsePortfolioFrontierResponse(invalid)).toThrow("methodology.risk_free_rate_policy");
  });

  test("rechaza metodologia recibida si difiere de los enums esperados", () => {
    const badFrequency = validRaw();
    (badFrequency.methodology as Record<string, unknown>).frequency = "DAILY";
    expect(() => parsePortfolioFrontierResponse(badFrequency)).toThrow("methodology.frequency");

    const badAnnualization = validRaw();
    (badAnnualization.methodology as Record<string, unknown>).annualization_factor = 252;
    expect(() => parsePortfolioFrontierResponse(badAnnualization)).toThrow("methodology.annualization_factor");

    const badRfSource = validRaw();
    (badRfSource.methodology as Record<string, unknown>).risk_free_source = "STATIC";
    expect(() => parsePortfolioFrontierResponse(badRfSource)).toThrow("methodology.risk_free_source");
  });

  test("rechaza discriminante incorrecto -> estado error", () => {
    const state = frontierStateFromRawResponse({ schema_version: "wrong", units: "decimal" });
    expect(state.status).toBe("error");
  });

  test("risk_free_rate dinámico se muestra como porcentaje", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(vm.riskFreeRateLabel).toBe("2,88\u00a0%");
    expect(vm.riskFreeRatePolicy).toBe("WINDOW_AVERAGE");
  });

  test("expected return y volatility se formatean desde decimal", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    /* La rentabilidad esperada, con su signo; la volatilidad, sin él; el Sharpe, un ratio. */
    expect(vm.maxSharpe.expectedReturnLabel).toBe("+8,20\u00a0%");
    expect(vm.maxSharpe.volatilityLabel).toBe("12,00\u00a0%");
    expect(vm.maxSharpe.sharpeLabel).toBe("0,52");
    expect(formatDecimalAsPercent(0.1)).toBe("10,00\u00a0%");
  });

  test("min-vol y max-Sharpe con pesos ordenados", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(vm.minVolatility.volatilityLabel).toBe("8,20\u00a0%");
    expect(vm.maxSharpe.weights[0]).toEqual({ assetId: "A", weight: 0.4, weightLabel: "40,0\u00a0%" });
    expect(vm.maxSharpe.weights.map((w) => w.assetId)).toEqual(["A", "B", "C"]);
  });

  test("target_return_portfolio null se trata como ausente", () => {
    const raw = validRaw();
    raw.target_return_portfolio = null;

    const parsed = parsePortfolioFrontierResponse(raw);
    const vm = buildFrontierViewModel(parsed);

    expect(parsed.target_return_portfolio).toBeUndefined();
    expect(vm.targetReturn).toBeUndefined();
    expect(vm.minVolatility.volatilityLabel).toBe("8,20\u00a0%");
    expect(vm.maxSharpe.expectedReturnLabel).toBe("+8,20\u00a0%");
    expect(vm.frontier).toHaveLength(2);
  });

  test("target_return_portfolio válido se conserva", () => {
    const raw = validRaw();
    raw.target_return_portfolio = {
      expected_return: 0.07,
      volatility: 0.11,
      sharpe_ratio: 0.46,
      weights: { A: 0.45, B: 0.55 }
    };

    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(raw));

    expect(vm.targetReturn?.expectedReturnLabel).toBe("+7,00\u00a0%");
    expect(vm.targetReturn?.weights.map((w) => w.assetId)).toEqual(["B", "A"]);
  });

  test("lo pedido y lo que mide la serie llegan a la pantalla, y solo si los manda el servidor", () => {
    const raw = validRaw();
    expect(buildFrontierViewModel(parsePortfolioFrontierResponse(raw)).medidaDelObjetivo).toBeUndefined();
    expect(buildFrontierViewModel(parsePortfolioFrontierResponse(raw)).methodologyV2?.targetReturn).toBeUndefined();

    const medida = { cagr: 0.05, volatility: 0.04, sharpe: 0.55, max_drawdown: -0.04 };
    raw.methodology = { ...(raw.methodology as Record<string, unknown>), target_return: 0.08, target_return_floor: 0.0418 };
    raw.target_return_measured = { portfolio: medida, current: null };
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(raw));
    expect(vm.methodologyV2?.targetReturn).toBe(0.08);
    expect(vm.methodologyV2?.targetReturnFloor).toBe(0.0418);
    expect(vm.medidaDelObjetivo).toEqual({ propuesta: medida, actual: null });
  });

  test("una medida mal formada no pasa por buena", () => {
    const raw = validRaw();
    raw.target_return_measured = { portfolio: { cagr: 0.05 }, current: null };
    expect(() => parsePortfolioFrontierResponse(raw)).toThrow("target_return_measured.portfolio.volatility");
    const sinNada = validRaw();
    sinNada.target_return_measured = { portfolio: null, current: null };
    expect(buildFrontierViewModel(parsePortfolioFrontierResponse(sinNada)).medidaDelObjetivo).toEqual({ propuesta: null, actual: null });
  });

  test("target_return_portfolio incompleto sigue fallando", () => {
    const raw = validRaw();
    raw.target_return_portfolio = { expected_return: 0.07 };

    expect(() => parsePortfolioFrontierResponse(raw)).toThrow("target_return_portfolio");
  });

  test("activos excluidos con motivo legible", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(vm.excluded).toEqual([
      { assetId: "ES0105394003", reason: "PRICE_SERIES_MISSING", reasonLabel: "Sin serie de precios" }
    ]);
  });

  test("la cuarentena de divisa llega con su motivo, distinto de no tener conversión (decisión 58)", () => {
    const etiqueta = (reason: string) =>
      buildFrontierViewModel(parsePortfolioFrontierResponse({ ...validRaw(), excluded_assets: [{ asset_id: "A", reason }] })).excluded[0].reasonLabel;
    expect(etiqueta("FX_QUARANTINE")).toBe("Sin conversión a euros fiable");
    expect(etiqueta("FX_SERIES_MISSING")).toBe("Sin conversión a euros");
  });

  test("warnings se conservan", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(vm.warnings).toContain("AENA: histórico incompleto, usando proxy.");
  });

  test("conserva contribuciones al riesgo firmadas y declara la covarianza", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(vm.riskContributions).toEqual([
      { asset_id: "A", weight_pct: 50, risk_pct: 112.5 },
      { asset_id: "B", weight_pct: 50, risk_pct: -12.5 }
    ]);
    expect(vm.riskContributionsMeta).toEqual({ cov_model: "SAMPLE", reason: undefined });
    expect(vm.riskContributions?.reduce((sum, item) => sum + item.risk_pct, 0)).toBe(100);
  });

  test("acepta volatilidad degenerada como null y rechaza metadatos desconocidos", () => {
    const zero = validRaw();
    zero.risk_contributions = null;
    zero.risk_contributions_meta = { cov_model: "OAS", reason: "ZERO_VOLATILITY" };
    const parsed = parsePortfolioFrontierResponse(zero);
    expect(parsed.risk_contributions).toBeNull();
    expect(parsed.risk_contributions_meta?.reason).toBe("ZERO_VOLATILITY");

    const invalid = validRaw();
    invalid.risk_contributions_meta = { cov_model: "MADE_UP" };
    expect(() => parsePortfolioFrontierResponse(invalid)).toThrow("cov_model");

    const invalidSum = validRaw();
    invalidSum.risk_contributions = [{ asset_id: "A", weight_pct: 100, risk_pct: 99 }];
    expect(() => parsePortfolioFrontierResponse(invalidSum)).toThrow("no suma 100");

    const invalidWeightSum = validRaw();
    invalidWeightSum.risk_contributions = [{ asset_id: "A", weight_pct: 99, risk_pct: 100 }];
    expect(() => parsePortfolioFrontierResponse(invalidWeightSum)).toThrow("weight_pct");

    const nullWithoutReason = validRaw();
    nullWithoutReason.risk_contributions = null;
    nullWithoutReason.risk_contributions_meta = { cov_model: "SAMPLE" };
    expect(() => parsePortfolioFrontierResponse(nullWithoutReason)).toThrow("ZERO_VOLATILITY");
  });

  test("cobertura insuficiente cuando included_assets < 2", () => {
    const ok = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    expect(ok.insufficientCoverage).toBe(false);

    const raw = validRaw();
    (raw.coverage as Record<string, unknown>).included_assets = 1;
    const poor = buildFrontierViewModel(parsePortfolioFrontierResponse(raw));
    expect(poor.insufficientCoverage).toBe(true);
  });

  test("respuesta UNAUTHENTICATED -> estado unauthenticated", () => {
    expect(frontierStateFromError({ code: "UNAUTHENTICATED" }).status).toBe("unauthenticated");
    expect(frontierStateFromError({ message: "boom" }).status).toBe("error");
  });

  test("resultado histórico etiquetado como 'Frontera histórica'", () => {
    const state = frontierStateFromRawResponse(validRaw());
    expect(state.status).toBe("result");
    if (state.status === "result") {
      expect(state.model.label).toBe("Frontera histórica");
    }
  });

  test("el request no contiene series crudas y usa el contrato exacto", () => {
    const req = buildOptimizationRequest({
      assetIds: ["A", "B", "C"],
      currentWeights: { A: 0.5, B: 0.5 },
      objective: "MAX_SHARPE",
      minWeight: 0.05,
      maxWeight: 0.4
    });
    expect(req.schema_version).toBe("portfolio-optimization-request.v1");
    expect(req.base_currency).toBe("EUR");
    expect(req.frequency).toBe("WEEKLY");
    expect(req.constraints).toEqual({ long_only: true, fully_invested: true, min_weight: 0.05, max_weight: 0.4 });
    // M2: la rotación solo viaja con pesos actuales y por encima de cero.
    const withTurnover = buildOptimizationRequest({ assetIds: ["A", "B"], currentWeights: { A: 0.5, B: 0.5 }, maxTurnover: 0.3 });
    expect(withTurnover.constraints?.max_turnover).toBe(0.3);
    expect(buildOptimizationRequest({ assetIds: ["A", "B"], maxTurnover: 0.3 }).constraints?.max_turnover).toBeUndefined();
    expect(buildOptimizationRequest({ assetIds: ["A", "B"], currentWeights: { A: 1 }, maxTurnover: 0 }).constraints?.max_turnover).toBeUndefined();

    const allowed = new Set([
      "schema_version",
      "asset_ids",
      "current_weights",
      "window",
      "base_currency",
      "frequency",
      "objective",
      "target_return",
      "constraints",
      "frontier_points"
    ]);
    expect(Object.keys(req).every((k) => allowed.has(k))).toBe(true);

    const reqJson = JSON.stringify(req);
    for (const banned of ['"series"', '"price_series"', '"prices"', '"returns"']) {
      expect(reqJson.includes(banned)).toBe(false);
    }
  });

  test("si no se indica objetivo, usa TARGET_RISK para entrar por el motor robusto", () => {
    const req = buildOptimizationRequest({
      assetIds: ["A", "B"],
      currentWeights: { A: 0.5, B: 0.5 }
    });

    expect(req.objective).toBe("TARGET_RISK");
  });

  test("los pesos fijados usan solo locked_weights en el contrato público", () => {
    const req = buildOptimizationRequest({
      assetIds: ["A", "B", "C"],
      currentWeights: { A: 0.3, B: 0.4, C: 0.3 },
      lockedWeights: { A: 0.3 }
    });

    expect(req.locked_weights).toEqual({ A: 0.3 });
    expect(JSON.stringify(req)).not.toContain("fixed_weights");
    expect(JSON.stringify(req)).not.toContain("locked_positions");
  });

  test("el view model no contiene series crudas", () => {
    const vm = buildFrontierViewModel(parsePortfolioFrontierResponse(validRaw()));
    const vmJson = JSON.stringify(vm);
    for (const banned of ['"series"', '"price_series"', '"prices"', '"returns"']) {
      expect(vmJson.includes(banned)).toBe(false);
    }
  });
});

/* ------------------------------- UI states ------------------------------- */

describe("frontier UI states", () => {
  test("vista histórica desde fixture muestra etiqueta, rf, excluidos y warnings", () => {
    const state = frontierStateFromRawResponse(validRaw());
    const html = renderToStaticMarkup(createElement(FrontierHistoricalView, { state }));
    expect(html).toContain("Frontera histórica");
    expect(html).toContain("2,88\u00a0%");
    expect(html).toContain("tipo sin riesgo media €STR");
    expect(html).toContain("8,20\u00a0%");
    expect(html).toContain("Contribución al riesgo");
    expect(html).toContain("Covarianza: muestral");
    expect(html).toContain("Concentración de riesgo superior al 40 %");
    expect(html).toContain("Sin serie de precios");
    expect(html).toContain("AENA: histórico incompleto, usando proxy.");
  });

  test("con el tipo fijo de respaldo no se llama €STR, ni en el subtítulo ni en la nota (OPT-3)", () => {
    const deRespaldo = validRaw();
    (deRespaldo.methodology as Record<string, unknown>).risk_free_rate_policy = "STATIC_FALLBACK";
    const html = renderToStaticMarkup(createElement(FrontierHistoricalView, { state: frontierStateFromRawResponse(deRespaldo) }));
    expect(html).toContain("tipo sin riesgo fijo de respaldo");
    expect(html).toContain("un tipo fijo de respaldo como tipo sin riesgo, porque no se pudo leer el €STR del periodo");
    expect(html).not.toContain("media €STR");
    expect(html).not.toContain("respaldo €STR");
    expect(html).not.toContain("y el €STR como tipo sin riesgo");
    /* Basta con el aviso, aunque la política diga otra cosa: son las dos señales del servidor. */
    const soloElAviso = validRaw();
    (soloElAviso as unknown as { warnings: string[] }).warnings = [...((soloElAviso as unknown as { warnings?: string[] }).warnings ?? []), "RISK_FREE_RATE_STATIC_FALLBACK"];
    const conAviso = renderToStaticMarkup(createElement(FrontierHistoricalView, { state: frontierStateFromRawResponse(soloElAviso) }));
    expect(conAviso).toContain("tipo sin riesgo fijo de respaldo");
    /* Y con el €STR leído, como siempre. */
    const normal = renderToStaticMarkup(createElement(FrontierHistoricalView, { state: frontierStateFromRawResponse(validRaw()) }));
    expect(normal).toContain("y el €STR como tipo sin riesgo");
  });

  test("con volatilidad cero, la contribución al riesgo dice «No aplica» y por qué: ni «N/D» ni «Falta el dato»", () => {
    const raw = validRaw();
    raw.risk_contributions = null;
    raw.risk_contributions_meta = { cov_model: "SAMPLE", reason: "ZERO_VOLATILITY" };
    const html = renderToStaticMarkup(
      createElement(FrontierHistoricalView, { state: frontierStateFromRawResponse(raw) })
    );
    expect(html).toContain("Volatilidad de cartera nula");
    /* La prueba exigía «N/D». Con volatilidad nula la medida no está definida: eso es «No aplica». */
    expect(html).toContain("No aplica");
    expect(html).not.toContain("N/D");
    expect(html).not.toContain("Falta el dato");
  });

  test("estado UNAUTHENTICATED se renderiza con aviso de sesión", () => {
    const html = renderToStaticMarkup(
      createElement(FrontierHistoricalView, { state: { status: "unauthenticated" } })
    );
    expect(html).toContain("Inicia sesión");
  });

  test("estado error se renderiza con el mensaje", () => {
    const html = renderToStaticMarkup(
      createElement(FrontierHistoricalView, { state: { status: "error", message: "fallo X" } })
    );
    expect(html).toContain("fallo X");
  });

  test("'Aplicar pesos' aparece solo si se pasa el callback", () => {
    const state = frontierStateFromRawResponse(validRaw());
    const withApply = renderToStaticMarkup(
      createElement(FrontierHistoricalView, { state, onApplyWeights: () => undefined })
    );
    const withoutApply = renderToStaticMarkup(createElement(FrontierHistoricalView, { state }));
    expect(withApply).toContain("Aplicar pesos");
    expect(withoutApply).not.toContain("Aplicar pesos");
  });

  test("compact constructor shares historical metrics; sin estimada posible enseña el estado histórico", () => {
    const state = frontierStateFromRawResponse(validRaw());
    if (state.status !== "result") throw new Error("Expected result");
    const html = renderToStaticMarkup(createElement(FrontierPanel, {
      assets: [], positions: [], historical: state, compact: true
    }));
    expect(html).toContain("Métricas de tu cartera");
    expect(html).toContain(state.model.current!.volatilityLabel);
    expect(html).toContain("EUR");
    expect(html).not.toContain("Estimación aproximada");
    expect(html).not.toContain("media de activos");
    expect(html).not.toContain("frontier-cards");
    const error = renderToStaticMarkup(createElement(FrontierPanel, {
      assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)], positions: [],
      historical: { status: "error", message: "Sin series comunes" }, compact: true
    }));
    expect(error).toContain("Sin series comunes");
    expect(error).not.toContain("Aproximada");
    expect(error).not.toContain("Frontera estimada por composición");
  });

  /* B7 (decisión 30-09): la frontera sale SIEMPRE en el Constructor. Con la
     histórica en error o cargando, se dibuja la estimada por composición con
     el motivo en el pie. No sitúa la cartera: ese punto sería una suma ponderada (decisión 36). */
  test("compact: con la histórica en error dibuja la estimada por composición con el motivo", () => {
    const html = renderToStaticMarkup(createElement(FrontierPanel, {
      assets: [weeklyAsset("A", 0.08, 0.12), weeklyAsset("B", 0.05, 0.16, "FIXED_INCOME")],
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      historical: { status: "error", message: "Sin series comunes" }, compact: true
    }));
    expect(html).toContain("Frontera estimada por composición · Sin series comunes");
    expect(html).toContain("frontera estimada por composición · tipo sin riesgo");
    expect(html).not.toContain("Cartera actual");
    expect(html).not.toContain("Tu cartera");
    expect(html).toContain("Frontera eficiente");
    expect(html).not.toContain("Histórica no disponible");
    expect(html).not.toContain("Estimación aproximada");
  });

  /* A-131: sin pesos, el servidor manda vacío el punto de la cartera y el adaptador lo rechaza nombrando el campo.
     Ese nombre no llega a la pantalla: el pie dice lo que pasa, que faltan los pesos. */
  describe("el pie de la estimada no escribe el nombre de un campo", () => {
    const sinPunto = () => frontierStateFromRawResponse({ ...validRaw(), current_portfolio: null });
    const dos = () => [weeklyAsset("A", 0.08, 0.12), weeklyAsset("B", 0.05, 0.16, "FIXED_INCOME")];

    test("el adaptador sigue rechazando la respuesta sin punto de la cartera, y nombra el campo", () => {
      expect(sinPunto()).toEqual({ status: "error", message: "current_portfolio inválido" });
    });

    test("sin pesos, el motivo es que faltan los pesos", () => {
      expect(approximateFrontierReason(sinPunto(), false)).toBe("asigna pesos a la cartera para calcular la histórica");
      const html = renderToStaticMarkup(createElement(FrontierPanel, {
        assets: dos(), positions: [{ asset_id: "A", weight_percent: 0 }, { asset_id: "B", weight_percent: 0 }],
        historical: sinPunto(), compact: true
      }));
      expect(html).toContain("Frontera estimada por composición · asigna pesos a la cartera para calcular la histórica");
      expect(html).not.toContain("current_portfolio");
    });

    test("con pesos, no manda repartir lo que ya está repartido", () => {
      expect(approximateFrontierReason(sinPunto(), true)).toBe("la cartera no se pudo situar en la histórica");
      const html = renderToStaticMarkup(createElement(FrontierPanel, {
        assets: dos(), positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
        historical: sinPunto(), compact: true
      }));
      expect(html).toContain("Frontera estimada por composición · la cartera no se pudo situar en la histórica");
      expect(html).not.toContain("asigna pesos");
      expect(html).not.toContain("current_portfolio");
    });

    test("sin estimada posible, el estado de la histórica tampoco lo escribe en su frase", () => {
      const html = renderToStaticMarkup(createElement(FrontierPanel, {
        assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)], positions: [],
        historical: sinPunto(), compact: true
      }));
      expect(html).toContain("<span>Asigna pesos a la cartera para calcular la frontera histórica.</span>");
      expect(html).not.toContain("<span>current_portfolio");
    });

    test("los demás motivos llegan como los escribe quien los da", () => {
      const estado = { status: "error" as const, message: "Sin series comunes." };
      expect(approximateFrontierReason(estado, false)).toBe("Sin series comunes.");
      expect(approximateFrontierReason(estado, true)).toBe("Sin series comunes.");
      expect(approximateFrontierBadge(approximateFrontierReason(estado, true))).toBe("Frontera estimada por composición · Sin series comunes");
    });
  });

  test("compact: mientras carga la histórica ya enseña la estimada, y con resultado la sustituye", () => {
    const props = {
      assets: [weeklyAsset("A", 0.08, 0.12), weeklyAsset("B", 0.05, 0.16, "FIXED_INCOME")],
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      compact: true
    };
    const loading = renderToStaticMarkup(createElement(FrontierPanel, { ...props, historical: { status: "loading" } }));
    expect(loading).toContain("Frontera estimada por composición · calculando la histórica con series reales");
    expect(loading).toContain("oaa-chart-frame");
    const state = frontierStateFromRawResponse(validRaw());
    const ready = renderToStaticMarkup(createElement(FrontierPanel, { ...props, historical: state }));
    expect(ready).toContain("Métricas de tu cartera");
    expect(ready).not.toContain("Frontera estimada por composición");
  });

  test("HorizonFrontier: sin frontera histórica en el análisis dibuja la estimada con el motivo", () => {
    const approximate = computeFrontier([
      { id: "A", name: "A", expectedReturn: 0.08, volatility: 0.12, assetClass: "EQUITY" },
      { id: "B", name: "B", expectedReturn: 0.05, volatility: 0.16, assetClass: "FIXED_INCOME" }
    ], { currentWeights: { A: 0.6, B: 0.4 } });
    const analysis = {
      years: 3, frontier: null, frontierUnavailableReason: "Sin histórico común de la cartera.", extensions: [], coverageWeightPercent: 100
    } as unknown as PortfolioHorizon;
    const html = renderToStaticMarkup(createElement(HorizonFrontier, { analysis, approximate }));
    expect(html).toContain("Frontera eficiente · 3 años · estimada por composición");
    expect(html).toContain("Frontera estimada por composición · Sin histórico común de la cartera");
    expect(html).toContain("no con series históricas");
    const without = renderToStaticMarkup(createElement(HorizonFrontier, { analysis, approximate: null }));
    expect(without).toContain("Sin histórico común de la cartera.");
    expect(without).not.toContain("estimada por composición");
  });

  test("FrontierPanel sin histórico etiqueta el fallback como 'Estimación aproximada'", () => {
    const html = renderToStaticMarkup(
      /* El estado se da desde fuera: sin él, donde la histórica está habilitada el panel dice que faltan los pesos (A-135),
         y esta prueba es de la etiqueta, no de eso. Así no depende del entorno en que corra. */
      createElement(FrontierPanel, { assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)], positions: [], historical: { status: "idle" } })
    );
    expect(html).toContain("Estimación aproximada");
    expect(html).not.toContain("Frontera histórica");
  });

  test("FrontierPanel con resultado histórico muestra la histórica y no la aproximada", () => {
    const state = frontierStateFromRawResponse(validRaw());
    const html = renderToStaticMarkup(
      createElement(FrontierPanel, {
        assets: [asset("A", 0.08, 0.12), asset("B", 0.05, 0.16)],
        positions: [],
        historical: state
      })
    );
    expect(html).toContain("Frontera histórica");
    expect(html).not.toContain("Estimación aproximada");
  });
});
