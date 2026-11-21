// @vitest-environment happy-dom

/**
 * MAR-32 (14-11-2026): en 35 de las 48 pantallas se pasaba del `h1` de la pantalla al `h3` de cada bloque sin ningún
 * `h2`. La regla desde entonces: `h1` la pantalla, `h2` cada bloque (`Panel`), `h3` lo que va dentro de un bloque. Aquí
 * se monta cada pantalla con datos de prueba y se cuentan los saltos de nivel entre los encabezados que se ven.
 *
 * Las pantallas que ya tienen un arnés con sus dobles hacen la misma comprobación en su propia prueba, con la misma
 * función (`tests/support/saltosDeNivel.ts`): Análisis en `analisisRediseno`, Diseño en `disenoRedisenoPasos`, Informes
 * en `informesRediseno` y la cartera de un cliente (Resumen y Análisis) en `gestor/carterasDeClientes`. Aquí van las que
 * no lo tenían: Mercado, Jubilación y Sistema.
 */
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encabezadosVisibles, saltosDeNivel } from "./support/saltosDeNivel";

const dobles = vi.hoisted(() => ({
  tipos: vi.fn(),
  curva: vi.fn(),
  calendario: vi.fn(),
  dividendos: vi.fn(),
  resultados: vi.fn(),
  estrategia: vi.fn(),
  fuente: { getComparableAssets: vi.fn() }
}));
vi.mock("../src/adapters/ecbRatesBackend", () => ({ fetchEcbRates: dobles.tipos }));
vi.mock("../src/adapters/ecbYieldCurveBackend", () => ({ fetchEcbYieldCurve: dobles.curva }));
vi.mock("../src/adapters/economicCalendarBackend", () => ({ fetchEconomicCalendar: dobles.calendario }));
vi.mock("../src/adapters/dividendsCalendarBackend", () => ({ fetchDividendsCalendar: dobles.dividendos }));
vi.mock("../src/adapters/earningsCalendarBackend", () => ({ fetchEarningsCalendar: dobles.resultados }));
vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: dobles.estrategia }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => dobles.fuente }));
vi.mock("../src/reports/jubilacionPdf", () => ({ downloadJubilacionPdf: vi.fn() }));

import type { SystemStatusResponse } from "../src/adapters/systemStatusBackend";
import { PageHeader } from "../src/components/ui/PageHeader";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { JubilacionPage } from "../src/pages/JubilacionPage";
import { MercadoPage } from "../src/pages/MercadoPage";
import { SystemStatusContent } from "../src/pages/SystemStatusPage";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/* Las pestañas de Mercado se cargan con `lazy`, y sus datos llegan después: se deja correr lo pendiente hasta que lo
   que se espera está pintado. */
const esperar = async (condicion?: () => boolean) => {
  const vueltas = condicion ? 200 : 10;
  for (let vuelta = 0; vuelta < vueltas && !condicion?.(); vuelta += 1) {
    await act(async () => { await new Promise((resolver) => setTimeout(resolver, 0)); });
  }
  if (condicion) expect(condicion(), "lo esperado llega a pintarse").toBe(true);
};
const hayBloque = () => host.querySelector('[role="tabpanel"] .panel__title') !== null;
const boton = (texto: string) => {
  const encontrado = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === texto);
  if (!encontrado) throw new Error(`Falta el botón «${texto}»`);
  return encontrado;
};
const pulsar = async (texto: string) => {
  await act(async () => boton(texto).click());
  await esperar();
};

/** La pantalla empieza por su `h1`, tiene algo más que el título y no se salta ningún nivel. */
function sinSaltos(contenedor: ParentNode, donde: string) {
  const niveles = encabezadosVisibles(contenedor).map((encabezado) => encabezado.nivel);
  expect(niveles[0], `${donde}: empieza por el título de la pantalla`).toBe(1);
  expect(niveles.length, `${donde}: tiene encabezados además del título`).toBeGreaterThan(1);
  expect(saltosDeNivel(contenedor), donde).toEqual([]);
}

describe("la función que cuenta los saltos", () => {
  const de = (html: string) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  };

  test("del h1 al h3 es un salto, y dice dónde", () => {
    expect(saltosDeNivel(de("<h1>Mercado</h1><h3>Tipos del BCE</h3>"))).toEqual(["h1 «Mercado» → h3 «Tipos del BCE»"]);
  });

  test("bajar de uno en uno y volver a subir no lo es", () => {
    expect(saltosDeNivel(de("<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h2>E</h2><h3>F</h3>"))).toEqual([]);
  });

  test("lo que no se ve no cuenta: ni una pestaña oculta ni lo que se esconde al lector", () => {
    expect(saltosDeNivel(de('<h1>A</h1><div hidden><h2>B</h2></div><h2>C</h2><span aria-hidden="true"><h4>D</h4></span><h3>E</h3>'))).toEqual([]);
    expect(saltosDeNivel(de('<h1>A</h1><div hidden><h2>B</h2></div><h3>C</h3>'))).toEqual(["h1 «A» → h3 «C»"]);
  });
});

describe("Mercado", () => {
  beforeEach(() => {
    dobles.tipos.mockReset().mockResolvedValue({ rates: [], live_count: 0 });
    dobles.curva.mockReset().mockResolvedValue(null);
    dobles.calendario.mockReset().mockResolvedValue({
      source: "FOREX_FACTORY",
      count: 2,
      events: [
        { date: new Date().toISOString(), country: "EUR", type: "IPC de la eurozona", importance: "high" },
        { date: new Date(Date.now() + 86400000).toISOString(), country: "USD", type: "Ventas minoristas", importance: "medium" }
      ]
    });
    dobles.dividendos.mockReset().mockResolvedValue({ source: "YAHOO_LIVE", count: 0, items: [] });
    dobles.resultados.mockReset().mockResolvedValue({ source: "YAHOO_LIVE", count: 0, items: [] });
    dobles.estrategia.mockReset().mockResolvedValue({ report: WEEKLY_REPORT_MOCK, source: "test", freshness: "CURRENT", age_days: 0, invalid_count: 0 });
  });

  test.each(["calendario", "dividendos", "resultados"])("la pestaña %s", async (pestana) => {
    window.history.replaceState(null, "", `/mercado#pestana=${pestana}`);
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar(hayBloque);
    await esperar();
    sinSaltos(host, `Mercado · ${pestana}`);
  });

  test("el calendario: cada día es un h3 dentro de su bloque", async () => {
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar(() => host.querySelector(".market-day-heading h3") !== null);
  });

  test.each([["Diario", "Resumen"], ["Diario", "Informe completo"], ["Semanal", "Resumen"], ["Semanal", "Asignación"], ["Semanal", "Informe completo"]])("la estrategia: %s, %s", async (tipo, vista) => {
    window.history.replaceState(null, "", "/mercado#pestana=estrategia");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar(() => [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === tipo));
    await pulsar(tipo);
    await pulsar(vista);
    sinSaltos(host, `Mercado · estrategia · ${tipo} · ${vista}`);
  });

  /* El documento lo escribe un modelo en Markdown, con sus secciones en `###`. Salían como `h6`, a 9 px bajo párrafos de
     14 y cuatro niveles por debajo del título de su bloque; ahora son `h3`, como «Riesgos de cola» y las fuentes. */
  test("el informe completo: sus secciones son h3, como las demás del documento", async () => {
    window.history.replaceState(null, "", "/mercado#pestana=estrategia");
    await act(async () => { root!.render(<MercadoPage />); });
    await esperar(() => [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Informe completo"));
    await pulsar("Informe completo");
    const delDocumento = [...host.querySelectorAll(".strategy-document :is(h1, h2, h3, h4, h5, h6)")].map((titulo) => titulo.tagName);
    expect(delDocumento.length).toBeGreaterThan(2);
    expect(new Set(delDocumento)).toEqual(new Set(["H3"]));
    /* El resumen va arriba, sobre el selector de vista: dentro del documento no se repite. */
    expect(host.querySelector(".strategy-document blockquote")).toBeNull();
    expect(host.querySelectorAll(".strategy-lead")).toHaveLength(1);
  });
});

describe("Jubilación", () => {
  const montar = () =>
    act(async () => {
      root!.render(<JubilacionPage portfolioName="" positions={[]} sourceKind="firebaseLiveApi" totalCapital={undefined} />);
    });

  test("vacía", async () => {
    await montar();
    sinSaltos(document.body, "Jubilación vacía");
  });

  test("con el ejemplo: la respuesta, y las cuentas bajo su h2", async () => {
    await montar();
    await act(async () => boton("Cargar un ejemplo").click());
    sinSaltos(document.body, "Jubilación con el ejemplo");
    /* El método se abre: sus secciones son `h4`, bajo el `h3` de su panel, que va bajo el `h2` de las cuentas. */
    await act(async () => boton("El método y las fuentes").click());
    sinSaltos(document.body, "Jubilación con el método abierto");
    expect([...document.querySelectorAll(".jubilacion-carriles h4")].length).toBeGreaterThan(0);
  });
});

describe("Sistema · Estado del sistema", () => {
  const ESTADO = {
    integrity: {
      checked_at: "2026-07-12T08:45:00Z",
      status: "WARN",
      freshness: { price_refresh: "OK", metrics_refresh: "WARN", backup: "FAIL" },
      counts: { assets_total: 753, portfolios: 7 },
      problems: [{ severity: "WARN", check: "search_index_missing", detail: "Dos activos están fuera del buscador." }]
    },
    backup: { completed_at: "2026-07-07T03:00:00Z", verification: "SHA256_OK", firestore_records: 12345 },
    prices: { last_run: "2026-07-12T07:30:00Z", read_budget_used: 1200, read_budget_max: 2000 },
    metrics: { last_run: "2026-07-10T08:00:00Z", cycle_completed: false, stopped_by_budget: true, read_budget_used: 6000, read_budget_max: 6000 }
  } as unknown as SystemStatusResponse;

  /* La pestaña la monta Sistema bajo su cabecera de pantalla (`AdminPage`): aquí, la misma cabecera y el mismo contenido. */
  test("con datos y sin ellos", () => {
    for (const [nombre, estado] of [
      ["con datos", ESTADO],
      ["sin datos", { integrity: null, backup: null, prices: null, metrics: null } as SystemStatusResponse]
    ] as const) {
      const div = document.createElement("div");
      div.innerHTML = renderToStaticMarkup(
        createElement("div", null, createElement(PageHeader, { title: "Sistema" }), createElement(SystemStatusContent, { now: new Date("2026-07-12T12:00:00Z"), snapshot: estado }))
      );
      sinSaltos(div, `Sistema ${nombre}`);
    }
  });
});
