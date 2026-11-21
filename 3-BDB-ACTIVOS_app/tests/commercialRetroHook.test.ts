import { describe, expect, test } from "vitest";
import { commercialRetroRequestKey } from "../src/core/useCommercialRetroData";

describe("commercial retro request identity", () => {
  test("is stable across order changes and duplicate rows", () => {
    const first = commercialRetroRequestKey([
      { asset_id: "FUND-B", isin: "LU0000000002" },
      { asset_id: "FUND-A", isin: "LU0000000001" },
      { asset_id: "FUND-A", isin: "LU0000000001" }
    ]);
    const second = commercialRetroRequestKey([
      { asset_id: "FUND-A", isin: "LU0000000001" },
      { asset_id: "FUND-B", isin: "LU0000000002" }
    ]);

    expect(first).toBe(second);
  });

  test("changes when the commercial lookup identity changes", () => {
    expect(commercialRetroRequestKey([{ asset_id: "FUND-A", isin: "LU0000000001" }]))
      .not.toBe(commercialRetroRequestKey([{ asset_id: "FUND-A", isin: "LU0000000002" }]));
  });
});
