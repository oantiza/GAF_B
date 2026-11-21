// @vitest-environment happy-dom

/**
 * IMP-9 en pantalla (17-11-2026): guardar una cartera ya no borra la que no se puede leer, y Guardadas dice cuántas hay así en este navegador,
 * en una frase. Cada cuenta es de contar a mano las entradas rotas del almacén de la prueba (una o dos), no del código que las cuenta.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

vi.mock("../src/adapters/portfolioBackend", () => ({
  usesBackendPersistence: () => false,
  backendListPortfolioResult: vi.fn(),
  backendSavePortfolio: vi.fn(),
  backendDeletePortfolio: vi.fn()
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: async () => [] })
}));

import { LOCAL_PORTFOLIOS_STORAGE_KEY } from "../src/core/localPortfolioStorage";
import { CarterasGuardadasPage } from "../src/pages/CarterasGuardadasPage";

const buena: BdbSavedLocalPortfolio = {
  portfolio_id: "buena", name: "Cartera buena", created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-11T10:00:00Z",
  sourceKind: "BBDD_LIVE_API", positions: [{ asset_id: "A", weight_percent: 100 }]
};
/* Le falta `sourceKind`: no valida. */
const rota = (portfolio_id: string) => ({ portfolio_id, name: `Rota ${portfolio_id}`, created_at: "2026-01-01", updated_at: "2026-01-02", positions: [] });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function montarCon(entradas: unknown[]) {
  window.localStorage.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, JSON.stringify({ schema_version: "local-portfolios.v1", updated_at: "x", saved_portfolios: entradas }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CarterasGuardadasPage, { sourceKind: "BBDD_LIVE_API" })); });
  await act(async () => { await Promise.resolve(); });
}

describe("las propuestas guardadas en este navegador que no se pueden leer", () => {
  test("una: se dice en una frase, que no se ha borrado, y las demás se enseñan", async () => {
    await montarCon([buena, rota("vieja")]);
    expect(host!.textContent).toContain("Cartera buena");
    expect(host!.querySelector('[role="status"]')?.textContent).toBe("Aviso. Una propuesta guardada en este navegador no se puede leer y no aparece en la lista; sigue guardada, no se ha borrado.");
    expect(host!.textContent).not.toContain("Rota vieja");
  });

  test("dos: se cuentan", async () => {
    await montarCon([buena, rota("v1"), rota("v2")]);
    expect(host!.querySelector('[role="status"]')?.textContent).toBe("Aviso. 2 propuestas guardadas en este navegador no se pueden leer y no aparecen en la lista; siguen guardadas, no se han borrado.");
  });

  test("ninguna: no hay aviso, y sin jerga cuando lo hay", async () => {
    await montarCon([buena]);
    expect(host!.textContent).not.toContain("no se puede leer");
    expect(host!.textContent).not.toContain("no se pueden leer");
    expect(host!.querySelector('[role="status"]')).toBeNull();
  });
});
