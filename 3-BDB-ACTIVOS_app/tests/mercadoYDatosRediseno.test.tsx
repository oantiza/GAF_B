// @vitest-environment happy-dom

/**
 * Rediseño, paso 4 (Mercado y Datos). Lo que se comprueba aquí es lo que el rediseño añade, no lo que ya probaban las
 * pruebas de cada pantalla:
 * - Mercado: la pestaña «Tipos y calendario» abre con la respuesta, los cuatro tipos del BCE con la fecha de cada uno y
 *   sin color (son niveles, no resultados), y lo que no ha llegado se dice.
 * - Sistema: sus dos pestañas (las de la base nueva; las siete de la vieja se borraron el 21-11-2026) van en la
 *   dirección y se recuperan al recargar, y una pestaña que ya no existe abre la primera.
 * - Salud del catálogo: cada ruta de campo va con qué dato es, en palabras.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tipos: vi.fn(),
  curva: vi.fn(),
  calidades: vi.fn()
}));

vi.mock("../src/adapters/ecbRatesBackend", () => ({ fetchEcbRates: mocks.tipos }));
vi.mock("../src/adapters/ecbYieldCurveBackend", () => ({ fetchEcbYieldCurve: mocks.curva }));
vi.mock("../src/charts/EuroYieldCurveChart", () => ({ EuroYieldCurvePanel: () => <p>curva-del-euro</p> }));
vi.mock("../src/components/EconomicCalendarPanel", () => ({ EconomicCalendarPanel: () => <p>calendario</p> }));
vi.mock("../src/firebase", () => ({ auth: null, firestore: null, functions: null }));
vi.mock("../src/components/AdminRetrocessions", () => ({ AdminRetrocessions: () => <p>retrocesiones</p> }));
vi.mock("../src/adapters/baseNuevaLectura", async (original) => ({
  ...(await original<typeof import("../src/adapters/baseNuevaLectura")>()),
  BASE_NUEVA_DISPONIBLE: true,
  listarCalidades: mocks.calidades,
  listarTarjetas: () => new Promise(() => undefined)
}));

import { rutaEnPalabras } from "../src/adapters/componerSalud";
import { MacroPage } from "../src/pages/MacroPage";
import { AdminPage } from "../src/pages/AdminPage";
import { SaludDelCatalogoPage } from "../src/pages/SaludDelCatalogoPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.tipos.mockReset();
  mocks.curva.mockReset().mockResolvedValue(null);
  mocks.calidades.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const reposar = async () => {
  for (let vuelta = 0; vuelta < 4; vuelta += 1) await act(async () => { await new Promise((listo) => setTimeout(listo, 0)); });
};
const normal = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");

describe("Mercado · los tipos del día", () => {
  test("la respuesta: cada tipo con su cifra, la fecha de su observación y sin color", async () => {
    mocks.tipos.mockResolvedValue({
      rates: [
        { id: "estr", date: "2026-11-12", value: 1.93 },
        { id: "dfr", date: "2026-11-13", value: 2 },
        { id: "mro", date: "2026-11-13", value: 2.15 }
      ],
      live_count: 3
    });
    await act(async () => { root!.render(<MacroPage tab="calendario" />); });
    await reposar();

    const banda = host.querySelector('[role="group"][aria-label="Los tipos del día"]')!;
    expect(banda).not.toBeNull();
    const datos = [...banda.querySelectorAll(".respuesta__dato")].map((dato) => ({
      rotulo: dato.querySelector(".respuesta__rotulo")?.textContent,
      cifra: normal(dato.querySelector(".respuesta__cifra")?.textContent),
      apunte: dato.querySelector(".respuesta__apunte")?.textContent
    }));
    expect(datos).toEqual([
      { rotulo: "€STR", cifra: "1,93 %", apunte: "a 12/11/2026" },
      { rotulo: "Facilidad de depósito", cifra: "2,00 %", apunte: "a 13/11/2026" },
      { rotulo: "Operaciones de financiación", cifra: "2,15 %", apunte: "a 13/11/2026" },
      /* La que no ha llegado se dice; no se pone otro valor en su sitio. */
      { rotulo: "Facilidad marginal de crédito", cifra: "Falta el dato", apunte: "sin observación del BCE" }
    ]);
    /* Son niveles, no resultados: ni verde ni rojo, ni signo. */
    expect(banda.querySelector(".cifra--sube, .cifra--baja")).toBeNull();
    expect(banda.textContent).not.toContain("+");
    expect(host.textContent).toContain("3 de 4 series");
  });

  test("mientras llegan, la forma de lo que viene y no una cifra inventada", async () => {
    mocks.tipos.mockReturnValue(new Promise(() => undefined));
    await act(async () => { root!.render(<MacroPage tab="calendario" />); });
    expect(host.querySelector(".esqueleto")).not.toBeNull();
    expect(host.querySelector('[aria-label="Los tipos del día"]')).toBeNull();
    expect(host.textContent).toContain("Consultando las últimas observaciones del BCE");
  });
});

describe("Sistema · pestañas en la dirección", () => {
  const pestana = (texto: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === texto)!;

  test("son las dos de la base nueva, la elegida va en la dirección y se recupera al recargar", async () => {
    window.history.replaceState(null, "", "/sistema");
    await act(async () => { root!.render(createElement(AdminPage)); });
    expect([...host.querySelectorAll('[role="tab"]')].map((p) => p.textContent)).toEqual(["Estado del sistema", "Retrocesiones"]);
    expect(pestana("Estado del sistema").getAttribute("aria-selected")).toBe("true");

    await act(async () => pestana("Retrocesiones").click());
    expect(window.location.hash).toBe("#pestana=retrocesiones");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("admin-tab-retrocesiones");

    await act(async () => root!.unmount());
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AdminPage)); });
    expect(pestana("Retrocesiones").getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("retrocesiones");
  });

  test("una dirección guardada con una pestaña de la base vieja abre la primera", async () => {
    window.history.replaceState(null, "", "/sistema#pestana=operaciones");
    await act(async () => { root!.render(createElement(AdminPage)); });
    expect(pestana("Estado del sistema").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("admin-tab-sistema");
  });
});

describe("Salud del catálogo · cada campo en palabras", () => {
  test("una ruta conocida dice qué dato es; una desconocida, de qué bloque es", () => {
    expect(rutaEnPalabras("declared/size.aum")).toBe("Patrimonio");
    expect(rutaEnPalabras("declared/costs.ongoing_charge")).toBe("Coste corriente");
    expect(rutaEnPalabras("computed/metrics.sortino.1y")).toBe("Una métrica nuestra");
    expect(rutaEnPalabras("declared/costs.algo_nuevo")).toBe("Un coste declarado");
    expect(rutaEnPalabras("zzz.desconocido")).toBe("Campo aún sin nombre en palabras");
  });

  test("la pantalla enseña el dato en palabras con su ruta debajo, y la respuesta con sus cifras", async () => {
    const calidad = (ausencias: Array<[string, string]>) => ({
      present_paths: 8,
      applicable_paths: 10,
      absences: ausencias.map(([path, reason]) => ({ path, reason })),
      fitness: {},
      warnings: []
    });
    mocks.calidades.mockResolvedValue([
      calidad([["declared/size.aum", "NOT_PROVIDED"], ["computed/metrics.sortino.1y", "NOT_YET_FETCHED"]]),
      calidad([["computed/metrics.sortino.1y", "NOT_YET_FETCHED"]])
    ]);
    await act(async () => { root!.render(<SaludDelCatalogoPage />); });
    await reposar();

    const banda = host.querySelector('[role="group"][aria-label="Qué sabe el catálogo"]')!;
    expect(normal(banda.querySelector(".respuesta__dato--principal .respuesta__cifra")?.textContent)).toBe("80,0 %");
    const filas = [...host.querySelectorAll("tbody tr")].map((fila) => normal(fila.textContent));
    expect(filas).toContain("Una métrica nuestracomputed/metrics.sortino.1y");
    expect(filas.some((fila) => fila.startsWith("Patrimoniodeclared/size.aum"))).toBe(true);
  });
});
