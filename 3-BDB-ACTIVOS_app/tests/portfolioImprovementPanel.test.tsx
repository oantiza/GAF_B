// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import type { ImprovementCandidateSet } from "../src/core/portfolioImprovement";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const backend = vi.hoisted(() => ({ fetchPortfolioImprovement: vi.fn() }));
vi.mock("../src/adapters/improvePortfolioBackend", () => backend);
const pdfModule = vi.hoisted(() => ({ downloadImprovementProposalPdf: vi.fn<(input: unknown) => Promise<void>>(async () => {}) }));
vi.mock("../src/reports/improvementProposalPdf", () => pdfModule);

import { PortfolioImprovementPanel } from "../src/components/PortfolioImprovementPanel";
import { IMPROVEMENT_RESULT_STORAGE_KEY, loadImprovementResult } from "../src/core/improvementResultStore";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../src/core/textosDeCartera";

function asset(id: string, name: string, ter: number): BdbAssetDetail {
  return {
    asset_id: id, display_name: name, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, description: "",
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }, costs: { ongoing_charge: ter }
  } as BdbAssetDetail;
}

const positions: BdbManualPortfolioPosition[] = [{ asset_id: "A", weight_percent: 60, label: "Fondo A" }, { asset_id: "B", weight_percent: 40, label: "Fondo B" }];
const assets = [asset("A", "Fondo A", 0.015), asset("B", "Fondo B", 0.010)];
const metrics = (cagr: number, vol: number, mdd: number) => ({ cagr, volatility: vol, sharpe: (cagr - 0.02) / vol, max_drawdown: mdd, cumulative_return: cagr, weeks: 52 });

const candidateSet: ImprovementCandidateSet = {
  candidates: { A: ["A2"] },
  sameFundClass: {},
  assetsById: new Map([["A", assets[0]], ["B", assets[1]], ["A2", asset("A2", "Fondo A2", 0.008)]]),
  equivalence: new Map([["A:A2", { verdict: "EQUIVALENT", score: 0.9, evaluated: 8, total: 8, shared: [], differing: [], missing: [], reason: "Misma categoría y exposiciones coincidentes.", criteria: [], sameFamily: false }]]),
  skipped: [{ asset_id: "B", reason: "Sin fondos de la misma categoría o región en el catálogo." }]
};

const proposalResponse: ImprovementResponse = {
  schema_version: "portfolio-improvement.v1", status: "PROPOSAL", window: "3Y",
  original: { weights: { A: 0.6, B: 0.4 }, metrics: { selection: metrics(0.05, 0.12, -0.15), confirmation: metrics(0.04, 0.12, -0.10), full: metrics(0.05, 0.12, -0.15) }, weighted_cost: 0.013 },
  windows: { frequency: "WEEKLY", full: { first_date: "2023-10-02", last_date: "2026-10-05", weeks: 156 }, selection: { first_date: "2023-10-02", last_date: "2025-10-06", weeks: 104 }, confirmation: { first_date: "2025-10-06", last_date: "2026-10-05", weeks: 52 } },
  proposals: [{
    substitutions: [{ from_asset_id: "A", to_asset_id: "A2", from_name: "Fondo A", to_name: "Fondo A2", weight: 0.6, correlation: 0.97, tracking_error: 0.02 }],
    weights: { A2: 0.6, B: 0.4 },
    metrics: { selection: metrics(0.06, 0.12, -0.14), confirmation: metrics(0.05, 0.119, -0.09), full: metrics(0.06, 0.12, -0.14) },
    deltas_confirmation: { cagr: 0.01, volatility: -0.001, sharpe: 0.08, max_drawdown: 0.01 },
    weighted_cost: 0.0088,
    validation: [{ key: "cost", label: "Coste corriente ponderado", status: "PASS", detail: "−0,42 pp" }, { key: "group_currency", label: "Exposición por divisa", status: "NOT_EVALUABLE", detail: "sin etiqueta en algún fondo" }],
    improvements: [{ key: "cagr", label: "Rentabilidad anualizada", delta: 0.01 }],
    consistency: { windows: 26, wins: 20, share: 0.77, rolling_weeks: 52 },
    valid: true
  }],
  rejected_candidates: { A: [{ asset_id: "A3", reason: "LOW_CORRELATION", detail: "Correlación 0,40, mínimo 0,85." }] },
  excluded_assets: [], evaluated_combinations: 1, search: "EXHAUSTIVE", warnings: [],
  risk_free: { risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" }
};

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  backend.fetchPortfolioImprovement.mockReset();
});

async function mount(response: ImprovementResponse = proposalResponse) {
  backend.fetchPortfolioImprovement.mockResolvedValue(response);
  const onBuildCandidates = vi.fn(async () => candidateSet);
  const onApplyProposal = vi.fn();
  const onSaveProposal = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(PortfolioImprovementPanel, {
    assets, positions, lockedWeights: { B: 0.4 }, portfolioName: "Cliente X", onBuildCandidates, onApplyProposal, onSaveProposal
  })));
  return { onBuildCandidates, onApplyProposal, onSaveProposal };
}

function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
const click = async (text: string) => act(async () => button(text).click());

describe("panel «Mejorar cartera»", () => {
  test("calcula con candados, pesos normalizados y umbrales; enseña la propuesta, la validación y los descartes", async () => {
    const { onBuildCandidates, onApplyProposal, onSaveProposal } = await mount();
    expect(document.body.textContent).toContain("Fondos equivalentes que mejoran la cartera");
    await click("Buscar sustituciones");
    expect(onBuildCandidates).toHaveBeenCalledWith(positions, assets, { requireSameDistribution: true });
    const request = backend.fetchPortfolioImprovement.mock.calls[0][0];
    expect(request.positions).toEqual([{ asset_id: "A", weight: 0.6 }, { asset_id: "B", weight: 0.4 }]);
    expect(request.candidates).toEqual({ A: ["A2"] });
    expect(request.same_fund_class).toEqual({});
    expect(request.locked).toEqual(["B"]);
    expect(request.max_substitutions).toBe(3);
    expect(request.thresholds).toEqual({ max_volatility_increase: 0.003, max_drawdown_worsening: 0.01, min_return_improvement: 0.005 });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Propuesta que cumple las condiciones");
    expect(text).toContain("Fondo A2");
    expect(text).toContain("Equivalente");
    expect(text).toContain("Cumple");
    expect(text).toContain("No evaluable");
    expect(text).toContain("Se comporta distinto al original");
    expect(text).toContain("Sin fondos de la misma categoría");
    expect(text).toContain("confirmación 06/10/2025 a 05/10/2026 (52 semanas)");
    expect(text).not.toMatch(/retro/i);

    await click("Guardar como propuesta");
    expect(onSaveProposal).toHaveBeenCalledWith("Cliente X · propuesta de mejora",
      [{ asset_id: "A2", weight_percent: 60, label: "Fondo A2", keepEuros: undefined, targetEuros: undefined }, { asset_id: "B", weight_percent: 40, label: "Fondo B" }],
      expect.arrayContaining([expect.objectContaining({ asset_id: "A2" })]));

    await click("Revisar y aplicar");
    expect(document.body.textContent).toContain("La cartera original no se ha modificado.");
    expect(document.body.textContent).toContain("Entra");
    expect(button("Aplicar sustituciones").closest("footer")?.textContent).toContain(SIN_COMISIONES_NI_IMPUESTOS);
    await click("Aplicar sustituciones");
    expect(onApplyProposal).toHaveBeenCalledWith([
      { asset_id: "A2", weight_percent: 60, label: "Fondo A2", keepEuros: undefined, targetEuros: undefined },
      { asset_id: "B", weight_percent: 40, label: "Fondo B" }
    ]);
    expect(document.body.textContent).toContain("Sustituciones aplicadas en Diseño de cartera");
  });

  /*
   * Revisión final (V3-8, y lote T10 para la pantalla): la diferencia de dos porcentajes se escribe en puntos, «+1,00 pp», como la validación de esta misma
   * pantalla y el papel de la Propuesta de mejora. «+1,00 %» se lee como una variación relativa del 1 %. Calculadas a mano con la respuesta de prueba:
   * rentabilidad 5 − 4, volatilidad 11,9 − 12, caída −9 − (−10), coste ponderado 0,88 − 1,3, en selección 6 − 5, y el coste corriente de A2 frente a A,
   * 0,8 − 1,5. El Sharpe no es un porcentaje y sigue sin unidad: 0,03 / 0,119 − 0,02 / 0,12 = 0,0854.
   */
  test("las diferencias de dos porcentajes, en puntos, como la validación y el papel; el Sharpe, sin unidad", async () => {
    await mount();
    await click("Buscar sustituciones");
    const celdasDe = (tabla: string, rotulo: string) =>
      [...[...document.querySelectorAll<HTMLTableRowElement>(`table[aria-label="${tabla}"] tbody tr`)]
        .find((tr) => tr.querySelector("th")?.textContent === rotulo)?.children ?? []].map((celda) => celda.textContent);
    const confirmacion = (rotulo: string) => celdasDe("Comparativa en la ventana de confirmación", rotulo);
    expect(confirmacion("Rentabilidad anualizada")).toEqual(["Rentabilidad anualizada", "+4,00\u00a0%", "+5,00\u00a0%", "+1,00\u00a0pp"]);
    expect(confirmacion("Volatilidad anual")).toEqual(["Volatilidad anual", "12,00\u00a0%", "11,90\u00a0%", "−0,10\u00a0pp"]);
    expect(confirmacion("Sharpe")).toEqual(["Sharpe", "0,17", "0,25", "+0,09"]);
    expect(confirmacion("Caída máxima")).toEqual(["Caída máxima", "−10,00\u00a0%", "−9,00\u00a0%", "+1,00\u00a0pp"]);
    /* «Medio», no «ponderado»: una media por peso se llama media en toda la aplicación. */
    expect(confirmacion("Coste corriente medio")).toEqual(["Coste corriente medio", "1,30\u00a0%", "0,88\u00a0%", "−0,42\u00a0pp"]);
    expect(confirmacion("Rentabilidad anualizada (selección)")).toEqual(["Rentabilidad anualizada (selección)", "+5,00\u00a0%", "+6,00\u00a0%", "+1,00\u00a0pp"]);
    const sustitucion = [...document.querySelectorAll<HTMLTableRowElement>('table[aria-label="Sustituciones propuestas"] tbody tr')][0];
    expect(sustitucion?.lastElementChild?.textContent).toBe("−0,70\u00a0pp");
    /* La validación, que llega del servidor, ya lo decía en puntos (con espacio duro, de `cifrasEnPantalla`): ahora la tabla de arriba dice lo mismo. */
    /* El servidor sigue escribiendo «ponderado» en el rótulo de su comprobación; el glosario lo dice como la pantalla. */
    expect(document.body.textContent).not.toContain("ponderado");
    expect(document.body.textContent).toContain("Coste corriente medio · −0,42\u00a0pp");
  });

  test("con una acción en la cartera, la nota del coste lo dice; sin acciones, no (decisiones 10 y 77)", async () => {
    await mount();
    await click("Buscar sustituciones");
    expect(document.body.textContent).not.toContain("custodia ni corretaje");
    await act(async () => root?.unmount());
    document.body.innerHTML = "";

    backend.fetchPortfolioImprovement.mockResolvedValue(proposalResponse);
    const conAccion = [assets[0], { ...assets[1], instrument_type: "STOCK", costs: undefined } as unknown as BdbAssetDetail];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(PortfolioImprovementPanel, {
      assets: conAccion, positions, lockedWeights: { B: 0.4 }, portfolioName: "Cliente X", onBuildCandidates: vi.fn(async () => candidateSet), onApplyProposal: vi.fn(), onSaveProposal: vi.fn()
    })));
    await click("Buscar sustituciones");
    expect(document.body.textContent).toContain("Las acciones no tienen coste corriente y cuentan como cero. No incluye custodia ni corretaje.");
  });

  test("exporta la propuesta a PDF con fichas, equivalencia y posiciones sin alternativa", async () => {
    await mount();
    await click("Buscar sustituciones");
    await click("Descargar la propuesta");
    expect(pdfModule.downloadImprovementProposalPdf).toHaveBeenCalledTimes(1);
    const payload = pdfModule.downloadImprovementProposalPdf.mock.calls[0][0] as unknown as {
      portfolioName: string; proposalIndex: number; assets: Record<string, { name: string; ongoingCharge: number | null }>;
      equivalence: Record<string, { verdict: string }>; skipped: { asset_id: string }[];
    };
    expect(payload.portfolioName).toBe("Cliente X");
    expect(payload.proposalIndex).toBe(0);
    expect(payload.assets.A2).toEqual({ name: "Fondo A2", ongoingCharge: 0.008 });
    expect(payload.equivalence["A:A2"].verdict).toBe("EQUIVALENT");
    expect(payload.skipped).toEqual([{ asset_id: "B", reason: "Sin fondos de la misma categoría o región en el catálogo." }]);
  });

  test("sin mejora: dice el motivo y no ofrece aplicar", async () => {
    await mount({
      ...proposalResponse, status: "NO_IMPROVEMENT", proposals: [], reason: "La mejor combinación en selección no supera la confirmación: Sharpe (confirmación).",
      best_rejected: { substitutions: proposalResponse.proposals[0].substitutions, failed: ["Sharpe (confirmación)"] }
    });
    await click("Buscar sustituciones");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Sin mejora entre las alternativas evaluadas");
    expect(text).toContain("Fondo A → Fondo A2");
    expect([...document.querySelectorAll("button")].some((item) => item.textContent === "Revisar y aplicar")).toBe(false);
  });

  test("el error del servidor se enseña con reintento", async () => {
    backend.fetchPortfolioImprovement.mockRejectedValueOnce(new Error("Demasiadas solicitudes."));
    await mount();
    await click("Buscar sustituciones");
    expect(document.body.textContent).toContain("Demasiadas solicitudes.");
    expect([...document.querySelectorAll("button")].some((item) => /reintentar/i.test(item.textContent ?? ""))).toBe(true);
  });

  /* 15-11-2026: «Mejorar» mide con el periodo de Simular, y la pantalla dice cuál, qué se quedó fuera y qué se recortó. */
  test("enseña el periodo medido, la posición apartada, el recorte, el €STR de cada tramo y el candidato no evaluable", async () => {
    await mount({
      ...proposalResponse,
      windows: {
        frequency: "WEEKLY",
        full: { first_date: "2023-11-03", last_date: "2026-11-06", weeks: 157, days: 1099 },
        selection: { first_date: "2023-11-03", last_date: "2025-11-07", weeks: 105, days: 735 },
        confirmation: { first_date: "2025-11-07", last_date: "2026-11-06", weeks: 52, days: 364 }
      },
      rejected_candidates: { A: [{ asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY", detail: "Su serie empieza el 08/10/2025 y la ventana el 03/11/2023.", not_evaluable: true }] },
      excluded_assets: [{ asset_id: "B", reason: "INSUFFICIENT_HISTORY" }, { asset_id: "JOVEN", reason: "INSUFFICIENT_HISTORY" }],
      excluded_positions: [{ asset_id: "B", reason: "INSUFFICIENT_HISTORY", weight: 0.4 }],
      extensions: [],
      coverage_weight_percent: 60,
      candidates_per_position: { requested: 5, evaluated: 3, trimmed: true, max_assets: 80 },
      risk_free_by_window: {
        selection: { risk_free_rate: 0.0306, risk_free_rate_policy: "WINDOW_AVERAGE" },
        confirmation: { risk_free_rate: 0.0207, risk_free_rate_policy: "WINDOW_AVERAGE" },
        full: { risk_free_rate: 0.0273, risk_free_rate_policy: "WINDOW_AVERAGE" }
      }
    });
    await click("Buscar sustituciones");
    /* Las cifras llevan un espacio duro antes del «%»: aquí se comparan las palabras. */
    const text = (document.body.textContent ?? "").replace(/\s/g, " ");
    expect(text).toContain("Medido del 03/11/2023 al 06/11/2026, el mismo periodo que la simulación a 3 años.");
    expect(text).toContain("Fuera de la medición, como en la simulación: Fondo B (40,0 %), histórico insuficiente para la ventana. Se mide el resto, el 60,0 % del peso, y para esa posición no se buscan sustitutos.");
    expect(text).toContain("se han evaluado los 3 primeros candidatos de cada posición, de los 5 que podía tener");
    expect(text).toContain("€STR medio de cada tramo: selección 3,06 %, confirmación 2,07 %, ventana completa 2,73 %");
    expect(text).toContain("no evaluable · Histórico insuficiente para la ventana · Su serie empieza el 08/10/2025");
    // Ni la posición apartada ni el candidato se repiten como «excluidos» al pie: cada uno ya tiene su sitio.
    const descartes = document.querySelector(".improvement-rejected")?.textContent ?? "";
    expect(descartes.match(/JOVEN/g)?.length ?? 0).toBe(1);
    expect(descartes).not.toContain("Fondo B: Histórico insuficiente");
  });

  test("un tramo de menos de 330 días es un estado, con la frase del servidor", async () => {
    await mount({
      schema_version: "portfolio-improvement.v1", status: "WINDOW_TOO_SHORT", window: "3Y", proposals: [], rejected_candidates: {}, excluded_assets: [],
      excluded_positions: [], evaluated_combinations: 0, warnings: [], min_days: 330,
      short_windows: [{ window: "confirmation", first_date: "2026-07-17", last_date: "2026-11-06", days: 112 }],
      reason: "El tramo de confirmación tiene 112 días, del 17/07/2026 al 06/11/2026, y con menos de 330 no se anualiza: no se calcula una propuesta."
    });
    await click("Buscar sustituciones");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Tramo demasiado corto para anualizar");
    expect(text).toContain("El tramo de confirmación tiene 112 días");
    expect([...document.querySelectorAll("button")].some((item) => item.textContent === "Revisar y aplicar")).toBe(false);
  });
});

/**
 * ALTA-20.3 (auditoría 14-10-2026): tras «Aplicar sustituciones» el resultado
 * seguía montado y el efecto de guardado lo reescribía en la sesión bajo la
 * huella de la cartera NUEVA, así que el informe interno de esa cartera
 * enseñaba una propuesta calculada para otra.
 */
describe("panel «Mejorar cartera» · resultado guardado en la sesión", () => {
  const appliedPositions = [
    { asset_id: "A2", weight_percent: 60, label: "Fondo A2", keepEuros: undefined, targetEuros: undefined },
    { asset_id: "B", weight_percent: 40, label: "Fondo B" }
  ];

  const applied = vi.fn();
  const savedProposals = vi.fn();

  function StatefulPanel({ onPositions }: { onPositions?: (setter: (next: BdbManualPortfolioPosition[]) => void) => void }) {
    const [current, setCurrent] = useState(positions);
    onPositions?.(setCurrent);
    return createElement(PortfolioImprovementPanel, {
      assets, positions: current, lockedWeights: { B: 0.4 }, portfolioName: "Cliente X",
      onBuildCandidates: async () => candidateSet,
      onApplyProposal: (next: BdbManualPortfolioPosition[]) => { applied(next); setCurrent(next); },
      onSaveProposal: savedProposals
    });
  }

  async function mountStateful(onPositions?: (setter: (next: BdbManualPortfolioPosition[]) => void) => void) {
    backend.fetchPortfolioImprovement.mockResolvedValue(proposalResponse);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(StatefulPanel, { onPositions })));
  }

  test("calcular guarda el resultado bajo la cartera evaluada", async () => {
    sessionStorage.clear();
    await mountStateful();
    await click("Buscar sustituciones");
    expect(loadImprovementResult(positions)?.proposalIndex).toBe(0);
  });

  test("aplicar las sustituciones retira el resultado: no queda bajo la cartera nueva ni bajo la vieja", async () => {
    sessionStorage.clear();
    await mountStateful();
    await click("Buscar sustituciones");
    await click("Revisar y aplicar");
    await click("Aplicar sustituciones");

    expect(document.body.textContent).toContain("Sustituciones aplicadas en Diseño de cartera");
    expect(loadImprovementResult(appliedPositions)).toBeNull();
    expect(loadImprovementResult(positions)).toBeNull();
    expect(sessionStorage.getItem(IMPROVEMENT_RESULT_STORAGE_KEY)).toBeNull();
    // La propuesta, calculada para la cartera anterior, deja de ofrecerse.
    expect([...document.querySelectorAll("button")].some((item) => item.textContent === "Revisar y aplicar")).toBe(false);
  });

  test("si la cartera cambia por otra vía, el resultado sigue ligado a la composición evaluada", async () => {
    sessionStorage.clear();
    let setPositions: ((next: BdbManualPortfolioPosition[]) => void) | undefined;
    await mountStateful((setter) => { setPositions = setter; });
    await click("Buscar sustituciones");
    const reweighted = [{ asset_id: "A", weight_percent: 50, label: "Fondo A" }, { asset_id: "B", weight_percent: 50, label: "Fondo B" }];
    await act(async () => setPositions?.(reweighted));

    expect(loadImprovementResult(reweighted)).toBeNull();
    expect(loadImprovementResult(positions)).not.toBeNull();
  });

  /* Revisión del 14-10-2026: con la cartera cambiada después de calcular, la
     propuesta es de otra composición y no se puede aplicar ni guardar. */
  test("si la cartera cambia tras calcular, no se ofrece aplicar ni guardar y se pide recalcular", async () => {
    sessionStorage.clear();
    applied.mockReset();
    savedProposals.mockReset();
    let setPositions: ((next: BdbManualPortfolioPosition[]) => void) | undefined;
    await mountStateful((setter) => { setPositions = setter; });
    await click("Buscar sustituciones");
    expect(button("Revisar y aplicar").disabled).toBe(false);

    await act(async () => setPositions?.([
      { asset_id: "A", weight_percent: 50, label: "Fondo A" },
      { asset_id: "B", weight_percent: 50, label: "Fondo B" }
    ]));

    expect(document.body.textContent).toContain("La cartera ha cambiado desde el cálculo");
    expect(button("Revisar y aplicar").disabled).toBe(true);
    expect(button("Guardar como propuesta").disabled).toBe(true);
    // El PDF sigue disponible: describe la cartera que se evaluó.
    expect(button("Descargar la propuesta").disabled).toBe(false);

    // Al recalcular con la cartera actual vuelve a poder aplicarse.
    await click("Buscar sustituciones");
    expect(button("Revisar y aplicar").disabled).toBe(false);
  });

  test("con el diálogo de revisión abierto, un cambio de cartera desactiva «Aplicar sustituciones»", async () => {
    sessionStorage.clear();
    applied.mockReset();
    let setPositions: ((next: BdbManualPortfolioPosition[]) => void) | undefined;
    await mountStateful((setter) => { setPositions = setter; });
    await click("Buscar sustituciones");
    await click("Revisar y aplicar");

    await act(async () => setPositions?.([
      { asset_id: "A", weight_percent: 70, label: "Fondo A" },
      { asset_id: "B", weight_percent: 30, label: "Fondo B" }
    ]));

    expect(button("Aplicar sustituciones").disabled).toBe(true);
    await click("Aplicar sustituciones");
    expect(applied).not.toHaveBeenCalled();
  });
});
