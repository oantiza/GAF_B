// @vitest-environment happy-dom

/**
 * Informes · la referencia más cercana al nivel de la cartera (decisión C-26). Es una propuesta visible: no cambia la
 * referencia elegida hasta que el asesor pulsa, y en Modo cliente no se enseña.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildManualPortfolioReport, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import { BenchmarkProvider } from "../src/app/BenchmarkContext";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { clearSessionCaches } from "../src/core/sessionCaches";

const POSICIONES = [
  { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
  { asset_id: "MOCK-ETF-CASH", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

async function montar({ nivel, referencia = "equilibrado", modoCliente = false }: { nivel?: number; referencia?: string; modoCliente?: boolean }) {
  const report = await buildManualPortfolioReport(POSICIONES, "Cartera prueba");
  const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
  const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
  await act(async () => {
    root.render(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(BenchmarkProvider, {
          initialValue: referencia,
          children: createElement(PortfolioReport, {
            report,
            originalPositions: POSICIONES,
            assets,
            feasibility,
            perfilYHorizonte: nivel === undefined ? undefined : { risk_profile_level: nivel }
          })
        })
      })
    );
  });
}

const propuesta = () => [...host.querySelectorAll("p.field__hint")].find((p) => p.textContent?.includes("la referencia más cercana"));
const botonDeLaPropuesta = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Usar ")) as HTMLButtonElement | undefined;
/* Rediseño: el selector va dentro de la pieza `Campo`, que lo nombra con su rótulo. */
const referenciaElegida = () =>
  ([...host.querySelectorAll("label")].find((label) => label.textContent === "Cartera de referencia")!.control as HTMLSelectElement).value;
const lineaSinEspacios = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Informes · propuesta de la cartera de referencia (C-26)", () => {
  test("con nivel y una referencia distinta: la línea y el botón, y el botón cambia la referencia", async () => {
    await montar({ nivel: 7, referencia: "agresivo" });
    expect(lineaSinEspacios(propuesta())).toContain("Para el nivel 7 (Dinámico), la referencia más cercana en renta variable es Equilibrado.");
    expect(botonDeLaPropuesta()?.textContent).toBe("Usar Equilibrado");
    /* Proponer no cambia nada: la elegida sigue siendo la del asesor hasta que pulsa. */
    expect(referenciaElegida()).toBe("agresivo");
    await act(async () => botonDeLaPropuesta()!.click());
    expect(referenciaElegida()).toBe("equilibrado");
    expect(propuesta()).toBeUndefined();
  });

  test("no dice que la cartera tenga ese porcentaje de renta variable", async () => {
    await montar({ nivel: 9, referencia: "equilibrado" });
    expect(propuesta()?.textContent).toContain("Dinámico");
    expect(propuesta()?.textContent).not.toMatch(/%/);
  });

  test("sin nivel no sale nada", async () => {
    await montar({ referencia: "agresivo" });
    expect(propuesta()).toBeUndefined();
    expect(botonDeLaPropuesta()).toBeUndefined();
  });

  test("si la más cercana ya es la elegida, no sale nada", async () => {
    await montar({ nivel: 6, referencia: "equilibrado" });
    expect(propuesta()).toBeUndefined();
    expect(botonDeLaPropuesta()).toBeUndefined();
  });

  test("en Modo cliente no sale: es trabajo del asesor", async () => {
    await montar({ nivel: 7, referencia: "agresivo", modoCliente: true });
    expect(propuesta()).toBeUndefined();
    expect(botonDeLaPropuesta()).toBeUndefined();
  });
});
