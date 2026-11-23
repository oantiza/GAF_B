// @vitest-environment happy-dom

/**
 * ALTA-11 (auditoría 16-10-2026): «Reintentar» del PDF en Análisis repite la misma descarga. Desde la
 * decisión 31 (04-11-2026) Análisis queda con un solo documento: el informe de cliente. El informe
 * recibe el capital y el diálogo añade el correo y el periodo, como en la otra puerta.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { guardarIdentidad } from "../src/core/identidadDelAsesor";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));

const pdf = vi.hoisted(() => ({
  cliente: vi.fn(),
  viabilidad: vi.fn(() => ({})),
  simular: vi.fn(async () => ({}))
}));

vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    /* El total es el de la cartera de la prueba, una posición al 100 %: sin cuadrar, el informe de cliente no se genera (INF-1). */
    buildManualPortfolioReport: async () => ({ summary: { total_weight_percent: 100 }, xray: {}, positions: [], warnings: [], data_diagnostic: { top_warnings: [] } }),
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => ({}),
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => ({})
  })
}));
vi.mock("../src/core/reportPipeline", () => ({
  viabilidadDelInforme: pdf.viabilidad,
  useReportLookThrough: () => ({
    lookThroughLoad: { data: null, loading: false, error: null },
    isLookThroughPending: false
  })
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: pdf.simular }));
vi.mock("../src/reports/informeDeClientePdf", () => ({ downloadInformeDeClientePdf: pdf.cliente, rentabilidadPorDividendoDe: () => ({}) }));
// Lo visual de la página no interviene: testigos vacíos.
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
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { AppError } from "../src/core/appError";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(text));
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function click(element: HTMLElement) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function flush() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  await act(async () => {
    root.render(
      createElement(XrayPage, {
        positions: [{ asset_id: "LU0289214628", weight_percent: 100 }],
        sourceKind: "LOCAL_MOCK",
        totalCapital: 250000,
        portfolioName: "Cartera de prueba",
        onBack: () => undefined
      })
    );
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Análisis · con 0 % medido (decisión 105)", () => {
  const FRASE = "No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición de la cartera.";
  const sinDatos = () =>
    new AppError("BACKEND", "La operación no se puede ejecutar en el estado actual de los datos.", {
      cause: { code: "functions/failed-precondition" },
      detail: "No hay activos con precios EUR válidos para el análisis. [400]"
    });
  const montarEn = async (modoCliente: boolean) => {
    await act(async () => {
      root.render(
        createElement(ClientModeProvider, {
          initialValue: modoCliente,
          children: createElement(XrayPage, {
            positions: [{ asset_id: "LU0289214628", weight_percent: 100 }],
            sourceKind: "LOCAL_MOCK",
            portfolioName: "Cartera de prueba",
            onBack: () => undefined
          })
        })
      );
    });
    await flush();
  };
  afterEach(() => pdf.simular.mockReset().mockResolvedValue({}));

  test("lo dice dentro del diálogo, con el motivo del servidor, sin «Reintentar» y sin dejar pulsar otra vez", async () => {
    pdf.simular.mockRejectedValue(sinDatos());
    await montarEn(false);
    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.textContent).toContain(FRASE);
    expect(dialogo.textContent).toContain("Motivo: No hay activos con precios EUR válidos para el análisis.");
    expect(dialogo.textContent).not.toContain("[400]");
    expect(dialogo.textContent).not.toContain("Reintentar");
    expect(pdf.cliente).not.toHaveBeenCalled();
    expect((button("Descargar el informe") as HTMLButtonElement).disabled).toBe(true);
    /* Detrás, en la página, no queda ningún aviso de fallo del PDF. */
    expect(host.textContent).not.toContain(FRASE);
  });

  test("en Modo cliente, la misma frase sin el motivo", async () => {
    pdf.simular.mockRejectedValue(sinDatos());
    await montarEn(true);
    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.textContent).toContain(FRASE);
    expect(dialogo.textContent).not.toContain("Motivo");
    expect(dialogo.textContent).not.toContain("precios EUR");
  });

  test("un fallo de verdad sigue pidiendo que se reintente, y se lee dentro del diálogo; al salir bien se cierra", async () => {
    pdf.simular.mockRejectedValueOnce(new AppError("BACKEND", "El servicio ha fallado internamente. Reinténtalo en unos segundos.", { cause: { code: "functions/internal" } }));
    await mount();
    await flush();
    pdf.simular.mockReset().mockRejectedValueOnce(new AppError("BACKEND", "El servicio ha fallado internamente. Reinténtalo en unos segundos.", { cause: { code: "functions/internal" } })).mockResolvedValue({});
    pdf.cliente.mockResolvedValue(undefined);
    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("Reinténtalo en unos segundos");
    expect([...dialogo.querySelectorAll("button")].some((b) => b.textContent === "Reintentar")).toBe(true);
    expect((button("Descargar el informe") as HTMLButtonElement).disabled).toBe(false);
    await click([...dialogo.querySelectorAll("button")].find((b) => b.textContent === "Reintentar") as HTMLElement);
    await flush();
    expect(pdf.cliente).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("el diálogo deja cambiar el periodo: lo que no se puede a 3 años puede poderse a 5, y el aviso se va", async () => {
    pdf.simular.mockRejectedValue(sinDatos());
    await montarEn(false);
    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(FRASE);
    await click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent === "5 años") as HTMLElement);
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(FRASE);
    expect((button("Descargar el informe") as HTMLButtonElement).disabled).toBe(false);
    await click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent === "3 años") as HTMLElement);
  });

  test("cerrar el diálogo se lleva el aviso: al volver a abrirlo no sigue ahí", async () => {
    pdf.simular.mockRejectedValue(sinDatos());
    await montarEn(false);
    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    await click(button("Cancelar"));
    await click(button("Informe de la propuesta"));
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(FRASE);
  });
});

describe("Análisis · Reintentar repite la misma descarga", () => {
  test("si falla el informe de cliente, el reintento vuelve a pedirlo", async () => {
    pdf.cliente.mockRejectedValueOnce(new Error("Fallo de red")).mockResolvedValue(undefined);
    await mount();

    await click(button("Informe de la propuesta"));
    await click(button("Descargar el informe"));
    await flush();
    expect(pdf.cliente).toHaveBeenCalledTimes(1);

    /* Dentro del diálogo: detrás, difuminado, no se leía. */
    await click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent === "Reintentar") as HTMLElement);
    await flush();

    expect(pdf.cliente).toHaveBeenCalledTimes(2);
    // El capital viaja al informe, como en la otra puerta.
    expect(pdf.cliente).toHaveBeenLastCalledWith(expect.objectContaining({ totalCapital: 250000 }));
    /* Bien descargado, el diálogo se cierra. */
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("Análisis queda con un solo botón de documento, y sin la Radiografía (decisión 31)", async () => {
    await mount();
    const botones = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(botones).toContain("Informe de la propuesta");
    expect(botones).not.toContain("Análisis completo");
    expect(botones).not.toContain("Informe de cartera");
  });

  /* Rediseño (14-11-2026): el correo ya no se pide en el diálogo. Es el contacto de la firma del asesor, escrito una vez en «Tus
     datos en los informes»; el diálogo lo enseña en una línea, con «Cambiar», y sigue llegando al informe. */
  test("el diálogo dice el periodo, enseña la firma y el contacto del asesor llega al informe", async () => {
    guardarIdentidad({ nombre: "Marta Ruiz", contacto: "responsable@ejemplo.test" });
    pdf.cliente.mockResolvedValue(undefined);
    await mount();
    await click(button("Informe de la propuesta"));
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("Periodo");
    expect(dialogo.textContent).toContain("3 años");
    expect(dialogo.querySelector("h2")?.textContent ?? dialogo.textContent).toContain("Informe de la propuesta");
    expect(dialogo.querySelector('input[type="email"]')).toBeNull();
    expect(dialogo.querySelector(".informes-firma")?.textContent).toContain("Marta Ruiz · responsable@ejemplo.test");
    await click(button("Descargar el informe"));
    await flush();
    const [entrada] = pdf.cliente.mock.calls[0] as [{ banker: { name: string; email: string } }];
    expect(entrada.banker).toEqual({ name: "Marta Ruiz", email: "responsable@ejemplo.test" });
    /* Bien descargado, el diálogo se cierra. */
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    guardarIdentidad({});
  });
});
