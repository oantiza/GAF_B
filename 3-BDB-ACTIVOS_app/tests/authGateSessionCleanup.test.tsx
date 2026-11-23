// @vitest-environment happy-dom

/**
 * ALTA-21 (auditoría 14-10-2026): al cerrar sesión se borraba la cartera del
 * navegador pero no el último resultado de «Mejorar cartera» (sessionStorage)
 * ni las cachés en memoria de las fichas. Se monta la puerta de acceso real
 * con un Firebase Auth simulado: sesión abierta, recarga, cambio de usuario y
 * cierre de sesión.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AuthCallback = (user: unknown) => void;
const authState = vi.hoisted(() => ({
  callback: null as AuthCallback | null,
  initialUser: null as unknown,
  signOut: vi.fn()
}));

vi.mock("../src/firebaseEnv", () => ({
  FIREBASE_CONFIGURED: true,
  PRODUCCION_SIN_CONFIGURAR: false,
  APUNTA_A_BDB: false,
  firebaseConfig: {},
  FUNCTIONS_REGION: "europe-west1"
}));
vi.mock("../src/firebase", () => ({ auth: {}, functions: null, appCheckReady: Promise.resolve() }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: AuthCallback) => {
    authState.callback = callback;
    callback(authState.initialUser);
    return () => { authState.callback = null; };
  },
  signOut: (...args: unknown[]) => {
    authState.signOut(...args);
    authState.callback?.(null);
    return Promise.resolve();
  },
  multiFactor: () => ({ enrolledFactors: [{ uid: "totp" }] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";
import { useAuthSession } from "../src/auth/AuthSessionContext";
import { IMPROVEMENT_RESULT_STORAGE_KEY } from "../src/core/improvementResultStore";
import { CURRENT_PORTFOLIO_STORAGE_KEY } from "../src/core/localPortfolioStorage";
import { registerSessionCache } from "../src/core/sessionCaches";
import { readComparisonSelection, writeComparisonSelection } from "../src/core/comparisonSelection";

const FAVORITES_KEY = "bdb-activos.favorites.v1";

const user = (uid: string) => ({ uid, email: `${uid}@oaa.es`, emailVerified: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const sessionInvalidations = vi.fn();
registerSessionCache(sessionInvalidations);

function SessionProbe() {
  const session = useAuthSession();
  return createElement("button", { type: "button", onClick: session?.signOut }, `Salir de ${session?.email ?? "nadie"}`);
}

function seedBrowserSession() {
  sessionStorage.setItem(IMPROVEMENT_RESULT_STORAGE_KEY, JSON.stringify({ schema_version: "improvement-result.v1" }));
  sessionStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
  localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
  // Selección del comparador (en local o en sesión según la fuente).
  writeComparisonSelection(localStorage, ["LU0232524495", "LU0524465548"]);
  writeComparisonSelection(sessionStorage, ["LU0232524495"]);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(["LU0232524495"]));
  // Las claves que borra AuthGate son las que leen sus módulos.
  expect(readComparisonSelection(localStorage)).toHaveLength(2);
}

function expectSessionKeysCleared() {
  expect(readComparisonSelection(localStorage)).toEqual([]);
  expect(readComparisonSelection(sessionStorage)).toEqual([]);
  expect(localStorage.getItem("bdb-activos.comparison-selection.v1")).toBeNull();
  // Los favoritos son preferencias: se quedan.
  expect(localStorage.getItem(FAVORITES_KEY)).not.toBeNull();
}

const storedImprovement = () => sessionStorage.getItem(IMPROVEMENT_RESULT_STORAGE_KEY);
const storedDraft = () => sessionStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY);

async function mountGate() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AuthGate, null, createElement(SessionProbe))); });
  for (let attempt = 0; attempt < 50 && !host.querySelector("button"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  authState.initialUser = user("asesora");
  authState.signOut.mockReset();
  sessionInvalidations.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

describe("ALTA-21 · cerrar sesión no deja datos de la anterior", () => {
  test("una recarga con la misma sesión conserva el borrador y el resultado de «Mejorar cartera»", async () => {
    seedBrowserSession();
    await mountGate();

    expect(host!.textContent).toContain("Salir de asesora@oaa.es");
    expect(storedImprovement()).not.toBeNull();
    expect(storedDraft()).not.toBeNull();
    expect(readComparisonSelection(localStorage)).toHaveLength(2);
    });

  test("«Salir» vacía las cachés de sesión, la cartera y el resultado de «Mejorar cartera»", async () => {
    seedBrowserSession();
    await mountGate();
    sessionInvalidations.mockReset();

    await act(async () => { host!.querySelector("button")!.click(); });

    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(sessionInvalidations).toHaveBeenCalled();
    expect(storedImprovement()).toBeNull();
    expect(storedDraft()).toBeNull();
    expect(localStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
    expectSessionKeysCleared();
  });

  test("un cambio de usuario sin pasar por «Salir» también lo vacía", async () => {
    await mountGate();
    seedBrowserSession();
    sessionInvalidations.mockReset();

    await act(async () => { authState.callback?.(user("otro")); });

    expect(host!.textContent).toContain("Salir de otro@oaa.es");
    expect(sessionInvalidations).toHaveBeenCalled();
    expect(storedImprovement()).toBeNull();
    expect(storedDraft()).toBeNull();
    expectSessionKeysCleared();
  });
});
