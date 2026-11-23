// @vitest-environment happy-dom

/**
 * Diseño de cartera, lo que se ve (hallazgos 144, 145 y 125; decisiones 15 y 26). El trabajo empieza arriba: con posiciones,
 * importar es un botón de la cabecera; con la cartera vacía, se queda a la vista. En Optimizar, primero lo que se viene a hacer.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { BacktestComparison } from "../src/components/BacktestComparison";
import { PortfolioStatusPanel, QueHayQueRevisar } from "../src/components/PortfolioStatusPanel";
import { OptimizationPreviewPanel } from "../src/components/OptimizationPreviewPanel";
import { PortfolioValidationPanel } from "../src/components/PortfolioValidationPanel";
import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { disenoEnSesion, olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbOptimizationPreview } from "../src/types/bdbAssets";

const horizonte = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as string | undefined }));
vi.mock("../src/core/usePortfolioHorizon", () => ({
  usePortfolioHorizon: () => ({ window: "3Y", data: horizonte.data, error: horizonte.error, retry: () => undefined })
}));
/* Lo que pintan los paneles de la simulación no es lo que se mira aquí, y arrastran el gráfico. */
vi.mock("../src/components/FrontierPanel", () => ({
  FrontierPanel: ({ onVerAnalisis }: { onVerAnalisis?: () => void }) =>
    createElement("section", { "data-panel": "frontera", "data-lleva-a-analisis": onVerAnalisis ? "sí" : "no" })
}));
vi.mock("../src/components/OptimizerPanel", () => ({
  OptimizerPanel: ({ capital }: { capital?: number }) => createElement("section", { "data-panel": "optimizador", "data-capital": String(capital) })
}));
vi.mock("../src/components/PortfolioImprovementPanel", () => ({
  PortfolioImprovementPanel: ({ capital }: { capital?: number }) => createElement("section", { "data-panel": "equivalentes", "data-capital": String(capital) })
}));

const DOS: BdbManualPortfolioPosition[] = [
  { asset_id: "LU0000000001", weight_percent: 60 },
  { asset_id: "IE0000000002", weight_percent: 40 }
];

const activo = (asset_id: string, extra: Record<string, unknown> = {}) =>
  ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, ...extra }) as unknown as BdbAssetDetail;

const elegible = (asset_id: string, weight_percent: number) => ({
  asset_id,
  display_name: `PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation ${asset_id}`,
  instrument_type: "FUND" as const,
  economic_asset_class: "EQUITY" as const,
  weight_percent,
  metrics_available: ["annualized_return_3y", "volatility_3y", "sharpe_3y", "max_drawdown_hist", "risk_score"],
  metrics_missing: ["max_drawdown_5y"],
  quality_warnings: []
});

const PREVIEW = {
  status: "PREVIEW_ONLY",
  sourceKind: "BBDD_LIVE_API",
  metrics_boundary: { mode: "PREVIEW_ONLY", source_label: "", limitations: [] },
  total_weight_percent: 100,
  validation_status: "VALID",
  eligible_assets: [elegible("LU0000000001", 60), elegible("IE0000000002", 40)],
  excluded_assets: [],
  quality_warnings: [],
  metrics_available: ["annualized_return_3y", "max_drawdown_5y", "volatility_3y"],
  metrics_missing: ["max_drawdown_5y"],
  portfolio_warnings: ["Metricas parciales (0% de la cartera).", "Mezcla de divisas sin convertir."],
  disclaimer: "Vista previa local"
} as unknown as BdbOptimizationPreview;

const SIMULACION = {
  years: 3,
  referenceVersion: "x",
  extensions: [],
  coverageWeightPercent: 60,
  backtest: {
    asset_ids: ["LU0000000001"],
    excluded_assets: [{ asset_id: "IE0000000002", reason: "QUALITY_BLOCKED" }],
    coverage: { requested_assets: 2, first_date: "2023-10-20", last_date: "2026-10-23" }
  }
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  horizonte.data = undefined;
  horizonte.error = undefined;
  olvidarTrabajoDeCartera();
  /* El paso de Diseño va en la dirección (`#paso=…`) desde el rediseño: cada prueba empieza sin él. */
  window.history.replaceState(null, "", window.location.pathname);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function pintar(nodo: Parameters<Root["render"]>[0]) {
  await act(async () => root!.render(nodo));
}

function constructor(positions: BdbManualPortfolioPosition[], extra: Record<string, unknown> = {}) {
  return createElement(PortfolioBuilder, {
    assets: positions.map((p) => activo(p.asset_id)),
    positions,
    summary: null,
    optimizationPreview: null,
    localOptimizationPreview: PREVIEW,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: null,
    portfolioNotice: null,
    onRemove: () => undefined,
    onOpenReport: () => undefined,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange: () => undefined,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    onBuildImprovementCandidates: async () => ({}) as never,
    onApplyImprovement: () => undefined,
    savedPortfolios: [],
    ...extra
  } as never);
}

const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto);
const titulos = () => [...host.querySelectorAll("h2, [data-panel]")].map((n) => n.getAttribute("data-panel") ?? n.textContent);

describe("empezar una cartera (hallazgo 144 y decisión 15)", () => {
  test("vacía, empezar es el trabajo y se queda a la vista, sin plegar y sin botón en la cabecera", async () => {
    await pintar(constructor([]));
    expect(host.textContent).toContain("Importa tus posiciones o añádelas desde el Buscador");
    expect(host.querySelector(".portfolio-start-grid")).not.toBeNull();
    expect(boton("Importar")).toBeUndefined();
    expect(boton("Mostrar")).toBeUndefined();
    expect(boton("Ocultar")).toBeUndefined();
  });

  /* Rediseño del 14-11-2026 (DIS-18): el botón se llama «Importar» y el diálogo, «Empezar o importar», porque dentro están
     las tres formas de empezar. */
  test("con posiciones, no empuja el trabajo: es un botón de la cabecera, «Importar»", async () => {
    await pintar(constructor(DOS));
    expect(host.querySelector(".portfolio-start-grid")).toBeNull();
    expect(host.textContent).not.toContain("Empieza tu propuesta");
    expect(host.querySelector(".portfolio-header-actions")?.textContent).toContain("Importar");
  });

  test("el botón abre lo mismo en un diálogo, que dice lo que va a pasar", async () => {
    await pintar(constructor(DOS));
    await act(async () => boton("Importar")!.click());
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.querySelector("h2")?.textContent).toBe("Empezar o importar");
    expect(dialogo?.querySelector(".portfolio-start-grid")).not.toBeNull();
    expect(dialogo?.textContent).toContain("sustituye a la propuesta que hay en Diseño");
    expect(dialogo?.textContent).toContain("El nombre y el capital se vacían, salvo el capital que traiga el fichero.");
    await act(async () => dialogo?.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("una importación sin confirmar no se pierde al cerrar: se dice y se puede volver a ella", async () => {
    const pendiente = { imported_positions: DOS, rejected_positions: [], warnings: [], total_weight_percent: 100, euro_confirmed: false, local_only_notice: "" };
    await pintar(constructor(DOS, { importResult: pendiente, portfolioNotice: "Importación pendiente de confirmar: 2 posiciones." }));
    expect(host.textContent).toContain("Hay una importación sin confirmar");
    /* Sin dos frases para lo mismo. */
    expect(host.textContent).not.toContain("Importación pendiente de confirmar");
    await act(async () => boton("Revisar la importación")!.click());
    expect(document.querySelector('[role="dialog"]')?.querySelector(".portfolio-import-result")).not.toBeNull();
  });

  test("la cabecera ya no lleva a otra lista de carteras (decisión 26)", async () => {
    await pintar(constructor(DOS, { savedPortfolios: [{ portfolio_id: "p", name: "Otra", positions: [], created_at: "", updated_at: "", sourceKind: "BBDD_LIVE_API" }] }));
    expect(host.textContent).not.toContain("Guardadas");
    expect(host.querySelector("#builder-saved-portfolios-panel")).toBeNull();
  });
});

describe("el paso Optimizar (hallazgo 145)", () => {
  async function optimizar(extra: Record<string, unknown> = {}) {
    disenoEnSesion.write({ ...disenoEnSesion.read(), step: "optimize", ...(extra.sesion as object) });
    await pintar(constructor(DOS, extra));
  }

  test("primero el optimizador, luego los equivalentes, y al final la comprobación previa", async () => {
    await optimizar();
    const orden = titulos();
    const de = (texto: string) => orden.findIndex((t) => t?.startsWith(texto));
    expect(de("optimizador")).toBeLessThan(de("equivalentes"));
    expect(de("equivalentes")).toBeLessThan(de("Comprobación previa: activos invertibles con peso"));
  });

  test("«Cambios aplicados» queda junto al optimizador, no debajo de los equivalentes", async () => {
    await optimizar({ sesion: { comparisonBaseline: { before: DOS, source: "MÁX. SHARPE" } } });
    const orden = titulos();
    const cambios = orden.findIndex((t) => t?.startsWith("Cambios aplicados"));
    expect(cambios).toBeGreaterThan(orden.indexOf("optimizador"));
    expect(cambios).toBeLessThan(orden.indexOf("equivalentes"));
  });

  test("el capital llega a las revisiones solo si está fijado", async () => {
    await optimizar();
    expect(host.querySelector('[data-panel="optimizador"]')?.getAttribute("data-capital")).toBe("undefined");
    await act(async () => root!.unmount());
    root = createRoot(host);
    await optimizar({ initialCapital: 250000 });
    expect(host.querySelector('[data-panel="optimizador"]')?.getAttribute("data-capital")).toBe("250000");
    expect(host.querySelector('[data-panel="equivalentes"]')?.getAttribute("data-capital")).toBe("250000");
  });
});

describe("la comprobación previa (hallazgos 145 y 125)", () => {
  const panel = (positions: BdbManualPortfolioPosition[] = DOS, assets: BdbAssetDetail[] = DOS.map((p) => activo(p.asset_id))) =>
    createElement(OptimizationPreviewPanel, { preview: PREVIEW, positions, assets });

  test("dice lo que es: ni sello, ni fuente de datos, y que no es el cálculo", async () => {
    await pintar(panel());
    expect(host.querySelector("h2")?.textContent).toBe("Comprobación previa: activos invertibles con peso");
    expect(host.querySelector(".panel__subtitle")?.textContent).toContain("No es el cálculo de la optimización");
    expect(host.textContent).not.toContain("Vista previa");
    expect(host.textContent).not.toContain("Fuente de datos");
    expect(host.textContent).not.toContain("Base maestra");
  });

  test("nombre entero y peso, y vehículo y clase en la segunda línea", async () => {
    await pintar(panel());
    const fila = host.querySelector(".comprobacion-previa__bloques li");
    expect(fila?.querySelector("span")?.textContent).toContain("(Hedged) Accumulation");
    expect(fila?.querySelector("small")?.textContent).toBe("Fondo · Renta variable");
    expect(fila?.querySelector("strong")?.textContent).toBe("60,0\u00a0%");
  });

  test("una sola lista de métricas: lo que unos tienen y otros no ya no sale en dos sitios", async () => {
    await pintar(panel());
    expect(host.textContent).toContain("Métricas por posición");
    expect(host.textContent).toContain("Caída máxima 5 años0/2");
    expect(host.textContent).not.toContain("Métricas que faltan");
    expect(host.textContent).not.toContain("Métricas disponibles");
  });

  test("el aviso de métodos solo si aplica, con tilde y sin el falso 0 %, y sin la mezcla de divisas", async () => {
    await pintar(panel());
    expect(host.textContent).toContain("Las posiciones usan métodos distintos: el riesgo de la cartera se mide en la simulación.");
    expect(host.textContent).not.toContain("0% de la cartera");
    expect(host.textContent).not.toContain("Mezcla de divisas");
  });

  test("«Mezcla de divisas» se queda solo para cifras del proveedor en otra divisa, y dice cuáles", async () => {
    await pintar(panel(DOS, [activo("LU0000000001", { currency: "USD", metrics: { metrics_method: "TRAILING_PROVIDER" } }), activo("IE0000000002")]));
    expect(host.textContent).toContain("Cifras del proveedor en otra divisa, sin convertir: Fondo LU0000000001 (USD).");
  });

  test("«Elegibles» descuenta lo que la simulación deja fuera, cuando eso llega a la pantalla", async () => {
    await pintar(panel());
    const cifra = (rotulo: string) => [...host.querySelectorAll(".ui-kpi")].find((k) => k.querySelector(".ui-kpi__label")?.textContent === rotulo)?.querySelector(".ui-kpi__value")?.textContent;
    expect(cifra("Elegibles")).toBe("2");
    expect(cifra("Excluidos")).toBe("0");
    horizonte.data = SIMULACION;
    await pintar(panel());
    expect(cifra("Elegibles")).toBe("1");
    expect(cifra("Excluidos")).toBe("1");
    expect(host.textContent).toContain("Fuera de la simulación a 3 años: bloqueado");
  });

  test("en Modo cliente se dice qué se queda fuera, y el motivo no: es diagnóstico del asesor", async () => {
    horizonte.data = SIMULACION;
    await pintar(createElement(ClientModeProvider, { initialValue: true, children: panel() }));
    expect(host.textContent).toContain("Fuera de la simulación a 3 años");
    expect(host.textContent).not.toContain("bloqueado");
    expect(host.textContent).not.toContain("Métricas por posición");
    expect(host.textContent).toContain("No es el cálculo de la optimización");
  });
});

/* Rediseño del 14-11-2026: el detalle del estado está en «Qué hay que revisar», arriba de Comprobar, y en el lateral de
   Componer queda una línea con el recuento. Lo que se afirmaba del estado se afirma ahora de ese bloque. */
describe("«Qué hay que revisar» dice la misma cobertura que la simulación (hallazgo 144)", () => {
  const SUMMARY = {
    position_count: 2,
    validation_status: "VALID",
    non_investable_assets: [],
    weighted_metrics: { volatility_comparable: false, return_coverage_3y: 1 },
    by_instrument_type: [],
    by_economic_asset_class: [],
    warnings: []
  };
  const estado = (modoCliente: boolean) =>
    createElement(ClientModeProvider, {
      initialValue: modoCliente,
      children: createElement(QueHayQueRevisar, { summary: SUMMARY as never, positions: DOS, assets: DOS.map((p) => activo(p.asset_id)), riskProfilePreview: null })
    });
  const linea = (modoCliente: boolean, onVerComprobar?: () => void) =>
    createElement(ClientModeProvider, {
      initialValue: modoCliente,
      children: createElement(PortfolioStatusPanel, { summary: SUMMARY as never, positions: DOS, assets: DOS.map((p) => activo(p.asset_id)), riskProfilePreview: null, onVerComprobar })
    });

  test("en Componer, una línea con el recuento y el enlace a Comprobar", async () => {
    horizonte.data = SIMULACION;
    const ver = vi.fn();
    await pintar(linea(false, ver));
    /* La mayor posición pesa el 60 % (concentración alta) y la simulación mide el 60 % del peso. */
    expect(host.textContent).toContain("2 cosas que revisar");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Ver lo que hay que revisar, en el paso Comprobar"]')!.click());
    expect(ver).toHaveBeenCalledTimes(1);
  });

  test("la línea tampoco sale en Modo cliente", async () => {
    horizonte.data = SIMULACION;
    await pintar(linea(true, () => undefined));
    expect(host.textContent).not.toContain("revisar");
  });

  test("con la simulación, activos y peso, y no el 100 % de las fichas", async () => {
    horizonte.data = SIMULACION;
    await pintar(estado(false));
    expect(host.textContent).toContain("1 de 2 activos · 60,0\u00a0% del peso en la simulación");
    expect(host.textContent).not.toContain("100 %");
  });

  test("mientras se mide, no adelanta un 100 % que luego baja", async () => {
    await pintar(estado(false));
    expect(host.textContent).toContain("midiendo…");
    expect(host.textContent).not.toContain("100 %");
  });

  test("si la simulación falla, lo que se sabe, y que el riesgo está sin medir", async () => {
    horizonte.error = "Fallo";
    await pintar(estado(false));
    expect(host.textContent).toContain("rentabilidad para 100,0\u00a0% de la cartera · riesgo sin medir");
  });

  test("sin cifra de cobertura no se escribe un cero ni una frase a medias: «riesgo sin medir»", async () => {
    /* Antes decía «rentabilidad para 0 % de la cartera», un cero que nadie había medido; y al pasar al formato único,
       «rentabilidad para Falta el dato de la cartera». */
    horizonte.error = "Fallo";
    const sinCobertura = { ...SUMMARY, weighted_metrics: { volatility_comparable: false } };
    await pintar(
      createElement(ClientModeProvider, {
        initialValue: false,
        children: createElement(QueHayQueRevisar, { summary: sinCobertura as never, positions: DOS, assets: DOS.map((p) => activo(p.asset_id)), riskProfilePreview: null })
      })
    );
    expect(host.textContent).toContain("invertibles · riesgo sin medir");
    expect(host.textContent).not.toContain("Falta el dato de la cartera");
    expect(host.textContent).not.toContain("rentabilidad para");
  });

  test("en Modo cliente no sale: es el semáforo de trabajo del asesor", async () => {
    horizonte.data = SIMULACION;
    await pintar(estado(true));
    expect(host.textContent).not.toContain("Qué hay que revisar");
    expect(host.textContent).not.toContain("Perfil");
  });
});

describe("Simular dice el tope que ha aplicado (hallazgo 125)", () => {
  const metricas = { cagr: 0.1, volatility: 0.08, sharpe: 1, max_drawdown: -0.1 };
  const comparativa = (weightBounds?: [number, number]) => ({
    years: 3,
    extensions: [],
    backtest: { metrics: metricas, portfolio_series: [] },
    equalWeight: { metrics: metricas, portfolio_series: [] },
    maxSharpe: { metrics: metricas, portfolio_series: [] },
    frontier: { methodologyV2: { weightBounds }, maxSharpe: { pesosCompletos: {} } }
  });
  const columnas = () => [...host.querySelectorAll(".backtest-metrics-table thead th")].map((th) => th.textContent);

  /* En la cabecera de la tabla, el «%» va pegado a su número: la cabecera parte en dos líneas si no cabe (T12). */
  test.each([
    [[0, 0.35] as [number, number], "Máx. Sharpe (máx. 35,0\u00a0% por activo)"],
    [[0, 0.2] as [number, number], "Máx. Sharpe (máx. 20,0\u00a0% por activo)"],
    [[0, 0.6] as [number, number], "Máx. Sharpe (máx. 60,0\u00a0% por activo)"],
    [undefined, "Máx. Sharpe"]
  ])("con límites %j escribe «%s»: el del dato, no uno de memoria", async (limites, rotulo) => {
    horizonte.data = comparativa(limites);
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(columnas()).toContain(rotulo);
    /* Decisión 40: es la misma cartera que en Optimizar, y lo que se dice es de qué modelo sale y con qué tope. */
    expect(host.textContent).not.toContain("No es la misma cartera");
    expect(host.textContent).not.toContain("otro cálculo");
    expect(host.textContent).toContain(`Máximo Sharpe del modelo: covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan), ${limites ? `tope del ${Math.round(limites[1] * 100)},0\u00a0% por posición` : "tope por posición no informado"}.`);
  });

  test("si medida con la serie queda por debajo de la cartera, lo dice con las dos cifras", async () => {
    horizonte.data = { ...comparativa([0, 0.35]), maxSharpe: { metrics: { ...metricas, sharpe: 0.8 }, portfolio_series: [] } };
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(host.textContent).toContain("Medida luego con la serie real puede quedar por debajo de la cartera actual: aquí, a 3 años, 0,80 frente a 1,00.");
  });

  describe("lo que hace el encogimiento, solo donde es cierto (decisión 95)", () => {
    const FRASE = "El modelo acerca lo que espera de la renta fija a lo que espera de la bolsa";
    const conClases = (clases: Record<string, string>) => ({
      data: {
        ...comparativa([0, 0.35]),
        frontier: { methodologyV2: { weightBounds: [0, 0.35] }, maxSharpe: { pesosCompletos: Object.fromEntries(Object.keys(clases).map((id) => [id, 1 / Object.keys(clases).length])) } }
      },
      assets: Object.entries(clases).map(([asset_id, economic_asset_class]) => ({ asset_id, economic_asset_class }))
    });
    const pintarCon = async (clases: Record<string, string>) => {
      const { data, assets } = conClases(clases);
      horizonte.data = data as never;
      await pintar(createElement(BacktestComparison, { positions: DOS, assets: assets as never }));
    };

    test("con renta fija y bolsa, en Máximo Sharpe, lo dice", async () => {
      await pintarCon({ A: "EQUITY", B: "EQUITY", C: "FIXED_INCOME", D: "MIXED" });
      expect(host.textContent).toContain(`${FRASE}, y por eso esta cartera suele llevar más renta fija de lo que sugiere la serie.`);
    });

    test("solo de bolsa no lo dice", async () => {
      await pintarCon({ A: "EQUITY", B: "EQUITY", C: "EQUITY", D: "EQUITY" });
      expect(host.textContent).not.toContain(FRASE);
    });
  });
});

/* 10-11-2026, visto en producción: por encima de 40 medidos no hay máximo Sharpe, y la vista abría en él para enseñar
   solo el motivo; y con la cartera por encima del tope, repetía suelto el mensaje que el panel de arriba ya da. */
describe("Vista táctica cuando no hay máximo Sharpe, o no hay simulación", () => {
  const metricas = { cagr: 0.1, volatility: 0.08, sharpe: 1, max_drawdown: -0.1 };
  const MOTIVO = "La frontera con series históricas se calcula con 40 activos como máximo y esta cartera tiene 47 medidos.";
  const sinMaximoSharpe = {
    years: 3, extensions: [], frontier: null, maxSharpe: null, frontierUnavailableReason: MOTIVO,
    backtest: { metrics: metricas, portfolio_series: [] },
    equalWeight: { metrics: metricas, portfolio_series: [] }
  };
  const pulsada = () => host.querySelector('.ui-segmented__button[aria-pressed="true"]')?.textContent;
  const columnas = () => [...host.querySelectorAll(".backtest-metrics-table thead th")].map((th) => th.textContent);

  test("abre en Equiponderada, que es lo que sí puede enseñar", async () => {
    horizonte.data = sinMaximoSharpe;
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(pulsada()).toBe("Equiponderada");
    expect(columnas()).toContain("Equiponderada");
    expect(host.textContent).not.toContain(MOTIVO);
  });

  test("con máximo Sharpe sigue abriendo en él", async () => {
    horizonte.data = { ...sinMaximoSharpe, maxSharpe: { metrics: metricas, portfolio_series: [] }, frontier: { methodologyV2: {}, maxSharpe: { pesosCompletos: {} } } };
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(pulsada()).toBe("Máx. Sharpe");
  });

  test("si el asesor pide Máx. Sharpe, el motivo sale como aviso y no como párrafo suelto", async () => {
    horizonte.data = sinMaximoSharpe;
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    await act(async () => boton("Máx. Sharpe")!.click());
    expect(pulsada()).toBe("Máx. Sharpe");
    /* Lo pinta la pieza `Aviso` (MAR-21), en tono de nota: sin título, el lector oye delante «Nota.». */
    const aviso = host.querySelector('[role="note"] .aviso--nota');
    expect(aviso?.textContent).toBe(`Nota. Sin frontera no hay cartera de máximo Sharpe con la que comparar.${MOTIVO}`);
    expect(host.querySelector(".backtest-metrics-table")).toBeNull();
  });

  test("sin simulación no repite el fallo: remite al panel de arriba, que lo cuenta una vez", async () => {
    const LIMITE = "El cálculo admite 85 posiciones como máximo y esta cartera tiene 89. No es un fallo pasajero: reintentar no lo cambia.";
    horizonte.error = LIMITE;
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(host.textContent).not.toContain("El cálculo admite");
    expect(host.textContent).toContain("Sin simulación no hay comparativa: el motivo está arriba, en «Simulación histórica y proyección».");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  test("mientras se calcula lo sigue diciendo", async () => {
    await pintar(createElement(BacktestComparison, { positions: DOS, assets: [] }));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Calculando la comparativa del periodo…");
  });
});

/* Rediseño del 14-11-2026: en Componer, «Rentabilidad y riesgo» lleva las cuatro cifras y el enlace a Análisis, que es donde se lee
   el detalle. El mismo día (Óscar: recuperar los datos de antes del rediseño) volvió encima de las cifras la frontera compacta, que es la
   de la simulación y no el panel de la frontera de Optimizar: lo que lleva se comprueba en `colorEnPropuestasYAnalisis.test.tsx`. */
describe("Componer: «Rentabilidad y riesgo» lleva a Análisis, y el panel de Optimizar no sale", () => {
  const bloque = () => [...host.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent === "Rentabilidad y riesgo");

  test("cuando Diseño lo tiene", async () => {
    await pintar(constructor(DOS, { onVerAnalisis: () => undefined }));
    expect(bloque()?.textContent).toContain("Ver el análisis");
  });

  test("y no lo inventa cuando no", async () => {
    await pintar(constructor(DOS));
    expect(bloque()).toBeDefined();
    expect(bloque()?.textContent).not.toContain("Ver el análisis");
  });

  test("el panel de la frontera de Optimizar no se monta en Componer", async () => {
    await pintar(constructor(DOS, { onVerAnalisis: () => undefined }));
    expect(host.querySelector('[data-panel="frontera"]')).toBeNull();
    expect([...host.querySelectorAll("h2")].some((t) => t.textContent?.startsWith("Frontera eficiente"))).toBe(false);
  });
});

describe("Comprobar (hallazgo 125)", () => {
  test("no publica el 0 % de métodos distintos como cobertura, ni la mezcla de divisas", async () => {
    const summary = { is_valid: true, validation_status: "VALID", non_investable_assets: [], weighted_metrics: { volatility_comparable: false }, warnings: ["Metricas parciales (0% de la cartera).", "Mezcla de divisas sin convertir."] };
    await pintar(createElement(PortfolioValidationPanel, { summary: summary as never, optimizationAssetCount: 2, positions: DOS, assets: DOS.map((p) => activo(p.asset_id)) }));
    expect(host.textContent).toContain("Las posiciones usan métodos distintos");
    expect(host.textContent).not.toContain("0% de la cartera");
    expect(host.textContent).not.toContain("Mezcla de divisas");
  });
});
