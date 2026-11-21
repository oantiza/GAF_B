import { describe, expect, test } from "vitest";
import {
  CURRENT_PORTFOLIO_STORAGE_KEY,
  LOCAL_PORTFOLIOS_STORAGE_KEY,
  carterasQueNoSeLeen,
  clearPortfolioStorage,
  parseCurrentPortfolioDraft,
  parseLocalPortfolios,
  readCurrentPortfolioDraftCapitalFromStorage,
  readCurrentPortfolioDraftFromStorage,
  readCurrentPortfolioDraftNameFromStorage,
  readLocalPortfoliosFromStorage,
  serializeCurrentPortfolioDraft,
  serializeLocalPortfolios,
  writeCurrentPortfolioDraftCapitalToStorage,
  writeCurrentPortfolioDraftNameToStorage,
  writeCurrentPortfolioDraftToStorage,
  writeLocalPortfoliosToStorage
} from "../src/core/localPortfolioStorage";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    dump: () => data
  };
}

const SAVED: BdbSavedLocalPortfolio = {
  portfolio_id: "p1",
  name: "Cartera Ávila",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
  sourceKind: "LOCAL_MOCK",
  positions: [{ asset_id: "MOCK-FUND-MIXED", weight_percent: 60 }],
  total_capital: 250000
};

describe("localPortfolioStorage (A3.1)", () => {
  test("las carteras guardadas sobreviven al viaje serializar → parsear", () => {
    const parsed = parseLocalPortfolios(serializeLocalPortfolios([SAVED]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ portfolio_id: "p1", name: "Cartera Ávila", total_capital: 250000 });
  });

  test("JSON corrupto, schema desconocido o payload ajeno ⇒ [] / null sin lanzar", () => {
    expect(parseLocalPortfolios("{corrupto")).toEqual([]);
    expect(parseLocalPortfolios(JSON.stringify({ schema_version: "otra.v9", saved_portfolios: [SAVED] }))).toEqual([]);
    expect(parseLocalPortfolios(null)).toEqual([]);
    expect(parseCurrentPortfolioDraft("{corrupto")).toBeNull();
    expect(parseCurrentPortfolioDraft(null)).toBeNull();
  });

  test("las posiciones inválidas se filtran y los pesos se acotan a 0-100", () => {
    const raw = serializeLocalPortfolios([
      {
        ...SAVED,
        positions: [
          { asset_id: "OK", weight_percent: 150 },
          { asset_id: 42, weight_percent: 10 } as never,
          { weight_percent: 10 } as never
        ]
      }
    ]);
    const [portfolio] = parseLocalPortfolios(raw);
    expect(portfolio.positions).toEqual([{ asset_id: "OK", weight_percent: 100 }]);
  });

  test("un sourceKind desconocido invalida la cartera guardada entera", () => {
    const raw = JSON.stringify({
      schema_version: "local-portfolios.v1",
      updated_at: "x",
      local_only_notice: "x",
      saved_portfolios: [{ ...SAVED, sourceKind: "OTRA_FUENTE" }]
    });
    expect(parseLocalPortfolios(raw)).toEqual([]);
  });

  test("el borrador conserva el capital al reescribir posiciones (F2.7)", () => {
    const storage = memoryStorage();
    storage.setItem(
      CURRENT_PORTFOLIO_STORAGE_KEY,
      serializeCurrentPortfolioDraft({
        sourceKind: "LOCAL_MOCK",
        positions: [{ asset_id: "A", weight_percent: 100 }],
        totalCapital: 300000
      })
    );
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "B", weight_percent: 100 }]);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(300000);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([
      { asset_id: "B", weight_percent: 100 }
    ]);
  });

  test("vaciar posiciones con capital persistido deja un borrador solo-capital", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 500000);
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", []);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([]);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(500000);
  });

  test("el borrador de una fuente nunca pisa ni contamina el de otra", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "BBDD_LIVE_API", [{ asset_id: "REAL", weight_percent: 100 }]);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 999999); // otra fuente: se ignora
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([]);
    expect(readCurrentPortfolioDraftFromStorage(storage, "BBDD_LIVE_API")).toEqual([
      { asset_id: "REAL", weight_percent: 100 }
    ]);
    // F-04: la otra fuente no hereda capital; queda «sin fijar», no 100.000 €.
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "BBDD_LIVE_API")).toBeUndefined();
  });

  test("capital inválido se ignora y sin borrador el capital queda sin fijar (F-04)", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", Number.NaN);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", -5);
    expect(storage.dump().size).toBe(0);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();
  });

  test("un storage que lanza no rompe: leer devuelve [] y escribir no propaga", () => {
    const explosive = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      }
    };
    expect(readLocalPortfoliosFromStorage(explosive)).toEqual([]);
    expect(() => writeLocalPortfoliosToStorage(explosive, [SAVED])).not.toThrow();
    expect(() => clearPortfolioStorage(explosive)).not.toThrow();
    expect(readCurrentPortfolioDraftCapitalFromStorage(explosive, "LOCAL_MOCK")).toBeUndefined();
  });

  test("clearPortfolioStorage borra las dos claves", () => {
    const storage = memoryStorage();
    writeLocalPortfoliosToStorage(storage, [SAVED]);
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    expect(storage.dump().has(LOCAL_PORTFOLIOS_STORAGE_KEY)).toBe(true);
    clearPortfolioStorage(storage);
    expect(storage.dump().size).toBe(0);
  });

  /* Ola 1 (E1, 03-09-2026): nombre de la cartera activa. */
  test("el nombre viaja en el borrador y sobrevive a los cambios de posiciones y capital", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    writeCurrentPortfolioDraftNameToStorage(storage, "LOCAL_MOCK", "  Carmen  Ruiz · propuesta  ");

    expect(readCurrentPortfolioDraftNameFromStorage(storage, "LOCAL_MOCK")).toBe("Carmen Ruiz · propuesta");

    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [
      { asset_id: "A", weight_percent: 60 },
      { asset_id: "B", weight_percent: 40 }
    ]);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 250000);

    expect(readCurrentPortfolioDraftNameFromStorage(storage, "LOCAL_MOCK")).toBe("Carmen Ruiz · propuesta");
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(250000);
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toHaveLength(2);
  });

  test("vaciar la cartera conserva el borrador si hay nombre; el nombre no cruza de fuente", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    writeCurrentPortfolioDraftNameToStorage(storage, "LOCAL_MOCK", "Cartera de prueba");
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", []);

    expect(readCurrentPortfolioDraftNameFromStorage(storage, "LOCAL_MOCK")).toBe("Cartera de prueba");
    expect(readCurrentPortfolioDraftNameFromStorage(storage, "BBDD_LIVE_API")).toBe("");

    writeCurrentPortfolioDraftNameToStorage(storage, "BBDD_LIVE_API", "Otra fuente");
    expect(readCurrentPortfolioDraftNameFromStorage(storage, "LOCAL_MOCK")).toBe("Cartera de prueba");
  });

  test("un borrador viejo sin nombre sigue siendo válido (retrocompatible)", () => {
    const legacy = JSON.parse(
      serializeCurrentPortfolioDraft({ sourceKind: "LOCAL_MOCK", positions: [{ asset_id: "A", weight_percent: 100 }] })
    ) as Record<string, unknown>;
    expect(legacy.name).toBeUndefined();
    expect(parseCurrentPortfolioDraft(JSON.stringify(legacy))?.name).toBeUndefined();
  });
});

/* IMP-9 (auditoría del 16-11-2026): una cartera guardada que no se lee no se enseña, pero guardar otra no la borra. */
describe("las carteras guardadas que no se pueden leer", () => {
  /* Le falta `sourceKind`, que es obligatorio: no valida. */
  const ROTA = { portfolio_id: "vieja", name: "Cartera de otra versión", created_at: "2026-01-01", updated_at: "2026-01-02", positions: [] };
  const almacenConLaRota = () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, JSON.stringify({ schema_version: "local-portfolios.v1", updated_at: "x", saved_portfolios: [SAVED, ROTA] }));
    return storage;
  };

  test("no se enseñan, y se pueden contar", () => {
    const storage = almacenConLaRota();
    expect(readLocalPortfoliosFromStorage(storage).map((p) => p.portfolio_id)).toEqual(["p1"]);
    expect(carterasQueNoSeLeen(storage)).toEqual([ROTA]);
  });

  test("guardar otra no la borra: se conserva tal cual, detrás de las que sí se leen", () => {
    const storage = almacenConLaRota();
    const nueva: BdbSavedLocalPortfolio = { ...SAVED, portfolio_id: "p2", name: "Otra" };
    writeLocalPortfoliosToStorage(storage, [...readLocalPortfoliosFromStorage(storage), nueva]);
    const guardado = JSON.parse(storage.getItem(LOCAL_PORTFOLIOS_STORAGE_KEY) ?? "{}") as { saved_portfolios: Array<{ portfolio_id: string }> };
    expect(guardado.saved_portfolios.map((p) => p.portfolio_id)).toEqual(["p1", "p2", "vieja"]);
    expect(readLocalPortfoliosFromStorage(storage).map((p) => p.portfolio_id)).toEqual(["p1", "p2"]);
    expect(carterasQueNoSeLeen(storage)).toEqual([ROTA]);
    /* Y no se duplica al guardar otra vez. */
    writeLocalPortfoliosToStorage(storage, readLocalPortfoliosFromStorage(storage));
    expect(carterasQueNoSeLeen(storage)).toEqual([ROTA]);
  });

  test("un almacén vacío o de otra versión no aporta nada", () => {
    expect(carterasQueNoSeLeen(memoryStorage())).toEqual([]);
    const otra = memoryStorage();
    otra.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, JSON.stringify({ schema_version: "local-portfolios.v0", saved_portfolios: [ROTA] }));
    expect(carterasQueNoSeLeen(otra)).toEqual([]);
  });
});
