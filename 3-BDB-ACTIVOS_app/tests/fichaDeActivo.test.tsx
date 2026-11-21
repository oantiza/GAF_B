// @vitest-environment happy-dom

/**
 * La ficha es una pantalla propia (hallazgos 17 y 137 de la auditoría del 04-11-2026).
 *
 * Lo que estas pruebas fijan: que mientras llega solo se vea «Cargando la ficha…», que la ficha
 * anterior salga únicamente si la base nueva no conoce el instrumento, y que un enlace mal copiado y
 * una caída de la red se expliquen, cada uno con lo suyo. Y lo de siempre: cuando la nueva se pinta,
 * no se pierde nada de la anterior.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { decidirFicha } from "../src/adapters/decidirFicha";

const mocks = vi.hoisted(() => ({
  disponible: { value: true },
  leerInstrumento: vi.fn(),
  getAssetDetail: vi.fn()
}));

vi.mock("../src/adapters/baseNuevaLectura", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/adapters/baseNuevaLectura")>()),
  get BASE_NUEVA_DISPONIBLE() {
    return mocks.disponible.value;
  },
  leerInstrumento: mocks.leerInstrumento
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getAssetDetail: mocks.getAssetDetail, getAssetHoldings: async () => null })
}));
vi.mock("../src/pages/AssetDetailPage", () => ({
  AssetDetailPage: ({ asset }: { asset: { asset_id: string } }) =>
    createElement("output", { id: "anterior" }, `Ficha anterior de ${asset.asset_id}`)
}));
vi.mock("../src/components/AssetHistoryChart", () => ({
  AssetHistoryChart: () => createElement("output", { id: "evolucion" }, "Evolución")
}));

import { InstrumentoDesconocido } from "../src/adapters/baseNuevaLectura";
import { FichaDeActivo } from "../src/components/ficha/FichaDeActivo";

const ACTIVO = {
  asset_id: "LU0011889846",
  display_name: "Un fondo",
  is_investable: true,
  quality_flags: [],
  fundamentals_summary: { source: "yahoo", currency: "EUR", valuation: { market_cap: 331023450112 } }
};

/** Lo mínimo que `componerFicha` necesita para dar una ficha pintable. */
const INSTRUMENTO = {
  isin: "LU0011889846",
  raiz: {
    identity: { name: "Un fondo de prueba", currency: "EUR" },
    instrument_type: "FUND"
  },
  tarjeta: { instrument_id: "LU0011889846" },
  calidad: undefined,
  bloques: {}
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.disponible.value = true;
  mocks.leerInstrumento.mockReset();
  mocks.getAssetDetail.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const PROPS = {
  assetId: "LU0011889846",
  sourceKind: "LOCAL_MOCK",
  enCartera: false,
  enComparacion: false,
  comparacionLlena: false,
  onAnadirACartera: () => undefined,
  onAlternarComparacion: () => undefined,
  onIrAlBuscador: () => undefined,
  vuelta: { etiqueta: "Ir al Buscador", direccion: "/buscador", alVolver: () => undefined }
};

async function reposar() {
  for (let vuelta = 0; vuelta < 6; vuelta += 1) {
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
  }
}

async function montar(props: Record<string, unknown> = {}) {
  await act(async () => {
    root!.render(createElement(FichaDeActivo, { ...PROPS, ...props } as never));
  });
  await reposar();
}

const nueva = () => host.querySelector(".ficha");
const anterior = () => host.querySelector("#anterior");
const titulo = () => host.querySelector("h1")?.textContent;
const boton = (texto: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

describe("qué se pinta, según lo que contesten las dos lecturas", () => {
  const conoce = { estado: "lo-conoce", instrumento: "I" } as const;
  const tiene = { estado: "lo-conoce", activo: "A" } as const;
  const esperando = { estado: "esperando" } as const;
  const noContesta = { estado: "no-contesta" } as const;
  const noLoConoce = { estado: "no-lo-conoce" } as const;

  test.each([
    ["la base nueva lo conoce: la ficha, sin esperar a la otra", conoce, esperando, { pantalla: "ficha", instrumento: "I", activo: null }],
    ["y si la otra ha llegado, con lo suyo", conoce, tiene, { pantalla: "ficha", instrumento: "I", activo: "A" }],
    ["y si la otra ha fallado, también", conoce, noContesta, { pantalla: "ficha", instrumento: "I", activo: null }],
    ["mientras la base nueva no contesta, cargando, aunque la otra ya lo tenga", esperando, tiene, { pantalla: "cargando" }],
    ["si la base nueva no responde, no se cae a la anterior", noContesta, tiene, { pantalla: "no-se-pudo-leer" }],
    ["la anterior, solo si la base nueva no lo conoce", noLoConoce, tiene, { pantalla: "anterior", activo: "A" }],
    ["no lo conoce nadie: no existe", noLoConoce, noLoConoce, { pantalla: "no-existe" }],
    ["no lo conoce una y la otra no responde: no se puede afirmar que no exista", noLoConoce, noContesta, { pantalla: "no-se-pudo-leer" }],
    ["no lo conoce una y la otra no ha contestado: cargando", noLoConoce, esperando, { pantalla: "cargando" }]
  ])("%s", (_caso, baseNueva, activo, esperado) => {
    expect(decidirFicha(baseNueva, activo)).toEqual(esperado);
  });
});

describe("la pantalla", () => {
  test("mientras llega enseña «Cargando la ficha…» y nada más", async () => {
    mocks.leerInstrumento.mockReturnValue(new Promise(() => undefined));
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(host.textContent).toContain("Cargando la ficha…");
    expect(anterior()).toBeNull();
    expect(nueva()).toBeNull();
  });

  test("la ficha no espera a la lectura lenta: lo que tarda en llegar se añade después", async () => {
    /* Es la que arranca en frío en la web publicada, y de ella solo salen los fundamentales. */
    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    let contesta: (activo: unknown) => void = () => undefined;
    mocks.getAssetDetail.mockReturnValue(new Promise((listo) => { contesta = listo; }));
    await montar();
    expect(nueva()).not.toBeNull();
    expect(host.textContent).not.toContain("Valoración");
    await act(async () => contesta(ACTIVO));
    await reposar();
    expect(host.textContent).toContain("Valoración");
  });

  test("cuando la base nueva contesta, se pinta la ficha nueva y nunca la anterior", async () => {
    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(nueva()).not.toBeNull();
    expect(anterior()).toBeNull();
    expect(titulo()).toBe("Un fondo de prueba");
  });

  test("conserva los botones y la evolución, y lleva los fundamentales del emisor", async () => {
    /* Si esto falla, la sustitución le ha quitado al asesor algo que tenía. */
    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(host.querySelector(".ficha__acciones")?.textContent).toContain("Añadir");
    expect(host.querySelector("#evolucion")).not.toBeNull();
    expect(host.textContent).toContain("Capitalización");
    expect(host.textContent).toContain("Yahoo Finance");
  });

  test("añadir manda el nombre con el ISIN, y comparar el ISIN", async () => {
    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    mocks.getAssetDetail.mockResolvedValue(null);
    const anadidos: unknown[] = [];
    const comparados: unknown[] = [];
    await montar({
      onAnadirACartera: (activo: unknown) => anadidos.push(activo),
      onAlternarComparacion: (id: unknown) => comparados.push(id)
    });
    await act(async () => boton("Añadir")!.click());
    await act(async () => boton("Comparar")!.click());
    expect(anadidos).toEqual([{ asset_id: "LU0011889846", display_name: "Un fondo de prueba" }]);
    expect(comparados).toEqual(["LU0011889846"]);
  });

  test("lo que dejó de cotizar no se ofrece: «No disponible», y no «Benchmark»", async () => {
    mocks.leerInstrumento.mockResolvedValue({
      ...INSTRUMENTO,
      raiz: { ...INSTRUMENTO.raiz, availability: { state: "DELISTED", since: "2026-09-21" } }
    });
    mocks.getAssetDetail.mockResolvedValue(null);
    await montar();
    expect(host.textContent).toContain("Dejó de cotizar");
    expect(boton("No disponible")?.disabled).toBe(true);
    expect(boton("Añadir")).toBeUndefined();
  });

  test("lo que nunca se resolvió se marca con su motivo y no se ofrece ni añadir ni comparar (decisión 44)", async () => {
    mocks.leerInstrumento.mockResolvedValue({
      ...INSTRUMENTO,
      raiz: { ...INSTRUMENTO.raiz, availability: { state: "NEVER_RESOLVED", since: "2026-11-02" } }
    });
    /* La otra lectura lo da por invertible: la base vieja no tiene el estado. Gana lo que dice esta. */
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(host.querySelector(".ficha__disponibilidad")?.textContent).toBe("No se añade: sin precio ni métricas.");
    expect(boton("No disponible")?.disabled).toBe(true);
    expect(boton("Añadir")).toBeUndefined();
    expect(boton("Comparar")?.disabled).toBe(true);
    expect(host.textContent).not.toContain("Sin medir");
  });

  test("si ya estaba en la comparación, se puede quitar", async () => {
    mocks.leerInstrumento.mockResolvedValue({
      ...INSTRUMENTO,
      raiz: { ...INSTRUMENTO.raiz, availability: { state: "NEVER_RESOLVED" } }
    });
    mocks.getAssetDetail.mockResolvedValue(null);
    await montar({ enComparacion: true });
    expect(boton("Quitar de la comparación")?.disabled).toBe(false);
  });

  test("un instrumento que la base nueva no conoce sale con la ficha anterior, sin error", async () => {
    /* No es un caso de transición: los dos catálogos no son el mismo. */
    mocks.leerInstrumento.mockRejectedValue(new InstrumentoDesconocido("no está"));
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(anterior()).not.toBeNull();
    expect(host.textContent).not.toMatch(/error/i);
  });

  test("sin camino a la base nueva tampoco se le pregunta", async () => {
    mocks.disponible.value = false;
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(anterior()).not.toBeNull();
    expect(mocks.leerInstrumento).not.toHaveBeenCalled();
  });

  test("un ISIN que no existe se dice, con su ISIN y un botón al Buscador", async () => {
    mocks.leerInstrumento.mockRejectedValue(new InstrumentoDesconocido("no está"));
    mocks.getAssetDetail.mockResolvedValue(null);
    const alBuscador: number[] = [];
    await montar({ assetId: "XX0000000000", onIrAlBuscador: () => alBuscador.push(1) });
    expect(titulo()).toBe("No encontramos este activo");
    expect(host.textContent).toContain("XX0000000000 no está en el catálogo");
    await act(async () => boton("Ir al Buscador")!.click());
    expect(alBuscador).toEqual([1]);
  });

  test("si la lectura falla, se dice y se puede reintentar, sin pasar por la anterior", async () => {
    mocks.leerInstrumento.mockRejectedValue(new Error("Failed to fetch"));
    mocks.getAssetDetail.mockResolvedValue(ACTIVO);
    await montar();
    expect(titulo()).toBe("No se pudo leer la ficha");
    expect(host.textContent).toContain("No hemos podido leer este activo. Vuelve a intentarlo");
    expect(anterior()).toBeNull();

    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    await act(async () => boton("Reintentar")!.click());
    await reposar();
    expect(nueva()).not.toBeNull();
    expect(mocks.leerInstrumento).toHaveBeenCalledTimes(2);
  });

  test("un identificador con barra ni se pregunta a la base: no puede ser un instrumento", async () => {
    await montar({ assetId: "ES0125140A14/B" });
    expect(mocks.leerInstrumento).not.toHaveBeenCalled();
    expect(mocks.getAssetDetail).not.toHaveBeenCalled();
    expect(titulo()).toBe("No encontramos este activo");
  });

  test("la vuelta es un enlace: un clic normal vuelve, y dice adónde", async () => {
    mocks.leerInstrumento.mockResolvedValue(INSTRUMENTO);
    mocks.getAssetDetail.mockResolvedValue(null);
    const vueltas: number[] = [];
    await montar({
      vuelta: { etiqueta: "Volver a Diseño de cartera", direccion: "/cartera", alVolver: () => vueltas.push(1) }
    });
    const enlace = host.querySelector<HTMLAnchorElement>(".ficha-pantalla__vuelta")!;
    expect(enlace.textContent).toContain("Volver a Diseño de cartera");
    expect(enlace.getAttribute("href")).toBe("/cartera");
    await act(async () => enlace.click());
    expect(vueltas).toEqual([1]);
  });
});

describe("con Modo cliente", () => {
  const conTodo = {
    ...INSTRUMENTO,
    raiz: {
      ...INSTRUMENTO.raiz,
      classification: { official_benchmark: { name: "MSCI World" } }
    },
    tarjeta: { instrument_id: "LU0011889846", metrics: { control: { mismatch: ["volatility.5y"] } } },
    calidad: {
      coverage: 0.5,
      present_paths: 10,
      applicable_paths: 20,
      absences: [{ path: "classification.official_benchmark.instrument_id", reason: "NOT_YET_FETCHED" }]
    },
    bloques: {
      "computed/metrics": { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", volatility: { "5y": 0.1 } },
      "declared/provider_risk": { as_of: "2026-10-31", beta: { "1y": { vs_benchmark: 0.9 } } },
      "declared/provenance": { package_id: "2026-11-04" }
    }
  };

  async function pintar(modoCliente: boolean) {
    mocks.leerInstrumento.mockResolvedValue(conTodo);
    mocks.getAssetDetail.mockResolvedValue(null);
    await act(async () => {
      root!.render(
        createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(FichaDeActivo, PROPS as never) })
      );
    });
    await reposar();
    return host.textContent ?? "";
  }

  test("el asesor lo ve todo, con sus palabras", async () => {
    const texto = await pintar(false);
    expect(texto).toContain("Procedencia y calidad");
    expect(texto).toContain("Para revisar");
    expect(texto).toContain("El índice, en nuestra base");
    expect(texto).toContain("Pendiente de alta");
    expect(texto).toContain("Alfa calculado por el proveedor. Cuando demos de alta el índice, se calculará con nuestro método.");
    expect(texto).toContain("Datos del 04/11/2026");
    expect(texto).toContain("No facilitados por el proveedor");
    expect(texto).toContain("Pendientes de incorporar: el dato existe y aún no lo hemos traído.");
  });

  test("el cliente no lee nuestra lista de tareas, y la procedencia bajo cada título se queda", async () => {
    const texto = await pintar(true);
    for (const fuera of ["Procedencia y calidad", "Para revisar", "El índice, en nuestra base", "Pendiente de alta", "No facilitados"]) {
      expect(texto, fuera).not.toContain(fuera);
    }
    expect(texto).toContain("Calculadas por nosotros");
    expect(texto).toContain("Contra el índice de categoría del proveedor");
  });
});
