/**
 * Hallazgo 19 de la auditoría del backend (15-11-2026): un fallo de lectura no se enseña como «el activo no existe».
 *
 * El servidor nuevo manda `read_warnings` (lo que no pudo leer) y `missing_asset_ids`, y contesta `unavailable` con un
 * texto propio cuando no pudo leer nada. El adaptador acepta las dos formas: la de un servidor sin actualizar, que no
 * trae nada de eso, sigue dando lo de siempre.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const servidor = vi.hoisted(() => ({
  /** "antiguo": la respuesta de antes; "nuevo": con los campos aditivos vacíos; "parcial": con avisos; "caido": unavailable. */
  modo: "antiguo" as "antiguo" | "nuevo" | "parcial" | "caido",
  llamadas: {} as Record<string, number>
}));

const BASE_CAIDA =
  "No se ha podido leer la base de activos en este momento. Es un fallo pasajero, no que el dato no exista: vuelve a intentarlo en unos segundos.";

function activo(assetId: string) {
  return { asset_id: assetId, identity: { display_name: assetId, currency: "EUR" }, instrument_type: "FUND", metrics: {} };
}

function fila(assetId: string) {
  return { ...activo(assetId), requested_asset_id: assetId, display_name: assetId, currency: "EUR", weight: 1 };
}

const aviso = (part: string, ids: string[]) => ({ code: "READ_FAILED", severity: "MEDIUM", part, asset_ids: ids, message: "x" });

function responder(name: string, data: { asset_ids?: string[]; asset_id?: string; positions?: { asset_id: string }[] }) {
  const { modo } = servidor;
  if (modo === "caido") throw Object.assign(new Error(BASE_CAIDA), { code: "functions/unavailable" });
  const nuevo = modo !== "antiguo";
  const avisos = (part: string, ids: string[]) => (modo === "parcial" ? [aviso(part, ids)] : []);
  if (name === "compare_assets") {
    const ids = (data.asset_ids ?? []).filter((id) => id !== "NO_EXISTE");
    return {
      assets: ids.map(activo),
      ...(nuevo ? { missing_asset_ids: (data.asset_ids ?? []).filter((id) => id === "NO_EXISTE"), read_warnings: avisos("metrics", ids) } : {})
    };
  }
  if (name === "get_asset_detail") {
    return { ...activo(data.asset_id ?? ""), ...(modo === "parcial" ? { read_warnings: avisos("metrics", [data.asset_id ?? ""]) } : {}) };
  }
  if (name === "search_assets") {
    return {
      assets: [{ asset_id: "A", display_name: "A", instrument_type: "FUND", currency: "EUR", metrics: {} }],
      total_matches: 1, next_cursor: null,
      ...(nuevo ? { read_warnings: avisos("metrics", ["A"]) } : {})
    };
  }
  if (name === "get_asset_holdings_batch") {
    return {
      holdings: Object.fromEntries((data.asset_ids ?? []).map((id) => [id, null])),
      ...(nuevo ? { read_warnings: avisos("holdings", data.asset_ids ?? []) } : {})
    };
  }
  if (name === "resolve_portfolio") {
    const ids = (data.positions ?? []).map((p) => p.asset_id);
    // En «parcial»: LEIDO se lee entero, SIN_METRICAS sin sus métricas, CAIDO no se lee, NO_EXISTE no existe.
    return {
      rows: ids.filter((id) => id !== "NO_EXISTE" && id !== "BRK/B" && !(modo === "parcial" && id === "CAIDO")).map(fila),
      warnings: [
        ...(ids.includes("BRK/B") ? [{ code: "MISSING_ASSET", severity: "HIGH", asset_id: "BRK/B", reason: "INVALID_ID", message: "Asset not found: forma" }] : []),
        ...(ids.includes("NO_EXISTE") ? [{ code: "MISSING_ASSET", severity: "HIGH", asset_id: "NO_EXISTE", message: "Asset not found." }] : []),
        ...(modo === "parcial"
          ? [{ ...aviso("asset", ["CAIDO"]), asset_id: "CAIDO" }, { ...aviso("metrics", ["SIN_METRICAS"]), asset_id: "SIN_METRICAS" }]
          : [])
      ],
      positions: data.positions
    };
  }
  return {};
}

vi.mock("../src/firebase", () => ({ functions: {}, appCheckReady: Promise.resolve() }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    servidor.llamadas[name] = (servidor.llamadas[name] ?? 0) + 1;
    return { data: responder(name, payload as never) };
  }
}));

async function adaptador() {
  return import("../src/adapters/bdbLiveApiAdapter");
}

beforeEach(() => {
  vi.resetModules();
  servidor.modo = "antiguo";
  servidor.llamadas = {};
});

describe("un servidor sin actualizar sigue funcionando como antes", () => {
  test.each(["antiguo", "nuevo"] as const)("con la respuesta %s, comparar, buscar, la ficha, el lote de posiciones y la cartera dan lo de siempre", async (modo) => {
    servidor.modo = modo;
    const a = await adaptador();
    expect((await a.getLiveApiComparableAssets(["X", "NO_EXISTE"])).map((d) => d.asset_id)).toEqual(["X"]);
    expect((await a.searchLiveApiAssetsPage({ query: "a" })).results.map((r) => r.asset_id)).toEqual(["A"]);
    expect((await a.getLiveApiAssetDetail("Y"))?.asset_id).toBe("Y");
    expect((await a.getLiveApiAssetHoldingsMany(["Z"])).get("Z")).toBeNull();
    const cartera = await a.resolveLiveApiPortfolioPositions([{ asset_id: "LEIDO", amount: 10 }, { asset_id: "NO_EXISTE", amount: 5 }]);
    expect(cartera.map((p) => [p.id, p.asset?.asset_id ?? null, p.sinLeer])).toEqual([["LEIDO", "LEIDO", undefined], ["NO_EXISTE", null, undefined]]);
  });
});

describe("un identificador sin forma válida es una fila no reconocida, no un error", () => {
  test("«BRK/B» sale sin activo y sin aviso de lectura, y el resto de la cartera se resuelve", async () => {
    servidor.modo = "nuevo";
    const a = await adaptador();
    const cartera = await a.resolveLiveApiPortfolioPositions([{ asset_id: "LEIDO", amount: 10 }, { asset_id: "BRK/B", amount: 5 }]);
    expect(cartera.map((p) => [p.id, p.asset?.asset_id ?? null, p.sinLeer])).toEqual([["LEIDO", "LEIDO", undefined], ["BRK/B", null, undefined]]);
  });

  test("la comparación acepta la lista nueva de no válidos sin tropezar", async () => {
    servidor.modo = "nuevo";
    const { parseLiveComparePage } = await import("../src/adapters/bdbLiveApiContracts");
    expect(parseLiveComparePage({ assets: [], missing_asset_ids: ["BRK/B"], invalid_asset_ids: ["BRK/B"], read_warnings: [] }).missing_asset_ids).toEqual(["BRK/B"]);
  });
});

describe("una lectura que falla en parte no se enseña como completa", () => {
  test("en la cartera, la posición que no se leyó no es la que no existe, y la que se leyó sin métricas lo dice", async () => {
    servidor.modo = "parcial";
    const a = await adaptador();
    const cartera = await a.resolveLiveApiPortfolioPositions([
      { asset_id: "LEIDO", amount: 1 }, { asset_id: "SIN_METRICAS", amount: 1 }, { asset_id: "CAIDO", amount: 1 }, { asset_id: "NO_EXISTE", amount: 1 }
    ]);
    expect(cartera.map((p) => [p.id, p.asset !== null, p.sinLeer ?? null])).toEqual([
      ["LEIDO", true, null],
      ["SIN_METRICAS", true, ["metrics"]],
      ["CAIDO", false, ["asset"]],
      ["NO_EXISTE", false, null]
    ]);
  });

  test.each([
    ["comparar", (a: Awaited<ReturnType<typeof adaptador>>) => a.getLiveApiComparableAssets(["X"]), "compare_assets"],
    ["buscar", (a: Awaited<ReturnType<typeof adaptador>>) => a.searchLiveApiAssetsPage({ query: "a" }), "search_assets"],
    ["la ficha", (a: Awaited<ReturnType<typeof adaptador>>) => a.getLiveApiAssetDetail("Y"), "get_asset_detail"],
    ["el lote de posiciones", (a: Awaited<ReturnType<typeof adaptador>>) => a.getLiveApiAssetHoldingsMany(["Z"]), "get_asset_holdings_batch"]
  ])("%s dice que no se pudo leer, que se arregla reintentando, y no lo guarda", async (_nombre, llamar, funcion) => {
    servidor.modo = "parcial";
    const a = await adaptador();
    await expect(llamar(a)).rejects.toThrow(/No se pudo leer de la base .* No es que no exista ni que falte el dato: vuelve a intentarlo/);
    servidor.modo = "nuevo";
    await expect(llamar(a)).resolves.toBeDefined();
    expect(servidor.llamadas[funcion]).toBe(2);
  });
});

describe("si la base no contesta, el asesor lee que es pasajero y que el dato no falta", () => {
  test("el texto del servidor es el principal, tras el reintento automático", async () => {
    servidor.modo = "caido";
    const a = await adaptador();
    const error = await a.getLiveApiComparableAssets(["X"]).catch((e: unknown) => e);
    const { AppError, appErrorTitle } = await import("../src/core/appError");
    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).message).toBe(BASE_CAIDA);
    expect(appErrorTitle(error as InstanceType<typeof AppError>)).toBe("No se ha podido completar");
    expect(servidor.llamadas.compare_assets).toBe(2);
  });

  test("otro unavailable sigue con el texto de siempre", async () => {
    const { toAppError } = await import("../src/core/appError");
    const error = toAppError(Object.assign(new Error("no available instance"), { code: "functions/unavailable" }));
    expect(error.message).toBe("El servicio no está disponible en este momento. Reinténtalo en unos segundos.");
  });
});

describe("el texto de una lectura incompleta", () => {
  test("nombra lo que falta y de quién", async () => {
    const { lecturaIncompleta } = await import("../src/core/appError");
    expect(lecturaIncompleta(["metrics"], ["LU1"]).message).toBe(
      "No se pudo leer de la base las métricas de LU1. No es que no exista ni que falte el dato: vuelve a intentarlo en unos segundos."
    );
    expect(lecturaIncompleta(["asset", "metrics", "metrics"], ["LU1", "LU2"]).message).toMatch(
      /^No se pudo leer de la base la ficha y las métricas de 2 activos \(LU1, LU2\)\./
    );
  });
});
