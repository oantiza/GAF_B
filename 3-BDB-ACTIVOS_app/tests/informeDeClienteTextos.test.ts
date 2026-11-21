/**
 * Lo que el informe de cliente dice, leído en el PDF generado (decisiones 3 y 4). Las cifras de cada frase tienen su
 * prueba de resultado conocido en `crisisPasadas`, `parteMedida` y `lecturaDelMapa`: aquí se mira que lleguen a la hoja
 * que toca, y que lo que Óscar ha quitado no vuelva.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BacktestResponse, BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { createInformeDeClientePdfBlob, informeDeClienteMetricRows, notaDelTipoSinRiesgo, type InformeDeClientePdfInput } from "../src/reports/informeDeClientePdf";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";
import type { FrontierViewModel } from "../src/types/portfolioFrontier";
import { extractPdfPageTexts } from "./support/pdfText";
import { numeroDe, numerosDeSeccion, numerosSeguidos, seccion } from "./support/seccionesDelInformeDeCliente";

/* Los números esperados salen de `numerosSeguidos`: las nueve secciones de siempre, una más con el cono estadístico (solo con cifra de la
   cartera) y otra con el histórico ampliado; seguidos y sin saltos, y ninguna hoja de anexo de más. */

const positions = [
  { asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 7.5 }, { asset_id: "D", weight_percent: 2.5 }
];

const crisis = (parte: Partial<BacktestStressScenario> & Pick<BacktestStressScenario, "id">): BacktestStressScenario => ({
  label: parte.id, configured_start_date: "2020-02-19", configured_end_date: "2020-03-23", start_date: "2020-02-19", end_date: "2020-03-23",
  trough_date: "2020-03-23", common_data_end_date: "2026-08-28", drawdown_pct: -20.567835, duration_days: 33, recovery_date: "2020-11-24",
  recovery_days: 246, remaining_to_recover_pct: 0, recovery_status: "RECOVERED", worst_asset: null,
  coverage: { weight_pct: 90, included_assets: 2, total_assets: 4 }, representative: true, included_assets: ["A", "B"],
  excluded_assets: [{ asset_id: "C", reason: "NO_DATA_AT_WINDOW_START" }, { asset_id: "D", reason: "QUALITY_BLOCKED" }], reason: null, ...parte
});

const COVID = crisis({ id: "COVID" });
const TIPOS = crisis({ id: "RATES_2022", configured_start_date: "2022-01-01", configured_end_date: "2022-10-31", start_date: "2022-01-04", end_date: "2022-10-31", trough_date: "2022-10-12", drawdown_pct: -14.865142 });

function backtest(assetIds = ["A", "B"], stress: BacktestStressScenario[] = [COVID, TIPOS], count = 158, window: "3Y" | "5Y" = "3Y", risk_free_rate_policy = "WINDOW_AVERAGE"): BacktestResponse {
  const series = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2023, 7, 25) + i * 7 * 86_400_000).toISOString().slice(0, 10),
    value: 100 * Math.exp(i * .0018 + .025 * Math.sin(i * .7))
  }));
  return {
    schema_version: "backtest.v1", window, frequency: "WEEKLY", asset_ids: assetIds, portfolio_series: series,
    metrics: { cagr: .13, volatility: .09, sharpe: 1.2, max_drawdown: -.1, rf_rate: .02 }, benchmark_series: {}, stress_scenarios: stress, synthetics: [],
    risk_free: { risk_free_source: "ECB_ESTR", risk_free_rate: .02, risk_free_rate_policy },
    coverage: { requested_assets: 4, included_assets: assetIds.length, common_observations: count, first_date: series[0].date, last_date: series.at(-1)!.date },
    excluded_assets: positions.filter((p) => !assetIds.includes(p.asset_id)).map((p) => ({ asset_id: p.asset_id, reason: p.asset_id === "D" ? "QUALITY_BLOCKED" : "INSUFFICIENT_HISTORY" }))
  } as unknown as BacktestResponse;
}

function analisis(bt: BacktestResponse, coverageWeightPercent = 90, extra: Partial<PortfolioHorizon> = {}): PortfolioHorizon {
  return { window: bt.window as "3Y", years: bt.window === "5Y" ? 5 : 3, referenceVersion: "test", backtest: bt, frontier: null, equalWeight: bt, maxSharpe: null,
    coverageWeightPercent, extensions: [], methodology: "Estimación", ...extra } as PortfolioHorizon;
}

function report(filas = positions, categorias: Array<{ key: string; weight_percent: number }> = []): BdbPortfolioReport {
  return {
    portfolio_name: "Prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: { source: "BBDD_STATIC_EXPORT_SAMPLE", position_count: filas.length, total_weight_percent: 100, validation_status: "VALID", is_valid: true,
      by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], non_investable_assets: [], warnings: [],
      weighted_metrics: { preview_boundary: { mode: "PREVIEW_ONLY", source_label: "test", limitations: [] } } },
    positions: filas.map((p) => ({ ...p, display_name: `Activo ${p.asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "COMPLETE",
      is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } })),
    warnings: [], xray: { by_region: [{ key: "europe", weight_percent: 100 }], by_category: categorias }, data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
}

const entrada = (parte: Partial<InformeDeClientePdfInput>): InformeDeClientePdfInput => ({
  report: report(),
  generadoEn: "2026-09-06T12:00:00Z",
  feasibility: { status: "FEASIBLE", blocking_issues: [], warnings: [], locked_weight: 0, unlocked_budget: 1 } as unknown as PortfolioFeasibilityCheck,
  referencia: null,
  ...parte
});

/** La extracción pierde la ligadura «fi» y parte las líneas: se compara sin ella y con un solo espacio. */
const plano = (texto: string) => texto.replace(/\s+/g, " ").replace(/fi/g, "");

async function hojas(parte: Partial<InformeDeClientePdfInput>): Promise<string[]> {
  const blob = await createInformeDeClientePdfBlob(entrada(parte));
  return extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).map(plano);
}

const SIMULACION = "Simulación con los pesos de hoy, sin aportaciones ni retiradas.";

/**
 * Ocho posiciones y cinco fuera, con motivos distintos: más de tres, así que la nota bajo la curva las cuenta sin nombrarlas. Desde A-143
 * (12-11-2026) ya no manda al anexo, que es una sola línea al pie de la guía y no las detalla.
 */
function conCincoFuera(extra: Partial<PortfolioHorizon> = {}, cobertura = 70) {
  const ocho = Array.from({ length: 8 }, (_, i) => ({ asset_id: `ASSET${i}`, weight_percent: 12.5 }));
  const excluded_assets = ocho.slice(3).map((p, i) => ({ asset_id: p.asset_id, reason: i % 2 ? "QUALITY_BLOCKED" : "INSUFFICIENT_HISTORY" }));
  return { report: report(ocho), analysis: analisis({ ...backtest(["ASSET0", "ASSET1", "ASSET2"]), excluded_assets } as BacktestResponse, cobertura, extra) };
}

/* Desde el 15-11-2026 el cono estadístico vuelve al papel (Óscar), centrado en el tipo sin riesgo y explicado para el cliente; lo
   prueba `informeDeClienteSeisHojas`. Lo que sigue fuera es la proyección de entonces: su nombre, su deriva y sus percentiles. */
describe("decisión 3: las crisis pasadas sustituyen a la proyección", () => {
  test("en la misma hoja, con sus cifras, fechas y parte medida, y sin rastro de la proyección", async () => {
    const paginas = await hojas({ analysis: analisis(backtest()) });
    const hoja = seccion(paginas, "crisis");
    expect(hoja).toMatch(/\d\d Crisis pasadas/);
    expect(hoja).toContain("Cómo se habría comportado esta composición en crisis pasadas");
    expect(hoja).toContain("−20,57 %");
    expect(hoja).toContain("Del 19/02/2020 al 23/03/2020");
    expect(hoja).toContain("−14,87 %");
    expect(hoja).toContain("Del 04/01/2022 al 12/10/2022");
    expect(hoja).toContain("Mide el 90,0 % de la cartera (2 de 4 posiciones)");
    expect(hoja).toContain("Fuera: Activo C (7,5 %) y Activo D (2,5 %)");
    expect(hoja).toContain("No se mide desde un máximo");
    expect(hoja).toContain("llevados al 100 %");
    const todo = paginas.join(" ");
    /* «deriva» como palabra, la de la proyección: «derivados» sale ahora en la nota del solapamiento (decisión 87), y no es eso. */
    expect(todo).not.toMatch(/Monte Carlo|Proyección|proyección|P5-P95|Mediana \(P50\)|\bderiva\b/);
    /* La historia común no es una crisis. */
    expect(todo).not.toContain("Historia común");
  }, 20_000);

  test("sin datos para ninguna crisis, se dice y no hay fichas", async () => {
    const vacia = crisis({ id: "COVID", start_date: null, end_date: null, trough_date: null, drawdown_pct: null, recovery_status: "NO_DATA", coverage: { weight_pct: 0, included_assets: 0, total_assets: 4 }, representative: false, reason: "NO_ELIGIBLE_ASSETS" });
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [vacia, { ...vacia, id: "RATES_2022", configured_start_date: "2022-01-01" }])) });
    const hoja = seccion(paginas, "crisis");
    expect(hoja).toContain("no tiene datos para medir estas crisis");
    expect(hoja).toContain("COVID-19 (desde 19/02/2020)");
    /* Solo la parte de las crisis: el solapamiento de debajo dice «100,0 % de la cartera», y eso no es una crisis. */
    expect(hoja).not.toContain("0,0 %");
    expect(hoja).not.toContain("Mide el");
    expect(hoja).not.toContain("Cifra poco representativa");
  }, 20_000);

  test("una respuesta sin escenarios tampoco finge", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [])) });
    expect(seccion(paginas, "crisis")).toContain("no tiene datos de crisis pasadas");
  }, 20_000);

  test("decisión 103: por debajo del 60 % no hay cifra, dice lo que mide y quién queda fuera; la otra crisis, sin datos, también lo dice", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [
      crisis({ id: "COVID", coverage: { weight_pct: 45, included_assets: 1, total_assets: 4 }, representative: false }),
      crisis({ id: "RATES_2022", start_date: null, end_date: null, trough_date: null, drawdown_pct: null, recovery_status: "NO_DATA", coverage: { weight_pct: 0, included_assets: 0, total_assets: 4 }, representative: false, reason: "INSUFFICIENT_COMMON_DATA" })
    ])) });
    const hoja = seccion(paginas, "crisis");
    expect(hoja).toContain("Falta el dato");
    expect(hoja).toContain("Mide el 45,0 % de la cartera, y hace falta al menos el 60 %.");
    expect(hoja).toContain("Fuera: Activo C (7,5 %) y Activo D (2,5 %)");
    expect(hoja).not.toContain("−20,57 %");
    expect(hoja).not.toContain("Del 19/02/2020");
    expect(hoja).not.toContain("poco representativa");
    expect(hoja).toContain("Sin datos");
    expect(hoja).toContain("no coinciden en fechas sucientes");
  }, 20_000);

  test("decisión 103: una crisis por debajo y otra por encima, cada una dice lo suyo", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [
      crisis({ id: "COVID", coverage: { weight_pct: 40, included_assets: 1, total_assets: 4 }, representative: false }),
      crisis({ id: "RATES_2022", configured_start_date: "2022-01-01", configured_end_date: "2022-10-31", start_date: "2022-01-04", end_date: "2022-10-31", trough_date: "2022-10-12", drawdown_pct: -14.865142 })
    ])) });
    const hoja = seccion(paginas, "crisis");
    expect(hoja).toContain("Mide el 40,0 % de la cartera, y hace falta al menos el 60 %.");
    expect(hoja).toContain("−14,87 %");
    expect(hoja).toContain("Mide el 90,0 % de la cartera (2 de 4 posiciones)");
    expect(hoja).not.toContain("−20,57 %");
  }, 20_000);
});

describe("decisión 4: lo que lee el cliente", () => {
  test("bajo la curva, la simulación y la cobertura sacada del dato; bajo las cifras ya no (A-143)", async () => {
    const paginas = await hojas({ analysis: analisis(backtest()) });
    const cobertura = "Mide el 90,0 % de la cartera (2 de 4 posiciones); quedan fuera Activo C (7,5 %), por no tener historia suciente en este periodo; y Activo D (2,5 %), por una incidencia en su serie de precios.";
    const evolucion = seccion(paginas, "evolucion");
    expect(evolucion).toContain(SIMULACION);
    expect(evolucion).toContain(cobertura);
    const cifras = seccion(paginas, "cifras");
    expect(cifras).not.toContain(SIMULACION);
    expect(cifras).not.toContain("Mide el");
    /* Y al pie de la guía, la parte medida en una línea, sin nombres. */
    expect(seccion(paginas, "guia")).toContain(plano("Cifras calculadas sobre el 90,0 % de la cartera. Del 10,0 % restante no hay datos suficientes para el periodo medido."));
    expect(seccion(paginas, "guia")).not.toContain("Activo C");
  }, 20_000);

  test("con toda la cartera medida sigue la simulación bajo la curva, sin frase de cobertura ni anexo", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B", "C", "D"], [COVID, TIPOS]), 100) });
    const metricas = seccion(paginas, "cifras");
    const evolucion = seccion(paginas, "evolucion");
    expect(metricas).not.toContain(SIMULACION);
    expect(evolucion).toContain(SIMULACION);
    expect(paginas.join(" ")).not.toContain("Mide el 100");
    expect(paginas.join(" ")).not.toContain("quedan fuera");
    expect(paginas.join(" ")).not.toMatch(/Qué queda fuera del cálculo|Alcance de las cifras|Cifras calculadas sobre/);
    expect(numerosDeSeccion(paginas)).toEqual(numerosSeguidos(paginas));
  }, 20_000);

  test("sin serie de la cartera no se dice que sea una simulación", async () => {
    const paginas = await hojas({ report: report() });
    expect(paginas.join(" ")).not.toContain(SIMULACION);
  }, 20_000);

  test("título, leyenda y anexos dicen lo que es", async () => {
    /* Dos fuera: la nota de la curva las nombra con su motivo, y el anexo no repite la fila: es una línea sin nombres (A-143). */
    const paginas = await hojas({ analysis: analisis(backtest()), report: report() });
    const todo = paginas.join(" ");
    expect(seccion(paginas, "evolucion")).toContain("Composición simulada");
    expect(todo).toContain("Activo D (2,5 %), por una incidencia en su serie de precios.");
    expect(todo).not.toContain("Qué queda fuera del cálculo");
    expect(todo).not.toContain("bloqueado por calidad del dato");
    expect(todo).not.toMatch(/Parte cubierta|capital cubierto|importes proyectados|Cobertura de/);
    /* Cinco fuera: la nota las cuenta y da el motivo común, sin mandar a un anexo que ya no las detalla; el anexo dice la parte medida. */
    const conAnexo = (await hojas(conCincoFuera({}, 80))).join(" ");
    expect(conAnexo).toContain(plano("quedan fuera 5 posiciones (62,5 % del peso), por falta de datos suficientes para el periodo medido."));
    expect(conAnexo).not.toMatch(/anexo|Qué queda fuera del cálculo|Estas posiciones no entran|Fuera por/);
    expect(conAnexo).toContain("Alcance de las cifras");
    expect(conAnexo).toContain(plano("Cifras calculadas sobre el 37,5 % de la cartera. Del 62,5 % restante no hay datos suficientes para el periodo medido."));
    expect(conAnexo).not.toContain("bloqueado por calidad del dato");
  }, 20_000);

  /* La frontera volvió al informe de cliente el 16-11-2026 («También la frontera»), y revisa A-136.1. Con una frontera parcial se
     dibuja, con «Parte cubierta» y lo que queda fuera nombrado bajo el gráfico; el anexo sigue siendo uno solo, el de lo que queda
     fuera del cálculo, porque A-136.5 no cambia y los dos anexos del papel del 02-11 repetían las mismas filas. */
  test("con frontera parcial: la curva, «Parte cubierta» y lo que queda fuera bajo el gráfico, sin anexo propio", async () => {
    const punto = (volatility: number, expectedReturn: number) => ({ volatility, expectedReturn, sharpeRatio: 1, volatilityLabel: "", expectedReturnLabel: "", sharpeLabel: "", weights: [] });
    const frontera = {
      kind: "historical", label: "Frontera eficiente · 3 años", window: "3Y", asOfDate: "2026-08-28", riskFreeRateLabel: "2,00 %", riskFreeSource: "ECB_ESTR", riskFreeRatePolicy: "WINDOW_AVERAGE",
      coverage: { requested: 4, included: 2, commonObservations: 158, firstDate: "2023-08-25", lastDate: "2026-08-28" },
      portfolioCoverage: { requested: 4, included: 2, weightPercent: 90, excluded: [{ assetId: "C", weightPercent: 7.5, reasonLabel: "histórico insuficiente" }, { assetId: "D", weightPercent: 2.5, reasonLabel: "bloqueado por calidad del dato" }] },
      insufficientCoverage: false, current: punto(.071, .064), minVolatility: punto(.041, .038), maxSharpe: punto(.082, .078),
      frontier: Array.from({ length: 12 }, (_, i) => punto(.041 + i * .007, .038 + i * .0052)), excluded: [], warnings: []
    } as unknown as FrontierViewModel;
    const paginas = await hojas({ analysis: analisis(backtest(), 90, { frontier: frontera }) });
    const todo = paginas.join(" ");
    const laFrontera = seccion(paginas, "frontera");
    expect(laFrontera).toContain("Parte cubierta");
    expect(laFrontera).toContain("Menor oscilación");
    /* Cubre dos de cuatro posiciones, el 90 % del peso, y las otras dos van bajo el gráfico con las palabras del cliente: la etiqueta
       del servidor, «bloqueado por calidad del dato», no sale en ninguna parte del papel. */
    expect(laFrontera).toContain("Cubre el 90,0 % del peso: 2 de 4 posiciones.");
    expect(laFrontera).toContain("Fuera de la frontera:");
    expect(todo).not.toContain("bloqueado por calidad del dato");
    /* Las dos que quedan fuera del cálculo las nombra la nota, con su motivo: no hay anexo. */
    expect(todo).not.toContain("Qué queda fuera del cálculo");
    expect(todo).toContain("por una incidencia en su serie de precios.");
    expect(numerosDeSeccion(paginas)).toEqual(numerosSeguidos(paginas));
  }, 20_000);

  test("la guía describe y no juzga", async () => {
    const paginas = await hojas({ analysis: analisis(backtest()) });
    const guia = seccion(paginas, "guia");
    expect(guia).toContain("Rentabilidad por encima del tipo sin riesgo por cada punto de oscilación en el periodo medido. No mide la calidad de la gestión ni anticipa el futuro.");
    expect(guia).toContain("Hacia arriba: mayor rentabilidad en el periodo medido; comparada con cinco carteras de referencia");
    expect(guia).toContain("No es el peor escenario posible.");
    expect(guia).toContain("Caída máxima a 3 años");
    expect(guia).toContain("Tipo sin riesgo");
    expect(guia).toContain("Solapamiento");
    expect(guia.toUpperCase().replace(/\s+/g, "")).toContain("LAMAYORCAÍDADENTRODEESTEPERIODO");
    expect(guia).not.toMatch(/gestión excelente|decisiones inteligentes|peligros innecesarios|nivel de confort|ganancia esperada|en comparación con el mercado|regularizan|optimizador/);
    expect(guia.toUpperCase().replace(/\s+/g, "")).not.toContain("¿CUÁLESELPEORESCENARIO?");
    /* Sin histórico ampliado no hay tramos estimados que decir. */
    expect(guia).not.toContain("tramos estimados");
  }, 20_000);

  test("la guía dice lo que es verdad en esta cartera: tramos estimados y tipo de respaldo", async () => {
    const conReferencia = [{ assetId: "A", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-25", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: .97, residualVolatility: .08, referenceHasBacktestedHistory: false }];
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [COVID, TIPOS], 158, "3Y", "STATIC_FALLBACK"), 90, { extensions: conReferencia }) });
    const guia = seccion(paginas, "guia");
    expect(guia).toContain("Incluye los tramos estimados indicados en el anexo.");
    expect(guia).toContain("Un tipo jo de respaldo");
    expect(paginas.join(" ")).toContain(`las crisis pasadas de la sección ${numeroDe(paginas, "crisis")} no: solo usan precios observados`);
  }, 20_000);

  test("nada de jerga ni de tuteo en ninguna hoja, tampoco en el mapa con perfiles", async () => {
    const { SERIES_HASTA_20260928 } = await import("./support/referenciaDePrueba");
    const paginas = await hojas({ analysis: analisis(backtest()), referencia: SERIES_HASTA_20260928 });
    const todo = paginas.join(" ");
    expect(todo).toMatch(/En este periodo, la composición simulada (queda|oscila)/);
    expect(todo).toContain("Mapa riesgo-rentabilidad frente a carteras de referencia");
    expect(todo).toContain("Carteras de referencia");
    /* Una palabra para cada cosa (decisión 66): sin la ligadura «fi», que este lector no saca. */
    expect(todo).not.toMatch(/[Pp]erl(es)? de referencia|los perles|línea de perles/);
    expect(todo).toContain("ambos parten de 100");
    expect(todo).not.toMatch(/\bTu cartera\b|\bSu cartera\b|\bCAGR\b|[Bb]enchmark|rebasad|según el contrato local|riesgo-retorno|correspondería|Máx\. caída|\b3A\b/);
  }, 20_000);

  describe("una palabra para cada cosa (decisión 66)", () => {
    const CATEGORIAS = [{ key: "EAA Fund Global Large-Cap Blend Equity", weight_percent: 60 }, { key: "N/D", weight_percent: 40 }];
    const conFichas = (tipos: Record<string, string>): BdbPortfolioReport => {
      const base = report(positions, CATEGORIAS);
      return { ...base, positions: base.positions.map((p) => ({ ...p, instrument_type: tipos[p.asset_id] ?? "FUND" })) } as BdbPortfolioReport;
    };
    const hojaDeLaComposicion = async (informe: BdbPortfolioReport) => {
      const paginas = await hojas({ analysis: analisis(backtest()), report: informe });
      return seccion(paginas, "reparto");
    };

    test("lo que un fondo no trae es «No declarado», y ya no «Sin clasificar»", async () => {
      const hoja = await hojaDeLaComposicion(conFichas({}));
      expect(hoja).toContain("No declarado");
      expect(hoja).not.toContain("Sin clas");
    }, 20_000);

    test("una acción sin categoría no es algo que no se declare: es una acción, como en la base vieja, y su peso se lleva lo suyo", async () => {
      /* B (30 %) es una acción sin categoría; del 40 % sin categoría quedan 10 puntos de los fondos. */
      const hoja = await hojaDeLaComposicion(conFichas({ B: "STOCK" }));
      expect(hoja).toMatch(/Acciones\s*30,0 %/);
      expect(hoja).toMatch(/No declarado\s*10,0 %/);
    }, 20_000);

    test("si todo lo que no tiene categoría son acciones, «No declarado» no sale", async () => {
      const base = report([{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }], CATEGORIAS);
      const informe = { ...base, positions: base.positions.map((p) => ({ ...p, instrument_type: p.asset_id === "B" ? "STOCK" : "FUND" })) } as BdbPortfolioReport;
      const hoja = await hojaDeLaComposicion(informe);
      expect(hoja).toMatch(/Acciones\s*40,0 %/);
      expect(hoja).not.toContain("No declarado");
    }, 20_000);

    test("el mapa: lo que no consta es «No declarado», lo dice debajo, y lo que el dato nombra y no se sabe situar va aparte", async () => {
      const declarado = await hojas({ analysis: analisis(backtest()), report: report(), regionRows: [{ key: "eurozone", weight_percent: 80 }] });
      const hoja = seccion(declarado, "geografia");
      expect(hoja).toContain("La parte sin ubicación se muestra como «No declarado».");
      expect(hoja).toMatch(/No declarado\s*20,0 %/);
      expect(hoja).not.toContain("Sin asignar");
      expect(hoja).not.toContain("Sin situar");

      const porPais = await hojas({ analysis: analisis(backtest()), report: report(), regionRows: [{ key: "eurozone", weight_percent: 80 }, { key: "vietnam", weight_percent: 20 }] });
      const otra = seccion(porPais, "geografia");
      expect(otra).toMatch(/Sin situar\s*20,0 %/);
      expect(otra).toContain("el mapa no sabe situar");
      expect(otra).not.toContain("No declarado");
    }, 20_000);

    test("en singular se queda: «Cartera de referencia» cuando es una", async () => {
      const paginas = await hojas({ analysis: analisis(backtest()), referencia: null });
      expect(paginas.join(" ")).toContain("Cartera de referencia: falta el dato");
    }, 20_000);
  });

  test("«accion» sale con su tilde, y la sección dice que son categorías", async () => {
    const paginas = await hojas({ analysis: analisis(backtest()), report: report(positions, [{ key: "accion", weight_percent: 25 }, { key: "EAA Fund Global Large-Cap Blend Equity", weight_percent: 75 }]) });
    const hoja = seccion(paginas, "reparto");
    expect(hoja).toContain("Composición por categoría");
    expect(hoja).toContain("Acciones");
    expect(hoja).not.toMatch(/\baccion\b/);
    expect(hoja).not.toContain("activo subyacente");
  }, 20_000);
});

describe("decisión 41: el Sharpe de una cartera que es una sola acción", () => {
  /** Los tipos de cada posición, con los pesos y las series de arriba. La simulación da Sharpe 1,2, y la tira lo imprime «1,20». */
  const conTipos = (tipos: Record<string, string>, filas = positions): BdbPortfolioReport => {
    const base = report(filas);
    return { ...base, positions: base.positions.map((p) => ({ ...p, instrument_type: tipos[p.asset_id] ?? "FUND" })) } as BdbPortfolioReport;
  };
  const unaSola = [{ asset_id: "A", weight_percent: 100 }];
  const sharpeDe = (rep: BdbPortfolioReport, medidos: string[]) => informeDeClienteMetricRows(rep, analisis(backtest(medidos), 100)).find((fila) => fila.label.startsWith("Sharpe"))!;

  test("la tira: una sola acción dice «No aplica», con su rótulo y sin el color de una cifra", () => {
    const fila = sharpeDe(conTipos({ A: "STOCK" }, unaSola), ["A"]);
    expect(fila.value).toBe("No aplica");
    expect(fila.label).toBe("Sharpe 3 años");
    expect(fila.ausencia).toBe("no-aplica");
  });

  test("con la acción dentro de una cartera con fondos sale, y es la cifra de la cartera", () => {
    const fila = sharpeDe(conTipos({ A: "STOCK" }), ["A", "B"]);
    expect(fila.value).toBe("1,20");
    expect(fila.ausencia).toBeUndefined();
  });

  test("si lo medido se queda en la acción, porque los fondos no entran, tampoco sale: es la cifra de la acción", () => {
    expect(sharpeDe(conTipos({ A: "STOCK" }), ["A"]).value).toBe("No aplica");
  });

  test("dos acciones son una cartera: como en la pantalla, sale", () => {
    const dos = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }];
    expect(sharpeDe(conTipos({ A: "STOCK", B: "STOCK" }, dos), ["A", "B"]).value).toBe("1,20");
  });

  test("un fondo solo sigue con su cifra: la regla es de acciones", () => {
    expect(sharpeDe(conTipos({ A: "FUND" }, unaSola), ["A"]).value).toBe("1,20");
  });

  test("en papel: la hoja 3 no imprime la cifra, y la guía no la explica como si saliera", async () => {
    const paginas = await hojas({ report: conTipos({ A: "STOCK" }, unaSola), analysis: analisis(backtest(["A"], [COVID, TIPOS]), 100) });
    expect(numerosDeSeccion(paginas)).toEqual(numerosSeguidos(paginas));
    const metricas = seccion(paginas, "cifras");
    expect(metricas).toContain("No aplica");
    expect(metricas).not.toContain("1,20");
    /* El resto de la tira no se mueve, y la cifra del tipo sin riesgo sigue, en su nota y sin llamarse referencia de un Sharpe que no sale. */
    expect(metricas).toContain("+13,00 %");
    expect(metricas).toContain("Tipo sin riesgo a 3 años: 2,00 %.");
    const guia = seccion(paginas, "guia");
    const seguido = guia.toUpperCase().replace(/\s+/g, "");
    expect(seguido).toContain("NOAPLICAAUNASOLAACCIÓN");
    expect(guia).toContain("Lo que mide la simulación es una sola acción, y a una acción no se le da este ratio. De un componente importa lo que aporta a la cartera, no su nota aislada.");
    expect(guia).not.toContain("Rentabilidad por encima del tipo sin riesgo");
    expect(seguido).not.toContain("LAREFERENCIADELRATIODESHARPE");
    expect(seguido).toContain("LAREFERENCIADELDINEROAMUYCORTOPLAZO");
  }, 20_000);

  test("en papel: con la acción dentro de una cartera con fondos, cifra y guía de siempre", async () => {
    const paginas = await hojas({ report: conTipos({ A: "STOCK" }), analysis: analisis(backtest()) });
    expect(seccion(paginas, "cifras")).toContain("1,20");
    const guia = seccion(paginas, "guia");
    expect(guia).toContain("Rentabilidad por encima del tipo sin riesgo");
    expect(guia.toUpperCase().replace(/\s+/g, "")).toContain("LAREFERENCIADELRATIODESHARPE");
  }, 20_000);
});

describe("nada se parte", () => {
  test("con 39 posiciones y cobertura parcial, crisis y solapamiento caben juntas y cada hoja lleva su número", async () => {
    const muchas = Array.from({ length: 39 }, (_, i) => ({ asset_id: `ASSET${i}`, weight_percent: 100 / 39 }));
    const ids = muchas.slice(0, 36).map((p) => p.asset_id);
    const paginas = await hojas({ report: report(muchas), analysis: analisis(backtest(ids), ids.length / 39 * 100), totalCapital: 1_010_050 });
    /* Las tres que quedan fuera las nombra la nota: sin anexo. Las hojas fluyen; las crisis abren hoja y el solapamiento va con ellas. */
    expect(numerosDeSeccion(paginas)).toEqual(numerosSeguidos(paginas));
    expect(paginas.join(" ")).not.toContain("Qué queda fuera del cálculo");
    const conLasCrisis = paginas.find((p) => /\d\d Crisis pasadas/.test(p))!;
    expect(conLasCrisis).toMatch(/\d\d Solapamiento entre fondos/);
    /* La cobertura va bajo la curva, no bajo las cifras (A-143). */
    expect(seccion(paginas, "cifras")).not.toContain("36 de 39 posiciones");
    expect(seccion(paginas, "evolucion")).toContain("36 de 39 posiciones");
    paginas.forEach((p, i) => expect(p).toContain(`Página ${i + 1} de ${paginas.length}`));
  }, 20_000);

  test("con 17 fuera y sin cifras de la cartera, la nota las cuenta, no manda a ningún anexo, y no hay hoja de anexo", async () => {
    const muchas = Array.from({ length: 19 }, (_, i) => ({ asset_id: `ASSET${i}`, weight_percent: 100 / 19 }));
    const excluded_assets = muchas.slice(2).map((p) => ({ asset_id: p.asset_id, reason: "INSUFFICIENT_HISTORY" }));
    const paginas = await hojas({ report: report(muchas), analysis: analisis({ ...backtest(["ASSET0", "ASSET1"]), excluded_assets } as BacktestResponse, 2 / 19 * 100), totalCapital: 100_000 });
    /* Las hojas del anexo de antes ya no están: las nueve secciones, y cada hoja con su número. */
    expect(numerosDeSeccion(paginas)).toEqual(numerosSeguidos(paginas));
    paginas.forEach((p, i) => expect(p).toContain(`Página ${i + 1} de ${paginas.length}`));
    /* Mide el 10,53 %: no hay cifras, y diecisiete nombres no caben bajo la tira. Los cuenta, con el motivo común. */
    const metricas = seccion(paginas, "cifras");
    expect(metricas).toContain(plano("Se quedan fuera 17 posiciones (89,5 % del peso), por falta de datos suficientes para el periodo medido."));
    expect(metricas).not.toContain("Activo ASSET2 ");
    /* Sin cifras de la cartera no hay «Cifras calculadas sobre…»: diría que las hay. */
    expect(paginas.join(" ")).not.toMatch(/anexo|Alcance de las cifras|Cifras calculadas sobre/);
  }, 20_000);
});

describe("lo que va detrás de la guía se numera seguido, sin saltar ningún número (revisión final, V2-3)", () => {
  /** Los números de las secciones, en orden: desde la plantilla única se numeran las secciones, no las hojas. */
  const numeros = numerosDeSeccion;
  const conReferencia = [{ assetId: "A", reference: "Índice", url: "https://x", estimatedFrom: "2023-08-25", estimatedUntil: "2024-01-05", observedFrom: "2024-01-08", validationWeeks: 80, holdoutCorrelation: .97, residualVolatility: .08, referenceHasBacktestedHistory: false }];

  test("el anexo ya no tiene hoja: va al pie de la guía, que es la última", async () => {
    const paginas = await hojas(conCincoFuera({}, 80));
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas));
    expect(seccion(paginas, "guia")).toContain("Alcance de las cifras");
  }, 20_000);

  test("con histórico ampliado y parte medida: la metodología es la última, sin una más", async () => {
    const paginas = await hojas(conCincoFuera({ extensions: conReferencia }, 80));
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas, { ampliado: true }));
    expect(seccion(paginas, "guia")).toContain("Alcance de las cifras");
    expect(seccion(paginas, "ampliado")).toMatch(/^\d\d Histórico ampliado con referencias/);
  }, 20_000);

  test("con histórico ampliado y la nota que nombra a las que quedan fuera: sin anexo, la metodología es la última", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(), 90, { extensions: conReferencia }) });
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas, { ampliado: true }));
    expect(seccion(paginas, "ampliado")).toMatch(/^\d\d Histórico ampliado con referencias/);
  }, 20_000);

  test("con histórico ampliado y nada fuera: la metodología es la última", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B", "C", "D"]), 100, { extensions: conReferencia }) });
    expect(numeros(paginas)).toEqual(numerosSeguidos(paginas, { ampliado: true }));
    expect(seccion(paginas, "ampliado")).toMatch(/^\d\d Histórico ampliado con referencias/);
  }, 20_000);
});

describe("decisión 59: por debajo del 80 % del peso medido no hay cifra de la cartera, en todo el papel", () => {
  const sinEspacioDuro = (texto: string) => texto.replace(/\s+/g, " ");
  const tira = (peso: number) => informeDeClienteMetricRows(report(), analisis(backtest(), peso)).map((fila) => sinEspacioDuro(fila.value));
  const FALTA = "Falta el dato";

  test.each([[79.9], [79.99], [40], [0]])("con el %d %% las cuatro faltan, y el tipo sin riesgo se queda en su nota: no es una cifra de la cartera", (peso) => {
    expect(tira(peso)).toEqual([FALTA, FALTA, FALTA, FALTA]);
    expect(sinEspacioDuro(notaDelTipoSinRiesgo(report(), analisis(backtest(), peso)))).toBe("Tipo sin riesgo a 3 años: 2,00 %.");
  });

  test.each([[80], [79.99999999999999], [90], [100]])("con el %d %% hay cifras: las de la simulación, calculadas a mano en la entrada", (peso) => {
    /* Con el formato común (paso 9): rentabilidad con su signo y dos decimales; volatilidad y caída, dos decimales. */
    expect(tira(peso)).toEqual(["+13,00 %", "9,00 %", "1,20", "−10,00 %"]);
    expect(sinEspacioDuro(notaDelTipoSinRiesgo(report(), analisis(backtest(), peso)))).toBe("Tipo sin riesgo a 3 años: 2,00 %, la referencia del ratio de Sharpe.");
  });

  test("sin simulación tampoco hay cifra: ni la suma ponderada, que ya no existe, ni el tipo sin riesgo, que sale de ella", () => {
    const filas = informeDeClienteMetricRows(report());
    expect(filas.map((fila) => fila.value)).toEqual([FALTA, FALTA, FALTA, FALTA]);
    expect(filas.map((fila) => fila.label)).toEqual(["Rentabilidad anualizada 3 años", "Volatilidad 3 años", "Sharpe 3 años", "Caída máxima 3 años"]);
    expect(notaDelTipoSinRiesgo(report())).toBe("Tipo sin riesgo a 3 años: falta el dato.");
  });

  test("llega al 80 % y la simulación no da una cifra: ausencia en las cuatro, nunca una suma ponderada", () => {
    const sinSharpe = { ...backtest(), metrics: { cagr: .13, volatility: .09, sharpe: Number.NaN, max_drawdown: -.1, rf_rate: .02 } } as BacktestResponse;
    const conSuma = { ...report(), summary: { ...report().summary, weighted_metrics: { annualized_return_3y: .077, volatility_3y: .066, sharpe_3y: .9, max_drawdown_5y: -.27 } } } as unknown as BdbPortfolioReport;
    expect(informeDeClienteMetricRows(conSuma, analisis(sinSharpe, 90)).map((fila) => sinEspacioDuro(fila.value))).toEqual([FALTA, FALTA, FALTA, FALTA]);
  });

  test("a 5 años, el rótulo es de 5 años", () => {
    expect(informeDeClienteMetricRows(report(), analisis(backtest(["A", "B"], [COVID, TIPOS], 262, "5Y"), 40))[0].label).toBe("Rentabilidad anualizada 5 años");
  });

  describe("el papel de una cartera medida al 30 %", async () => {
    /* Solo mide B, que pesa 30. Se queda fuera todo lo demás: 60 + 7,5 + 2,5. */
    const { SERIES_HASTA_20260928 } = await import("./support/referenciaDePrueba");
    const paginas = await hojas({ analysis: analisis(backtest(["B"]), 30), referencia: SERIES_HASTA_20260928 });
    const hoja = (id: Parameters<typeof seccion>[1]) => seccion(paginas, id);
    const MOTIVO = "La simulación mide el 30,0 % del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se quedan fuera: Activo A (60,0 %), Activo C (7,5 %), Activo D (2,5 %).";

    test("la sección de las cifras: las cuatro faltan, con el motivo, en las palabras de la pantalla", () => {
      const metricas = hoja("cifras");
      expect(metricas.match(/Falta el dato/g)).toHaveLength(4);
      expect(metricas).toContain(MOTIVO);
      for (const cifra of ["13,0", "9,00 %", "1,20", "−10,0"]) expect(metricas).not.toContain(cifra);
      expect(metricas).toContain("2,00 %");
    });

    test("la evolución y el mapa: solo la parte medida, rotulada; sin referencia, sin Diferencial y sin punto en el mapa", () => {
      const evolucion = `${hoja("evolucion")} ${hoja("mapa")}`;
      expect(evolucion).toContain("Evolución simulada de la parte medida");
      expect(evolucion).toContain("Parte medida (30,0 %)");
      expect(evolucion).toContain("no se compara con la cartera de referencia, que es una cartera entera");
      expect(evolucion).toContain(MOTIVO);
      expect(evolucion).not.toContain("Diferencial");
      expect(evolucion).not.toContain("ambos parten de 100");
      expect(evolucion).not.toContain("Composición simulada");
      expect(evolucion).not.toContain("se comparan en las mismas fechas");
      /* El mapa sigue con sus carteras de referencia, y sin la de la parte medida. */
      expect(evolucion).toContain("No hay datos para situar la cartera en el mapa");
      expect(evolucion).toContain("Conservador");
      expect(evolucion).not.toContain("una volatilidad del");
      expect(evolucion).not.toMatch(/la composición simulada (queda|oscila)/);
    });

    test("sin cifra de la cartera no hay cono estadístico: la sección no sale y las crisis siguen a la frontera", () => {
      expect(hoja("cono")).toBe("");
      expect(paginas.join(" ")).not.toContain("Cuánto podría oscilar su inversión");
      /* Entre el mapa y las crisis queda la frontera, que desde el 16-11-2026 vuelve al papel y sí sale sin cifra de la cartera:
         la curva no es una cifra de la cartera, y lo que no se pinta es su punto. */
      expect(Number(numeroDe(paginas, "frontera"))).toBe(Number(numeroDe(paginas, "mapa")) + 1);
      expect(Number(numeroDe(paginas, "crisis"))).toBe(Number(numeroDe(paginas, "frontera")) + 1);
    });

    test("la guía no dice lo que aquí no es verdad, y no hay anexo: el motivo ya nombra las tres que quedan fuera", () => {
      /* El motivo va junto a las cifras, en su sección: la guía manda allí, por su título. */
      expect(hoja("guia")).toMatch(/En esta cartera no se dan las cifras de rentabilidad, volatilidad, Sharpe y caída máxima: «\s*Cifras de la cartera\s*» dice por qué\./);
      expect(paginas.join(" ")).not.toContain("Qué queda fuera del cálculo");
      expect(paginas.join(" ")).not.toMatch(/anexo/);
    });

    test("las crisis pasadas siguen con su propia cobertura: no pasan por este corte", () => {
      expect(seccion(paginas, "crisis")).toContain("−20,57 %");
    });
  });

  test("una sola acción por debajo del 80 %: falta, no «no aplica», y la guía tampoco dice lo que no sale", async () => {
    const acciones = report();
    const rep = { ...acciones, positions: acciones.positions.map((p) => ({ ...p, instrument_type: p.asset_id === "B" ? "STOCK" : "FUND" })) } as BdbPortfolioReport;
    const paginas = await hojas({ report: rep, analysis: analisis(backtest(["B"]), 30) });
    expect(seccion(paginas, "cifras")).not.toContain("No aplica");
    expect(seccion(paginas, "guia").toUpperCase().replace(/\s+/g, "")).not.toContain("NOAPLICAAUNASOLAACCIÓN");
  }, 20_000);

  test("el corte exacto en papel: al 79,99 % sale «79,99 %», nunca «80,0 %» al lado de «Falta el dato»", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["B"]), 79.99) });
    const metricas = seccion(paginas, "cifras");
    expect(metricas).toContain("mide el 79,99 % del peso");
    expect(metricas).not.toContain("80,0 %");
  }, 20_000);

  test("con el 80 % todo sigue como siempre: cifras, comparación y su frase", async () => {
    const { SERIES_HASTA_20260928 } = await import("./support/referenciaDePrueba");
    const paginas = await hojas({ analysis: analisis(backtest(), 80), referencia: SERIES_HASTA_20260928 });
    const evolucion = seccion(paginas, "evolucion");
    expect(evolucion).toContain("Diferencial");
    expect(seccion(paginas, "mapa")).toContain("una volatilidad del 9,00 %");
    /* Ninguna cifra de la cartera falta, sección por sección. La frontera queda fuera de la cuenta: esta simulación no trae
       ninguna, y su sección lo dice, como hacía antes de que A-136 la quitara; eso no es una cifra de la cartera que falte. */
    for (const id of ["cifras", "evolucion", "mapa", "cono", "crisis", "geografia", "composicion", "reparto"] as const) {
      expect(seccion(paginas, id)).not.toContain("Falta el dato");
    }
  }, 20_000);

  /* La frontera volvió el 16-11-2026, pero la decisión 59 sigue: por debajo del 80 % del peso medido no se pinta el punto de la
     cartera, que sería una suma ponderada; la curva y sus dos carteras sí. */
  describe("la frontera vuelve (16-11-2026), sin el punto de la cartera por debajo del 80 %", () => {
    const punto = (volatility: number, expectedReturn: number) => ({ volatility, expectedReturn, sharpeRatio: 1, volatilityLabel: "", expectedReturnLabel: "", sharpeLabel: "", weights: [] });
    const frontera = (peso: number) => ({
      kind: "historical", label: "Frontera eficiente · 3 años", window: "3Y", asOfDate: "2026-08-28", riskFreeRateLabel: "2,00 %", riskFreeSource: "ECB_ESTR", riskFreeRatePolicy: "WINDOW_AVERAGE",
      coverage: { requested: 4, included: 2, commonObservations: 158, firstDate: "2023-08-25", lastDate: "2026-08-28" },
      portfolioCoverage: { requested: 4, included: 2, weightPercent: peso, excluded: [{ assetId: "C", weightPercent: 100 - peso, reasonLabel: "histórico insuficiente" }] },
      insufficientCoverage: false, current: punto(.071, .064), minVolatility: punto(.041, .038), maxSharpe: punto(.082, .078),
      frontier: Array.from({ length: 12 }, (_, i) => punto(.041 + i * .007, .038 + i * .0052)), excluded: [], warnings: []
    }) as unknown as FrontierViewModel;

    test.each([[79.9, false], [80, true]] as const)("con el %d %%, la curva y sus dos carteras; el punto de la cartera, solo con cifra", async (peso, conPunto) => {
      const paginas = await hojas({ analysis: analisis(backtest(), peso, { frontier: frontera(peso) }) });
      const laFrontera = seccion(paginas, "frontera");
      expect(laFrontera).toContain("Menor oscilación");
      expect(laFrontera).toContain("Mejor relación rentabilidad-riesgo");
      if (conPunto) {
        expect(laFrontera).toContain("El punto granate es la parte cubierta");
      } else {
        /* Sin cifra de la cartera no hay punto: la curva se queda y el papel dice por qué no se sitúa. */
        expect(laFrontera).toContain("La cartera no se sitúa en la curva");
        expect(laFrontera).not.toContain("El punto granate");
      }
      /* La curva nunca se presenta como una previsión, mida lo que mida. */
      expect(laFrontera).toContain("con otro periodo sería otra");
      expect(seccion(paginas, "crisis")).toContain("Cómo se habría comportado esta composición en crisis pasadas");
    }, 20_000);

    test("sin frontera, el papel lo dice con el motivo del servidor; con una sola posición medida, la frase de la decisión 102", async () => {
      for (const peso of [40, 85]) {
        const paginas = await hojas({ analysis: analisis(backtest(["A"]), peso, { frontierUnavailableReason: "La frontera necesita al menos dos activos." }) });
        const laFrontera = seccion(paginas, "frontera");
        /* La simulación mide una sola posición: no hay nada que combinar, y se dice con las palabras de la decisión 102. */
        expect(laFrontera).toContain("Hacen falta al menos dos posiciones medidas, y aquí se mide una.");
        expect(laFrontera).not.toMatch(/Máx\. Sharpe|estimada|1,9 %|correlaciones asumidas|Menor riesgo/);
        expect(seccion(paginas, "crisis")).toContain("Cómo se habría comportado esta composición en crisis pasadas");
      }
      /* Una cartera de una sola posición medida dice lo mismo: no hay dos cosas que combinar. (Una sola *acción* sí quita la
         sección entera, por la decisión 83, y eso lo prueba `informeDeClienteSeisHojas`.) */
      const sola = await hojas({ report: report([{ asset_id: "A", weight_percent: 100 }]), analysis: analisis(backtest(["A"]), 100, { frontierUnavailableReason: "La frontera necesita al menos dos activos." }) });
      expect(seccion(sola, "frontera")).toContain("Hacen falta al menos dos posiciones medidas, y aquí se mide una.");
    }, 30_000);
  });
});

describe("la fecha de la portada", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("generado a las 00:30 en Madrid, dice ese día en la presentación y en la composición, no el de Greenwich", async () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    const paginas = await hojas({
      analysis: analisis(backtest()),
      generadoEn: "2026-11-04T23:30:00.000Z"
    });
    expect(seccion(paginas, "presentacion")).toContain("5 de noviembre de 2026");
    expect(paginas.join(" ")).not.toMatch(/04\/11\/2026|4 de noviembre/);
    expect(seccion(paginas, "composicion")).toContain("a fecha 05/11/2026");
  }, 20_000);

  test("sin momento dado, lleva el día en que se genera: lo que antes leía de la vista previa retirada", async () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-15T10:00:00.000Z") });
    try {
      const paginas = await hojas({ analysis: analisis(backtest()), generadoEn: undefined });
      expect(seccion(paginas, "presentacion")).toContain("15 de marzo de 2026");
      expect(seccion(paginas, "composicion")).toContain("a fecha 15/03/2026");
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);
});

describe("decisión 85: la hoja 2 y la hoja 3 cuentan toda la cartera", () => {
  const conFuera = (filas: Array<{ asset_id: string; weight_percent: number }>, fueraDelCatalogo: Array<{ asset_id: string; label?: string; weight_percent: number }>) => {
    const base = report(filas);
    const peso = fueraDelCatalogo.reduce((suma, p) => suma + p.weight_percent, 0);
    return { ...base, summary: { ...base.summary, not_found_weight_percent: peso, not_found_positions: fueraDelCatalogo } } as BdbPortfolioReport;
  };

  test("lo que no está en el catálogo se lista con su ISIN, y la composición lo deja fuera sin repartirlo: 90 + 10", async () => {
    const informe = conFuera([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 40 }], [{ asset_id: "XS0000000000", label: "Bono viejo", weight_percent: 10 }]);
    const paginas = await hojas({ report: informe, analysis: analisis(backtest(["A", "B"]), 90) });
    const cartera = `${seccion(paginas, "composicion")} ${seccion(paginas, "reparto")}`;
    expect(cartera).toContain("Bono viejo");
    expect(cartera).toContain("Fuera del catálogo · XS0000000000");
    expect(cartera).toContain("10,0 %");
    /* Fuera del catálogo no hay ficha: su rentabilidad por dividendo y su divisa faltan, y lo dice. */
    expect(cartera.match(/Falta el dato/g)).toHaveLength(2);
    /* La parte medida, bajo la curva y al pie de la guía (A-143). */
    expect(seccion(paginas, "evolucion")).toContain("Mide el 90,0 %");
    expect(seccion(paginas, "guia")).toContain("Cifras calculadas sobre el 90,0 % de la cartera.");
    /* El reparto va ahora en la hoja de la composición: el mismo texto, en % de toda la cartera. */
    expect(cartera).toContain("Fuera del reparto: Bono viejo, 10,0 % de la cartera.");
    /* Renta variable sobre toda la cartera, a mano: 100 % de lo que entra × 90 %. */
    expect(cartera).toContain("90,0 %");
    expect(cartera).toMatch(/Fuera del reparto\s*10,0 %/);
  }, 20_000);

  test("una cartera en la que entra todo no lleva ni la fila ni la frase", async () => {
    const paginas = await hojas({ analysis: analisis(backtest()) });
    expect(`${seccion(paginas, "composicion")} ${seccion(paginas, "reparto")}`).not.toContain("Fuera del reparto");
    expect(seccion(paginas, "cifras")).not.toContain("Fuera del reparto");
  }, 20_000);
});

describe("decisión 83: el informe de cliente con una sola acción", () => {
  const unaAccion = { ...report([{ asset_id: "A", weight_percent: 100 }]) };
  unaAccion.positions = unaAccion.positions.map((p) => ({ ...p, instrument_type: "STOCK" as const }));

  test("sin frontera, «Acciones» en su categoría, «La única posición» y una guía sin lo que no sale", async () => {
    const paginas = await hojas({ report: unaAccion, analysis: analisis(backtest(["A"]), 100) });
    const todo = paginas.join(" ");
    /* La frontera ya no está en el informe de cliente (10-11-2026); y «no hay suficientes datos comunes» diría que falta algo. */
    expect(todo).not.toMatch(/[Ff]rontera/);
    expect(todo).not.toContain("No hay suficientes datos comunes");
    expect(seccion(paginas, "reparto")).toMatch(/Acciones\s*100,0 %/);
    /* El solapamiento no aplica a una acción, y lo dice en su frase. */
    expect(todo).toContain("La única posición es una acción, que no tiene subyacentes: el solapamiento no aplica.");
    expect(todo).toContain("La única posición");
    expect(todo).not.toContain("Las 1 mayores");
    const guia = seccion(paginas, "guia");
    expect(guia).not.toContain("Frontera eciente");
    expect(guia).not.toContain("Solapamiento");
  }, 20_000);
});

describe("decisión 89: el tipo sin riesgo de respaldo se dice solo si ocurre", () => {
  const FRASE = "Sharpe con un tipo jo de respaldo (2,00 %): no se pudo leer el €STR del periodo.";

  test("con el €STR leído no sale", async () => {
    expect((await hojas({ analysis: analisis(backtest()) })).join(" ")).not.toContain("respaldo");
  }, 20_000);

  test("con la política de respaldo, bajo la tira de la hoja 3, con la cifra del dato", async () => {
    const paginas = await hojas({ analysis: analisis(backtest(["A", "B"], [COVID, TIPOS], 158, "3Y", "STATIC_FALLBACK")) });
    expect(seccion(paginas, "cifras")).toContain(FRASE);
  }, 20_000);

  test("con el aviso solo, también", async () => {
    const conAviso = { ...backtest(), warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"] } as BacktestResponse;
    expect(seccion(await hojas({ analysis: analisis(conAviso) }), "cifras")).toContain(FRASE);
  }, 20_000);

  test("la guía también lo dice, con el aviso solo", async () => {
    const conAviso = { ...backtest(), warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"] } as BacktestResponse;
    expect(seccion(await hojas({ analysis: analisis(conAviso) }), "guia")).toContain("de respaldo, porque no se ha podido leer el tipo a un día");
  }, 20_000);

  test("sin cifra de la cartera no hay de qué avisar bajo la tira", async () => {
    const respaldo = backtest(["A", "B"], [COVID, TIPOS], 158, "3Y", "STATIC_FALLBACK");
    expect(seccion(await hojas({ analysis: analisis(respaldo, 40) }), "cifras")).not.toContain("respaldo");
  }, 20_000);
});

describe("decisión B-78: una posición cuyos datos se quedaron en una fecha", () => {
  test("lo dice en su línea de la composición, sin jerga y sin una hoja más; sin ninguna, nada", async () => {
    const sin = await hojas({ analysis: analisis(backtest()) });
    const con = await hojas({ analysis: analisis(backtest()), seriesParadas: new Map([["B", "2025-11-28"]]) });
    expect(con).toHaveLength(sin.length);
    const composicion = `${seccion(con, "composicion")} ${seccion(con, "reparto")}`;
    expect(composicion).toContain("Activo B Renta variable · B · Sus datos llegan hasta el 28/11/2025.");
    expect(composicion.match(/Sus datos llegan hasta/g)).toHaveLength(1);
    expect(con.join(" ")).not.toMatch(/serie parada/i);
    expect(sin.join(" ")).not.toContain("Sus datos llegan hasta");
  }, 60_000);
});
