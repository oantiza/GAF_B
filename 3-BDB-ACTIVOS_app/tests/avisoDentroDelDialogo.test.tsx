// @vitest-environment happy-dom

/**
 * El aviso de un informe que no sale se lee dentro de su diálogo (decisión 105, lote T7), en los dos que quedaban:
 *
 * - **La Comparativa de carteras pedida desde Informes.** Con una cartera a 0 % medido decía «No se ha podido completar» y «Reintentar», que
 *   es lo que la 105 quitó del informe de cliente. Ahora, la frase de la 105 diciendo cuál de las dos, y el motivo del servidor; en Modo
 *   cliente, sin el motivo. Un fallo de verdad sigue con «Reintentar».
 * - **El informe interno.** Si fallaba, su aviso quedaba detrás del diálogo, difuminado. Ahora va dentro, con la misma pieza.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));

const interno = vi.hoisted(() => ({ descargar: vi.fn() }));
vi.mock("../src/reports/internalPortfolioReportPdf", () => ({ downloadInternalPortfolioReportPdf: interno.descargar }));

import { buildManualPortfolioReport, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import * as historia from "../src/adapters/portfolioComparisonHistory";
import * as horizonte from "../src/adapters/portfolioHorizon";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { DialogoDeComparativa } from "../src/components/DialogoDeComparativa";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { AppError } from "../src/core/appError";
import { eleccionDeCarteras, sinMedidaEnLaComparativa } from "../src/core/comparacionDeCarteras";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const MOTIVO = "No hay activos con precios EUR válidos para el análisis.";
/* Lo que devuelve `callBackend` cuando el servidor contesta `failed-precondition`: el código en la causa y su texto en el detalle. */
const sinDatos = () =>
  new AppError("BACKEND", "La operación no se puede ejecutar en el estado actual de los datos.", { cause: { code: "functions/failed-precondition" }, detail: `${MOTIVO} [400]` });
const sinRed = () => new AppError("NETWORK", "No hay conexión con el servidor. Comprueba la red y reinténtalo.", { cause: { code: "functions/unavailable" } });

let root: Root;
let host: HTMLDivElement;
const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement;
const boton = (dentroDe: ParentNode, texto: string) =>
  [...dentroDe.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
/* Rediseño (14-11-2026): en la lista de Informes, el botón de un documento con diálogo dice «Preparar», y su nombre accesible, cuál. */
async function preparar(documento: string) {
  const elBoton = host.querySelector(`button[aria-label="Preparar: ${documento}"]`) as HTMLButtonElement | null;
  if (!elBoton) throw new Error(`No hay botón para preparar «${documento}»`);
  await act(async () => elBoton.click());
}
async function pulsar(dentroDe: ParentNode, texto: string) {
  const elBoton = boton(dentroDe, texto);
  if (!elBoton) throw new Error(`No hay botón «${texto}»`);
  await act(async () => elBoton.click());
  await act(async () => { await new Promise((hecho) => setTimeout(hecho, 0)); });
}

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
  vi.restoreAllMocks();
  interno.descargar.mockReset();
  vi.unstubAllGlobals();
});

describe("la frase de la Comparativa de carteras, con cuál de las dos", () => {
  test("una, la otra o las dos; y el motivo una vez si dicen lo mismo", () => {
    const base = "No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición";
    expect(sinMedidaEnLaComparativa({ sinMedida: false }, { sinMedida: false })).toBeNull();
    expect(sinMedidaEnLaComparativa({ sinMedida: false, motivo: "x" }, { sinMedida: true, motivo: MOTIVO })).toEqual({ frase: `${base} de la cartera B.`, motivo: MOTIVO });
    expect(sinMedidaEnLaComparativa({ sinMedida: true, motivo: MOTIVO }, { sinMedida: false })).toEqual({ frase: `${base} de la cartera A.`, motivo: MOTIVO });
    expect(sinMedidaEnLaComparativa({ sinMedida: true, motivo: MOTIVO }, { sinMedida: true, motivo: MOTIVO })).toEqual({ frase: `${base} de la cartera A ni de la B.`, motivo: MOTIVO });
    expect(sinMedidaEnLaComparativa({ sinMedida: true, motivo: "uno." }, { sinMedida: true, motivo: "otro." })).toEqual({ frase: `${base} de la cartera A ni de la B.`, motivo: "A: uno. B: otro." });
    expect(sinMedidaEnLaComparativa({ sinMedida: true }, { sinMedida: false })).toEqual({ frase: `${base} de la cartera A.`, motivo: undefined });
  });
});

describe("Informes · Comparativa de carteras con 0 % medido", () => {
  const MUESTRA: BdbSavedLocalPortfolio = { portfolio_id: "m", name: "Muestra", created_at: "", updated_at: "", sourceKind: "LOCAL_MOCK", positions: [{ asset_id: "MOCK-FUND-MIXED", weight_percent: 100 }] };
  const SOLO: BdbSavedLocalPortfolio = { portfolio_id: "v", name: "Vanguard solo", created_at: "", updated_at: "", sourceKind: "LOCAL_MOCK", positions: [{ asset_id: "MOCK-ETF-CASH", weight_percent: 100 }] };
  /* Cada cartera, lo suyo: las que se nombran no miden nada, las demás dan una historia (que aquí no hace falta que sea completa). */
  const conHistorias = (sinMedida: string[], fallo?: () => unknown) =>
    vi.spyOn(historia, "fetchComparisonHistory").mockImplementation(async (positions) => {
      if (fallo) throw fallo();
      if (sinMedida.includes(positions[0].asset_id)) throw sinDatos();
      return {} as never;
    });
  async function montar({ a = MUESTRA, b = SOLO, modoCliente = false } = {}) {
    eleccionDeCarteras.write({ a: a.portfolio_id, b: b.portfolio_id });
    await act(async () => {
      root.render(createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(DialogoDeComparativa, { carteras: [MUESTRA, SOLO], sourceKind: "LOCAL_MOCK", onClose: () => {} }) }));
    });
    await pulsar(dialogo(), "Descargar el informe");
  }
  const FRASE_B = "No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición de la cartera B.";

  test("dentro del diálogo, con cuál y el motivo del servidor; sin «Reintentar», y no deja insistir", async () => {
    conHistorias(["MOCK-ETF-CASH"]);
    await montar();
    const texto = dialogo().textContent ?? "";
    expect(texto).toContain(FRASE_B);
    expect(texto).toContain(`Motivo: ${MOTIVO}`);
    expect(texto).not.toContain("[400]");
    expect(texto).not.toContain("No se ha podido completar");
    expect(boton(dialogo(), "Reintentar")).toBeUndefined();
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(true);
  });

  test("si es la A, dice la A; si son las dos, las dos, y el motivo una vez", async () => {
    conHistorias(["MOCK-ETF-CASH"]);
    await montar({ a: SOLO, b: MUESTRA });
    expect(dialogo().textContent).toContain("no mide ninguna posición de la cartera A.");
    await act(async () => root.unmount());
    root = createRoot(host);
    vi.restoreAllMocks();
    conHistorias(["MOCK-ETF-CASH", "MOCK-FUND-MIXED"]);
    await montar();
    const texto = dialogo().textContent ?? "";
    expect(texto).toContain("no mide ninguna posición de la cartera A ni de la B.");
    expect(texto.split("Motivo:").length - 1).toBe(1);
  });

  test("en Modo cliente, la frase sin el motivo", async () => {
    conHistorias(["MOCK-ETF-CASH"]);
    await montar({ modoCliente: true });
    const texto = dialogo().textContent ?? "";
    expect(texto).toContain(FRASE_B);
    expect(texto).not.toContain("Motivo");
    expect(texto).not.toContain(MOTIVO);
  });

  test("un fallo de verdad sigue pidiendo que se reintente, dentro del diálogo", async () => {
    conHistorias([], sinRed);
    await montar();
    const texto = dialogo().textContent ?? "";
    expect(texto).toContain("No hay conexión con el servidor");
    expect(texto).not.toContain("no mide ninguna posición");
    expect(boton(dialogo(), "Reintentar")).toBeDefined();
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(false);
  });

  test("otro periodo puede poderse: cambiarlo se lleva el aviso y enciende el botón", async () => {
    conHistorias(["MOCK-ETF-CASH"]);
    await montar();
    await pulsar(dialogo(), "5 años");
    expect(dialogo().textContent).not.toContain(FRASE_B);
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(false);
  });
});

describe("Informes · el diálogo del informe interno", () => {
  const POSICIONES = [
    { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
    { asset_id: "MOCK-ETF-CASH", weight_percent: 40 }
  ];
  async function abrirYPedir() {
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockRejectedValue(new Error("sin análisis en la prueba"));
    const report = await buildManualPortfolioReport(POSICIONES, "Cartera prueba");
    const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
    const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
    await act(async () => {
      root.render(createElement(ClientModeProvider, { initialValue: false, children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility }) }));
    });
    await preparar("Informe interno del asesor");
    await pulsar(dialogo(), "Descargar el informe");
    await act(async () => { await new Promise((hecho) => setTimeout(hecho, 0)); });
  }

  test("un fallo de verdad se lee dentro, con «Reintentar», y detrás no queda nada", async () => {
    interno.descargar.mockRejectedValue(new Error("Fallo al dibujar el documento."));
    await abrirYPedir();
    expect(dialogo().textContent).toContain("No se pudo generar el informe interno. Reinténtalo en unos segundos.");
    expect(boton(dialogo(), "Reintentar")).toBeDefined();
    expect(host.textContent).not.toContain("No se pudo generar el informe interno");
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(false);
  });

  test("si el servidor dijera que los datos no dan, dice por qué y no deja insistir", async () => {
    interno.descargar.mockRejectedValue(Object.assign(new Error(`${MOTIVO} [400]`), { code: "functions/failed-precondition" }));
    await abrirYPedir();
    const texto = dialogo().textContent ?? "";
    expect(texto).toContain("No se puede generar este informe con los datos de hoy.");
    expect(texto).toContain(`Motivo: ${MOTIVO}`);
    expect(texto).not.toContain("[400]");
    expect(texto).not.toContain("no mide ninguna posición");
    expect(boton(dialogo(), "Reintentar")).toBeUndefined();
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(true);
  });

  test("mientras se prepara se puede cancelar: no se descarga nada, y el siguiente intento empieza limpio (INF-4)", async () => {
    /* Un análisis que no contesta, como el servidor cuando tarda: solo acaba si se le deja de esperar. */
    const senales: AbortSignal[] = [];
    vi.spyOn(horizonte, "fetchPortfolioHorizon").mockImplementation((_posiciones, _ventana, signal) => {
      senales.push(signal as AbortSignal);
      return new Promise((_ok, falla) => signal?.addEventListener("abort", () => falla(new DOMException("La solicitud ya no es necesaria.", "AbortError"))));
    });
    const report = await buildManualPortfolioReport(POSICIONES, "Cartera prueba");
    const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
    const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
    await act(async () => {
      root.render(createElement(ClientModeProvider, { initialValue: false, children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility }) }));
    });
    await preparar("Informe interno del asesor");
    await pulsar(dialogo(), "Descargar el informe");
    /* Esperando: dos análisis pedidos (3 y 5 años), el botón dice que prepara y «Cancelar» sigue vivo. */
    expect(senales).toHaveLength(2);
    expect(boton(dialogo(), "Preparando…")).toBeDefined();
    expect(boton(dialogo(), "Cancelar")?.disabled).toBe(false);
    await pulsar(dialogo(), "Cancelar");
    expect(senales.every((s) => s.aborted)).toBe(true);
    expect(dialogo()).toBeNull();
    expect(interno.descargar).not.toHaveBeenCalled();
    /* Se puede volver a abrir, sin aviso y sin quedarse en «Preparando…». */
    await preparar("Informe interno del asesor");
    expect(dialogo().textContent).not.toContain("No se pudo generar el informe interno");
    expect(boton(dialogo(), "Descargar el informe")?.disabled).toBe(false);
  });

  test("cerrar el diálogo se lleva el aviso", async () => {
    interno.descargar.mockRejectedValue(new Error("Fallo al dibujar el documento."));
    await abrirYPedir();
    await pulsar(dialogo(), "Cancelar");
    await preparar("Informe interno del asesor");
    expect(dialogo().textContent).not.toContain("No se pudo generar el informe interno");
  });
});
