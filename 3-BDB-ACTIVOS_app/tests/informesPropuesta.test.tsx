// @vitest-environment happy-dom

/**
 * «Propuesta de mejora» en Informes: un cálculo que no encontró nada se guarda igual, y no es una propuesta. Comprobado
 * en la revisión: el botón descargaba un papel con la hoja casi vacía y «Por qué cada cambio» sin ningún cambio.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildManualPortfolioReport, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import * as horizonte from "../src/adapters/portfolioHorizon";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { AppError } from "../src/core/appError";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { disenoEnSesion } from "../src/core/disenoEnSesion";
import { saveImprovementResult } from "../src/core/improvementResultStore";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { clearSessionCaches } from "../src/core/sessionCaches";

const POSICIONES = [
  { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
  { asset_id: "MOCK-ETF-CASH", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

async function montar(extra: Record<string, unknown> = {}) {
  const report = await buildManualPortfolioReport(POSICIONES, "Cartera prueba");
  const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
  const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
  await act(async () => {
    root.render(
      createElement(ClientModeProvider, {
        initialValue: false,
        children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility, ...extra })
      })
    );
  });
}

/* La propuesta de mejora se descarga sin diálogo; desde el 21-11-2026 su botón dice «Preparar», como los otros cinco (I3), y su
   nombre accesible, cuál. */
const botonDeLaPropuesta = () => host.querySelector('button[aria-label="Preparar: Propuesta de mejora"]') as HTMLButtonElement;
const guardarResultado = (proposals: unknown[]) =>
  saveImprovementResult(POSICIONES, { response: { status: proposals.length ? "PROPOSAL" : "NO_IMPROVEMENT", proposals } as never, proposalIndex: 0, assets: {}, equivalence: {}, skipped: [] });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

describe("Informes · el informe de cliente con 0 % medido (decisión 105)", () => {
  const FRASE = "No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición de la cartera.";
  const pulsar = async (dentroDe: Element, texto: string) => {
    const boton = [...dentroDe.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement;
    await act(async () => boton.click());
    await act(async () => { await new Promise((hecho) => setTimeout(hecho, 0)); });
    return boton;
  };
  const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement;
  /* En la lista, «Preparar» abre el diálogo; dentro, «Descargar el informe». */
  const abrir = async () => {
    await act(async () => (host.querySelector('button[aria-label="Preparar: Informe de la propuesta"]') as HTMLButtonElement).click());
  };
  const abrirYPedir = async () => {
    await abrir();
    await pulsar(dialogo(), "Descargar el informe");
  };
  const montarEn = async (modoCliente: boolean) => {
    const report = await buildManualPortfolioReport(POSICIONES, "Cartera prueba");
    const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
    const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
    await act(async () => {
      root.render(createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility }) }));
    });
  };
  const sinDatos = () => new AppError("BACKEND", "La operación no se puede ejecutar en el estado actual de los datos.", { cause: { code: "functions/failed-precondition" }, detail: "No hay histórico completo de 3 años ni referencias validadas. [400]" });

  afterEach(() => vi.restoreAllMocks());

  test("dentro del diálogo, con el motivo y sin «Reintentar»; y no deja insistir", async () => {
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockRejectedValue(sinDatos());
    await montarEn(false);
    await abrirYPedir();
    expect(dialogo().textContent).toContain(FRASE);
    expect(dialogo().textContent).toContain("Motivo: No hay histórico completo de 3 años ni referencias validadas.");
    expect(dialogo().textContent).not.toContain("[400]");
    expect(document.body.textContent).not.toContain("Reintentar");
    expect(document.body.textContent).not.toContain("Reinténtalo");
    expect(([...dialogo().querySelectorAll("button")].find((b) => b.textContent?.trim() === "Descargar el informe") as HTMLButtonElement).disabled).toBe(true);
    /* Y detrás, en la página, nada: el aviso está en el único sitio donde se lee. */
    expect(host.textContent).not.toContain(FRASE);
  });

  test("en Modo cliente, la misma frase sin el motivo", async () => {
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockRejectedValue(sinDatos());
    await montarEn(true);
    await abrirYPedir();
    expect(dialogo().textContent).toContain(FRASE);
    expect(dialogo().textContent).not.toContain("Motivo");
    expect(dialogo().textContent).not.toContain("histórico completo");
  });

  test("un fallo de verdad sigue pidiendo que se reintente, y se lee dentro del diálogo", async () => {
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockRejectedValue(new AppError("NETWORK", "No hay conexión con el servidor. Comprueba la red y reinténtalo.", { cause: { code: "functions/unavailable" } }));
    await montarEn(false);
    await abrirYPedir();
    expect(dialogo().textContent).toContain("No se pudo generar el PDF del informe. Reinténtalo en unos segundos.");
    expect([...dialogo().querySelectorAll("button")].some((b) => b.textContent === "Reintentar")).toBe(true);
    expect(dialogo().textContent).not.toContain(FRASE);
    expect(([...dialogo().querySelectorAll("button")].find((b) => b.textContent?.trim() === "Descargar el informe") as HTMLButtonElement).disabled).toBe(false);
  });

  test("cerrar el diálogo se lleva el aviso", async () => {
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockRejectedValue(sinDatos());
    await montarEn(false);
    await abrirYPedir();
    await pulsar(dialogo(), "Cancelar");
    await abrir();
    expect(dialogo().textContent).not.toContain(FRASE);
  });
});

describe("la propuesta de mejora, solo si hay propuesta", () => {
  test("sin calcular, falta calcularla", async () => {
    await montar();
    expect(botonDeLaPropuesta().disabled).toBe(true);
    expect(host.textContent).toContain("Falta calcularla en Diseño, en Optimizar.");
  });

  test("el cálculo que no encontró nada no se descarga, y lo dice", async () => {
    guardarResultado([]);
    await montar();
    expect(botonDeLaPropuesta().disabled).toBe(true);
    expect(host.textContent).toContain("El último cálculo no encontró sustituciones: no hay propuesta que descargar.");
  });

  test("con propuesta, se descarga", async () => {
    guardarResultado([{ substitutions: [] }]);
    await montar();
    expect(botonDeLaPropuesta().disabled).toBe(false);
    expect(host.textContent).not.toContain("no encontró sustituciones");
  });

  test("la frase nombra el panel que existe", async () => {
    await montar();
    expect(host.textContent).toContain("«Fondos equivalentes»");
    expect(host.textContent).not.toContain("Mejorar cartera");
  });
});

describe("«Fijar en Diseño»", () => {
  test("lleva a Componer, que es donde está el campo del capital", async () => {
    disenoEnSesion.write({ ...disenoEnSesion.read(), step: "simulate" });
    const onIrADiseno = vi.fn();
    await montar({ onIrADiseno });
    await act(async () => {
      ([...host.querySelectorAll("button")].find((b) => b.textContent === "Fijar en Diseño") as HTMLButtonElement).click();
    });
    expect(onIrADiseno).toHaveBeenCalledTimes(1);
    expect(disenoEnSesion.read().step).toBe("compose");
  });
});
