// @vitest-environment happy-dom

/**
 * «Guardar» sobrescribe la cartera abierta; sin ella, crea otra (hallazgo 47). Antes cada guardado creaba
 * una nueva: abrir una, cambiarla y guardar dejaba dos, hasta el tope de 200.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({
  enLaCuenta: false,
  save: vi.fn(),
  list: vi.fn()
}));

vi.mock("../src/adapters/portfolioBackend", () => ({
  usesBackendPersistence: () => backend.enLaCuenta,
  backendSavePortfolio: backend.save,
  backendListPortfolioResult: backend.list
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: async () => [] })
}));

import { ConflictoAlGuardar } from "../src/adapters/conflictoAlGuardar";
import { comprobarLaGuardada, guardarCartera } from "../src/core/guardarCartera";
import { escucharCarterasGuardadas } from "../src/core/carterasGuardadasAvisos";
import { LOCAL_PORTFOLIOS_STORAGE_KEY, readLocalPortfoliosFromStorage } from "../src/core/localPortfolioStorage";

const invertible = (asset_id: string) =>
  ({ asset_id, is_investable: true, role: "INVESTABLE", instrument_type: "FUND", quality_flags: [] }) as unknown as BdbAssetDetail;
const noInvertible = (asset_id: string) =>
  ({ asset_id, is_investable: false, role: "BENCHMARK", instrument_type: "INDEX", quality_flags: [] }) as unknown as BdbAssetDetail;

const POSICIONES = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

beforeEach(() => {
  localStorage.clear();
  backend.enLaCuenta = false;
  backend.save.mockReset();
  backend.list.mockReset();
});

/* DIS-03: antes de sobrescribir la abierta se vuelve a leer, y su fecha de modificación tiene que ser la de cuando
   se abrió. Si no, otra pestaña u otro equipo la ha cambiado, o eliminado. */
describe("comprobar la guardada antes de sobrescribirla", () => {
  const GUARDADA: BdbSavedLocalPortfolio = {
    portfolio_id: "p1",
    name: "Cliente",
    created_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:00:00.000Z",
    sourceKind: "LOCAL_MOCK",
    positions: POSICIONES
  };
  const abierta = { portfolio_id: "p1", updated_at: "2026-11-01T10:00:00.000Z" };

  test("en la cuenta: la misma fecha es la misma; otra fecha, cambiada; sin ella, eliminada", async () => {
    backend.enLaCuenta = true;
    backend.list.mockResolvedValueOnce({ portfolios: [GUARDADA], discarded: [] });
    expect(await comprobarLaGuardada("BBDD_LIVE_API", abierta)).toEqual({ estado: "igual" });
    backend.list.mockResolvedValueOnce({ portfolios: [{ ...GUARDADA, updated_at: "2026-11-02T09:00:00.000Z" }], discarded: [] });
    expect(await comprobarLaGuardada("BBDD_LIVE_API", abierta)).toEqual({ estado: "cambiada" });
    backend.list.mockResolvedValueOnce({ portfolios: [], discarded: [] });
    expect(await comprobarLaGuardada("BBDD_LIVE_API", abierta)).toEqual({ estado: "eliminada" });
  });

  test("en la cuenta: si no se puede leer, no se da por igual", async () => {
    backend.enLaCuenta = true;
    backend.list.mockRejectedValueOnce(new Error("caído"));
    expect(await comprobarLaGuardada("BBDD_LIVE_API", abierta)).toEqual({ estado: "sin-comprobar" });
    /* Un documento que existe pero no se puede leer tampoco está igual: está, y no se sabe cómo. */
    backend.list.mockResolvedValueOnce({ portfolios: [], discarded: [{ index: 0, portfolio_id: "p1", reason: "ilegible" }] });
    expect(await comprobarLaGuardada("BBDD_LIVE_API", abierta)).toEqual({ estado: "sin-comprobar" });
  });

  test("en este navegador: lee lo guardado en el navegador, que comparten las pestañas", async () => {
    expect(await comprobarLaGuardada("LOCAL_MOCK", abierta)).toEqual({ estado: "eliminada" });
    const primera = await guardarCartera({ sourceKind: "LOCAL_MOCK", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), invertible("B")] });
    if (!primera.ok) throw new Error(primera.mensaje);
    const suya = { portfolio_id: primera.cartera.portfolio_id, updated_at: primera.cartera.updated_at };
    expect(await comprobarLaGuardada("LOCAL_MOCK", suya)).toEqual({ estado: "igual" });
    expect(await comprobarLaGuardada("LOCAL_MOCK", { ...suya, updated_at: "2000-01-01T00:00:00.000Z" })).toEqual({ estado: "cambiada" });
    expect(backend.list).not.toHaveBeenCalled();
  });
});

describe("en este navegador", () => {
  test("sin cartera abierta crea otra; con ella, la sobrescribe y conserva su fecha de alta", async () => {
    const primera = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: 250000,
      assets: [invertible("A"), invertible("B")]
    });
    if (!primera.ok) throw new Error(primera.mensaje);
    expect(primera.conAvisos).toBe(false);
    const guardadas = () => readLocalPortfoliosFromStorage(localStorage);
    expect(guardadas()).toHaveLength(1);

    const segunda = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente, revisada",
      positions: [{ asset_id: "A", weight_percent: 100 }],
      capital: 300000,
      assets: [invertible("A")],
      sobre: { portfolio_id: primera.cartera.portfolio_id, created_at: "2026-01-01T10:00:00.000Z" }
    });
    if (!segunda.ok) throw new Error(segunda.mensaje);
    expect(guardadas()).toHaveLength(1);
    expect(guardadas()[0]).toMatchObject({
      portfolio_id: primera.cartera.portfolio_id,
      name: "Cliente, revisada",
      created_at: "2026-01-01T10:00:00.000Z",
      total_capital: 300000
    });
    expect(guardadas()[0].positions).toHaveLength(1);
  });

  test("sin nombre no se guarda: no hay carteras «sin nombre»", async () => {
    const resultado = await guardarCartera({ sourceKind: "LOCAL_MOCK", nombre: "  ", positions: POSICIONES, capital: 1, assets: [invertible("A"), invertible("B")] });
    expect(resultado.ok).toBe(false);
    expect(readLocalPortfoliosFromStorage(localStorage)).toEqual([]);
  });

  test("sin capital fijado no se guarda ninguna cifra", async () => {
    const resultado = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")]
    });
    expect(resultado.ok).toBe(true);
    expect(readLocalPortfoliosFromStorage(localStorage)[0].total_capital).toBeUndefined();
  });

  test("avisa a las listas montadas, que no se quedan sin la cartera recién guardada", async () => {
    const oyente = vi.fn();
    const dejar = escucharCarterasGuardadas(oyente);
    await guardarCartera({ sourceKind: "LOCAL_MOCK", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), invertible("B")] });
    dejar();
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(oyente.mock.calls[0][0]).toMatchObject({ tipo: "guardada", cartera: { name: "Cliente" } });
  });

  test("una cartera abierta no se sobrescribe con cero posiciones, y lo dice", async () => {
    const resultado = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: [],
      capital: 1,
      assets: [],
      sobre: { portfolio_id: "p1", created_at: "2026-11-01T10:00:00.000Z" }
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("se quedaría vacía");
    expect(readLocalPortfoliosFromStorage(localStorage)).toEqual([]);
  });

  test("lo que no es invertible se queda fuera, y se dice", async () => {
    const resultado = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: 1,
      assets: [invertible("A"), noInvertible("B")]
    });
    if (!resultado.ok) throw new Error(resultado.mensaje);
    expect(resultado.positions.map((p) => p.asset_id)).toEqual(["A"]);
    expect(resultado.mensaje).toContain("Una posición que no se puede proponer se queda sin guardar.");
    expect(resultado.conAvisos).toBe(true);
  });

  test.each([
    ["una acción con una incidencia en su serie, como Deoleo", "QUALITY_BLOCKED"],
    ["una clase cerrada a nuevas suscripciones", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"],
    ["una acción suspendida", "NON_INVESTABLE_SUSPENDED"]
  ])("%s se conserva al guardar, con su peso y sin aviso: un cliente puede tenerla (decisión 113)", async (_caso, marca) => {
    const bloqueada = { asset_id: "B", is_investable: false, role: "INVESTABLE", instrument_type: "STOCK", quality_flags: [marca] } as unknown as BdbAssetDetail;
    const resultado = await guardarCartera({ sourceKind: "LOCAL_MOCK", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), bloqueada] });
    if (!resultado.ok) throw new Error(resultado.mensaje);
    expect(resultado.positions).toEqual(POSICIONES);
    expect(resultado.conAvisos).toBe(false);
    expect(resultado.mensaje).not.toContain("sin guardar");
    expect(readLocalPortfoliosFromStorage(localStorage)[0].positions).toEqual(POSICIONES);
  });

  test("con la cuenta, lo que se manda al servidor lleva también esa posición", async () => {
    backend.enLaCuenta = true;
    backend.save.mockImplementation(async (cartera: BdbSavedLocalPortfolio) => ({ portfolio: cartera, warnings: [] }));
    const bloqueada = { asset_id: "B", is_investable: false, role: "INVESTABLE", instrument_type: "STOCK", quality_flags: ["QUALITY_BLOCKED"] } as unknown as BdbAssetDetail;
    await guardarCartera({ sourceKind: "BBDD_LIVE_API", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), bloqueada] });
    expect(backend.save.mock.calls[0][0].positions).toEqual(POSICIONES);
  });

  test("no sobrescribe una cartera con nada: si el catálogo no contesta, no se guarda", async () => {
    const sobre = { portfolio_id: "p1", created_at: "2026-01-01T10:00:00.000Z" };
    localStorage.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, "");
    const resultado = await guardarCartera({ sourceKind: "LOCAL_MOCK", nombre: "Cliente", positions: POSICIONES, capital: 1, sobre });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.mensaje).toContain("ninguna de sus posiciones");
    expect(readLocalPortfoliosFromStorage(localStorage)).toEqual([]);
  });
});

describe("en la cuenta", () => {
  test("le manda al servidor el identificador de la abierta: es lo que hace que sobrescriba", async () => {
    backend.enLaCuenta = true;
    backend.save.mockImplementation(async (cartera: BdbSavedLocalPortfolio) => ({
      portfolio_id: cartera.portfolio_id,
      portfolio: { ...cartera, updated_at: "2026-11-04T12:30:00.000Z" },
      warnings: [{ code: "WEIGHTS_NOT_100", severity: "MEDIUM", message: "Los pesos suman 99." }]
    }));
    const resultado = await guardarCartera({
      sourceKind: "BBDD_LIVE_API",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: 250000,
      assets: [invertible("A"), invertible("B")],
      sobre: { portfolio_id: "p1", created_at: "2026-01-01T10:00:00.000Z" }
    });
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(backend.save.mock.calls[0][0]).toMatchObject({ portfolio_id: "p1", created_at: "2026-01-01T10:00:00.000Z", total_capital: 250000 });
    if (!resultado.ok) throw new Error(resultado.mensaje);
    expect(resultado.cartera.updated_at).toBe("2026-11-04T12:30:00.000Z");
    expect(resultado.mensaje).toBe("Cliente guardada en tu cuenta. Los pesos suman 99.");
    expect(resultado.conAvisos).toBe(true);
  });

  test("sin abierta, un identificador nuevo", async () => {
    backend.enLaCuenta = true;
    backend.save.mockImplementation(async (cartera: BdbSavedLocalPortfolio) => ({ portfolio_id: cartera.portfolio_id, warnings: [] }));
    await guardarCartera({ sourceKind: "BBDD_LIVE_API", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), invertible("B")] });
    expect(backend.save.mock.calls[0][0].portfolio_id).toMatch(/^local-/);
  });

  /* DIS-03: el control del servidor. Con la fecha de la abierta, el servidor solo escribe si sigue siendo esa. */
  const ABIERTA = { portfolio_id: "p1", created_at: "2026-01-01T10:00:00.000Z", updated_at: "2026-11-14T09:00:00.000Z" };
  const enLaCuentaConAbierta = (extra: { forzar?: boolean; sobre?: typeof ABIERTA | null } = {}) =>
    guardarCartera({
      sourceKind: "BBDD_LIVE_API",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: 1,
      assets: [invertible("A"), invertible("B")],
      sobre: ABIERTA,
      ...extra
    });

  test("al sobrescribir la abierta manda su fecha de modificación como condición", async () => {
    backend.enLaCuenta = true;
    backend.save.mockImplementation(async (cartera: BdbSavedLocalPortfolio) => ({ portfolio: cartera, warnings: [] }));
    await enLaCuentaConAbierta();
    expect(backend.save.mock.calls[0][1]).toEqual({ expectedUpdatedAt: ABIERTA.updated_at });
  });

  test("con «forzar», o al crear otra, no manda condición", async () => {
    backend.enLaCuenta = true;
    backend.save.mockImplementation(async (cartera: BdbSavedLocalPortfolio) => ({ portfolio: cartera, warnings: [] }));
    await enLaCuentaConAbierta({ forzar: true });
    await enLaCuentaConAbierta({ sobre: null });
    expect(backend.save).toHaveBeenCalledTimes(2);
    for (const llamada of backend.save.mock.calls) expect(llamada[1]?.expectedUpdatedAt).toBeUndefined();
    expect(backend.save.mock.calls[0][0].portfolio_id).toBe("p1");
  });

  test("si el servidor dice que ha cambiado o ya no existe, lo devuelve como conflicto, sin el fallo genérico", async () => {
    backend.enLaCuenta = true;
    backend.save.mockRejectedValueOnce(new ConflictoAlGuardar("cambiada", "2026-11-14T09:30:00.000Z"));
    const cambiada = await enLaCuentaConAbierta();
    expect(cambiada).toMatchObject({ ok: false, conflicto: "cambiada" });
    expect(cambiada.mensaje).not.toContain("No se ha podido guardar");
    backend.save.mockRejectedValueOnce(new ConflictoAlGuardar("eliminada"));
    expect(await enLaCuentaConAbierta()).toMatchObject({ ok: false, conflicto: "eliminada" });
  });

  test("si el servidor falla, lo dice y no da nada por guardado", async () => {
    backend.enLaCuenta = true;
    backend.save.mockRejectedValue(new Error("caído"));
    const resultado = await guardarCartera({ sourceKind: "BBDD_LIVE_API", nombre: "Cliente", positions: POSICIONES, capital: 1, assets: [invertible("A"), invertible("B")] });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.mensaje).toContain("No se ha podido guardar Cliente");
  });
});

describe("nivel de perfil y horizonte (decisión 59)", () => {
  test("se guardan con la cartera, y sin ellos la cartera no lleva ninguno", async () => {
    const con = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Con perfil",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      perfilYHorizonte: { risk_profile_level: 7, horizon_years: 5 }
    });
    if (!con.ok) throw new Error(con.mensaje);
    expect(readLocalPortfoliosFromStorage(localStorage)[0]).toMatchObject({ risk_profile_level: 7, horizon_years: 5 });
    /* Encima de la misma, sin ellos: quitarlos es guardarla sin ellos. */
    const sin = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Sin perfil",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      sobre: { portfolio_id: con.cartera.portfolio_id, created_at: con.cartera.created_at }
    });
    if (!sin.ok) throw new Error(sin.mensaje);
    const guardadas = readLocalPortfoliosFromStorage(localStorage);
    expect(guardadas).toHaveLength(1);
    expect("risk_profile_level" in guardadas[0] || "horizon_years" in guardadas[0]).toBe(false);
  });

  test("«Guardar como…» en el modo demo: la copia nueva lleva los de la de origen, y si no tenía, ninguno", async () => {
    /* El identificador local sale del milisegundo: tres guardados seguidos en una prueba caerían en el mismo. */
    vi.useFakeTimers({ toFake: ["Date"] });
    let reloj = Date.parse("2026-11-09T09:00:00.000Z");
    const tic = () => vi.setSystemTime((reloj += 1000));
    tic();
    const origen = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Origen",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      perfilYHorizonte: { risk_profile_level: 3, horizon_years: 2.5 }
    });
    if (!origen.ok) throw new Error(origen.mensaje);
    tic();
    /* Lo que hace el ciclo con «Guardar como…»: sin `sobre`, con los de la pantalla. */
    const copia = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Copia",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      sobre: null,
      perfilYHorizonte: { risk_profile_level: 3, horizon_years: 2.5 }
    });
    if (!copia.ok) throw new Error(copia.mensaje);
    expect(copia.cartera.portfolio_id).not.toBe(origen.cartera.portfolio_id);
    const guardadas = readLocalPortfoliosFromStorage(localStorage);
    expect(guardadas).toHaveLength(2);
    for (const cartera of guardadas) expect(cartera).toMatchObject({ risk_profile_level: 3, horizon_years: 2.5 });

    tic();
    const sinNada = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Copia sin nada",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      sobre: null,
      perfilYHorizonte: {}
    });
    if (!sinNada.ok) throw new Error(sinNada.mensaje);
    const leida = readLocalPortfoliosFromStorage(localStorage).find((cartera) => cartera.portfolio_id === sinNada.cartera.portfolio_id)!;
    expect("risk_profile_level" in leida || "horizon_years" in leida).toBe(false);
    vi.useRealTimers();
  });

  test("un nivel o un horizonte que no valen no se guardan, y se dice por qué", async () => {
    const nivel = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      perfilYHorizonte: { risk_profile_level: 11 }
    });
    const horizonte = await guardarCartera({
      sourceKind: "LOCAL_MOCK",
      nombre: "Cliente",
      positions: POSICIONES,
      capital: undefined,
      assets: [invertible("A"), invertible("B")],
      perfilYHorizonte: { horizon_years: 0 }
    });
    expect(nivel).toEqual({ ok: false, mensaje: "No se ha guardado: el nivel de perfil de riesgo 11 está fuera de la escala del 1 al 10." });
    expect(horizonte).toEqual({ ok: false, mensaje: "No se ha guardado: el horizonte debe ser mayor que cero años." });
    expect(readLocalPortfoliosFromStorage(localStorage)).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled();
  });
});
