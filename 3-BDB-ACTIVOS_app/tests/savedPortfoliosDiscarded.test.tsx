// @vitest-environment happy-dom

/**
 * H04 en pantalla (revisión 14-10-2026): una cartera de la cuenta fuera de
 * contrato se descarta sola y el resto se carga; la lista de carteras
 * guardadas lo dice con un aviso discreto.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn() }));

vi.mock("../src/adapters/portfolioBackend", () => ({
  usesBackendPersistence: () => true,
  backendListPortfolioResult: backend.list,
  backendSavePortfolio: backend.save,
  backendDeletePortfolio: backend.remove
}));

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: async () => [] })
}));

import { useSavedPortfolios } from "../src/core/useSavedPortfolios";
import { CarterasGuardadasPage } from "../src/pages/CarterasGuardadasPage";

const valid: BdbSavedLocalPortfolio = {
  portfolio_id: "good",
  name: "Cartera buena",
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-11T10:00:00Z",
  sourceKind: "BBDD_LIVE_API",
  positions: [{ asset_id: "A", weight_percent: 100 }]
};

let latest: ReturnType<typeof useSavedPortfolios>;
/* Dos oyentes de la misma lista, como en la aplicación: la pantalla, y quien guarda o elimina. */
function SavedList() {
  const saved = useSavedPortfolios({ sourceKind: "BBDD_LIVE_API", onNotice: () => undefined });
  useEffect(() => { latest = saved; }, [saved]);
  return createElement(CarterasGuardadasPage, { sourceKind: "BBDD_LIVE_API" });
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.list.mockReset();
  backend.save.mockReset();
  backend.remove.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(SavedList)); });
  await act(async () => { await Promise.resolve(); });
}

describe("H04 · carteras guardadas descartadas", () => {
  test("una lista antigua no borra una cartera que acaba de guardarse", async () => {
    let finish!: (value: { portfolios: BdbSavedLocalPortfolio[]; discarded: [] }) => void;
    backend.list.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    backend.save.mockResolvedValue({ portfolio: valid, warnings: [] });
    await mount();
    await act(async () => { await latest.save("Cartera buena", [], [], undefined); });
    expect(host!.textContent).toContain("Cartera buena");
    await act(async () => { finish({ portfolios: [], discarded: [] }); });
    expect(host!.textContent).toContain("Cartera buena");
  });

  test("una lista antigua no resucita una cartera que acaba de eliminarse", async () => {
    let finish!: (value: { portfolios: BdbSavedLocalPortfolio[]; discarded: [] }) => void;
    backend.list.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    backend.remove.mockResolvedValue({ ok: true });
    await mount();
    await act(async () => { await latest.remove(valid.portfolio_id); });
    await act(async () => { finish({ portfolios: [valid], discarded: [] }); });
    expect(host!.textContent).not.toContain("Cartera buena");
  });
  test("la lista carga las válidas y avisa de la descartada", async () => {
    backend.list.mockResolvedValue({
      portfolios: [valid],
      discarded: [{ index: 1, portfolio_id: "broken", reason: "fecha no válida" }]
    });
    await mount();

    expect(host!.textContent).toContain("Cartera buena");
    /* Con su `role`: si no, un lector de pantalla no se entera de que falta una cartera. */
    /* Rediseño del 14-11-2026: en Guardadas el objeto se llama «propuesta». */
    expect(host!.querySelector('[role="status"]')?.textContent).toContain("Una propuesta guardada en tu cuenta no se ha podido leer");
  });

  test("tras reintentar con éxito, ya no dice que no se pudieron cargar", async () => {
    const notas: (string | null)[] = [];
    function ConNotas() {
      const saved = useSavedPortfolios({ sourceKind: "BBDD_LIVE_API", onNotice: (nota) => notas.push(nota) });
      useEffect(() => { latest = saved; }, [saved]);
      return null;
    }
    backend.list.mockRejectedValueOnce(new Error("sin red")).mockResolvedValueOnce({ portfolios: [valid], discarded: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(ConNotas)); });
    await act(async () => { await Promise.resolve(); });
    expect(notas.at(-1)).toBe("No se pudieron cargar las carteras guardadas de tu cuenta.");
    expect(latest.errorAlListar).toBeTruthy();

    await act(async () => { latest.reintentar(); });
    await act(async () => { await Promise.resolve(); });
    expect(notas.at(-1)).toBeNull();
    expect(latest.errorAlListar).toBeNull();
    expect(latest.savedPortfolios).toHaveLength(1);
  });

  test("varias descartadas se cuentan; sin descartes no hay aviso", async () => {
    backend.list.mockResolvedValue({
      portfolios: [valid],
      discarded: [{ index: 1, reason: "x" }, { index: 2, reason: "y" }]
    });
    await mount();
    expect(host!.textContent).toContain("2 propuestas guardadas en tu cuenta no se han podido leer");

    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    backend.list.mockResolvedValue({ portfolios: [valid], discarded: [] });
    await mount();
    expect(host!.textContent).not.toContain("no se ha podido leer");
    expect(host!.textContent).not.toContain("no se han podido leer");
  });
});
