// @vitest-environment happy-dom

/**
 * MEDIA-07 (auditoría 16-10-2026): useAdminClaim leía el claim `admin` una sola
 * vez al montar. Ahora escucha onIdTokenChanged: un token nuevo con el claim
 * (refresco o «Actualizar estado») cambia lo que la interfaz monta sin recargar.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type TokenCallback = (user: unknown) => void;
const tokenState = vi.hoisted(() => ({ callback: null as TokenCallback | null, unsubscribe: vi.fn() }));

vi.mock("../src/firebaseEnv", () => ({
  FIREBASE_CONFIGURED: true,
  PRODUCCION_SIN_CONFIGURAR: false,
  APUNTA_A_BDB: false,
  firebaseConfig: {},
  FUNCTIONS_REGION: "europe-west1"
}));
vi.mock("../src/firebase", () => ({ auth: {}, functions: null, appCheckReady: Promise.resolve() }));
vi.mock("firebase/auth", () => ({
  onIdTokenChanged: (_auth: unknown, callback: TokenCallback) => {
    tokenState.callback = callback;
    return tokenState.unsubscribe;
  }
}));

import { useAdminClaim } from "../src/auth/useIsAdmin";

let root: Root;
let host: HTMLDivElement;

function Probe() {
  const { isAdmin, resolved } = useAdminClaim();
  return createElement("output", null, `${resolved ? "resuelto" : "pendiente"}:${isAdmin ? "admin" : "no-admin"}`);
}

function userWithClaims(claims: Record<string, unknown>) {
  return { uid: "oscar", getIdTokenResult: async () => ({ claims }) };
}

async function settle() {
  for (let attempt = 0; attempt < 20 && !tokenState.callback; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tokenState.callback = null;
  tokenState.unsubscribe.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

test("un token nuevo con el claim admin pasa el hook a admin, y al desmontar se da de baja", async () => {
  await act(async () => { root.render(createElement(Probe)); });
  await settle();
  expect(host.textContent).toBe("pendiente:no-admin");

  await act(async () => { tokenState.callback?.(userWithClaims({})); });
  expect(host.textContent).toBe("resuelto:no-admin");

  await act(async () => { tokenState.callback?.(userWithClaims({ admin: true })); });
  expect(host.textContent).toBe("resuelto:admin");

  await act(async () => { tokenState.callback?.(null); });
  expect(host.textContent).toBe("resuelto:no-admin");

  act(() => root.unmount());
  expect(tokenState.unsubscribe).toHaveBeenCalledTimes(1);
});
