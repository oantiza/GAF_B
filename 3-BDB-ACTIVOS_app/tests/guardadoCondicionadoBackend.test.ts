/**
 * DIS-03: «Guardar» manda al servidor la fecha de modificación con que se abrió la guardada (`expected_updated_at`),
 * y el servidor la rechaza si ha cambiado o ya no existe. Aquí, el adaptador: qué manda y cómo traduce el rechazo.
 * Se prueba a través de `callBackend` de verdad, con solo `httpsCallable` simulado: el detalle del error del servidor
 * tiene que llegar entero hasta aquí.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const red = vi.hoisted(() => ({ llamada: vi.fn() }));
vi.mock("../src/firebase", () => ({ auth: { currentUser: { uid: "u1" } }, functions: {}, appCheckReady: Promise.resolve() }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => red.llamada }));

import { ConflictoAlGuardar } from "../src/adapters/conflictoAlGuardar";
import { backendSavePortfolio } from "../src/adapters/portfolioBackend";
import { AppError } from "../src/core/appError";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const ABIERTA_A_LAS = "2026-11-14T09:00:00+00:00";
const DOC = {
  portfolio_id: "p1",
  name: "Cliente",
  created_at: "2026-11-01T10:00:00+00:00",
  updated_at: "2026-11-14T10:00:00+00:00",
  positions: [{ asset_id: "LU0000000001", weight_percent: 100 }]
};
const CARTERA: BdbSavedLocalPortfolio = { ...DOC, sourceKind: "BBDD_LIVE_API" };

/** Lo que lanza el SDK de Firebase ante un `HttpsError` del servidor: código con prefijo y `details`. */
function errorDelServidor(details: unknown, code = "functions/aborted") {
  return Object.assign(new Error("No se ha guardado: la cartera guardada ha cambiado desde que la abriste."), { code, details });
}

const loQueSeManda = () => red.llamada.mock.calls[0][0] as Record<string, unknown>;

beforeEach(() => {
  red.llamada.mockReset();
  red.llamada.mockResolvedValue({ data: { portfolio_id: "p1", portfolio: DOC, warnings: [] } });
});

describe("lo que se manda", () => {
  test("con la fecha de la abierta, la manda como expected_updated_at", async () => {
    const respuesta = await backendSavePortfolio(CARTERA, { expectedUpdatedAt: ABIERTA_A_LAS });
    expect(loQueSeManda().expected_updated_at).toBe(ABIERTA_A_LAS);
    /* La fecha que vale para el siguiente guardado es la que devuelve el servidor. */
    expect(respuesta.portfolio?.updated_at).toBe(DOC.updated_at);
  });

  test("sin ella, o con una cadena vacía, no manda el campo: el servidor guarda como siempre", async () => {
    await backendSavePortfolio(CARTERA);
    await backendSavePortfolio(CARTERA, { expectedUpdatedAt: "" });
    await backendSavePortfolio(CARTERA, { expectedUpdatedAt: undefined });
    for (const [payload] of red.llamada.mock.calls) expect("expected_updated_at" in (payload as object)).toBe(false);
  });
});

describe("el rechazo del servidor", () => {
  test("«changed» llega como un conflicto de guardada cambiada, con la fecha de la que hay ahora", async () => {
    red.llamada.mockRejectedValue(
      errorDelServidor({ code: "PORTFOLIO_CONFLICT", reason: "changed", current_updated_at: "2026-11-14T09:30:00+00:00" })
    );
    const error = await backendSavePortfolio(CARTERA, { expectedUpdatedAt: ABIERTA_A_LAS }).catch((causa: unknown) => causa);
    expect(error).toBeInstanceOf(ConflictoAlGuardar);
    expect(error).toBeInstanceOf(AppError);
    expect((error as ConflictoAlGuardar).motivo).toBe("cambiada");
    expect((error as ConflictoAlGuardar).actualUpdatedAt).toBe("2026-11-14T09:30:00+00:00");
  });

  test("«deleted» llega como un conflicto de guardada eliminada", async () => {
    red.llamada.mockRejectedValue(errorDelServidor({ code: "PORTFOLIO_CONFLICT", reason: "deleted", current_updated_at: null }));
    const error = await backendSavePortfolio(CARTERA, { expectedUpdatedAt: ABIERTA_A_LAS }).catch((causa: unknown) => causa);
    expect(error).toBeInstanceOf(ConflictoAlGuardar);
    expect((error as ConflictoAlGuardar).motivo).toBe("eliminada");
    expect((error as ConflictoAlGuardar).actualUpdatedAt).toBeUndefined();
  });

  test("otro fallo, aunque sea un aborted, sigue siendo un fallo cualquiera", async () => {
    red.llamada.mockRejectedValue(errorDelServidor({ code: "OTRA_COSA" }));
    const abortado = await backendSavePortfolio(CARTERA, { expectedUpdatedAt: ABIERTA_A_LAS }).catch((causa: unknown) => causa);
    expect(abortado).toBeInstanceOf(AppError);
    expect(abortado).not.toBeInstanceOf(ConflictoAlGuardar);
    red.llamada.mockRejectedValue(errorDelServidor({ code: "PORTFOLIO_CONFLICT", reason: "changed" }, "functions/internal"));
    const interno = await backendSavePortfolio(CARTERA, { expectedUpdatedAt: ABIERTA_A_LAS }).catch((causa: unknown) => causa);
    expect(interno).not.toBeInstanceOf(ConflictoAlGuardar);
  });
});
