import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppError, appErrorTitle, limiteDelCalculo, toAppError } from "../src/core/appError";
import { AsyncErrorBanner } from "../src/components/AsyncErrorBanner";
import { HorizonFrontier } from "../src/components/PortfolioHorizonPanel";
import { parsePortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { avisoDelTopeDeLaEstimada, leerLaTira, TOPE_DE_LA_FRONTERA } from "../src/core/medidaDeLaCartera";
import { computeFrontier } from "../src/core/frontier";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/* Solo para el panel entero, al final: lo demás de este fichero no pasa por el gancho ni por la frontera por composición.
   El gancho de la estimada devuelve lo que se le diga sin mirar qué activos recibe, y apunta cuántos le llegan: el de
   verdad conserva el resultado anterior mientras espera, y la regla de los 40 tiene que aguantar también eso. */
const horizonte = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as string | undefined, estimada: null as unknown, pedidos: [] as number[] }));
vi.mock("../src/core/usePortfolioHorizon", () => ({ usePortfolioHorizon: () => ({ window: "3Y", data: horizonte.data, error: horizonte.error, retry: () => undefined }) }));
vi.mock("../src/core/useApproximateFrontier", () => ({
  useApproximateFrontier: (activos: readonly unknown[]) => {
    horizonte.pedidos.push(activos.length);
    /* `inputs` solo lo lee el panel de antes de repartir pesos, y solo para escribir la nota de la frecuencia. */
    return { result: horizonte.estimada, inputs: { frontierAssets: [], frequency: { compatible: true, note: "" } } };
  }
}));
vi.mock("../src/adapters/optimizePortfolioBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/optimizePortfolioBackend")>()),
  isRealFrontierEnabled: () => true
}));
import { FrontierPanel } from "../src/components/FrontierPanel";

/* 10-11-2026: el tope de la simulación sube de 40 a 85 posiciones, y donde un tope se sigue superando la pantalla dice
   el límite y cuántas tiene la cartera, sin ofrecer reintentar. El texto del servidor sale de `_cap_list` (main.py). */
const DEL_SERVIDOR = Object.assign(new Error("Maximo 85 posiciones por peticion; llegan 120."), { code: "functions/invalid-argument" });
const FRASE = "El cálculo admite 85 posiciones como máximo y esta cartera tiene 120. No es un fallo pasajero: reintentar no lo cambia.";

describe("un tope del servidor se traduce una vez, con el límite y cuántas hay", () => {
  test("el error del SDK llega con la frase, el título y sin «dato no válido»", () => {
    const error = toAppError(DEL_SERVIDOR);
    expect(error.message).toBe(FRASE);
    expect(error.limite).toBe(true);
    expect(appErrorTitle(error)).toBe("Por encima del límite del cálculo");
    expect(error.detail).toBe(DEL_SERVIDOR.message);
  });

  test("sobrevive a pasar por texto, como lo guarda usePortfolioHorizon", () => {
    const comoTexto = toAppError(DEL_SERVIDOR).message;
    expect(limiteDelCalculo(comoTexto)).toBe(FRASE);
    expect(toAppError(comoTexto).limite).toBe(true);
  });

  test("con el texto del SDK y su « [400]» del final, y con un AppError que solo lo lleva en el detalle", () => {
    expect(limiteDelCalculo({ code: DEL_SERVIDOR.code, message: `${DEL_SERVIDOR.message} [400]` })).toBe(FRASE);
    const viejo = new AppError("BACKEND", "La petición contiene un dato no válido.", { detail: DEL_SERVIDOR.message });
    expect(limiteDelCalculo(viejo)).toBe(FRASE);
  });

  test("los activos de get_price_series no se cuentan como una cartera", () => {
    expect(limiteDelCalculo({ code: "functions/invalid-argument", message: "Maximo 40 activos por peticion; llegan 47." }))
      .toBe("El cálculo admite 40 activos como máximo y se han pedido 47. No es un fallo pasajero: reintentar no lo cambia.");
  });

  test("otro invalid-argument sigue siendo lo de siempre", () => {
    const error = toAppError({ code: "functions/invalid-argument", message: "Posición o peso inválido." });
    expect(error.message).toBe("La petición contiene un dato no válido.");
    expect(error.limite).toBeUndefined();
    expect(limiteDelCalculo(error)).toBeNull();
    expect(limiteDelCalculo(null)).toBeNull();
  });

  test("el banner no ofrece reintentar un tope, y sí un fallo", () => {
    const conTope = renderToStaticMarkup(createElement(AsyncErrorBanner, { error: FRASE, onRetry: () => undefined }));
    expect(conTope).toContain("El cálculo admite 85 posiciones como máximo y esta cartera tiene 120.");
    expect(conTope).toContain("Por encima del límite del cálculo");
    expect(conTope).not.toContain("Reintentar");
    const fallo = renderToStaticMarkup(createElement(AsyncErrorBanner, { error: { code: "functions/internal", message: "x" }, onRetry: () => undefined }));
    expect(fallo).toContain("Reintentar");
  });

  test("Análisis dice el límite donde iría la cifra de la cartera", () => {
    const tira = leerLaTira({ horizonte: null, fuera: [], midiendo: false, medicionFallida: false, sinSerie: false, limite: FRASE, hayPeso: true, anos: 3 });
    expect(tira).toEqual(expect.objectContaining({ estado: "falta", motivo: FRASE }));
  });
});

function respuesta(extra: Record<string, unknown> = {}) {
  const first = Date.UTC(2023, 8, 1);
  const portfolio_series = Array.from({ length: 3 * 52 + 2 }, (_, i) => ({ date: new Date(first + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 * Math.exp(.002 * i + .015 * Math.sin(i)) }));
  const backtest = { schema_version: "backtest.v1", base_currency: "EUR", window: "3Y", units: "decimal", frequency: "WEEKLY", metrics_frequency: "WEEKLY", max_drawdown_frequency: "WEEKLY",
    metrics: { cagr: .1, volatility: .1, sharpe: 1, max_drawdown: -.1, rf_rate: .02 }, portfolio_series,
    asset_ids: ["A", "B"], weights_normalized: { A: .6, B: .4 }, correlation_matrix: [[1, .5], [.5, 1]], benchmark_series: {}, synthetics: [],
    coverage: { requested_assets: 2, included_assets: 2, common_observations: portfolio_series.length, first_date: portfolio_series[0].date, last_date: portfolio_series.at(-1)!.date }, excluded_assets: [], warnings: [] };
  return { schema_version: "portfolio-horizon.v1", window: "3Y", horizon_years: 3, reference_version: "test", backtest, equal_weight: backtest, max_sharpe: null, frontier: null,
    frontier_unavailable_reason: "La frontera con series históricas se calcula con 40 activos como máximo y esta cartera tiene 47 medidos.",
    coverage_weight_percent: 100, extensions: [], methodology: "m", ...extra };
}

const aportacion = { risk_contributions: [{ asset_id: "A", weight_pct: 60, risk_pct: 70 }, { asset_id: "B", weight_pct: 40, risk_pct: 30 }],
  risk_contributions_meta: { cov_model: "OAS" } };

describe("sin frontera, la aportación al riesgo llega aparte", () => {

  test("se lee con el mismo contrato que dentro de la frontera", () => {
    const h = parsePortfolioHorizon(respuesta(aportacion), "3Y");
    expect(h.frontier).toBeNull();
    expect(h.riskContributions?.map((r) => r.risk_pct)).toEqual([70, 30]);
    expect(h.riskContributionsMeta).toEqual({ cov_model: "OAS", reason: undefined });
    expect(h.frontierUnavailableReason).toContain("40 activos como máximo");
  });

  test("sin aportación aparte no se inventa ninguna", () => {
    const h = parsePortfolioHorizon(respuesta(), "3Y");
    expect(h.riskContributions).toBeUndefined();
    expect("riskContributions" in h).toBe(false);
  });

  test("una aportación que no suma 100 o de un activo ajeno se rechaza", () => {
    expect(() => parsePortfolioHorizon(respuesta({ ...aportacion, risk_contributions: [{ asset_id: "A", weight_pct: 100, risk_pct: 90 }] }), "3Y")).toThrow(/suma 100/);
    expect(() => parsePortfolioHorizon(respuesta({ ...aportacion, risk_contributions: [{ asset_id: "Z", weight_pct: 60, risk_pct: 70 }, { asset_id: "B", weight_pct: 40, risk_pct: 30 }] }), "3Y")).toThrow(/ajena/);
  });
});

/* Cómo empieza en el HTML la nota que pinta la pieza `Aviso` (MAR-21) dentro de su caja de nota: sin título, el lector
   oye delante «Nota.». */
const NOTA_EN_PANTALLA = '<div role="note"><div class="aviso aviso--nota"><div class="aviso__texto"><span class="sr-only">Nota. </span>';

/* 10-11-2026, visto en producción con 47 medidos: el motivo era un párrafo suelto a todo el ancho, debajo seguía la nota
   de una frontera que no se dibujaba, y decía que la aportación al riesgo sí salía sin decir dónde. */
describe("sin frontera que dibujar, Simular lo dice como aviso", () => {
  const NOTA_DE_LA_FRONTERA = "La frontera estima riesgo y rentabilidad con regularización";
  const pinta = (extra: Record<string, unknown>, props: { onVerAnalisis?: () => void } = {}) =>
    renderToStaticMarkup(createElement(HorizonFrontier, { analysis: parsePortfolioHorizon(respuesta(extra), "3Y"), approximate: null, ...props }));

  test("el motivo va en la pieza de aviso, bajo su título, y sin la nota de una frontera que no hay", () => {
    const html = pinta(aportacion);
    expect(html).toContain("Frontera eficiente · 3 años</h3>");
    expect(html).toContain(`${NOTA_EN_PANTALLA}La frontera con series históricas se calcula con 40 activos como máximo`);
    expect(html).not.toContain(NOTA_DE_LA_FRONTERA);
    expect(html).not.toContain("<p");
  });

  test("con la aportación medida y un camino a Análisis, lo ofrece", () => {
    const html = pinta(aportacion, { onVerAnalisis: () => undefined });
    expect(html).toContain('<div class="aviso__accion">');
    expect(html).toContain("Ver la aportación en Análisis</button>");
  });

  test("sin aportación que enseñar, o sin camino porque ya se está en Análisis, no promete nada", () => {
    expect(pinta({}, { onVerAnalisis: () => undefined })).not.toContain("<button");
    expect(pinta(aportacion)).not.toContain("<button");
  });
});

/* El mismo aviso sale en el bloque «Frontera eficiente», que montan Diseño y Análisis con la misma pieza. Diseño tiene
   adónde ir; Análisis ya enseña la aportación en su tabla, y un botón que lleva a donde se está sobra.
   14-11-2026: la frontera volvió a Análisis (Diversificación) como bloque propio, «Frontera eficiente», sin las cuatro
   cifras, que ya están en la respuesta de arriba. Hasta ese día esta pieza se titulaba «Rentabilidad y riesgo» y la
   prueba pedía ese título; lo que comprueba —que el aviso lleva el botón solo si hay adónde ir— no cambia. */
describe("el aviso en «Frontera eficiente»: con botón donde hay camino a Análisis, sin él en Análisis", () => {
  const POSICIONES = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
  const pintaElPanel = (props: { onVerAnalisis?: () => void } = {}) => {
    horizonte.data = parsePortfolioHorizon(respuesta(aportacion), "3Y");
    return renderToStaticMarkup(createElement(FrontierPanel, { assets: [], positions: POSICIONES, compact: true, ...props }));
  };

  test("con el camino a Análisis, el aviso lleva el botón", () => {
    const html = pintaElPanel({ onVerAnalisis: () => undefined });
    expect(html).toContain("Frontera eficiente</h2>");
    expect(html).toContain(`${NOTA_EN_PANTALLA}La frontera con series históricas`);
    expect(html).toContain("Ver la aportación en Análisis</button>");
  });

  test("Análisis no lo pasa: el aviso sale, y sin botón", () => {
    const html = pintaElPanel();
    expect(html).toContain(`${NOTA_EN_PANTALLA}La frontera con series históricas`);
    expect(html).not.toContain("<button");
  });
});

/* A-129 (10-11-2026), visto en producción con 60 acciones sin guardar: en vez del aviso salía la frontera estimada por
   composición, con el eje de rentabilidad hasta el 135 %, y por encima de 85 Componer repetía el mensaje del límite como
   pie de ese gráfico. Con más de 40 posiciones ya no se dibuja: ni con la simulación hecha, ni como adelanto mientras se
   calcula, ni como respaldo de un error. Hasta 40 no cambia nada. */
describe("con más de 40 posiciones no se dibuja la frontera estimada por composición (A-129)", () => {
  const ESTIMADA = computeFrontier([
    { id: "A", name: "A", expectedReturn: 0.08, volatility: 0.15, assetClass: "EQUITY" },
    { id: "B", name: "B", expectedReturn: 0.03, volatility: 0.05, assetClass: "FIXED_INCOME" }
  ]);
  const DEL_LIMITE = "El cálculo admite 85 posiciones como máximo y esta cartera tiene 89. No es un fallo pasajero: reintentar no lo cambia.";
  const posiciones = (n: number) => Array.from({ length: n }, (_, i) => ({ asset_id: `P${i}`, weight_percent: 100 / n }));
  const activos = (n: number) => Array.from({ length: n }, (_, i) => ({ asset_id: `P${i}` })) as unknown as BdbAssetDetail[];
  const pintaCon = (n: number, estado: { data?: unknown; error?: string } = {}, assets: BdbAssetDetail[] = []) => {
    Object.assign(horizonte, { data: estado.data, error: estado.error, estimada: ESTIMADA, pedidos: [] });
    return renderToStaticMarkup(createElement(FrontierPanel, { assets, positions: posiciones(n), compact: true, onVerAnalisis: () => undefined }));
  };
  afterEach(() => { Object.assign(horizonte, { data: undefined, error: undefined, estimada: null, pedidos: [] }); });

  test("la estimada de la prueba existe: sin ella, lo demás no probaría nada", () => {
    expect(ESTIMADA).not.toBeNull();
  });

  test("con 41 y la simulación hecha: el aviso con su botón, y ningún gráfico estimado", () => {
    const html = pintaCon(TOPE_DE_LA_FRONTERA + 1, { data: parsePortfolioHorizon(respuesta(aportacion), "3Y") });
    expect(html).toContain(`${NOTA_EN_PANTALLA}La frontera con series históricas`);
    expect(html).toContain("Ver la aportación en Análisis</button>");
    expect(html).not.toContain("estimada por composición");
  });

  test("el cuerpo del panel separa sus bloques con la pila, y sin nada que decir no deja una caja vacía (A-135)", () => {
    const html = pintaCon(TOPE_DE_LA_FRONTERA + 1, { data: parsePortfolioHorizon(respuesta(aportacion), "3Y") });
    expect(html).toContain('<div class="panel__body stack stack--tight">');
    expect(html).not.toContain('<div class="panel__subtitle"></div>');
  });

  test("con 41 y calculando: el estado, sin un gráfico que luego se quita", () => {
    const html = pintaCon(TOPE_DE_LA_FRONTERA + 1);
    expect(html).toContain("Calculando el periodo completo…");
    expect(html).not.toContain("estimada por composición");
  });

  test("con 89, por encima del límite del cálculo: el mensaje una sola vez y nada debajo", () => {
    const html = pintaCon(89, { error: DEL_LIMITE });
    expect(html.split(DEL_LIMITE)).toHaveLength(2);
    expect(html).not.toContain("estimada por composición");
  });

  test("ni se calcula: con 41 al gancho no le llega ningún activo, y con 40 le llegan los 40", () => {
    pintaCon(TOPE_DE_LA_FRONTERA + 1, {}, activos(TOPE_DE_LA_FRONTERA + 1));
    expect(horizonte.pedidos).toEqual([0]);
    pintaCon(TOPE_DE_LA_FRONTERA, {}, activos(TOPE_DE_LA_FRONTERA));
    expect(horizonte.pedidos).toEqual([TOPE_DE_LA_FRONTERA]);
  });

  test("hasta 40 sigue como estaba: se dibuja con la simulación hecha, calculando y con un error", () => {
    expect(pintaCon(TOPE_DE_LA_FRONTERA, { data: parsePortfolioHorizon(respuesta(), "3Y") })).toContain("Frontera eficiente · 3 años · estimada por composición</h3>");
    expect(pintaCon(TOPE_DE_LA_FRONTERA)).toContain("Frontera eficiente · estimada por composición</h3>");
    expect(pintaCon(TOPE_DE_LA_FRONTERA, { error: "Sin conexión con el servidor." })).toContain("Frontera eficiente · estimada por composición</h3>");
  });

  test("el 40 de la pantalla es el del servidor", () => {
    const servidor = readFileSync(new URL("../functions_python/portfolio_horizon.py", import.meta.url), "utf8");
    expect(servidor).toMatch(new RegExp(`^MAX_ACTIVOS_FRONTERA = ${TOPE_DE_LA_FRONTERA}(?![0-9])`, "m"));
  });
});

/* A-130 (10-11-2026): mientras ninguna posición tiene peso, Diseño no usa el panel de la simulación sino el de antes,
   que dibujaba la estimada sin tope de activos. Lleva la misma regla, con otro texto: sin pesos no hay simulación ni
   aportación al riesgo a la que llevar. Ese panel sale también con pesos cuando el estado de la histórica viene de fuera. */
describe("antes de repartir pesos, con más de 40 posiciones tampoco se dibuja la estimada (A-130)", () => {
  const ESTIMADA = computeFrontier([
    { id: "A", name: "A", expectedReturn: 0.08, volatility: 0.15, assetClass: "EQUITY" },
    { id: "B", name: "B", expectedReturn: 0.03, volatility: 0.05, assetClass: "FIXED_INCOME" }
  ]);
  const AVISO_41 = "La frontera estimada se dibuja con 40 posiciones como máximo y esta cartera tiene 41.";
  const REPARTE = "Reparte los pesos para ver las cifras de la cartera.";
  const activos = (n: number) => Array.from({ length: n }, (_, i) => ({ asset_id: `P${i}`, display_name: `P${i}` })) as unknown as BdbAssetDetail[];
  const pintaSinPesos = (n: number, props: Record<string, unknown> = {}) => {
    Object.assign(horizonte, { data: undefined, error: undefined, estimada: ESTIMADA, pedidos: [] });
    const positions = Array.from({ length: n }, (_, i) => ({ asset_id: `P${i}`, weight_percent: 0 }));
    return renderToStaticMarkup(createElement(FrontierPanel, { assets: activos(n), positions, compact: true, ...props }));
  };
  afterEach(() => { Object.assign(horizonte, { data: undefined, error: undefined, estimada: null, pedidos: [] }); });

  test("la frase: el tope, cuántas tiene y, solo sin pesos, qué hacer", () => {
    expect(avisoDelTopeDeLaEstimada(60, false)).toBe("La frontera estimada se dibuja con 40 posiciones como máximo y esta cartera tiene 60. Reparte los pesos para ver las cifras de la cartera.");
    expect(avisoDelTopeDeLaEstimada(60, true)).toBe("La frontera estimada se dibuja con 40 posiciones como máximo y esta cartera tiene 60.");
  });

  test("en Diseño con 41 sin peso: el aviso, sin gráfico, sin botón y sin el estado de la histórica", () => {
    const html = pintaSinPesos(TOPE_DE_LA_FRONTERA + 1, { onVerAnalisis: () => undefined });
    expect(html).toContain("Frontera eficiente</h2>");
    expect(html).toContain(`${NOTA_EN_PANTALLA}${AVISO_41} ${REPARTE}</div></div></div>`);
    expect(html).not.toContain("estimada por composición");
    expect(html).not.toContain("grafico-de-frontera");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Se necesitan al menos dos activos");
    expect(html).not.toContain("Histórica no disponible");
  });

  test("ni se calcula: con 41 al gancho no le llega ningún activo, y con 40 le llegan los 40", () => {
    pintaSinPesos(TOPE_DE_LA_FRONTERA + 1);
    expect(horizonte.pedidos).toEqual([0]);
    pintaSinPesos(TOPE_DE_LA_FRONTERA);
    expect(horizonte.pedidos).toEqual([TOPE_DE_LA_FRONTERA]);
  });

  test("hasta 40 sigue como estaba: la estimada se dibuja, y sin aviso", () => {
    const html = pintaSinPesos(TOPE_DE_LA_FRONTERA);
    expect(html).toContain("frontera estimada por composición");
    expect(html).toContain("grafico-de-frontera");
    expect(html).not.toContain("posiciones como máximo");
  });

  test("en Análisis con 41 sin peso: el aviso en lugar de la nota de «necesitas al menos 2 activos»", () => {
    const html = pintaSinPesos(TOPE_DE_LA_FRONTERA + 1, { compact: false });
    expect(html).toContain("Frontera eficiente (aproximada)</h2>");
    expect(html).toContain(`${AVISO_41} ${REPARTE}`);
    expect(html).not.toContain("Necesitas al menos 2 activos");
    expect(html).not.toContain("grafico-de-frontera");
  });

  test("con pesos y el estado de la histórica dado desde fuera: el tope, y sin mandar a repartir lo ya repartido", () => {
    Object.assign(horizonte, { estimada: ESTIMADA, pedidos: [] });
    const n = TOPE_DE_LA_FRONTERA + 1;
    const positions = Array.from({ length: n }, (_, i) => ({ asset_id: `P${i}`, weight_percent: 100 / n }));
    const html = renderToStaticMarkup(createElement(FrontierPanel, { assets: activos(n), positions, compact: true, historical: { status: "error", message: "Sin conexión con el servidor." } }));
    expect(html).toContain(`${NOTA_EN_PANTALLA}${AVISO_41}</div>`);
    expect(html).not.toContain(REPARTE);
    expect(html).not.toContain("estimada por composición");
  });
});

describe("ANA-31 · la caída desde máximos sale de un solo sitio", () => {
  test("el panel de la simulación usa la función común y no la recalcula a mano en cada pintado", () => {
    const fuente = readFileSync(new URL("../src/components/PortfolioHorizonPanel.tsx", import.meta.url), "utf8");
    expect(fuente).toContain("calculateUnderwaterSeries(");
    expect(fuente).toContain("useMemo(");
    /* Lo que había: un máximo acumulado a mano dentro del cuerpo del componente. */
    expect(fuente).not.toContain("Math.max(peak");
  });
});
