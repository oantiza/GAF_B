import { describe, expect, it } from "vitest";
import { effectiveCommercialRetroPct } from "../src/core/commercialRetroEffective";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";

describe("Retrocesión pendiente de confirmar", () => {
  const record: CommercialRetroRecord = { isin: "LU1088703118", retro_pct: 0, as_of_date: "2026-09-27", source: "FILE_IMPORT" };
  it("excluye un cero de origen desconocido sin confundirlo con cero confirmado", () => {
    expect(effectiveCommercialRetroPct(record.isin, new Map([[record.isin, { ...record, status: "PENDING_CONFIRMATION" }]]))).toBeNull();
    expect(effectiveCommercialRetroPct(record.isin, new Map([[record.isin, { ...record, status: "CONFIRMED" }]]))).toBe(0);
  });
});
