/**
 * Decisión 59: nivel de perfil (1-10) y horizonte en años de la cartera modelo. Ausente es ausente: ningún
 * valor por defecto, ni uno deducido del otro. Lo que no valida se rechaza con mensaje, en la frontera.
 */
import { describe, expect, test, vi } from "vitest";

const red = vi.hoisted(() => ({ llamar: vi.fn() }));
vi.mock("../src/firebase", () => ({ auth: { currentUser: { uid: "u1" } }, functions: {}, appCheckReady: Promise.resolve() }));
vi.mock("../src/adapters/callableBackend", () => ({ callBackend: red.llamar }));

import { backendSavePortfolio, parsePortfolioListResult, parseSavedPortfolio } from "../src/adapters/portfolioBackend";
import { AppError } from "../src/core/appError";
import { huellaDeCartera } from "../src/core/carteraActiva";
import {
  CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY,
  parseLocalPortfolios,
  readPerfilYHorizonteFromStorage,
  serializeLocalPortfolios,
  writePerfilYHorizonteToStorage,
  type LocalPortfolioStorageLike
} from "../src/core/localPortfolioStorage";
import {
  errorDelHorizonte,
  errorDelNivelDePerfil,
  leerHorizonte,
  perfilElegidoDelNivel,
  perfilYHorizonteDe,
  textoDelHorizonte
} from "../src/core/perfilYHorizonte";
import { textoDelNivel } from "../src/core/textoDelNivelDePerfil";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

function almacen(): LocalPortfolioStorageLike & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave)
  };
}

const DOC = {
  portfolio_id: "c1",
  name: "Cliente",
  created_at: "2026-11-09T10:00:00Z",
  updated_at: "2026-11-09T10:00:00Z",
  positions: [{ asset_id: "LU0000000001", weight_percent: 100 }]
};

const CARTERA: BdbSavedLocalPortfolio = { ...DOC, sourceKind: "BBDD_LIVE_API" };

describe("la validación", () => {
  test("de 1 a 10, entero; ausente vale", () => {
    for (const nivel of [1, 5, 10, undefined, null]) expect(errorDelNivelDePerfil(nivel)).toBeNull();
    expect(errorDelNivelDePerfil(0)).toMatch(/fuera de la escala del 1 al 10/);
    expect(errorDelNivelDePerfil(11)).toMatch(/fuera de la escala/);
    expect(errorDelNivelDePerfil(5.5)).toMatch(/entero/);
    expect(errorDelNivelDePerfil("5")).toMatch(/entero/);
    expect(errorDelNivelDePerfil(Number.NaN)).toMatch(/entero/);
  });

  test("el horizonte, positivo y con tope de cordura; ausente vale", () => {
    for (const anos of [0.5, 1, 30, 100, undefined, null]) expect(errorDelHorizonte(anos)).toBeNull();
    expect(errorDelHorizonte(0)).toMatch(/mayor que cero/);
    expect(errorDelHorizonte(-3)).toMatch(/mayor que cero/);
    expect(errorDelHorizonte(101)).toMatch(/100 años/);
    expect(errorDelHorizonte(Number.POSITIVE_INFINITY)).toMatch(/número de años/);
    expect(errorDelHorizonte("5")).toMatch(/número de años/);
  });

  test("el campo de texto: vacío es sin definir, admite coma y rechaza lo demás", () => {
    expect(leerHorizonte("")).toEqual({ valor: undefined });
    expect(leerHorizonte("   ")).toEqual({ valor: undefined });
    expect(leerHorizonte("5")).toEqual({ valor: 5 });
    expect(leerHorizonte("2,5")).toEqual({ valor: 2.5 });
    expect(leerHorizonte("0")).toEqual({ error: "El horizonte debe ser mayor que cero años." });
    expect(leerHorizonte("-2")).toEqual({ error: "El horizonte debe ser mayor que cero años." });
    expect(leerHorizonte("cinco")).toEqual({ error: "El horizonte debe ser un número de años." });
    expect(leerHorizonte("5 años")).toEqual({ error: "El horizonte debe ser un número de años." });
  });

  test("lo que no valida se queda fuera sin sustituirlo por nada", () => {
    expect(perfilYHorizonteDe({ risk_profile_level: 4, horizon_years: 3 })).toEqual({ risk_profile_level: 4, horizon_years: 3 });
    expect(perfilYHorizonteDe({ risk_profile_level: 42, horizon_years: 0 })).toEqual({});
    expect(perfilYHorizonteDe({})).toEqual({});
    expect(perfilYHorizonteDe(null)).toEqual({});
  });

  test("el perfil elegido que arrastra un nivel es el de su número en la escala de diez; sin nivel válido, ninguno", () => {
    expect(perfilElegidoDelNivel(1)).toBe("RISK_1");
    expect(perfilElegidoDelNivel(4)).toBe("RISK_4");
    expect(perfilElegidoDelNivel(10)).toBe("RISK_10");
    for (const nivel of [undefined, 0, 11, 4.5, Number.NaN]) expect(perfilElegidoDelNivel(nivel)).toBeNull();
  });
});

describe("los textos", () => {
  test("el nivel con su nombre de la escala de diez, y sin definir cuando no hay", () => {
    expect(textoDelNivel(5)).toBe("5 · Equilibrado");
    expect(textoDelNivel(10)).toBe("10 · Muy agresivo");
    expect(textoDelNivel(undefined)).toBe("Sin definir");
  });

  test("el horizonte en años, sin deducirlo del nivel", () => {
    expect(textoDelHorizonte(1)).toBe("1 año");
    expect(textoDelHorizonte(5)).toBe("5 años");
    expect(textoDelHorizonte(2.5)).toBe("2,5 años");
    expect(textoDelHorizonte(undefined)).toBe("Sin definir");
  });
});

describe("la huella de la cartera", () => {
  const base = { positions: DOC.positions, capital: 100000, nombre: "Cliente" };

  test("sin perfil ni horizonte es la de antes: una cartera abierta antes no aparece con cambios sin guardar", () => {
    expect(huellaDeCartera({ ...base, perfilYHorizonte: {} })).toBe(huellaDeCartera(base));
    expect(huellaDeCartera(base)).toBe(JSON.stringify([[["LU0000000001", 100, 0, null]], 100000, "Cliente"]));
  });

  test("cambiar el nivel o el horizonte es cambiar la cartera", () => {
    const sin = huellaDeCartera(base);
    const conNivel = huellaDeCartera({ ...base, perfilYHorizonte: { risk_profile_level: 5 } });
    const conAmbos = huellaDeCartera({ ...base, perfilYHorizonte: { risk_profile_level: 5, horizon_years: 3 } });
    expect(new Set([sin, conNivel, conAmbos]).size).toBe(3);
    expect(huellaDeCartera({ ...base, perfilYHorizonte: { horizon_years: 3 } })).not.toBe(sin);
  });
});

describe("el navegador", () => {
  test("una cartera guardada conserva los dos campos, y pierde los que no validan", () => {
    const leidas = parseLocalPortfolios(
      serializeLocalPortfolios([
        { ...CARTERA, sourceKind: "LOCAL_MOCK", portfolio_id: "a", risk_profile_level: 7, horizon_years: 5 },
        { ...CARTERA, sourceKind: "LOCAL_MOCK", portfolio_id: "b" },
        { ...CARTERA, sourceKind: "LOCAL_MOCK", portfolio_id: "c", risk_profile_level: 11, horizon_years: -1 }
      ])
    );
    expect(leidas[0]).toMatchObject({ risk_profile_level: 7, horizon_years: 5 });
    expect("risk_profile_level" in leidas[1]).toBe(false);
    expect("horizon_years" in leidas[1]).toBe(false);
    expect("risk_profile_level" in leidas[2]).toBe(false);
    expect("horizon_years" in leidas[2]).toBe(false);
  });

  test("lo de Diseño se recuerda por fuente, y vacío borra la clave", () => {
    const guardado = almacen();
    writePerfilYHorizonteToStorage(guardado, "LOCAL_MOCK", { risk_profile_level: 3, horizon_years: 2 });
    expect(readPerfilYHorizonteFromStorage(guardado, "LOCAL_MOCK")).toEqual({ risk_profile_level: 3, horizon_years: 2 });
    expect(readPerfilYHorizonteFromStorage(guardado, "BBDD_LIVE_API")).toEqual({});
    writePerfilYHorizonteToStorage(guardado, "LOCAL_MOCK", {});
    expect(guardado.datos.has(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY)).toBe(false);
    guardado.setItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY, "{roto");
    expect(readPerfilYHorizonteFromStorage(guardado, "LOCAL_MOCK")).toEqual({});
  });
});

describe("el adaptador de la cuenta", () => {
  test("lee los dos campos de la raíz del documento; sin ellos, la cartera no los lleva", () => {
    expect(parseSavedPortfolio({ ...DOC, risk_profile_level: 6, horizon_years: 4 })).toMatchObject({ risk_profile_level: 6, horizon_years: 4 });
    const sin = parseSavedPortfolio(DOC);
    expect("risk_profile_level" in sin).toBe(false);
    expect("horizon_years" in sin).toBe(false);
    const conNull = parseSavedPortfolio({ ...DOC, risk_profile_level: null, horizon_years: null });
    expect("risk_profile_level" in conNull).toBe(false);
  });

  test("un valor fuera de regla rompe el contrato: esa cartera se descarta con aviso y las demás se cargan", () => {
    expect(() => parseSavedPortfolio({ ...DOC, risk_profile_level: 0 })).toThrow(AppError);
    expect(() => parseSavedPortfolio({ ...DOC, horizon_years: -1 })).toThrow(/horizonte/);
    const lista = parsePortfolioListResult({
      portfolios: [{ ...DOC, portfolio_id: "mala", risk_profile_level: 12 }, { ...DOC, portfolio_id: "buena", horizon_years: 3 }],
      count: 2
    });
    expect(lista.portfolios.map((c) => c.portfolio_id)).toEqual(["buena"]);
    expect(lista.discarded[0]).toMatchObject({ portfolio_id: "mala" });
  });

  test("al guardar manda siempre las dos claves: el valor, o null para quitarlo", async () => {
    red.llamar.mockResolvedValue({ portfolio_id: "c1", portfolio: { ...DOC, risk_profile_level: 6 }, warnings: [] });
    const respuesta = await backendSavePortfolio({ ...CARTERA, risk_profile_level: 6 });
    expect(red.llamar).toHaveBeenCalledWith(
      "save_portfolio",
      expect.objectContaining({ risk_profile_level: 6, horizon_years: null }),
      expect.any(String)
    );
    expect(respuesta.portfolio?.risk_profile_level).toBe(6);
    expect("horizon_years" in (respuesta.portfolio ?? {})).toBe(false);
  });

  test("lo que no valida no sale a la red", async () => {
    red.llamar.mockReset();
    await expect(backendSavePortfolio({ ...CARTERA, risk_profile_level: 0 })).rejects.toThrow(/fuera de la escala/);
    await expect(backendSavePortfolio({ ...CARTERA, horizon_years: 0 })).rejects.toThrow(/mayor que cero/);
    expect(red.llamar).not.toHaveBeenCalled();
  });
});
