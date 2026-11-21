// @vitest-environment happy-dom

/**
 * Mercado (auditoría de frontend, ACT-17): la pestaña va en la dirección (`/mercado#dividendos`), se
 * puede recargar y compartir, y «Atrás» vuelve a la anterior; y cada pestaña pide solo sus datos: abrir
 * Dividendos o Resultados no pide los tipos ni la curva del BCE.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/ecbRatesBackend", () => ({ fetchEcbRates: vi.fn() }));
vi.mock("../src/adapters/ecbYieldCurveBackend", () => ({ fetchEcbYieldCurve: vi.fn() }));
vi.mock("../src/components/EconomicCalendarPanel", () => ({ EconomicCalendarPanel: () => <p>panel-calendario</p> }));
vi.mock("../src/components/DividendsPanel", () => ({ DividendsPanel: () => <p>panel-dividendos</p> }));
vi.mock("../src/components/EarningsPanel", () => ({ EarningsPanel: () => <p>panel-resultados</p> }));
vi.mock("../src/pages/StrategyPage", () => ({ StrategyPage: () => <p>panel-estrategia</p> }));

import { fetchEcbRates } from "../src/adapters/ecbRatesBackend";
import { fetchEcbYieldCurve } from "../src/adapters/ecbYieldCurveBackend";
import { MacroPage } from "../src/pages/MacroPage";
import { MercadoPage } from "../src/pages/MercadoPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(fetchEcbRates).mockReset().mockResolvedValue({ rates: [], live_count: 0 } as never);
  vi.mocked(fetchEcbYieldCurve).mockReset().mockResolvedValue(null as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/* Las pestañas se cargan con `lazy`: hace falta dejar correr las promesas del import. */
const esperar = async () => {
  for (let vuelta = 0; vuelta < 5; vuelta += 1) await act(async () => { await Promise.resolve(); });
};
const pestana = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto)!;

/* Rediseño (paso 4): la pestaña va con el gancho común, en el formato de toda la aplicación (`#pestana=dividendos`); la
   primera no se escribe. Antes era `#dividendos`, y esas direcciones guardadas siguen abriendo su pestaña. */
describe("la pestaña va en la dirección", () => {
  test("una dirección con #pestana=dividendos abre Dividendos, y al recargar sigue ahí", async () => {
    window.history.replaceState(null, "", "/mercado#pestana=dividendos");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar();
    expect(host.textContent).toContain("panel-dividendos");
    expect(pestana("Dividendos").getAttribute("aria-selected")).toBe("true");

    /* Recargar: la pantalla se monta de nuevo con la misma dirección. */
    await act(async () => root!.unmount());
    root = createRoot(host);
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar();
    expect(pestana("Dividendos").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("mercado-tab-dividendos");
  });

  test("una dirección del formato anterior (#dividendos) abre su pestaña y queda escrita en el de ahora, sin entrada nueva", async () => {
    window.history.replaceState(null, "", "/mercado#dividendos");
    const pushState = vi.spyOn(window.history, "pushState");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar();
    expect(host.textContent).toContain("panel-dividendos");
    expect(window.location.hash).toBe("#pestana=dividendos");
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  test("pulsar «Mercado» en el menú estando en otra pestaña vuelve a la primera", async () => {
    window.history.replaceState(null, "", "/mercado#pestana=resultados");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar();
    expect(pestana("Resultados").getAttribute("aria-selected")).toBe("true");
    /* El marco quita lo que hay tras el `#` y avisa con un `hashchange`. */
    window.history.replaceState(null, "", "/mercado");
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await esperar();
    expect(pestana("Tipos y calendario").getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("panel-calendario");
  });

  test("cambiar de pestaña escribe la dirección con una entrada nueva, y «Atrás» vuelve a la anterior", async () => {
    window.history.replaceState(null, "", "/mercado");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar();
    /* La primera pestaña no se escribe: una dirección sin pestaña es la primera. */
    expect(window.location.hash).toBe("");
    const pushState = vi.spyOn(window.history, "pushState");
    await act(async () => pestana("Resultados").click());
    await esperar();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/mercado");
    expect(window.location.hash).toBe("#pestana=resultados");
    expect(host.textContent).toContain("panel-resultados");

    /* «Atrás»: el navegador deja la dirección anterior y avisa con `popstate`. */
    window.history.replaceState(null, "", "/mercado");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await esperar();
    expect(pestana("Tipos y calendario").getAttribute("aria-selected")).toBe("true");
    pushState.mockRestore();
  });

  test("una dirección antigua (/estrategia) deja la pestaña escrita en la dirección", async () => {
    window.history.replaceState(null, "", "/mercado");
    await act(async () => { root!.render(<MercadoPage initialTab="estrategia" />); });
    await esperar();
    expect(window.location.hash).toBe("#pestana=estrategia");
    expect(host.textContent).toContain("panel-estrategia");
  });
});

describe("cada pestaña pide solo sus datos", () => {
  test("Dividendos y Resultados no piden los tipos ni la curva del BCE", async () => {
    await act(async () => { root!.render(<MacroPage tab="dividendos" />); });
    await act(async () => { root!.render(<MacroPage tab="resultados" />); });
    expect(fetchEcbRates).not.toHaveBeenCalled();
    expect(fetchEcbYieldCurve).not.toHaveBeenCalled();
  });

  test("Tipos y calendario sí los pide, una vez cada uno", async () => {
    await act(async () => { root!.render(<MacroPage tab="calendario" />); });
    expect(fetchEcbRates).toHaveBeenCalledTimes(1);
    expect(fetchEcbYieldCurve).toHaveBeenCalledTimes(1);
  });
});
