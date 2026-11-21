// @vitest-environment happy-dom

/**
 * Decisión A-167 de Óscar (16-11-2026), ante RET-2 de la auditoría integral: la retrocesión dudosa no se tapa en cada
 * pantalla, se corrige en los datos, en Administración. Aquí se comprueba la lista de lo que hay que mirar —los
 * registros cuya retrocesión supera lo que cobra su fondo— y que la pantalla la enseña y deja quedarse solo con ella.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loQueCobraElFondo, retrocesionesQueSuperanLoQueCobra, type LoQueCobraElFondo } from "../src/core/commercialRetroEffective";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";

const registro = (isin: string, retro_pct: number, extra: Partial<CommercialRetroRecord> = {}): CommercialRetroRecord =>
  ({ isin, retro_pct, as_of_date: "2026-06-30", source: "ADMIN_UI", ...extra });

describe("la lista de retrocesiones que superan lo que cobra su fondo", () => {
  /* Las comisiones van en tanto por uno, como en la ficha; la retrocesión, en puntos porcentuales, como en la base. */
  const cobran = new Map<string, LoQueCobraElFondo>([
    ["CABE", { comisionDeGestion: 0.012, gastosCorrientes: 0.015 }],
    ["JUSTA", { comisionDeGestion: null, gastosCorrientes: 0.015 }],
    ["ESCALA", { comisionDeGestion: 0.012, gastosCorrientes: 0.015 }],
    ["SOLO_GESTION", { comisionDeGestion: 0.008, gastosCorrientes: null }],
    ["SIN_COSTES", { comisionDeGestion: null, gastosCorrientes: null }],
    ["PENDIENTE", { comisionDeGestion: 0.01, gastosCorrientes: 0.011 }]
  ]);

  test("entra la que supera los gastos corrientes o, si no los hay, la comisión de gestión; de mayor a menor", () => {
    const lista = retrocesionesQueSuperanLoQueCobra(
      [
        registro("CABE", 0.6), //          0,60 % frente a 1,50 %: cabe
        registro("JUSTA", 1.5), //         1,50 % frente a 1,50 %: igual no es más
        registro("ESCALA", 46), //         46 % frente a 1,50 %: es un porcentaje de la comisión, no del patrimonio
        registro("SOLO_GESTION", 0.9), //  0,90 % frente a 0,80 % de gestión, que es lo único que trae la ficha
        registro("SIN_COSTES", 46), //     la ficha no dice lo que cobra: sin con qué comparar no se juzga
        registro("SIN_FICHA", 46), //      ni siquiera está en el catálogo
        registro("PENDIENTE", 30, { status: "PENDING_CONFIRMATION" }) // pendiente de confirmar: también hay que mirarla
      ],
      cobran
    );
    expect(lista).toEqual([
      { isin: "ESCALA", pct: 46, tope: 0.015, frenteA: "gastos corrientes" },
      { isin: "PENDIENTE", pct: 30, tope: 0.011, frenteA: "gastos corrientes" },
      { isin: "SOLO_GESTION", pct: 0.9, tope: 0.008, frenteA: "comisión de gestión" }
    ]);
  });

  test("lo que cobra un fondo sale de su ficha, y de una acción no se cree aunque lo traiga", () => {
    expect(loQueCobraElFondo({ instrument_type: "FUND", costs: { management_fee: 0.012, ongoing_charge: 0.015 } } as never))
      .toEqual({ comisionDeGestion: 0.012, gastosCorrientes: 0.015 });
    /* Un cero no es una comisión: es un dato que falta. */
    expect(loQueCobraElFondo({ instrument_type: "ETF", costs: { management_fee: 0, ongoing_charge: 0.002 } } as never))
      .toEqual({ comisionDeGestion: null, gastosCorrientes: 0.002 });
    expect(loQueCobraElFondo({ instrument_type: "FUND" } as never)).toEqual({ comisionDeGestion: null, gastosCorrientes: null });
    expect(loQueCobraElFondo({ instrument_type: "STOCK", costs: { ongoing_charge: 0.01 } } as never)).toBeNull();
    expect(loQueCobraElFondo(null)).toBeNull();
  });
});

const EXISTING: CommercialRetroRecord[] = [registro("IE00B4L5Y983", 0.45), registro("IE00B18GC888", 46), registro("LU0404220724", 0.3)];
const FICHAS = new Map([
  ["IE00B4L5Y983", { display_name: "Fondo A Acc EUR", instrument_type: "FUND", costs: { management_fee: 0.012, ongoing_charge: 0.015 } }],
  ["IE00B18GC888", { display_name: "Fondo B Acc EUR", instrument_type: "FUND", costs: { management_fee: 0.012, ongoing_charge: 0.015 } }],
  ["LU0404220724", { display_name: "Fondo sin costes en la ficha", instrument_type: "FUND" }]
]);

const store = vi.hoisted(() => ({
  getCommercialRetroList: vi.fn(),
  getLastCommercialRetroImport: vi.fn(),
  applyCommercialRetroImport: vi.fn(),
  undoCommercialRetroImport: vi.fn(),
  saveCommercialRetro: vi.fn(),
  deleteCommercialRetro: vi.fn()
}));
vi.mock("../src/adapters/commercialRetroStore", () => store);
vi.mock("../src/firebaseEnv", () => ({ FIREBASE_CONFIGURED: true, PRODUCCION_SIN_CONFIGURAR: false, APUNTA_A_BDB: false }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    getComparableAssets: async (ids: string[]) => ids.filter((id) => FICHAS.has(id)).map((id) => ({ asset_id: id, isin: id, ...FICHAS.get(id) }))
  })
}));

import { AdminRetrocessions } from "../src/components/AdminRetrocessions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sistema · Retrocesiones · las que superan lo que cobra su fondo", () => {
  let container: HTMLDivElement;
  let root: Root;
  const texto = () => (container.textContent || "").replace(/\s+/g, " ");
  const filas = () => [...container.querySelectorAll(".retro-table tbody tr")];
  const boton = (empieza: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(empieza)) as HTMLButtonElement | undefined;
  const pulsa = (b: HTMLElement) => act(async () => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  beforeEach(async () => {
    store.getCommercialRetroList.mockReset().mockResolvedValue(EXISTING);
    store.getLastCommercialRetroImport.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(AdminRetrocessions)); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  test("la fila lo dice con la cifra del fondo, y un botón deja solo esas", async () => {
    expect(filas()).toHaveLength(3);
    /* 46 frente a un fondo que cobra el 1,50 % de gastos corrientes. La frase va bajo el nombre, que es donde cabe; junto
       a la cifra no hay otra marca, que la estrecha. Las otras dos filas no llevan ninguna: una cabe y de la otra la
       ficha no dice lo que cobra. */
    const marcas = [...container.querySelectorAll(".retro-outlier")].map((m) => (m.textContent || "").replace(/\s+/g, " ").trim());
    expect(marcas).toEqual(["Su retrocesión supera el 1,50 % de gastos corrientes del fondo"]);

    await pulsa(boton("Ver la que supera lo que cobra su fondo")!);
    expect(filas()).toHaveLength(1);
    expect(filas()[0].textContent).toContain("IE00B18GC888");
    expect(texto()).toContain("1 de 3 fondos · Solo las que superan lo que cobra su fondo");

    await pulsa(boton("Ver todas")!);
    expect(filas()).toHaveLength(3);
  });

  test("sin ninguna que lo supere, el botón no aparece", async () => {
    await act(async () => { root.unmount(); });
    store.getCommercialRetroList.mockResolvedValue([registro("IE00B4L5Y983", 0.45)]);
    root = createRoot(container);
    await act(async () => { root.render(createElement(AdminRetrocessions)); });
    expect(boton("Ver la")).toBeUndefined();
    expect(container.querySelectorAll(".retro-outlier")).toHaveLength(0);
  });
});
