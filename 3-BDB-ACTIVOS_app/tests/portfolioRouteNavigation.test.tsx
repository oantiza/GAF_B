// @vitest-environment happy-dom

/**
 * CRIT-04 (auditoría 14-10-2026): `/cartera` y `/cartera/informes` montan la
 * MISMA página. Antes, «Generar informe» abría el informe con un estado local
 * sin cambiar la URL: el rail «Constructor» ya no hacía nada (la ruta no
 * cambiaba) y, al revés, «Ir al Constructor» desde un informe vacío dejaba el
 * rail «Informe de cliente» muerto. Ahora la ruta es la única fuente de
 * verdad: abrir o cerrar el informe es navegar.
 *
 * Se monta el shell real (rail, router y página); el Constructor y el informe
 * son testigos que solo exponen sus salidas de navegación.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => false,
  /* El marco espera a saber si hay permiso (MAR-22): en estas pruebas ya se sabe. */
  useAdminClaim: () => ({ isAdmin: false, resolved: true })
}));

vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => null,
    buildManualPortfolioOptimizationPreview: async () => null
  };
  return { getAssetDataSource: () => dataSource };
});

vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: ({ onOpenReport }: { onOpenReport: (locked: Record<string, number>) => void }) =>
    createElement("section", { "data-vista": "constructor" },
      createElement("button", { type: "button", onClick: () => onOpenReport({ A: 0.6 }) }, "Generar informe de cliente"))
}));

vi.mock("../src/pages/PortfolioReportPage", () => ({
  PortfolioReportPage: ({ onBack, lockedWeights }: { onBack: () => void; lockedWeights?: Record<string, number> }) =>
    createElement("section", { "data-vista": "informe" },
      createElement("output", { id: "candados-informe" }, JSON.stringify(lockedWeights ?? {})),
      createElement("button", { type: "button", onClick: onBack }, "Ir a Diseño de cartera"))
}));

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { DEFAULT_DATA_SOURCE_KIND } from "../src/config/runtimeConfig";
import { disenoEnSesion } from "../src/core/disenoEnSesion";
import { CURRENT_PORTFOLIO_STORAGE_KEY, serializeCurrentPortfolioDraft } from "../src/core/localPortfolioStorage";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function waitFor(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`No aparece: ${what}`);
}

async function mountAt(path: string) {
  window.history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(BdbActivosApp)); });
}

const vista = () => host?.querySelector("[data-vista]")?.getAttribute("data-vista") ?? null;
const candados = () => host?.querySelector("#candados-informe")?.textContent ?? "";
const railActivo = () => host?.querySelector('nav.rail-nav [aria-current="page"]')?.getAttribute("aria-label") ?? null;

function railLink(label: string): HTMLAnchorElement {
  const link = host?.querySelector<HTMLAnchorElement>(`nav.rail-nav a[aria-label="${label}"]`);
  if (!link) throw new Error(`Falta la entrada del rail «${label}»`);
  return link;
}

function pageButton(text: string): HTMLButtonElement {
  const button = [...(host?.querySelectorAll<HTMLButtonElement>("main button") ?? [])].find((b) => b.textContent === text);
  if (!button) throw new Error(`Falta el botón «${text}»`);
  return button;
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}

describe("CRIT-04 · la ruta decide entre Constructor e Informe de cliente", () => {
  test("abrir el informe desde el Constructor navega a /cartera/informes y el rail «Diseño» vuelve", async () => {
    /* Una cartera con una posición de 60 % con candado: lo que el informe tiene que recibir. */
    const borrador = serializeCurrentPortfolioDraft({
      sourceKind: DEFAULT_DATA_SOURCE_KIND,
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }]
    });
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, borrador);
    sessionStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, borrador);
    disenoEnSesion.write({ ...disenoEnSesion.read(), locks: { A: true } });
    await mountAt("/cartera");
    await waitFor(() => vista() === "constructor", "el Constructor");
    expect(railActivo()).toBe("Diseño");

    await click(pageButton("Generar informe de cliente"));
    await waitFor(() => vista() === "informe", "el informe");
    expect(window.location.pathname).toBe("/cartera/informes");
    expect(railActivo()).toBe("Informes");
    expect(document.title).toBe("Informes · Independent Private Bankers");
    // Los candados del Constructor viajan al informe que se abre desde él…
    expect(JSON.parse(candados())).toEqual({ A: 0.6 });

    // Antes del arreglo este clic no hacía nada: la URL seguía en /cartera.
    await click(railLink("Diseño"));
    await waitFor(() => vista() === "constructor", "el Constructor tras el rail");
    expect(window.location.pathname).toBe("/cartera");
    expect(railActivo()).toBe("Diseño");

    // …y al que se abre por el rail no: el papel no se mueve en esta tanda (decisión pendiente de Óscar).
    await click(railLink("Informes"));
    await waitFor(() => vista() === "informe", "el informe por el rail");
    expect(window.location.pathname).toBe("/cartera/informes");
    expect(JSON.parse(candados())).toEqual({});
  });

  test("desde /cartera/informes, «Ir a Diseño de cartera» navega y el rail «Informes» vuelve", async () => {
    await mountAt("/cartera/informes");
    await waitFor(() => vista() === "informe", "el informe");
    expect(railActivo()).toBe("Informes");

    await click(pageButton("Ir a Diseño de cartera"));
    await waitFor(() => vista() === "constructor", "el Constructor");
    expect(window.location.pathname).toBe("/cartera");
    expect(railActivo()).toBe("Diseño");

    // Antes del arreglo este clic no hacía nada: la ruta ya era «informes».
    await click(railLink("Informes"));
    await waitFor(() => vista() === "informe", "el informe tras el rail");
    expect(window.location.pathname).toBe("/cartera/informes");
    expect(railActivo()).toBe("Informes");
  });

  test("el botón Atrás del navegador también cambia de vista", async () => {
    await mountAt("/cartera");
    await waitFor(() => vista() === "constructor", "el Constructor");
    await click(pageButton("Generar informe de cliente"));
    await waitFor(() => vista() === "informe", "el informe");

    await act(async () => {
      window.history.replaceState(null, "", "/cartera");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => vista() === "constructor", "el Constructor tras Atrás");
    expect(railActivo()).toBe("Diseño");
  });
});
