import { describe, expect, test } from "vitest";
import {
  IMPROVEMENT_RESULT_STORAGE_KEY, clearImprovementResult, improvementFingerprint, loadImprovementResult, saveImprovementResult
} from "../src/core/improvementResultStore";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    map
  };
}

const response = { schema_version: "portfolio-improvement.v1", status: "NO_IMPROVEMENT", proposals: [], rejected_candidates: {}, excluded_assets: [], evaluated_combinations: 0, warnings: [] } as ImprovementResponse;
const positions = [{ asset_id: "B", weight_percent: 40 }, { asset_id: "A", weight_percent: 60 }, { asset_id: "Z", weight_percent: 0 }];

describe("resultado de «Mejorar cartera» en la sesión", () => {
  test("la huella ignora el orden y las posiciones a cero", () => {
    expect(improvementFingerprint(positions)).toBe("A:60.0000|B:40.0000");
    expect(improvementFingerprint([{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }])).toBe(improvementFingerprint(positions));
  });

  test("se recupera solo para la misma composición y se borra", () => {
    const store = memory();
    const saved = saveImprovementResult(positions, { response, proposalIndex: 1, assets: { A: { name: "Fondo A", ongoingCharge: 0.01 } }, equivalence: {}, skipped: [], savedAt: "2026-10-13T18:00:00Z" }, store);
    expect(saved?.fingerprint).toBe("A:60.0000|B:40.0000");
    expect(store.map.has(IMPROVEMENT_RESULT_STORAGE_KEY)).toBe(true);
    const loaded = loadImprovementResult(positions, store);
    expect(loaded?.proposalIndex).toBe(1);
    expect(loaded?.assets.A.name).toBe("Fondo A");
    expect(loaded?.savedAt).toBe("2026-10-13T18:00:00Z");
    expect(loadImprovementResult([{ asset_id: "A", weight_percent: 61 }, { asset_id: "B", weight_percent: 39 }], store)).toBeNull();
    clearImprovementResult(store);
    expect(loadImprovementResult(positions, store)).toBeNull();
  });

  test("sin almacenamiento o con basura no rompe", () => {
    expect(saveImprovementResult(positions, { response, proposalIndex: 0, assets: {}, equivalence: {}, skipped: [] }, null)).not.toBeNull();
    expect(loadImprovementResult(positions, null)).toBeNull();
    const store = memory();
    store.setItem(IMPROVEMENT_RESULT_STORAGE_KEY, "{no es json");
    expect(loadImprovementResult(positions, store)).toBeNull();
    store.setItem(IMPROVEMENT_RESULT_STORAGE_KEY, JSON.stringify({ schema_version: "otro" }));
    expect(loadImprovementResult(positions, store)).toBeNull();
  });
});
