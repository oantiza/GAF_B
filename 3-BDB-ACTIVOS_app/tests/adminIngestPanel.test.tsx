// @vitest-environment happy-dom

/**
 * Sistema › Ingesta (CRIT-05, auditoría 16-10-2026): «Aplicar» solo vale para la
 * entrada que se previsualizó. Si el ISIN, el símbolo o el histórico cambian con
 * la vista previa en vuelo, la respuesta vieja no puede habilitar el alta del
 * ISIN nuevo, que Óscar no ha visto.
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

import { AdminPage } from "../src/pages/AdminPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APPLE = "US0378331005";
const IWDA = "IE00B4L5Y983";

let host: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(text));
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function setValue(input: HTMLInputElement, value: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

function preview(isin: string) {
  return { asset_id: isin, ok: true, preview: true, applied: false, symbol: "AAPL.US", name: "Apple", history: { loaded: true, points: 100 } };
}

function isinInput(): HTMLInputElement {
  return host.querySelector(`input[placeholder="${APPLE}"]`) as HTMLInputElement;
}

function symbolInput(): HTMLInputElement {
  return host.querySelector('input[placeholder="SGRE.MC"]') as HTMLInputElement;
}

async function openIngesta() {
  await act(async () => {
    root.render(createElement(AdminPage));
  });
  await click(button("Ingesta"));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.fetchAdminDbStatus.mockResolvedValue({ master_writes_enabled: true, master_writes_mode: "enabled", total_assets: 10 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AdminIngestPanel: la vista previa es de una entrada concreta", () => {
  test("cambiar el ISIN con la vista previa en vuelo deja «Aplicar» deshabilitado y nunca escribe el ISIN nuevo", async () => {
    let resolvePreview!: (value: unknown) => void;
    backend.adminIngestAsset.mockImplementation((_isin: string, _history: boolean, write: boolean) =>
      write ? Promise.resolve({ ok: true, applied: true, preview: false }) : new Promise((resolve) => { resolvePreview = resolve; }));

    await openIngesta();
    await setValue(isinInput(), APPLE);
    await click(button("Previsualizar alta"));

    // Mientras la vista previa está en vuelo, los campos no se pueden tocar.
    expect(isinInput().disabled).toBe(true);
    expect(symbolInput().disabled).toBe(true);

    // Aun así (cambio programático, que React deja pasar con el campo
    // deshabilitado), la respuesta vieja no habilita nada: lo decide la clave
    // de la vista previa, que no casa con la entrada nueva.
    await setValue(isinInput(), IWDA);
    expect(isinInput().value).toBe(IWDA);
    await act(async () => {
      resolvePreview(preview(APPLE));
    });
    await flush();

    expect(isinInput().value).toBe(IWDA);
    expect(button("Aplicar").disabled).toBe(true);
    // El clic sobre el botón deshabilitado no llega al manejador: esto prueba
    // la clave (botón deshabilitado), no la guarda `if (write && !canApply)` de
    // run(), que queda como defensa en profundidad.
    await click(button("Aplicar"));
    await flush();
    expect(backend.adminIngestAsset.mock.calls.filter((call) => call[2] === true)).toEqual([]);
  });

  test("cambiar solo el símbolo con la vista previa en vuelo también invalida «Aplicar»", async () => {
    let resolvePreview!: (value: unknown) => void;
    backend.adminIngestAsset.mockImplementation(() => new Promise((resolve) => { resolvePreview = resolve; }));

    await openIngesta();
    await setValue(isinInput(), APPLE);
    await click(button("Previsualizar alta"));
    await setValue(symbolInput(), "AAPL.US");
    await act(async () => {
      resolvePreview(preview(APPLE));
    });
    await flush();

    expect(button("Aplicar").disabled).toBe(true);
  });

  test("con la vista previa de la misma entrada, «Aplicar» escribe ese ISIN tras confirmar", async () => {
    backend.adminIngestAsset.mockImplementation((isin: string, _history: boolean, write: boolean) =>
      Promise.resolve(write ? { asset_id: isin, ok: true, applied: true, preview: false } : preview(isin)));

    await openIngesta();
    await setValue(isinInput(), APPLE);
    await click(button("Previsualizar alta"));
    await flush();

    expect(button("Aplicar").disabled).toBe(false);
    await click(button("Aplicar"));
    await flush();
    await click(button("Dar de alta"));
    await flush();

    expect(backend.adminIngestAsset).toHaveBeenLastCalledWith(APPLE, true, true, undefined);
  });
});
