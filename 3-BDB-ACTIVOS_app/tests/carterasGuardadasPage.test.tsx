// @vitest-environment happy-dom

/**
 * Carteras guardadas (decisión 26 de Óscar, 04-11-2026): la tabla del menú, con Abrir, Comparar y Eliminar. Lee lo que
 * la cuenta dice que tiene, igual en las dos bases, y los activos de esas carteras por donde los lee Análisis (decisión 50).
 *
 * Rediseño del 14-11-2026: se llama «Propuestas guardadas»; «Duplicar» y «Renombrar» van en «Más» de cada fila, y
 * «Eliminar», a la vista desde el 16-11-2026; se busca por nombre; la abierta en Diseño lo dice; las fechas van como «21/10/2026» (DIS-27), los importes de la
 * tabla con dos decimales y la suma de pesos con uno (DIS-07).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
const catalogo = vi.hoisted(() => ({ leer: vi.fn() }));

vi.mock("../src/adapters/portfolioBackend", () => ({
  usesBackendPersistence: () => true,
  backendListPortfolioResult: backend.list,
  backendSavePortfolio: backend.save,
  backendDeletePortfolio: backend.remove
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: catalogo.leer })
}));

import { ConflictoAlGuardar } from "../src/adapters/conflictoAlGuardar";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import type { CicloDeCartera } from "../src/app/useCicloDeCartera";
import { eleccionDeCarteras, pestanaDelComparador } from "../src/core/comparacionDeCarteras";
import { CarterasGuardadasPage } from "../src/pages/CarterasGuardadasPage";

function cartera(id: string, nombre: string, capital: number | undefined, updated_at: string): BdbSavedLocalPortfolio {
  return {
    portfolio_id: id,
    name: nombre,
    created_at: "2026-09-01T10:00:00Z",
    updated_at,
    sourceKind: "BBDD_LIVE_API",
    total_capital: capital,
    positions: [
      { asset_id: "LU0000000001", weight_percent: 60 },
      { asset_id: "IE0000000002", weight_percent: 40 }
    ]
  };
}

const CLIENTE_A = cartera("a", "Cliente A", 250000, "2026-10-21T10:00:00Z");
const CLIENTE_B = cartera("b", "Cliente B", undefined, "2026-09-07T10:00:00Z");

/* Dos fondos de bolsa: el primero, 60 % de la cartera, declara sectores; el segundo, 40 %, no. */
const activo = (asset_id: string, exposure_detail: Record<string, unknown>) => ({
  asset_id,
  display_name: asset_id,
  instrument_type: "FUND",
  economic_asset_class: "EQUITY",
  role: "INVESTABLE",
  is_investable: true,
  quality_flags: [],
  coverage_status: "COMPLETE",
  currency: "EUR",
  metrics: {},
  warnings: [],
  pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 },
  exposure_detail
});
const ACTIVOS = [
  activo("LU0000000001", { sectors: { technology: 1 }, equity_regions: { united_states: 1 } }),
  activo("IE0000000002", {})
];

function cicloDePrueba(sinGuardar = false) {
  const pendientes: (() => void)[] = [];
  const ciclo = {
    abierta: null,
    sinGuardar,
    guardando: false,
    generacion: 0,
    conGuardia: vi.fn((accion: () => void) => {
      if (sinGuardar) pendientes.push(accion);
      else accion();
    }),
    sustituir: vi.fn(),
    guardar: vi.fn(),
    dialogo: null
  };
  return { ciclo: ciclo as unknown as CicloDeCartera & { sustituir: typeof ciclo.sustituir; conGuardia: typeof ciclo.conGuardia }, pendientes };
}

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.list.mockReset();
  backend.remove.mockReset();
  backend.save.mockReset();
  backend.save.mockImplementation(async (guardada: BdbSavedLocalPortfolio) => ({ portfolio: guardada, warnings: [] }));
  backend.list.mockResolvedValue({ portfolios: [CLIENTE_A, CLIENTE_B], discarded: [] });
  backend.remove.mockResolvedValue({ ok: true });
  catalogo.leer.mockReset();
  catalogo.leer.mockResolvedValue(ACTIVOS);
  eleccionDeCarteras.reset();
  pestanaDelComparador.reset();
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

async function montar(props: Partial<Parameters<typeof CarterasGuardadasPage>[0]> = {}, modoCliente = false) {
  await act(async () => {
    root!.render(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(CarterasGuardadasPage, { sourceKind: "BBDD_LIVE_API", ...props })
      })
    );
  });
  await act(async () => {
    await new Promise((listo) => setTimeout(listo, 0));
  });
}

const boton = (nombre: string) => {
  const encontrado = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === nombre || b.textContent === nombre);
  if (!encontrado) throw new Error(`Falta el botón «${nombre}»`);
  return encontrado;
};
const pulsar = (nombre: string) => act(async () => boton(nombre).click());
/** «Más» en la fila de una propuesta, y dentro, la acción. */
const accionDeMas = async (nombre: string, accion: string) => {
  const fila = [...host.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")?.textContent?.startsWith(nombre))!;
  await act(async () => [...fila.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Más")!.click());
  return [...fila.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.querySelector("span")?.textContent === accion)!;
};
const pulsarEnMas = async (nombre: string, accion: string) => {
  const item = await accionDeMas(nombre, accion);
  await act(async () => item.click());
};
const filas = () => [...host.querySelectorAll("tbody tr")].map((tr) => (tr.textContent ?? "").replace(/\u00a0/g, " "));

describe("la tabla", () => {
  test("nombre, posiciones, capital y fecha, con lo guardado en la cuenta y no otra lista", async () => {
    await montar();
    expect(backend.list).toHaveBeenCalledTimes(1);
    expect(filas()).toHaveLength(2);
    expect(filas()[0]).toContain("Cliente A");
    expect(filas()[0]).toContain("250.000,00 €");
    expect(filas()[0]).toContain("21/10/2026");
    expect(filas()[1]).toContain("Sin fijar");
    expect(host.textContent).toContain("Se guardan en tu cuenta");
  });

  test("sin capital no hay cero creíble ni 100.000 € de ejemplo", async () => {
    await montar();
    expect(filas()[1]).not.toContain("100.000");
    expect(host.querySelector("tbody tr:nth-child(2) .tabla__celda--no-aplica")?.textContent).toBe("Sin fijar");
  });

  test("audita con los activos de Análisis: si cuadra, si los conoce y qué parte de su renta variable declara sectores", async () => {
    await montar();
    expect(catalogo.leer).toHaveBeenCalledTimes(1);
    expect(catalogo.leer).toHaveBeenCalledWith(["IE0000000002", "LU0000000001"]);
    expect(filas()[0]).toContain("100,0 %");
    expect(filas()[0]).toContain("Ninguna");
    expect(filas()[0]).toContain("60,0 % de la RV");
  });

  test("si no se pueden leer, las carteras siguen ahí y falta solo lo que depende de ellos: la suma no", async () => {
    catalogo.leer.mockRejectedValue(new Error("Failed to fetch"));
    await montar();
    expect(filas()).toHaveLength(2);
    expect(host.textContent).toContain("No se ha podido leer el catálogo");
    expect(filas()[0]).toContain("100,0 %");
    expect(filas()[0]).toContain("Falta");
    expect(boton("Abrir Cliente A en Diseño de cartera").disabled).toBe(false);
    /* Sin activos no hay radiografía que abrir, y no se ofrece. */
    expect(host.textContent).not.toContain("Toca una propuesta");
    await act(async () => host.querySelector<HTMLElement>("tbody tr")!.click());
    expect(host.querySelector(".carteras__detalle")).toBeNull();
  });

  test("mientras se leen no dice que falte nada: lo dirá si faltan", async () => {
    let contestar!: (valor: unknown) => void;
    catalogo.leer.mockReturnValue(new Promise((resuelve) => { contestar = resuelve; }));
    await montar();
    expect(filas()[0]).toContain("Leyendo…");
    expect(filas()[0]).not.toContain("Falta");
    await act(async () => contestar(ACTIVOS));
    expect(filas()[0]).toContain("60,0 % de la RV");
  });

  test("una posición que no vuelve se cuenta fuera del catálogo", async () => {
    catalogo.leer.mockResolvedValue([ACTIVOS[0]]);
    await montar();
    expect(filas()[0]).toContain("1 fuera del catálogo");
  });

  /* Dirección A, 18-11-2026: por debajo de 1.800 px las tres columnas anchas se ocultan y su contenido va en el apunte
     bajo el nombre. Ahí «no cuadra» y «N fuera del catálogo» llevan la marca de lo que falta, como en su columna. */
  test("en el apunte estrecho, lo que no cuadra y lo que falta del catálogo conservan su marca y su palabra", async () => {
    backend.list.mockResolvedValue({
      portfolios: [{ ...CLIENTE_A, positions: [{ asset_id: "LU0000000001", weight_percent: 60 }, { asset_id: "IE0000000002", weight_percent: 38.5 }] }],
      discarded: []
    });
    catalogo.leer.mockResolvedValue([ACTIVOS[0]]);
    await montar();
    const marcas = [...host.querySelectorAll("tbody tr .tabla__apunte--estrecho .ausencia--falta")].map((m) => m.textContent);
    expect(marcas).toEqual(["no cuadra", "1 fuera del catálogo"]);
  });

  test("con una propuesta en regla, el apunte estrecho no marca nada", async () => {
    await montar();
    expect(host.querySelector("tbody tr:first-child .tabla__apunte--estrecho")?.textContent).toContain("todas en el catálogo");
    expect(host.querySelector("tbody tr:first-child .tabla__apunte--estrecho .ausencia")).toBeNull();
  });

  test("la búsqueda y la tabla van juntas en la tarjeta de la lista; el pie, fuera", async () => {
    await montar();
    const lista = host.querySelector(".carteras__lista");
    expect(lista?.querySelector('input[type="search"]')).not.toBeNull();
    expect(lista?.querySelector("table")).not.toBeNull();
    expect(lista?.querySelector(".carteras__pie")).toBeNull();
    expect(host.querySelector(".carteras__pie")).not.toBeNull();
  });

  test("una lista vacía lo dice, y no se confunde con una que aún no ha llegado", async () => {
    let contestar!: (valor: unknown) => void;
    backend.list.mockReturnValue(new Promise((resuelve) => { contestar = resuelve; }));
    await montar();
    expect(host.textContent).toContain("Leyendo las propuestas");
    expect(host.textContent).not.toContain("Aún no has guardado");
    await act(async () => contestar({ portfolios: [], discarded: [] }));
    expect(host.textContent).toContain("Aún no has guardado ninguna propuesta");
  });

  test("si la lista falla, se puede reintentar", async () => {
    backend.list.mockRejectedValueOnce(new Error("Sin red"));
    await montar();
    expect(host.textContent).not.toContain("Aún no has guardado");
    await pulsar("Reintentar");
    expect(filas()).toHaveLength(2);
  });
});

describe("Abrir", () => {
  test("la carga como cartera abierta y lleva a Diseño", async () => {
    const { ciclo } = cicloDePrueba();
    const onIrA = vi.fn();
    await montar({ ciclo, onIrA });
    await pulsar("Abrir Cliente A en Diseño de cartera");
    expect(ciclo.sustituir).toHaveBeenCalledTimes(1);
    expect(ciclo.sustituir.mock.calls[0][0]).toMatchObject({ capital: 250000, nombre: "Cliente A" });
    expect(ciclo.sustituir.mock.calls[0][1]).toBe(CLIENTE_A);
    expect(onIrA).toHaveBeenCalledWith("cartera");
  });

  test("con cambios sin guardar, nada se sustituye hasta que el marco lo deja", async () => {
    const { ciclo, pendientes } = cicloDePrueba(true);
    const onIrA = vi.fn();
    await montar({ ciclo, onIrA });
    await pulsar("Abrir Cliente A en Diseño de cartera");
    expect(ciclo.conGuardia).toHaveBeenCalledTimes(1);
    expect(ciclo.sustituir).not.toHaveBeenCalled();
    expect(onIrA).not.toHaveBeenCalled();
    await act(async () => pendientes[0]());
    expect(ciclo.sustituir).toHaveBeenCalledTimes(1);
    expect(onIrA).toHaveBeenCalledWith("cartera");
  });

  test("una cartera sin capital se abre sin capital", async () => {
    const { ciclo } = cicloDePrueba();
    await montar({ ciclo, onIrA: vi.fn() });
    await pulsar("Abrir Cliente B en Diseño de cartera");
    expect(ciclo.sustituir.mock.calls[0][0].capital).toBeUndefined();
  });
});

/* Comparar salió de la tabla el 17-11-2026 (Óscar): dos propuestas se comparan desde el Comparador, en su pestaña de carteras. */
describe("Comparar", () => {
  test("ya no está en la fila, ni a la vista ni con su nombre accesible", async () => {
    await montar({ onIrA: vi.fn() });
    expect(host.querySelector('[aria-label="Comparar Cliente A"]')).toBeNull();
    expect([...host.querySelectorAll("tbody button")].some((b) => b.textContent === "Comparar")).toBe(false);
    expect(eleccionDeCarteras.read()).toEqual({ a: "", b: "" });
    expect(pestanaDelComparador.read()).not.toBe("portfolios");
  });
});

describe("Eliminar", () => {
  test("está a la vista en cada fila, con el nombre de su propuesta, y ya no dentro de «Más»", async () => {
    await montar();
    expect(boton("Eliminar Cliente A").textContent).toBe("Eliminar");
    expect(boton("Eliminar Cliente B").textContent).toBe("Eliminar");
    expect(await accionDeMas("Cliente A", "Eliminar")).toBeUndefined();
  });

  test("pregunta nombrándola, y hasta que se confirma no borra", async () => {
    await montar();
    await pulsar("Eliminar Cliente A");
    expect(backend.remove).not.toHaveBeenCalled();
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.textContent).toContain("¿Eliminar Cliente A?");
    expect(dialogo?.textContent).toContain("No se puede deshacer.");
    const confirmar = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Eliminar");
    await act(async () => confirmar!.click());
    expect(backend.remove).toHaveBeenCalledWith("a");
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain("Cliente B");
    expect(host.textContent).toContain("Cliente A eliminada de tu cuenta.");
    expect(host.textContent).not.toContain("BBDD");
  });

  test("cancelar no borra nada", async () => {
    await montar();
    await pulsar("Eliminar Cliente A");
    const cancelar = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Cancelar");
    await act(async () => cancelar!.click());
    expect(backend.remove).not.toHaveBeenCalled();
    expect(filas()).toHaveLength(2);
  });

  test("DIS-12: mientras se elimina, su botón queda desactivado y no admite otra pulsación", async () => {
    let contestar!: (valor: unknown) => void;
    backend.remove.mockReturnValue(new Promise((resuelve) => { contestar = resuelve; }));
    await montar();
    await pulsar("Eliminar Cliente A");
    const confirmar = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Eliminar");
    await act(async () => confirmar!.click());
    expect(backend.remove).toHaveBeenCalledTimes(1);
    const otraVez = boton("Eliminar Cliente A");
    expect(otraVez.disabled).toBe(true);
    await act(async () => otraVez.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(backend.remove).toHaveBeenCalledTimes(1);
    await act(async () => contestar({ ok: true }));
    expect(filas()).toHaveLength(1);
  });

  test("si es la abierta en Diseño, lo dice", async () => {
    const { ciclo } = cicloDePrueba();
    (ciclo as { abierta: unknown }).abierta = { portfolio_id: "a", created_at: "", updated_at: "", huella: "" };
    await montar({ ciclo });
    await pulsar("Eliminar Cliente A");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("abierta en Diseño de cartera");
  });
});

describe("la cabecera y la búsqueda (rediseño del 14-11-2026)", () => {
  test("dice dónde se guardan y cuántas hay", async () => {
    await montar();
    expect(host.querySelector("h1")?.textContent).toBe("Propuestas guardadas");
    expect(host.querySelector(".ui-page-header__description")?.textContent).toContain("Se guardan en tu cuenta");
    expect(host.querySelector(".ui-page-header__description")?.textContent).toContain("2 propuestas");
    /* Cuántas hay va delante, como una frase: tras un punto medio se quedaba colgando al final de la línea. */
    expect(host.querySelector(".ui-page-header__description")?.textContent).toBe(
      "2 propuestas. Se guardan en tu cuenta: las ves con tu usuario desde cualquier ordenador."
    );
  });

  test("el menú «Más» de cada fila dice de qué propuesta es, empezando por lo que se lee en el botón", async () => {
    /* «Más» se repite en todas las filas: sin nombre propio, un lector de pantalla lo anunciaba igual en cada una. */
    await montar();
    const menus = [...host.querySelectorAll<HTMLButtonElement>("tbody [aria-haspopup='menu']")];
    expect(menus.map((menu) => menu.getAttribute("aria-label"))).toEqual(["Más acciones de Cliente A", "Más acciones de Cliente B"]);
    for (const menu of menus) expect(menu.getAttribute("aria-label")!.startsWith(menu.textContent!)).toBe(true);
  });

  test("«Nueva propuesta» deja Diseño vacío y lleva allí, con la guarda de los cambios sin guardar", async () => {
    const { ciclo, pendientes } = cicloDePrueba(true);
    const onIrA = vi.fn();
    await montar({ ciclo, onIrA });
    await pulsar("Nueva propuesta");
    expect(ciclo.sustituir).not.toHaveBeenCalled();
    await act(async () => pendientes[0]());
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: [], capital: undefined, nombre: "" }, null);
    expect(onIrA).toHaveBeenCalledWith("cartera");
  });

  test("buscar por nombre filtra la tabla, sin mayúsculas ni tildes, y sin resultados lo dice", async () => {
    backend.list.mockResolvedValue({ portfolios: [CLIENTE_A, cartera("c", "Familia García", 1000, "2026-10-01T10:00:00Z")], discarded: [] });
    await montar();
    const campo = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(host.querySelector(`label[for="${campo.id}"]`)?.textContent).toBe("Buscar por nombre");
    const escribir = (texto: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await escribir("garcia");
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain("Familia García");
    await escribir("nadie");
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("Ninguna propuesta con ese nombre");
    await pulsar("Quitar la búsqueda");
    expect(filas()).toHaveLength(2);
  });

  test("la que está abierta en Diseño lo dice en su fila", async () => {
    const { ciclo } = cicloDePrueba();
    (ciclo as { abierta: unknown }).abierta = { portfolio_id: "b", created_at: "", updated_at: "", huella: "" };
    await montar({ ciclo });
    expect(filas()[0]).not.toContain("Abierta en Diseño");
    expect(filas()[1]).toContain("Abierta en Diseño");
  });
});

describe("Duplicar (DIS-12)", () => {
  test("crea otra con «(copia)» por el mismo almacén, igual en todo lo demás, y no toca la original", async () => {
    const conPerfil = { ...CLIENTE_A, risk_profile_level: 4, horizon_years: 6 };
    backend.list.mockResolvedValue({ portfolios: [conPerfil, CLIENTE_B], discarded: [] });
    await montar();
    await pulsarEnMas("Cliente A", "Duplicar");
    expect(backend.save).toHaveBeenCalledTimes(1);
    const [copia, condicion] = backend.save.mock.calls[0];
    expect(copia.name).toBe("Cliente A (copia)");
    expect(copia.portfolio_id).not.toBe("a");
    expect(copia.positions).toEqual(CLIENTE_A.positions);
    expect(copia.total_capital).toBe(250000);
    expect(copia.risk_profile_level).toBe(4);
    expect(copia.horizon_years).toBe(6);
    /* Es otra: no se condiciona a la fecha de ninguna. */
    expect(condicion?.expectedUpdatedAt).toBeUndefined();
    expect(filas()).toHaveLength(3);
    expect(filas().some((fila) => fila.includes("Cliente A (copia)"))).toBe(true);
    expect(host.textContent).toContain("Cliente A sigue como estaba.");
    expect(backend.remove).not.toHaveBeenCalled();
  });

  test("si ya hay una copia, la siguiente lleva número", async () => {
    backend.list.mockResolvedValue({ portfolios: [CLIENTE_A, cartera("c", "Cliente A (copia)", 1, "2026-10-01T10:00:00Z")], discarded: [] });
    await montar();
    await pulsarEnMas("Cliente A", "Duplicar");
    expect(backend.save.mock.calls[0][0].name).toBe("Cliente A (copia 2)");
  });

  test("si no se puede guardar, lo dice y no aparece ninguna", async () => {
    backend.save.mockRejectedValue(new Error("Sin red"));
    await montar();
    await pulsarEnMas("Cliente A", "Duplicar");
    expect(host.textContent).toContain("No se ha podido duplicar Cliente A.");
    expect(filas()).toHaveLength(2);
  });
});

describe("Renombrar (DIS-12)", () => {
  const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const escribirNombre = (texto: string) =>
    act(async () => {
      const campo = dialogo()!.querySelector<HTMLInputElement>("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const confirmar = () => act(async () => [...dialogo()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Renombrar")!.click());

  test("cambia el nombre y conserva todo lo demás, con el control de conflictos del guardado", async () => {
    await montar();
    await pulsarEnMas("Cliente A", "Renombrar");
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Renombrar Cliente A");
    await escribirNombre("Cliente A · revisada");
    await confirmar();
    expect(backend.save).toHaveBeenCalledTimes(1);
    const [renombrada, condicion] = backend.save.mock.calls[0];
    expect(renombrada).toMatchObject({ portfolio_id: "a", name: "Cliente A · revisada", positions: CLIENTE_A.positions, total_capital: 250000, created_at: CLIENTE_A.created_at });
    expect(condicion).toEqual({ expectedUpdatedAt: CLIENTE_A.updated_at });
    expect(dialogo()).toBeNull();
    expect(filas()).toHaveLength(2);
    expect(filas().some((fila) => fila.includes("Cliente A · revisada"))).toBe(true);
  });

  test("avisa si el nombre ya lo lleva otra", async () => {
    await montar();
    await pulsarEnMas("Cliente A", "Renombrar");
    await escribirNombre("cliente b");
    expect(dialogo()?.textContent).toContain("Ya hay otra propuesta guardada con este nombre");
  });

  test("si la guardada ha cambiado desde que se leyó, no la pisa y lo dice", async () => {
    backend.save.mockRejectedValue(new ConflictoAlGuardar("cambiada"));
    await montar();
    await pulsarEnMas("Cliente A", "Renombrar");
    await escribirNombre("Otro nombre");
    await confirmar();
    expect(dialogo()?.textContent).toContain("El nombre no ha cambiado");
    expect(filas()[0]).toContain("Cliente A");
  });

  test("la que está abierta en Diseño se renombra allí", async () => {
    const { ciclo } = cicloDePrueba();
    (ciclo as { abierta: unknown }).abierta = { portfolio_id: "a", created_at: "", updated_at: "", huella: "" };
    await montar({ ciclo });
    const renombrar = await accionDeMas("Cliente A", "Renombrar");
    expect(renombrar.disabled).toBe(true);
    expect(renombrar.textContent).toContain("Está abierta en Diseño");
  });
});

describe("la radiografía", () => {
  test("pulsar una fila la enseña, y los botones de la fila no la abren", async () => {
    await montar();
    expect(host.querySelector(".carteras__detalle")).toBeNull();
    await pulsar("Más acciones de Cliente A");
    expect(host.querySelector(".carteras__detalle")).toBeNull();
    await act(async () => host.querySelector<HTMLElement>("tbody tr")!.click());
    expect(host.querySelector(".carteras__detalle h2")?.textContent).toBe("Cliente A");
    expect(host.querySelector(".carteras__detalle")?.textContent).toContain("Por sector");
    /* Al abrirse, su título recibe el foco: el teclado y el lector de pantalla siguen ahí. */
    expect(document.activeElement).toBe(host.querySelector(".carteras__detalle h2"));
  });

  test("dice en % de la renta variable lo que se declara y lo que no, con las cifras de Análisis", async () => {
    await montar();
    await pulsar("Ver la radiografía de Cliente A");
    const detalle = (host.querySelector(".carteras__detalle")?.textContent ?? "").replace(/\u00a0/g, " ");
    expect(detalle).toContain("Exposición agregada");
    expect(detalle).toContain("Renta variable100,0 %");
    /* Declara el primero, 60 de los 100 de renta variable. */
    expect(detalle).toContain("Estados Unidos60,0 %");
    expect(detalle).toContain("Tecnología60,0 %");
    expect(detalle).toContain("No declarado: 40,0 % de la renta variable");
    expect(detalle).not.toContain("Explica");
    /* No se relee nada al abrirla: son los activos que ya ha leído la tabla. */
    expect(catalogo.leer).toHaveBeenCalledTimes(1);
  });
});

describe("Modo cliente", () => {
  test("no enseña las carteras de otros clientes, ni las pide", async () => {
    await montar({}, true);
    expect(host.textContent).toContain("No disponible en modo cliente");
    expect(host.querySelector("table")).toBeNull();
    expect(backend.list).not.toHaveBeenCalled();
    expect(catalogo.leer).not.toHaveBeenCalled();
  });
});
