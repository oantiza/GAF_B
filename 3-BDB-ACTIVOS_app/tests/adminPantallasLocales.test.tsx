// @vitest-environment happy-dom

/**
 * Las pestañas de Sistema que solo existen en local (hallazgo 148, 04-11-2026): Calidad de fondos
 * paginada, con la ficha bajo su fila, e Inspección, que deja «No llega a 2011» como un dato.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ calidad: vi.fn(), ficha: vi.fn(), activos: vi.fn(), detalle: vi.fn() }));
vi.mock("../src/adapters/fundQualityBackend", () => ({ fetchFundQuality: mocks.calidad, fetchFundProfile: mocks.ficha }));
vi.mock("../src/adapters/adminBackend", () => ({
  canApplyRefreshAssetPrices: () => false,
  describeHistoryRebuild: () => null,
  fetchAdminAssets: mocks.activos,
  fetchAdminAssetDetail: mocks.detalle,
  recomputeMetric: vi.fn(),
  refreshAssetPrices: vi.fn()
}));

import { AdminFundQuality } from "../src/components/AdminFundQuality";
import { AdminInspector } from "../src/components/AdminInspector";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const reposar = () =>
  act(async () => {
    await new Promise((listo) => setTimeout(listo, 0));
  });
const boton = (texto: string, dentro: ParentNode = host) =>
  [...dentro.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

const fondo = (i: number) => ({
  isin: `LU${String(i).padStart(10, "0")}`,
  name: `Fondo ${String(i).padStart(3, "0")}`,
  history_first_date: "2020-01-01",
  history_last_date: "2026-10-23",
  history_observations: 1500,
  holdings_date: "2026-05-31",
  holdings_count: 40,
  has_profile: true,
  has_kid: true,
  flags: [],
  history_blocked: false,
  report_date: "2026-06-30",
  reference_history_observations: 0,
  reference_history_first_date: null,
  reference_history_last_date: null
});

describe("Calidad de fondos", () => {
  beforeEach(() => {
    mocks.calidad.mockReset().mockResolvedValue({
      generated_at: "2026-11-04T10:00:00Z",
      total_funds: 120,
      with_profile: 120,
      with_history: 120,
      history_blocked: 0,
      with_kid: 120,
      with_monthly_reference: 0,
      rows: Array.from({ length: 120 }, (_, i) => fondo(i))
    });
    mocks.ficha.mockReset().mockResolvedValue({ ISIN: "LU0000000052", Gestora: "MFS", "Fecha del KID": "2025-12-12" });
  });

  const filas = () => host.querySelectorAll(".tabla tbody tr:not(.tabla__detalle)").length;

  test("se pagina como Inspección: 765 filas sin paginar eran 80.860 px de alto", async () => {
    await act(async () => root!.render(<AdminFundQuality />));
    await reposar();
    expect(filas()).toBe(50);
    expect(host.querySelector(".tabla__paginas")?.textContent).toContain("1–50 de 120");
    expect(host.textContent).toContain("120 fondos en esta selección.");
  });

  test("«Ver ficha» la abre bajo su fila, y no saca de la página en que estás", async () => {
    await act(async () => root!.render(<AdminFundQuality />));
    await reposar();
    await act(async () => boton("Siguiente")!.click());
    const fila = [...host.querySelectorAll(".tabla tbody tr")].find((tr) => tr.textContent?.includes("LU0000000052"))!;
    await act(async () => boton("Ver ficha", fila)!.click());
    await reposar();

    expect(mocks.ficha).toHaveBeenCalledWith("LU0000000052");
    const detalle = host.querySelector(".tabla__detalle")!;
    expect(detalle.previousElementSibling).toBe([...host.querySelectorAll(".tabla tbody tr")].find((tr) => tr.textContent?.includes("LU0000000052")));
    expect(host.querySelector(".tabla__paginas strong")?.textContent).toBe("2 de 3");
    expect(detalle.textContent).toContain("LU0000000052");
    expect(detalle.textContent).not.toContain("Lu0000000052");
    /* PLA-12: la fecha, con el formato común (antes «12 dic 2025»). */
    expect(detalle.textContent).toContain("12/12/2025");

    await act(async () => boton("Cerrar ficha")!.click());
    expect(host.querySelector(".tabla__detalle")).toBeNull();
  });

  /* 14-11-2026, medido a 768 px al abrir el recorrido esta pestaña por primera vez: el nombre se quedaba con 137 px y
     el motivo con 150, y cada fondo ocupaba 231 px de alto (50 fondos, 11.873 px de página). Ahora las dos columnas
     declaran lo que son y no bajan de su ancho: la tabla desplaza dentro de su marco. */
  test("el nombre y el motivo declaran lo que son, para que la tabla no los apriete en una pantalla estrecha", async () => {
    await act(async () => root!.render(<AdminFundQuality />));
    await reposar();
    const titulos = [...host.querySelectorAll<HTMLElement>(".tabla thead th")];
    const clasesDe = (titulo: string) => titulos.find((th) => th.textContent?.trim() === titulo)?.className ?? "";
    expect(clasesDe("Fondo / ISIN")).toContain("tabla__celda--nombre");
    expect(clasesDe("Revisión pendiente")).toContain("tabla__celda--prosa");
    expect(clasesDe("Posiciones")).not.toMatch(/tabla__celda--(nombre|prosa)/);
    /* Y cada celda de esas columnas lleva la misma clase que su título. */
    const primera = host.querySelector(".tabla tbody tr")!;
    expect(primera.querySelectorAll(".tabla__celda--nombre")).toHaveLength(1);
    expect(primera.querySelectorAll(".tabla__celda--prosa")).toHaveLength(1);
  });

  test("filtrar vuelve a la primera página y cuenta lo que queda", async () => {
    await act(async () => root!.render(<AdminFundQuality />));
    await reposar();
    await act(async () => boton("Siguiente")!.click());
    const buscar = host.querySelector<HTMLInputElement>('input[placeholder="Nombre o ISIN"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(buscar, "Fondo 01");
      buscar.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("10 fondos en esta selección.");
    expect(filas()).toBe(10);
  });
});

describe("Inspección", () => {
  const activo = (over: object) => ({
    asset_id: "ES0105046009", name: "ES0105046009", type: "STOCK", symbol: "AENA.MC", first_date: "2015-02-11", last_date: "2026-10-23",
    points: 2994, years: 11, flags: [] as string[], ...over
  });

  const pintar = async (items: object[]) => {
    mocks.activos.mockReset().mockResolvedValue({ items, total: items.length, offset: 0 });
    await act(async () => root!.render(<AdminInspector />));
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 5));
    });
  };

  test("sin nombres en la base, la columna se llama por lo que enseña", async () => {
    await pintar([activo({})]);
    expect(host.querySelector(".inspector-table th")?.textContent).toBe("ISIN");
  });

  test("la columna «Hasta» dice su orden con aria-sort, y las flechas no se leen (PLA-20)", async () => {
    await pintar([activo({})]);
    const cabecera = [...host.querySelectorAll(".inspector-table th")].find((th) => th.textContent?.includes("Hasta"))!;
    expect(cabecera.getAttribute("aria-sort")).toBeNull();
    expect(cabecera.querySelector("button")?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await act(async () => cabecera.querySelector("button")!.click());
    await reposar();
    const despues = [...host.querySelectorAll(".inspector-table th")].find((th) => th.textContent?.includes("Hasta"))!;
    expect(["ascending", "descending"]).toContain(despues.getAttribute("aria-sort"));
  });

  test("con nombres, «Nombre»", async () => {
    await pintar([activo({ name: "Aena" }), activo({ asset_id: "X", name: "" })]);
    expect(host.querySelector(".inspector-table th")?.textContent).toBe("Nombre");
  });

  test("«No llega a 2011» es un dato de los años, no un aviso; los avisos de verdad siguen siéndolo", async () => {
    await pintar([activo({ flags: ["NO_LLEGA_2011", "VALLE_RECIENTE"] })]);
    const celdas = host.querySelectorAll(".inspector-table tbody td");
    expect(celdas[6].textContent).toContain("11");
    expect(celdas[6].querySelector(".inspector-dato")?.textContent).toBe("No llega a 2011");
    expect([...celdas[7].querySelectorAll(".distintivo")].map((b) => b.textContent)).toEqual(["Valle reciente"]); /* Rediseño: el aviso de la fila es un `Distintivo`. */
  });

  test("el detalle de inspección se abre con el teclado desde su fila, y el nombre sigue llevando a la ficha", async () => {
    mocks.detalle.mockReset().mockResolvedValue({
      meta: activo({ name: "Aena", currency: "EUR" }),
      identifiers: {},
      classification: {},
      max_drawdown_5y: null,
      max_drawdown_hist: null,
      series: { first_date: "2015-02-11", last_date: "2026-10-23", points: 2994, big_gaps_count: 0, big_gaps: [], duplicates: 0, non_positive: 0 }
    });
    await pintar([activo({ name: "Aena" })]);
    const fila = host.querySelector(".inspector-table tbody tr")!;
    /* La fila tiene su propio botón, que es lo que se alcanza con el tabulador y se pulsa con Intro o Espacio. */
    const inspeccionar = [...fila.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Inspeccionar");
    expect(inspeccionar).toBeDefined();
    expect(inspeccionar!.getAttribute("aria-expanded")).toBe("false");
    inspeccionar!.focus();
    expect(document.activeElement).toBe(inspeccionar);
    /* Un botón nativo convierte Intro en un clic: es lo que hace el navegador al pulsarlo con el teclado. */
    await act(async () => inspeccionar!.click());
    await reposar();
    expect(mocks.detalle).toHaveBeenCalledWith("ES0105046009");
    expect(inspeccionar!.getAttribute("aria-expanded")).toBe("true");
    const detalle = document.getElementById(inspeccionar!.getAttribute("aria-controls")!);
    expect(detalle).not.toBeNull();
    expect(detalle!.querySelector(".panel__title")?.textContent).toBe("Aena");
    /* Al abrirse, el foco va a su título: el detalle queda a la vista aunque esté debajo de la paginación. */
    expect(detalle!.querySelector(".panel__title")!.contains(document.activeElement)).toBe(true);
    /* El mismo botón lo cierra, y el foco vuelve a él. */
    await act(async () => inspeccionar!.click());
    expect(inspeccionar!.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".inspector .panel")).toBeNull();
    expect(document.activeElement).toBe(inspeccionar);
    /* El nombre sigue siendo un enlace aparte, a la ficha del activo. */
    expect(fila.querySelector("a.enlace-a-ficha")?.textContent).toBe("Aena");
  });

  test("los huecos de la serie llevan sus fechas como las demás, no en ISO (PLA-12)", async () => {
    mocks.detalle.mockReset().mockResolvedValue({
      meta: activo({ name: "Aena", currency: "EUR" }),
      identifiers: {},
      classification: {},
      max_drawdown_5y: null,
      max_drawdown_hist: null,
      series: {
        first_date: "2015-02-11", last_date: "2026-10-23", points: 2994, duplicates: 0, non_positive: 0,
        big_gaps_count: 1, big_gaps: [{ from: "2025-12-19", to: "2026-01-02", days: 14 }]
      }
    });
    await pintar([activo({ name: "Aena" })]);
    const inspeccionar = [...host.querySelectorAll(".inspector-table tbody tr button")].find((b) => b.textContent?.trim() === "Inspeccionar")!;
    await act(async () => inspeccionar.click());
    await reposar();
    const huecos = [...host.querySelectorAll(".inspector-gaps li")].map((li) => li.textContent);
    expect(huecos).toEqual(["19/12/2025 → 02/01/2026 (14 días)"]);
    expect(host.querySelector(".inspector-gaps")?.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
