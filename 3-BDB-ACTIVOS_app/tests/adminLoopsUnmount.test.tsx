// @vitest-environment happy-dom

/**
 * Sistema (ALTA-12, auditoría 16-10-2026): los bucles por lotes del refresco
 * manual y de la carga de históricos se cortan al desmontar el panel (cambiar
 * de pestaña). Antes seguían pidiendo lotes sin progreso visible y, al volver,
 * se podía lanzar otro en paralelo.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const backend = vi.hoisted(() => ({
  adminIngestAsset: vi.fn(),
  fetchAdminDbStatus: vi.fn(),
  fetchAdminRefreshAllStale: vi.fn(),
  fetchAdminAssets: vi.fn(),
  fetchAdminAssetDetail: vi.fn(),
  recomputeMetric: vi.fn(),
  refreshAssetPrices: vi.fn(),
  fetchAdminBackfillCandidates: vi.fn(),
  runAdminBackfillHistory: vi.fn(),
  fetchAdminFundQuality: vi.fn()
}));
vi.mock("../src/adapters/adminBackend", () => backend);
vi.mock("../src/adapters/systemStatusBackend", () => ({ getSystemStatus: () => new Promise(() => undefined) }));
vi.mock("../src/firebase", () => ({ auth: null, firestore: null, functions: null }));

import { AdminBackfill } from "../src/components/AdminBackfill";
import { AdminPage } from "../src/pages/AdminPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let mounted = false;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(text));
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function click(element: HTMLElement) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function flush() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const DB_STATUS = {
  generated_at: "2026-10-16T08:00:00Z",
  total_assets: 30,
  by_type: { FUND: 30 },
  with_history: 30,
  without_history: 0,
  reach_2011: 20,
  not_reach_2011: 10,
  stale: 5,
  stale_days_threshold: 5,
  last_refresh_date: "2026-10-15",
  master_writes_enabled: true,
  master_writes_mode: "enabled",
  metrics_present: { vol: 30, sharpe: 30, srri: 30, mdd: 30, mdd_hist: 30 },
  start_year_histogram: { "2010": 30 },
  anomalies: { sin_historico: 0, desactualizados: 5, no_llega_2011: 10, valle_reciente: 0, total_flagged: 15 }
};

beforeEach(() => {
  vi.clearAllMocks();
  backend.fetchAdminDbStatus.mockResolvedValue(DB_STATUS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
});

describe("bucles de administración al desmontar", () => {
  test("Históricos: desmontar con un lote en vuelo no pide el siguiente", async () => {
    const candidates = Array.from({ length: 25 }, (_, i) => ({
      asset_id: `LU${String(i).padStart(10, "0")}`,
      name: `Fondo ${i}`,
      type: "FUND",
      eodhd_hint: null,
      currency_hint: null
    }));
    backend.fetchAdminBackfillCandidates.mockResolvedValue({
      generated_at: "2026-10-16T08:00:00Z",
      total_roots: 25,
      excluded: 0,
      with_series: 0,
      candidates,
      by_type: { FUND: 25 }
    });
    let resolveBatch!: (value: unknown) => void;
    backend.runAdminBackfillHistory.mockImplementation(() => new Promise((resolve) => { resolveBatch = resolve; }));

    await act(async () => {
      root.render(createElement(AdminBackfill));
    });
    await flush();
    await click(button("Previsualizar carga"));
    expect(backend.runAdminBackfillHistory).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    mounted = false;
    await act(async () => {
      resolveBatch({
        applied: false, requested: 10, processed: 10, loadable: 10, loaded: 0,
        skipped: 0, review: 0, errors: 0, results: [], ran_date: "2026-10-16"
      });
    });
    await flush();

    expect(backend.runAdminBackfillHistory).toHaveBeenCalledTimes(1);
  });

  test("BBDD maestra: cambiar de pestaña con un lote del refresco en vuelo no pide el siguiente", async () => {
    let resolveChunk!: (value: unknown) => void;
    backend.fetchAdminRefreshAllStale.mockImplementation(() => new Promise((resolve) => { resolveChunk = resolve; }));

    await act(async () => {
      root.render(createElement(AdminPage));
    });
    await click(button("BBDD maestra"));
    await flush();
    await click(button("Previsualizar actualización"));
    expect(backend.fetchAdminRefreshAllStale).toHaveBeenCalledTimes(1);

    await click(button("Referencia técnica"));
    await act(async () => {
      resolveChunk({
        processed: 10, updated: 0, would_update: 3, applied: false, skipped: 7, errors: 0,
        ran_date: "2026-10-16", next_cursor: "LU0000000009", cycle_completed: false
      });
    });
    await flush();

    expect(backend.fetchAdminRefreshAllStale).toHaveBeenCalledTimes(1);
  });
});

describe("Históricos: cargar una fila", () => {
  const fila = (asset_id: string, applied: boolean) => ({
    asset_id, ok: true, applied, skipped: null, reason: null, resolution: "hint", symbol: `${asset_id}.EUFUND`, currency: "EUR",
    points: 1200, first_date: "2015-01-02", last_date: "2026-10-15", years: 11, docs_created: applied ? 12 : 0, error: null
  });

  test("«Cargar» en una fila conserva la vista previa de las demás y descuenta la cargada del recuento (PLA-15)", async () => {
    const ids = ["LU0000000001", "LU0000000002", "LU0000000003"];
    backend.fetchAdminBackfillCandidates.mockResolvedValue({
      generated_at: "2026-10-16T08:00:00Z", total_roots: 3, excluded: 0, with_series: 0, by_type: { FUND: 3 },
      candidates: ids.map((asset_id) => ({ asset_id, name: asset_id, type: "FUND", eodhd_hint: null, currency_hint: null }))
    });
    backend.runAdminBackfillHistory.mockImplementation(async (lote: string[], write: boolean) => ({
      applied: write, requested: lote.length, processed: lote.length, loadable: lote.length, loaded: write ? lote.length : 0,
      skipped: 0, review: 0, errors: 0, results: lote.map((id) => fila(id, write)), ran_date: "2026-10-16"
    }));
    await act(async () => {
      root.render(createElement(AdminBackfill));
    });
    await flush();
    await click(button("Previsualizar carga"));
    await flush();
    expect(button("Cargar históricos").textContent).toContain("(3)");
    const filaDe = (id: string) => [...document.querySelectorAll(".backfill-table tbody tr")].find((tr) => tr.textContent?.includes(id)) as HTMLElement;
    await click([...filaDe("LU0000000002").querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cargar") as HTMLButtonElement);
    await click([...document.querySelectorAll(".ui-dialog button")].find((b) => b.textContent?.trim() === "Cargar") as HTMLButtonElement);
    await flush();
    expect(backend.runAdminBackfillHistory).toHaveBeenLastCalledWith(["LU0000000002"], true);
    /* Las tres filas siguen; la cargada ya no ofrece «Cargar», las otras sí. */
    expect(document.querySelectorAll(".backfill-table tbody tr")).toHaveLength(3);
    expect(filaDe("LU0000000002").querySelector("button")).toBeNull();
    expect(filaDe("LU0000000001").querySelector("button")?.textContent?.trim()).toBe("Cargar");
    expect(button("Cargar históricos").textContent).toContain("(2)");
  });
});

describe("barra de progreso", () => {
  test("tiene nombre y dice el avance en palabras (PLA-20)", async () => {
    const { AdminProgressBar } = await import("../src/components/AdminProgress");
    await act(async () => {
      root.render(createElement(AdminProgressBar, { progress: { phase: "apply", done: 3, total: 10, hits: 2, skipped: 1, errors: 0 }, cancelRequested: false }));
    });
    const barra = document.querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute("aria-label")).toBe("Aplicando actualización");
    expect(barra.getAttribute("aria-valuetext")).toBe("3 de 10");
  });
});

describe("Estado del sistema: la antigüedad", () => {
  test("se mide contra la hora de cada respuesta, no contra la de abrir la pestaña (PLA-23)", async () => {
    const { SystemStatusTab } = await import("../src/pages/AdminPage");
    const snapshot = { integrity: { checked_at: "2026-11-10T08:00:00Z", status: "OK", freshness: {}, counts: {}, problems: [] }, backup: null, prices: { last_run: "2026-11-10T08:00:00Z" }, metrics: null };
    /* Cada respuesta es un objeto nuevo, como las del servicio. */
    const loadStatus = vi.fn(async () => ({ ...snapshot }));
    /* Precios del 10 a las 08:00. La pestaña se abre el 11 a las 09:00 (1 día después) y se actualiza el 13 a las 09:00 (3 días). */
    const horas = [new Date("2026-11-11T09:00:00Z"), new Date("2026-11-13T09:00:00Z")];
    let llamada = 0;
    const reloj = () => horas[llamada];
    await act(async () => {
      root.render(createElement(SystemStatusTab, { loadStatus, reloj }));
    });
    await flush();
    expect(document.body.textContent).toContain("Antigüedad: 1 día");
    llamada = 1;
    await click(button("Actualizar"));
    await flush();
    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Antigüedad: 3 días");
  });
});
