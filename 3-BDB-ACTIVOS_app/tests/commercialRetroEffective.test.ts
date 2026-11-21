import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_RETRO_SOURCE_LABEL,
  effectiveCommercialRetroPct,
  resolveEffectiveCommercialRetro
} from "../src/core/commercialRetroEffective";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";

function record(retro_pct: number): CommercialRetroRecord {
  return {
    isin: "IE00B4L5Y983",
    retro_pct,
    as_of_date: "2026-07-05",
    source: "ADMIN_UI"
  };
}

describe("commercial retro effective source", () => {
  test("resuelve commercial_retro como fuente efectiva única para la app", () => {
    const records = new Map([["fund-a", record(0.45)]]);

    const retro = resolveEffectiveCommercialRetro("fund-a", records);
    expect(retro).toMatchObject({
      pct: 0.45,
      source: "commercial_retro",
      sourceLabel: COMMERCIAL_RETRO_SOURCE_LABEL
    });
    expect(retro?.rate).toBeCloseTo(0.0045, 8);
    expect(effectiveCommercialRetroPct("fund-a", records)).toBe(0.45);
  });

  test("ignora registros inexistentes o fuera de rango", () => {
    expect(resolveEffectiveCommercialRetro("missing", new Map())).toBeNull();
    expect(resolveEffectiveCommercialRetro("fund-a", new Map([["fund-a", record(101)]]))).toBeNull();
  });
});
