import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppError } from "../src/core/appError";

const mocks = vi.hoisted(() => ({
  callBackend: vi.fn()
}));

vi.mock("../src/adapters/callableBackend", () => ({
  callBackend: mocks.callBackend
}));

import { getSystemStatus, parseSystemStatusResponse } from "../src/adapters/systemStatusBackend";

function payload() {
  return {
    integrity: {
      checked_at: "2026-07-12T08:00:00Z",
      status: "WARN",
      problems: [{ severity: "WARN", check: "backup_freshness", detail: "marcador antiguo", sample: ["backup-1"] }],
      counts: { assets_total: 753, future_count: 2 },
      freshness: { price_refresh: "OK", metrics_refresh: "OK", backup: "WARN", future_check: "OK" },
      applied: true,
      future_nested: { enabled: true, values: [1, "dos", null] }
    },
    backup: {
      completed_at: "2026-07-11T07:00:00Z",
      verification: "PASS",
      firestore_records: 812,
      auth_users: 5,
      backup_dir: "backups/2026-07-11",
      future_backup_field: { chunks: 4 }
    },
    prices: {
      last_run: "2026-07-12T06:00:00Z",
      read_budget_max: 5000,
      read_budget_used: 431,
      symbols: ["SAN.MC", "IBE.MC"]
    },
    metrics: {
      last_run: "2026-07-12T06:30:00Z",
      last_price_series_last_date: null,
      scan_after_asset_id: "LU0123456789",
      cycle_completed: false,
      scanned_assets: 120,
      processed_assets: 118,
      written: 75,
      read_budget_max: 5000,
      read_budget_used: 4800,
      stopped_by_budget: true,
      continuation: { next: "LU0999999999" }
    }
  };
}

describe("system status backend contract", () => {
  beforeEach(() => {
    mocks.callBackend.mockReset();
  });

  test("accepts partial documents and preserves unknown JSON fields safely", () => {
    const raw = payload();
    raw.integrity = JSON.parse(JSON.stringify(raw.integrity).replace(
      /}$/, ',"__proto__":{"polluted":true}}'
    )) as typeof raw.integrity;

    const result = parseSystemStatusResponse(raw);

    expect(result.integrity?.status).toBe("WARN");
    expect(result.integrity?.future_nested).toEqual({ enabled: true, values: [1, "dos", null] });
    expect(result.integrity?.["__proto__"]).toEqual({ polluted: true });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(result.backup?.future_backup_field).toEqual({ chunks: 4 });
    expect(result.prices?.symbols).toEqual(["SAN.MC", "IBE.MC"]);
    expect(result.metrics?.continuation).toEqual({ next: "LU0999999999" });
  });

  test("keeps missing Firestore documents as explicit nulls", () => {
    expect(parseSystemStatusResponse({ integrity: null, backup: null, prices: null, metrics: null })).toEqual({
      integrity: null,
      backup: null,
      prices: null,
      metrics: null
    });

    const partial = parseSystemStatusResponse({
      integrity: {},
      backup: null,
      prices: { last_run_date: "2026-07-12" },
      metrics: { cycle_completed: false, scan_after_asset_id: null }
    });
    expect(partial.integrity).toEqual({});
    expect(partial.backup).toBeNull();
    expect(partial.prices).toEqual({ last_run_date: "2026-07-12" });
  });

  test("rejects missing documents, invalid known fields and non-JSON shapes", () => {
    expect(() => parseSystemStatusResponse({ integrity: null, backup: null, prices: null })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), integrity: [] })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), prices: { read_budget_used: "431" } })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), integrity: { problems: "WARN" } })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), integrity: { status: "UNKNOWN" } })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), integrity: { counts: { assets_total: -1 } } })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({
      ...payload(),
      integrity: { freshness: { price_refresh: "STALE" } }
    })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({
      ...payload(),
      integrity: { problems: [{ severity: "ERROR" }] }
    })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), backup: { completed_at: new Date() } })).toThrow(AppError);
    expect(() => parseSystemStatusResponse({ ...payload(), metrics: { future_value: Number.POSITIVE_INFINITY } })).toThrow(AppError);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => parseSystemStatusResponse({ ...payload(), metrics: cyclic })).toThrow(AppError);
  });

  test("calls the admin callable with an empty request and validates its response", async () => {
    const raw = payload();
    mocks.callBackend.mockResolvedValueOnce(raw);

    await expect(getSystemStatus()).resolves.toMatchObject({
      integrity: { status: "WARN" },
      backup: { verification: "PASS" }
    });
    expect(mocks.callBackend).toHaveBeenCalledOnce();
    expect(mocks.callBackend).toHaveBeenCalledWith(
      "get_system_status",
      {},
      "No se pudo cargar el estado del sistema."
    );
  });
});
