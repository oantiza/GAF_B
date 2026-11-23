import { describe, expect, test, vi } from "vitest";
import {
  buildImprovementCandidates, improvementLockKey, improvementSummary, preselectCandidates, proposalPositions, rejectionLabel
} from "../src/core/portfolioImprovement";
import type { ImprovementProposal, ImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import type { BdbAssetDetail, BdbAssetSearchResult } from "../src/types/bdbAssets";

function search(id: string, overrides: Partial<BdbAssetSearchResult> = {}): BdbAssetSearchResult {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [],
    metrics: { sharpe_3y: 0.5, metrics_frequency: "WEEKLY", metrics_method: "GEOMETRIC_CAGR" },
    category: "EAA Fund Global Large-Cap Blend Equity", region: "Global", ...overrides
  };
}

function detail(id: string, overrides: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    ...search(id), display_name: `${id} Acc`, description: "",
    pms_exposure: { equity: 0.98, fixed_income: 0, cash: 0.02, alternative: 0, other: 0 },
    exposure_detail: { sectors: { technology: 0.5, healthcare: 0.5 }, equity_regions: { united_states: 0.7, europe: 0.3 } },
    costs: { ongoing_charge: 0.012 },
    ...overrides
  } as BdbAssetDetail;
}

describe("preselección por etiquetas sobre el catálogo", () => {
  test("mismo vehículo y clase, categoría o región, sin los de cartera; categoría igual primero", () => {
    const original = detail("ORIG");
    const universe = [
      search("ORIG"), search("HELD"), search("ETF", { instrument_type: "ETF" }), search("BOND", { economic_asset_class: "FIXED_INCOME" }),
      search("BENCH", { role: "BENCHMARK" }), search("REGION", { category: "EAA Fund Global Flex-Cap Equity", metrics: { sharpe_3y: 2, metrics_frequency: "WEEKLY", metrics_method: "GEOMETRIC_CAGR" } }),
      search("FAR", { category: "EAA Fund Asia ex-Japan Equity", region: "Asia" }), search("CAT_LOW", { metrics: { sharpe_3y: 0.1, metrics_frequency: "WEEKLY", metrics_method: "GEOMETRIC_CAGR" } }),
      search("CAT_HIGH", { metrics: { sharpe_3y: 0.9, metrics_frequency: "WEEKLY", metrics_method: "GEOMETRIC_CAGR" } })
    ];
    expect(preselectCandidates(original, universe, ["HELD"]).map((asset) => asset.asset_id)).toEqual(["CAT_HIGH", "CAT_LOW", "REGION"]);
    expect(preselectCandidates(original, universe, ["HELD"], 2).map((asset) => asset.asset_id)).toEqual(["CAT_HIGH", "CAT_LOW"]);
  });
});

describe("conjunto de candidatos por posición", () => {
  test("pide fichas solo de los preseleccionados, ordena por equivalencia y explica las posiciones sin candidato", async () => {
    const universe = [search("A"), search("B"), search("A_EQ"), search("A_DIST"), search("A_FAR", { category: "EAA Fund Asia ex-Japan Equity", region: "Asia" }), search("STOCK", { instrument_type: "STOCK" })];
    const details: Record<string, BdbAssetDetail> = {
      A_EQ: detail("A_EQ"),
      A_DIST: detail("A_DIST", { display_name: "A_DIST Inc" }),
      A_FAR: detail("A_FAR", { category: "EAA Fund Asia ex-Japan Equity", region: "Asia" })
    };
    const loadDetails = vi.fn(async (ids: string[]) => ids.map((id) => details[id]).filter(Boolean));
    const result = await buildImprovementCandidates({
      positions: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 30 }, { asset_id: "STOCK", weight_percent: 20 }, { asset_id: "ZERO", weight_percent: 0 }],
      assets: [detail("A"), detail("B", { category: "EAA Fund Europe Large-Cap Blend Equity", region: "Europa" }), detail("STOCK", { instrument_type: "STOCK" })],
      universe, loadDetails
    });
    expect(loadDetails).toHaveBeenCalledTimes(1);
    // Empate en el criterio único: orden por nombre; la equivalencia reordena después.
    expect(loadDetails.mock.calls[0][0]).toEqual(["A_DIST", "A_EQ"]);
    expect(result.candidates).toEqual({ A: ["A_EQ", "A_DIST"] });
    expect(result.sameFundClass).toEqual({});
    expect(result.equivalence.get("A:A_EQ")?.verdict).toBe("EQUIVALENT");
    expect(result.equivalence.get("A:A_DIST")?.verdict).toBe("COMPARABLE");
    expect(result.assetsById.has("A_EQ")).toBe(true);
    expect(result.skipped).toEqual([
      { asset_id: "B", reason: "Sin fondos de la misma categoría o región en el catálogo." },
      { asset_id: "STOCK", reason: "Solo se sustituyen fondos por fondos." }
    ]);
  });

  test("otra clase del mismo fondo va al bloque aparte y encabeza los candidatos", async () => {
    const result = await buildImprovementCandidates({
      positions: [{ asset_id: "A", weight_percent: 100 }], assets: [detail("A", { display_name: "Gestora Global Equity A Acc EUR" })],
      universe: [search("A"), search("A_I"), search("A_EQ")],
      loadDetails: async () => [detail("A_I", { display_name: "Gestora Global Equity I Acc EUR" }), detail("A_EQ", { display_name: "Otra Gestora World I Acc" })]
    });
    expect(result.candidates).toEqual({ A: ["A_I", "A_EQ"] });
    expect(result.sameFundClass).toEqual({ A: ["A_I"] });
  });

  test("con requireSameDistribution desactivado, la clase de reparto entra como equivalente", async () => {
    const result = await buildImprovementCandidates({
      positions: [{ asset_id: "A", weight_percent: 100 }], assets: [detail("A")],
      universe: [search("A"), search("A_DIST")], loadDetails: async () => [detail("A_DIST", { display_name: "A_DIST Inc" })],
      equivalence: { requireSameDistribution: false }
    });
    expect(result.equivalence.get("A:A_DIST")?.verdict).toBe("EQUIVALENT");
  });
});

describe("propuesta a posiciones y textos", () => {
  const proposal = {
    substitutions: [{ from_asset_id: "A", to_asset_id: "A2", from_name: "A", to_name: "Fondo A2", weight: 0.5, correlation: 0.97, tracking_error: 0.02 }],
    improvements: [{ key: "cost", label: "Coste corriente ponderado", delta: -0.002 }]
  } as unknown as ImprovementProposal;

  test("sustituye el id y la etiqueta conservando el peso y deja los importes fijados en blanco", () => {
    const positions = [{ asset_id: "A", weight_percent: 50, keepEuros: true, targetEuros: 5000 }, { asset_id: "B", weight_percent: 50 }];
    expect(proposalPositions(positions, proposal)).toEqual([
      { asset_id: "A2", weight_percent: 50, label: "Fondo A2", keepEuros: undefined, targetEuros: undefined },
      { asset_id: "B", weight_percent: 50 }
    ]);
    expect(positions[0].asset_id).toBe("A");
  });

  test("H1-12: una posición con candado no se sustituye nunca, aunque la propuesta la nombre", () => {
    const positions = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }];
    expect(proposalPositions(positions, proposal, ["A"])).toEqual([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }]);
    expect(proposalPositions(positions, proposal, ["B"])[0].asset_id).toBe("A2");
  });

  test("H1-12: la clave de candados cambia al poner o quitar uno de una posición invertida", () => {
    const positions = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }, { asset_id: "C", weight_percent: 0 }];
    expect(improvementLockKey(positions, [])).toBe("");
    expect(improvementLockKey(positions, ["B", "A"])).toBe("A,B");
    expect(improvementLockKey(positions, ["A"])).not.toBe(improvementLockKey(positions, []));
    // Un candado sobre un id que no está invertido no cuenta.
    expect(improvementLockKey(positions, ["C", "Z"])).toBe("");
  });

  test("resumen por estado", () => {
    const base = { schema_version: "portfolio-improvement.v1", proposals: [proposal], rejected_candidates: {}, excluded_assets: [], evaluated_combinations: 1, warnings: [] };
    expect(improvementSummary({ ...base, status: "PROPOSAL" } as ImprovementResponse)).toBe("Una sustitución que no empeora ningún criterio obligatorio y mejora coste corriente ponderado.");
    expect(improvementSummary({ ...base, status: "INSUFFICIENT_DATA", missing_assets: ["B"], proposals: [] } as ImprovementResponse)).toContain("Una posición");
    expect(improvementSummary({ ...base, status: "NO_IMPROVEMENT", reason: "Motivo del servidor.", proposals: [] } as ImprovementResponse)).toBe("Motivo del servidor.");
    expect(improvementSummary({ ...base, status: "INFEASIBLE", proposals: [] } as ImprovementResponse)).toBe("Restricciones incompatibles o sin candidatos");
    expect(rejectionLabel("LOW_CORRELATION")).toMatch(/correlación/);
    expect(rejectionLabel("OTRO")).toBe("OTRO");
  });

  test("el Sharpe se escribe con mayúscula también en la frase que imprimen los papeles, como la pantalla (revisión final, V3-7)", () => {
    const dos = {
      ...proposal,
      substitutions: [proposal.substitutions[0], { ...proposal.substitutions[0], from_asset_id: "B", to_asset_id: "B2" }],
      improvements: [{ key: "sharpe", label: "Sharpe", delta: 0.11 }]
    } as unknown as ImprovementProposal;
    const base = { schema_version: "portfolio-improvement.v1", rejected_candidates: {}, excluded_assets: [], evaluated_combinations: 17, warnings: [], status: "PROPOSAL" };
    expect(improvementSummary({ ...base, proposals: [dos] } as unknown as ImprovementResponse)).toBe("2 sustituciones que no empeoran ningún criterio obligatorio y mejoran Sharpe.");
    const conLosDos = { ...dos, improvements: [{ key: "sharpe", label: "Sharpe", delta: 0.11 }, { key: "cost", label: "Coste corriente ponderado", delta: -0.0003 }] } as unknown as ImprovementProposal;
    expect(improvementSummary({ ...base, proposals: [conLosDos] } as unknown as ImprovementResponse)).toBe("2 sustituciones que no empeoran ningún criterio obligatorio y mejoran Sharpe, coste corriente ponderado.");
  });
});
