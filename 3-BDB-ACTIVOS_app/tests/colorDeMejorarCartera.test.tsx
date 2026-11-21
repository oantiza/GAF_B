// @vitest-environment happy-dom
/**
 * «Mejorar cartera» (Diseño → Optimizar): la diferencia entre la cartera actual y la propuesta vuelve a ir en verde si mejora y en rojo si
 * empeora, según el sentido de cada cifra, y las comprobaciones dicen «Cumple» en verde y «No cumple» en rojo (14-11-2026, Óscar: recuperar el
 * color de antes del rediseño). El montaje y la respuesta de prueba son los de `portfolioImprovementPanel.test.tsx`; las diferencias, a mano:
 * rentabilidad 5 − 4 = +1,00 pp (mejora); volatilidad 11,9 − 12 = −0,10 pp (mejora); Sharpe 0,03 / 0,119 − 0,02 / 0,12 = +0,09 (mejora); caída
 * −9 − (−10) = +1,00 pp, menos profunda (mejora); coste 0,88 − 1,3 = −0,42 pp (mejora); en selección 6 − 5 = +1,00 pp (mejora). Y en la tabla
 * de sustituciones, el coste de A2 frente a A, 0,8 − 1,5 = −0,70 pp (mejora).
 */
import { act, createElement } from "react";
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


const tonoDe = (celda: Element | null | undefined) => {
  const cifra = celda?.querySelector(".cifra");
  return cifra?.classList.contains("cifra--sube") ? "verde" : cifra?.classList.contains("cifra--baja") ? "rojo" : "tinta";
};
const diferencias = (tabla: string) =>
  [...document.querySelectorAll<HTMLTableRowElement>(`table[aria-label="${tabla}"] tbody tr`)].map((fila) => [
    fila.firstElementChild?.textContent ?? "",
    (fila.lastElementChild?.textContent ?? "").replace(/\u00a0/g, " "),
    tonoDe(fila.lastElementChild)
  ]);

describe("«Mejorar cartera»: mejora y empeora, en verde y rojo (G9)", () => {
  test("cada diferencia, en el color de su sentido, con el signo escrito de siempre", async () => {
    await mount();
    await click("Buscar sustituciones");
    expect(diferencias("Comparativa en la ventana de confirmación")).toEqual([
      ["Rentabilidad anualizada", "+1,00 pp", "verde"],
      ["Volatilidad anual", "−0,10 pp", "verde"],
      ["Sharpe", "+0,09", "verde"],
      ["Caída máxima", "+1,00 pp", "verde"],
      ["Coste corriente medio", "−0,42 pp", "verde"],
      ["Rentabilidad anualizada (selección)", "+1,00 pp", "verde"]
    ]);
    const sustitucion = document.querySelector('table[aria-label="Sustituciones propuestas"] tbody tr');
    expect((sustitucion?.lastElementChild?.textContent ?? "").replace(/\u00a0/g, " ")).toBe("−0,70 pp");
    expect(tonoDe(sustitucion?.lastElementChild)).toBe("verde");
    expect(document.body.textContent).toContain("En verde, lo que mejora; en rojo, lo que empeora.");
  });

  test("lo que empeora, en rojo: más volatilidad, más coste y una caída más profunda", async () => {
    const peor = structuredClone(proposalResponse);
    peor.proposals[0].metrics.confirmation = metrics(0.03, 0.13, -0.12);
    peor.proposals[0].weighted_cost = 0.016;
    await mount(peor);
    await click("Buscar sustituciones");
    expect(diferencias("Comparativa en la ventana de confirmación").slice(0, 5)).toEqual([
      ["Rentabilidad anualizada", "−1,00 pp", "rojo"],
      ["Volatilidad anual", "+1,00 pp", "rojo"],
      ["Sharpe", "−0,09", "rojo"],
      ["Caída máxima", "−2,00 pp", "rojo"],
      ["Coste corriente medio", "+0,30 pp", "rojo"]
    ]);
  });

  test("las comprobaciones: «Cumple» en verde, «No cumple» en rojo, «No evaluable» neutro, cada una con su palabra", async () => {
    const conFallo = structuredClone(proposalResponse);
    conFallo.proposals[0].validation = [
      ...proposalResponse.proposals[0].validation,
      { key: "drawdown", label: "Caída máxima", status: "FAIL", detail: "empeora 2,00 pp" }
    ];
    await mount(conFallo);
    await click("Buscar sustituciones");
    const marcas = [...document.querySelectorAll(".improvement-checks .distintivo")].map((marca) => [marca.textContent, marca.className]);
    expect(marcas).toEqual([
      ["Cumple", "distintivo distintivo--favorable"],
      ["No evaluable", "distintivo distintivo--neutro"],
      ["No cumple", "distintivo distintivo--desfavorable"]
    ]);
  });
});
