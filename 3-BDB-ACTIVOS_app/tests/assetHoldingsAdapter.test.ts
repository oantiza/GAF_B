import { describe, expect, test } from "vitest";
import { mapAssetHoldingsPayload } from "../src/adapters/assetHoldingsAdapter";

describe("asset holdings adapter", () => {
  test("keeps negative futures used as portfolio hedges", () => {
    const result = mapAssetHoldingsPayload("BE0943877671", {
      asset_id: "BE0943877671",
      storage_mode: "SINGLE_DOCUMENT",
      holdings_count: 3,
      top10_weight: -8.16,
      holdings: [
        {
          holding_id: "france-bond",
          holding_name: "France 3.2%",
          holding_weight: 8.23,
          holding_weight_unit: "percent"
        },
        {
          holding_id: "buxl-future",
          holding_name: "Euro Buxl Future",
          holding_weight: -3.39,
          holding_weight_unit: "percent"
        },
        {
          holding_id: "schatz-future",
          holding_name: "Euro Schatz Future",
          holding_weight: -13,
          holding_weight_unit: "percent"
        }
      ]
    });

    expect(result).not.toBeNull();
    expect(result?.holdings).toHaveLength(3);
    expect(result?.holdings.map((holding) => holding.weight_pct)).toEqual([8.23, -3.39, -13]);
    expect(result?.holdings_count).toBe(3);
    expect(result?.holdings.reduce((sum, holding) => sum + holding.weight_pct, 0)).toBeCloseTo(-8.16, 8);
  });

  test("uses holding_weight_unit when the provider sends decimal weights", () => {
    const result = mapAssetHoldingsPayload("FUND-A", {
      holdings: [
        {
          holding_name: "Decimal holding",
          holding_weight: 0.125,
          holding_weight_unit: "decimal"
        },
        {
          holding_name: "Small percent holding",
          holding_weight: 0.5,
          holding_weight_unit: "percent"
        }
      ]
    });

    expect(result?.holdings.map((holding) => holding.weight_pct)).toEqual([12.5, 0.5]);
  });

  test("drops zero rows and reports the normalized count", () => {
    const result = mapAssetHoldingsPayload("FUND-A", {
      holdings_count: 3,
      holdings: [
        { holding_name: "Positive", holding_weight: 2, holding_weight_unit: "percent" },
        { holding_name: "Negative", holding_weight: -1, holding_weight_unit: "percent" },
        { holding_name: "Zero", holding_weight: 0, holding_weight_unit: "percent" }
      ]
    });

    expect(result?.holdings).toHaveLength(2);
    expect(result?.holdings_count).toBe(2);
  });

  test("rejects malformed rows instead of returning partial holdings", () => {
    expect(() => mapAssetHoldingsPayload("FUND-A", {
      holdings: [
        { holding_name: "Valid", holding_weight: 2, holding_weight_unit: "percent" },
        { holding_name: "Missing weight" }
      ]
    })).toThrow(/holdings\[1\]\.weight/);
  });

  test("rejects malformed containers and mismatched asset ids", () => {
    expect(() => mapAssetHoldingsPayload("FUND-A", { holdings: "not-an-array" })).toThrow(/holdings/);
    expect(() => mapAssetHoldingsPayload("FUND-A", {
      asset_id: "FUND-B",
      holdings: [{ holding_name: "Holding", holding_weight: 2 }]
    })).toThrow(/se solicitó FUND-A y se recibió FUND-B/);
  });

  test("accepts the successor's holdings when the backend declares the alias", () => {
    // ES0141116030 (Hamco FI) se fusionó en LU3038481936: el backend devuelve la cartera
    // del sucesor y lo declara con resolved_from; la fila conserva el id pedido.
    const result = mapAssetHoldingsPayload("ES0141116030", {
      asset_id: "LU3038481936",
      resolved_from: "ES0141116030",
      holdings: [{ holding_name: "Holding", holding_weight: 2 }]
    });
    expect(result?.asset_id).toBe("ES0141116030");
    expect(result?.resolved_to).toBe("LU3038481936");
    expect(result?.holdings).toHaveLength(1);

    const viaRequested = mapAssetHoldingsPayload("ES0141116030", {
      asset_id: "LU3038481936",
      requested_asset_id: "ES0141116030",
      holdings: [{ holding_name: "Holding", holding_weight: 2 }]
    });
    expect(viaRequested?.resolved_to).toBe("LU3038481936");

    const direct = mapAssetHoldingsPayload("LU3038481936", {
      asset_id: "LU3038481936",
      holdings: [{ holding_name: "Holding", holding_weight: 2 }]
    });
    expect(direct?.resolved_to).toBeUndefined();
  });

  test("still rejects a different id when the declared request is another one", () => {
    expect(() => mapAssetHoldingsPayload("FUND-A", {
      asset_id: "FUND-B",
      resolved_from: "FUND-C",
      holdings: [{ holding_name: "Holding", holding_weight: 2 }]
    })).toThrow(/se solicitó FUND-A y se recibió FUND-B/);
  });
});
