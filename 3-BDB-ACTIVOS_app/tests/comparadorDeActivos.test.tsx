// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/**
 * «Comparar activos» de extremo a extremo, con lo de fuera simulado: el orden de la decisión 27, el
 * benchmark de la 2, los colores de la pantalla y los del papel, que no son los mismos.
 */
const mocks = vi.hoisted(() => ({
  rebased: vi.fn(),
  pdf: vi.fn(),
  lineChart: vi.fn(),
  retro: vi.fn(),
  acceso: vi.fn()
}));
const BASE_DE_LA_REFERENCIA = ["IE00B18GC888", "IE00B03HCZ61"];

vi.mock("../src/adapters/priceSeriesBackend", () => ({ fetchRebasedSeries: mocks.rebased }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    searchAssets: vi.fn(async () => []),
    getComparableAssets: vi.fn(async () => [])
  })
}));
vi.mock("../src/reports/assetComparePdf", () => ({ downloadAssetComparisonPdf: mocks.pdf }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: mocks.acceso }));
vi.mock("../src/adapters/baseNuevaLectura", async (original) => ({
  ...(await original<typeof import("../src/adapters/baseNuevaLectura")>()),
  BASE_NUEVA_DISPONIBLE: false
}));
vi.mock("../src/charts/oaa", async (original) => ({
  ...(await original<typeof import("../src/charts/oaa")>()),
  OaaLineChart: (props: { series: Array<{ id: string; color?: string; dashed?: boolean; etiquetaFinal?: string }> }) => {
    mocks.lineChart(props);
    return <div data-testid="evolucion" />;
  }
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { isAppRouteId } from "../src/app/appRoutes";
import { CLIENT_MODE_STORAGE_KEY } from "../src/app/ClientModeContext";
import { AssetComparison } from "../src/components/AssetComparison";
import { fecha } from "../src/core/formato";
import { clearSessionCaches } from "../src/core/sessionCaches";

function activo(id: string, tipo: BdbAssetDetail["instrument_type"] = "FUND", extra: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id: id, display_name: `Activo ${id}`, isin: id, instrument_type: tipo, economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    metrics: { annualized_return_3y: 0.06, volatility_3y: 0.1, sharpe_3y: 0.98 },
    costs: { ongoing_charge: 0.012 }, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    ...extra
  };
}

const CINCO = ["A", "B", "C", "D", "E"].map((id) => activo(id));
/* Tres años de los activos, un dato por semana en la serie. */
const FECHAS = [
  ...Array.from({ length: 157 }, (_, i) => {
    const dia = new Date("2023-10-26T00:00:00Z");
    dia.setUTCDate(dia.getUTCDate() + 7 * i);
    return dia.toISOString().slice(0, 10);
  }),
  "2026-10-27"
];
const SERIE = (ids: string[]) => ({
  dates: FECHAS,
  frequency: "DAILY",
  window: "3Y",
  coverage: { first_date: "2023-10-26", last_date: "2026-10-27", common_observations: 718 },
  series: ids.map((id) => ({ asset_id: id, display_name: `Activo ${id}`, values: FECHAS.map((_, i) => 100 + i) }))
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  /* La pantalla guarda en la sesión la pestaña, el periodo y el benchmark: sin esto, cada prueba hereda la anterior. */
  clearSessionCaches();
  /* La pestaña del Comparador va en la dirección: cada prueba empieza sin ella. */
  window.history.replaceState(null, "", "/");
  /* Los dos fondos de las carteras de referencia llegan por la misma callable, cuatro semanas menos. */
  mocks.rebased.mockImplementation(async (ids: string[]) => {
    if (ids.join() !== BASE_DE_LA_REFERENCIA.join()) return SERIE(ids);
    const dates = FECHAS.slice(0, -4);
    return { ...SERIE(ids), dates, series: ids.map((id) => ({ asset_id: id, display_name: id, values: dates.map((_, i) => 100 + i / 2) })) };
  });
  mocks.pdf.mockResolvedValue(undefined);
  mocks.retro.mockResolvedValue(new Map());
  mocks.acceso.mockReturnValue("granted");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function monta(nodo: ReactNode) {
  await act(async () => root.render(nodo));
}
const boton = (texto: string | RegExp) =>
  [...container.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? "")));
const titulos = () => [...container.querySelectorAll(".panel__title")].map((titulo) => titulo.textContent);
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const opcion = (texto: RegExp) => [...(dialogo()?.querySelectorAll("button") ?? [])].find((b) => texto.test(b.textContent ?? ""));
/** Pide el informe y elige la salida en el diálogo: la que se entrega, salvo que se diga otra. */
async function pideElInforme(salida: RegExp = /Sin retrocesiones/) {
  await act(async () => boton("Descargar el informe")!.click());
  await act(async () => opcion(salida)!.click());
}

describe("el orden de la pantalla (decisión 27)", () => {
  test("selección, cifras, evolución con su benchmark, mapa y correlación", async () => {
    await monta(<AssetComparison assets={CINCO.slice(0, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(titulos()).toEqual([
      "Qué se compara",
      "Métricas de riesgo y rentabilidad",
      "Evolución comparada (base 100)",
      "Mapa riesgo / rentabilidad",
      "Matriz de correlación"
    ]);
    /* El selector del benchmark vive con la evolución, que es lo que cambia. */
    const evolucion = [...container.querySelectorAll(".panel")].find((panel) => panel.textContent?.includes("Evolución comparada"));
    expect(evolucion?.querySelector("select")).toBeTruthy();
  });

  test("el PDF va en la cabecera de la página, y solo cuando hay qué comparar", async () => {
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(boton("Descargar el informe")).toBeUndefined();
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(boton("Descargar el informe")?.closest(".ui-page-header")).toBeTruthy();
  });
});

describe("el benchmark (decisión 2)", () => {
  test("abre sin benchmark hasta que el asesor elija uno", async () => {
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(container.querySelector<HTMLSelectElement>(".cmp-bench-toolbar select")?.value).toBe("none");
    expect(mocks.lineChart.mock.lastCall?.[0].series).toHaveLength(2);
    expect(mocks.lineChart.mock.lastCall?.[0].series.some((serie: { dashed?: boolean }) => serie.dashed)).toBe(false);
    /* «Auto» elegía mirando el resultado: ya no está en la lista. */
    const opciones = [...container.querySelectorAll<HTMLOptionElement>(".cmp-bench-toolbar option")].map((opcion) => opcion.textContent);
    expect(opciones).toEqual([
      "Sin cartera de referencia",
      "Conservador · 100/0 RF/RV",
      "Moderado · 75/25 RF/RV",
      "Equilibrado · 50/50 RF/RV",
      "Dinámico · 25/75 RF/RV",
      "Agresivo · 0/100 RF/RV"
    ]);
    /* Sin referencia elegida no se piden sus series. */
    expect(mocks.rebased.mock.calls.some(([ids]) => (ids as string[]).join() === BASE_DE_LA_REFERENCIA.join())).toBe(false);
  });

  async function elige(perfil: string) {
    const selector = container.querySelector<HTMLSelectElement>(".cmp-bench-toolbar select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(selector, perfil);
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    /* Las series llegan en una tarea aparte. */
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  test("activos y referencia en las mismas fechas y hasta la última común, y se escribe", async () => {
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await elige("equilibrado");
    const series = mocks.lineChart.mock.lastCall?.[0].series as Array<{ id: string; values: Array<{ date: string; value: number | null }> }>;
    const ultimaComun = FECHAS[FECHAS.length - 5];
    /* Las tres líneas acaban en la misma fecha, con dato, y ninguna sigue plana después. */
    for (const serie of series) {
      expect(serie.values.at(-1)?.date, serie.id).toBe(ultimaComun);
      expect(serie.values.every((punto) => typeof punto.value === "number")).toBe(true);
    }
    expect(series.at(-1)?.values[0].value).toBe(100);
    const nota = container.querySelector(".cmp-bench-toolbar .cmp-note")?.textContent ?? "";
    expect(nota).toContain("Equilibrado: 50\u00a0% renta fija global y 50\u00a0% renta variable global, con los pesos fijados el primer día, sin reequilibrar.");
    expect(nota).toContain("Activos y referencia en las mismas fechas");
    expect(nota).toContain("la última común");
    expect(nota).not.toContain("misma ventana");
  });

  test("el informe recibe lo mismo: la cifra y la nota de la última fecha común", async () => {
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await elige("agresivo");
    await pideElInforme();
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.benchmarkName).toBe("Agresivo");
    /* Los activos valen 100 + i y la referencia 100 + i / 2: en la última fecha común, la misma para los dos. */
    const i = FECHAS.length - 5;
    expect(entrada.assets[0].base100).toBeCloseTo(100 + i, 8);
    expect(entrada.benchmarkBase100).toBeCloseTo(100 + i / 2, 8);
    expect(entrada.benchmarkNote).toContain("Agresivo: 100\u00a0% renta variable global.");
    expect(entrada.windowLabel).toContain(fecha(FECHAS[FECHAS.length - 5]) as string);
  });

  test("si las series no llegan se dice, y no hay línea", async () => {
    mocks.rebased.mockImplementation(async (ids: string[]) => {
      if (ids.join() === BASE_DE_LA_REFERENCIA.join()) throw new Error("sin red");
      return SERIE(ids);
    });
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await elige("equilibrado");
    expect(container.querySelector(".cmp-bench-toolbar .cmp-note")?.textContent).toContain("Cartera de referencia no disponible.");
    const series = mocks.lineChart.mock.lastCall?.[0].series;
    expect(series).toHaveLength(2);
    expect(series.some((serie: { dashed?: boolean }) => serie.dashed)).toBe(false);
    /* Y el informe sale y lo dice: sin cifra de la referencia. */
    await pideElInforme();
    expect(mocks.pdf.mock.lastCall?.[0].benchmarkBase100).toBeUndefined();
    expect(mocks.pdf.mock.lastCall?.[0].benchmarkNote).toBe("Cartera de referencia no disponible.");
  });

  test("sin semanas suficientes en común no se compara, y se dice", async () => {
    mocks.rebased.mockImplementation(async (ids: string[]) => {
      if (ids.join() !== BASE_DE_LA_REFERENCIA.join()) return SERIE(ids);
      const dates = FECHAS.slice(0, 10);
      return { ...SERIE(ids), dates, series: ids.map((id) => ({ asset_id: id, display_name: id, values: dates.map(() => 100) })) };
    });
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await elige("equilibrado");
    expect(container.querySelector(".cmp-bench-toolbar .cmp-note")?.textContent).toContain("Sin fechas suficientes en común con Equilibrado");
    expect(mocks.lineChart.mock.lastCall?.[0].series).toHaveLength(2);
  });

  test("el botón del informe espera a que lleguen las series", async () => {
    let entrega: (respuesta: unknown) => void = () => undefined;
    mocks.rebased.mockImplementation(async (ids: string[]) => {
      if (ids.join() !== BASE_DE_LA_REFERENCIA.join()) return SERIE(ids);
      return new Promise((resolve) => { entrega = resolve; });
    });
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await elige("equilibrado");
    expect(boton("Descargar el informe")?.disabled).toBe(true);
    expect(container.querySelector(".cmp-bench-toolbar .cmp-note")?.textContent).toContain("Cargando la cartera de referencia");
    await act(async () => {
      entrega({ ...SERIE(BASE_DE_LA_REFERENCIA), dates: FECHAS, series: BASE_DE_LA_REFERENCIA.map((id) => ({ asset_id: id, display_name: id, values: FECHAS.map((_, i) => 100 + i) })) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(boton("Descargar el informe")?.disabled).toBe(false);
  });

  test("H1-11: sin referencia elegida, el informe no sale mientras las series sean las de la selección anterior", async () => {
    let entrega: (respuesta: unknown) => void = () => undefined;
    await monta(<AssetComparison assets={CINCO.slice(0, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(boton("Descargar el informe")?.disabled).toBe(false);
    /* Al quitar un activo se piden las series del par nuevo, y hasta que llegan la matriz es la del trío. */
    mocks.rebased.mockImplementation(() => new Promise((resolve) => { entrega = resolve; }));
    await act(async () => (container.querySelector('[aria-label="Quitar Activo C de la comparación"]') as HTMLElement).click());
    expect(boton("Descargar el informe")?.disabled).toBe(true);
    await act(async () => {
      entrega(SERIE(["A", "B"]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(boton("Descargar el informe")?.disabled).toBe(false);
  });

  test("al elegir uno sale como referencia (gris y a trazos), sea cual sea el perfil, con su «B»", async () => {
    await monta(<AssetComparison assets={CINCO.slice(0, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    for (const perfil of ["conservador", "moderado", "equilibrado", "dinamico", "agresivo"]) {
      const selector = container.querySelector<HTMLSelectElement>(".cmp-bench-toolbar select")!;
      await act(async () => {
        const valor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!;
        valor.set!.call(selector, perfil);
        selector.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      const series = mocks.lineChart.mock.lastCall?.[0].series;
      const benchmark = series.at(-1);
      expect(benchmark.dashed, perfil).toBe(true);
      /* El color sale del papel (paso 4 del rediseño): la referencia, gris y a trazos; ya no se pasa un tostado a mano. */
      expect(benchmark.papel, perfil).toBe("referencia");
      expect(benchmark.color, perfil).toBeUndefined();
      expect(benchmark.etiquetaFinal, perfil).toBe("B");
    }
    expect(container.querySelector(".cmp-legend-trazo")).toBeTruthy();
  });
});

describe("los colores: la pantalla cambia y el papel no", () => {
  /* Paso 1 del rediseño (14-11-2026): la paleta nueva no tiene verde ni carmesí, así que con cinco activos el
     quinto lleva el ocre, el último para que con hasta cuatro no se junte con el tostado del benchmark. */
  test("en pantalla, cada activo es una serie (el color sale de su papel) y cada línea lleva su número", async () => {
    /* Hasta el paso 4 del rediseño se pasaba un color a mano por activo; ahora cada uno dice su papel y no lleva color. */
    await monta(<AssetComparison assets={CINCO} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    const series = mocks.lineChart.mock.lastCall?.[0].series;
    expect(series.map((serie: { papel: string }) => serie.papel)).toEqual(["serie", "serie", "serie", "serie", "serie"]);
    expect(series.map((serie: { color?: string }) => serie.color)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(series.map((serie: { etiquetaFinal: string }) => serie.etiquetaFinal)).toEqual(["1", "2", "3", "4", "5"]);
    /* La leyenda, numerada igual. */
    expect([...container.querySelectorAll(".cmp-legend b")].map((numero) => numero.textContent)).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("si un activo no tiene serie, los demás conservan su número y su color en el gráfico, la leyenda y la matriz (decisión 84)", async () => {
    /* Se vio en la pantalla el 14-11-2026: con tres seleccionados y el segundo sin serie, el tercero era el «3» en su
       ficha y en el mapa, y el «2» —con el color del segundo— en el gráfico, su leyenda y la matriz de correlación. */
    mocks.rebased.mockImplementation(async (ids: string[]) => ({
      ...SERIE(ids.filter((id) => id !== "B")),
      excluded_assets: ids.includes("B") ? [{ asset_id: "B", reason: "QUALITY_BLOCKED" }] : []
    }));
    await monta(<AssetComparison assets={CINCO.slice(0, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    const series = mocks.lineChart.mock.lastCall?.[0].series as Array<{ id: string; etiquetaFinal: string; puesto: number }>;
    expect(series.map((serie) => serie.id)).toEqual(["A", "C"]);
    expect(series.map((serie) => serie.etiquetaFinal)).toEqual(["1", "3"]);
    expect(series.map((serie) => serie.puesto)).toEqual([0, 2]);
    expect([...container.querySelectorAll(".cmp-legend b")].map((numero) => numero.textContent)).toEqual(["1", "3"]);
    expect([...container.querySelectorAll(".oaa-heatmap-index strong")].map((numero) => numero.textContent)).toEqual(["1", "3"]);
  });

  test("el PDF ya no recibe un color por activo: el papel los identifica por su número", async () => {
    /* Hasta la plantilla nueva del informe recibía «los colores de siempre»; el papel ya no los pinta y no se le pasan. */
    await monta(<AssetComparison assets={CINCO} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await pideElInforme();
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.assets.map((asset: { color?: string }) => asset.color)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  test("el Sharpe de una acción de la base anterior no llega al PDF, y llega el tipo con que escribe «No aplica» (decisión 41)", async () => {
    const accion = activo("ACCION", "STOCK");
    await monta(<AssetComparison assets={[accion, activo("FONDO")]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    const fila = [...container.querySelectorAll("tr")].find((tr) => tr.textContent?.startsWith("Sharpe 3 años"));
    expect(fila?.querySelectorAll("td")[0].textContent).toBe("No aplica");
    expect(fila?.querySelectorAll("td")[1].textContent).toBe("0,98");
    await pideElInforme();
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.assets.map((asset: { sharpe3y?: number }) => asset.sharpe3y)).toEqual([undefined, 0.98]);
    expect(entrada.assets.map((asset: { instrumentType?: string }) => asset.instrumentType)).toEqual(["STOCK", "FUND"]);
  });
});

describe("las dos salidas del informe (decisión 20)", () => {
  const conRetro = new Map([["A", { asset_id: "A", retro_pct: 0.79, status: "CONFIRMED" }]]);
  const monte = async (assets = CINCO.slice(0, 2)) => {
    mocks.retro.mockResolvedValue(conRetro);
    await monta(<AssetComparison assets={assets} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  test("fuera de Modo cliente se pregunta antes de descargar nada, y cerrar no descarga", async () => {
    await monte();
    await act(async () => boton("Descargar el informe")!.click());
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(dialogo()?.textContent).toContain("¿Para quién es este informe?");
    expect([...dialogo()!.querySelectorAll("footer button")].map((b) => b.textContent)).toEqual([
      "Con retrocesiones (uso interno)",
      "Sin retrocesiones (para el cliente)"
    ]);
    await act(async () => dialogo()!.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    expect(dialogo()).toBeNull();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  test("para el cliente, la retrocesión no llega ni al documento", async () => {
    await monte();
    await pideElInforme(/Sin retrocesiones/);
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.salida).toBe("cliente");
    expect(entrada.assets.map((asset: { retro?: unknown }) => asset.retro)).toEqual([undefined, undefined]);
    expect(JSON.stringify(entrada)).not.toContain("0.0079");
    expect(dialogo()).toBeNull();
  });

  test("con retrocesiones, la cifra de la base comercial; lo que falta, sin cifra; y a una acción no le aplica", async () => {
    await monte([CINCO[0], CINCO[1], activo("ACCION", "STOCK")]);
    await pideElInforme(/Con retrocesiones/);
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.salida).toBe("interno");
    expect(entrada.assets.map((asset: { retro?: unknown }) => asset.retro)).toEqual([0.0079, undefined, "no-aplica"]);
  });

  test("H2-05: si se activa el Modo cliente mientras se dibuja el informe con retrocesiones, no se descarga", async () => {
    let puede: (() => boolean) | undefined;
    mocks.pdf.mockImplementation(async (_entrada: unknown, pregunta?: () => boolean) => { puede = pregunta; return true; });
    mocks.retro.mockResolvedValue(conRetro);
    await monta(<ClientModeProvider initialValue={false}><AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" /></ClientModeProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await pideElInforme(/Con retrocesiones/);
    expect(puede?.()).toBe(true);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: CLIENT_MODE_STORAGE_KEY, newValue: "true" })); });
    expect(puede?.()).toBe(false);
  });

  test("mientras la base comercial no ha contestado, o si falla, o si la cuenta no tiene acceso, solo se puede sacar la que no la lleva", async () => {
    mocks.retro.mockReturnValue(new Promise(() => undefined));
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await act(async () => boton("Descargar el informe")!.click());
    expect(opcion(/Con retrocesiones/)?.disabled).toBe(true);
    expect(opcion(/Sin retrocesiones/)?.disabled).toBe(false);
    await act(async () => root.unmount());

    root = createRoot(container);
    mocks.retro.mockRejectedValue(new Error("sin permiso"));
    await monta(<AssetComparison assets={CINCO.slice(1, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => boton("Descargar el informe")!.click());
    expect(opcion(/Con retrocesiones/)?.disabled).toBe(true);
    expect(dialogo()?.querySelector(".async-error-banner")).toBeTruthy();
    await act(async () => root.unmount());

    root = createRoot(container);
    mocks.acceso.mockReturnValue("denied");
    await monta(<AssetComparison assets={CINCO.slice(2, 4)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await act(async () => boton("Descargar el informe")!.click());
    expect(opcion(/Con retrocesiones/)?.disabled).toBe(true);
    expect(dialogo()?.textContent).toContain("no tiene acceso a las retrocesiones");
    await act(async () => opcion(/Sin retrocesiones/)!.click());
    expect(mocks.pdf.mock.lastCall?.[0].salida).toBe("cliente");
  });

  test("con Modo cliente no se pregunta, y siempre sale la que no las lleva", async () => {
    await monta(
      <ClientModeProvider initialValue>
        <AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />
      </ClientModeProvider>
    );
    await act(async () => boton("Descargar el informe")!.click());
    expect(dialogo()).toBeNull();
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.salida).toBe("cliente");
    expect(entrada.assets.every((asset: { retro?: unknown }) => asset.retro === undefined)).toBe(true);
    expect(mocks.retro).not.toHaveBeenCalled();
  });

  test("lo que no se compara sale de las cifras que se imprimen", async () => {
    await monta(
      <AssetComparison
        assets={[
          activo("A", "FUND", { metrics: { sharpe_3y: 0.5, metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY" } }),
          activo("B", "FUND", { metrics: { sharpe_3y: 0.6, metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY" } }),
          activo("C", "FUND", { metrics: { sharpe_3y: 0.7, metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY" } })
        ]}
        onRemove={() => undefined}
        sourceKind="LOCAL_MOCK"
      />
    );
    await pideElInforme();
    const entrada = mocks.pdf.mock.lastCall?.[0];
    expect(entrada.noComparable).toEqual({ columnas: ["sharpe-3y"], sinDeclarar: false });
    expect(entrada.assets.map((asset: { calculo?: string }) => asset.calculo)).toEqual([
      "con datos semanales",
      "con datos mensuales en euros",
      "con datos mensuales en euros"
    ]);
  });

  test("un fondo que reparte llega rotulado y sin cifra final, con el mismo dato que la pantalla (decisión 8)", async () => {
    mocks.rebased.mockImplementation(async (ids: string[]) => {
      const respuesta = SERIE(ids);
      return { ...respuesta, series: respuesta.series.map((serie) => (serie.asset_id === "A" ? { ...serie, sin_dividendos: true } : serie)) };
    });
    await monta(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await pideElInforme();
    const [reparte, acumula] = mocks.pdf.mock.lastCall?.[0].assets as Array<{ sinDividendos?: boolean; base100?: number }>;
    expect(reparte.sinDividendos).toBe(true);
    expect(reparte.base100).toBeUndefined();
    expect(acumula.sinDividendos).toBe(false);
    expect(acumula.base100).toBeCloseTo(100 + FECHAS.length - 1, 8);
  });

  test("con su línea no se mide la correlación, tampoco en papel, y el papel recibe por qué (decisión 53)", async () => {
    mocks.rebased.mockImplementation(async (ids: string[]) => {
      const respuesta = SERIE(ids);
      return { ...respuesta, series: respuesta.series.map((serie) => (serie.asset_id === "A" ? { ...serie, sin_dividendos: true } : serie)) };
    });
    await monta(<AssetComparison assets={CINCO.slice(0, 3)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    await pideElInforme();
    const { correlation } = mocks.pdf.mock.lastCall?.[0] as { correlation: { labels: string[]; matrix: (number | null)[][]; noSeMide: boolean[]; nota: string } };
    expect(correlation.labels).toEqual(["Activo A", "Activo B", "Activo C"]);
    expect(correlation.noSeMide).toEqual([true, false, false]);
    expect(correlation.matrix[0][1]).toBeNull();
    expect(correlation.matrix[2][0]).toBeNull();
    expect(correlation.matrix[0][0]).toBe(1);
    /* B y C siguen midiéndose entre ellos. */
    expect(correlation.matrix[1][2]).not.toBeNull();
    expect(correlation.nota).toContain("No se mide la correlación de Activo A");
  });
});

describe("la selección", () => {
  test("un solo contador y un solo mensaje vacío", async () => {
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(container.textContent?.match(/\d\/5 seleccionados/g)).toEqual(["0/5 seleccionados"]);
    expect(container.textContent).toContain("Selecciona dos activos para empezar");
    expect(container.textContent).not.toContain("Añade activos para comparar");
  });

  test("no quedan índices en ninguna frase ni en el filtro: no hay ninguno en ninguna base", async () => {
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(container.textContent?.toLocaleLowerCase("es")).not.toContain("índices");
    expect(boton("Índices")).toBeUndefined();
    for (const tipo of ["Todos", "Fondos", "ETF", "Acciones"]) expect(boton(tipo)).toBeTruthy();
  });

  test("«Añadir» y «×» son dos botones con nombre propio, y el nombre no se corta", async () => {
    const nombre = "DPAM B - Equities NewGems Sustainable B Cap";
    const add = vi.fn();
    await monta(
      <AssetComparison
        assets={[activo("A", "FUND", { display_name: nombre }), activo("B")]}
        onAddToPortfolio={add}
        onRemove={() => undefined}
        sourceKind="LOCAL_MOCK"
      />
    );
    const distintivo = container.querySelector(".cmp-chip")!;
    expect(distintivo.querySelector(".cmp-chip-name")?.textContent).toBe(nombre);
    const botones = [...distintivo.querySelectorAll("button")];
    expect(botones.map((b) => b.textContent)).toEqual(["Añadir", "×"]);
    expect(botones[0].getAttribute("aria-label")).toBe(`Añadir a la propuesta: ${nombre}`);
    expect(botones[1].getAttribute("aria-label")).toBe(`Quitar ${nombre} de la comparación`);
    await act(async () => botones[0].click());
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("volver al Comparador", () => {
  test("abre en la pestaña en la que se estaba", async () => {
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    const pestana = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Patrimonial");
    await act(async () => pestana!.click());
    expect(container.querySelector("#comparison-tab-wealth")?.getAttribute("aria-selected")).toBe("true");
    await act(async () => root.unmount());
    root = createRoot(container);
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(container.querySelector("#comparison-tab-wealth")?.getAttribute("aria-selected")).toBe("true");
  });

  test("la pestaña va en la dirección: se escribe al elegirla y se recupera al recargar", async () => {
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    const pestanas = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(pestanas.map((tab) => tab.textContent)).toEqual(["Activos", "Propuestas", "Patrimonial"]);
    await act(async () => pestanas[1].click());
    expect(window.location.hash).toBe("#pestana=propuestas");
    expect(container.querySelector("#comparison-panel-portfolios")?.getAttribute("role")).toBe("tabpanel");
    /* Al recargar con la dirección compartida, en otra sesión: manda la dirección. */
    await act(async () => root.unmount());
    clearSessionCaches();
    window.history.replaceState(null, "", "/comparador#pestana=patrimonial");
    root = createRoot(container);
    await monta(<AssetComparison assets={[]} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />);
    expect(container.querySelector("#comparison-tab-wealth")?.getAttribute("aria-selected")).toBe("true");
  });

  test("la vista previa del comparador ya no es una dirección (decisión 26)", () => {
    expect(isAppRouteId("comparador-nuevo")).toBe(false);
  });
});

describe("con Modo cliente", () => {
  const conCliente = (nodo: ReactNode) => <ClientModeProvider initialValue>{nodo}</ClientModeProvider>;

  test("se quedan las fechas reales y el número de datos de la evolución", async () => {
    await monta(conCliente(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />));
    expect(container.textContent).toContain("Del 26/10/2023 al 27/10/2026 · 718 datos diarios");
  });

  test("no dice de qué base salen las cifras, ni habla de retrocesiones", async () => {
    await monta(conCliente(<AssetComparison assets={CINCO.slice(0, 2)} onRemove={() => undefined} sourceKind="LOCAL_MOCK" />));
    const texto = container.textContent?.toLocaleLowerCase("es") ?? "";
    expect(texto).not.toContain("base nueva");
    expect(texto).not.toContain("base anterior");
    expect(texto).not.toContain("base de siempre");
    expect(texto).not.toContain("retro");
  });
});

/*
 * ACT-01 (auditoría de frontend, 13-11-2026): el Comparador tenía su propia regla para «A cartera» y solo
 * bloqueaba lo que ya estaba o no era invertible. Ahora usa la regla común, la de la ficha: por cada marca,
 * la misma etiqueta y el mismo estado del botón que da la ficha para ese activo.
 */
describe("añadir a cartera desde el Comparador dice y permite lo mismo que la ficha", () => {
  const CASOS: Array<{ caso: string; extra: Partial<BdbAssetDetail>; id?: string; enCartera?: boolean; etiqueta: string; bloqueado: boolean; aviso?: string }> = [
    { caso: "sin marcas", extra: {}, etiqueta: "Añadir", bloqueado: false },
    { caso: "ya en la cartera", extra: {}, enCartera: true, etiqueta: "Añadido", bloqueado: true },
    { caso: "dado de baja por una operación corporativa", extra: { quality_flags: ["NON_INVESTABLE_CORPORATE_ACTION"] }, etiqueta: "No disponible", bloqueado: true },
    { caso: "suspendido", extra: { quality_flags: ["NON_INVESTABLE_SUSPENDED"] }, etiqueta: "No disponible", bloqueado: true },
    { caso: "excluido de cotización", extra: { quality_flags: ["NON_INVESTABLE_DELISTED"] }, etiqueta: "No disponible", bloqueado: true },
    { caso: "excluido y valorado a precio congelado", extra: { quality_flags: ["NON_INVESTABLE_DELISTED", "PRICE_FROZEN_DELISTED"] }, etiqueta: "Añadir", bloqueado: false },
    { caso: "cerrado a suscripciones", extra: { quality_flags: ["NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"] }, etiqueta: "No disponible", bloqueado: true },
    { caso: "nunca resuelto", extra: { quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED"] }, etiqueta: "No disponible", bloqueado: true },
    /* Decisión de Óscar del 14-11-2026: lo bloqueado por calidad del dato se puede añadir, y se avisa junto al botón. El
       servidor lo manda «no invertible» (segunda fila, la forma real de Deoleo): eso ya no lo bloquea. */
    { caso: "bloqueado por calidad del dato", extra: { quality_flags: ["QUALITY_BLOCKED"] }, etiqueta: "Añadir", bloqueado: false, aviso: "Sin datos fiables para medirlo" },
    { caso: "bloqueado por calidad del dato, como lo manda el servidor", extra: { is_investable: false, quality_flags: ["QUALITY_BLOCKED"] }, etiqueta: "Añadir", bloqueado: false, aviso: "Sin datos fiables para medirlo" },
    { caso: "bloqueado por calidad del dato y además suspendido", extra: { is_investable: false, quality_flags: ["QUALITY_BLOCKED", "NON_INVESTABLE_SUSPENDED"] }, etiqueta: "No disponible", bloqueado: true },
    { caso: "no invertible", extra: { is_investable: false }, etiqueta: "Benchmark", bloqueado: true },
    { caso: "con papel de benchmark", extra: { role: "BENCHMARK" }, etiqueta: "Benchmark", bloqueado: true },
    { caso: "fondo base de las carteras de referencia", extra: {}, id: "IE00B18GC888", etiqueta: "Benchmark", bloqueado: true }
  ];

  test.each(CASOS)("$caso: «$etiqueta», bloqueado $bloqueado", async ({ extra, id = "A", enCartera = false, etiqueta, bloqueado, aviso }) => {
    const { activoParaLaAccion, accionDeCarteraBloqueada, avisoDeAccionDeCartera, etiquetaDeAccionDeCartera } = await import("../src/core/accionDeCartera");
    const elActivo = activo(id, "FUND", extra);
    /* Lo que da la ficha para el mismo activo, con su raíz diciendo que cotiza. */
    const enLaFicha = activoParaLaAccion(id, { availability: { state: "TRADING" } }, elActivo);
    expect(etiquetaDeAccionDeCartera(enLaFicha, enCartera)).toBe(etiqueta);
    expect(accionDeCarteraBloqueada(enLaFicha, enCartera)).toBe(bloqueado);
    expect(avisoDeAccionDeCartera(enLaFicha)).toBe(aviso ?? null);

    const add = vi.fn();
    await monta(
      <AssetComparison
        assets={[elActivo, activo("B")]}
        onAddToPortfolio={add}
        onRemove={() => undefined}
        portfolioAssetIds={enCartera ? [id] : []}
        sourceKind="LOCAL_MOCK"
      />
    );
    const accion = container.querySelector(".cmp-chip")!.querySelector<HTMLButtonElement>("button")!;
    expect(accion.textContent).toBe(etiqueta);
    expect(accion.disabled).toBe(bloqueado);
    /* El aviso se lee junto al botón, en la misma ficha del activo comparado, y solo donde toca. */
    const avisoPintado = container.querySelector(".cmp-chip")!.querySelector(".ausencia--falta")?.textContent ?? null;
    expect(avisoPintado).toBe(aviso ?? null);
    await act(async () => accion.click());
    expect(add).toHaveBeenCalledTimes(bloqueado ? 0 : 1);
  });
});
