// @vitest-environment happy-dom

/**
 * Lo que promete el rediseño de las pestañas «Propuestas» y «Patrimonial» del Comparador (14-11-2026): el vocabulario
 * (lo que se diseña y se guarda es una propuesta), los campos con su rótulo enlazado, la respuesta arriba y el formato
 * único de las cifras. Cada texto esperado está escrito a mano a partir de la regla y de los datos de la prueba.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
const dobles = vi.hoisted(() => ({ list: vi.fn(), assets: vi.fn(), history: vi.fn(), local: vi.fn(), macro: vi.fn() }));
vi.mock("../src/adapters/portfolioBackend", () => ({ backendListPortfolios: dobles.list, usesBackendPersistence: (kind: string) => kind === "BBDD_LIVE_API" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: dobles.assets }) }));
vi.mock("../src/adapters/portfolioComparisonHistory", () => ({ fetchComparisonHistory: dobles.history }));
vi.mock("../src/core/localPortfolioStorage", () => ({ readLocalPortfoliosFromStorage: dobles.local }));
vi.mock("../src/reports/comparePdf", () => ({ downloadComparisonPdf: vi.fn() }));
vi.mock("../src/charts/oaa", () => ({ OaaLineChart: () => null, OaaRiskReturnChart: () => null, OaaLegend: () => null }));
vi.mock("../src/adapters/macroReferenceBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/macroReferenceBackend")>()),
  fetchMacroReference: dobles.macro
}));

import { PortfolioComparator } from "../src/components/PortfolioComparator";
import { WealthComparator } from "../src/components/WealthComparator";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { ComparisonPeriod } from "../src/core/portfolioComparison";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import { comparisonAssets, comparisonFixture, comparisonPortfolios } from "./support/portfolioComparisonFixtures";

const N = "\u00a0";
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  clearSessionCaches();
  dobles.list.mockResolvedValue(comparisonPortfolios);
  dobles.assets.mockResolvedValue(comparisonAssets);
  dobles.local.mockReturnValue([]);
  dobles.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => comparisonFixture(period, positions[0].asset_id));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** El control que nombra un rótulo, por su `for`: si el rótulo no está enlazado, no hay control. */
function controlDe(rotulo: string) {
  const etiqueta = [...host.querySelectorAll<HTMLLabelElement>("label")].find((l) => (l.textContent ?? "").startsWith(rotulo));
  if (!etiqueta) throw new Error(`Falta el rótulo ${rotulo}`);
  return etiqueta.htmlFor ? (document.getElementById(etiqueta.htmlFor) as HTMLInputElement | HTMLSelectElement | null) : null;
}

/** Los datos de la respuesta, como [rótulo, cifra]. */
const datosDeLaRespuesta = () =>
  [...host.querySelectorAll(".respuesta__dato")].map((dato) => [
    dato.querySelector(".respuesta__rotulo")?.textContent ?? "",
    dato.querySelector(".respuesta__cifra")?.textContent ?? ""
  ]);

describe("Propuestas", () => {
  async function elegidas() {
    await act(async () => root.render(createElement(PortfolioComparator, { sourceKind: "BBDD_LIVE_API" })));
    for (const [rotulo, valor] of [["Propuesta A", "Alfa"], ["Propuesta B", "Beta"]] as const) {
      await act(async () => {
        const campo = controlDe(rotulo) as HTMLSelectElement;
        campo.value = valor;
        campo.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  test("los dos selectores tienen su rótulo enlazado, «Propuesta A» y «Propuesta B», y la pista de cuántas posiciones", async () => {
    await elegidas();
    for (const rotulo of ["Propuesta A", "Propuesta B"]) {
      const control = controlDe(rotulo);
      expect(control?.tagName).toBe("SELECT");
      /* La pista de la elegida, enlazada al control. */
      const pista = document.getElementById(control?.getAttribute("aria-describedby") ?? "");
      expect(pista?.textContent).toBe("2 posiciones");
    }
  });

  test("el vocabulario: propuestas, no carteras, donde se nombra lo que se diseña y se guarda", async () => {
    await elegidas();
    const texto = host.textContent ?? "";
    expect(texto).toContain("Comparativa de propuestas");
    /* Los nombres de las propuestas de la prueba empiezan por «Cartera» («Cartera Alfa»): lo que no debe salir es el rótulo suelto. */
    expect(texto).not.toMatch(/Cartera [AB]\b/);
    for (const viejo of ["Carteras guardadas", "Comparativa de carteras", "Rendimiento y riesgo", "CAGR", "Asignación"]) {
      expect(texto).not.toContain(viejo);
    }
  });

  test("el vacío también habla de propuestas", async () => {
    dobles.list.mockResolvedValue(comparisonPortfolios.slice(0, 1));
    await act(async () => root.render(createElement(PortfolioComparator, { sourceKind: "BBDD_LIVE_API", onIrACarterasGuardadas: () => {} })));
    expect(host.textContent).toContain("Se necesitan dos propuestas");
    expect(host.textContent).toContain("Guarda al menos dos propuestas en Diseño para compararlas aquí.");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Ir a Guardadas");
  });

  test("la respuesta va arriba, antes que el detalle, y dice la diferencia en puntos", async () => {
    await elegidas();
    const respuesta = host.querySelector('[role="group"].respuesta');
    expect(respuesta?.getAttribute("aria-label")).toBe("Rentabilidad anualizada de las dos propuestas · 3 años");
    const evolucion = [...host.querySelectorAll("h2")].find((h) => h.textContent === "Evolución histórica (base 100)")!;
    expect(respuesta!.compareDocumentPosition(evolucion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(datosDeLaRespuesta().map(([rotulo]) => rotulo)).toEqual([
      "Rentabilidad anualizada · Cartera Alfa",
      "Rentabilidad anualizada · Cartera Beta",
      "Diferencia B − A"
    ]);
    /* Rentabilidad con signo y dos decimales; la diferencia, en «pp» con signo. */
    const [[, a], [, b], [, diferencia]] = datosDeLaRespuesta();
    expect(a).toMatch(/^[+−]\d+,\d{2}\u00a0%$/);
    expect(b).toMatch(/^[+−]\d+,\d{2}\u00a0%$/);
    expect(diferencia).toMatch(/^[+−]\d+,\d{2}\u00a0pp$/);
  });

  test("los pesos, con un decimal: Alfa es 80 de A (global) y 20 de liquidez (Europa); Beta, 80 de B y 20 de liquidez, las dos en Europa", async () => {
    await elegidas();
    const filas = [...host.querySelectorAll(".pcmp-allocation-label")].map((fila) => fila.textContent);
    expect(filas).toContain(`Global80,0${N}% · 0,0${N}%`);
    expect(filas).toContain(`Europa20,0${N}% · 100,0${N}%`);
    const pesoMedido = [...host.querySelectorAll(".pcmp-metrics-table tbody tr")].find((fila) => fila.firstElementChild?.textContent === "Peso medido");
    expect([...pesoMedido!.children].map((celda) => celda.textContent)).toEqual(["Peso medido", `100,0${N}%`, `100,0${N}%`, ""]);
  });
});

describe("Patrimonial", () => {
  /* Del ejemplo: 50.000 € el 15/01/2021 y 20.000 € el 15/06/2023, valor final 95.000 € el 04/11/2026. */
  const RESPUESTA = {
    inflation_annual_pct: 4,
    letras_avg_rate_pct: 2,
    comparison: {
      cartera: { valor_final_bruto: 95000, valor_final_neto: 85175, tir_nominal_bruta_pct: 6.11, tir_nominal_neta_pct: 4.98, tir_real_bruta_pct: 2.66, tir_real_neta_pct: 1.5 },
      letras: { valor_final_bruto: 78000, valor_final_neto: 54985, tir_nominal_bruta_pct: 2, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 },
      deposito: { valor_final_bruto: 76000, valor_final_neto: 53000, tir_nominal_bruta_pct: 1, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 }
    }
  };
  const pulsar = async (nombre: string) => {
    const boton = [...host.querySelectorAll("button")].find((b) => b.textContent === nombre);
    if (!boton) throw new Error(nombre);
    await act(async () => boton.click());
  };

  test("los campos tienen su rótulo enlazado, y el error del tipo del depósito se enlaza a su campo", async () => {
    await act(async () => root.render(createElement(WealthComparator)));
    expect(controlDe("Valor final (€)")).not.toBeNull();
    expect(controlDe("Fecha final")?.getAttribute("type")).toBe("date");
    const tipo = controlDe("Tipo del depósito (% anual)") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(tipo, "30");
      tipo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(tipo.getAttribute("aria-invalid")).toBe("true");
    const descripciones = (tipo.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(descripciones).toContain(`Introduce un tipo entre −5${N}% y 25${N}%.`);
    /* La casilla de la fiscalidad, con su nombre. */
    expect(host.querySelector("fieldset legend")?.textContent).toBe("Fiscalidad");
    expect(host.querySelector('input[type="checkbox"]')?.closest("label")?.textContent).toBe("Neto de impuestos (Bizkaia)");
  });

  test("la respuesta arriba: la TIR de la cartera y cuántos puntos saca a Letras y al depósito", async () => {
    dobles.macro.mockResolvedValue(RESPUESTA);
    await act(async () => root.render(createElement(WealthComparator)));
    await pulsar("Cargar ejemplo");
    await pulsar("Calcular inflación, Letras y depósito");
    const respuesta = host.querySelector(".respuesta");
    expect(respuesta?.getAttribute("aria-label")).toBe("La TIR de la cartera frente a las alternativas");
    /* Antes que el formulario. */
    expect(respuesta!.compareDocumentPosition(host.querySelector(".wealth-grid")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* 6,11 − 2 = 4,11 puntos frente a Letras; 6,11 − 1 = 5,11 frente al depósito. Capital: 50.000 + 20.000. */
    expect(datosDeLaRespuesta()).toEqual([
      ["TIR nominal bruta", `+6,11${N}%`],
      ["Frente a Letras del Tesoro", `+4,11${N}pp`],
      ["Frente al depósito", `+5,11${N}pp`],
      ["Capital aportado", `70.000${N}€`],
      ["Valor final bruto", `95.000${N}€`],
      ["Horizonte", "5,8 años"]
    ]);
    /* En la tabla, los importes con sus dos decimales y la TIR con su signo. */
    const cartera = [...host.querySelectorAll("tr")].find((fila) => fila.textContent?.startsWith("Cartera introducida"));
    expect(cartera?.textContent).toContain(`95.000,00${N}€`);
    expect(cartera?.textContent).toContain(`+6,11${N}%`);
    /* La ventaja frente a Letras es un resultado en euros: 95.000 − 78.000, con su signo. */
    expect(host.textContent).toContain(`Ventaja frente a Letras bruta+17.000${N}€`);
  });

  /* Tres de sus seis cifras son importes: al declararlo, la cifra mengua lo justo para que un importe de siete cifras
     no se parta en la columna más estrecha (18-11-2026: a 1.920 se partía, y la regla está en `components.css`). */
  test("la tira de indicadores declara que lleva importes", async () => {
    dobles.macro.mockResolvedValue(RESPUESTA);
    await act(async () => root.render(createElement(WealthComparator)));
    await pulsar("Cargar ejemplo");
    await pulsar("Calcular inflación, Letras y depósito");
    const tira = [...host.querySelectorAll(".ui-kpi-strip")].find((t) => t.textContent?.includes("Inflación anual (IPC)"));
    expect(tira?.classList.contains("ui-kpi-strip--importes")).toBe(true);
  });

  test("una aportación posterior a la fecha final se dice en un aviso, con las fechas en día, mes y año", async () => {
    await act(async () => root.render(createElement(WealthComparator)));
    await pulsar("Cargar ejemplo");
    const fecha = controlDe("Fecha final") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(fecha, "2020-01-01");
      fecha.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const aviso = host.querySelector(".aviso--aviso[role='status']");
    expect(aviso?.textContent).toContain("La aportación del 15/06/2023 es posterior a la fecha final (01/01/2020).");
    expect(host.textContent).not.toContain("N/D");
  });
});
