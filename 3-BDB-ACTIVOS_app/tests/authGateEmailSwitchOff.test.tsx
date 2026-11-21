// @vitest-environment happy-dom

/**
 * MEDIA-07, interruptor de emergencia (revisión R-09): con
 * VITE_BDB_REQUIRE_EMAIL_VERIFIED=false (espejo de BDB_REQUIRE_EMAIL_VERIFIED
 * apagado en functions), una cuenta sin correo verificado entra en la app.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

vi.mock("../src/config/runtimeConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/runtimeConfig")>()),
  REQUIRE_EMAIL_VERIFIED: false
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
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback({ uid: "asesora", email: "asesora@oaa.es", emailVerified: false });
    return () => undefined;
  },
  signOut: vi.fn(),
  multiFactor: () => ({ enrolledFactors: [] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";

test("con el interruptor apagado, una cuenta sin verificar entra en la app", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(AuthGate, null, createElement("p", { id: "app" }, "Aplicación")));
    });
    for (let attempt = 0; attempt < 50 && !host.querySelector("h1, #app"); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    expect(host.querySelector("#app")?.textContent).toBe("Aplicación");
    expect(host.textContent).not.toContain("Verifica tu correo electrónico");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
