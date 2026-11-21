// @vitest-environment happy-dom

/**
 * Comparar carteras (hallazgo 121): la cartera activa se puede comparar sin guardarla antes, y el vacío
 * tiene salida. Delante del cliente no se manda a la lista de las carteras de los demás.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: async () => [] }) }));
vi.mock("../src/adapters/portfolioBackend", () => ({ usesBackendPersistence: () => false, backendListPortfolios: async () => [] }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioComparator, type CarteraActivaParaComparar } from "../src/components/PortfolioComparator";
import { writeLocalPortfoliosToStorage } from "../src/core/localPortfolioStorage";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root;
let host: HTMLDivElement;

const ACTIVA: CarteraActivaParaComparar = {
  positions: [{ asset_id: "A", weight_percent: 100 }],
  nombre: "",
  capital: undefined,
  sinGuardar: true
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(carteraActiva: CarteraActivaParaComparar | undefined, modoCliente = false) {
  const onIrACarterasGuardadas = vi.fn();
  await act(async () => {
    root.render(
      createElement(
        ClientModeProvider,
        { initialValue: modoCliente, children: createElement(PortfolioComparator, { sourceKind: "LOCAL_MOCK", carteraActiva, onIrACarterasGuardadas }) }
      )
    );
  });
  return onIrACarterasGuardadas;
}

/** El selector que nombra su rótulo: el rediseño los monta con `Campo`, que enlaza el rótulo con el control. */
const selectorDe = (rotulo: string) => {
  const etiqueta = [...document.querySelectorAll<HTMLLabelElement>("label.field__label")].find((l) => l.textContent === rotulo);
  return document.getElementById(etiqueta?.htmlFor ?? "") as HTMLSelectElement;
};
const opciones = () => [...selectorDe("Propuesta A").querySelectorAll("option")].map((o) => o.textContent);
const irAGuardadas = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Ir a Guardadas");

describe("Comparar carteras", () => {
  test("con cambios sin guardar, la activa sale en los desplegables", async () => {
    await montar(ACTIVA);
    expect(opciones()).toEqual(["Elige una propuesta…", "Propuesta en curso (sin guardar)"]);
  });

  test("guardada y sin tocar no sale: ya está en la lista con su nombre, y «sin guardar» sería falso", async () => {
    await montar({ ...ACTIVA, sinGuardar: false });
    expect(opciones()).toEqual(["Elige una propuesta…"]);
  });

  test("sin posiciones no sale", async () => {
    await montar({ ...ACTIVA, positions: [] });
    expect(opciones()).toEqual(["Elige una propuesta…"]);
  });

  test("el vacío tiene salida", async () => {
    const onIr = await montar(ACTIVA);
    expect(host.textContent).toContain("Se necesitan dos propuestas");
    await act(async () => irAGuardadas()?.click());
    expect(onIr).toHaveBeenCalledTimes(1);
  });

  test("en Modo cliente no manda a las carteras de los demás", async () => {
    await montar(ACTIVA, true);
    expect(host.textContent).toContain("Se necesitan dos propuestas");
    expect(irAGuardadas()).toBeUndefined();
  });

  describe("con la activa elegida", () => {
    const GUARDADA = { portfolio_id: "g1", name: "Guardada", created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-01T10:00:00.000Z", sourceKind: "LOCAL_MOCK" as const, positions: [{ asset_id: "B", weight_percent: 100 }] };
    const elegir = async (a: string, b: string) => {
      const poner = (etiqueta: string, valor: string) => {
        const campo = selectorDe(`Propuesta ${etiqueta}`);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(campo, valor);
        campo.dispatchEvent(new Event("change", { bubbles: true }));
      };
      await act(async () => poner("A", a));
      await act(async () => poner("B", b));
    };
    const botonDelPdf = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Descargar el informe") as HTMLButtonElement;

    test("el informe no se descarga, y dice por qué: habla de composiciones guardadas", async () => {
      writeLocalPortfoliosToStorage(localStorage, [GUARDADA]);
      await montar(ACTIVA);
      await elegir("cartera-activa", "g1");
      expect(botonDelPdf().disabled).toBe(true);
      expect(host.textContent).toContain("Para descargar el informe, guarda antes la propuesta en curso");
    });

    test("con dos guardadas no sale el aviso", async () => {
      writeLocalPortfoliosToStorage(localStorage, [GUARDADA, { ...GUARDADA, portfolio_id: "g2", name: "Otra" }]);
      await montar({ ...ACTIVA, sinGuardar: false });
      await elegir("g1", "g2");
      expect(botonDelPdf()).toBeTruthy();
      expect(host.textContent).not.toContain("guarda antes la propuesta en curso");
    });

    test("la evolución y las cifras dicen a la vista que son una simulación, y una posición se escribe en singular", async () => {
      writeLocalPortfoliosToStorage(localStorage, [GUARDADA]);
      await montar(ACTIVA);
      await elegir("cartera-activa", "g1");
      const titulos = [...document.querySelectorAll(".panel__head")].map((cabecera) => cabecera.textContent ?? "");
      expect(titulos.find((t) => t.startsWith("Evolución histórica"))).toContain("Simulación con los pesos de hoy");
      expect(titulos.find((t) => t.startsWith("Rentabilidad y riesgo"))).toContain("Simulación con los pesos de hoy");
      expect(document.querySelector(".pcmp-pick .field__hint")?.textContent).toBe("1 posición");
    });
  });
});
