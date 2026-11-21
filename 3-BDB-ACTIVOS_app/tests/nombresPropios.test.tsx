// @vitest-environment happy-dom

/**
 * Para un lector de pantalla (hallazgo 149 de la auditoría del 04-11-2026): el nombre del instrumento
 * es el título principal de la ficha, un veredicto no es un título, cada control dice de qué fondo
 * habla y «Composición de la cartera» es una tabla de verdad. Y el foco de los diálogos (hallazgo 86).
 *
 * Lo que NO se cambia aquí, y hay una prueba que lo vigila: el nivel de los paneles. Del título de
 * página al de sección se salta un nivel por convención desde la auditoría del 29-09.
 */
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listarTarjetas: vi.fn() }));

vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  listarTarjetas: mocks.listarTarjetas,
  leerDocumento: async () => ({})
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    buildManualPortfolioReport: async () => ({ summary: {}, xray: {}, positions: [], warnings: [], data_diagnostic: { top_warnings: [] } }),
    getComparableAssets: async () => [
      {
        asset_id: "LU0000000001",
        display_name: "Fondo de prueba A",
        category: "Renta fija",
        economic_asset_class: "FIXED_INCOME",
        metrics: { volatility_3y: 0.0419 }
      },
      { asset_id: "LU0000000002", display_name: "Fondo de prueba B", category: "Renta fija", economic_asset_class: "FIXED_INCOME", metrics: {} }
    ],
    buildManualPortfolioSummary: async () => ({}),
    getAssetHoldings: async () => null,
    getAssetHoldingsMany: async () => ({})
  })
}));
vi.mock("../src/core/reportPipeline", () => ({
  viabilidadDelInforme: () => ({}),
  useReportLookThrough: () => ({ lookThroughLoad: { data: null, loading: false, error: null }, isLookThroughPending: false })
}));
vi.mock("../src/adapters/portfolioHorizon", () => ({ fetchPortfolioHorizon: async () => ({}) }));
vi.mock("../src/components/PortfolioXray", () => ({ PortfolioXray: () => null, ComposicionSubyacente: () => null, MayoresAcciones: () => null }));
vi.mock("../src/components/XrayMetricsStyle", () => ({ XrayMetricsStyle: () => null }));
vi.mock("../src/components/RegionAllocation", () => ({ RegionAllocation: () => null }));
vi.mock("../src/components/XrayAdvanced", () => ({ XrayAdvanced: () => null }));
vi.mock("../src/components/PortfolioDataDiagnostic", () => ({ PortfolioDataDiagnostic: () => null }));
vi.mock("../src/components/PortfolioReportWarnings", () => ({ PortfolioReportWarnings: () => null }));
vi.mock("../src/components/BenchmarkSelect", () => ({ BenchmarkSelect: () => null }));

import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { SaludYControl } from "../src/components/SaludYControl";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import { BuscadorNuevoPage } from "../src/pages/BuscadorNuevoPage";
import { XrayPage } from "../src/pages/XrayPage";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import type { FichaInstrumento as ModeloDeFicha } from "../src/types/fichaInstrumento";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const reposar = (ms = 0) =>
  act(async () => {
    await new Promise((listo) => setTimeout(listo, ms));
  });

describe("los títulos", () => {
  test("el nombre del instrumento es el título principal de la ficha", () => {
    const ficha = {
      tipo: "Fondo",
      nombre: "Fondo de prueba",
      identificacion: "LU0000000001",
      disponibilidad: { estado: "activa", rotulo: "Cotiza", valor: "Sí" },
      aptitudes: [],
      secciones: []
    } as unknown as ModeloDeFicha;
    const html = renderToStaticMarkup(<FichaInstrumento ficha={ficha} />);
    /* La cabecera la monta PageHeader: el nombre es su h1. */
    expect(html).toMatch(/<h1>Fondo de prueba<\/h1>/);
    expect(html).not.toMatch(/<h2/);
  });

  test("el titular de la salud es un veredicto, no un título: el de la sección es otro", () => {
    const html = renderToStaticMarkup(
      <SaludYControl lectura={{ estado: "sin-alertas", titular: "Sin alertas en lo medido · 88 % del peso", fuera: [], alertas: [], filas: [] }} />
    );
    expect(html).toContain("Sin alertas en lo medido");
    /* MAR-32: el título del bloque es `h2`; el titular no es un encabezado de ningún nivel. */
    expect(html).not.toMatch(/<h[1-6][^>]*>[^<]*Sin alertas/);
    expect(html).toMatch(/<h2[^>]*>\s*Qué conviene mirar/);
  });
});

describe("los controles dicen de qué fondo hablan", () => {
  test("en la tabla de posiciones", () => {
    const assets = [{ asset_id: "A", display_name: "Vanguard S&P 500", isin: "IE00B3XXRP09" }] as unknown as BdbAssetDetail[];
    const html = renderToStaticMarkup(
      <PortfolioPositionsTable
        assets={assets}
        locks={{}}
        onEuroChange={() => undefined}
        onRemove={() => undefined}
        onSwapRequest={() => undefined}
        onToggleLock={() => undefined}
        onWeightChange={() => undefined}
        positions={[{ asset_id: "A", weight_percent: 60 }]}
        totalCapital={100000}
      />
    );
    const texto = html.replaceAll("&amp;", "&");
    expect(texto).toContain('aria-label="Peso de Vanguard S&P 500"');
    expect(texto).toContain('aria-label="Importe en euros de Vanguard S&P 500"');
    expect(texto).toContain('aria-label="Bloquear el peso de Vanguard S&P 500"');
    expect(texto).toContain('aria-label="Sustituir Vanguard S&P 500"');
    expect(texto).toContain('aria-label="Quitar Vanguard S&P 500"');
  });

  test("en la tabla del Buscador", async () => {
    mocks.listarTarjetas.mockResolvedValue([
      {
        instrument_id: "BE0943877671",
        instrument_type: "FUND",
        identity: { name: "DPAM B Bonds", currency: "EUR" },
        classification: { asset_class: "FIXED_INCOME" }
      }
    ]);
    await act(async () => {
      root!.render(
        <BuscadorNuevoPage
          enCartera={[]}
          onAlternarComparacion={() => undefined}
          onAnadirACartera={() => undefined}
          paraComparar={[]}
        />
      );
    });
    await reposar();
    const nombres = [...host.querySelectorAll(".tabla__celda--acciones button, .tabla .tabla__favorito")].map((b) => b.getAttribute("aria-label"));
    /* El de añadir empieza por lo que se lee en el botón (WCAG 2.5.3) y después dice de qué fondo habla. */
    expect(nombres).toEqual(["Marcar DPAM B Bonds como favorito", "Añadir a la propuesta: DPAM B Bonds", "Comparar DPAM B Bonds"]);
    /* El estado lo dice aria-pressed: el nombre no cambia al pulsar, o se anunciaría al revés. */
    expect(host.querySelector(".tabla__favorito")?.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("«Composición de la cartera» es una tabla de verdad", () => {
  test("el fondo es el encabezado de su fila, y la estrategia, el de su grupo", async () => {
    await act(async () => {
      root!.render(
        <XrayPage
          onBack={() => undefined}
          portfolioName="Prueba"
          positions={[
            { asset_id: "LU0000000001", weight_percent: 60 },
            { asset_id: "LU0000000002", weight_percent: 40 }
          ]}
          sourceKind="LOCAL_MOCK"
          totalCapital={100000}
        />
      );
    });
    await reposar(20);
    /* Rediseño: el bloque se llama «Posiciones» (maqueta) y la volatilidad dice su ventana con palabras (ANA-14). */
    const tabla = host.querySelector("table.tabla")!;
    expect(tabla, "la tabla").not.toBeNull();
    expect(tabla.querySelector("caption")?.textContent).toContain("Posiciones de la cartera");
    const columnas = [...tabla.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent);
    expect(columnas.slice(0, 2)).toEqual(["Activo", "Peso"]);
    expect(columnas).toContain("Aporta al riesgo");
    expect(columnas).toContain("Vol. 3A (Volatilidad 3 años)");
    /* Con capital fijado sale el importe. */
    expect(columnas).toContain("Importe");
    expect([...tabla.querySelectorAll('tbody th[scope="rowgroup"]')].map((th) => th.firstElementChild?.textContent)).toEqual(["Renta fija"]);
    expect([...tabla.querySelectorAll('tbody th[scope="row"]')].map((th) => th.firstElementChild?.textContent)).toEqual(["Fondo de prueba A", "Fondo de prueba B"]);
    const fila = tabla.querySelector("tbody .tabla__fila--de-grupo")!;
    const indice = (titulo: string) => columnas.indexOf(titulo) - 1;
    const celdas = [...fila.querySelectorAll("td")].map((td) => td.textContent?.replace(/\u00a0/g, " "));
    expect(celdas[indice("Peso")]).toBe("60,0 %");
    /* Dos decimales, como toda volatilidad (apartado 6); antes «4,2 %». */
    expect(celdas[indice("Vol. 3A (Volatilidad 3 años)")]).toBe("4,19 %");
    /* Lo que falta se dice, también aquí. */
    const segunda = [...tabla.querySelectorAll("tbody .tabla__fila--de-grupo")][1].querySelectorAll("td");
    expect(segunda[indice("Vol. 3A (Volatilidad 3 años)")].textContent).toBe("Falta el dato");
    expect(tabla.querySelector("tfoot th")?.textContent).toBe("Toda la cartera · 2 posiciones");
    expect(tabla.querySelector("tfoot td")?.textContent?.replace(/\u00a0/g, " ")).toBe("100,0 %");
  });
});

describe("el foco de un diálogo", () => {
  const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto)!;

  test("en una acción peligrosa arranca en «Cancelar»: un Intro de más no borra nada", async () => {
    await act(async () => {
      root!.render(<ConfirmDialog confirmLabel="Eliminar" onCancel={() => undefined} onConfirm={() => undefined} title="¿Eliminar?" tone="danger" />);
    });
    await reposar(20);
    expect(document.activeElement).toBe(boton("Cancelar"));
  });

  test("también con el doble montaje del modo estricto", async () => {
    await act(async () => {
      root!.render(
        <StrictMode>
          <ConfirmDialog confirmLabel="Eliminar" onCancel={() => undefined} onConfirm={() => undefined} title="¿Eliminar?" tone="danger" />
        </StrictMode>
      );
    });
    await reposar(40);
    expect(document.activeElement).toBe(boton("Cancelar"));
  });

  test("en una acción normal arranca en confirmar", async () => {
    await act(async () => {
      root!.render(<ConfirmDialog confirmLabel="Aplicar" onCancel={() => undefined} onConfirm={() => undefined} title="¿Seguro?" />);
    });
    await reposar(20);
    expect(document.activeElement).toBe(boton("Aplicar"));
  });

  test("al cerrar, el foco vuelve al botón que lo abrió", async () => {
    function Banco() {
      const [abierto, setAbierto] = useState(false);
      return (
        <>
          <button onClick={() => setAbierto(true)} type="button">
            Abrir
          </button>
          {abierto ? <ConfirmDialog onCancel={() => setAbierto(false)} onConfirm={() => setAbierto(false)} title="¿Seguro?" tone="danger" /> : null}
        </>
      );
    }
    await act(async () => {
      root!.render(<Banco />);
    });
    const abrir = boton("Abrir");
    abrir.focus();
    await act(async () => abrir.click());
    await reposar(20);
    expect(document.activeElement).toBe(boton("Cancelar"));
    await act(async () => boton("Cancelar").click());
    expect(document.activeElement).toBe(abrir);
  });
});
