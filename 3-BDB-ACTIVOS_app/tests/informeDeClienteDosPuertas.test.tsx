// @vitest-environment happy-dom

/**
 * ANA-01 (auditoría de frontend, 13-11-2026): el informe de cliente tiene dos puertas, Informes y Análisis, y cada una le montaba la
 * entrada por su cuenta. Informes ponía en cada posición la réplica de su ficha y Análisis no, así que el mismo PDF explicaba el
 * solapamiento de un ETF sintético de dos maneras. Aquí se descarga desde las dos con la misma cartera —un ETF de réplica sintética y
 * dos fondos— y se compara lo que recibe el generador.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));

const pdf = vi.hoisted(() => ({ cliente: vi.fn(async () => undefined) }));

const POSICIONES = [
  { asset_id: "ETF-SINT", weight_percent: 40 },
  { asset_id: "FONDO-A", weight_percent: 30 },
  { asset_id: "FONDO-B", weight_percent: 30 }
];

const fila = (asset_id: string, display_name: string, instrument_type: string, weight_percent: number) => ({
  asset_id,
  display_name,
  instrument_type,
  economic_asset_class: "EQUITY",
  currency: "EUR",
  coverage_status: "COMPLETE",
  weight_percent,
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: [],
  pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
});

const datos = vi.hoisted(() => ({
  report: null as unknown,
  assets: [] as unknown[]
}));

datos.report = {
  portfolio_name: "Cartera de prueba",
  mode: "LOCAL_MOCK",
  /* El total es el de la cartera, 40 + 30 + 30: sin cuadrar, el informe de cliente no se genera (INF-1). */
  summary: { total_weight_percent: 100, weighted_metrics: {}, non_investable_assets: [], warnings: [] },
  xray: {},
  positions: [fila("ETF-SINT", "ETF sintético", "ETF", 40), fila("FONDO-A", "Fondo A", "FUND", 30), fila("FONDO-B", "Fondo B", "FUND", 30)],
  warnings: [],
  data_diagnostic: { top_warnings: [] }
};
const ficha = (asset_id: string, display_name: string, instrument_type: string, extra: Record<string, unknown> = {}) => ({
  ...fila(asset_id, display_name, instrument_type, 0),
  warnings: [],
  metrics: {},
  ...extra
});
datos.assets = [
  ficha("ETF-SINT", "ETF sintético", "ETF", { product_profile: { replication: "SYNTHETIC" } }),
  ficha("FONDO-A", "Fondo A", "FUND"),
  ficha("FONDO-B", "Fondo B", "FUND")
];

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    buildManualPortfolioReport: async () => datos.report,
    getComparableAssets: async () => datos.assets,
    buildManualPortfolioSummary: async () => ({}),
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => ({})
  })
}));
vi.mock("../src/adapters/portfolioHorizon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/portfolioHorizon")>()),
  fetchPortfolioHorizon: async () => ({})
}));
vi.mock("../src/reports/informeDeClientePdf", () => ({ downloadInformeDeClientePdf: pdf.cliente, rentabilidadPorDividendoDe: () => ({}) }));
// Lo visual de Análisis no interviene: testigos vacíos.
vi.mock("../src/components/PortfolioXray", () => ({ PortfolioXray: () => null, ComposicionSubyacente: () => null, MayoresAcciones: () => null }));
vi.mock("../src/components/XrayMetricsStyle", () => ({ XrayMetricsStyle: () => null }));
vi.mock("../src/components/RegionAllocation", () => ({ RegionAllocation: () => null }));
vi.mock("../src/components/XrayAdvanced", () => ({ XrayAdvanced: () => null }));
vi.mock("../src/components/SaludYControl", () => ({ SaludYControl: () => null }));
vi.mock("../src/components/ComposicionDeLaCartera", () => ({ ComposicionDeLaCartera: () => null }));
vi.mock("../src/components/PortfolioDataDiagnostic", () => ({ PortfolioDataDiagnostic: () => null }));
vi.mock("../src/components/PortfolioReportWarnings", () => ({ PortfolioReportWarnings: () => null }));
vi.mock("../src/components/BenchmarkSelect", () => ({ BenchmarkSelect: () => null }));

import { XrayPage } from "../src/pages/XrayPage";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { viabilidadDelInforme } from "../src/core/reportPipeline";
import type { InformeDeClientePdfInput } from "../src/reports/informeDeClientePdf";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function boton(texto: string, dentro: ParentNode = document): HTMLButtonElement {
  const encontrado = [...dentro.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === texto);
  if (!encontrado) throw new Error(`No aparece el botón «${texto}»`);
  return encontrado as HTMLButtonElement;
}

const pulsar = (elemento: HTMLElement) => act(async () => {
  elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
const esperar = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

async function descargarDesdeAnalisis(modoCliente: boolean): Promise<InformeDeClientePdfInput> {
  await act(async () => {
    root.render(createElement(ClientModeProvider, {
      initialValue: modoCliente,
      children: createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", totalCapital: 100000, portfolioName: "Cartera de prueba", onBack: () => undefined })
    }));
  });
  await esperar();
  await pulsar(boton("Informe de la propuesta"));
  await pulsar(boton("Descargar el informe", document.querySelector('[role="dialog"]')!));
  await esperar();
  expect(pdf.cliente).toHaveBeenCalledTimes(1);
  return (pdf.cliente.mock.calls[0] as unknown as [InformeDeClientePdfInput])[0];
}

async function descargarDesdeInformes(modoCliente: boolean): Promise<InformeDeClientePdfInput> {
  const assets = datos.assets as BdbAssetDetail[];
  await act(async () => {
    root.render(createElement(ClientModeProvider, {
      initialValue: modoCliente,
      children: createElement(PortfolioReport, {
        report: datos.report as BdbPortfolioReport,
        originalPositions: POSICIONES,
        assets,
        feasibility: viabilidadDelInforme({ positions: POSICIONES, assets }),
        totalCapital: 100000,
        portfolioName: "Cartera de prueba"
      })
    }));
  });
  await esperar();
  /* Rediseño: en la lista de Informes el botón de un documento con diálogo dice «Preparar». */
  await pulsar(document.querySelector('button[aria-label="Preparar: Informe de la propuesta"]') as HTMLButtonElement);
  await pulsar(boton("Descargar el informe", document.querySelector('[role="dialog"]')!));
  await esperar();
  expect(pdf.cliente).toHaveBeenCalledTimes(1);
  return (pdf.cliente.mock.calls[0] as unknown as [InformeDeClientePdfInput])[0];
}

beforeEach(() => {
  pdf.cliente.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("informe de cliente: las dos puertas entregan la misma entrada (ANA-01)", () => {
  test("con un ETF sintético y dos fondos, Análisis e Informes pasan las mismas posiciones, con la réplica del ETF", async () => {
    const desdeAnalisis = await descargarDesdeAnalisis(false);
    act(() => root.unmount());
    root = createRoot(host);
    pdf.cliente.mockClear();
    const desdeInformes = await descargarDesdeInformes(false);

    const replicas = (entrada: InformeDeClientePdfInput) => entrada.report.positions.map((p) => [p.asset_id, (p as { replica?: string }).replica]);
    expect(replicas(desdeInformes)).toEqual([["ETF-SINT", "SYNTHETIC"], ["FONDO-A", undefined], ["FONDO-B", undefined]]);
    expect(replicas(desdeAnalisis)).toEqual(replicas(desdeInformes));
    expect(desdeAnalisis.report.positions).toEqual(desdeInformes.report.positions);
    /* 14-11-2026 (los ETF no se quedan fuera del solapamiento): las dos puertas miden el solapamiento con las cargas de la pantalla
       y se lo dan al papel ya medido, sobre las mismas posiciones. Antes ninguna lo pasaba y el papel lo calculaba por su cuenta. */
    expect(desdeAnalisis.overlap?.positions.map((posicion) => posicion.asset_id)).toEqual(["ETF-SINT", "FONDO-A", "FONDO-B"]);
    expect(desdeInformes.overlap).toEqual(desdeAnalisis.overlap);
  });

  test("las dos le dicen al generador el Modo cliente, y el resto de la entrada coincide", async () => {
    const desdeAnalisis = await descargarDesdeAnalisis(true);
    act(() => root.unmount());
    root = createRoot(host);
    pdf.cliente.mockClear();
    const desdeInformes = await descargarDesdeInformes(true);

    expect(desdeAnalisis.clientMode).toBe(true);
    expect(desdeInformes.clientMode).toBe(true);
    for (const campo of ["clientMode", "totalCapital", "benchmarkId", "banker", "clientName", "regionRows", "rentabilidadPorDividendo", "feasibility", "lockedWeights"] as const) {
      expect(desdeAnalisis[campo], campo).toEqual(desdeInformes[campo]);
    }
    expect(desdeAnalisis.report.portfolio_name).toBe(desdeInformes.report.portfolio_name);
  });

  /* ANA-12, rediseño (14-11-2026): ya no son dos diálogos parecidos, es uno solo (`DialogoDelInformeDeCliente`). Las dos puertas
     enseñan los mismos campos con los mismos rótulos; la firma no se pide en ninguna, se enseña en una línea con «Cambiar». */
  test("sin nombre, las dos puertas enseñan el mismo diálogo: los mismos campos, y el nombre se pide igual y se guarda", async () => {
    const rotulos = () => [...document.querySelectorAll('[role="dialog"] .field__label')].map((nodo) => (nodo.textContent ?? "").trim());
    const nombrar = async (valor: string) => {
      const etiqueta = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((label) => label.textContent === "Nombre de la propuesta")!;
      const campo = etiqueta.control as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const alCambiarElNombre = vi.fn();

    await act(async () => {
      root.render(createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", onBack: () => undefined, onPortfolioNameChange: alCambiarElNombre }));
    });
    await esperar();
    await pulsar(boton("Informe de la propuesta"));
    const enAnalisis = rotulos();
    expect(enAnalisis).toEqual(["Nombre de la propuesta", "Preparado para (opcional)", "Periodo"]);
    expect(document.querySelector('[role="dialog"] .informes-firma')?.textContent).toContain("Firma de los informes");
    expect(document.querySelector('[role="dialog"] input[type="email"]')).toBeNull();
    await nombrar("Cartera Pérez");
    await pulsar(boton("Descargar el informe", document.querySelector('[role="dialog"]')!));
    await esperar();
    expect((pdf.cliente.mock.calls[0] as unknown as [InformeDeClientePdfInput])[0].report.portfolio_name).toBe("Cartera Pérez");
    expect(alCambiarElNombre).toHaveBeenCalledWith("Cartera Pérez");

    act(() => root.unmount());
    root = createRoot(host);
    const assets = datos.assets as BdbAssetDetail[];
    await act(async () => {
      root.render(createElement(PortfolioReport, {
        report: { ...(datos.report as BdbPortfolioReport), portfolio_name: "" },
        originalPositions: POSICIONES,
        assets,
        feasibility: viabilidadDelInforme({ positions: POSICIONES, assets }),
        portfolioName: ""
      }));
    });
    await esperar();
    await pulsar(document.querySelector('button[aria-label="Preparar: Informe de la propuesta"]') as HTMLButtonElement);
    expect(rotulos()).toEqual(enAnalisis);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Informe de la propuesta");
    expect(document.body.textContent).not.toContain("Responsable comercial");
    /* La firma ya no se escribe en la página de Informes: «Elaborado por» y el correo desaparecen de los datos. */
    expect([...document.querySelectorAll(".informes-datos .field__label")].map((nodo) => nodo.textContent)).not.toContain("Elaborado por");
  });

  test("en Análisis, como en Informes, el diálogo no se cierra mientras se genera: ni con Escape ni con la X (ANA-12)", async () => {
    let terminar: () => void = () => undefined;
    pdf.cliente.mockImplementationOnce(() => new Promise<undefined>((resolve) => { terminar = () => resolve(undefined); }));
    await act(async () => {
      root.render(createElement(XrayPage, { positions: POSICIONES, sourceKind: "LOCAL_MOCK", portfolioName: "Cartera de prueba", onBack: () => undefined }));
    });
    await esperar();
    await pulsar(boton("Informe de la propuesta"));
    await pulsar(boton("Descargar el informe", document.querySelector('[role="dialog"]')!));
    await esperar();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.querySelector('[aria-label="Cerrar"]')).toBeNull();
    await act(async () => {
      dialogo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => terminar());
    await esperar();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
