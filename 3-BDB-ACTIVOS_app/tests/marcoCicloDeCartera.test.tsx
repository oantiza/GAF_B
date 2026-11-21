// @vitest-environment happy-dom

/**
 * Las salidas que no pasan por Diseño de cartera (hallazgo 47) y la dirección que no existe (hallazgo 121),
 * con el marco de verdad: rail, enrutado y diálogo. Las pantallas son testigos.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

// Con un borrador guardado la app precarga la cartera activa y eso pedía `backtest_portfolio` al emulador
// de Functions (127.0.0.1:5005, 401 y AbortError al desmontar). Aquí no se prueba la precarga: no sale a red.
vi.mock("../src/adapters/prefetchActivePortfolio", () => ({ prefetchActivePortfolio: async () => undefined }));
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
  PortfolioBuilder: ({ positions, portfolioName, initialCapital }: { positions: BdbManualPortfolioPosition[]; portfolioName: string; initialCapital?: number }) =>
    createElement("section", { "data-vista": "constructor" }, `${portfolioName}|${positions.length}|${initialCapital}`)
}));
const TRANSFERENCIA = {
  positions: [{ asset_id: "X", weight_percent: 100, label: "Fondo X" }],
  totalCapital: 500000,
  name: "Extracto externo",
  excludedIds: [],
  excludedCapital: 0
};
vi.mock("../src/pages/PosicionesPage", () => ({
  PosicionesPage: ({ onSendToBuilder }: { onSendToBuilder: (p: typeof TRANSFERENCIA) => void }) =>
    createElement("button", { type: "button", onClick: () => onSendToBuilder(TRANSFERENCIA) }, "Llevar a Diseño de cartera")
}));

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { AuthSessionContext } from "../src/auth/AuthSessionContext";
import { DEFAULT_DATA_SOURCE_KIND } from "../src/config/runtimeConfig";
import { CURRENT_PORTFOLIO_STORAGE_KEY, serializeCurrentPortfolioDraft } from "../src/core/localPortfolioStorage";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const signOut = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
  signOut.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function borrador(positions: BdbManualPortfolioPosition[], nombre?: string) {
  const texto = serializeCurrentPortfolioDraft({ sourceKind: DEFAULT_DATA_SOURCE_KIND, positions, name: nombre, totalCapital: 100000 });
  localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, texto);
  sessionStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, texto);
}

async function montarEn(ruta: string) {
  window.history.replaceState(null, "", ruta);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const sesion = { uid: "usuario-de-prueba", email: "x@y.z", emailVerified: true, mfaEnrolled: true, openSecurity: () => undefined, signOut };
  await act(async () => {
    root!.render(createElement(AuthSessionContext.Provider, { value: sesion }, createElement(BdbActivosApp)));
  });
}

// Las pantallas cargan por import dinámico: con la máquina ocupada tardan más de 1,5 s. La espera es por
// condición (sale en cuanto se cumple), así que un tope de 15 s solo cuenta cuando algo falla de verdad.
const TOPE_ESPERA_MS = 15_000;
vi.setConfig({ testTimeout: 30_000 });

async function espera(condicion: () => boolean, que: string) {
  for (let intento = 0; intento < TOPE_ESPERA_MS / 10; intento += 1) {
    if (condicion()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`No aparece: ${que}`);
}

const boton = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;
const dialogo = () => document.querySelector('[role="dialog"]');

async function pulsar(texto: string) {
  await espera(() => Boolean(boton(texto)), `el botón ${texto}`);
  await act(async () => {
    boton(texto)?.click();
  });
}

describe("Salir", () => {
  test("sin cambios sale sin preguntar", async () => {
    await montarEn("/mercado");
    await pulsar("Salir");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(dialogo()).toBeNull();
  });

  test("con cambios pregunta, y «Cancelar» se queda", async () => {
    borrador([{ asset_id: "A", weight_percent: 100 }], "Cliente");
    await montarEn("/posiciones");
    await pulsar("Salir");
    await espera(() => Boolean(dialogo()), "el diálogo");
    expect(dialogo()?.textContent).toContain("La cartera Cliente tiene cambios sin guardar");
    expect(signOut).not.toHaveBeenCalled();
    await pulsar("Cancelar");
    expect(signOut).not.toHaveBeenCalled();
    expect(dialogo()).toBeNull();
  });

  test("«Descartar» sale", async () => {
    borrador([{ asset_id: "A", weight_percent: 100 }], "Cliente");
    await montarEn("/posiciones");
    await pulsar("Salir");
    await espera(() => Boolean(dialogo()), "el diálogo");
    await pulsar("Descartar");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("«Llevar a Diseño de cartera»", () => {
  test("sin nada que perder, lleva y sustituye", async () => {
    await montarEn("/posiciones");
    await pulsar("Llevar a Diseño de cartera");
    await espera(() => Boolean(document.querySelector('[data-vista="constructor"]')), "Diseño");
    expect(window.location.pathname).toBe("/cartera");
    expect(document.querySelector('[data-vista="constructor"]')?.textContent).toBe("Extracto externo|1|500000");
  });

  test("con cambios pregunta; «Cancelar» no sustituye ni navega", async () => {
    borrador([{ asset_id: "A", weight_percent: 100 }], "Cliente");
    await montarEn("/posiciones");
    await pulsar("Llevar a Diseño de cartera");
    await espera(() => Boolean(dialogo()), "el diálogo");
    await pulsar("Cancelar");
    expect(window.location.pathname).toBe("/posiciones");
    expect(document.querySelector('[data-vista="constructor"]')).toBeNull();
  });

  test("con cambios, «Descartar» sustituye y lleva", async () => {
    borrador([{ asset_id: "A", weight_percent: 100 }], "Cliente");
    await montarEn("/posiciones");
    await pulsar("Llevar a Diseño de cartera");
    await espera(() => Boolean(dialogo()), "el diálogo");
    await pulsar("Descartar");
    await espera(() => Boolean(document.querySelector('[data-vista="constructor"]')), "Diseño");
    expect(document.querySelector('[data-vista="constructor"]')?.textContent).toBe("Extracto externo|1|500000");
  });
});

describe("una dirección que no existe", () => {
  test("lo dice, se queda en la barra, no marca nada en el menú y tiene salida", async () => {
    await montarEn("/esto-no-existe");
    await espera(() => host?.querySelector("main h1")?.textContent === "Esta página no existe", "el título");
    expect(window.location.pathname).toBe("/esto-no-existe");
    expect(document.title).toContain("Esta página no existe");
    expect(host?.querySelector('nav.rail-nav [aria-current="page"]')).toBeNull();
    await pulsar("Ir a Diseño de la propuesta");
    await espera(() => Boolean(document.querySelector('[data-vista="constructor"]')), "Diseño");
    expect(window.location.pathname).toBe("/cartera");
    expect(host?.querySelector('nav.rail-nav [aria-current="page"]')?.getAttribute("aria-label")).toBe("Diseño");
  });
});
